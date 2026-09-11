import type { DatabaseSync } from "node:sqlite";
import { zloz } from "../tekst.js";

/* ── Fakty ze sprawy dla Copilota (0.282.0) ──────────────────────────────────
   POWSTAŁO Z JEDNEJ KARTY, którą właściciel wkleił z żywego panelu. Copilot
   poprosił agenta o „datę zakupu / numer zamówienia" i o „zdjęcia tabliczki
   w celu identyfikacji modelu" — czyli o trzy rzeczy, z których numer
   zamówienia stoi na wierszu sprawy, data przyszła w tej samej odpowiedzi
   Allegro, a model towaru zna oferta.

   Prosił, bo nie dostał. `rozpoznajSprawe` podawało modelowi WYŁĄCZNIE czat.
   Wiersz `reklamacja_klienta` niesie przy tym `powod_typ`, `oczekiwanie`,
   `ilosc`, `decyzja_do` i całe zgłoszenie z formularza — pola, które model
   mozolnie odtwarzał z prozy klienta, mając je o krok dalej.

   ENUMY PODAJEMY KODEM, nie po polsku, i to jest decyzja. Mapy polskich
   etykiet (`POWODY`, `OCZEKIWANIA`) mieszkają w panelu, bo to on rysuje je
   człowiekowi. Druga kopia na serwerze rozjechałaby się z pierwszą przy
   pierwszym nowym powodzie Allegro, a model kodu `DEFECT_FOUND_DURING_USE`
   nie potrzebuje tłumaczyć — obok stoi `powod_opis`, czyli zdanie klienta.  */

/** Opis zgłoszenia bywa elaboratem; do modelu idzie początek. */
export const SUFIT_OPISU = 800;

export interface FaktySprawy {
  temat: string | null;
  opis: string | null;
  powodTyp: string | null;
  powodOpis: string | null;
  prawo: string | null;
  oczekiwanie: string | null;
  oczekiwanaKwotaGrosze: number | null;
  waluta: string;
  ilosc: number | null;
  zwrotWymagany: boolean | null;
  orderId: string | null;
  offerId: string | null;
  nazwaTowaru: string | null;
  /** `boughtAt` z zamówienia albo `checkoutForm.createdAt` z ładunku sprawy. */
  kupionoAt: string | null;
  kupionoZrodlo: "zamowienie" | "sprawa" | null;
  otwartoAt: string | null;
  decyzjaDo: string | null;
}

const tekst = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Fakty jednym zapytaniem — wiersz sprawy plus nazwa oferty i data zamówienia.
 *
 * Te same dwa złączenia co w `listaReklamacji`, bo to ta sama prawda o tej
 * samej sprawie. Osobne zapytanie tylko dlatego, że rozpoznanie nie potrzebuje
 * ani kubełka, ani sygnałów, ani zdjęcia oferty.
 */
export function faktySprawy(database: DatabaseSync, reklamacjaId: number): FaktySprawy | null {
  const w = database.prepare(`SELECT r.*, o.nazwa AS oferta_nazwa, zk.kupiono_at
    FROM reklamacja_klienta r
    LEFT JOIN offer_snapshot o
      ON o.channel_account_id = r.channel_account_id AND o.external_id = r.offer_id
    LEFT JOIN zamowienie_klienta zk
      ON zk.channel_account_id = r.channel_account_id AND zk.external_id = r.order_id
   WHERE r.id = ?`).get(reklamacjaId) as Record<string, unknown> | undefined;
  if (!w) return null;
  const zZamowienia = tekst(w.kupiono_at);
  const zeSprawy = tekst(w.zamowienie_at);
  return {
    temat: tekst(w.temat),
    opis: tekst(w.opis),
    powodTyp: tekst(w.powod_typ),
    powodOpis: tekst(w.powod_opis),
    prawo: tekst(w.prawo),
    oczekiwanie: tekst(w.oczekiwanie),
    oczekiwanaKwotaGrosze: w.oczekiwana_kwota_grosze == null
      ? null : Number(w.oczekiwana_kwota_grosze),
    waluta: String(w.waluta ?? "PLN"),
    ilosc: w.ilosc == null ? null : Number(w.ilosc),
    zwrotWymagany: w.zwrot_wymagany == null ? null : Number(w.zwrot_wymagany) === 1,
    orderId: tekst(w.order_id),
    offerId: tekst(w.offer_id),
    nazwaTowaru: tekst(w.oferta_nazwa),
    kupionoAt: zZamowienia ?? zeSprawy,
    kupionoZrodlo: zZamowienia ? "zamowienie" : zeSprawy ? "sprawa" : null,
    otwartoAt: tekst(w.otwarto_at),
    decyzjaDo: tekst(w.decyzja_do),
  };
}

const dzien = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

const zlote = (grosze: number, waluta: string) =>
  `${(grosze / 100).toFixed(2).replace(".", ",")} ${waluta}`;

/**
 * Fakty jako tekst dla modelu.
 *
 * PUSTE POLA POMIJAMY, nie wypisujemy z kreską. Wiersz „Termin decyzji: —"
 * uczyłby model, że wiemy o terminie tyle, ile o kwocie; a nie wiemy nic.
 * Czego w bloku nie ma, tego naprawdę nie mamy — i dopiero wtedy prośba
 * o to w polu `brakuje` jest zasadna.
 */
export function tekstFaktow(f: FaktySprawy): string {
  const linie: string[] = [];
  const dopisz = (etykieta: string, wartosc: string | null) => {
    if (wartosc) linie.push(`- ${etykieta}: ${wartosc}`);
  };

  dopisz("Temat zgłoszenia", f.temat);
  if (f.opis) {
    const przyciety = f.opis.length > SUFIT_OPISU
      ? `${f.opis.slice(0, SUFIT_OPISU)} […dalszy ciąg pominięty]`
      : f.opis;
    dopisz("Opis zgłoszenia", przyciety.replace(/\s*\n\s*/g, " "));
  }
  dopisz("Powód wg Allegro", f.powodTyp);
  dopisz("Powód opisany przez klienta", f.powodOpis);
  dopisz("Podstawa", f.prawo);
  dopisz("Czego klient żąda", f.oczekiwanie);
  if (f.oczekiwanaKwotaGrosze !== null) {
    dopisz("Kwota, o którą prosi", zlote(f.oczekiwanaKwotaGrosze, f.waluta));
  }
  if (f.ilosc !== null) dopisz("Ilość objęta sprawą", String(f.ilosc));
  dopisz("Reklamowany towar", f.nazwaTowaru);
  dopisz("Numer oferty", f.offerId);
  dopisz("Numer zamówienia", f.orderId);
  /* ETYKIETA MÓWI, KTÓRY TO ZEGAR. `boughtAt` z zamówienia to moment zakupu
     pozycji; `checkoutForm.createdAt` to złożenie koszyka i bywa wcześniejszy.
     Blizna 0.121.0 wzięła się z nazwania jednego zegara drugim. */
  if (f.kupionoAt) {
    dopisz(f.kupionoZrodlo === "zamowienie" ? "Kupiono" : "Zamówienie złożone",
      dzien(f.kupionoAt));
  }
  dopisz("Sprawa otwarta", dzien(f.otwartoAt));
  dopisz("Termin decyzji", dzien(f.decyzjaDo));
  if (f.zwrotWymagany !== null) {
    dopisz("Zwrot towaru zażądany przez sprzedawcę", f.zwrotWymagany ? "tak" : "nie");
  }
  return linie.join("\n");
}

/* ── Sito na „brakuje" ───────────────────────────────────────────────────────
   `brakuje` jest jedynym polem karty BEZ cytatu i jedynym, którego
   `odsiejBezPokrycia` nie sprawdza wcale. Instrukcja może prosić, żeby model
   nie wypisywał tego, co dostał; kod ma tego pilnować. Ta sama para co przy
   `sugerujeWerdykt`: prompt prosi, kod rozstrzyga.

   DOPASOWUJEMY POJĘCIA, NIE SŁOWA. Pozycja wypada wyłącznie wtedy, gdy trafia
   we frazę pojęcia ORAZ to pojęcie naprawdę mamy w faktach. „Termin decyzji"
   przy pustym `decyzja_do` zostaje, bo naprawdę go nie znamy.

   STRAŻNIK IDZIE PIERWSZY i jest ważniejszy od całej reszty. Sito, które
   utnie za dużo, kasuje najcenniejszą pozycję karty — a to właśnie „brakuje"
   trzyma sprawę w miejscu, nie brak decyzji.                                 */

/** Frazy, których nie tnie NIC. Sprawdzane przed pojęciami. */
const NIGDY_NIE_TNIEMY: RegExp[] = [
  /* Dowód zakupu to DOKUMENT, nie data — znajomość daty go nie zastępuje. */
  /paragon|faktur|dowod zakupu|karta gwarancyjn|gwarancj/,
  /* Tożsamość egzemplarza. Numer oferty mówi, CO kupiono, nie KTÓRY sztuk. */
  /seryjn|tabliczk|numer partii|numer fabryczn/,
  /* Materiał, którego z definicji nie mamy w tekście. */
  /zdjeci|fotograf|zdjec|film|nagran|wideo/,
  /* Moment AWARII to nie moment zakupu i nigdy nim nie będzie. */
  /usterk|awari|zepsu|uszkodz/,
  /* Sposób użycia — o tym wie wyłącznie klient. */
  /jak czesto|warunk|serwisowan|uzytkowan|instrukcj|konserwacj/,
];

interface Pojecie {
  klucz: string;
  mamy: (f: FaktySprawy) => boolean;
  frazy: RegExp[];
}

const POJECIA: Pojecie[] = [
  { klucz: "zakup",
    mamy: (f) => f.kupionoAt !== null,
    frazy: [/data zakupu/, /daty zakupu/, /kiedy kupion/, /kiedy zakupion/,
      /data zamowienia/] },
  { klucz: "zamowienie",
    mamy: (f) => f.orderId !== null,
    frazy: [/numer zamowienia/, /nr zamowienia/, /identyfikator zamowienia/] },
  { klucz: "towar",
    mamy: (f) => f.nazwaTowaru !== null,
    frazy: [/identyfikacj\w* modelu/, /jaki to model/, /nazwa towaru/,
      /nazwa produktu/, /jaki produkt/, /model urzadzenia/] },
  { klucz: "oczekiwanie",
    mamy: (f) => f.oczekiwanie !== null,
    frazy: [/czego klient oczekuje/, /czego oczekuje klient/, /czy klient chce/,
      /oczekiwanie klienta/, /naprawe czy wymiane/] },
  { klucz: "kwota",
    mamy: (f) => f.oczekiwanaKwotaGrosze !== null,
    frazy: [/kwot\w* zwrotu/, /jakiej kwoty/, /wysokosc zwrotu/, /oczekiwana kwota/] },
  { klucz: "termin",
    mamy: (f) => f.decyzjaDo !== null,
    frazy: [/termin na decyzj/, /termin decyzji/, /do kiedy decyzj/] },
  { klucz: "podstawa",
    mamy: (f) => f.prawo !== null,
    frazy: [/rekojmi\w* czy gwarancj/, /podstawa prawna/, /z jakiego tytulu/] },
];

/**
 * Usuń z `brakuje` pozycje pytające o to, co właśnie podaliśmy.
 *
 * Zwraca też licznik, bo sito jest HEURYSTYKĄ i ma się dać zmierzyć. Bez
 * liczby w dzienniku nikt po miesiącu nie odpowie, czy tnie za dużo.
 */
export function odsiejZnane(
  brakuje: string[], f: FaktySprawy,
): { brakuje: string[]; odsiano: number } {
  let odsiano = 0;
  const zostaje = brakuje.filter((pozycja) => {
    const n = zloz(pozycja);
    if (NIGDY_NIE_TNIEMY.some((re) => re.test(n))) return true;
    const znane = POJECIA.some((p) => p.mamy(f) && p.frazy.some((re) => re.test(n)));
    if (znane) odsiano += 1;
    return !znane;
  });
  return { brakuje: zostaje, odsiano };
}
