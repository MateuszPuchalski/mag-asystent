import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { wierszCsv, zbudujCsv } from "../services/csv.js";
import { logEvent } from "../services/events.js";
import { bladReguly, regulyStrefy, zapiszReguly } from "../services/strefa-zlota.js";
import {
  importujZbiorki,
  kandydaciStrefy,
  zresetujKandydatow,
  type RaportKandydatow,
} from "../services/zbiorki.js";

/* ── Zbiórki i strefa złota — trasy biura ────────────────────────────────────
   Import CSV z systemu sprzedażowego, ranking kandydatów do strefy złotej
   i edycja reguł strefy. Wszystko za bramką ról biuro|admin: import podmienia
   dane, z których liczą się adnotacje na kartach CAŁEJ kartoteki, a reguły
   strefy orzekają o magazynie — to nie są operacje z hali.

   Import jest zwykłym POST-em z JSON-em `{ csv }` ŚWIADOMIE: dziś woła go
   formularz w /biuro, docelowo integracja z Sellasist — i ma go wołać tym
   samym żądaniem, bez zmian po naszej stronie. Multipart dałby formularzowi
   wygodę, a integracji zależność.                                            */

const ORZEKAJACY = ["biuro", "admin"];

/** Plik właściciela ma 6 MB przy 5 dniach — 32 MB starcza na kwartał. */
const LIMIT_IMPORTU = 32 * 1024 * 1024;

export async function zbiorkiRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Import zbiórek i strefa złota są dostępne dla biura" };
    }
    return null;
  }

  app.post<{ Body: { csv?: string } }>(
    "/api/biuro/zbiorki/import",
    { bodyLimit: LIMIT_IMPORTU },
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      if (typeof req.body?.csv !== "string" || req.body.csv.trim() === "") {
        return reply.code(400).send({ error: "Body musi zawierać pole csv z treścią pliku" });
      }
      try {
        const wynik = importujZbiorki(req.body.csv);
        const s = sesjaZadania();
        logEvent("zbiorki_import", s?.user.name ?? "?", null, {
          wierszy: wynik.wierszy,
          nowych: wynik.nowych,
          niedopasowanych: wynik.niedopasowanych,
          okres: wynik.okres,
        });
        return wynik;
      } catch (e) {
        // zły plik (brak kolumn, <50% dopasowań) to decyzja wołającego, nie awaria
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  app.get("/api/biuro/zbiorki/kandydaci", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return kandydaciStrefy();
  });

  app.get("/api/biuro/zbiorki/kandydaci/csv", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="wertis-strefa-kandydaci.csv"')
      .send(csvKandydatow(kandydaciStrefy()));
  });

  /** Reguły w formie edytora: poziomy jako tekst „2,3", nie tablica. */
  app.get("/api/biuro/strefa", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return {
      reguly: regulyStrefy().map((r) => ({
        alejka: r.alejka ?? "",
        od: r.od ?? "",
        do: r.do ?? "",
        poziomy: r.poziomy.join(","),
      })),
    };
  });

  app.put<{ Body: { reguly?: Array<{ alejka?: string; od?: string; do?: string; poziomy?: string }> } }>(
    "/api/biuro/strefa",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const reguly = req.body?.reguly;
      if (!Array.isArray(reguly) || reguly.length === 0) {
        return reply.code(400).send({ error: "Podaj co najmniej jedną regułę strefy" });
      }
      for (let i = 0; i < reguly.length; i++) {
        const blad = bladReguly(reguly[i]);
        if (blad) return reply.code(400).send({ error: `Reguła ${i + 1}: ${blad}` });
      }
      zapiszReguly(reguly.map((r) => ({ ...r, poziomy: r.poziomy ?? "" })));
      /* Zmiana reguł zmienia, kto jest „już w strefie" — ranking liczy się od
         nowa. Woła to trasa, nie `zapiszReguly`: services/strefa-zlota nie może
         importować services/zbiorki, bo zależność biegnie w drugą stronę. */
      zresetujKandydatow();
      const s = sesjaZadania();
      logEvent("strefa_zapis", s?.user.name ?? "?", null, { regul: reguly.length });
      return { ok: true, regul: reguly.length };
    }
  );
}

/** Eksport dla biura: separator `;`, BOM — otwiera się w Excelu (services/csv.ts). */
export function csvKandydatow(r: RaportKandydatow): string {
  const SEP = ";" as const;
  const w = (pola: unknown[]) => wierszCsv(pola, SEP);
  const linie: string[] = [];
  linie.push(
    r.okno
      ? `# WERTIS kandydaci do strefy zlotej · dane ${r.okno.od} do ${r.okno.do} (${r.okno.dni} dni) · prog ${r.prog} zbiorek`
      : "# WERTIS kandydaci do strefy zlotej · brak danych zbiorek",
    "",
    w(["symbol", "nazwa", "zbiorki", "zbiorki na dzien", "obecny adres", "dokad (poziomy strefy)"])
  );
  for (const k of r.kandydaci) {
    linie.push(w([k.sym, k.nazwa, k.zbiorki, k.zbiorekNaDzien, k.adres ?? "", k.poziomy]));
  }
  return zbudujCsv(linie);
}
