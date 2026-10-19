import { dataLokalna } from "../czas.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Pomyłki wysyłkowe ───────────────────────────────────────────────────────
   Rejestr złych paczek, który biuro prowadziło w arkuszu: klient dostał inny
   towar, niż zamówił. Zasada właściciela brzmi „agent robi jak najmniej”.
   Wpisuje tylko to, czego system wiedzieć nie może: co przyszło zamiast czego
   i kto zbierał, kto pakował, kto zawinił. Resztę bierze z kolejek.

   FAKTY Z KOLEJEK CZYTA SIĘ PRZY ODCZYCIE, nie kopiuje. Dosyłka, powrót
   towaru i odmowa wypłaty leżą już w `klient_dosylka` i `zwrot_klienta`.
   Kopia rozjechałaby się przy pierwszej synchronizacji, a sprawa trzyma tylko
   to, czego kolejki nie wiedzą (CLAUDE.md). Ręczne kolumny to zapas dla
   sprzedaży poza Allegro, gdzie kolejki milczą. Fakt z kolejki wygrywa
   z wpisem ręki, bo jest faktem, a wpis tylko wnioskiem.

   STAN TEŻ JEST WYLICZANY. Zapisany trzeba by gasić przy każdej zmianie
   kolejki, a wyliczony gaśnie razem z przyczyną — ta sama zasada co profil.

   POMYŁKA ZAKŁADA SIĘ SAMA przy odmowie wypłaty kodem `NEW_ITEM_SENT`
   i przy założeniu dosyłki. To zapis wywołany zapisem, nie otwarciem ekranu.
   `MISSING_PART_SENT` pomyłki nie zakłada: brakująca część to nie zły towar.

   KIERUNEK IMPORTÓW JEST JEDEN. Ten plik importuje tylko bazę, dziennik
   i zegar. Czytają go `dosylka.ts`, `zwrot-pieniedzy.ts`, droga i profil,
   więc import któregoś z nich zamknąłby cykl.

   DO DZIENNIKA IDZIE NUMER POMYŁKI, nigdy login ani treść: `events` nie ma
   retencji, a wpis „co dostał” bywa zdaniem o kliencie. */

type Wiersz = Record<string, unknown>;
type Autor = { id: number; name: string };

export type StanPomylki = "do_uzupelnienia" | "w_toku" | "zakonczona";
export type ZrodloPomylki = "odmowa" | "dosylka" | "recznie";
export type NowyTowar = "tak" | "nie";
export type OdmowaPomylki = "tak" | "nie_trzeba";

export interface OsobaPomylki { userId: number | null; nazwa: string }

/** Pomyłka tak, jak widzi ją ekran — kształt umówiony z panelem. */
export interface Pomylka {
  id: number;
  /** `RRRR-MM-DD`, dzień lokalny zgłoszenia. */
  zgloszono: string;
  login: string;
  konto: number | null;
  zamowienie: string | null;
  /** Najnowszy zwrot tego zamówienia; z niego idą powrót towaru i odmowa. */
  zwrotId: number | null;
  coZamowil: string | null;
  coDostal: string | null;
  /** Zdanie złożone z dwóch pól wyżej — panel tylko je drukuje. */
  opis: string | null;
  uwagi: string | null;
  zrodlo: ZrodloPomylki;
  zbieral: OsobaPomylki | null;
  pakowal: OsobaPomylki | null;
  winaZbierajacego: boolean;
  winaPakujacego: boolean;
  nowyTowar: { wartosc: NowyTowar | null; zKolejki: boolean };
  /** `wartosc`: `RRRR-MM-DD` albo `nie_wraca`. */
  towarWrocil: { wartosc: string | null; zKolejki: boolean };
  odmowa: { wartosc: OdmowaPomylki | null; zKolejki: boolean; kod: string | null };
  stan: StanPomylki;
  zakonczonaRecznie: boolean;
  wersja: number;
}

/** Zła wartość albo brak danych — trasa oddaje 400 ze zdaniem. */
export class BladPomylki extends Error {
  constructor(message: string) { super(message); this.name = "BladPomylki"; }
}
/** Nie ma takiej pomyłki — trasa oddaje 404. */
export class BrakPomylki extends Error {
  constructor() { super("Nie ma takiej pomyłki"); this.name = "BrakPomylki"; }
}
/** Ktoś zmienił wiersz w międzyczasie. Niesie stan bieżący, żeby ekran go narysował. */
export class KonfliktPomylki extends Error {
  constructor(message: string, readonly pomylka: Pomylka) { super(message); this.name = "KonfliktPomylki"; }
}

/** Najdłuższy wpis „co dostał” i „co zamówił”. Nazwa oferty Allegro ma do 75 znaków. */
export const LIMIT_POZYCJI = 200;
/** Najdłuższe uwagi. Jedno zdanie dla kolegi, nie akta sprawy. */
export const LIMIT_UWAG = 1000;

const KOD_POMYLKI = "NEW_ITEM_SENT";
const KOD_BRAKUJACEJ_CZESCI = "MISSING_PART_SENT";

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * „Dostał X zamiast Y” — jedno brzmienie na zakładce, drodze i profilu.
 * Bez „co dostał” zdania nie ma, bo samo „zamówił Y” nie mówi o pomyłce.
 */
export function opisPomylki(coDostal: string | null, coZamowil: string | null): string | null {
  const d = tekst(coDostal);
  const z = tekst(coZamowil);
  if (d && z) return `Dostał ${d} zamiast ${z}`;
  if (d) return `Dostał ${d}`;
  return null;
}

/* Fakty z kolejek dołączone do wiersza. Zwrot to NAJNOWSZY zwrot zamówienia:
   klient, który odesłał dwa razy, odsyła ostatnią paczkę. Odmowę bierzemy
   naszą albo z panelu Allegro, bo biuro odmawia tam z nawyku (`dosylka.ts`). */
const ZAPYTANIE = `
  SELECT p.*,
         z.id AS q_zwrot_id,
         z.dostarczono_at AS q_dostarczono,
         COALESCE(NULLIF(trim(z.odmowa_kod), ''), NULLIF(trim(z.rejection_code), '')) AS q_odmowa_kod,
         EXISTS (SELECT 1 FROM klient_dosylka d
                  WHERE d.konto = p.konto AND d.zamowienie = p.zamowienie AND d.waybill IS NOT NULL) AS q_dosylka
    FROM pomylka_wysylki p
    LEFT JOIN zwrot_klienta z ON z.id = (
      SELECT id FROM zwrot_klienta
       WHERE channel_account_id = p.konto AND order_id = p.zamowienie
       ORDER BY created_at DESC, id DESC LIMIT 1)`;

const osoba = (nazwa: unknown, userId: unknown): OsobaPomylki | null => {
  const n = tekst(nazwa);
  if (n === null && userId == null) return null;
  return { userId: userId == null ? null : Number(userId), nazwa: n ?? "" };
};

const jestDniem = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));

/**
 * Stan liczony przy odczycie.
 *
 * Ręczne „Zakończ” wygrywa ze wszystkim, bo to świadomy wyjątek człowieka.
 * Potem braki: pomyłka bez „co dostał” albo bez żadnej osoby nie trafi do
 * miesięcznego rachunku win, więc czeka na agenta, nawet gdy kolejki skończyły.
 */
function stanPomylki(p: Omit<Pomylka, "stan">): StanPomylki {
  if (p.zakonczonaRecznie) return "zakonczona";
  if (!p.coDostal || (!p.zbieral && !p.pakowal)) return "do_uzupelnienia";
  const wyslano = p.nowyTowar.wartosc !== null;
  const wrocil = p.towarWrocil.wartosc !== null;
  const odmowa = p.odmowa.wartosc !== null;
  return wyslano && wrocil && odmowa ? "zakonczona" : "w_toku";
}

function naPomylke(w: Wiersz): Pomylka {
  const dosylka = Number(w.q_dosylka) === 1;
  const dostarczono = tekst(w.q_dostarczono);
  const kodOdmowy = tekst(w.q_odmowa_kod);
  const recznyTowar = tekst(w.nowy_towar);
  const recznyPowrot = tekst(w.towar_wrocil);
  const recznaOdmowa = tekst(w.odmowa);
  const coDostal = tekst(w.co_dostal);
  const coZamowil = tekst(w.co_zamowil);
  const bez: Omit<Pomylka, "stan"> = {
    id: Number(w.id),
    zgloszono: String(w.zgloszono),
    login: String(w.login),
    konto: w.konto == null ? null : Number(w.konto),
    zamowienie: tekst(w.zamowienie),
    zwrotId: w.q_zwrot_id == null ? null : Number(w.q_zwrot_id),
    coZamowil, coDostal,
    opis: opisPomylki(coDostal, coZamowil),
    uwagi: tekst(w.uwagi),
    zrodlo: String(w.zrodlo) as ZrodloPomylki,
    zbieral: osoba(w.zbieral, w.zbieral_user_id),
    pakowal: osoba(w.pakowal, w.pakowal_user_id),
    winaZbierajacego: Number(w.wina_zbierajacego) === 1,
    winaPakujacego: Number(w.wina_pakujacego) === 1,
    nowyTowar: dosylka
      ? { wartosc: "tak", zKolejki: true }
      : { wartosc: recznyTowar === "tak" || recznyTowar === "nie" ? recznyTowar : null, zKolejki: false },
    towarWrocil: dostarczono
      ? { wartosc: dataLokalna(dostarczono), zKolejki: true }
      : { wartosc: recznyPowrot, zKolejki: false },
    odmowa: kodOdmowy
      ? { wartosc: "tak", zKolejki: true, kod: kodOdmowy }
      : { wartosc: recznaOdmowa === "tak" || recznaOdmowa === "nie_trzeba" ? recznaOdmowa : null,
        zKolejki: false, kod: null },
    zakonczonaRecznie: w.zakonczono_at != null,
    wersja: Number(w.wersja),
  };
  return { ...bez, stan: stanPomylki(bez) };
}

/** Jedna pomyłka albo `null`. */
export function pomylka(id: number, database: Db = defaultDb()): Pomylka | null {
  const w = database.prepare(`${ZAPYTANIE} WHERE p.id = ?`).get(id) as Wiersz | undefined;
  return w ? naPomylke(w) : null;
}

const NAJNOWSZE = "ORDER BY p.zgloszono DESC, p.id DESC";

/* ── Lista i podsumowanie ───────────────────────────────────────────────── */

export type FiltrStanu = "do_uzupelnienia" | "w_toku" | "zakonczone" | "wszystkie";
const FILTRY: readonly FiltrStanu[] = ["do_uzupelnienia", "w_toku", "zakonczone", "wszystkie"];

const sprawdzMiesiac = (m: string): string => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BladPomylki("Miesiąc w postaci RRRR-MM");
  return m;
};

export interface OsobaPodsumowania { userId: number | null; nazwa: string; zbieral: number; pakowal: number; winny: number }
export interface PodsumowanieMiesiaca { miesiac: string; razem: number; osoby: OsobaPodsumowania[] }

/**
 * Lista do zakładki. Filtr stanu idzie w kodzie, nie w SQL-u, bo stan jest
 * wyliczany z kolejek — druga reguła w zapytaniu rozjechałaby się z pierwszą.
 */
export function listaPomylek(
  p: { stan?: string; miesiac?: string } = {}, database: Db = defaultDb(),
): Pomylka[] {
  const stan = (p.stan ?? "wszystkie") as FiltrStanu;
  if (!FILTRY.includes(stan)) throw new BladPomylki("Nieznany filtr stanu");
  const miesiac = p.miesiac ? sprawdzMiesiac(p.miesiac) : null;
  const wiersze = (miesiac
    ? database.prepare(`${ZAPYTANIE} WHERE substr(p.zgloszono, 1, 7) = ? ${NAJNOWSZE}`).all(miesiac)
    : database.prepare(`${ZAPYTANIE} ${NAJNOWSZE}`).all()) as Wiersz[];
  const wszystkie = wiersze.map(naPomylke);
  if (stan === "wszystkie") return wszystkie;
  const szukany: StanPomylki = stan === "zakonczone" ? "zakonczona" : stan;
  return wszystkie.filter((x) => x.stan === szukany);
}

/** Ile pomyłek czeka na agenta — licznik przy zakładce, bez filtra miesiąca. */
export function licznikDoUzupelnienia(database: Db = defaultDb()): number {
  return listaPomylek({ stan: "do_uzupelnienia" }, database).length;
}

/**
 * Miesiąc według dnia zgłoszenia: ile pomyłek i co każda osoba w nich robiła.
 *
 * Osobę liczy się po `userId`, a bez niego po nazwie: konto skasowane zostawia
 * nazwę, a imię zmienione w kartotece nie rozbija jednej osoby na dwie.
 * „Winny” liczy POMYŁKI, nie role — kto zbierał i pakował tę samą paczkę,
 * a zawinił w obu, ma jedną pomyłkę na sumieniu, nie dwie.
 */
export function podsumowanieMiesiaca(miesiac: string, database: Db = defaultDb()): PodsumowanieMiesiaca {
  const m = sprawdzMiesiac(miesiac);
  const wiersze = database.prepare(`SELECT zbieral, zbieral_user_id, pakowal, pakowal_user_id,
      wina_zbierajacego, wina_pakujacego FROM pomylka_wysylki WHERE substr(zgloszono, 1, 7) = ?`)
    .all(m) as Wiersz[];
  const osoby = new Map<string, OsobaPodsumowania>();
  const klucz = (o: OsobaPomylki) => (o.userId !== null ? `u${o.userId}` : `n${o.nazwa.toLowerCase()}`);
  const wpis = (o: OsobaPomylki): OsobaPodsumowania => {
    const k = klucz(o);
    let x = osoby.get(k);
    if (!x) { x = { userId: o.userId, nazwa: o.nazwa, zbieral: 0, pakowal: 0, winny: 0 }; osoby.set(k, x); }
    return x;
  };
  for (const w of wiersze) {
    const z = osoba(w.zbieral, w.zbieral_user_id);
    const p = osoba(w.pakowal, w.pakowal_user_id);
    const winni = new Set<string>();
    if (z) {
      wpis(z).zbieral++;
      if (Number(w.wina_zbierajacego) === 1) winni.add(klucz(z));
    }
    if (p) {
      wpis(p).pakowal++;
      if (Number(w.wina_pakujacego) === 1) winni.add(klucz(p));
    }
    for (const k of winni) osoby.get(k)!.winny++;
  }
  return {
    miesiac: m,
    razem: wiersze.length,
    osoby: [...osoby.values()].sort((a, b) => b.winny - a.winny || a.nazwa.localeCompare(b.nazwa, "pl")),
  };
}

/** Ile pomyłek zgłoszono od doby `od` do doby `doDnia` włącznie — obie `RRRR-MM-DD`. */
export function zgloszonychWDobach(od: string, doDnia: string, database: Db = defaultDb()): number {
  const w = database.prepare("SELECT count(*) AS n FROM pomylka_wysylki WHERE zgloszono BETWEEN ? AND ?")
    .get(od, doDnia) as Wiersz;
  return Number(w.n);
}

/** Bieżący miesiąc na zegarze magazynu, nie w UTC — pierwsza noc miesiąca to już nowy rachunek. */
export const biezacyMiesiac = (teraz = new Date()): string => dataLokalna(teraz.toISOString()).slice(0, 7);

/* ── Wiązanie z klientem ────────────────────────────────────────────────── */

/** Pomyłki klienta po loginie, bez wielkości liter — dla profilu. */
export function pomylkiKlienta(login: string, database: Db = defaultDb()): Pomylka[] {
  return (database.prepare(`${ZAPYTANIE} WHERE p.login = ? COLLATE NOCASE ${NAJNOWSZE}`)
    .all(login.trim()) as Wiersz[]).map(naPomylke);
}

/* ── Zakładanie przez automat ───────────────────────────────────────────── */

/**
 * Pomyłka ręczna bez konta przejmuje konto, gdy kolejka je poda. Agent
 * zgłosił ją z samym numerem, zanim zwrot albo dosyłka przypięły konto.
 * Bez przejęcia to samo zamówienie miałoby dwie pomyłki: z kontem i bez.
 * Oddaje id przejętej albo `null`, gdy nie było czego przejąć.
 */
function przejmijBezKonta(database: Db, konto: number, zamowienie: string, autor: Autor, teraz: Date): number | null {
  const w = database.prepare(`SELECT id FROM pomylka_wysylki WHERE konto IS NULL AND zamowienie = ?`)
    .get(zamowienie) as Wiersz | undefined;
  if (!w) return null;
  const id = Number(w.id);
  database.prepare(`UPDATE pomylka_wysylki SET konto = ?, wersja = wersja + 1, zmieniono_at = ? WHERE id = ?`)
    .run(konto, teraz.toISOString(), id);
  logEvent("pomylka_zmieniona", autor.name, null, { pomylka: id, pola: ["konto"] }, autor.id, database);
  return id;
}

/**
 * Pomyłka założona zapisem w innej kolejce. IDEMPOTENTNA: drugi raz dla tego
 * samego zamówienia nie robi nic, bo trafia w unikalny indeks.
 *
 * BEZ WŁASNEJ TRANSAKCJI. Dosyłka woła ją wewnątrz swojej, a `BEGIN` w środku
 * transakcji to błąd. Osłonę daje wołający (`wSavepoincie`).
 */
function zalozAutomatem(
  database: Db, p: { login: string; konto: number; zamowienie: string; zrodlo: ZrodloPomylki },
  autor: Autor, teraz: Date,
): number | null {
  const jest = database.prepare("SELECT 1 FROM pomylka_wysylki WHERE konto = ? AND zamowienie = ?")
    .get(p.konto, p.zamowienie);
  if (jest) return null;
  if (przejmijBezKonta(database, p.konto, p.zamowienie, autor, teraz) !== null) return null;
  const at = teraz.toISOString();
  const r = database.prepare(`INSERT OR IGNORE INTO pomylka_wysylki
      (zgloszono, login, konto, zamowienie, zrodlo, utworzono_at, zmieniono_at) VALUES (?,?,?,?,?,?,?)`)
    .run(dataLokalna(at), p.login, p.konto, p.zamowienie, p.zrodlo, at, at);
  if (Number(r.changes) !== 1) return null;
  const id = Number(r.lastInsertRowid);
  logEvent("pomylka_zalozona", autor.name, null, { pomylka: id, zrodlo: p.zrodlo }, autor.id, database);
  return id;
}

/**
 * Zapis rejestru, który NIE MA PRAWA wywrócić zapisu wołającego. Odmowa
 * i dosyłka są ważniejsze od rejestru: agent założy pomyłkę ręką, a dosyłki
 * nikt drugi raz nie wyśle. SAVEPOINT cofa tylko ten kawałek, więc otwarta
 * transakcja dosyłki zostaje w dobrym stanie. Poza transakcją SAVEPOINT
 * otwiera własną, więc ta sama osłona działa po odmowie.
 */
function wSavepoincie(database: Db, fn: () => number | null): number | null {
  database.exec("SAVEPOINT pomylka_automat");
  try {
    const id = fn();
    database.exec("RELEASE pomylka_automat");
    return id;
  } catch (e) {
    try {
      database.exec("ROLLBACK TO pomylka_automat");
      database.exec("RELEASE pomylka_automat");
    } catch { /* ważniejsza jest pierwotna przyczyna, idzie do logu niżej */ }
    console.error("[pomylki] automatyczne założenie pomyłki nie doszło:", e);
    return null;
  }
}

/**
 * Odmowa wypłaty kodem „Wysłaliśmy nowy towar” zakłada pomyłkę. Każdy inny
 * kod nie zakłada: to nie zły towar. Zwrot bez loginu albo bez zamówienia też
 * nie, bo pomyłki bez klienta nie da się przypiąć do żadnej drogi.
 * Nie rzuca nigdy — porażkę loguje (`wSavepoincie`).
 */
export function zalozPomylkeZOdmowy(
  database: Db, zwrotId: number, autor: Autor, teraz = new Date(),
): number | null {
  return wSavepoincie(database, () => {
    const z = database.prepare(`SELECT channel_account_id, order_id, kupujacy_login, odmowa_kod
        FROM zwrot_klienta WHERE id = ?`).get(zwrotId) as Wiersz | undefined;
    if (!z || tekst(z.odmowa_kod) !== KOD_POMYLKI) return null;
    const login = tekst(z.kupujacy_login);
    const zamowienie = tekst(z.order_id);
    if (!login || !zamowienie) return null;
    return zalozAutomatem(database, { login, konto: Number(z.channel_account_id), zamowienie, zrodlo: "odmowa" },
      autor, teraz);
  });
}

/**
 * Dosyłka zakłada pomyłkę — ale nie dosyłka brakującej części, bo to nie
 * pomyłka zbierania. Bez kodu (numer wpisany ręką) pomyłka staje WYŁĄCZNIE,
 * gdy któryś zwrot zamówienia ma odmowę kodem złego towaru. Bez zwrotu nie:
 * druga paczka za zgubioną pierwszą to nie pomyłka zbierania.
 * Nie rzuca nigdy, więc porażka rejestru nie cofa dosyłki.
 */
export function zalozPomylkeZDosylki(
  database: Db, p: { login: string; konto: number; zamowienie: string; kod: string | null },
  autor: Autor, teraz = new Date(),
): number | null {
  if (p.kod === KOD_BRAKUJACEJ_CZESCI) return null;
  return wSavepoincie(database, () => {
    if (p.kod === null) {
      /* Ta sama reguła co odczyt odmowy w `ZAPYTANIE`: kod przycięty, nasz albo z Allegro. */
      const zlyTowar = database.prepare(`SELECT 1 FROM zwrot_klienta
          WHERE channel_account_id = ? AND order_id = ?
            AND (trim(ifnull(odmowa_kod, '')) = ?3 OR trim(ifnull(rejection_code, '')) = ?3)`)
        .get(p.konto, p.zamowienie, KOD_POMYLKI);
      if (!zlyTowar) return null;
    }
    return zalozAutomatem(database, { ...p, zrodlo: "dosylka" }, autor, teraz);
  });
}

/* ── Zapisy człowieka ───────────────────────────────────────────────────── */

function tekstPola(v: unknown, pole: string, limit: number): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw new BladPomylki(`Pole „${pole}” musi być tekstem`);
  const s = v.trim();
  if (s.length > limit) throw new BladPomylki(`Pole „${pole}” ma najwyżej ${limit} znaków`);
  return s === "" ? null : s;
}

/**
 * Konto i login zamówienia z bazy. Login z bazy bije wpisany: agent wszedł
 * z rozmowy albo zwrotu i nie przepisuje go ręką. Najpierw zamówienie, potem
 * zwrot, bo zwrot niesie numer także przy niepobranym zamówieniu.
 */
function zamowienieZBazy(database: Db, zamowienie: string, konto: number | null): { konto: number; login: string | null } | null {
  const w = database.prepare(`
    SELECT channel_account_id AS konto, kupujacy_login AS login FROM zamowienie_klienta
     WHERE external_id = ?1 AND (?2 IS NULL OR channel_account_id = ?2)
    UNION ALL
    SELECT channel_account_id, kupujacy_login FROM zwrot_klienta
     WHERE order_id = ?1 AND (?2 IS NULL OR channel_account_id = ?2)
    LIMIT 1`).get(zamowienie, konto) as Wiersz | undefined;
  return w ? { konto: Number(w.konto), login: tekst(w.login) } : null;
}

export interface NowaPomylka {
  login?: unknown; konto?: unknown; zamowienie?: unknown;
  coZamowil?: unknown; coDostal?: unknown; uwagi?: unknown;
}

/**
 * Pomyłka zgłoszona ręką: „Zła paczka” przy zwrocie, rozmowie albo profilu,
 * albo pusty formularz dla paragonu. Gdy zamówienie ma już pomyłkę, oddaje
 * istniejącą (`nowa: false`) — drugie kliknięcie nie robi drugiego wiersza.
 */
export function dodajPomylke(
  dane: NowaPomylka, autor: Autor, teraz = new Date(), database: Db = defaultDb(),
): { pomylka: Pomylka; nowa: boolean } {
  const zamowienie = tekstPola(dane.zamowienie, "zamowienie", 64);
  let konto: number | null = null;
  if (dane.konto != null) {
    if (!Number.isInteger(dane.konto)) throw new BladPomylki("Pole „konto” musi być liczbą całkowitą");
    konto = Number(dane.konto);
  }
  let login = tekstPola(dane.login, "login", 200);
  if (zamowienie) {
    const z = zamowienieZBazy(database, zamowienie, konto);
    if (z) {
      konto = z.konto;
      login = z.login ?? login;
    }
  }
  if (!login) throw new BladPomylki("Podaj klienta — login Allegro albo nazwę z paragonu");
  const coZamowil = tekstPola(dane.coZamowil, "coZamowil", LIMIT_POZYCJI);
  const coDostal = tekstPola(dane.coDostal, "coDostal", LIMIT_POZYCJI);
  const uwagi = tekstPola(dane.uwagi, "uwagi", LIMIT_UWAG);

  return transaction(database, () => {
    if (zamowienie) {
      const jest = database.prepare(`SELECT id FROM pomylka_wysylki
          WHERE ifnull(konto, 0) = ifnull(?, 0) AND zamowienie = ?`).get(konto, zamowienie) as Wiersz | undefined;
      if (jest) return { pomylka: pomylka(Number(jest.id), database)!, nowa: false };
      /* Zgłoszenie z kontem trafia w pomyłkę bez konta tego samego numeru
         i ją uzupełnia — ta sama reguła co u automatu. */
      if (konto !== null) {
        const przejeta = przejmijBezKonta(database, konto, zamowienie, autor, teraz);
        if (przejeta !== null) return { pomylka: pomylka(przejeta, database)!, nowa: false };
      }
    }
    const at = teraz.toISOString();
    const id = Number(database.prepare(`INSERT INTO pomylka_wysylki
        (zgloszono, login, konto, zamowienie, co_zamowil, co_dostal, uwagi, zrodlo, utworzono_at, zmieniono_at)
        VALUES (?,?,?,?,?,?,?,'recznie',?,?)`)
      .run(dataLokalna(at), login, konto, zamowienie, coZamowil, coDostal, uwagi, at, at).lastInsertRowid);
    logEvent("pomylka_dodana", autor.name, null, { pomylka: id }, autor.id, database);
    return { pomylka: pomylka(id, database)!, nowa: true };
  })();
}

export interface ZmianaPomylki {
  wersja?: unknown;
  coZamowil?: unknown; coDostal?: unknown; uwagi?: unknown;
  zbieralUserId?: unknown; pakowalUserId?: unknown;
  winaZbierajacego?: unknown; winaPakujacego?: unknown;
  nowyTowar?: unknown; towarWrocil?: unknown; odmowa?: unknown;
}

/** Wiersz pod blokadą wersji, w otwartej transakcji. */
function doZmiany(database: Db, id: number, wersja: unknown): Wiersz {
  if (!Number.isInteger(wersja)) throw new BladPomylki("Pole „wersja” musi być liczbą całkowitą");
  const w = database.prepare("SELECT * FROM pomylka_wysylki WHERE id = ?").get(id) as Wiersz | undefined;
  if (!w) throw new BrakPomylki();
  if (Number(w.wersja) !== wersja) {
    throw new KonfliktPomylki("Pomyłkę zmienił w międzyczasie ktoś inny — sprawdź i zapisz jeszcze raz",
      pomylka(id, database)!);
  }
  return w;
}

/** Imię z kartoteki kont. Nieznane konto to błąd agenta, nie pusta osoba. */
function nazwaOsoby(database: Db, userId: unknown, pole: string): string {
  if (!Number.isInteger(userId)) throw new BladPomylki(`Pole „${pole}” musi być liczbą całkowitą`);
  const u = database.prepare("SELECT name FROM app_user WHERE user_id = ?").get(Number(userId)) as Wiersz | undefined;
  if (!u) throw new BladPomylki("Nie ma takiego pracownika");
  return String(u.name);
}

function wartoscZListy<T extends string>(v: unknown, lista: readonly T[], pole: string): T | null {
  if (v === null) return null;
  if (typeof v !== "string" || !(lista as readonly string[]).includes(v)) {
    throw new BladPomylki(`Pole „${pole}” przyjmuje: ${lista.join(", ")} albo null`);
  }
  return v as T;
}

/**
 * Zmiana pól pomyłki. Pole nieobecne w ciele zostaje, `null` czyści.
 * Wyczyszczenie osoby zdejmuje też jej winę: wina bez winnego nie ma
 * w rachunku miesiąca czyjego wiersza.
 */
export function zmienPomylke(
  id: number, zmiana: ZmianaPomylki, autor: Autor, teraz = new Date(), database: Db = defaultDb(),
): Pomylka {
  return transaction(database, () => {
    const w = doZmiany(database, id, zmiana.wersja);
    const nowe: Wiersz = {};
    const pola: string[] = [];
    const ustaw = (kolumna: string, wartosc: unknown, pole: string) => {
      nowe[kolumna] = wartosc;
      if (!pola.includes(pole)) pola.push(pole);
    };
    if ("coZamowil" in zmiana) ustaw("co_zamowil", tekstPola(zmiana.coZamowil, "coZamowil", LIMIT_POZYCJI), "coZamowil");
    if ("coDostal" in zmiana) ustaw("co_dostal", tekstPola(zmiana.coDostal, "coDostal", LIMIT_POZYCJI), "coDostal");
    if ("uwagi" in zmiana) ustaw("uwagi", tekstPola(zmiana.uwagi, "uwagi", LIMIT_UWAG), "uwagi");

    for (const [pole, kolumna, wina] of [
      ["zbieralUserId", "zbieral", "wina_zbierajacego"],
      ["pakowalUserId", "pakowal", "wina_pakujacego"],
    ] as const) {
      if (!(pole in zmiana)) continue;
      const v = zmiana[pole];
      if (v === null) {
        ustaw(kolumna, null, pole);
        ustaw(`${kolumna}_user_id`, null, pole);
        ustaw(wina, 0, pole);
      } else {
        ustaw(kolumna, nazwaOsoby(database, v, pole), pole);
        ustaw(`${kolumna}_user_id`, Number(v), pole);
      }
    }
    for (const [pole, wina, kolumna] of [
      ["winaZbierajacego", "wina_zbierajacego", "zbieral"],
      ["winaPakujacego", "wina_pakujacego", "pakowal"],
    ] as const) {
      if (!(pole in zmiana)) continue;
      const v = zmiana[pole];
      if (typeof v !== "boolean") throw new BladPomylki(`Pole „${pole}” musi być prawdą albo fałszem`);
      const ktos = kolumna in nowe ? nowe[kolumna] : w[kolumna];
      if (v && tekst(ktos) === null) throw new BladPomylki("Najpierw wybierz osobę, potem jej winę");
      ustaw(wina, v ? 1 : 0, pole);
    }
    if ("nowyTowar" in zmiana) ustaw("nowy_towar", wartoscZListy(zmiana.nowyTowar, ["tak", "nie"] as const, "nowyTowar"), "nowyTowar");
    if ("odmowa" in zmiana) ustaw("odmowa", wartoscZListy(zmiana.odmowa, ["tak", "nie_trzeba"] as const, "odmowa"), "odmowa");
    if ("towarWrocil" in zmiana) {
      const v = zmiana.towarWrocil;
      if (v !== null && (typeof v !== "string" || (v !== "nie_wraca" && !jestDniem(v)))) {
        throw new BladPomylki("Pole „towarWrocil” przyjmuje datę RRRR-MM-DD, nie_wraca albo null");
      }
      ustaw("towar_wrocil", v, "towarWrocil");
    }

    const kolumny = Object.keys(nowe);
    database.prepare(`UPDATE pomylka_wysylki SET ${kolumny.map((k) => `${k} = ?`).join(", ")}${kolumny.length ? ", " : ""}
        wersja = wersja + 1, zmieniono_at = ? WHERE id = ?`)
      .run(...(kolumny.map((k) => nowe[k]) as never[]), teraz.toISOString(), id);
    /* Nazwy pól, nie wartości: wpis „co dostał” to treść o kliencie. */
    logEvent("pomylka_zmieniona", autor.name, null, { pomylka: id, pola }, autor.id, database);
    return pomylka(id, database)!;
  })();
}

/** Ręczne „Zakończ” — wyjątek, gdy kolejki nie domkną pomyłki same. */
export function zakonczPomylke(
  id: number, wersja: unknown, autor: Autor, teraz = new Date(), database: Db = defaultDb(),
): Pomylka {
  return transaction(database, () => {
    doZmiany(database, id, wersja);
    const at = teraz.toISOString();
    database.prepare(`UPDATE pomylka_wysylki SET zakonczono_at = ?, wersja = wersja + 1, zmieniono_at = ?
        WHERE id = ?`).run(at, at, id);
    logEvent("pomylka_zakonczona", autor.name, null, { pomylka: id }, autor.id, database);
    return pomylka(id, database)!;
  })();
}

/** Cofa ręczne zakończenie. Stan wraca do liczonego z kolejek. */
export function wznowPomylke(
  id: number, wersja: unknown, autor: Autor, teraz = new Date(), database: Db = defaultDb(),
): Pomylka {
  return transaction(database, () => {
    doZmiany(database, id, wersja);
    database.prepare(`UPDATE pomylka_wysylki SET zakonczono_at = NULL, wersja = wersja + 1, zmieniono_at = ?
        WHERE id = ?`).run(teraz.toISOString(), id);
    logEvent("pomylka_wznowiona", autor.name, null, { pomylka: id }, autor.id, database);
    return pomylka(id, database)!;
  })();
}

/* ── Pozycje do wyboru ──────────────────────────────────────────────────── */

export interface PozycjaDoWyboru { nazwa: string; ilosc: number; sku: string | null }

/**
 * Pozycje zamówienia do jednego kliknięcia „co zamówił”. Bez pobranego
 * zamówienia bierze pozycje zwrotu, bo klient zgłasza w nim to, co kupił.
 * Podpowiedź „co dostał” to komentarz klienta ze zwrotu — często pisze
 * wprost, co przyszło zamiast zamówionego.
 */
export function pozycjeDoWyboru(
  id: number, database: Db = defaultDb(),
): { pozycje: PozycjaDoWyboru[]; podpowiedz: string | null } {
  const p = database.prepare("SELECT konto, zamowienie FROM pomylka_wysylki WHERE id = ?").get(id) as Wiersz | undefined;
  if (!p) throw new BrakPomylki();
  const zamowienie = tekst(p.zamowienie);
  if (p.konto == null || zamowienie === null) return { pozycje: [], podpowiedz: null };
  const konto = Number(p.konto);
  let pozycje = (database.prepare(`SELECT x.nazwa, x.ilosc, x.sku FROM zamowienie_klienta_pozycja x
      JOIN zamowienie_klienta z ON z.id = x.zamowienie_id
     WHERE z.channel_account_id = ? AND z.external_id = ? ORDER BY x.id`).all(konto, zamowienie) as Wiersz[])
    .map((x) => ({ nazwa: String(x.nazwa), ilosc: Number(x.ilosc), sku: tekst(x.sku) }));
  if (pozycje.length === 0) {
    pozycje = (database.prepare(`SELECT x.nazwa, x.ilosc FROM zwrot_klienta_pozycja x
        JOIN zwrot_klienta z ON z.id = x.zwrot_id
       WHERE z.channel_account_id = ? AND z.order_id = ? ORDER BY x.id`).all(konto, zamowienie) as Wiersz[])
      .map((x) => ({ nazwa: String(x.nazwa), ilosc: Number(x.ilosc), sku: null }));
  }
  const k = database.prepare(`SELECT x.powod_komentarz FROM zwrot_klienta_pozycja x
      JOIN zwrot_klienta z ON z.id = x.zwrot_id
     WHERE z.channel_account_id = ? AND z.order_id = ? AND trim(ifnull(x.powod_komentarz, '')) <> ''
     ORDER BY z.created_at DESC, x.id LIMIT 1`).get(konto, zamowienie) as Wiersz | undefined;
  return { pozycje, podpowiedz: tekst(k?.powod_komentarz) };
}
