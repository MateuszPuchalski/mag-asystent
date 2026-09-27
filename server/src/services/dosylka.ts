import type { DatabaseSync } from "node:sqlite";
import { urlPrzesylekZamowienia, zapytajAllegro } from "../adapters/allegro.http.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { config } from "../config.js";
import { chwilaUtc } from "../czas.js";
import { db as defaultDb, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { odpytajTracking, type StanPrzesylki } from "./allegro-tracking.js";
import {
  DNI_KROKU_DOSYLKI, jestKodemDosylki, OKNO_SLEDZENIA_MS, poDniachRoboczych, type KodDosylki,
} from "./dosylka-opis.js";
import {
  BladSprawy, KonfliktSprawy, loginZAllegro, odciskTeraz, potwierdzPoZapisie, sprawaKlienta,
  sprawdzSwiezosc, wierszSprawy, wyrownajZnane, zapiszKrokSprawy, type SprawaKlienta,
} from "./prowadzenie-klienta.js";

/* ── Dosyłka ze śledzeniem (0.536.0, drugi przyrost S6) ─────────────────────
   Fakty właściciela z 27 września 2026: zły towar wraca zwrotem przez
   Allegro, biuro na ekranie zwrotu odmawia wypłaty kodem „Wysłaliśmy nowy
   towar” (`NEW_ITEM_SENT`), drukuje etykietę w Sellasist i wysyła poprawny
   towar na ten sam adres. Krok „dosłać” był dotąd samym zdaniem, a to, czy
   paczka doszła, sprawdzał człowiek w Allegro.

   START W TYM SAMYM RUCHU CO ODMOWA, nie propozycją na profilu. Agent
   odmawia na ekranie zwrotu i tam kończy; propozycja na profilu byłaby
   drugim kliknięciem w drugim miejscu, o którym łatwo zapomnieć. Trasa
   odmowy składa dwa serwisy: `odmowZwrotuPieniedzy`, potem ten plik.
   Propozycja na profilu zostaje wyłącznie drogą ponowienia i kodów
   zsynchronizowanych z Allegro.

   KIERUNEK IMPORTÓW JEST JEDEN. Ten plik importuje sprawę klienta
   i tracking; `prowadzenie-klienta.ts`, `zwrot-pieniedzy.ts`,
   `droga-klienta.ts` i `profil-klienta.ts` nie importują tego pliku —
   czytają `klient_dosylka` własnym SQL-em i zdaniem z `dosylka-opis.ts`.
   Pętla importów przy stałej liczonej w chwili ładowania bywa pustym
   zbiorem (blizna w `statusy-spraw.ts`).

   NUMER WYKRYWA AUTOMAT, WPISANY JEST DROGĄ ZAPASOWĄ. Właściciel podał, że
   numer dosyłki stoi zwykle przy tym samym zamówieniu w Allegro — to jest
   niesprawdzone (`[WERYFIKUJ]` w `docs/allegro-ksztalt.md`), więc reguła
   wykrycia woli nie zgadnąć niż zgadnąć źle (`wybierzNumer`).

   DO DZIENNIKA IDZIE NUMER SPRAWY. Nigdy numer przesyłki, login ani treść
   kroku: `events` nie ma retencji, a numer przesyłki prowadzi do adresu
   odbiorcy. Zdania błędów są STAŁE — trasa oddaje je w 400 albo w wyniku
   odmowy, a treść odpowiedzi Allegro bywa czymkolwiek. */

type Wiersz = Record<string, unknown>;
type Autor = { id: number; name: string };

/** Krok stawiany przez odmowę. Sellasist w nawiasie mówi, GDZIE jest ruch. */
export const KROK_DOSYLKI: Record<KodDosylki, string> = {
  NEW_ITEM_SENT: "Dosłać nowy towar (etykieta w Sellasist)",
  MISSING_PART_SENT: "Dosłać brakującą część (etykieta w Sellasist)",
};

/** `maxLength: 64` przy `waybill` w schemacie `CheckoutFormAddWaybillCreated`. */
export const LIMIT_NUMERU = 64;

/**
 * Rytm tickera: piętnaście minut. Dosyłka jedzie dniami, a „doręczona”
 * godzinę później nie zmienia niczyjej pracy. Częściej znaczyłoby tylko
 * więcej żądań na tym samym adresie IP, a to kosztowało już blokadę
 * (nagłówek `services/takt.ts`).
 */
export const ODSTEP_DOSYLEK_MS = 15 * 60_000;

/**
 * Jak długo wykrycie numeru czeka po pustej odpowiedzi. Etykieta z Sellasist
 * trafia do Allegro w ciągu godzin, nie minut, więc pytanie o każdą dosyłkę
 * bez numeru co kwadrans kosztowałoby dwa razy więcej za nic.
 */
export const PRZERWA_WYKRYCIA_MS = 30 * 60_000;

export type WynikDosylki =
  | { zalozona: true; login: string; krokDo: string; zastapil: string | null }
  | { zalozona: false; blad: string };

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const problem = (status: unknown): boolean => status === "ISSUE" || status === "RETURNED";

/* ── Założenie ──────────────────────────────────────────────────────────── */

interface ZwrotDosylki { id: number; zamowienie: string; konto: number; login: string; kod: KodDosylki }

/**
 * Zwrot, z którego rodzi się dosyłka. Zamówienie i konto wynikają ZE ZWROTU,
 * nie z ciała żądania: numer zamówienia jest unikalny tylko na koncie
 * sprzedawcy, a zgadnięte konto przypięłoby dosyłkę do cudzej paczki.
 * Kod bierze się najpierw z NASZEJ odmowy, potem z tej zsynchronizowanej.
 */
function zwrotDoDosylki(database: DatabaseSync, zwrotId: number, login: string | null = null): ZwrotDosylki {
  const z = database.prepare(`SELECT id, order_id, channel_account_id, kupujacy_login, odmowa_kod, rejection_code
      FROM zwrot_klienta WHERE id = ?`).get(zwrotId) as Wiersz | undefined;
  if (!z) throw new BladSprawy("Nie znaleziono zwrotu");
  const kod = jestKodemDosylki(z.odmowa_kod) ? z.odmowa_kod
    : jestKodemDosylki(z.rejection_code) ? z.rejection_code : null;
  if (!kod) throw new BladSprawy("Zwrot nie ma odmowy wypłaty z kodem dosyłki");
  const zamowienie = tekst(z.order_id);
  if (!zamowienie) throw new BladSprawy("Zwrot nie ma numeru zamówienia, więc dosyłki nie ma do czego przypiąć");
  const kupujacy = tekst(z.kupujacy_login);
  if (!kupujacy) throw new BladSprawy("Zwrot nie ma loginu kupującego");
  if (login !== null && !(database.prepare("SELECT ? = ? COLLATE NOCASE AS t").get(kupujacy, login) as Wiersz).t) {
    throw new BladSprawy("Zwrot nie należy do tego klienta");
  }
  return { id: Number(z.id), zamowienie, konto: Number(z.channel_account_id), login: kupujacy, kod };
}

/**
 * Nowa dosyłka zamówienia. Istniejąca do tego samego zamówienia jest
 * ZASTĘPOWANA razem ze stanem śledzenia: druga odmowa z kodem dosyłki
 * znaczy, że pierwsza dosyłka też nie była tym, czego klient chciał.
 * Oddaje, czy zabrany wiersz był doręczony albo miał kłopot — licznik
 * odcisku musi to wiedzieć (`wyrownajZnane`).
 */
function zapiszDosylke(
  database: DatabaseSync, sprawa: number, z: ZwrotDosylki, teraz: Date,
): { k: number; q: number } {
  const stary = database.prepare(`SELECT dostarczono_at, status FROM klient_dosylka
      WHERE sprawa_id = ? AND zamowienie = ?`).get(sprawa, z.zamowienie) as Wiersz | undefined;
  database.prepare(`INSERT INTO klient_dosylka(sprawa_id, konto, zamowienie, zwrot_id, zalozono_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(sprawa_id, zamowienie) DO UPDATE SET konto = excluded.konto, zwrot_id = excluded.zwrot_id,
        waybill = NULL, przewoznik = NULL, zrodlo = NULL, status = NULL, dostarczono_at = NULL,
        sprawdzono_at = NULL, zalozono_at = excluded.zalozono_at`)
    .run(sprawa, z.konto, z.zamowienie, z.id, teraz.toISOString());
  return { k: stary?.dostarczono_at != null ? 1 : 0, q: problem(stary?.status) ? 1 : 0 };
}

/**
 * Odmowa wypłaty z kodem dosyłki zakłada śledzenie — w tym samym ruchu.
 *
 * Krok „dosłać” z domyślnym terminem idzie przez `zapiszKrokSprawy`, tę samą
 * drogę co „Ustaw krok” na profilu. Sprawę bez wiersza zakłada, zakończoną
 * wznawia, a w toku ZASTĘPUJE krok — typowe „czekamy na zwrot” spełniła
 * właśnie odmowa. Prowadzącym zostaje autor, gdy sprawa go nie ma.
 *
 * NIE POTWIERDZA „nowego” istniejącej sprawy: agent odmawia na ekranie
 * zwrotu i nie widział profilu. Nowa sprawa dostaje odcisk z tej chwili,
 * bo nie ma czego nie potwierdzić.
 *
 * IDEMPOTENTNA PO ZWROCIE. Druga próba dla zwrotu, którego dosyłka już
 * stoi, oddaje sukces bez zapisu — ponowienie z ekranu po zerwanej sieci
 * nie ma prawa zastąpić dosyłki, którą ticker zdążył wykryć.
 */
export function zalozDosylkeZOdmowy(
  database: DatabaseSync, zwrotId: number, autor: Autor, teraz = new Date(),
): WynikDosylki {
  const z = zwrotDoDosylki(database, zwrotId);
  const l = loginZAllegro(database, z.login);
  return transaction(database, (): WynikDosylki => {
    const w = wierszSprawy(database, l);
    if (w && database.prepare("SELECT 1 FROM klient_dosylka WHERE sprawa_id = ? AND zwrot_id = ?")
      .get(Number(w.id), z.id)) {
      return { zalozona: true, login: String(w.login), krokDo: String(w.krok_do), zastapil: null };
    }
    const krok = KROK_DOSYLKI[z.kod];
    const krokDo = poDniachRoboczych(teraz, DNI_KROKU_DOSYLKI).toISOString();
    /* Odcisk nowej sprawy liczony PRZED wierszem dosyłki jest tym samym co
       PO nim: bez sprawy login nie ma ani jednej dosyłki, a świeża nie jest
       ani doręczona, ani z kłopotem. */
    const zapis = zapiszKrokSprawy(database, {
      w, login: l, krok, krokDo, autor, teraz, znane: w ? null : odciskTeraz(l, database), domyslny: true,
    });
    const zabrane = zapiszDosylke(database, zapis.id, z, teraz);
    if (w) wyrownajZnane(database, zapis.id, l, zabrane);
    logEvent("klient_dosylka_zalozona", autor.name, null, { sprawa: zapis.id, zrodlo: "odmowa" }, autor.id, database);
    return {
      zalozona: true, login: w ? String(w.login) : l, krokDo,
      /* Zakończona sprawa nie miała biegnącego kroku, więc niczego nie
         zastąpiono — jej krok to zapas dla „Cofnij”. */
      zastapil: zapis.wToku && zapis.poprzedniKrok !== krok ? zapis.poprzedniKrok : null,
    };
  })();
}

/**
 * „Śledź dosyłkę” przy zwrocie — ponowienie, gdy odmowa przeszła, a dosyłka
 * nie. Dosyłkę uważa za założoną według tej samej reguły, według której
 * ekran zwrotu pokazuje ją pod odmową (`stanZwrotuPieniedzy`): po zwrocie,
 * a bez niego po zamówieniu i koncie. Przycisk i trasa nie mogą się różnić
 * zdaniem, czy jest co zakładać.
 */
export function sledzDosylkeZwrotu(
  database: DatabaseSync, zwrotId: number, autor: Autor, teraz = new Date(),
): WynikDosylki {
  const z = zwrotDoDosylki(database, zwrotId);
  const jest = database.prepare(`SELECT p.login, p.krok_do FROM klient_dosylka d
      JOIN klient_prowadzenie p ON p.id = d.sprawa_id
     WHERE d.zwrot_id = ? OR (d.zamowienie = ? AND d.konto = ?)
     ORDER BY d.zwrot_id = ? DESC LIMIT 1`).get(z.id, z.zamowienie, z.konto, z.id) as Wiersz | undefined;
  if (jest) return { zalozona: true, login: String(jest.login), krokDo: String(jest.krok_do), zastapil: null };
  return zalozDosylkeZOdmowy(database, zwrotId, autor, teraz);
}

/**
 * Propozycja z profilu: „Odmówiono wypłaty… Śledzić dosyłkę?”. Ta sama
 * dosyłka i ten sam krok co przy odmowie, ale to ZAPIS Z PROFILU — więc
 * sprawdza wersję i odcisk ekranu jak cztery zapisy sprawy i potwierdza to,
 * co ekran narysował, odciskiem liczonym PO zapisie.
 */
export function zalozDosylkeZProfilu(
  login: string, p: { zwrotId: number; wersja: number; odcisk: string }, autor: Autor,
  teraz = new Date(), database: DatabaseSync = defaultDb(),
): SprawaKlienta {
  if (!Number.isInteger(p.zwrotId)) throw new BladSprawy("Pole `zwrotId` musi być liczbą całkowitą");
  const l = loginZAllegro(database, login);
  const z = zwrotDoDosylki(database, p.zwrotId, l);
  transaction(database, () => {
    const w = wierszSprawy(database, l);
    sprawdzSwiezosc(database, w, p, l, teraz);
    if (w && database.prepare("SELECT 1 FROM klient_dosylka WHERE sprawa_id = ? AND zamowienie = ?")
      .get(Number(w.id), z.zamowienie)) {
      throw new KonfliktSprawy("Dosyłkę tego zamówienia już śledzimy", sprawaKlienta(l, teraz, database));
    }
    const zapis = zapiszKrokSprawy(database, {
      w, login: l, krok: KROK_DOSYLKI[z.kod], krokDo: poDniachRoboczych(teraz, DNI_KROKU_DOSYLKI).toISOString(),
      autor, teraz, znane: w ? null : odciskTeraz(l, database), domyslny: true,
    });
    zapiszDosylke(database, zapis.id, z, teraz);
    potwierdzPoZapisie(database, zapis.id, l, autor, teraz, false);
    logEvent("klient_dosylka_zalozona", autor.name, null, { sprawa: zapis.id, zrodlo: "profil" }, autor.id, database);
  })();
  return sprawaKlienta(l, teraz, database)!;
}

/**
 * Konto zamówienia, jeśli zamówienie należy do tego loginu. Najpierw
 * zamówienia, potem zwroty: zwrot niesie numer zamówienia także wtedy,
 * gdy samo zamówienie nie jest jeszcze pobrane.
 */
function kontoZamowieniaLoginu(database: DatabaseSync, login: string, zamowienie: string): number | null {
  const w = database.prepare(`
    SELECT channel_account_id AS konto FROM zamowienie_klienta
     WHERE external_id = ?1 AND kupujacy_login = ?2 COLLATE NOCASE
    UNION ALL
    SELECT channel_account_id FROM zwrot_klienta WHERE order_id = ?1 AND kupujacy_login = ?2 COLLATE NOCASE
    LIMIT 1`).get(zamowienie, login) as Wiersz | undefined;
  return w ? Number(w.konto) : null;
}

/**
 * Numer dosyłki wpisany ręką — droga zapasowa, gdy etykieta trafiła na inne
 * zamówienie albo Allegro numeru nie pokazało. Zastępuje numer dosyłki tego
 * zamówienia albo zakłada jej wiersz, gdy dosyłki nikt nie zaczął odmową.
 *
 * Sprawa musi być w toku: dosyłka bez biegnącego kroku nie ma kogo obudzić,
 * a ticker zakończonych nie pyta. Nowy numer zeruje stan śledzenia, bo stan
 * starego numeru nie mówi nic o nowej paczce. Ten sam numer zostawia stan.
 */
export function wpiszNumerDosylki(
  login: string,
  p: { zamowienie: string; waybill: string; przewoznik: string; wersja: number; odcisk: string },
  autor: Autor, teraz = new Date(), database: DatabaseSync = defaultDb(),
): SprawaKlienta {
  const zamowienie = (p.zamowienie ?? "").trim();
  const waybill = (p.waybill ?? "").trim();
  const przewoznik = (p.przewoznik ?? "").trim();
  if (!zamowienie) throw new BladSprawy("Brak numeru zamówienia");
  if (waybill.length < 1 || waybill.length > LIMIT_NUMERU) {
    throw new BladSprawy(`Numer przesyłki ma od 1 do ${LIMIT_NUMERU} znaków`);
  }
  if (przewoznik.length < 1 || przewoznik.length > LIMIT_NUMERU) throw new BladSprawy("Wybierz przewoźnika");
  const l = loginZAllegro(database, login);
  transaction(database, () => {
    const w = wierszSprawy(database, l);
    sprawdzSwiezosc(database, w, p, l, teraz);
    if (!w || w.zakonczono_at != null) {
      throw new KonfliktSprawy("Sprawa nie jest w toku", sprawaKlienta(l, teraz, database));
    }
    const konto = kontoZamowieniaLoginu(database, l, zamowienie);
    if (konto === null) throw new BladSprawy("To zamówienie nie należy do tego klienta");
    const id = Number(w.id);
    const stary = database.prepare(`SELECT waybill, przewoznik FROM klient_dosylka
        WHERE sprawa_id = ? AND zamowienie = ?`).get(id, zamowienie) as Wiersz | undefined;
    if (!stary || stary.waybill !== waybill || stary.przewoznik !== przewoznik) {
      database.prepare(`INSERT INTO klient_dosylka(sprawa_id, konto, zamowienie, waybill, przewoznik, zrodlo,
          zalozono_at) VALUES (?,?,?,?,?,'recznie',?)
        ON CONFLICT(sprawa_id, zamowienie) DO UPDATE SET konto = excluded.konto, waybill = excluded.waybill,
          przewoznik = excluded.przewoznik, zrodlo = 'recznie', status = NULL, dostarczono_at = NULL,
          sprawdzono_at = NULL`)
        .run(id, konto, zamowienie, waybill, przewoznik, teraz.toISOString());
    }
    potwierdzPoZapisie(database, id, l, autor, teraz, true);
    logEvent("klient_dosylka_numer", autor.name, null, { sprawa: id, zrodlo: "recznie" }, autor.id, database);
  })();
  return sprawaKlienta(l, teraz, database)!;
}

/* ── Wykrycie numeru ────────────────────────────────────────────────────── */

/** Przesyłka zamówienia ze schematu `CheckoutFormAddWaybillCreated`. */
export interface PrzesylkaZamowienia { waybill: string; carrierId: string; createdAt: string | null }

/**
 * Która z przesyłek zamówienia jest dosyłką — albo `null`, gdy tego nie wiemy.
 *
 * Lista `/shipments` niesie WSZYSTKIE numery zamówienia: pierwszą paczkę,
 * czasem numer zwrotu i wcześniejsze dosyłki. Odpadają kolejno:
 *   1. numery paczek zwrotów tego zamówienia i wcześniejszych dosyłek
 *      (`wykluczone`);
 *   2. numer zarejestrowany NIE PÓŹNIEJ niż klient zgłosił zwrot — pierwsza
 *      paczka jest zawsze starsza od zwrotu, a dosyłka powstaje po odmowie;
 *   3. paczka DORĘCZONA przed zgłoszeniem zwrotu — klient miał ją, zanim
 *      ją odesłał, więc to oryginał. To łapie oryginał bez daty rejestracji.
 * Zostaje jedna — bierzemy ją. Zostaje kilka — najpóźniej zarejestrowaną,
 * a gdy którejś brak daty, NIE ZGADUJEMY: agent wpisze numer z Sellasist.
 * Numer źle zgadnięty śledziłby cudzą paczkę jako „w drodze” tygodniami.
 */
export function wybierzNumer(
  przesylki: readonly PrzesylkaZamowienia[], wykluczone: ReadonlySet<string>,
  stany: ReadonlyMap<string, StanPrzesylki>, zwrotAt: string,
): PrzesylkaZamowienia | null {
  const zwrot = chwilaUtc(zwrotAt);
  const zostaja = przesylki.filter((p) => {
    if (wykluczone.has(p.waybill)) return false;
    const utworzono = chwilaUtc(p.createdAt);
    if (Number.isFinite(utworzono) && utworzono <= zwrot) return false;
    const doreczono = chwilaUtc(stany.get(p.waybill)?.dostarczonoAt);
    return !(Number.isFinite(doreczono) && doreczono < zwrot);
  });
  if (zostaja.length <= 1) return zostaja[0] ?? null;
  if (zostaja.some((p) => !Number.isFinite(chwilaUtc(p.createdAt)))) return null;
  return zostaja.reduce((a, b) => (chwilaUtc(b.createdAt) > chwilaUtc(a.createdAt) ? b : a));
}

/**
 * Numery paczek WSZYSTKICH zwrotów tego zamówienia, z lądowiska. Model pracy
 * trzyma numer tylko pierwszej paczki (`zwrot_klienta.waybill`), a zwrot
 * bywa w kilku. `transportingWaybill` to numer przewoźnika, który wiezie
 * paczkę fizycznie (schemat `CustomerReturnReturnParcel`) — bywa go w
 * `/shipments` zamiast numeru Allegro.
 */
function numeryZwrotow(database: DatabaseSync, konto: number, zamowienie: string): Set<string> {
  const numery = new Set<string>();
  for (const z of database.prepare(`SELECT z.waybill, a.surowe_json FROM zwrot_klienta z
      LEFT JOIN allegro_zwrot a ON a.id = z.external_id
     WHERE z.channel_account_id = ? AND z.order_id = ?`).all(konto, zamowienie) as Wiersz[]) {
    const n = tekst(z.waybill);
    if (n) numery.add(n);
    let surowy: { parcels?: Array<{ waybill?: unknown; transportingWaybill?: unknown }> } | null = null;
    try { surowy = JSON.parse(String(z.surowe_json ?? "null")); } catch { /* uszkodzone lądowisko — zostaje numer z modelu */ }
    for (const p of surowy?.parcels ?? []) {
      for (const v of [p?.waybill, p?.transportingWaybill]) {
        const t = tekst(v);
        if (t) numery.add(t);
      }
    }
  }
  return numery;
}

/**
 * Chwila zgłoszenia zwrotu WEDŁUG ALLEGRO, z lądowiska. Nie `zwrot_klienta
 * .created_at`: mapowanie podstawia tam czas synchronizacji, gdy Allegro
 * daty nie poda, a podstawiona data przesunęłaby granicę oryginału.
 */
function zgloszenieZwrotu(database: DatabaseSync, zwrotId: unknown): string | null {
  if (zwrotId == null) return null;
  const w = database.prepare(`SELECT json_extract(a.surowe_json, '$.createdAt') AS at FROM zwrot_klienta z
      JOIN allegro_zwrot a ON a.id = z.external_id WHERE z.id = ?`).get(Number(zwrotId)) as Wiersz | undefined;
  const at = tekst(w?.at);
  return at && Number.isFinite(chwilaUtc(at)) ? at : null;
}

/* ── Ticker ─────────────────────────────────────────────────────────────── */

export interface DosylkaDeps {
  query?: (url: string) => Promise<unknown | null>;
  apiUrl?: string;
  teraz?: () => Date;
}

type Klucz = { sprawa: number; zamowienie: string };

/**
 * Zapis wyniku śledzenia — COMPARE-AND-SET po numerze. Numer zmieniony
 * ręką w czasie żądania znaczy, że ten wynik dotyczy innej paczki. Wersji
 * sprawy ticker NIE podnosi: ekran otwarty w tej chwili nie ma czego
 * przegrać, a zmianę faktu i tak złapie odcisk (`k`, `q`).
 */
function zapiszStan(
  database: DatabaseSync, k: Klucz, waybill: string, stan: StanPrzesylki, teraz: Date,
): { doreczona: boolean; problem: boolean } {
  return transaction(database, () => {
    const przed = database.prepare(`SELECT status, dostarczono_at FROM klient_dosylka
        WHERE sprawa_id = ? AND zamowienie = ? AND waybill = ?`).get(k.sprawa, k.zamowienie, waybill) as Wiersz | undefined;
    if (!przed) return { doreczona: false, problem: false };
    database.prepare(`UPDATE klient_dosylka SET status = COALESCE(?, status),
        dostarczono_at = COALESCE(dostarczono_at, ?), sprawdzono_at = ?
      WHERE sprawa_id = ? AND zamowienie = ? AND waybill = ?`)
      .run(stan.status, stan.dostarczonoAt, teraz.toISOString(), k.sprawa, k.zamowienie, waybill);
    return zdarzeniaPrzejscia(database, k.sprawa, przed, stan);
  })();
}

/** Wpis do dziennika tylko przy PRZEJŚCIU — ten sam stan przy każdym takcie to nie zdarzenie. */
function zdarzeniaPrzejscia(
  database: DatabaseSync, sprawa: number, przed: Wiersz | undefined, stan: StanPrzesylki,
): { doreczona: boolean; problem: boolean } {
  if (stan.dostarczonoAt && przed?.dostarczono_at == null) {
    logEvent("klient_dosylka_doreczona", "automat", null, { sprawa }, undefined, database);
    return { doreczona: true, problem: false };
  }
  if (!stan.dostarczonoAt && problem(stan.status) && przed?.status !== stan.status) {
    logEvent("klient_dosylka_problem", "automat", null, { sprawa, status: stan.status }, undefined, database);
    return { doreczona: false, problem: true };
  }
  return { doreczona: false, problem: false };
}

/**
 * Jedno wykrycie numeru dla dosyłki bez numeru. Sieć idzie PRZED
 * transakcją, bo trzymanie jej na czas żądania blokowałoby drugi proces.
 * Oddaje `null`, gdy pytanie nie doszło — wtedy nie zapisujemy nawet
 * `sprawdzono_at`, bo ekran powiedziałby „stan z …” o stanie, którego nie ma.
 */
async function wykryj(
  database: DatabaseSync, w: Wiersz, query: (url: string) => Promise<unknown | null>, apiUrl: string,
  teraz: Date,
): Promise<{ znaleziono: boolean; doreczona: boolean; problem: boolean } | null> {
  const k: Klucz = { sprawa: Number(w.sprawa_id), zamowienie: String(w.zamowienie) };
  /* Bez chwili zgłoszenia zwrotu nie da się odróżnić oryginału od dosyłki,
     więc nie pytamy wcale — dwa dni robocze później ekran poprosi o numer. */
  const zwrotAt = zgloszenieZwrotu(database, w.zwrot_id);
  if (!zwrotAt) return null;

  let lista: { shipments?: Array<Record<string, unknown>> } | null;
  try {
    lista = await query(urlPrzesylekZamowienia(apiUrl, k.zamowienie)) as typeof lista;
  } catch (e) {
    if (e instanceof BladLimituAllegro) throw e;
    /* Stałe zdanie, nie `e.message`: błąd Allegro niesie treść odpowiedzi. */
    console.warn("[dosylki] pytanie o przesyłki zamówienia nie doszło — spróbuję w następnym takcie");
    return null;
  }
  const przesylki: PrzesylkaZamowienia[] = (lista?.shipments ?? [])
    .filter((p) => typeof p?.waybill === "string" && p.waybill !== ""
      && typeof p?.carrierId === "string" && p.carrierId !== "")
    .map((p) => ({ waybill: String(p.waybill), carrierId: String(p.carrierId), createdAt: tekst(p.createdAt) }));

  const wykluczone = numeryZwrotow(database, Number(w.konto), k.zamowienie);
  for (const d of database.prepare("SELECT waybill FROM klient_dosylka WHERE sprawa_id = ? AND waybill IS NOT NULL")
    .all(k.sprawa) as Wiersz[]) wykluczone.add(String(d.waybill));

  /* Tracking tylko dla tych, których nie odrzuciła lista ani data
     rejestracji — i nigdy dla `OTHER`, którego Allegro nie śledzi. */
  const zwrot = chwilaUtc(zwrotAt);
  const doSprawdzenia = przesylki.filter((p) => !wykluczone.has(p.waybill) && p.carrierId !== "OTHER"
    && !(Number.isFinite(chwilaUtc(p.createdAt)) && chwilaUtc(p.createdAt) <= zwrot));
  const stany = doSprawdzenia.length
    ? await odpytajTracking(query, apiUrl, doSprawdzenia, { limitWyzej: true })
    : new Map<string, StanPrzesylki>();
  /* Partia, która padła, nie ma wpisu. Bez stanu nie wiemy, czy to nie
     oryginał doręczony przed zwrotem — lepiej spytać za kwadrans. */
  if (doSprawdzenia.some((p) => !stany.has(p.waybill))) return null;

  const wybrana = wybierzNumer(przesylki, wykluczone, stany, zwrotAt);
  const at = teraz.toISOString();
  return transaction(database, () => {
    if (!wybrana) {
      database.prepare(`UPDATE klient_dosylka SET sprawdzono_at = ?
        WHERE sprawa_id = ? AND zamowienie = ? AND zalozono_at = ? AND waybill IS NULL`)
        .run(at, k.sprawa, k.zamowienie, String(w.zalozono_at));
      return { znaleziono: false, doreczona: false, problem: false };
    }
    const stan = stany.get(wybrana.waybill) ?? { dostarczonoAt: null, status: null };
    /* COMPARE-AND-SET po chwili założenia i pustym numerze: dosyłka
       zastąpiona albo numer wpisany ręką w czasie żądania wygrywają. */
    const r = database.prepare(`UPDATE klient_dosylka SET waybill = ?, przewoznik = ?, zrodlo = 'allegro',
        status = ?, dostarczono_at = COALESCE(dostarczono_at, ?), sprawdzono_at = ?
      WHERE sprawa_id = ? AND zamowienie = ? AND zalozono_at = ? AND waybill IS NULL`)
      .run(wybrana.waybill, wybrana.carrierId, stan.status, stan.dostarczonoAt, at,
        k.sprawa, k.zamowienie, String(w.zalozono_at));
    if (Number(r.changes) !== 1) return { znaleziono: false, doreczona: false, problem: false };
    logEvent("klient_dosylka_numer", "automat", null, { sprawa: k.sprawa, zrodlo: "allegro" }, undefined, database);
    return { znaleziono: true, ...zdarzeniaPrzejscia(database, k.sprawa, undefined, stan) };
  })();
}

/**
 * Takt dosyłek: wykrycie numeru i śledzenie. Woła go `main()` przez
 * `uruchomTakt`, nigdy `buildApp()` — testy tras nie strzelają do Allegro.
 *
 * TYLKO SPRAWY W TOKU. Doręczenie po zakończeniu sprawy nie wymaga pracy,
 * a obudziłoby sprawę i nadmuchało miarę szumu z S6. Tylko dosyłki bez
 * doręczenia, nie wracające do nadawcy i założone w ostatnich trzydziestu
 * dniach — dłużej paczka nie jedzie, a pytanie w nieskończoność to koszt.
 *
 * 429 IDZIE WYŻEJ, żeby `uruchomTakt` odczekał `Retry-After` — limit jest
 * wspólny dla konta (precedens: `allegro-zwroty-sync.ts`). Każdy inny błąd
 * zabiera jedną dosyłkę, nie cały przebieg.
 */
export async function sledzDosylki(
  database: DatabaseSync = defaultDb(), deps: DosylkaDeps = {},
): Promise<{ wykryte: number; doreczone: number; problemy: number }> {
  const query = deps.query ?? zapytajAllegro;
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const teraz = (deps.teraz ?? (() => new Date()))();
  const wynik = { wykryte: 0, doreczone: 0, problemy: 0 };
  const dolicz = (x: { doreczona: boolean; problem: boolean }) => {
    if (x.doreczona) wynik.doreczone++;
    if (x.problem) wynik.problemy++;
  };

  const wiersze = database.prepare(`SELECT d.* FROM klient_dosylka d
      JOIN klient_prowadzenie p ON p.id = d.sprawa_id
     WHERE p.zakonczono_at IS NULL AND d.dostarczono_at IS NULL
       AND (d.status IS NULL OR d.status <> 'RETURNED')
       AND julianday(d.zalozono_at) >= julianday(?)
     ORDER BY julianday(d.zalozono_at)`)
    .all(new Date(teraz.getTime() - OKNO_SLEDZENIA_MS).toISOString()) as Wiersz[];

  for (const w of wiersze) {
    if (w.waybill != null) continue;
    const ostatnio = chwilaUtc(tekst(w.sprawdzono_at));
    if (Number.isFinite(ostatnio) && teraz.getTime() - ostatnio < PRZERWA_WYKRYCIA_MS) continue;
    const r = await wykryj(database, w, query, apiUrl, teraz);
    if (!r) continue;
    if (r.znaleziono) wynik.wykryte++;
    dolicz(r);
  }

  const doSledzenia = wiersze.filter((w) => w.waybill != null && tekst(w.przewoznik) !== null
    && w.przewoznik !== "OTHER");
  if (doSledzenia.length) {
    const stany = await odpytajTracking(query, apiUrl,
      doSledzenia.map((w) => ({ carrierId: String(w.przewoznik), waybill: String(w.waybill) })), { limitWyzej: true });
    for (const w of doSledzenia) {
      const stan = stany.get(String(w.waybill));
      if (!stan) continue;
      dolicz(zapiszStan(database, { sprawa: Number(w.sprawa_id), zamowienie: String(w.zamowienie) },
        String(w.waybill), stan, teraz));
    }
  }
  return wynik;
}
