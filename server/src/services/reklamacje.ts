import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { listaZwrotow, type WierszZwrotu } from "./zwroty.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { linkOferty, linkReklamacji, linkZamowienia } from "./allegro-linki.js";
import { stanZdjeciaOferty, type StanZdjeciaOferty } from "./zdjecia-ofert.js";

/* ── Reklamacje klienckie — model pracy biura (0.222.0) ──────────────────────
   TEN PLIK PROWADZI WYŁĄCZNIE REKLAMACJE (`typ = 'CLAIM'`) i od 0.245.0 musi
   to mówić KAŻDYM zapytaniem. Do 0.244.0 dyskusje nie docierały do bazy, bo
   odsiewał je synchronizator, więc zapytanie bez warunku było bezpieczne.
   Po zdjęciu tamtego filtru `reklamacja_klienta` trzyma oba rodzaje spraw
   i pominięcie warunku pokazałoby dyskusję w kolejce reklamacji — z pustym
   paskiem werdyktu i pustą kolumną terminu.

   To jest dokładnie blizna 0.121.0: „CLAIM miał tę samą plakietkę co zwykła
   dyskusja". Pilnuje tego strażnik w `dyskusje.test.ts`, który czyta ŹRÓDŁO
   tego pliku i wymaga warunku na `typ` przy każdym `FROM reklamacja_klienta`.
   Dyskusje prowadzi `services/dyskusje.ts`.

   ZEGAR CZYTAMY, NIE LICZYMY. `decisionDueDate` z Allegro jest terminem na
   uznanie albo odrzucenie reklamacji. Implementacja skasowana w 0.140.0
   liczyła ustawowe czternaście dni SAMA, bo komentarz obok mówił, że Allegro
   żadnego zegara nie oddaje — i było to nieprawdą już wtedy. Liczba wzięta
   z naszego kodu rozjeżdżałaby się z tą, którą widzi kupujący, a rozstrzyga
   jego.

   KUBEŁEK NIE JEST KOLUMNĄ. Wynika ze statusu Allegro i ze stanu rozmowy,
   więc liczy go ten plik. Zdenormalizowany rozjechałby się z pierwszym
   przebiegiem synchronizacji, który go zapomni.                            */

/** Awaria pracy z reklamacją; `kod` niesie status HTTP dla trasy. */
export class BladReklamacji extends Error {
  constructor(message: string, readonly kod = 400) {
    super(message);
    this.name = "BladReklamacji";
  }
}

/**
 * Konflikt 409 — panel dostaje ładunek i pokazuje, co się zmieniło.
 *
 * Zdanie jest PARAMETREM od 0.224.0, bo powodów jest kilka i każdy każe co
 * innego zrobić: cudza zmiana rekordu (odśwież), dopisek klienta albo doradcy
 * (przeczytaj i zdecyduj), zamknięta rozmowa (nie da się już nic wysłać).
 * Jedno zdanie na wszystkie trzy kazałoby agentowi zgadywać, na co patrzy.
 */
export class ReklamacjaConflict extends Error {
  constructor(
    readonly szczegoly: Record<string, unknown>,
    message = "Reklamacja zmieniła się, odkąd ją otworzyłeś — odśwież i spróbuj jeszcze raz",
  ) {
    super(message);
    this.name = "ReklamacjaConflict";
  }
}

export type Kubelek = "decyzja" | "odpowiedz" | "zamknieta";

/**
 * Rodzaj sprawy posprzedażowej — rozróżnik kolumny `typ`.
 *
 * Allegro trzyma dyskusje i reklamacje pod jednym zasobem `/sale/issues`
 * i pod jedną przestrzenią identyfikatorów, więc trzyma je też jedna tabela.
 * Ten typ jest jedynym, co je w kodzie rozdziela — i dlatego stoi w sygnaturze
 * każdej funkcji, która sięga do tabeli po identyfikatorze.
 */
export type TypSprawy = "CLAIM" | "DISPUTE";

/** Nazwa rodzaju sprawy w zdaniu błędu; kod w komunikacie nie jest komunikatem. */
export const NAZWA_SPRAWY: Record<TypSprawy, string> = {
  CLAIM: "Reklamacja",
  DISPUTE: "Dyskusja",
};

export type Sygnal =
  | "termin"
  | "klient_czeka"
  | "doradca"
  | "czat_zamkniety"
  | "zwrot_wymagany"
  | "status_nieznany"
  /* ── Werdykt z panelu (przyrost trzeci) ──────────────────────────────────
     Trzy sygnały o LOSIE naszego werdyktu, bo `status_allegro` należy do
     Allegro i mówi o nim dopiero po synchronizacji. */
  /** Wysłany, a Allegro jeszcze nie pokazuje `CLAIM_*` — albo los niepewny. */
  | "werdykt_niepotwierdzony"
  /** Allegro odmówiło kodem; wolno spróbować raz jeszcze. */
  | "werdykt_nieudany"
  /** Uznana u nas, a nikt nie powiedział kupującemu, czy odsyłać towar. */
  | "towar_do_decyzji";

/** Losy próby werdyktu — te same cztery, co `reklamacja_outbox.status`. */
export type StatusWerdyktu = "sending" | "sent" | "send_uncertain" | "send_failed";

/** Losy, przy których werdykt UZNAJEMY za wydany: poszedł albo mógł pójść. */
const WERDYKT_WYDANY: readonly string[] = ["sent", "send_uncertain"];

/**
 * Statusy, które ZNAMY ze specyfikacji (`PostPurchaseIssueStatus`).
 *
 * Wartość spoza tej listy NIE JEST BŁĘDEM: nie wywraca przebiegu i nie znika
 * z ekranu, tylko zapala sygnał. To jest mechanizm weryfikacji listy na żywym
 * koncie, a nie ozdoba — poprzednia implementacja miała go i był dobry.
 */
export const STATUSY_ALLEGRO = [
  "DISPUTE_CLOSED", "DISPUTE_ONGOING", "DISPUTE_UNRESOLVED",
  "CLAIM_SUBMITTED", "CLAIM_ACCEPTED", "CLAIM_REJECTED",
] as const;

/** Statusy końcowe reklamacji — po nich biuro nie ma już decyzji do podjęcia. */
const ROZSTRZYGNIETE = ["CLAIM_ACCEPTED", "CLAIM_REJECTED"];

/**
 * Werdykt po polsku — zdanie pisze SERWER, panel nie tłumaczy kodów. Kod
 * spoza mapy wraca goły (`werdyktNazwa` = kod), a nie znika: kolumna ma
 * `CHECK` z jedenastoma wartościami, więc to gałąź na nowy schemat Allegro.
 */
export const NAZWA_WERDYKTU: Record<string, string> = {
  ACCEPTED_REPAIR: "Uznana — naprawa",
  ACCEPTED_REFUND: "Uznana — zwrot pieniędzy",
  ACCEPTED_EXCHANGE: "Uznana — wymiana",
  ACCEPTED_PARTIAL_REFUND: "Uznana — częściowy zwrot pieniędzy",
  REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED: "Odrzucona — kupujący nie spełnił dodatkowych wymagań",
  REJECTED_PRODUCT_NOT_RETURNED: "Odrzucona — towar nie wrócił",
  REJECTED_PRODUCT_DAMAGED_BY_USER: "Odrzucona — uszkodzenie z winy użytkownika",
  REJECTED_PRODUCT_CONFORMS_TO_CONTRACT: "Odrzucona — towar zgodny z umową",
  REJECTED_MINOR_DEFECT: "Odrzucona — wada nieistotna",
  REJECTED_OTHER: "Odrzucona — inny powód",
  REJECTED_CLAIM_WITHDRAWN_BY_BUYER: "Odrzucona — kupujący wycofał reklamację",
};

/** Statusy ostatniej wiadomości, przy których ruch należy do nas. */
const CZEKA_NA_NAS = ["NEW", "BUYER_REPLIED"];

/** Ile dni przed terminem decyzji wiersz zapala się na czerwono. */
const PROG_TERMINU_DNI = 3;

const DZIEN_MS = 86_400_000;

export interface ZalacznikReklamacji {
  id: number;
  wiadomoscId: number | null;
  nazwa: string;
  /**
   * Czy warto próbować pokazać go na osi. PODPOWIEDŹ, nie prawda.
   *
   * `PostPurchaseIssueAttachment` ma DWA pola — `fileName` i `url` — więc ani
   * typu MIME, ani stanu `SAFE` nie znamy. Rozstrzygnąć da się to wyłącznie
   * po BAJTACH, a bajty ma dopiero trasa podglądu. Ta flaga decyduje o
   * UKŁADZIE (kafel czy przycisk), a bajty decydują o wydaniu: plik, którego
   * nazwa kłamie, dostaje 415 i zostaje przy pobieraniu.
   */
  podglad: boolean;
}

/**
 * Czy nazwa pliku obiecuje obraz, który przeglądarka narysuje.
 *
 * Rozszerzeń jest TRZY, nie sześć, i to jest przecięcie dwóch list. Allegro
 * przyjmuje przy tym zasobie `png`, `gif`, `bmp`, `tiff`, `jpeg` i `pdf`
 * (`PUT /sale/issues/attachments/{id}`), a `TYPY_PODGLADU` ze skrzynki
 * wymienia cztery typy rastrowe. Wspólne są trzy — `webp` po stronie Allegro
 * nie istnieje, a `bmp` i `tiff` przeglądarki rysują nierówno albo wcale.
 * Reszta zostaje przy pobieraniu i to nie jest awaria, tylko odpowiedź.
 */
export const czyObrazZNazwy = (nazwa: string | null | undefined): boolean =>
  /\.(jpe?g|png|gif)$/i.test((nazwa ?? "").trim());

export interface WiadomoscReklamacji {
  id: number;
  externalId: string;
  autorLogin: string | null;
  /** BUYER, SELLER, ADMIN, SYSTEM albo FULFILLMENT. Doradca Allegro to ADMIN. */
  autorRola: string | null;
  tresc: string;
  utworzonoAt: string | null;
  zalaczniki: ZalacznikReklamacji[];
}

export interface WierszReklamacji {
  id: number;
  externalId: string;
  numer: string | null;
  orderId: string | null;
  offerId: string | null;
  kupujacyLogin: string | null;
  prawo: string | null;
  powodTyp: string | null;
  powodOpis: string | null;
  temat: string | null;
  opis: string | null;
  oczekiwanie: string | null;
  oczekiwanaKwotaGrosze: number | null;
  waluta: string;
  statusAllegro: string | null;
  decyzjaDo: string | null;
  /** `null` znaczy „Allegro terminu nie podało" — to co innego niż „minął". */
  dniDoTerminu: number | null;
  poTerminie: boolean;
  zwrotWymagany: boolean | null;
  czatAktywny: boolean;
  wiadomosciIle: number;
  ostatniaWiadomoscStatus: string | null;
  ostatniaWiadomoscAt: string | null;
  otwartoAt: string;
  prowadzi: string | null;
  prowadziAt: string | null;
  notatka: string | null;
  /* ── Werdykt z panelu (przyrost trzeci) — NASZ, nie `statusAllegro` ───────
     `null` w `werdykt` przy `CLAIM_ACCEPTED` znaczy „rozstrzygnięte poza
     panelem" i to jest informacja, nie brak. */
  werdykt: string | null;
  werdyktNazwa: string | null;
  werdyktStatus: StatusWerdyktu | null;
  werdyktWiadomosc: string | null;
  werdyktKwotaGrosze: number | null;
  werdyktAt: string | null;
  werdyktPrzez: string | null;
  werdyktBlad: string | null;
  /** Krok „towar do odesłania?" — decyzja lokalna; `zwrotWymagany` ją potwierdza. */
  zwrotTowaru: "wymagany" | "niewymagany" | null;
  zwrotTowaruAt: string | null;
  /** `offer.quantity` — sufit częściowego zwrotu, gdy klient nie podał kwoty. */
  ilosc: number | null;
  wersja: number;
  kubelek: Kubelek;
  sygnaly: Sygnal[];
  /* Odnośniki do Allegro. `null` znaczy „nie ma czego linkować" i ekran
     pokazuje wtedy sam tekst, a nie odnośnik prowadzący donikąd. */
  link: string | null;
  linkZamowienia: string | null;
  linkOferty: string | null;
  /* ── Co widać na wierszu (0.223.0) ────────────────────────────────────────
     Reklamacja dotyczy JEDNEJ oferty, więc obraz jest tu tożsamością sprawy,
     a nie ozdobą: „pękła obudowa" przy zdjęciu kosiarki czyta się w biegu,
     a przy samym numerze wymaga otwarcia sprawy. */
  ofertaNazwa: string | null;
  /** Trzy stany, jak przy zwrocie od 0.214.0: `jest`, `brak`, `nieznane`. */
  ofertaZdjecie: StanZdjeciaOferty;
  /** Kartoteka POTWIERDZONA (`oferta_kartoteka`); propozycję liczy szczegół. */
  twId: number | null;
  twSymbol: string | null;
}

type Wiersz = Record<string, unknown>;

const tekst = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/**
 * Dni do terminu decyzji — czysta arytmetyka, osobno od bazy.
 *
 * Ujemna liczba znaczy „po terminie". `null` na wejściu daje `null` na
 * wyjściu, bo brak terminu to brak liczby — a zero kłamałoby, że decyzja
 * przypada dziś.
 */
export function dniDoTerminu(termin: string | null, teraz = Date.now()): number | null {
  if (!termin) return null;
  const t = Date.parse(termin);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - teraz) / DZIEN_MS);
}

/**
 * Kubełek reklamacji — jedno pytanie na kubełek (dekalog, punkt 5).
 *
 * DO DECYZJI trzyma WSZYSTKO, co czeka na uznanie albo odrzucenie, także te
 * sprawy, w których klient właśnie coś dopisał. Obowiązek wobec terminu jest
 * jeden i to on rządzi kolejnością pracy; „klient czeka" jest przy takim
 * wierszu SYGNAŁEM, a nie osobną kolejką. Przeniesienie go do DO ODPOWIEDZI
 * zaniżyłoby licznik spraw z zegarem — czyli jedyną liczbę, dla której ten
 * ekran powstał.
 */
/**
 * Czy sprawa jest rozstrzygnięta — przez Allegro ALBO przez nas.
 *
 * Werdykt człowieka z panelu przebija wyliczenie ze statusu: po „WYŚLIJ
 * WERDYKT" sprawa ma zniknąć z DO DECYZJI od razu, a nie za takt
 * synchronizacji — inaczej dwie osoby przy dwóch biurkach widziałyby ją
 * jako otwartą jeszcze przez minutę. `send_uncertain` liczy się jak wydany:
 * żądanie mogło dojść, a drugiego strzału i tak nie oddamy.
 */
export const rozstrzygnieta = (w: {
  statusAllegro: string | null; werdyktStatus?: StatusWerdyktu | null;
}): boolean =>
  ROZSTRZYGNIETE.includes(w.statusAllegro ?? "") || WERDYKT_WYDANY.includes(w.werdyktStatus ?? "");

export function kubelek(w: {
  statusAllegro: string | null;
  ostatniaWiadomoscStatus: string | null;
  czatAktywny: boolean;
  werdyktStatus?: StatusWerdyktu | null;
}): Kubelek {
  if (!rozstrzygnieta(w)) return "decyzja";
  /* Rozstrzygnięta, ale rozmowa trwa i ostatnie słowo było klienta. Werdykt
     zapadł, a człowiek po drugiej stronie nadal czeka na zdanie. */
  if (w.czatAktywny && CZEKA_NA_NAS.includes(w.ostatniaWiadomoscStatus ?? "")) return "odpowiedz";
  return "zamknieta";
}

export function sygnaly(w: {
  statusAllegro: string | null;
  dniDoTerminu: number | null;
  ostatniaWiadomoscStatus: string | null;
  czatAktywny: boolean;
  zwrotWymagany: boolean | null;
  werdykt?: string | null;
  werdyktStatus?: StatusWerdyktu | null;
  zwrotTowaru?: string | null;
}): Sygnal[] {
  const s: Sygnal[] = [];
  const otwarta = !rozstrzygnieta(w);
  if (otwarta && w.dniDoTerminu !== null && w.dniDoTerminu <= PROG_TERMINU_DNI) s.push("termin");
  /* Los naszego werdyktu. „Niepotwierdzony" trwa, dopóki `status_allegro`
     nie pokaże gałęzi końcowej — potwierdza synchronizacja, nie my. */
  const wydany = WERDYKT_WYDANY.includes(w.werdyktStatus ?? "");
  if (wydany && !ROZSTRZYGNIETE.includes(w.statusAllegro ?? "")) s.push("werdykt_niepotwierdzony");
  if (w.werdyktStatus === "send_failed") s.push("werdykt_nieudany");
  /* Uznana u nas, a stanowisko o towarze nie wyszło ani od nas, ani — sądząc
     po `returnRequired` — z Centrum Sprzedaży. Sygnał, nie kubełek: to jest
     drugi krok tej samej sprawy, a nie osobna kolejka. */
  if (wydany && (w.werdykt ?? "").startsWith("ACCEPTED") && !w.zwrotTowaru && w.zwrotWymagany === null) {
    s.push("towar_do_decyzji");
  }
  if (CZEKA_NA_NAS.includes(w.ostatniaWiadomoscStatus ?? "")) s.push("klient_czeka");
  /* Doradca Allegro odpisał w 61 sprawach na 100 w sondzie — to jest przypadek
     typowy, nie brzegowy, i zmienia ton odpowiedzi: w rozmowie jest trzecia
     strona, która czyta wszystko. */
  if (w.ostatniaWiadomoscStatus === "ALLEGRO_ADVISOR_REPLIED") s.push("doradca");
  if (!w.czatAktywny) s.push("czat_zamkniety");
  if (w.zwrotWymagany === true) s.push("zwrot_wymagany");
  if (w.statusAllegro && !(STATUSY_ALLEGRO as readonly string[]).includes(w.statusAllegro)) {
    s.push("status_nieznany");
  }
  return s;
}

function zWiersza(w: Wiersz, teraz: number): WierszReklamacji {
  const statusAllegro = tekst(w.status_allegro);
  const decyzjaDo = tekst(w.decyzja_do);
  const dni = dniDoTerminu(decyzjaDo, teraz);
  const czatAktywny = Number(w.czat_aktywny ?? 1) === 1;
  const ostatnia = tekst(w.ostatnia_wiadomosc_status);
  const zwrotWymagany = w.zwrot_wymagany == null ? null : Number(w.zwrot_wymagany) === 1;
  const werdykt = tekst(w.werdykt);
  const werdyktStatus = tekst(w.werdykt_status) as StatusWerdyktu | null;
  const zwrotTowaru = tekst(w.zwrot_towaru) as "wymagany" | "niewymagany" | null;
  const rdzen = {
    statusAllegro, dniDoTerminu: dni, ostatniaWiadomoscStatus: ostatnia,
    czatAktywny, zwrotWymagany, werdykt, werdyktStatus, zwrotTowaru,
  };
  return {
    id: Number(w.id),
    externalId: String(w.external_id),
    numer: tekst(w.reference_number),
    orderId: tekst(w.order_id),
    offerId: tekst(w.offer_id),
    kupujacyLogin: tekst(w.kupujacy_login),
    prawo: tekst(w.prawo),
    powodTyp: tekst(w.powod_typ),
    powodOpis: tekst(w.powod_opis),
    temat: tekst(w.temat),
    opis: tekst(w.opis),
    oczekiwanie: tekst(w.oczekiwanie),
    oczekiwanaKwotaGrosze: w.oczekiwana_kwota_grosze == null
      ? null : Number(w.oczekiwana_kwota_grosze),
    waluta: String(w.waluta ?? "PLN"),
    statusAllegro,
    decyzjaDo,
    dniDoTerminu: dni,
    poTerminie: dni !== null && dni < 0,
    zwrotWymagany,
    czatAktywny,
    wiadomosciIle: Number(w.wiadomosci_ile ?? 0),
    ostatniaWiadomoscStatus: ostatnia,
    ostatniaWiadomoscAt: tekst(w.ostatnia_wiadomosc_at),
    otwartoAt: String(w.otwarto_at),
    prowadzi: tekst(w.prowadzi),
    prowadziAt: tekst(w.prowadzi_at),
    notatka: tekst(w.notatka),
    werdykt,
    werdyktNazwa: werdykt ? (NAZWA_WERDYKTU[werdykt] ?? werdykt) : null,
    werdyktStatus,
    werdyktWiadomosc: tekst(w.werdykt_wiadomosc),
    werdyktKwotaGrosze: w.werdykt_kwota_grosze == null ? null : Number(w.werdykt_kwota_grosze),
    werdyktAt: tekst(w.werdykt_at),
    werdyktPrzez: tekst(w.werdykt_przez),
    werdyktBlad: tekst(w.werdykt_blad),
    zwrotTowaru,
    zwrotTowaruAt: tekst(w.zwrot_towaru_at),
    ilosc: w.ilosc == null ? null : Number(w.ilosc),
    wersja: Number(w.wersja ?? 1),
    kubelek: kubelek(rdzen),
    sygnaly: sygnaly(rdzen),
    /* W ADRESIE STOI UUID, nie numer czytelny (0.226.1). Sprawa ma własną
       stronę `/claims/{uuid}` i adresuje się identyfikatorem zasobu; numer
       `2585498/2026` jest dla CZŁOWIEKA i zostaje etykietą odnośnika. Do
       0.226.0 szło tu odwrotnie i kliknięcie dawało 404. */
    link: linkReklamacji(String(w.external_id)),
    linkZamowienia: linkZamowienia(tekst(w.order_id)),
    linkOferty: linkOferty(tekst(w.offer_id)),
    ofertaNazwa: tekst(w.oferta_nazwa),
    /* Trzy stany, nie dwa (blizna 0.214.0). NULL znaczy „jeszcze nie wiemy" —
       i to samo znaczy BRAK WIERSZA snapshotu przy złączeniu lewym, więc obie
       drogi schodzą się w jednej odpowiedzi. Pusty łańcuch znaczy co innego:
       „snapshot jest, Allegro zdjęcia tej oferty nie ma" — a tego nie naprawi
       żadna synchronizacja. Kafel mówi w każdym z tych przypadków co innego. */
    ofertaZdjecie: stanZdjeciaOferty(w.oferta_zdjecie as string | null | undefined),
    twId: w.tw_id == null ? null : Number(w.tw_id),
    twSymbol: tekst(w.tw_symbol),
  };
}

/**
 * Cała kolejka jednym odczytem.
 *
 * Reklamacji w pracy są dziesiątki, nie tysiące, więc panel dostaje listę
 * w całości i filtruje kubełkiem u siebie — przełączenie kubełka nie kosztuje
 * wtedy ani jednego żądania. Ten sam wybór co przy zwrotach.
 *
 * PORZĄDEK BIERZE SIĘ Z TERMINU DECYZJI, nie z daty wpływu: pytanie biura
 * brzmi „co się dziś przeterminuje", a nie „co przyszło pierwsze". Sprawy bez
 * terminu idą na koniec — nie mają zegara, więc nie mają pilności.
 */
export function listaReklamacji(
  database: Db = defaultDb(), teraz = Date.now(),
): WierszReklamacji[] {
  /* Dwa złączenia LEWE po tej samej ofercie: snapshot Allegro (nazwa i adres
     zdjęcia) oraz potwierdzona kartoteka Subiekta. Oba po `channel_account_id`
     RAZEM z `offer_id` — identyfikator oferty jest unikalny w obrębie konta,
     nie globalnie, a dwa konta sprzedawcy to nie jest przypadek niemożliwy.

     Propozycji kartoteki tu NIE liczymy. `kartotekaOferty` chodzi po pamięci
     wskazań i po SKU, czyli kilka zapytań NA WIERSZ; kolejka ma pokazać, co
     wiadomo na pewno, a proponowanie kartoteki jest pracą przy jednej
     otwartej sprawie (szczegół). */
  const wiersze = database.prepare(`
    SELECT r.*, o.nazwa AS oferta_nazwa, o.primary_image_url AS oferta_zdjecie,
           k.tw_id, k.tw_symbol
      FROM reklamacja_klienta r
      LEFT JOIN offer_snapshot o
        ON o.channel_account_id = r.channel_account_id AND o.external_id = r.offer_id
      LEFT JOIN oferta_kartoteka k
        ON k.channel_account_id = r.channel_account_id AND k.offer_id = r.offer_id
     WHERE r.typ = 'CLAIM'
     ORDER BY r.decyzja_do IS NULL, r.decyzja_do ASC, r.otwarto_at DESC`)
    .all() as Wiersz[];
  return wiersze.map((w) => zWiersza(w, teraz));
}

export function licznikiKubelkow(lista: WierszReklamacji[]): Record<Kubelek, number> {
  const l: Record<Kubelek, number> = { decyzja: 0, odpowiedz: 0, zamknieta: 0 };
  for (const r of lista) l[r.kubelek] += 1;
  return l;
}

/** Czat sprawy w kolejności czasu, z załącznikami przy wiadomościach. */
export function czatReklamacji(database: Db, reklamacjaId: number): WiadomoscReklamacji[] {
  const wiersze = database.prepare(`SELECT * FROM reklamacja_wiadomosc
    WHERE reklamacja_id=? ORDER BY utworzono_at IS NULL, utworzono_at ASC, id ASC`)
    .all(reklamacjaId) as Wiersz[];
  const zalaczniki = database.prepare(
    "SELECT id, wiadomosc_id, nazwa FROM reklamacja_zalacznik WHERE reklamacja_id=? ORDER BY id",
  ).all(reklamacjaId) as Wiersz[];
  return wiersze.map((w) => ({
    id: Number(w.id),
    externalId: String(w.external_id),
    autorLogin: tekst(w.autor_login),
    autorRola: tekst(w.autor_rola),
    tresc: String(w.tresc ?? ""),
    utworzonoAt: tekst(w.utworzono_at),
    zalaczniki: zalaczniki.filter((z) => Number(z.wiadomosc_id) === Number(w.id))
      .map((z) => ({
        id: Number(z.id), wiadomoscId: Number(z.wiadomosc_id), nazwa: String(z.nazwa ?? ""),
        podglad: czyObrazZNazwy(z.nazwa as string),
      })),
  }));
}

/** Załączniki samej sprawy — te spoza rozmowy. */
export function zalacznikiSprawy(database: Db, reklamacjaId: number): ZalacznikReklamacji[] {
  return (database.prepare(
    `SELECT id, wiadomosc_id, nazwa FROM reklamacja_zalacznik
      WHERE reklamacja_id=? AND wiadomosc_id IS NULL ORDER BY id`,
  ).all(reklamacjaId) as Wiersz[]).map((z) => ({
    id: Number(z.id), wiadomoscId: null, nazwa: String(z.nazwa ?? ""),
    podglad: czyObrazZNazwy(z.nazwa as string),
  }));
}

export interface RozmowaZakupu {
  id: number;
  temat: string | null;
  status: string;
  ostatniaAt: string | null;
}

export interface SzczegolReklamacji {
  reklamacja: WierszReklamacji;
  czat: WiadomoscReklamacji[];
  zalaczniki: ZalacznikReklamacji[];
  /** Zwroty tego samego zamówienia — mostek z 0.221.0, ta sama funkcja. */
  zwroty: WierszZwrotu[];
  /** Rozmowy o tym samym zakupie; po loginie kupującego NIE dobieramy. */
  rozmowy: RozmowaZakupu[];
  /** Kartoteka Subiekta wywiedziona z oferty, gdy reklamacja ją niesie. */
  kartoteka: ReturnType<typeof kartotekaOferty> | null;
}

/**
 * Co jeszcze wiemy o TYM ZAMÓWIENIU — zwroty i rozmowy.
 *
 * Wspólne dla reklamacji i dyskusji (0.245.0), bo obie sprawy wiszą przy
 * zamówieniu i obie odpowiadają na to samo pytanie biura: „czy ten klient
 * pisał już w tej sprawie gdzie indziej". Druga kopia tego mostka rozjechałaby
 * się z pierwszą przy pierwszym nowym polu — dokładnie tak, jak ostrzega
 * komentarz przy `szczegolReklamacji`.
 *
 * Zero nowych żądań do Allegro: numer zamówienia sprawa ma od pierwszej
 * synchronizacji, a wiadomości leżą już w naszej bazie. Grupujemy po rozmowie,
 * bo jeden zakup potrafi mieć kilka wątków.
 */
export function kontekstZamowienia(
  database: Db, konto: number, orderId: string | null, teraz: number,
): { zwroty: WierszZwrotu[]; rozmowy: RozmowaZakupu[] } {
  if (!orderId) return { zwroty: [], rozmowy: [] };
  return {
    zwroty: listaZwrotow(database, teraz, { channelAccountId: konto, orderId }),
    rozmowy: (database.prepare(`
      SELECT c.id, c.subject, c.status, MAX(m.sent_at) AS ostatnia
        FROM message m JOIN conversation c ON c.id = m.conversation_id
       WHERE m.related_order_id = ?
       GROUP BY c.id
       ORDER BY ostatnia DESC`).all(orderId) as Wiersz[]).map((r) => ({
      id: Number(r.id),
      temat: tekst(r.subject),
      status: String(r.status),
      ostatniaAt: tekst(r.ostatnia),
    })),
  };
}

/**
 * Wszystko o jednej sprawie — CZYSTY ODCZYT.
 *
 * Otwarcie reklamacji niczego nie mutuje (blizna 0.18.0). Rozmowa dociąga się
 * taktem synchronizacji, a nie wejściem na ekran: pobranie przy patrzeniu
 * byłoby zapisem, a przy okazji żądaniem do Allegro na każde kliknięcie
 * w wiersz kolejki.
 */
export function szczegolReklamacji(
  database: Db, id: number, teraz = Date.now(),
): SzczegolReklamacji {
  /* Skład wiersza jest TEN SAM, co w kolejce — `listaReklamacji` z filtrem po
     identyfikatorze. Druga funkcja składająca reklamację rozjechałaby się
     z pierwszą przy pierwszym nowym polu; dokładnie tak zrobiono przy zwrocie
     w rozmowie (0.221.0). */
  const w = database.prepare(`
    SELECT r.*, o.nazwa AS oferta_nazwa, o.primary_image_url AS oferta_zdjecie,
           k.tw_id, k.tw_symbol
      FROM reklamacja_klienta r
      LEFT JOIN offer_snapshot o
        ON o.channel_account_id = r.channel_account_id AND o.external_id = r.offer_id
      LEFT JOIN oferta_kartoteka k
        ON k.channel_account_id = r.channel_account_id AND k.offer_id = r.offer_id
     WHERE r.id=? AND r.typ = 'CLAIM'`).get(id) as Wiersz | undefined;
  /* Dyskusja pod tym identyfikatorem to dla TEGO ekranu brak, a nie sprawa
     bez werdyktu: `/api/reklamacje/7` przy dyskusji ma oddać 404, żeby nie
     dało się jej otworzyć ekranem, który obiecuje uznanie i odrzucenie. */
  if (!w) throw new BladReklamacji(`Reklamacja ${id} nie istnieje`, 404);
  const reklamacja = zWiersza(w, teraz);
  const konto = Number(w.channel_account_id);

  const { zwroty, rozmowy } = kontekstZamowienia(database, konto, reklamacja.orderId, teraz);

  /* Kartoteka po ofercie — ten sam łańcuch co w skrzynce (pamięć wskazań,
     potem SKU ze snapshotu). Bez snapshotu `sku` jest `undefined` i ekran
     mówi „oferty jeszcze nie pobrano", a nie „oferta bez SKU". */
  let kartoteka: SzczegolReklamacji["kartoteka"] = null;
  if (reklamacja.offerId) {
    const snap = database.prepare(
      "SELECT sku FROM offer_snapshot WHERE channel_account_id=? AND external_id=?",
    ).get(konto, reklamacja.offerId) as { sku: string | null } | undefined;
    kartoteka = kartotekaOferty(database, konto, reklamacja.offerId,
      snap ? snap.sku : undefined);
  }

  return {
    reklamacja,
    czat: czatReklamacji(database, id),
    zalaczniki: zalacznikiSprawy(database, id),
    zwroty, rozmowy, kartoteka,
  };
}

/**
 * Wiersz do mutacji plus kontrola wersji. Wspólne dla obu zapisów niżej
 * ORAZ dla dyskusji (`services/dyskusje.ts`), stąd `typ` jako parametr.
 *
 * Warunek na `typ` stoi przy ZAPISIE, nie tylko przy odczycie, i to jest
 * sedno: bez niego trasa reklamacji przyjęłaby werdykt na dyskusji, której
 * Allegro werdyktu nie przyjmie („Not a valid operation for disputes"),
 * a trasa dyskusji poprosiłaby o zakończenie reklamacji, gdzie `END_REQUEST`
 * jest niedozwolone.
 *
 * Zdanie w błędzie mówi RODZAJ sprawy, nie samo „nie istnieje": agent, który
 * wkleił numer z drugiego ekranu, ma się dowiedzieć, że pomylił ekran,
 * a nie że sprawa zniknęła.
 */
export function doZapisu(
  database: Db, id: number, wersja: number | undefined, typ: TypSprawy = "CLAIM",
) {
  const w = database.prepare(
    "SELECT id, wersja, prowadzi FROM reklamacja_klienta WHERE id=? AND typ=?",
  ).get(id, typ) as { id: number; wersja: number; prowadzi: string | null } | undefined;
  if (!w) throw new BladReklamacji(`${NAZWA_SPRAWY[typ]} ${id} nie istnieje`, 404);
  if (wersja !== undefined && Number(w.wersja) !== Number(wersja)) {
    throw new ReklamacjaConflict({ wersja: Number(w.wersja), prowadzi: w.prowadzi });
  }
  return w;
}

/**
 * Kto prowadzi reklamację — ZNACZNIK, nie zamek.
 *
 * Reklamacja przed werdyktem nie ma ŻADNEGO zapisu, przy którym nazwisko
 * pojawiłoby się samo: nie ma szkicu jak rozmowa ani oceny towaru jak zwrot.
 * Dlatego jest jawny przycisk, a nie stempel przy okazji. Doktryna
 * `stempelProwadzi` z pytań — znacznik dla reszty biura, żeby dwie osoby nie
 * wzięły tej samej sprawy przy dwóch biurkach.
 *
 * Ponowne kliknięcie ZDEJMUJE znacznik. Bez tego jedyną drogą wyjścia
 * z pomyłkowego przejęcia byłby cudzy werdykt.
 */
export function stempelProwadzi(
  database: Db, id: number, autor: string, wersja?: number,
): WierszReklamacji {
  return transaction(database, () => {
    const w = doZapisu(database, id, wersja);
    const zdejmuje = w.prowadzi === autor;
    database.prepare(`UPDATE reklamacja_klienta
      SET prowadzi=?, prowadzi_at=?, wersja=wersja+1
      WHERE id=? AND typ='CLAIM'`).run(
      zdejmuje ? null : autor, zdejmuje ? null : new Date().toISOString(), id);
    logEvent("reklamacja_prowadzi", autor, null, { id, zdjete: zdejmuje }, undefined, database);
    return zWiersza(
      database.prepare("SELECT * FROM reklamacja_klienta WHERE id=? AND typ='CLAIM'")
        .get(id) as Wiersz,
      Date.now());
  })();
}

/**
 * Notatka biura — nasze ustalenia, których Allegro nie zna.
 *
 * Do dziennika idzie DŁUGOŚĆ, nigdy treść: notatka bywa zdaniem o kliencie,
 * a `events` nie ma retencji i nie jest kasowane (§9 architektury).
 */
export function zapiszNotatke(
  database: Db, id: number, notatka: string | null, autor: string, wersja?: number,
): WierszReklamacji {
  const wartosc = (notatka ?? "").trim() || null;
  return transaction(database, () => {
    doZapisu(database, id, wersja);
    database.prepare(
      "UPDATE reklamacja_klienta SET notatka=?, wersja=wersja+1 WHERE id=? AND typ='CLAIM'",
    ).run(wartosc, id);
    logEvent("reklamacja_notatka", autor, null,
      { id, znakow: wartosc?.length ?? 0 }, undefined, database);
    return zWiersza(
      database.prepare("SELECT * FROM reklamacja_klienta WHERE id=? AND typ='CLAIM'")
        .get(id) as Wiersz,
      Date.now());
  })();
}

/**
 * Adres załącznika u Allegro.
 *
 * Trasa pobrania czyta go stąd, a nie z żądania — inaczej nasz serwer stałby
 * się bramką pod dowolny adres. Sam `pobierzZalacznik` sprawdza jeszcze host
 * i to są dwie niezależne zapory, bo obie kosztują jedną linijkę.
 */
export function adresZalacznika(
  database: Db, reklamacjaId: number, zalacznikId: number,
): { url: string; nazwa: string } {
  const z = database.prepare(
    "SELECT url, nazwa FROM reklamacja_zalacznik WHERE id=? AND reklamacja_id=?",
  ).get(zalacznikId, reklamacjaId) as { url: string; nazwa: string } | undefined;
  if (!z) throw new BladReklamacji("Nie ma takiego załącznika przy tej reklamacji", 404);
  return { url: z.url, nazwa: z.nazwa || "zalacznik" };
}
