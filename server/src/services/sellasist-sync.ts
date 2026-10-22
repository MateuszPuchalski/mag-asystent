import type { DatabaseSync } from "node:sqlite";
import {
  BladSellasist, mapujDziennik, mapujListeZamowien, mapujListyPrzewozowe, mapujWpisyZamowien, mapujZamowienie,
  sciezkaDziennika, sciezkaPrzesylek, sciezkaWpisowZamowien, sciezkaZamowienia, sciezkaZamowienPoNumerze, STRONA,
  zapytajSellasist, type WpisZamowienia, type ZamowienieSellasist, type ZapytanieSellasist,
} from "../adapters/sellasist.http.js";
import { BladLimitu } from "../adapters/limit.js";
import { config } from "../config.js";
import { chwilaUtc, dataLokalna, dodajDni, stempelLokalny } from "../czas.js";
import { db as defaultDb, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { zgloszonychWDobach } from "./pomylki.js";
import { dopiszZbiorki, type WierszZbiorki } from "./zbiorki.js";

/* ── Lustro zamówień Sellasist ───────────────────────────────────────────────
   Trzy odczyty potrzebują stanu zamówienia z Sellasist: „czy wyjdzie dziś"
   (status i braki), zbiórki do strefy złotej (koszyk i dzień zebrania)
   i liczba spakowanych paczek na dzień (pierwsza etykieta). Żaden z nich nie
   ma prawa pytać Sellasist przy otwarciu ekranu albo przy szkicu dla
   każdej rozmowy, więc pyta ticker, a odczyty czytają lustro.

   DZIENNIK, NIE LISTA. `GET /orders` filtruje po dacie ZŁOŻENIA, a nam
   potrzebna jest ZMIANA: status, etykieta, edycja koszyka. Webhooków nie ma.
   `GET /orders_logs` z kursorem daje dokładnie zmienione zamówienia. Szczegół
   pobieramy partiami z kolejki, żeby kursor nigdy nie czekał na limit.

   „ZEBRANE" TO USTAWIENIE. Statusy definiuje firma w swoim Sellasist, więc
   kod ich nie zgaduje (`SELLASIST_STATUSY_ZEBRANE`). Bez ustawienia dniem
   zbiórki jest dzień pierwszej etykiety: paczkę pakuje się zwykle tego dnia,
   którego się ją zbiera.

   CZYTAMY, NIE PISZEMY. Ten plik niczego w Sellasist nie zmienia. Jedyny
   zapis do Sellasist to notatka człowieka (`sellasist-notatki.ts`).        */

/** Szczegółów na przebieg. Każdy to dwa żądania, a limit Sellasist jest nieznany. */
export const NA_PRZEBIEG = 30;
/** Stron dziennika na przebieg; reszta poczeka, kursor stoi na ostatnim wpisie. */
export const STRON_DZIENNIKA = 10;
/** Pierwszy przebieg patrzy dwa dni wstecz: tyle trwa zwykle zamówienie w toku. */
export const START_WSTECZ_MS = 2 * 24 * 60 * 60_000;
/** Po tylu nieudanych próbach szczegół wypada z kolejki; następna zmiana go wróci. */
export const MAX_PROB = 5;

export interface SellasistDeps {
  query?: ZapytanieSellasist;
  teraz?: () => Date;
  statusyZebrane?: readonly number[];
  statusyPomylka?: readonly number[];
}

type Wiersz = Record<string, unknown>;
const tekst = (v: unknown): string | null => (v == null || String(v) === "" ? null : String(v));

/* ── Zapis szczegółu ────────────────────────────────────────────────────── */

/**
 * Daty etykiet, których jeszcze nie znamy. Szczegół zamówienia nie ma daty
 * etykiety, ma ją tylko lista przewozowa. Pytamy wyłącznie o etykietę bez
 * daty, która na tej liście stoi (`naLiscie`), więc zamówienie bez zmian
 * etykiet i etykieta z nowego serwisu wysyłek kosztują jedno żądanie.
 */
async function datyEtykiet(
  database: DatabaseSync, z: ZamowienieSellasist, query: ZapytanieSellasist,
): Promise<Map<string, string | null>> {
  const znane = new Map((database.prepare(`SELECT waybill, utworzono_at FROM sellasist_przesylka
      WHERE zamowienie_id = ?`).all(z.id) as Wiersz[]).map((w) => [String(w.waybill), tekst(w.utworzono_at)]));
  if (!z.przesylki.some((p) => p.naLiscie && !znane.get(p.waybill))) return znane;
  for (const l of mapujListyPrzewozowe(await query(sciezkaPrzesylek(z.id)))) {
    if (l.utworzonoAt) znane.set(l.waybill, l.utworzonoAt);
  }
  return znane;
}

/**
 * Wcześniejsza z dwóch dat, a pusta nigdy nie wygrywa. Etykieta bez daty
 * dostaje chwilę odczytu, więc data listu, która dojdzie później, ma prawo
 * ją cofnąć. Późniejsza już nie: paczka spakowana we wtorek nie staje się
 * środową, gdy ktoś w środę wydrukuje nową etykietę.
 */
const WCZESNIEJSZA = (k: string) => `CASE WHEN sellasist_zamowienie.${k} IS NULL THEN excluded.${k}
  WHEN excluded.${k} IS NULL THEN sellasist_zamowienie.${k}
  WHEN julianday(excluded.${k}) < julianday(sellasist_zamowienie.${k}) THEN excluded.${k}
  ELSE sellasist_zamowienie.${k} END`;

/**
 * Szczegół do lustra, w jednej transakcji. Daty zebrania i spakowania nie
 * znikają, gdy etykieta zniknie (`WCZESNIEJSZA`).
 */
function zapiszZamowienie(
  database: DatabaseSync, z: ZamowienieSellasist, daty: Map<string, string | null>,
  zebranoZDziennika: string | null, statusyZebrane: readonly number[], teraz: Date,
): void {
  const at = teraz.toISOString();
  const dniEtykiet = z.przesylki.map((p) => daty.get(p.waybill) ?? null);
  /* Etykieta bez daty listu (lista przewozowa jej nie oddała) to etykieta
     z tej chwili albo wcześniejsza. Bierzemy chwilę odczytu: dzień rzadko
     się myli, a bez tego paczka nie liczyłaby się nigdy. */
  const pierwszaEtykieta = z.przesylki.length
    ? dniEtykiet.map((d) => d ?? at).reduce((a, b) => (chwilaUtc(a) <= chwilaUtc(b) ? a : b))
    : null;
  const zebranoStatusem = z.statusId !== null && statusyZebrane.includes(z.statusId) ? z.statusAt ?? at : null;
  transaction(database, () => {
    database.prepare(`INSERT INTO sellasist_zamowienie(id, external_id, kupujacy_login, zrodlo, status_id,
        status_nazwa, status_at, dostawa, termin, utworzono_at, skopiowane_z, zebrano_at, spakowano_at, pobrano_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET external_id = excluded.external_id, kupujacy_login = excluded.kupujacy_login,
        zrodlo = excluded.zrodlo, status_id = excluded.status_id, status_nazwa = excluded.status_nazwa,
        status_at = excluded.status_at, dostawa = excluded.dostawa, termin = excluded.termin,
        utworzono_at = excluded.utworzono_at,
        skopiowane_z = excluded.skopiowane_z,
        zebrano_at = ${WCZESNIEJSZA("zebrano_at")}, spakowano_at = ${WCZESNIEJSZA("spakowano_at")},
        pobrano_at = excluded.pobrano_at`)
      .run(z.id, z.externalId, z.login, z.zrodlo, z.statusId, z.statusNazwa, z.statusAt, z.dostawa, z.termin,
        z.utworzonoAt,
        z.skopiowaneZ, zebranoZDziennika ?? zebranoStatusem ?? pierwszaEtykieta, pierwszaEtykieta, at);
    database.prepare("DELETE FROM sellasist_pozycja WHERE zamowienie_id = ?").run(z.id);
    const poz = database.prepare(`INSERT OR REPLACE INTO sellasist_pozycja(koszyk_id, zamowienie_id, symbol, ean,
        nazwa, ilosc, brakuje) VALUES (?,?,?,?,?,?,?)`);
    for (const p of z.pozycje) poz.run(p.koszykId, z.id, p.symbol, p.ean, p.nazwa, p.ilosc, p.brakuje);
    database.prepare("DELETE FROM sellasist_przesylka WHERE zamowienie_id = ?").run(z.id);
    const prz = database.prepare(`INSERT INTO sellasist_przesylka(zamowienie_id, waybill, usluga, przewoznik,
        utworzono_at) VALUES (?,?,?,?,?)`);
    for (const p of z.przesylki) prz.run(z.id, p.waybill, p.usluga, p.przewoznik, daty.get(p.waybill) ?? null);
  })();
}

/** Szczegół jednego zamówienia do lustra. `false`: Sellasist go nie zna (skasowane). */
async function pobierzDoLustra(
  database: DatabaseSync, id: number, query: ZapytanieSellasist, zebranoZDziennika: string | null,
  statusyZebrane: readonly number[], teraz: Date,
): Promise<boolean> {
  const surowe = await query(sciezkaZamowienia(id));
  if (surowe === null) {
    /* Dzieci jawnie: kaskada działa tylko przy włączonych kluczach obcych. */
    transaction(database, () => {
      for (const t of ["sellasist_pozycja", "sellasist_przesylka"]) {
        database.prepare(`DELETE FROM ${t} WHERE zamowienie_id = ?`).run(id);
      }
      database.prepare("DELETE FROM sellasist_zamowienie WHERE id = ?").run(id);
    })();
    return false;
  }
  const z = mapujZamowienie(surowe);
  if (!z) throw new BladSellasist("Sellasist oddał zamówienie bez numeru.", null);
  zapiszZamowienie(database, z, await datyEtykiet(database, z, query), zebranoZDziennika, statusyZebrane, teraz);
  return true;
}

/* ── Zbiórki z lustra ───────────────────────────────────────────────────── */

/**
 * Pozycje zebranych zamówień, których `zbiorka` jeszcze nie ma. Dzień to doba
 * magazynu (`zbiorka.data` jest lokalna, jak w pliku). Pozycje z zerową
 * ilością odpadają: to wiersze koszyka, których nikt nie zbierał.
 */
export function przeniesZbiorki(database: DatabaseSync): number {
  const wiersze = (database.prepare(`SELECT p.koszyk_id, p.symbol, p.ean, p.ilosc, z.zebrano_at
      FROM sellasist_pozycja p JOIN sellasist_zamowienie z ON z.id = p.zamowienie_id
     WHERE z.zebrano_at IS NOT NULL AND p.ilosc > 0
       AND NOT EXISTS (SELECT 1 FROM zbiorka b WHERE b.koszyk_id = p.koszyk_id)`).all() as Wiersz[])
    .map((w): WierszZbiorki => ({
      koszykId: Number(w.koszyk_id), symbol: tekst(w.symbol) ?? "", ean: tekst(w.ean) ?? "",
      data: dataLokalna(String(w.zebrano_at)), ilosc: Number(w.ilosc),
    }));
  return transaction(database, () => dopiszZbiorki(database, wiersze))();
}

/* ── Przebieg ───────────────────────────────────────────────────────────── */

function stanSync(database: DatabaseSync): Wiersz {
  database.prepare("INSERT OR IGNORE INTO sellasist_sync_state(id) VALUES (1)").run();
  return database.prepare("SELECT * FROM sellasist_sync_state WHERE id = 1").get() as Wiersz;
}

/**
 * Dziennik od kursora do kolejki. Kursor stoi na (dacie, numerze) ostatniego
 * wpisu: `date_from` łapie też wpisy z tej samej sekundy, więc numer odsiewa
 * te, które już były. Strona niepełna kończy dziennik na ten przebieg.
 *
 * Wejście w status z `SELLASIST_STATUSY_POMYLKA` to pomyłka zbierania
 * złapana przy pakowaniu. Liczy się każde wejście, także drugie w tym samym
 * zamówieniu: to druga pomyłka, a nie powtórka. Kluczem jest numer wpisu.
 */
async function czytajDziennik(
  database: DatabaseSync, query: ZapytanieSellasist, statusyZebrane: readonly number[],
  statusyPomylka: readonly number[], teraz: Date,
): Promise<number> {
  const s = stanSync(database);
  const kursorAt = tekst(s.kursor_at) ?? new Date(teraz.getTime() - START_WSTECZ_MS).toISOString();
  /* Liczenie pomyłek rusza od kursora z chwili włączenia klucza, bo dziennik
     sprzed niego przeczytano bez klucza i drugi raz go nie czytamy. Pusty
     klucz kasuje start, żeby przerwa nie udawała dób bez pomyłek. */
  database.prepare(`UPDATE sellasist_sync_state SET pomylki_od_at = CASE WHEN ?1 THEN COALESCE(pomylki_od_at, ?2)
      ELSE NULL END WHERE id = 1`).run(statusyPomylka.length > 0 ? 1 : 0, kursorAt);
  let kursor = { at: kursorAt, id: Number(s.kursor_id ?? 0) };
  let zmian = 0;
  for (let strona = 0; strona < STRON_DZIENNIKA; strona++) {
    const surowe = await query(sciezkaDziennika(stempelLokalny(kursorAt), strona * STRONA));
    const wpisy = mapujDziennik(surowe);
    transaction(database, () => {
      const kolejka = database.prepare(`INSERT INTO sellasist_do_pobrania(zamowienie_id, od, zebrano_at)
          VALUES (?,?,?) ON CONFLICT(zamowienie_id) DO UPDATE SET
          zebrano_at = COALESCE(sellasist_do_pobrania.zebrano_at, excluded.zebrano_at)`);
      const pomylka = database.prepare(`INSERT OR IGNORE INTO sellasist_pomylka_zlapana(log_id, zamowienie_id, at)
          VALUES (?,?,?)`);
      for (const w of wpisy) {
        const at = w.at ?? kursor.at;
        if (at === kursor.at && w.id <= kursor.id) continue;
        /* Wpis „sprzed kursora" bywa tylko w godzinie cofnięcia zegara
           (stempel bez strefy jest wtedy dwuznaczny). Odpada, a zamówienie
           wraca do lustra przy swojej następnej zmianie. */
        if (chwilaUtc(at) < chwilaUtc(kursor.at)) continue;
        const zebrane = w.tag === "order_status_change" && w.obiekt !== null && statusyZebrane.includes(w.obiekt);
        kolejka.run(w.zamowienieId, teraz.toISOString(), zebrane ? at : null);
        if (w.tag === "order_status_change" && w.obiekt !== null && statusyPomylka.includes(w.obiekt)) {
          pomylka.run(w.id, w.zamowienieId, at);
        }
        kursor = { at, id: w.id };
        zmian++;
      }
      database.prepare("UPDATE sellasist_sync_state SET kursor_at = ?, kursor_id = ? WHERE id = 1")
        .run(kursor.at, kursor.id);
    })();
    if (wpisy.length < STRONA) break;
  }
  return zmian;
}

/** Zamówień z pomyłką na jedno pytanie o zbierającego. Przy złych dniach kilka przebiegów nadrobi resztę. */
export const ZBIERAJACYCH_NA_PRZEBIEG = 10;

/**
 * Kto zbierał pomyłkę złapaną przy pakowaniu: autor OSTATNIEGO wejścia
 * w status zebranego przed wejściem w status pomyłki. Ostatniego, bo po
 * „ponownej kompletacji" zbiera kto inny. Porządek po numerze wpisu, bo
 * stempel Sellasist ma tylko sekundy, a numery rosną z czasem.
 *
 * Pyta dziennik samych tych zamówień, bez daty: zebranie bywa sprzed okna
 * strumienia, a stare pomyłki bez osoby nadrabiają się tą samą drogą. Bez
 * ustawionych statusów „zebrane" nie pyta wcale, bo nie wie, czego szukać.
 * Wpis bez znalezionego zebrania dostaje datę sprawdzenia i więcej nie wraca.
 *
 * Ten sam odczyt zbiera loginy pracowników z wpisów WMS. Pomyłka, której
 * zbierający nie ma jeszcze loginu, wraca raz po niego (`login_szukano_at`):
 * tak nadrabiają się pomyłki ustalone, zanim czytaliśmy loginy.
 */
async function ustalZbierajacych(
  database: DatabaseSync, query: ZapytanieSellasist, statusyZebrane: readonly number[], teraz: Date,
): Promise<number> {
  if (statusyZebrane.length === 0) return 0;
  const czekajace = database.prepare(`SELECT log_id, zamowienie_id, zbieral_sprawdzono_at IS NULL AS bez_osoby
      FROM sellasist_pomylka_zlapana
      WHERE zbieral_sprawdzono_at IS NULL
         OR (login_szukano_at IS NULL AND zbieral_sellasist_id IS NOT NULL
             AND zbieral_sellasist_id NOT IN (SELECT sellasist_id FROM sellasist_pracownik_login))
      ORDER BY bez_osoby DESC, at DESC, log_id DESC`).all() as Wiersz[];
  const ids = [...new Set(czekajace.map((w) => Number(w.zamowienie_id)))].slice(0, ZBIERAJACYCH_NA_PRZEBIEG);
  if (ids.length === 0) return 0;
  const wpisy: WpisZamowienia[] = [];
  for (let strona = 0; strona < STRON_DZIENNIKA; strona++) {
    const porcja = mapujWpisyZamowien(await query(sciezkaWpisowZamowien(ids, strona * STRONA)));
    wpisy.push(...porcja);
    if (porcja.length < STRONA) break;
  }
  const at = teraz.toISOString();
  transaction(database, () => {
    const login = database.prepare(`INSERT INTO sellasist_pracownik_login(sellasist_id, login, widziano_at)
        VALUES (?,?,?) ON CONFLICT(sellasist_id) DO UPDATE SET login = excluded.login, widziano_at = excluded.widziano_at`);
    for (const w of wpisy) if (w.pracownik !== null && w.login !== null) login.run(w.pracownik, w.login, at);
    const ustaw = database.prepare(`UPDATE sellasist_pomylka_zlapana
        SET zbieral_sellasist_id = ?, zbieral_sprawdzono_at = ?, login_szukano_at = ? WHERE log_id = ?`);
    const szukano = database.prepare("UPDATE sellasist_pomylka_zlapana SET login_szukano_at = ? WHERE log_id = ?");
    for (const p of czekajace) {
      const zamowienie = Number(p.zamowienie_id);
      if (!ids.includes(zamowienie)) continue;
      const logId = Number(p.log_id);
      if (Number(p.bez_osoby) !== 1) { szukano.run(at, logId); continue; }
      let zebral: WpisZamowienia | null = null;
      for (const z of wpisy) {
        if (z.zamowienieId !== zamowienie || z.id >= logId || z.status === null) continue;
        if (statusyZebrane.includes(z.status) && (zebral === null || z.id > zebral.id)) zebral = z;
      }
      ustaw.run(zebral?.pracownik ?? null, at, at, logId);
    }
  })();
  return ids.length;
}

/**
 * Jeden przebieg tickera. Woła go `main()` przez `uruchomTakt`, nigdy
 * `buildApp()`. 429 idzie wyżej, żeby takt odczekał `Retry-After`. Inny błąd
 * szczegółu zabiera tylko to zamówienie: wraca do kolejki z licznikiem prób.
 */
export async function synchronizujSellasist(
  database: DatabaseSync = defaultDb(), deps: SellasistDeps = {},
): Promise<{ zmian: number; pobranych: number; zbiorek: number }> {
  const query = deps.query ?? zapytajSellasist;
  const teraz = (deps.teraz ?? (() => new Date()))();
  const statusyZebrane = deps.statusyZebrane ?? config.sellasist.statusyZebrane;
  const statusyPomylka = deps.statusyPomylka ?? config.sellasist.statusyPomylka;
  stanSync(database);
  database.prepare("UPDATE sellasist_sync_state SET last_attempt_at = ? WHERE id = 1").run(teraz.toISOString());
  try {
    const zmian = await czytajDziennik(database, query, statusyZebrane, statusyPomylka, teraz);
    let pobranych = 0;
    const kolejka = database.prepare(`SELECT zamowienie_id, zebrano_at FROM sellasist_do_pobrania
        ORDER BY od, zamowienie_id LIMIT ?`).all(NA_PRZEBIEG) as Wiersz[];
    for (const k of kolejka) {
      const id = Number(k.zamowienie_id);
      try {
        await pobierzDoLustra(database, id, query, tekst(k.zebrano_at), statusyZebrane, teraz);
        database.prepare("DELETE FROM sellasist_do_pobrania WHERE zamowienie_id = ?").run(id);
        pobranych++;
      } catch (e) {
        if (e instanceof BladLimitu) throw e;
        database.prepare(`UPDATE sellasist_do_pobrania SET proby = proby + 1, od = ? WHERE zamowienie_id = ?`)
          .run(teraz.toISOString(), id);
        database.prepare("DELETE FROM sellasist_do_pobrania WHERE zamowienie_id = ? AND proby >= ?").run(id, MAX_PROB);
        console.warn(`[sellasist] zamówienie ${id}: ${e instanceof BladSellasist ? e.message : "nie do odczytu"}`);
      }
    }
    /* Zbierający to dodatek do liczby złapanych: jego błąd nie zatrzymuje
       przebiegu, a wpis czeka do następnego. 429 idzie wyżej jak wszędzie. */
    try {
      await ustalZbierajacych(database, query, statusyZebrane, teraz);
    } catch (e) {
      if (e instanceof BladLimitu) throw e;
      console.warn(`[sellasist] kto zbierał: ${e instanceof BladSellasist ? e.message : "dziennik nie do odczytu"}`);
    }
    const zbiorek = przeniesZbiorki(database);
    /* Wpis tylko przy nowych zbiórkach: to one zmieniają ranking strefy
       złotej, jak import pliku (`zbiorki_import`). Lustro to księgowość
       odczytu, a nie zdarzenie biura. */
    if (zbiorek) logEvent("zbiorki_z_sellasist", "automat", null, { nowych: zbiorek }, undefined, database);
    database.prepare(`UPDATE sellasist_sync_state SET last_success_at = ?1,
        pierwszy_sukces_at = COALESCE(pierwszy_sukces_at, ?1), blad = NULL, blad_kod = NULL
        WHERE id = 1`).run(teraz.toISOString());
    return { zmian, pobranych, zbiorek };
  } catch (e) {
    const kod = e instanceof BladLimitu ? 429 : e instanceof BladSellasist ? e.kod : null;
    const zdanie = e instanceof BladSellasist || e instanceof BladLimitu ? e.message : "Przebieg Sellasist nieudany.";
    database.prepare("UPDATE sellasist_sync_state SET blad = ?, blad_kod = ? WHERE id = 1").run(zdanie, kod);
    throw e;
  }
}

/**
 * Odświeżenie zamówień jednego numeru źródła, na żądanie — dla szkicu, gdy
 * klient pyta o zamówienie starsze niż lustro albo lustro jest nieświeże.
 * DEGRADUJE: błąd Sellasist zostawia lustro, jakie było, i oddaje `false`.
 */
export async function odswiezZamowienieSellasist(
  database: DatabaseSync, externalId: string, deps: SellasistDeps = {},
): Promise<boolean> {
  const query = deps.query ?? zapytajSellasist;
  const teraz = (deps.teraz ?? (() => new Date()))();
  const statusyZebrane = deps.statusyZebrane ?? config.sellasist.statusyZebrane;
  try {
    const ids = mapujListeZamowien(await query(sciezkaZamowienPoNumerze(externalId))).slice(0, 3);
    for (const z of ids) await pobierzDoLustra(database, z.id, query, null, statusyZebrane, teraz);
    return true;
  } catch (e) {
    if (!(e instanceof BladSellasist) && !(e instanceof BladLimitu)) throw e;
    return false;
  }
}

/* ── Stan dla panelu ────────────────────────────────────────────────────── */

export interface DzienSellasist { data: string; zebranych: number; spakowanych: number }

export interface StanSellasist {
  wlaczony: boolean;
  ostatniaProbaAt: string | null;
  ostatniSukcesAt: string | null;
  blad: string | null;
  wKolejce: number;
  /**
   * Ostatnie siedem dób magazynu, od najstarszej; zamówienia, nie pozycje.
   * Tylko doby od pierwszego udanego przebiegu: doba sprzed lustra miałaby
   * zero, które znaczy „nie wiemy", a czyta się jak „nic nie wyszło".
   */
  dni: DzienSellasist[];
}

/** Stan lustra — CZYSTY ODCZYT, bez pytania Sellasist. */
export function stanSellasist(database: DatabaseSync, wlaczony: boolean, teraz = new Date()): StanSellasist {
  const s = database.prepare("SELECT * FROM sellasist_sync_state WHERE id = 1").get() as Wiersz | undefined;
  const dzis = dataLokalna(teraz.toISOString());
  const pierwszy = tekst(s?.pierwszy_sukces_at);
  const dni = pierwszy === null ? []
    : Array.from({ length: 7 }, (_, i) => dodajDni(dzis, i - 6)).filter((d) => d >= dataLokalna(pierwszy));
  const licznik = new Map(dni.map((d) => [d, { data: d, zebranych: 0, spakowanych: 0 }]));
  const od = new Date(teraz.getTime() - 8 * 24 * 60 * 60_000).toISOString();
  for (const w of database.prepare(`SELECT zebrano_at, spakowano_at FROM sellasist_zamowienie
      WHERE zebrano_at >= ?1 OR spakowano_at >= ?1`).all(od) as Wiersz[]) {
    const z = tekst(w.zebrano_at);
    const p = tekst(w.spakowano_at);
    if (z) { const d = licznik.get(dataLokalna(z)); if (d) d.zebranych++; }
    if (p) { const d = licznik.get(dataLokalna(p)); if (d) d.spakowanych++; }
  }
  return {
    wlaczony,
    ostatniaProbaAt: tekst(s?.last_attempt_at),
    ostatniSukcesAt: tekst(s?.last_success_at),
    blad: tekst(s?.blad),
    wKolejce: Number((database.prepare("SELECT COUNT(*) AS n FROM sellasist_do_pobrania").get() as Wiersz).n),
    dni: [...licznik.values()],
  };
}

/* ── Pomyłki złapane przy pakowaniu ─────────────────────────────────────── */

/** Zła wartość albo nieznane konto — trasa oddaje 400 ze zdaniem. */
export class BladPracownika extends Error {
  constructor(message: string) { super(message); this.name = "BladPracownika"; }
}

/**
 * Numer pracownika Sellasist jako osoba z naszych kont, albo zdjęcie
 * przypisania (`userId: null`). Imię kopiujemy z kartoteki, bo konto bywa
 * kasowane, a zestawienie ma dalej mówić imieniem.
 */
export function przypiszPracownikaSellasist(
  sellasistId: unknown, userId: unknown, autor: { id: number; name: string },
  database: DatabaseSync = defaultDb(), teraz = new Date(),
): void {
  if (!Number.isInteger(sellasistId) || Number(sellasistId) <= 0) {
    throw new BladPracownika("Pole „sellasistId” musi być dodatnią liczbą całkowitą");
  }
  const sid = Number(sellasistId);
  if (userId === null) {
    database.prepare("DELETE FROM sellasist_pracownik WHERE sellasist_id = ?").run(sid);
  } else {
    if (!Number.isInteger(userId)) throw new BladPracownika("Pole „userId” musi być liczbą całkowitą albo null");
    const u = database.prepare("SELECT name FROM app_user WHERE user_id = ?").get(Number(userId)) as Wiersz | undefined;
    if (!u) throw new BladPracownika("Nie ma takiego pracownika");
    database.prepare(`INSERT INTO sellasist_pracownik(sellasist_id, user_id, nazwa, zmieniono_at) VALUES (?,?,?,?)
        ON CONFLICT(sellasist_id) DO UPDATE SET user_id = excluded.user_id, nazwa = excluded.nazwa,
        zmieniono_at = excluded.zmieniono_at`).run(sid, Number(userId), String(u.name), teraz.toISOString());
  }
  logEvent("sellasist_pracownik_przypisany", autor.name, null, { sellasistId: sid, userId: userId ?? null },
    autor.id, database);
}

/** Ile ostatnich dób pokazuje zakładka „Pomyłki". Dwa tygodnie to dwa cykle pracy. */
export const DNI_ZLAPANYCH = 14;

export interface ZlapanePomylki {
  /** `false`: Sellasist wyłączony, lustro zatrzymane albo status pomyłki nieustawiony. */
  wlaczone: boolean;
  /**
   * Pełne doby magazynu od najstarszej i bieżąca. Pusta lista znaczy „brak
   * danych", nie zero — ta sama zasada co w Strefie.
   */
  dni: Array<{ data: string; zlapanych: number }>;
  /** Suma z `dni`; `null` przy pustej liście. */
  razem: number | null;
  /**
   * Pomyłki z rejestru zgłoszone w tych samych dobach, czyli te, które
   * pakowanie przepuściło do klienta; `null` przy pustej liście.
   */
  doKlienta: number | null;
  /**
   * Kto zbierał złapane z tych samych dób, najczęstsi pierwsi.
   * `nazwa: null` = numer Sellasist, którego admin jeszcze nie przypisał osobie.
   */
  osoby: OsobaZlapanych[];
  /** Złapane z tych dób bez ustalonej osoby: jeszcze nie pytane albo bez zebrania w dzienniku. */
  bezOsoby: number | null;
}

export interface OsobaZlapanych {
  sellasistId: number;
  userId: number | null;
  /** Imię z przypisania admina; `null` = numer bez przypisania. */
  nazwa: string | null;
  /** Login z wpisu WMS w dzienniku Sellasist; `null` = jeszcze nie wyczytany. */
  login: string | null;
  zlapanych: number;
}

/**
 * Pomyłki złapane przy pakowaniu na dobę — CZYSTY ODCZYT, bez pytania Sellasist.
 *
 * Doba wchodzi, gdy lustro przeczytało ją całą z ustawionym kluczem. Doba
 * włączenia klucza jest niepełna, więc liczy się od następnej. Doba ostatniego
 * udanego przebiegu jest pełna tylko wtedy, gdy to dziś: lustro, które stanęło,
 * nie dopisuje zer za doby, których nie czytało.
 *
 * Rejestr liczy się po dniu zgłoszenia, a złapane po dniu pakowania. Obie
 * miary to dzień wykrycia, więc przy stałym ruchu okno porównuje podobne
 * paczki, choć zgłoszenie przychodzi kilka dni po wysyłce.
 */
export function zlapanePomylki(database: DatabaseSync, wlaczone: boolean, teraz = new Date()): ZlapanePomylki {
  const pusto = { wlaczone, dni: [], razem: null, doKlienta: null, osoby: [], bezOsoby: null };
  if (!wlaczone) return pusto;
  const s = database.prepare("SELECT pomylki_od_at, last_success_at FROM sellasist_sync_state WHERE id = 1").get() as
    Wiersz | undefined;
  const odAt = tekst(s?.pomylki_od_at);
  const ostatniAt = tekst(s?.last_success_at);
  if (odAt === null || ostatniAt === null) return pusto;
  const dzis = dataLokalna(teraz.toISOString());
  const ostatni = dataLokalna(ostatniAt);
  const koniec = ostatni === dzis ? dzis : dodajDni(ostatni, -1);
  const doby = Array.from({ length: DNI_ZLAPANYCH }, (_, i) => dodajDni(dzis, i - (DNI_ZLAPANYCH - 1)))
    .filter((d) => d > dataLokalna(odAt) && d <= koniec);
  if (doby.length === 0) return pusto;
  const licznik = new Map(doby.map((d) => [d, 0]));
  const osoby = new Map<number, OsobaZlapanych>();
  let bezOsoby = 0;
  const od = new Date(teraz.getTime() - (DNI_ZLAPANYCH + 1) * 24 * 60 * 60_000).toISOString();
  for (const w of database.prepare(`SELECT z.at, z.zbieral_sellasist_id AS sid, p.user_id, p.nazwa, l.login
      FROM sellasist_pomylka_zlapana z LEFT JOIN sellasist_pracownik p ON p.sellasist_id = z.zbieral_sellasist_id
      LEFT JOIN sellasist_pracownik_login l ON l.sellasist_id = z.zbieral_sellasist_id
      WHERE z.at >= ?`).all(od) as Wiersz[]) {
    const d = dataLokalna(String(w.at));
    if (!licznik.has(d)) continue;
    licznik.set(d, licznik.get(d)! + 1);
    if (w.sid == null) { bezOsoby++; continue; }
    const sid = Number(w.sid);
    const o = osoby.get(sid) ?? { sellasistId: sid, userId: w.user_id == null ? null : Number(w.user_id),
      nazwa: tekst(w.nazwa), login: tekst(w.login), zlapanych: 0 };
    o.zlapanych++;
    osoby.set(sid, o);
  }
  const dni = doby.map((data) => ({ data, zlapanych: licznik.get(data)! }));
  return {
    wlaczone, dni, razem: dni.reduce((a, d) => a + d.zlapanych, 0),
    doKlienta: zgloszonychWDobach(doby[0], doby[doby.length - 1], database),
    osoby: [...osoby.values()].sort((a, b) => b.zlapanych - a.zlapanych || a.sellasistId - b.sellasistId),
    bezOsoby,
  };
}
