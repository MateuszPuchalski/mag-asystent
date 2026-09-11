import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { linkZamowienia } from "./allegro-linki.js";
import {
  BladReklamacji,
  czatReklamacji,
  doZapisu,
  kontekstZamowienia,
  zalacznikiSprawy,
  type RozmowaZakupu,
  type WiadomoscReklamacji,
  type ZalacznikReklamacji,
} from "./reklamacje.js";
import type { WierszZwrotu } from "./zwroty.js";

/* ── Dyskusje klienckie — model pracy biura (0.245.0) ────────────────────────
   Rozmowa posprzedażowa, którą kupujący otwiera przy zamówieniu, zanim złoży
   reklamację. Allegro trzyma ją tym samym zasobem `/sale/issues` i tą samą
   tabelą co reklamację; rozróżnia je kolumna `typ`.

   TEN PLIK CZYTA WYŁĄCZNIE `typ = 'DISPUTE'` i musi to mówić KAŻDYM
   zapytaniem — tak samo, jak `reklamacje.ts` mówi `'CLAIM'`. Pominięcie
   warunku po którejkolwiek stronie daje bliznę 0.121.0: „CLAIM miał tę samą
   plakietkę co zwykła dyskusja". Pilnuje tego strażnik w `dyskusje.test.ts`,
   który czyta ŹRÓDŁO obu plików.

   TRZY RZECZY, KTÓRYCH DYSKUSJA NIE MA, a reklamacja ma:

   1. ZEGARA. `decisionDueDate` i `currentState.statusDueDate` są w schemacie
      opisane jako `Null for disputes`. Pilność liczymy więc sami — i mówimy
      o tym wprost, patrz `czekaOdDni`.
   2. WERDYKTU. `POST /sale/issues/{id}/status` ma adnotację „Not a valid
      operation for disputes". Jedyny zapis przewidziany wyłącznie dla dyskusji
      to `MessageRequest.type = "END_REQUEST"` (`dyskusja-zakonczenie.ts`).
   3. OFERTY. `offer`, `reason`, `right`, `expectations` i `referenceNumber`
      są przy dyskusji nieobecne. Wiersz kolejki niesie więc numer zamówienia,
      a nie zdjęcie towaru — i kolumna faktów jest chudsza, co ekran mówi
      zamiast udawać pełną.                                                   */

export type KubelekDyskusji = "odpowiedz" | "klient" | "zamknieta";

export type SygnalDyskusji =
  | "klient_czeka"
  | "doradca"
  | "czat_zamkniety"
  | "nierozstrzygnieta"
  | "status_nieznany";

/**
 * Statusy dyskusji ze specyfikacji (`PostPurchaseIssueStatus`).
 *
 * Wartość spoza tej listy NIE JEST BŁĘDEM: nie wywraca odczytu i nie znika
 * z ekranu, tylko zapala sygnał. To ten sam mechanizm weryfikacji listy na
 * żywym koncie, co przy reklamacjach.
 */
export const STATUSY_DYSKUSJI = [
  "DISPUTE_ONGOING", "DISPUTE_CLOSED", "DISPUTE_UNRESOLVED",
] as const;

/** Status końcowy — po nim rozmowa już niczego nie zmieni. */
const ZAMKNIETA = "DISPUTE_CLOSED";

/**
 * Statusy ostatniej wiadomości, przy których ruch należy do NAS.
 *
 * RÓŻNI SIĘ OD REKLAMACJI I TO JEST DECYZJA, nie przeoczenie. Tam
 * `CZEKA_NA_NAS` to `NEW` i `BUYER_REPLIED`, a doradca Allegro jest samym
 * sygnałem — bo o kolejności pracy rozstrzyga tam zegar.
 *
 * Dyskusja zegara nie ma, a doradca odezwał się jako ostatni w 61 sprawach
 * na 100 w sondzie. Zostawienie go poza tą listą wsadziłoby WIĘKSZOŚĆ dyskusji
 * do kubełka „czeka na klienta" w chwili, gdy czeka Allegro — czyli kolejka
 * mówiłaby dokładnie odwrotnie, niż jest.
 */
const RUCH_NASZ = ["NEW", "BUYER_REPLIED", "ALLEGRO_ADVISOR_REPLIED"];

/**
 * Ile dni czekania wyróżnia wiersz.
 *
 * Ta sama liczba co `PROG_TERMINU_DNI` przy reklamacjach i to jest cały powód:
 * agent nie ma uczyć się dwóch progów na dwóch ekranach tego samego panelu.
 */
export const PROG_CZEKANIA_DNI = 3;

const DZIEN_MS = 86_400_000;

export interface WierszDyskusji {
  id: number;
  externalId: string;
  orderId: string | null;
  kupujacyLogin: string | null;
  temat: string | null;
  opis: string | null;
  statusAllegro: string | null;
  czatAktywny: boolean;
  wiadomosciIle: number;
  /** Czy rozmowę urwał NASZ bezpiecznik stron (0.273.0) — patrz `czat_urwany`. */
  czatUrwany: boolean;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt: string | null;
  /** Czy ruch należy do nas — z niego biorą się kubełek i czas czekania. */
  ruchNasz: boolean;
  /**
   * Ile dni piłka jest po naszej stronie. `null`, gdy nie jest.
   *
   * TO NIE JEST TERMIN i ekran nie ma prawa tak tego nazwać. Allegro dla
   * dyskusji żadnego zegara nie oddaje; ta liczba jest faktem o NASZEJ
   * skrzynce, nie zobowiązaniem wobec kupującego. Blizna 0.121.0 była
   * dokładnie odwrotna — ustawowy zegar czternastu dni liczony przez nas
   * i rozjeżdżający się z tym, co widział kupujący.
   */
  czekaOdDni: number | null;
  dlugoCzeka: boolean;
  otwartoAt: string;
  prowadzi: string | null;
  prowadziAt: string | null;
  notatka: string | null;
  /* ── Prośba o zakończenie (`END_REQUEST`) ────────────────────────────────
     Los NASZEJ próby, nie stan Allegro. `status_allegro` należy do Allegro
     i potwierdza go dopiero synchronizacja. */
  zakonczenieStatus: StatusZakonczenia | null;
  zakonczenieAt: string | null;
  zakonczeniePrzez: string | null;
  wersja: number;
  kubelek: KubelekDyskusji;
  sygnaly: SygnalDyskusji[];
  /**
   * Odnośnik do zamówienia. Adresu SAMEJ dyskusji w Centrum Sprzedaży
   * świadomie nie budujemy — wzorzec `/claims/{id}` dotyczy reklamacji,
   * a zgadnięty z analogii dał już raz 404 (blizna 0.226.1). Zamówienie
   * jest adresem sprawdzonym i prowadzi tam, skąd dyskusję widać.
   */
  linkZamowienia: string | null;
}

/**
 * Losy prośby o zakończenie — DWA, nie cztery jak przy werdykcie.
 *
 * Porażka kodem nie dotyka wiersza: zostaje w skrzynce nadawczej, a agent może
 * spróbować jeszcze raz. Na sprawie stoi wyłącznie to, po czym drugiej próby
 * robić NIE WOLNO — bo pierwsza mogła dojść.
 */
export type StatusZakonczenia = "sent" | "send_uncertain";

/** Losy, przy których prośbę UZNAJEMY za wysłaną: poszła albo mogła pójść. */
export const ZAKONCZENIE_WYSLANE: readonly string[] = ["sent", "send_uncertain"];

type Wiersz = Record<string, unknown>;

const tekst = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** Czy ruch należy do nas: rozmowa żyje, a ostatnie słowo nie było nasze. */
export function ruchNalezyDoNas(w: {
  ostatniaWiadomoscStatus: string | null; czatAktywny: boolean;
}): boolean {
  return w.czatAktywny && RUCH_NASZ.includes(w.ostatniaWiadomoscStatus ?? "");
}

/**
 * Ile dni czekamy z odpowiedzią — czysta arytmetyka, osobno od bazy.
 *
 * `null`, gdy ruch nie należy do nas albo daty nie ma. Liczba przy sprawie,
 * w której nie mamy nic do zrobienia, kazałaby ją czytać jak zaległość.
 */
export function czekaOdDni(
  ostatniaAt: string | null, ruchNasz: boolean, teraz = Date.now(),
): number | null {
  if (!ruchNasz || !ostatniaAt) return null;
  const t = Date.parse(ostatniaAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((teraz - t) / DZIEN_MS));
}

/**
 * Kubełek dyskusji — jedno pytanie na kubełek (dekalog, punkt 5).
 *
 * Trzy, tyle samo co przy reklamacjach, więc klawisze `1`–`3` zachowują
 * naturę na obu ekranach.
 */
export function kubelekDyskusji(w: {
  statusAllegro: string | null; ostatniaWiadomoscStatus: string | null; czatAktywny: boolean;
}): KubelekDyskusji {
  if (w.statusAllegro === ZAMKNIETA || !w.czatAktywny) return "zamknieta";
  return ruchNalezyDoNas(w) ? "odpowiedz" : "klient";
}

export function sygnalyDyskusji(w: {
  statusAllegro: string | null; ostatniaWiadomoscStatus: string | null; czatAktywny: boolean;
}): SygnalDyskusji[] {
  const s: SygnalDyskusji[] = [];
  if (ruchNalezyDoNas(w)) s.push("klient_czeka");
  /* Trzecia strona CZYTA tę rozmowę i to zmienia ton odpowiedzi — ten sam
     powód co przy reklamacji, tylko częstszy: 61 spraw na 100 w sondzie. */
  if (w.ostatniaWiadomoscStatus === "ALLEGRO_ADVISOR_REPLIED") s.push("doradca");
  if (!w.czatAktywny) s.push("czat_zamkniety");
  /* Sonda nie widziała ANI JEDNEJ na sto, więc gdy się pojawi, jest
     wiadomością samą w sobie: Allegro uznało dyskusję za nierozstrzygniętą. */
  if (w.statusAllegro === "DISPUTE_UNRESOLVED") s.push("nierozstrzygnieta");
  if (w.statusAllegro && !(STATUSY_DYSKUSJI as readonly string[]).includes(w.statusAllegro)) {
    s.push("status_nieznany");
  }
  return s;
}

function zWiersza(w: Wiersz, teraz: number): WierszDyskusji {
  const statusAllegro = tekst(w.status_allegro);
  const czatAktywny = Number(w.czat_aktywny ?? 1) === 1;
  const ostatnia = tekst(w.ostatnia_wiadomosc_status);
  const ostatniaAt = tekst(w.ostatnia_wiadomosc_at);
  const rdzen = { statusAllegro, ostatniaWiadomoscStatus: ostatnia, czatAktywny };
  const ruchNasz = ruchNalezyDoNas(rdzen);
  const czeka = czekaOdDni(ostatniaAt, ruchNasz, teraz);
  return {
    id: Number(w.id),
    externalId: String(w.external_id),
    orderId: tekst(w.order_id),
    kupujacyLogin: tekst(w.kupujacy_login),
    temat: tekst(w.temat),
    opis: tekst(w.opis),
    statusAllegro,
    czatAktywny,
    wiadomosciIle: Number(w.wiadomosci_ile ?? 0),
    czatUrwany: Number(w.czat_urwany ?? 0) === 1,
    ostatniaWiadomoscStatus: ostatnia,
    ostatniaWiadomoscAt: ostatniaAt,
    ruchNasz,
    czekaOdDni: czeka,
    dlugoCzeka: czeka !== null && czeka >= PROG_CZEKANIA_DNI,
    otwartoAt: String(w.otwarto_at),
    prowadzi: tekst(w.prowadzi),
    prowadziAt: tekst(w.prowadzi_at),
    notatka: tekst(w.notatka),
    zakonczenieStatus: tekst(w.zakonczenie_status) as StatusZakonczenia | null,
    zakonczenieAt: tekst(w.zakonczenie_at),
    zakonczeniePrzez: tekst(w.zakonczenie_przez),
    wersja: Number(w.wersja ?? 1),
    kubelek: kubelekDyskusji(rdzen),
    sygnaly: sygnalyDyskusji(rdzen),
    linkZamowienia: linkZamowienia(tekst(w.order_id)),
  };
}

/**
 * Cała kolejka jednym odczytem.
 *
 * Dyskusji w pracy są dziesiątki, nie tysiące, więc panel dostaje listę
 * w całości i filtruje kubełkiem u siebie — przełączenie kubełka nie kosztuje
 * wtedy ani jednego żądania. Ten sam wybór co przy zwrotach i reklamacjach.
 *
 * PORZĄDEK BIERZE SIĘ Z CZASU CZEKANIA, nie z daty otwarcia. Pytanie biura
 * brzmi „kto czeka na nas najdłużej", a nie „co przyszło pierwsze" — i tylko
 * na to pytanie mamy tu czym odpowiedzieć, bo terminu Allegro nie daje.
 * Sprawy, w których ruch należy do klienta, idą po nich: nie czekają na nas.
 */
export function listaDyskusji(
  database: Db = defaultDb(), teraz = Date.now(),
): WierszDyskusji[] {
  const wiersze = database.prepare(`
    SELECT r.* FROM reklamacja_klienta r
     WHERE r.typ = 'DISPUTE'
     ORDER BY r.ostatnia_wiadomosc_at IS NULL, r.ostatnia_wiadomosc_at ASC,
              r.otwarto_at ASC`).all() as Wiersz[];
  /* Sortowanie „kto czeka najdłużej" domykamy w pamięci, bo `ruchNasz` nie
     jest kolumną — liczy go ten plik ze statusu ostatniej wiadomości. SQL
     musiałby powtórzyć tę regułę drugi raz i rozjechać się przy pierwszej
     poprawce. Wierszy są dziesiątki, więc to nic nie kosztuje. */
  return wiersze
    .map((w) => zWiersza(w, teraz))
    .sort((a, b) => Number(b.ruchNasz) - Number(a.ruchNasz));
}

export function licznikiDyskusji(
  lista: WierszDyskusji[],
): Record<KubelekDyskusji, number> {
  const l: Record<KubelekDyskusji, number> = { odpowiedz: 0, klient: 0, zamknieta: 0 };
  for (const d of lista) l[d.kubelek] += 1;
  return l;
}

export interface SzczegolDyskusji {
  dyskusja: WierszDyskusji;
  czat: WiadomoscReklamacji[];
  zalaczniki: ZalacznikReklamacji[];
  /** Zwroty tego samego zamówienia — ten sam mostek co przy reklamacji. */
  zwroty: WierszZwrotu[];
  rozmowy: RozmowaZakupu[];
}

/**
 * Wszystko o jednej dyskusji — CZYSTY ODCZYT.
 *
 * Otwarcie niczego nie mutuje (blizna 0.18.0). Rozmowa dociąga się taktem
 * synchronizacji, a nie wejściem na ekran.
 */
export function szczegolDyskusji(
  database: Db, id: number, teraz = Date.now(),
): SzczegolDyskusji {
  const w = database.prepare(
    "SELECT * FROM reklamacja_klienta WHERE id=? AND typ='DISPUTE'",
  ).get(id) as Wiersz | undefined;
  /* Reklamacja pod tym identyfikatorem to dla TEGO ekranu brak: ma werdykt
     i zegar, których ten ekran nie pokazuje, więc otwarcie jej tutaj
     pokazałoby sprawę uboższą, niż jest naprawdę. */
  if (!w) throw new BladReklamacji(`Dyskusja ${id} nie istnieje`, 404);
  const dyskusja = zWiersza(w, teraz);
  const { zwroty, rozmowy } = kontekstZamowienia(
    database, Number(w.channel_account_id), dyskusja.orderId, teraz);
  return {
    dyskusja,
    czat: czatReklamacji(database, id),
    zalaczniki: zalacznikiSprawy(database, id),
    zwroty, rozmowy,
  };
}

/**
 * Kto prowadzi dyskusję — ZNACZNIK, nie zamek.
 *
 * Ta sama doktryna i ten sam przełącznik co przy reklamacji, ale WŁASNA
 * funkcja i własna nazwa zdarzenia. Ślad audytowy ma mówić, z którego ekranu
 * padło kliknięcie: `reklamacja_prowadzi` przy dyskusji byłby zapisem
 * nieprawdziwym, a `events` nie ma retencji.
 */
export function stempelProwadziDyskusje(
  database: Db, id: number, autor: string, wersja?: number,
): WierszDyskusji {
  return transaction(database, () => {
    const w = doZapisu(database, id, wersja, "DISPUTE");
    const zdejmuje = w.prowadzi === autor;
    database.prepare(`UPDATE reklamacja_klienta
      SET prowadzi=?, prowadzi_at=?, wersja=wersja+1 WHERE id=? AND typ='DISPUTE'`).run(
      zdejmuje ? null : autor, zdejmuje ? null : new Date().toISOString(), id);
    logEvent("dyskusja_prowadzi", autor, null, { id, zdjete: zdejmuje }, undefined, database);
    return zWiersza(odczytaj(database, id), Date.now());
  })();
}

/**
 * Notatka biura — nasze ustalenia, których Allegro nie zna.
 *
 * Do dziennika idzie DŁUGOŚĆ, nigdy treść: notatka bywa zdaniem o kliencie,
 * a `events` nie ma retencji i nie jest kasowane.
 */
export function zapiszNotatkeDyskusji(
  database: Db, id: number, notatka: string | null, autor: string, wersja?: number,
): WierszDyskusji {
  const wartosc = (notatka ?? "").trim() || null;
  return transaction(database, () => {
    doZapisu(database, id, wersja, "DISPUTE");
    database.prepare(
      "UPDATE reklamacja_klienta SET notatka=?, wersja=wersja+1 WHERE id=? AND typ='DISPUTE'",
    ).run(wartosc, id);
    logEvent("dyskusja_notatka", autor, null,
      { id, znakow: wartosc?.length ?? 0 }, undefined, database);
    return zWiersza(odczytaj(database, id), Date.now());
  })();
}

/** Odczyt wiersza po mutacji. Warunek na `typ` stoi i tutaj — bez wyjątków. */
function odczytaj(database: Db, id: number): Wiersz {
  return database.prepare(
    "SELECT * FROM reklamacja_klienta WHERE id=? AND typ='DISPUTE'",
  ).get(id) as Wiersz;
}
