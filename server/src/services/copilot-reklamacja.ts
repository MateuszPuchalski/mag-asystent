import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { kosztUsd, type Tokeny } from "./copilot-koszt.js";
import { zamaskujWatek, type TrescBezpieczna, type WiadomoscWatku } from "./copilot-maskowanie.js";

/* ── Copilot reklamacyjny: ZBIERA DANE, nie radzi (0.275.0) ──────────────────

   Zgłoszenie właściciela z 11 września: „zintegruj z copilotem, wersja do
   reklamacji zbierająca dane". Słowo „zbierająca" jest tu całym projektem.

   CZEGO TEN MODUŁ NIE ROBI I NIGDY NIE BĘDZIE ROBIŁ: nie podpowiada werdyktu.
   Uznanie i odrzucenie są nieodwracalne wobec kupującego, stoją za
   `autoryzuj()` i za jawną zgodą — a zdanie „ta reklamacja wygląda na
   zasadną" przesuwałoby decyzję, nie pomagając jej podjąć. Model, który
   napisze cokolwiek z tej rodziny słów, dostaje odmowę od DETERMINISTYCZNEJ
   bramki niżej, nie od promptu. Prompt jest prośbą; bramka jest regułą.

   Co robi: czyta rozmowę, która bywa długa i wielojęzyczna, i wyciąga z niej
   cztery rzeczy, których agent szuka za każdym razem ręcznie — co się zepsuło,
   kiedy, czego klient chce i czego BRAKUJE, żeby dało się rozstrzygnąć.
   Ostatnia pozycja jest najcenniejsza: sprawa stoi tygodniami nie dlatego, że
   nikt nie umie zdecydować, tylko dlatego, że nikt nie zapytał o zdjęcie
   tabliczki.

   KAŻDE ZDANIE MA CYTAT. Model dostaje rozmowę ponumerowaną (`W1`, `W2`, …)
   i przy każdym polu ma podać numer wiadomości, z której to wziął. Serwer
   sprawdza numery przed zapisem: pole z numerem, którego nie ma, znika.
   To ta sama doktryna, co przy szkicu (§14.6) — model pisze prozę wyłącznie
   z materiału, a sprawdza go kod, nie dobra wola.

   MASKOWANIE PILNUJE KOMPILATOR. Nadawca przyjmuje wyłącznie `TrescBezpieczna`,
   więc „zapomniałem zamaskować" jest błędem kompilacji, a nie pomyłką do
   wyłapania w przeglądzie.                                                  */

/** Pole karty razem z cytatem — numer wiadomości, z której pochodzi. */
export interface PoleKarty { tresc: string; zrodlo: string }

export interface KartaSprawy {
  /** Co jest zepsute, słowami klienta. */
  usterka: PoleKarty | null;
  /** Od kiedy — data zakupu, moment awarii, „po tygodniu". */
  kiedy: PoleKarty | null;
  /** Czego klient chce: naprawa, wymiana, zwrot pieniędzy. */
  oczekiwanie: PoleKarty | null;
  /** Co klient już przysłał: zdjęcia, paragon, opis prób. */
  dowody: PoleKarty[];
  /** Czego BRAKUJE, żeby dało się rozstrzygnąć. Najcenniejsza pozycja. */
  brakuje: string[];
}

export interface OdpowiedzRozpoznania extends KartaSprawy {
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

/** Wysyłka do dostawcy — wstrzykiwana, jak `NadawcaKlasyfikacji`. */
export type NadawcaRozpoznania = (tresc: TrescBezpieczna) => Promise<OdpowiedzRozpoznania>;

/**
 * Słowa werdyktu. Karta, w której padnie którekolwiek, jest ODRZUCANA w całości.
 *
 * Lista jest krótka i celowo nie próbuje być kompletna — nie da się wyliczyć
 * wszystkich sposobów, na jakie da się zasugerować decyzję. Łapie przypadek
 * typowy, czyli model, który „pomaga" wnioskiem; reszta zostaje przy
 * człowieku, bo to on klika przycisk z jawną zgodą.
 */
const SLOWA_WERDYKTU = [
  "uzna", "odrzu", "zasadn", "niezasadn", "bezpodstawn", "przyzna", "odmów", "odmow",
  "rekomend", "proponuj", "radzę", "powinieneś", "należy uznać",
];

/** Czy tekst niesie sugestię rozstrzygnięcia. */
export function sugerujeWerdykt(tekst: string): boolean {
  const t = tekst.toLowerCase();
  return SLOWA_WERDYKTU.some((s) => t.includes(s));
}

/** Rozmowa ponumerowana dla modelu i zbiór numerów do sprawdzenia cytatów. */
export function ponumerujRozmowe(
  wiadomosci: Array<{ odKlienta: boolean; tresc: string }>,
): { watek: WiadomoscWatku[]; numery: Set<string> } {
  const numery = new Set<string>();
  const watek = wiadomosci.map((w, i) => {
    const numer = `W${i + 1}`;
    numery.add(numer);
    return { odKlienta: w.odKlienta, tresc: `[${numer}] ${w.tresc}` };
  });
  return { watek, numery };
}

/**
 * Odsianie pól bez pokrycia w rozmowie.
 *
 * Pole z numerem, którego w rozmowie nie ma, ZNIKA — nie unieważnia całej
 * karty. To jest różnica wobec szkicu, gdzie wymyślony numer kasuje wszystko:
 * tam liczba wchodzi do zdania wysyłanego kupującemu, tutaj karta jest notatką
 * dla agenta, który ma rozmowę przed oczami. Odsiane pola idą do audytu, żeby
 * dało się zmierzyć, jak często model zmyśla.
 */
export function odsiejBezPokrycia(
  karta: KartaSprawy, numery: Set<string>,
): { karta: KartaSprawy; odsiano: number } {
  let odsiano = 0;
  const pole = (p: PoleKarty | null): PoleKarty | null => {
    if (!p) return null;
    if (numery.has(p.zrodlo)) return p;
    odsiano += 1;
    return null;
  };
  const dowody = karta.dowody.filter((d) => {
    if (numery.has(d.zrodlo)) return true;
    odsiano += 1;
    return false;
  });
  return {
    karta: {
      usterka: pole(karta.usterka),
      kiedy: pole(karta.kiedy),
      oczekiwanie: pole(karta.oczekiwanie),
      dowody,
      /* `brakuje` NIE MA cytatu z natury rzeczy: mówi o tym, czego w rozmowie
         NIE MA. Sprawdza je bramka słów werdyktu, nie bramka numerów. */
      brakuje: karta.brakuje,
    },
    odsiano,
  };
}

/** Czy z karty cokolwiek zostało — pusta nie ma po co trafiać na ekran. */
export function pustaKarta(k: KartaSprawy): boolean {
  return !k.usterka && !k.kiedy && !k.oczekiwanie && k.dowody.length === 0
    && k.brakuje.length === 0;
}

export interface ZadanieRozpoznania {
  reklamacjaId: number;
  kto: { id: number; name: string };
  nadaj: NadawcaRozpoznania;
  database?: DatabaseSync;
  now?: () => Date;
}

/**
 * Rozpoznanie jednej sprawy: rozmowa → karta faktów.
 *
 * Sieć stoi POZA transakcją, jak wszędzie w tym module. Wywołanie zapisuje się
 * w księdze Copilota niezależnie od wyniku — próba, która nie doszła, też bywa
 * płatna, a brak wiersza gubiłby tę część rachunku.
 */
export async function rozpoznajSprawe(z: ZadanieRozpoznania): Promise<KartaSprawy> {
  const database = z.database ?? db();
  const teraz = (z.now ?? (() => new Date()))();

  const sprawa = database.prepare(
    "SELECT id, kupujacy_login FROM reklamacja_klienta WHERE id=?").get(z.reklamacjaId) as
    { id: number; kupujacy_login: string | null } | undefined;
  if (!sprawa) throw new Error("Nie znaleziono reklamacji");

  const wiersze = database.prepare(
    `SELECT autor_rola, tresc FROM reklamacja_wiadomosc
      WHERE reklamacja_id=? ORDER BY utworzono_at IS NULL, utworzono_at, id`)
    .all(z.reklamacjaId) as Array<{ autor_rola: string | null; tresc: string }>;
  if (wiersze.length === 0) throw new Error("Ta sprawa nie ma jeszcze rozmowy do rozpoznania");

  /* „Nie nasze" znaczy klienta ALBO doradcy Allegro — ta sama reguła, co przy
     kontroli świeżości. Rozmowa bywa trójstronna i zdanie doradcy niesie
     fakty tak samo jak zdanie kupującego. */
  const { watek, numery } = ponumerujRozmowe(wiersze.map((w) => ({
    odKlienta: (w.autor_rola ?? "") !== "SELLER",
    tresc: w.tresc,
  })));

  const tresc = zamaskujWatek(watek, sprawa.kupujacy_login);

  let odp: OdpowiedzRozpoznania;
  try {
    odp = await z.nadaj(tresc);
  } catch (e) {
    zapiszWywolanie(database, z.reklamacjaId, null, "blad",
      (e as Error).message, z.kto, teraz);
    throw e;
  }

  /* BRAMKA WERDYKTU stoi PRZED zapisem i obejmuje całą kartę naraz: model,
     który podpowiada rozstrzygnięcie w jednym polu, podpowiada je w tej
     karcie, a nie w tym polu. */
  const caly = JSON.stringify(odp);
  if (sugerujeWerdykt(caly)) {
    zapiszWywolanie(database, z.reklamacjaId, odp, "blad", "sugestia werdyktu", z.kto, teraz);
    throw new Error(
      "Copilot próbował podpowiedzieć rozstrzygnięcie — karta odrzucona. " +
      "Werdykt wydaje człowiek, a maszyna zbiera fakty.");
  }

  const { karta, odsiano } = odsiejBezPokrycia(odp, numery);
  if (pustaKarta(karta)) {
    zapiszWywolanie(database, z.reklamacjaId, odp, "blad", "karta bez pokrycia", z.kto, teraz);
    throw new Error("Copilot nie znalazł w tej rozmowie niczego, co dałoby się zacytować");
  }

  transaction(database, () => {
    database.prepare(`INSERT INTO reklamacja_karta
      (reklamacja_id, usterka, usterka_zrodlo, kiedy, kiedy_zrodlo,
       oczekiwanie, oczekiwanie_zrodlo, dowody, brakuje, model, przez, przez_user_id, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(reklamacja_id) DO UPDATE SET
        usterka=excluded.usterka, usterka_zrodlo=excluded.usterka_zrodlo,
        kiedy=excluded.kiedy, kiedy_zrodlo=excluded.kiedy_zrodlo,
        oczekiwanie=excluded.oczekiwanie, oczekiwanie_zrodlo=excluded.oczekiwanie_zrodlo,
        dowody=excluded.dowody, brakuje=excluded.brakuje, model=excluded.model,
        przez=excluded.przez, przez_user_id=excluded.przez_user_id, at=excluded.at`).run(
      z.reklamacjaId,
      karta.usterka?.tresc ?? null, karta.usterka?.zrodlo ?? null,
      karta.kiedy?.tresc ?? null, karta.kiedy?.zrodlo ?? null,
      karta.oczekiwanie?.tresc ?? null, karta.oczekiwanie?.zrodlo ?? null,
      JSON.stringify(karta.dowody), JSON.stringify(karta.brakuje),
      odp.model, z.kto.name, z.kto.id, teraz.toISOString());

    zapiszWywolanie(database, z.reklamacjaId, odp, "ok", null, z.kto, teraz);

    /* Do dziennika idą LICZBY, nigdy treść karty: `events` nie ma retencji,
       a karta niesie słowa klienta. */
    logEvent("reklamacja_rozpoznanie", z.kto.name, null,
      { id: z.reklamacjaId, brakuje: karta.brakuje.length, dowody: karta.dowody.length, odsiano },
      z.kto.id, database);
  })();

  return karta;
}

/** Karta zapisana przy sprawie; `null`, gdy nikt jeszcze nie prosił. */
export function kartaSprawy(database: DatabaseSync, reklamacjaId: number): (KartaSprawy & {
  model: string; przez: string | null; at: string;
}) | null {
  const w = database.prepare("SELECT * FROM reklamacja_karta WHERE reklamacja_id=?")
    .get(reklamacjaId) as Record<string, unknown> | undefined;
  if (!w) return null;
  const pole = (t: unknown, z: unknown): PoleKarty | null =>
    t == null ? null : { tresc: String(t), zrodlo: String(z ?? "") };
  const lista = <T>(v: unknown): T[] => {
    try { return JSON.parse(String(v ?? "[]")) as T[]; } catch { return []; }
  };
  return {
    usterka: pole(w.usterka, w.usterka_zrodlo),
    kiedy: pole(w.kiedy, w.kiedy_zrodlo),
    oczekiwanie: pole(w.oczekiwanie, w.oczekiwanie_zrodlo),
    dowody: lista<PoleKarty>(w.dowody),
    brakuje: lista<string>(w.brakuje),
    model: String(w.model ?? ""),
    przez: w.przez == null ? null : String(w.przez),
    at: String(w.at ?? ""),
  };
}

function zapiszWywolanie(
  database: DatabaseSync, reklamacjaId: number, odp: OdpowiedzRozpoznania | null,
  wynik: "ok" | "blad", blad: string | null, kto: { id: number }, teraz: Date,
): void {
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,reklamacja_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES ('rozpoznanie_reklamacji',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(reklamacjaId, odp?.model ?? "", odp?.zuzycie.wej ?? 0, odp?.zuzycie.wyj ?? 0,
      odp?.zuzycie.cacheZapis ?? 0, odp?.zuzycie.cacheOdczyt ?? 0, odp?.ms ?? null,
      wynik, blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}

/** Koszt jednego rozpoznania — do paska na ekranie ustawień. */
export const kosztRozpoznania = (model: string, t: Tokeny): number => kosztUsd(model, t);
