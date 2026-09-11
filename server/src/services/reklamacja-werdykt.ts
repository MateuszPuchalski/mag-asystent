import { config } from "../config.js";
import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { zmienStatusSprawy, type Werdykt as CialoWerdyktu } from "../adapters/allegro.http.js";
import { BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { ocenRekomendacje } from "./copilot-reklamacja.js";
import { logEvent } from "./events.js";
import { niejednoznaczny } from "./idempotencja.js";
import {
  BladReklamacji, NAZWA_WERDYKTU, ReklamacjaConflict, type StatusWerdyktu,
} from "./reklamacje.js";
import {
  odpowiedzWSprawie, type WynikOdpowiedzi, type WyslijWiadomosc,
} from "./reklamacje-wysylka.js";

/* ── Werdykt reklamacji (przyrost trzeci) ────────────────────────────────────
   0.222.0 dało kolejkę i zegar (tylko czyta), 0.224.0 odpowiedź w czacie.
   Ten plik domyka trzeci przyrost: uznanie albo odrzucenie wysłane do Allegro
   przez `POST /sale/issues/{issueId}/status` — pierwszy zapis tej aplikacji
   NIEODWRACALNY wobec kupującego.

   DOKTRYNA, w kolejności ważności:
   1. Werdykt wydaje CZŁOWIEK z biura. Automat nigdy — nawet gdyby umiał.
   2. Potwierdzenie zamiast cofnięcia: Allegro drugiego werdyktu w tej samej
      sprawie nie przyjmie, więc panel pyta PRZED, a serwer strzela RAZ.
      Strażnik dubletu stoi na wierszu (`werdykt_status`), nie w outboxie —
      werdykt jest jeden na sprawę, więc tabela prób miałaby jeden wiersz
      na klucz.
   3. `status_allegro` zostaje własnością Allegro. Nasz werdykt to osobne
      kolumny, a potwierdzenie przychodzi z synchronizacją. Sprawa wychodzi
      z DO DECYZJI od razu (`rozstrzygnieta()` w `reklamacje.ts`), bo dwie
      osoby przy dwóch biurkach nie mogą widzieć jej jako otwartej przez takt.
   4. Strzał POZA transakcją, próba zapisana ZANIM wyjdzie — jak w kolejce
      odpowiedzi. Timeout to `send_uncertain` i KONIEC prób z panelu;
      rozstrzyga synchronizacja. Odmowa kodem to `send_failed` i wolno
      spróbować raz jeszcze, bo wiadomo, że nic nie poszło.
   5. Do dziennika idą DŁUGOŚCI i kody, nigdy treść wiadomości do kupującego.

   Decyzje właściciela z 9.09.2026: częściowy zwrot pieniędzy WCHODZI z kwotą
   wpisaną przez agenta (serwer pilnuje `> 0` i sufitu); po uznaniu jest krok
   „towar do odesłania?" — wiadomość `RETURN_REQUIRED_CUSTOM` albo
   `RETURN_NOT_REQUIRED` przez tę samą kolejkę, co odpowiedź.              */

export const UZNANIA = [
  "ACCEPTED_REPAIR", "ACCEPTED_REFUND", "ACCEPTED_EXCHANGE", "ACCEPTED_PARTIAL_REFUND",
] as const;

export const ODMOWY = [
  "REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED", "REJECTED_PRODUCT_NOT_RETURNED",
  "REJECTED_PRODUCT_DAMAGED_BY_USER", "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT",
  "REJECTED_MINOR_DEFECT", "REJECTED_OTHER", "REJECTED_CLAIM_WITHDRAWN_BY_BUYER",
] as const;

/** Jedenaście wartości `ClaimStatusChangeRequest.status` — ze schematu, nie z pamięci. */
export const WERDYKTY = [...UZNANIA, ...ODMOWY] as const;
export type Werdykt = (typeof WERDYKTY)[number];

/**
 * Limit wiadomości przy werdykcie. Schemat NIE ogranicza `message`
 * (`[WERYFIKUJ]` w `docs/allegro-ksztalt.md`); bierzemy limit czatu, żeby
 * agent nie uczył się dwóch liczb dla dwóch pól tego samego ekranu.
 */
export const LIMIT_WIADOMOSCI = 20_000;

/** Statusy Allegro, przy których werdykt już zapadł — u nas albo poza panelem. */
const ROZSTRZYGNIETE = ["CLAIM_ACCEPTED", "CLAIM_REJECTED"];

/** Wysyłka wstrzykiwana, żeby test nie strzelał do Allegro (wzorzec kolejki). */
export type WyslijWerdykt = (issueId: string, cialo: CialoWerdyktu) => Promise<void>;

export interface ZadanieWerdyktu {
  werdykt: string;
  wiadomosc: string;
  /** Wyłącznie przy `ACCEPTED_PARTIAL_REFUND`; przy innych to błąd, nie cicha utrata. */
  kwotaGrosze?: number | null;
  /** Wersja sprawy z ekranu — 409, gdy ktoś ją w międzyczasie zmienił. */
  wersja?: number;
}

export interface WynikWerdyktu {
  werdykt: Werdykt;
  werdyktNazwa: string;
  status: StatusWerdyktu;
  blad: string | null;
  wersja: number;
}

type Wiersz = {
  id: number; external_id: string; wersja: number; prowadzi: string | null;
  status_allegro: string | null; werdykt_status: string | null;
  oczekiwanie: string | null; oczekiwana_kwota_grosze: number | null; waluta: string;
  ilosc: number | null; cena_grosze: number | null;
};

function wiersz(database: Db, id: number): Wiersz {
  const w = database.prepare(`
    SELECT r.id, r.external_id, r.wersja, r.prowadzi, r.status_allegro, r.werdykt_status,
           r.oczekiwanie, r.oczekiwana_kwota_grosze, r.waluta, r.ilosc, o.cena_grosze
      FROM reklamacja_klienta r
      LEFT JOIN offer_snapshot o
        ON o.channel_account_id = r.channel_account_id AND o.external_id = r.offer_id
     WHERE r.id=? AND r.typ='CLAIM'`).get(id) as Wiersz | undefined;
  /* Warunek na `typ` jest BRAMKĄ CAŁEJ ŚCIEŻKI WERDYKTU, nie ozdobą zapytania.
     Allegro odmawia werdyktu na dyskusji („Not a valid operation for
     disputes"), a od 0.245.0 obie sprawy leżą w jednej tabeli — bez tego
     warunku panel wysłałby żądanie, o którym z góry wiadomo, że wróci błędem,
     i zostawiłby po nim `werdykt_status='send_failed'` na sprawie, która
     werdyktu mieć nie może. Zapisy niżej działają na wierszu, który przeszedł
     tędy. */
  if (!w) throw new BladReklamacji(`Reklamacja ${id} nie istnieje`, 404);
  return w;
}

/**
 * Sufit częściowego zwrotu — i ZDANIE, które go nazywa.
 *
 * Kolejność: kwota, o którą prosił klient (gdy prosił o częściowy zwrot
 * i ją podał), potem cena oferty razy ilość z Allegro, inaczej bez sufitu.
 * Bez ilości NIE zgadujemy „jedna sztuka": sufit za niski blokowałby
 * uczciwy zwrot za trzy sztuki, a to gorsze niż brak sufitu.
 */
export function sufitKwoty(w: {
  oczekiwanie: string | null; oczekiwanaKwotaGrosze: number | null;
  cenaGrosze: number | null; ilosc: number | null;
}): { grosze: number; zrodlo: string } | null {
  if (w.oczekiwanie === "PARTIAL_REFUND" && w.oczekiwanaKwotaGrosze != null && w.oczekiwanaKwotaGrosze > 0) {
    return { grosze: w.oczekiwanaKwotaGrosze, zrodlo: "kwota, o którą prosił klient" };
  }
  if (w.cenaGrosze != null && w.cenaGrosze > 0 && w.ilosc != null && w.ilosc > 0) {
    return { grosze: w.cenaGrosze * w.ilosc, zrodlo: `cena oferty × ${w.ilosc} szt.` };
  }
  return null;
}

const zl = (grosze: number) => `${(grosze / 100).toFixed(2)} zł`;

/**
 * Wydanie werdyktu.
 *
 * Bramki treści stoją PRZED odczytem sprawy i przed jakimkolwiek zapisem:
 * odrzucony werdykt nie ma prawa zostawić po sobie `sending`, które wygląda
 * na próbę. Potem transakcja pierwsza (zapis próby), strzał poza transakcją,
 * transakcja druga (los próby).
 */
export async function wydajWerdykt(
  database: Db, id: number, z: ZadanieWerdyktu, kto: { id: number; name: string },
  wyslij: WyslijWerdykt = (issueId, cialo) => zmienStatusSprawy(config.allegro.apiUrl, issueId, cialo),
): Promise<WynikWerdyktu> {
  const werdykt = String(z.werdykt ?? "") as Werdykt;
  if (!(WERDYKTY as readonly string[]).includes(werdykt)) {
    throw new BladReklamacji("Nieznany werdykt — wybierz jedno z uznań albo odrzuceń");
  }
  const wiadomosc = String(z.wiadomosc ?? "").trim();
  if (!wiadomosc) {
    /* `required: [status, message]` — Allegro i tak odmówi, ale agent ma
       usłyszeć to od nas, zanim straci wpisany tekst. */
    throw new BladReklamacji("Wiadomość do kupującego jest wymagana — Allegro nie przyjmie werdyktu bez niej");
  }
  if (wiadomosc.length > LIMIT_WIADOMOSCI) {
    throw new BladReklamacji(
      `Wiadomość przy werdykcie ma najwyżej ${LIMIT_WIADOMOSCI} znaków, a ta ma ${wiadomosc.length}`);
  }
  const czesciowy = werdykt === "ACCEPTED_PARTIAL_REFUND";
  const kwota = z.kwotaGrosze == null ? null : Number(z.kwotaGrosze);
  if (!czesciowy && kwota != null) {
    throw new BladReklamacji("Kwota jest tylko przy częściowym zwrocie pieniędzy");
  }
  if (czesciowy && (kwota == null || !Number.isInteger(kwota) || kwota <= 0)) {
    throw new BladReklamacji("Częściowy zwrot wymaga kwoty większej od zera");
  }

  const w = wiersz(database, id);
  if (z.wersja !== undefined && Number(w.wersja) !== Number(z.wersja)) {
    throw new ReklamacjaConflict({ wersja: Number(w.wersja), prowadzi: w.prowadzi });
  }
  if (czesciowy && kwota != null) {
    const sufit = sufitKwoty({
      oczekiwanie: w.oczekiwanie, oczekiwanaKwotaGrosze: w.oczekiwana_kwota_grosze,
      cenaGrosze: w.cena_grosze, ilosc: w.ilosc,
    });
    if (sufit && kwota > sufit.grosze) {
      throw new BladReklamacji(
        `Kwota ${zl(kwota)} przekracza sufit ${zl(sufit.grosze)} (${sufit.zrodlo})`);
    }
  }

  const teraz = new Date().toISOString();
  transaction(database, () => {
    /* Sprawdzone W TRANSAKCJI, nie przed nią: dwa kliknięcia w dwóch
       zakładkach mają dać jeden strzał, a to gwarantuje dopiero `BEGIN
       IMMEDIATE`, nie odczyt sprzed chwili. */
    const swiezy = wiersz(database, id);
    if (ROZSTRZYGNIETE.includes(swiezy.status_allegro ?? "")) {
      throw new ReklamacjaConflict({ statusAllegro: swiezy.status_allegro },
        "Allegro pokazuje już werdykt w tej sprawie — zapadł poza panelem");
    }
    if (["sending", "sent", "send_uncertain"].includes(swiezy.werdykt_status ?? "")) {
      throw new ReklamacjaConflict({ werdyktStatus: swiezy.werdykt_status },
        "Werdykt już wyszedł albo jest w drodze — drugiego Allegro nie przyjmie");
    }
    /* bez typu: wiersz przeszedł przez bramkę `wiersz()` wyżej w tej samej
       transakcji, więc jest reklamacją; powtórzony warunek udawałby drugą
       niezależną kontrolę. */
    database.prepare(`UPDATE reklamacja_klienta
        SET werdykt=?, werdykt_wiadomosc=?, werdykt_kwota_grosze=?, werdykt_at=?,
            werdykt_przez=?, werdykt_user_id=?, werdykt_status='sending', werdykt_blad=NULL,
            prowadzi=COALESCE(prowadzi, ?), prowadzi_at=COALESCE(prowadzi_at, ?),
            wersja=wersja+1
      WHERE id=?`).run(werdykt, wiadomosc, czesciowy ? kwota : null, teraz,
      kto.name, kto.id, kto.name, teraz, id);
    logEvent("reklamacja_werdykt_proba", kto.name, null,
      { id, werdykt, znakow: wiadomosc.length, kwotaGrosze: czesciowy ? kwota : null },
      undefined, database);
  })();

  /* SIEĆ POZA TRANSAKCJĄ — ten sam powód, co w kolejce odpowiedzi. */
  let status: StatusWerdyktu = "sent";
  let blad: string | null = null;
  let kod: number | null = null;
  try {
    await wyslij(w.external_id, {
      status: werdykt, message: wiadomosc,
      kwotaGrosze: czesciowy ? kwota : null, waluta: w.waluta || "PLN",
    });
  } catch (e) {
    /* Odmowa kodem to porażka pewna; wszystko inne (timeout, urwane
       gniazdo) mogło dojść — i wtedy panel NIE dostaje przycisku ponowienia. */
    kod = e instanceof BladOdpowiedziAllegro ? e.status : null;
    status = kod === null && niejednoznaczny(e) ? "send_uncertain" : "send_failed";
    blad = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  }

  const wersja = transaction(database, () => {
    /* bez typu: dopisek losu do próby, która już wyszła — sprawę rozstrzygnęła
       bramka przed strzałem do Allegro. */
    database.prepare(
      "UPDATE reklamacja_klienta SET werdykt_status=?, werdykt_blad=? WHERE id=?",
    ).run(status, blad, id);
    logEvent("reklamacja_werdykt", kto.name, null, { id, werdykt, status, kod }, undefined, database);
    /* TRAFNOŚĆ RADY LICZY SIĘ Z FAKTU (0.276.0): porównujemy rekomendację
       Copilota z werdyktem, który agent naprawdę wysłał. Bez ankiety, bo
       rekomendacja jest typowana tym samym słownikiem.

       Tylko przy `sent`: werdykt, który nie wyszedł, nie jest decyzją, więc
       nie ma czym oceniać rady. Funkcja jest CICHA przy braku karty — Copilot
       jest dodatkiem, a werdykt podstawową pracą biura. */
    if (status === "sent") ocenRekomendacje(database, id, werdykt);
    /* bez typu: sam numer wersji do odpowiedzi, po zapisie wyżej. */
    return Number((database.prepare("SELECT wersja FROM reklamacja_klienta WHERE id=?")
      .get(id) as { wersja: number }).wersja);
  })();

  return { werdykt, werdyktNazwa: NAZWA_WERDYKTU[werdykt] ?? werdykt, status, blad, wersja };
}

export type DecyzjaOTowarze = "wymagany" | "niewymagany";

/** Wartość `MessageRequest.type` dla decyzji — wniosek z NAZW, nie ze zdania w specyfikacji. */
const TYP_DECYZJI = {
  wymagany: "RETURN_REQUIRED_CUSTOM",
  niewymagany: "RETURN_NOT_REQUIRED",
} as const;

export interface ZadanieZwrotuTowaru {
  reklamacjaId: number;
  decyzja: string;
  tresc: string;
  expectedWersja: number;
  expectedLastMessageId: number | null;
  mimoNowejWiadomosci?: boolean;
  autor: { id: number; name: string };
  database?: Db;
  wyslij?: WyslijWiadomosc;
}

/**
 * Krok „towar do odesłania?" po uznaniu.
 *
 * To jest ZWYKŁA WYSYŁKA z innym `type` — ta sama świeżość (409 przy
 * dopisku klienta albo doradcy), ten sam klucz idempotencji, ten sam outbox.
 * Własne są tylko bramki stanu: dopiero po uznaniu, które wyszło albo mogło
 * wyjść, i tylko raz. Decyzja zapisuje się na wierszu po WYJŚCIU próby;
 * `zwrot_wymagany` z Allegro jest jej potwierdzeniem przy synchronizacji.
 */
export async function zdecydujZwrotTowaru(z: ZadanieZwrotuTowaru): Promise<WynikOdpowiedzi> {
  const database = z.database ?? defaultDb();
  const decyzja = z.decyzja as DecyzjaOTowarze;
  if (!(decyzja in TYP_DECYZJI)) {
    throw new BladReklamacji("Decyzja o towarze to „wymagany” albo „niewymagany”");
  }
  const w = database.prepare(
    `SELECT werdykt, werdykt_status, zwrot_towaru FROM reklamacja_klienta
      WHERE id=? AND typ='CLAIM'`,
  ).get(z.reklamacjaId) as
    { werdykt: string | null; werdykt_status: string | null; zwrot_towaru: string | null } | undefined;
  if (!w) throw new BladReklamacji(`Reklamacja ${z.reklamacjaId} nie istnieje`, 404);
  const uznana = (w.werdykt ?? "").startsWith("ACCEPTED")
    && ["sent", "send_uncertain"].includes(w.werdykt_status ?? "");
  if (!uznana) {
    throw new ReklamacjaConflict({ werdykt: w.werdykt, werdyktStatus: w.werdykt_status },
      "O towarze decyduje się dopiero po uznaniu reklamacji z tego panelu");
  }
  if (w.zwrot_towaru) {
    throw new ReklamacjaConflict({ zwrotTowaru: w.zwrot_towaru },
      "Decyzja o towarze już wyszła do kupującego");
  }

  const wynik = await odpowiedzWSprawie({
    reklamacjaId: z.reklamacjaId, autor: z.autor, tresc: z.tresc,
    expectedWersja: z.expectedWersja, expectedLastMessageId: z.expectedLastMessageId,
    mimoNowejWiadomosci: z.mimoNowejWiadomosci, typ: TYP_DECYZJI[decyzja],
    database, wyslij: z.wyslij,
  });

  /* Próba WYSZŁA (albo mogła wyjść). Porażka kodem rzuciła wyżej i wiersza
     nie dotknęła — wolno spróbować jeszcze raz. */
  transaction(database, () => {
    /* bez typu: stanowisko o towarze zapisujemy dopiero po udanej wysyłce,
       a ta poszła przez bramkę uznanej reklamacji. */
    database.prepare(`UPDATE reklamacja_klienta
        SET zwrot_towaru=?, zwrot_towaru_at=datetime('now'), wersja=wersja+1
      WHERE id=? AND zwrot_towaru IS NULL`).run(decyzja, z.reklamacjaId);
    logEvent("reklamacja_zwrot_towaru", z.autor.name, null,
      { id: z.reklamacjaId, decyzja, znakow: (z.tresc ?? "").trim().length, status: wynik.status },
      undefined, database);
  })();
  return wynik;
}
