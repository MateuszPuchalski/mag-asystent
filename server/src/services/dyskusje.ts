import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import {
  TAGI_REKLAMACJI, tagiSprawy, tagiWszystkichSpraw, type TagSprawy,
} from "./tagi-spraw.js";
import { linkDyskusji, linkZamowienia } from "./allegro-linki.js";
import { czyAutoodpowiedzSprawy } from "./autoresponder.js";
import {
  BladReklamacji,
  cofnijNotatkeSprawy,
  czatReklamacji,
  doZapisu,
  pisanieNotatki,
  kontekstZamowienia,
  zalacznikiSprawy,
  type RozmowaZakupu,
  type WiadomoscReklamacji,
  type ZalacznikReklamacji,
} from "./reklamacje.js";
import type { WierszZwrotu } from "./zwroty.js";
import type { PrzystanekDrogi, SprawaZakupu } from "./droga-klienta.js";
import type { Zamowienie } from "./zamowienia.js";
import type { StanPrzesylkiZamowienia } from "./przesylka-zamowienia.js";

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
 * Statusy, które czyta zapytanie alarmu. `SELLER_REPLIED` wchodzi, bo bywa
 * naszą autoodpowiedzią, a ta nie zdejmuje sprawy z kolejki. Rozstrzyga
 * `statusBezAutoodpowiedzi` w pamięci, nie SQL.
 */
const STATUSY_ALARMU = [...RUCH_NASZ, "SELLER_REPLIED"];

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
   *
   * LICZONA OD PYTANIA, NA KTÓRE NIE ODPOWIEDZIELIŚMY, nie od ostatniej
   * wiadomości: patrz `bezOdpowiedziOd`.
   */
  czekaOdDni: number | null;
  /** Ta sama miara w godzinach — dla ekranu, który poniżej doby pokazuje godziny. */
  czekaOdGodzin: number | null;
  /** Od kiedy pytanie czeka na nasze słowo. `null`, gdy ruch nie jest nasz. */
  bezOdpowiedziOd: string | null;
  /**
   * Czekanie przekroczyło próg alarmu (`DYSKUSJE_ALARM_GODZIN`). Próg liczy
   * serwer, żeby wiersz, pasek alarmu i zdanie w stanie systemu nie mogły
   * się rozjechać na dwóch liczbach.
   */
  pilna: boolean;
  dlugoCzeka: boolean;
  otwartoAt: string;
  prowadzi: string | null;
  /** Tożsamość prowadzącego — po NIEJ liczy się filtr „Moje" (0.278.0). */
  prowadziId: number | null;
  prowadziAt: string | null;
  /** Tagi biura (0.279.0) — ten sam słownik co przy reklamacjach. */
  tagi: TagSprawy[];
  notatka: string | null;
  /** Droga powrotna z notatki (0.280.0) — patrz `WierszReklamacji`. */
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  maPoprzedniaNotatke: boolean;
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
   * Sama dyskusja w Centrum Sprzedaży. Adres sprawdzony kliknięciem, a nie
   * zgadnięty z analogii do reklamacji: tamten wzorzec `/claims/{id}` dotyczy
   * innej strony i przy dyskusji dałby 404.
   */
  link: string | null;
  /** Odnośnik do zamówienia, z którego dyskusja wyrosła. */
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

/** Rola, którą Allegro podpisuje nasze wiadomości (`MessageAuthorRole`). */
const NASZA_ROLA = "SELLER";

/**
 * Role, których wiadomość czeka na nasze słowo: kupujący i doradca Allegro.
 * `SYSTEM` i `FULFILLMENT` to automaty, które niczego od nas nie żądają.
 */
const ROLE_CZEKAJACE: readonly string[] = ["BUYER", "ADMIN"];

const GODZINA_MS = 3_600_000;

export interface WiadomoscCzasu {
  rola: string | null;
  at: string | null;
  /** Autoodpowiedź z naszego konta — Allegro nie uznaje jej za odpowiedź. */
  auto?: boolean;
}

/** Role automatów, które niczego od nas nie żądają ani niczego nie zamykają. */
const ROLE_AUTOMATOW: readonly string[] = ["SYSTEM", "FULFILLMENT"];

/**
 * Status ostatniej wiadomości po zdjęciu NASZEJ autoodpowiedzi z końca rozmowy.
 *
 * Allegro liczy `lastMessage.status` z ostatniej wiadomości jak leci, więc
 * autoodpowiedź z naszego konta daje `SELLER_REPLIED`. Odpowiedzią jednak nie
 * jest — Allegro samo pisze kupującym i nam, że automatów nie uznaje. Kubełek,
 * zegar i alarm mają więc patrzeć na ostatnią PRAWDZIWĄ wiadomość.
 *
 * Zmieniamy status WYŁĄCZNIE wtedy, gdy ostatnią wiadomością, jaką mamy, jest
 * właśnie autoodpowiedź. Rozmowa dociąga się taktem, więc przy niepełnej
 * liście ostatnią może być stare pytanie klienta, a Allegro mówi już o naszej
 * prawdziwej odpowiedzi. Wtedy wierzymy Allegro, nie urwanej liście.
 */
export function statusBezAutoodpowiedzi(
  status: string | null, wiadomosci: WiadomoscCzasu[],
): string | null {
  if (status !== "SELLER_REPLIED") return status;
  const wg = wiadomosci
    .map((m) => ({ ...m, t: Date.parse(m.at ?? "") }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);
  const ostatnia = wg[wg.length - 1];
  if (!ostatnia || ostatnia.rola !== NASZA_ROLA || !ostatnia.auto) return status;
  for (let i = wg.length - 1; i >= 0; i -= 1) {
    const m = wg[i];
    if (m.auto || ROLE_AUTOMATOW.includes(m.rola ?? "")) continue;
    if (m.rola === NASZA_ROLA) return "SELLER_REPLIED";
    if (m.rola === "ADMIN") return "ALLEGRO_ADVISOR_REPLIED";
    return "BUYER_REPLIED";
  }
  /* Same automaty: nikt z biura jeszcze nie napisał ani słowa. */
  return "NEW";
}

/**
 * Od kiedy dyskusja czeka na naszą odpowiedź — czysta arytmetyka na liście
 * wiadomości.
 *
 * LICZYMY OD NAJSTARSZEJ WIADOMOŚCI PO NASZEJ OSTATNIEJ ODPOWIEDZI, nie od
 * ostatniej wiadomości w ogóle. Doradca Allegro odpisuje jako ostatni w co
 * drugiej dyskusji, a jego zdanie zerowało licznik: pytanie kupującego sprzed
 * czterech dni, na które nikt nie odpowiedział, wyglądało na sprawę z dzisiaj.
 * Tak wyglądała dyskusja, za którą Allegro zablokowało konto: stała w kolejce
 * jako „dziś" i nikt jej nie otworzył.
 *
 * Gdy lista wiadomości jest niepełna (czat urwany bezpiecznikiem stron, sprawa
 * jeszcze niedociągnięta), zapas ZAWYŻA czas, nigdy go nie zaniża: blokada
 * konta kosztuje więcej niż nadmiarowy pasek.
 *   1. Jest nasza odpowiedź, a po niej niczego od drugiej strony: liczymy od
 *      NASZEJ odpowiedzi. Status ostatniej wiadomości mówi, że ktoś napisał
 *      po nas, tylko tej wiadomości nie mamy.
 *   2. Nie ma żadnej naszej odpowiedzi: od ostatniej wiadomości, a bez jej
 *      daty od otwarcia sprawy, które jest ustawione zawsze.
 */
export function bezOdpowiedziOd(
  wiadomosci: WiadomoscCzasu[], ostatniaAt: string | null, ruchNasz: boolean,
  otwartoAt: string | null = null,
): string | null {
  if (!ruchNasz) return null;
  const wg = wiadomosci
    .map((m) => ({ rola: m.rola ?? "", auto: m.auto === true, t: Date.parse(m.at ?? "") }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);
  let naszaOstatnia = -1;
  /* Autoodpowiedź nie jest naszą odpowiedzią i nie zeruje zegara — powód
     przy `statusBezAutoodpowiedzi`. */
  wg.forEach((m, i) => { if (m.rola === NASZA_ROLA && !m.auto) naszaOstatnia = i; });
  const pierwsza = wg.slice(naszaOstatnia + 1).find((m) => ROLE_CZEKAJACE.includes(m.rola));
  if (pierwsza) return new Date(pierwsza.t).toISOString();
  if (naszaOstatnia >= 0) return new Date(wg[naszaOstatnia].t).toISOString();
  return ostatniaAt ?? otwartoAt;
}

/** Pełne godziny od `od` do `teraz`; `null` bez daty. */
export function godzinyOd(od: string | null, teraz = Date.now()): number | null {
  if (!od) return null;
  const t = Date.parse(od);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((teraz - t) / GODZINA_MS));
}

/** Wiadomości wskazanych dyskusji jednym zapytaniem, pogrupowane po sprawie. */
function wiadomosciCzasu(database: Db, ids: number[]): Map<number, WiadomoscCzasu[]> {
  const wynik = new Map<number, WiadomoscCzasu[]>();
  if (ids.length === 0) return wynik;
  const wiersze = database.prepare(
    `SELECT reklamacja_id, autor_rola, utworzono_at, tresc FROM reklamacja_wiadomosc
      WHERE reklamacja_id IN (${ids.map(() => "?").join(",")})`,
  ).all(...ids) as Array<{
    reklamacja_id: number; autor_rola: string | null; utworzono_at: string | null; tresc: string | null;
  }>;
  for (const m of wiersze) {
    const lista = wynik.get(m.reklamacja_id) ?? [];
    lista.push({
      rola: m.autor_rola, at: m.utworzono_at,
      auto: m.autor_rola === NASZA_ROLA && czyAutoodpowiedzSprawy(m.tresc ?? ""),
    });
    wynik.set(m.reklamacja_id, lista);
  }
  return wynik;
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

function zWiersza(w: Wiersz, teraz: number, wiadomosci: WiadomoscCzasu[] = []): WierszDyskusji {
  const statusAllegro = tekst(w.status_allegro);
  const czatAktywny = Number(w.czat_aktywny ?? 1) === 1;
  const ostatnia = statusBezAutoodpowiedzi(tekst(w.ostatnia_wiadomosc_status), wiadomosci);
  const ostatniaAt = tekst(w.ostatnia_wiadomosc_at);
  const rdzen = { statusAllegro, ostatniaWiadomoscStatus: ostatnia, czatAktywny };
  const ruchNasz = ruchNalezyDoNas(rdzen);
  const bezOdpowiedzi = bezOdpowiedziOd(wiadomosci, ostatniaAt, ruchNasz, tekst(w.otwarto_at));
  const czeka = czekaOdDni(bezOdpowiedzi, ruchNasz, teraz);
  const godzin = ruchNasz ? godzinyOd(bezOdpowiedzi, teraz) : null;
  const kubelek = kubelekDyskusji(rdzen);
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
    czekaOdGodzin: godzin,
    bezOdpowiedziOd: bezOdpowiedzi,
    pilna: kubelek === "odpowiedz" && godzin !== null && godzin >= config.allegro.dyskusjeAlarmGodzin,
    dlugoCzeka: czeka !== null && czeka >= PROG_CZEKANIA_DNI,
    otwartoAt: String(w.otwarto_at),
    prowadzi: tekst(w.prowadzi),
    prowadziId: w.prowadzi_user_id == null ? null : Number(w.prowadzi_user_id),
    prowadziAt: tekst(w.prowadzi_at),
    /* Puste do czasu doklejenia — powód przy tym samym polu w reklamacjach. */
    tagi: [],
    notatka: tekst(w.notatka),
    notatkaAt: tekst(w.notatka_at),
    notatkaPrzez: tekst(w.notatka_przez),
    maPoprzedniaNotatke: tekst(w.notatka_poprzednia) !== null,
    zakonczenieStatus: tekst(w.zakonczenie_status) as StatusZakonczenia | null,
    zakonczenieAt: tekst(w.zakonczenie_at),
    zakonczeniePrzez: tekst(w.zakonczenie_przez),
    wersja: Number(w.wersja ?? 1),
    kubelek,
    sygnaly: sygnalyDyskusji(rdzen),
    link: linkDyskusji(tekst(w.external_id)),
    linkZamowienia: linkZamowienia(tekst(w.order_id)),
  };
}

/**
 * Wiersz po zapisie liczony z WIADOMOŚCIAMI, jak w kolejce. Bez nich zegar
 * i autoodpowiedź liczyłyby się inaczej niż na liście, a ekran po kliknięciu
 * „prowadzę" pokazywałby na chwilę inny kubełek niż kolejka obok.
 */
function wierszPoZapisie(database: Db, id: number): WierszDyskusji {
  return zWiersza(odczytaj(database, id), Date.now(), wiadomosciCzasu(database, [id]).get(id) ?? []);
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
 *
 * PRÓG DATY TEN SAM CO PRZY REKLAMACJACH i z tego samego powodu: obie kolejki
 * karmi ta sama tabela i ten sam pełny przelot listy z 0.273.0, który zapisuje
 * całe archiwum konta. Tutaj jest nawet ciaśniej — porządek „kto czeka
 * najdłużej" stawia najstarsze na samej górze z definicji. Naprawienie połowy
 * ekranu byłoby wydaniem do wyrzucenia za tydzień.
 */
export function listaDyskusji(
  database: Db = defaultDb(), teraz = Date.now(),
  od: string | null = config.allegro.reklamacjeOd,
): WierszDyskusji[] {
  const wiersze = database.prepare(`
    SELECT r.* FROM reklamacja_klienta r
     WHERE r.typ = 'DISPUTE' AND (? IS NULL OR r.otwarto_at >= ?)
     ORDER BY r.ostatnia_wiadomosc_at IS NULL, r.ostatnia_wiadomosc_at ASC,
              r.otwarto_at ASC`).all(od, od) as Wiersz[];
  /* Sortowanie „kto czeka najdłużej" domykamy w pamięci, bo `ruchNasz` nie
     jest kolumną — liczy go ten plik ze statusu ostatniej wiadomości. SQL
     musiałby powtórzyć tę regułę drugi raz i rozjechać się przy pierwszej
     poprawce. Wierszy są dziesiątki, więc to nic nie kosztuje. */
  const tagi = tagiWszystkichSpraw(database, TAGI_REKLAMACJI);
  const wiadomosci = wiadomosciCzasu(database, wiersze.map((w) => Number(w.id)));
  /* Porządek „kto czeka najdłużej" liczymy od PYTANIA bez odpowiedzi, a nie od
     ostatniej wiadomości, więc SQL go już nie rozstrzyga. Sprawy, w których
     ruch jest po stronie klienta, nie mają zegara i idą na koniec. */
  const czas = (d: WierszDyskusji): number =>
    d.bezOdpowiedziOd ? Date.parse(d.bezOdpowiedziOd) : Number.POSITIVE_INFINITY;
  return wiersze
    .map((w) => {
      const d = zWiersza(w, teraz, wiadomosci.get(Number(w.id)) ?? []);
      d.tagi = tagi.get(d.id) ?? [];
      return d;
    })
    .sort((a, b) => Number(b.ruchNasz) - Number(a.ruchNasz)
      || (czas(a) === czas(b) ? 0 : czas(a) < czas(b) ? -1 : 1));
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
  /** Reklamacje i inne dyskusje tego zakupu — bez tej sprawy (S1 spoiwa). */
  sprawy: SprawaZakupu[];
  /** Droga zakupu przez cztery kolejki, w kolejności czasu (S3 spoiwa). */
  droga: PrzystanekDrogi[];
  /** Zamówienie z pozycjami i cenami (0.393.0). */
  zamowienie: Zamowienie | null;
  /** Co wiemy o paczce do klienta (0.393.0). */
  przesylka: StanPrzesylkiZamowienia | null;
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
  const dyskusja = zWiersza(w, teraz, wiadomosciCzasu(database, [id]).get(id) ?? []);
  dyskusja.tagi = tagiSprawy(database, TAGI_REKLAMACJI, id);
  const { zwroty, rozmowy, sprawy, droga, zamowienie, przesylka } = kontekstZamowienia(
    database, Number(w.channel_account_id), dyskusja.orderId, teraz, id);
  return {
    dyskusja,
    czat: czatReklamacji(database, id),
    zalaczniki: zalacznikiSprawy(database, id),
    zwroty, rozmowy, zamowienie, przesylka,
    /* Rodzeństwo posprzedażowe i droga zakupu (S1 i S3 spoiwa). Dyskusja jest
       tu przypadkiem najważniejszym: ona zwykle poprzedza reklamację, więc
       agent ma widzieć, czy sprawa poszła już dalej — i nie obiecywać
       rozstrzygnięcia w kanale, który stracił nad nią władzę. */
    sprawy, droga,
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
  database: Db, id: number, autor: { id: number; name: string }, wersja?: number,
): WierszDyskusji {
  return transaction(database, () => {
    const w = doZapisu(database, id, wersja, "DISPUTE");
    /* Po TOŻSAMOŚCI, nie po imieniu — powód przy `stempelProwadzi`. */
    const zdejmuje = w.prowadzi_user_id !== null && Number(w.prowadzi_user_id) === autor.id;
    database.prepare(`UPDATE reklamacja_klienta
      SET prowadzi=?, prowadzi_user_id=?, prowadzi_at=?, wersja=wersja+1
      WHERE id=? AND typ='DISPUTE'`).run(
      zdejmuje ? null : autor.name, zdejmuje ? null : autor.id,
      zdejmuje ? null : new Date().toISOString(), id);
    logEvent("dyskusja_prowadzi", autor.name, null, { id, zdjete: zdejmuje },
      autor.id, database);
    return wierszPoZapisie(database, id);
  })();
}

/**
 * Notatka biura — nasze ustalenia, których Allegro nie zna.
 *
 * Do dziennika idzie DŁUGOŚĆ, nigdy treść: notatka bywa zdaniem o kliencie,
 * a `events` nie ma retencji i nie jest kasowane.
 */
export function zapiszNotatkeDyskusji(
  database: Db, id: number, notatka: string | null,
  autor: { id: number; name: string }, wersja?: number,
): WierszDyskusji {
  return transaction(database, () => {
    doZapisu(database, id, wersja, "DISPUTE");
    pisanieNotatki(database, id, notatka, autor, "DISPUTE", "dyskusja_notatka");
    return wierszPoZapisie(database, id);
  })();
}

/**
 * Cofnięcie zmiany notatki przy DYSKUSJI.
 *
 * Mechanika jest wspólna z reklamacją, własna zostaje nazwa zdarzenia: ślad
 * ma mówić, z którego ekranu padło kliknięcie.
 */
export function cofnijNotatkeDyskusji(
  database: Db, id: number, autor: { id: number; name: string }, wersja?: number,
): WierszDyskusji {
  return transaction(database, () => {
    doZapisu(database, id, wersja, "DISPUTE");
    if (!cofnijNotatkeSprawy(database, id, autor, "DISPUTE", "dyskusja_notatka_cofnieta")) {
      throw new BladReklamacji("Ta notatka nie ma poprzedniej wersji", 409);
    }
    return wierszPoZapisie(database, id);
  })();
}

/** Odczyt wiersza po mutacji. Warunek na `typ` stoi i tutaj — bez wyjątków. */
function odczytaj(database: Db, id: number): Wiersz {
  return database.prepare(
    "SELECT * FROM reklamacja_klienta WHERE id=? AND typ='DISPUTE'",
  ).get(id) as Wiersz;
}

/* ── Alarm o dyskusjach bez odpowiedzi ───────────────────────────────────────
   Allegro zablokowało konto za dyskusję, na którą nikt nie odpowiedział, choć
   stała w kolejce „Do odpowiedzi". Kolejka pokazuje, że sprawa jest, ale nie
   woła; w ten sposób nikt jej nie otworzył na czas. Alarm woła z każdego
   ekranu panelu i ze stanu systemu. Na ekranie reklamacji woła czerwony
   licznik na zakładce Dyskusje zamiast paska, bo tam pasek zabiera miejsce
   trzem kolumnom sprawy; licznik widać z każdego ekranu.

   PRÓG JEST NASZĄ DECYZJĄ, NIE REGUŁĄ ALLEGRO. Dla dyskusji schemat nie ma
   terminu (`decisionDueDate` i `statusDueDate` to „Null for disputes"), a okno
   odpowiedzi, po którym Allegro nakłada sankcję, nie wynika z żadnego pliku
   w repo. Dlatego godziny stoją w `DYSKUSJE_ALARM_GODZIN`. [WERYFIKUJ]       */

export interface AlarmDyskusji {
  /** Ile dyskusji czeka na nas dłużej niż próg. */
  ile: number;
  /** Jak długo czeka najstarsza z nich. */
  najstarszaGodzin: number;
  progGodzin: number;
}

export interface StanDyskusjiHealth {
  /** Wszystkie dyskusje, w których ruch jest po naszej stronie. */
  czekaNaNas: number;
  alarm: AlarmDyskusji | null;
}

/** Alarm z listy wierszy — czysta arytmetyka, osobno od bazy. */
export function alarmDyskusji(lista: WierszDyskusji[], progGodzin: number): AlarmDyskusji | null {
  const po = lista.filter((d) => d.kubelek === "odpowiedz"
    && d.czekaOdGodzin !== null && d.czekaOdGodzin >= progGodzin);
  if (po.length === 0) return null;
  return {
    ile: po.length,
    najstarszaGodzin: Math.max(...po.map((d) => d.czekaOdGodzin ?? 0)),
    progGodzin,
  };
}

/**
 * Stan dla `/api/health`. Własne, wąskie zapytanie zamiast `listaDyskusji` (tylko kolumny zegara):
 * panel pyta tę trasę co kilka sekund, a lista czyta całe archiwum dyskusji
 * z tagami. Tutaj wystarczą otwarte sprawy, w których ruch jest nasz.
 *
 * Ten sam próg widoku (`REKLAMACJE_OD`) co kolejka: alarm o sprawie, której
 * kolejka nie pokazuje, kazałby szukać czegoś, czego nie ma na ekranie.
 */
export function stanDyskusjiHealth(
  database: Db = defaultDb(), teraz = Date.now(),
  progGodzin: number = config.allegro.dyskusjeAlarmGodzin,
  od: string | null = config.allegro.reklamacjeOd,
): StanDyskusjiHealth {
  const wiersze = database.prepare(`
    SELECT r.id, r.external_id, r.status_allegro, r.czat_aktywny, r.wiadomosci_ile,
           r.ostatnia_wiadomosc_status, r.ostatnia_wiadomosc_at, r.otwarto_at
      FROM reklamacja_klienta r
     WHERE r.typ = 'DISPUTE' AND (? IS NULL OR r.otwarto_at >= ?)
       AND COALESCE(r.status_allegro, '') <> ? AND COALESCE(r.czat_aktywny, 1) = 1
       AND r.ostatnia_wiadomosc_status IN (${STATUSY_ALARMU.map(() => "?").join(",")})`,
  ).all(od, od, ZAMKNIETA, ...STATUSY_ALARMU) as Wiersz[];
  const wiadomosci = wiadomosciCzasu(database, wiersze.map((w) => Number(w.id)));
  const lista = wiersze.map((w) => zWiersza(w, teraz, wiadomosci.get(Number(w.id)) ?? []));
  return {
    czekaNaNas: lista.filter((d) => d.kubelek === "odpowiedz").length,
    alarm: alarmDyskusji(lista, progGodzin),
  };
}

/** „1 dyskusja czeka", „2 dyskusje czekają", „5 dyskusji czeka" — trzy formy, nie dwie. */
export function ileDyskusjiCzeka(n: number): string {
  const j = n % 10;
  const dz = n % 100;
  if (n === 1) return "1 dyskusja czeka";
  if (j >= 2 && j <= 4 && !(dz >= 12 && dz <= 14)) return `${n} dyskusje czekają`;
  return `${n} dyskusji czeka`;
}

/** Zdanie do `problemy`; `null`, gdy żadna dyskusja nie przekroczyła progu. */
export function problemDyskusji(stan: StanDyskusjiHealth | null): string | null {
  const a = stan?.alarm;
  if (!a) return null;
  return `${ileDyskusjiCzeka(a.ile)} na odpowiedź dłużej niż ${a.progGodzin} godz. (najstarsza ${a.najstarszaGodzin} godz.). `
    + "Allegro może zablokować konto za dyskusje bez odpowiedzi. Otwórz kolejkę Dyskusje w panelu.";
}
