import { db as defaultDb, transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { listaZwrotow, type WierszZwrotu } from "./zwroty.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { linkOferty, linkReklamacji, linkZamowienia } from "./allegro-linki.js";

/* ── Reklamacje klienckie — model pracy biura (0.222.0) ──────────────────────
   Panel prowadzi wyłącznie reklamacje (`type: "CLAIM"`), a nie dyskusje —
   decyzja właściciela z 6 września 2026. Odsiewa je synchronizator, więc do
   tego pliku dyskusja nie dociera; kolumna `typ` zostaje wyłącznie po to,
   żeby dało się to sprawdzić.

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

/** Konflikt wersji — panel dostaje 409 i pokazuje, co się zmieniło. */
export class ReklamacjaConflict extends Error {
  constructor(readonly szczegoly: Record<string, unknown>) {
    super("Reklamacja zmieniła się, odkąd ją otworzyłeś — odśwież i spróbuj jeszcze raz");
    this.name = "ReklamacjaConflict";
  }
}

export type Kubelek = "decyzja" | "odpowiedz" | "zamknieta";

export type Sygnal =
  | "termin"
  | "klient_czeka"
  | "doradca"
  | "czat_zamkniety"
  | "zwrot_wymagany"
  | "status_nieznany";

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

/** Statusy ostatniej wiadomości, przy których ruch należy do nas. */
const CZEKA_NA_NAS = ["NEW", "BUYER_REPLIED"];

/** Ile dni przed terminem decyzji wiersz zapala się na czerwono. */
const PROG_TERMINU_DNI = 3;

const DZIEN_MS = 86_400_000;

export interface ZalacznikReklamacji {
  id: number;
  wiadomoscId: number | null;
  nazwa: string;
}

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
  wersja: number;
  kubelek: Kubelek;
  sygnaly: Sygnal[];
  /* Odnośniki do Allegro. `null` znaczy „nie ma czego linkować" i ekran
     pokazuje wtedy sam tekst, a nie odnośnik prowadzący donikąd. */
  link: string | null;
  linkZamowienia: string | null;
  linkOferty: string | null;
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
export function kubelek(w: {
  statusAllegro: string | null;
  ostatniaWiadomoscStatus: string | null;
  czatAktywny: boolean;
}): Kubelek {
  if (!ROZSTRZYGNIETE.includes(w.statusAllegro ?? "")) return "decyzja";
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
}): Sygnal[] {
  const s: Sygnal[] = [];
  const otwarta = !ROZSTRZYGNIETE.includes(w.statusAllegro ?? "");
  if (otwarta && w.dniDoTerminu !== null && w.dniDoTerminu <= PROG_TERMINU_DNI) s.push("termin");
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
  const rdzen = {
    statusAllegro, dniDoTerminu: dni, ostatniaWiadomoscStatus: ostatnia,
    czatAktywny, zwrotWymagany,
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
    wersja: Number(w.wersja ?? 1),
    kubelek: kubelek(rdzen),
    sygnaly: sygnaly(rdzen),
    /* Numer czytelny bije identyfikator: Centrum Sprzedaży szuka po tym, co
       widzi też kupujący. Bez numeru zostaje identyfikator sprawy. */
    link: linkReklamacji(tekst(w.reference_number) ?? String(w.external_id)),
    linkZamowienia: linkZamowienia(tekst(w.order_id)),
    linkOferty: linkOferty(tekst(w.offer_id)),
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
  const wiersze = database.prepare(`SELECT * FROM reklamacja_klienta
    ORDER BY decyzja_do IS NULL, decyzja_do ASC, otwarto_at DESC`).all() as Wiersz[];
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
  const w = database.prepare("SELECT * FROM reklamacja_klienta WHERE id=?")
    .get(id) as Wiersz | undefined;
  if (!w) throw new BladReklamacji(`Reklamacja ${id} nie istnieje`, 404);
  const reklamacja = zWiersza(w, teraz);
  const konto = Number(w.channel_account_id);

  const zwroty = reklamacja.orderId
    ? listaZwrotow(database, teraz, { channelAccountId: konto, orderId: reklamacja.orderId })
    : [];

  /* Rozmowy o tym zakupie. Grupujemy po rozmowie, bo jeden zakup potrafi mieć
     kilka wątków. Zero nowych żądań do Allegro: numer zamówienia reklamacja ma
     od pierwszej synchronizacji, a wiadomości leżą już w naszej bazie. */
  const rozmowy = reklamacja.orderId ? (database.prepare(`
    SELECT c.id, c.subject, c.status, MAX(m.sent_at) AS ostatnia
      FROM message m JOIN conversation c ON c.id = m.conversation_id
     WHERE m.related_order_id = ?
     GROUP BY c.id
     ORDER BY ostatnia DESC`).all(reklamacja.orderId) as Wiersz[]).map((r) => ({
    id: Number(r.id),
    temat: tekst(r.subject),
    status: String(r.status),
    ostatniaAt: tekst(r.ostatnia),
  })) : [];

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

/** Wiersz do mutacji plus kontrola wersji. Wspólne dla obu zapisów niżej. */
function doZapisu(database: Db, id: number, wersja: number | undefined) {
  const w = database.prepare(
    "SELECT id, wersja, prowadzi FROM reklamacja_klienta WHERE id=?",
  ).get(id) as { id: number; wersja: number; prowadzi: string | null } | undefined;
  if (!w) throw new BladReklamacji(`Reklamacja ${id} nie istnieje`, 404);
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
      SET prowadzi=?, prowadzi_at=?, wersja=wersja+1 WHERE id=?`).run(
      zdejmuje ? null : autor, zdejmuje ? null : new Date().toISOString(), id);
    logEvent("reklamacja_prowadzi", autor, null, { id, zdjete: zdejmuje }, undefined, database);
    return zWiersza(
      database.prepare("SELECT * FROM reklamacja_klienta WHERE id=?").get(id) as Wiersz,
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
      "UPDATE reklamacja_klienta SET notatka=?, wersja=wersja+1 WHERE id=?",
    ).run(wartosc, id);
    logEvent("reklamacja_notatka", autor, null,
      { id, znakow: wartosc?.length ?? 0 }, undefined, database);
    return zWiersza(
      database.prepare("SELECT * FROM reklamacja_klienta WHERE id=?").get(id) as Wiersz,
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
