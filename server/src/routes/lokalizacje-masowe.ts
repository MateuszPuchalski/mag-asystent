import type { FastifyInstance } from "fastify";
import { autorOperacji, sesjaZadania } from "../context.js";
import { autoryzuj } from "../services/auth.js";
import { parsujCsv } from "../services/zbiorki.js";
import {
  przeliczImport,
  zastosujImport,
  type WierszArkusza,
} from "../services/lokalizacje-masowe.js";

/* ── Masowa podmiana adresów z arkusza — trasa biura (0.138.0) ───────────────
   JEDNA trasa o dwóch trybach, nie dwie. `zastosuj` domyślnie `false` znaczy
   podgląd: ten sam kod liczy raport w obu przebiegach, więc nie da się
   zastosować czegoś innego, niż się widziało na ekranie. Dwie osobne trasy
   z osobnymi ścieżkami do raportu rozjechałyby się przy pierwszej zmianie
   reguły odsiewania i nikt by tego nie zauważył.

   Przy `zastosuj` raport liczy się PONOWNIE, na świeżym stanie kartoteki —
   między obejrzeniem podglądu a kliknięciem ktoś przy regale mógł ruszyć ten
   sam adres z kolektora.

   Wiersze przychodzą gotowe z przeglądarki (`wiersze`) albo jako tekst CSV
   (`csv`). Arkusz .xlsx rozbiera przeglądarka i to jest ta sama zasada, dla
   której obrazy przerabia przeglądarka, a nie serwer: tutaj wjeżdża struktura,
   nigdy bajty pliku.                                                          */

/** 2000 wierszy JSON-a to setki kilobajtów; 8 MB starcza z ogromnym zapasem. */
const LIMIT_CIALA = 8 * 1024 * 1024;

interface CialoImportu {
  wiersze?: WierszArkusza[];
  csv?: string;
  /**
   * Które obecne kody zostawić, per symbol kartoteki (0.139.0).
   *
   * Mapa OBOK wierszy, a nie pole w wierszu, i to jest wymuszone przez CSV:
   * plik CSV rozbiera serwer, więc przeglądarka nie ma wierszy, do których
   * mogłaby wybór dokleić. Jedna mapa działa tak samo dla obu wejść.
   */
  zachowaj?: Record<string, string[]>;
  zastosuj?: boolean;
}

/**
 * Nagłówki, po których poznajemy kolumny eksportu z Subiekta.
 *
 * Dopasowanie po NAZWIE, nie po literze kolumny. Zaszyte „C" i „L" zepsułyby
 * się przy pierwszym eksporcie o innym układzie kolumn — i to po cichu,
 * wgrywając „Nazwę" jako adres.
 */
const KOL_SYMBOL = "symbol";
const KOL_LOKALIZACJA = "lokalizacja";

/**
 * CSV → wiersze. Nagłówek jest wymagany, bo to on nazywa kolumny.
 *
 * Parser to `parsujCsv` z importu zbiórek — pierwszy i jedyny w repo, umie
 * cudzysłowy i BOM z Excela. Drugi parser CSV byłby drugim miejscem do
 * poprawiania tego samego błędu.
 */
export function wierszeZCsv(csv: string): WierszArkusza[] {
  const tabela = parsujCsv(csv);
  if (tabela.length < 2) throw new Error("Plik CSV nie ma nagłówka albo nie ma wierszy");
  const naglowek = tabela[0].map((h) => h.trim().toLowerCase());
  const iSym = naglowek.findIndex((h) => h === KOL_SYMBOL);
  // „Lokalizacja SIE" — sufiks bywa różny, więc dopasowanie po przedrostku.
  const iLok = naglowek.findIndex((h) => h.startsWith(KOL_LOKALIZACJA));
  if (iSym === -1 || iLok === -1) {
    throw new Error(
      "Plik musi mieć kolumny „Symbol” i „Lokalizacja” — znalezione nagłówki: " +
        naglowek.join(", ")
    );
  }
  return tabela.slice(1).map((w) => ({
    symbol: (w[iSym] ?? "").trim(),
    lokalizacja: (w[iLok] ?? "").trim(),
  }));
}

export async function lokalizacjeMasoweRoutes(app: FastifyInstance) {
  /**
   * Bramka jest DWUSTOPNIOWA i to jest decyzja, nie przeoczenie.
   *
   * Podgląd sprawdza samą rolę. `autoryzuj()` pisze `privileged` do dziennika
   * przy KAŻDYM wywołaniu, a wybranie pliku to jeszcze nie operacja — wpis
   * przy każdym otwarciu arkusza byłby tym samym szumem, który 0.52.3
   * z dziennika usuwało. Zapis idzie już przez `autoryzuj()`.
   */
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (s.user.role !== "admin") {
      return { kod: 403, error: "Masową zmianę lokalizacji wykonuje administrator" };
    }
    return null;
  }

  app.post<{ Body: CialoImportu }>(
    "/api/biuro/lokalizacje/arkusz",
    { bodyLimit: LIMIT_CIALA },
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });

      const body = req.body ?? {};
      let wiersze: WierszArkusza[];
      try {
        if (typeof body.csv === "string" && body.csv.trim() !== "") {
          wiersze = wierszeZCsv(body.csv);
        } else if (Array.isArray(body.wiersze)) {
          wiersze = body.wiersze;
        } else {
          return reply
            .code(400)
            .send({ error: "Body musi zawierać `wiersze` z arkusza albo `csv` z treścią pliku" });
        }
      } catch (e) {
        // zły plik to decyzja wołającego, nie awaria serwera — tak samo jak
        // przy imporcie zbiórek
        return reply.code(400).send({ error: (e as Error).message });
      }

      /* Wybory dopinamy PO rozbiorze pliku, żeby jedna droga obsłużyła oba
         wejścia. Symbol jest kluczem, bo tylko on identyfikuje wiersz
         niezależnie od tego, czy przyszedł z arkusza, czy z CSV. */
      const wybory = body.zachowaj ?? {};
      if (Object.keys(wybory).length) {
        wiersze = wiersze.map((w) =>
          wybory[w.symbol] ? { ...w, zachowaj: wybory[w.symbol] } : w
        );
      }

      let raport;
      try {
        raport = przeliczImport(wiersze);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }

      // PODGLĄD kończy się tutaj: policzył, niczego nie zapisał.
      if (body.zastosuj !== true) return raport;

      const s = sesjaZadania();
      const w = autoryzuj(s!.user, "masowa_lokalizacja");
      if (!w.ok) return reply.code(403).send({ error: w.powod });

      const autor = autorOperacji(req);
      zastosujImport(raport, { nazwa: autor.nazwa, ref: autor.ref });
      return raport;
    }
  );
}
