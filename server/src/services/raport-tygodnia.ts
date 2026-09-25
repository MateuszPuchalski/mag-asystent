import { db as defaultDb, type Db } from "../db/db.js";
import { dataLokalna, dodajDni, polnocLokalna, tydzienIso } from "../czas.js";
import { logEvent } from "./events.js";
import { PRACA, bezDubli, mediana, p95 } from "./raporty.js";
import { czasOdpowiedzi } from "./czas-odpowiedzi.js";
import { kosztUsd } from "./copilot-koszt.js";
import { migawki, zrobMigawke, type WpisMigawki } from "./migawka-dnia.js";

/* ── Raport tygodnia (@wydanie) ──────────────────────────────────────────────
   Zgłoszenie właściciela: „co śledzić automatycznie i dodać automatyczne
   raporty tygodniowe". Analiza liczyła wszystko, ale zawsze „ostatnie N dni
   od teraz" i tylko wtedy, gdy ktoś ją otworzył. Tydzień do tygodnia nie dało
   się porównać, a stanu — ile czekało DO DECYZJI — nikt nie zapisywał wcale.

   GRANICE STAŁE: poniedziałek 00:00 do poniedziałku 00:00 czasu magazynu.
   Liczy go automat w pierwszym takcie po zamknięciu tygodnia. Nikt nie musi
   pamiętać, żeby go zrobić, i nikt nie może go zrobić „za wcześnie".

   RAPORT JEST ZAMROŻONY. Liczby zapisuje się raz, a ekran tylko je czyta.
   Dwa powody. Rozmowa sprzed `ALLEGRO_INBOX_OD` znika przy starcie serwera,
   więc tydzień policzony na nowo po pół roku miałby mniej wiadomości niż
   naprawdę. Poprawka reguły liczenia nie przepisuje po cichu omówionych już
   tygodni — `WERSJA_RAPORTU` mówi, którą regułą policzono który.

   ŹRÓDŁEM SĄ TE SAME REGUŁY CO W ANALIZIE: `PRACA` i `bezDubli` dla pracy
   hali, `probkiRozmowy` przez `czasOdpowiedzi` dla obsługi, `kosztUsd` dla
   Copilota. Druga kopia którejkolwiek rozjechałaby raport z ekranem, na
   który biuro patrzy na co dzień.

   ŻADNYCH LUDZI. Raport per osoba jest monitoringiem pracowniczym (Kodeks
   pracy art. 22², podstawa przy `raportWydajnosci`) i od 0.431.0 czyta go
   wyłącznie administrator, na żywo. Raport zapisywany co tydzień i czytany
   przez całe biuro byłby jego trwałą kopią, dostępną szerzej. Ludzi nie ma
   tu z zasady, nie z przeoczenia.

   ZERO ZAPISU PRZY PATRZENIU. Raport i migawkę zapisuje takt w `main()`,
   trasa tylko czyta. Otwarcie tygodnia, którego nie policzono, pokazuje
   brak, a nie liczy go w locie.                                            */

/** Podbij przy każdej zmianie reguły liczenia albo kształtu `RaportTygodnia`. */
export const WERSJA_RAPORTU = 1;

/* Tyle tygodni wstecz automat nadrabia po przerwie. Cztery, bo miesiąc to
   najdłuższa przerwa, po której porównanie z poprzednim tygodniem jeszcze
   komuś się przyda. Dalej wstecz raporty nie powstają — to nie archiwum. */
export const ZALEGLE_TYGODNIE = 4;

/** Takt automatu: co godzinę, jak przebieg nocny — rozrzut daje `uruchomTakt`. */
export const TAKT_RAPORTOW_MS = 60 * 60 * 1000;

export interface RaportTygodnia {
  wersja: number;
  tydzien: string;
  od: string;
  do: string;
  /** Siedem dat lokalnych, od poniedziałku. */
  dni: string[];
  magazyn: {
    /** Wykonane pozycje — `PRACA` bez dubli, jak w Analizie. */
    pozycje: number;
    pozycjeWgDnia: number[];
    dostawZamknietych: number;
    medianaMinutDostawy: number | null;
    problemyZgloszone: number;
    problemyRozwiazane: number;
    /** Wejścia ręczne, niezgodności i zgłoszenia na pozycję — cel < 0,3 (plan §10). */
    dotknieciaNaPozycje: number | null;
    p95SkanuMs: number | null;
    /** Regały wpisywane z ręki — kandydaci do przedruku etykiety. */
    etykietyDoPrzedruku: Array<{ kod: string; reczne: number }>;
    /** Czego szukano i nie znaleziono — kandydaci do kartoteki albo aliasu. */
    szukaniaBezWynikow: Array<{ q: string; ile: number }>;
    upadkiKolektorow: number;
    odrzuconeOperacje: number;
  };
  obsluga: {
    wiadomosciOdKlientow: number;
    odpowiedzi: number;
    medianaMin: number | null;
    p90Min: number | null;
    /** Stan w chwili zamknięcia tygodnia, nie w chwili liczenia raportu. */
    klientCzekaNaKoniec: { n: number; najdluzejMin: number | null };
    zwrotyNowe: number;
    zwrotyZamkniete: number;
    reklamacjeNowe: number;
    reklamacjeRozstrzygniete: number;
  };
  copilot: { wywolan: number; bledow: number; kosztUsd: number };
  system: {
    /** Ile nocy z siedmiu zostawiło kopię bazy. */
    kopieNocne: number;
    /** Ostatnia rekoncyliacja tygodnia; `null`, gdy żadna nie przeszła. */
    rozjazdyRekoncyliacji: number | null;
    zapisyNieudane: number;
    odrzuconeZadaniaHttp: number;
  };
  /** Migawki od poniedziałku do następnego poniedziałku włącznie — ta ostatnia
      to stan na zamknięcie tygodnia, jeśli serwer chodził o północy. */
  migawki: WpisMigawki[];
}

export interface NaglowekRaportu {
  tydzien: string;
  od: string;
  do: string;
  wersja: number;
  utworzono: string;
}

/* `events.created_at` ma zawsze kształt `strftime('%Y-%m-%dT%H:%M:%fZ')`, więc
   granice ISO porównują się tekstowo i trafiają w indeks `ix_events_time`.
   Pozostałe tabele niosą znaczniki z Allegro, z milisekundami albo bez
   nich — tam porównanie idzie przez `julianday`, bo tabele są małe,
   a tekstowe „…00Z" kontra „…00.000Z" myli się właśnie na granicy. */
const W_OKNIE_ZDARZEN = "created_at >= ? AND created_at < ?";
const wOknie = (kolumna: string) =>
  `julianday(${kolumna}) >= julianday(?) AND julianday(${kolumna}) < julianday(?)`;

function ile(database: Db, sql: string, ...arg: Array<string | number>): number {
  return (database.prepare(sql).get(...arg) as { n: number | null }).n ?? 0;
}

function ileZdarzen(database: Db, od: string, doChwili: string, ...typy: string[]): number {
  return ile(database, `SELECT COUNT(*) AS n FROM events WHERE ${W_OKNIE_ZDARZEN}
      AND type IN (${typy.map(() => "?").join(",")})`, od, doChwili, ...typy);
}

/** Raport tygodnia zaczętego w poniedziałek `poniedzialek` (data lokalna). */
export function zbudujRaport(poniedzialek: string, database: Db = defaultDb()): RaportTygodnia {
  const { tydzien } = tydzienIso(poniedzialek);
  const od = polnocLokalna(poniedzialek);
  const doChwili = polnocLokalna(dodajDni(poniedzialek, 7));
  const dni = Array.from({ length: 7 }, (_, i) => dodajDni(poniedzialek, i));

  // ── magazyn: z dziennika, tą samą regułą co Analiza ─────────────────────
  const praca = database.prepare(`SELECT created_at FROM events WHERE ${W_OKNIE_ZDARZEN}
      AND type IN (${PRACA.map(() => "?").join(",")}) AND ${bezDubli("")}`)
    .all(od, doChwili, ...PRACA) as Array<{ created_at: string }>;
  /* Dzień po czasie LOKALNYM, nie `date(created_at)` — lekcja 0.31.1
     przy `analiza()`: wieczorna zmiana należy do swojej doby, nie do UTC. */
  const pozycjeWgDnia = dni.map(() => 0);
  for (const z of praca) {
    const i = dni.indexOf(dataLokalna(z.created_at));
    if (i >= 0) pozycjeWgDnia[i]++;
  }
  const dotkniecia = ileZdarzen(database, od, doChwili, "manual_entry", "location_mismatch", "problem_raised");

  const zamkniete = database.prepare(`SELECT opened_at, closed_at FROM delivery
      WHERE status = 'done' AND ${wOknie("closed_at")}`)
    .all(od, doChwili) as Array<{ opened_at: string; closed_at: string }>;
  const minutyDostaw = zamkniete
    .map((r) => (Date.parse(r.closed_at) - Date.parse(r.opened_at)) / 60_000)
    .filter((m) => Number.isFinite(m) && m >= 0);
  const medianaDostaw = mediana(minutyDostaw);

  const czasySkanu = (database.prepare(`SELECT json_extract(payload,'$.ms') AS ms FROM events
      WHERE type = 'scan_timing' AND ${W_OKNIE_ZDARZEN} AND json_valid(payload)`)
    .all(od, doChwili) as Array<{ ms: unknown }>)
    .map((r) => r.ms).filter((v): v is number => typeof v === "number");

  /* `json_valid` przed `json_extract` — uszkodzony payload wywala całe
     zapytanie (blizna opisana przy `zrodloZdarzenia` w raporty.ts). */
  const etykiety = database.prepare(`SELECT json_extract(payload,'$.code') AS kod, COUNT(*) AS reczne
      FROM events WHERE type = 'manual_entry' AND ${W_OKNIE_ZDARZEN} AND json_valid(payload)
        AND json_extract(payload,'$.kind') = 'LOC' AND json_extract(payload,'$.code') IS NOT NULL
      GROUP BY kod ORDER BY reczne DESC, kod LIMIT 5`)
    .all(od, doChwili) as Array<{ kod: string; reczne: number }>;
  const bezWynikow = database.prepare(`SELECT lower(json_extract(payload,'$.q')) AS q, COUNT(*) AS ile
      FROM events WHERE type = 'search' AND ${W_OKNIE_ZDARZEN} AND json_valid(payload)
        AND json_extract(payload,'$.wynikow') = 0 AND json_extract(payload,'$.q') IS NOT NULL
      GROUP BY q ORDER BY ile DESC, q LIMIT 5`)
    .all(od, doChwili) as Array<{ q: string; ile: number }>;

  // ── obsługa klienta ─────────────────────────────────────────────────────
  /* `czasOdpowiedzi` z `teraz` na końcu tygodnia i oknem równym jego długości
     w dniach. Tydzień ze zmianą czasu ma 167 albo 169 godzin, więc okno jest
     ułamkiem doby, a nie okrągłą siódemką — inaczej zjadłoby godzinę
     sąsiedniego tygodnia. */
  const dlugoscDni = (Date.parse(doChwili) - Date.parse(od)) / 86_400_000;
  const czas = czasOdpowiedzi(dlugoscDni, false, database, Date.parse(doChwili));

  // ── Copilot: koszt z tych samych stawek co pomiar ───────────────────────
  const wywolania = database.prepare(`SELECT model, wynik, tokeny_wej, tokeny_wyj,
      tokeny_cache_zapis, tokeny_cache_odczyt FROM copilot_wywolanie WHERE ${wOknie("at")}`)
    .all(od, doChwili) as Array<{ model: string; wynik: string; tokeny_wej: number;
      tokeny_wyj: number; tokeny_cache_zapis: number; tokeny_cache_odczyt: number }>;
  const koszt = wywolania.reduce((s, w) => s + kosztUsd(w.model, {
    wej: w.tokeny_wej, wyj: w.tokeny_wyj, cacheZapis: w.tokeny_cache_zapis, cacheOdczyt: w.tokeny_cache_odczyt,
  }), 0);

  // ── system ──────────────────────────────────────────────────────────────
  const rekoncyliacja = database.prepare(`SELECT json_extract(payload,'$.rozjazdow') AS n FROM events
      WHERE type = 'rekoncyliacja' AND ${W_OKNIE_ZDARZEN} AND json_valid(payload)
      ORDER BY created_at DESC LIMIT 1`).get(od, doChwili) as { n: number | null } | undefined;

  return {
    wersja: WERSJA_RAPORTU,
    tydzien, od, do: doChwili, dni,
    magazyn: {
      pozycje: praca.length,
      pozycjeWgDnia,
      dostawZamknietych: zamkniete.length,
      medianaMinutDostawy: medianaDostaw == null ? null : Math.round(medianaDostaw),
      problemyZgloszone: ile(database, `SELECT COUNT(*) AS n FROM problem WHERE ${wOknie("created_at")}`, od, doChwili),
      problemyRozwiazane: ile(database, `SELECT COUNT(*) AS n FROM problem WHERE ${wOknie("resolved_at")}`, od, doChwili),
      dotknieciaNaPozycje: praca.length > 0 ? Number((dotkniecia / praca.length).toFixed(2)) : null,
      p95SkanuMs: p95(czasySkanu),
      etykietyDoPrzedruku: etykiety,
      szukaniaBezWynikow: bezWynikow,
      upadkiKolektorow: ileZdarzen(database, od, doChwili, "device_drop"),
      odrzuconeOperacje: ileZdarzen(database, od, doChwili, "klient_odrzucona"),
    },
    obsluga: {
      wiadomosciOdKlientow: ile(database, `SELECT COUNT(*) AS n FROM message
          WHERE direction = 'incoming' AND ${wOknie("sent_at")}`, od, doChwili),
      odpowiedzi: czas.ogolem.n,
      medianaMin: czas.ogolem.medianaMin,
      p90Min: czas.ogolem.p90Min,
      klientCzekaNaKoniec: czas.czekaTeraz,
      zwrotyNowe: ile(database, `SELECT COUNT(*) AS n FROM zwrot_klienta WHERE ${wOknie("created_at")}`, od, doChwili),
      zwrotyZamkniete: ile(database, `SELECT COUNT(*) AS n FROM zwrot_klienta WHERE ${wOknie("zamkniety_at")}`, od, doChwili),
      reklamacjeNowe: ile(database, `SELECT COUNT(*) AS n FROM reklamacja_klienta WHERE ${wOknie("otwarto_at")}`, od, doChwili),
      reklamacjeRozstrzygniete: ile(database, `SELECT COUNT(*) AS n FROM reklamacja_klienta WHERE ${wOknie("werdykt_at")}`, od, doChwili),
    },
    copilot: {
      wywolan: wywolania.length,
      bledow: wywolania.filter((w) => w.wynik === "blad").length,
      kosztUsd: Number(koszt.toFixed(2)),
    },
    system: {
      kopieNocne: ileZdarzen(database, od, doChwili, "kopia_bazy"),
      rozjazdyRekoncyliacji: typeof rekoncyliacja?.n === "number" ? rekoncyliacja.n : null,
      zapisyNieudane: ileZdarzen(database, od, doChwili, "queue_failed"),
      odrzuconeZadaniaHttp: ileZdarzen(database, od, doChwili, "http_rejected"),
    },
    migawki: migawki(poniedzialek, dodajDni(poniedzialek, 7), database),
  };
}

/** Zapis raportu — `false`, gdy ten tydzień już stoi (pierwszy wygrywa). */
function zapisz(r: RaportTygodnia, database: Db, teraz: number): boolean {
  const wynik = database.prepare(`INSERT OR IGNORE INTO raport_tygodnia(tydzien, od, do, wersja, utworzono, dane)
      VALUES (?,?,?,?,?,?)`)
    .run(r.tydzien, r.od, r.do, r.wersja, new Date(teraz).toISOString(), JSON.stringify(r));
  if (Number(wynik.changes) === 0) return false;
  logEvent("raport_tygodnia", "system", null, { tydzien: r.tydzien, wersja: r.wersja }, null, database);
  return true;
}

/**
 * Takt automatu: migawka doby, potem zaległe raporty tygodni.
 *
 * Tydzień powstaje tylko wtedy, gdy dziennik sięga PRZED jego początek.
 * Świeża instalacja w środę nie dostaje raportu „tygodnia" z trzech dni,
 * bo porównany z pełnym następnym wyglądałby na załamanie pracy.
 */
export function przebiegRaportow(
  database: Db = defaultDb(), teraz = Date.now(),
): { migawka: string | null; raporty: string[] } {
  let migawka: string | null = null;
  try {
    migawka = zrobMigawke(database, teraz)?.data ?? null;
  } catch (e) {
    /* Migawka, która padła, nie zabiera raportu tygodnia — i odwrotnie,
       ta sama zasada co kopia i rekoncyliacja w przebiegu nocnym. */
    console.error(`[raporty] migawka nieudana: ${e instanceof Error ? e.message : e}`);
  }

  const raporty: string[] = [];
  const pierwsze = (database.prepare("SELECT MIN(created_at) AS t FROM events")
    .get() as { t: string | null }).t;
  if (!pierwsze) return { migawka, raporty };
  const { poniedzialek } = tydzienIso(dataLokalna(new Date(teraz).toISOString()));
  for (let i = ZALEGLE_TYGODNIE; i >= 1; i--) {
    const pon = dodajDni(poniedzialek, -7 * i);
    const { tydzien } = tydzienIso(pon);
    if (database.prepare("SELECT 1 FROM raport_tygodnia WHERE tydzien = ?").get(tydzien)) continue;
    if (pierwsze >= polnocLokalna(pon)) continue;
    try {
      if (zapisz(zbudujRaport(pon, database), database, teraz)) raporty.push(tydzien);
    } catch (e) {
      console.error(`[raporty] tydzień ${tydzien} nieudany: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { migawka, raporty };
}

/** Lista raportów, najnowszy pierwszy — rok wstecz wystarcza ekranowi. */
export function listaRaportow(database: Db = defaultDb(), limit = 53): NaglowekRaportu[] {
  return database.prepare(`SELECT tydzien, od, do, wersja, utworzono FROM raport_tygodnia
      ORDER BY od DESC LIMIT ?`).all(limit) as unknown as NaglowekRaportu[];
}

/**
 * Raport tygodnia razem z poprzednim — ekran liczy z nich różnice.
 * `null`, gdy tygodnia nie policzono. Poprzedni bywa `null` (pierwszy tydzień).
 */
export function raportTygodnia(
  tydzien: string, database: Db = defaultDb(),
): { raport: RaportTygodnia; poprzedni: RaportTygodnia | null } | null {
  const czytaj = (warunek: string, arg: string) => {
    const r = database.prepare(`SELECT dane FROM raport_tygodnia WHERE ${warunek}`)
      .get(arg) as { dane: string } | undefined;
    return r ? JSON.parse(r.dane) as RaportTygodnia : null;
  };
  const raport = czytaj("tydzien = ?", tydzien);
  if (!raport) return null;
  /* Poprzedni po GRANICY, nie po etykiecie: tydzień przed 2027-W01 to
     2026-W53, a arytmetyka na numerze tygodnia by go nie znalazła. */
  return { raport, poprzedni: czytaj("do = ?", raport.od) };
}
