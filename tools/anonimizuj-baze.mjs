#!/usr/bin/env node
/* ── ANONIMIZACJA KOPII BAZY (0.550.2) ──────────────────────────────────────
   Robi z kopii `wertis.db` plik bez danych osobowych klientów i pracowników.
   Plik ma zachować KSZTAŁT danych: długości tekstów, liczbę wierszy, powiązania
   po loginie i numerze zamówienia. Po to powstał: ekran ocenia się na
   prawdziwych długościach i prawdziwym wolumenie, a dane klientów nie mają
   prawa opuścić biura.

     node tools/anonimizuj-baze.mjs <kopia.db> <wynik.db> [--ziarno=tekst]

   Wejściem jest KOPIA z folderu kopii serwera (`server\data\kopie`), nigdy
   żywa baza. Kopia z `VACUUM INTO` jest samodzielnym plikiem. Żywa baza chodzi
   w WAL, więc jej kopia bywa niespójna. Wejście zostaje nietknięte: narzędzie
   pracuje na własnym duplikacie.

   ── JAK DZIAŁA I DLACZEGO TAK ─────────────────────────────────────────────
   1. DOMYŚLNIE ODMOWA. Każda kolumna tekstowa jest rozsypywana, chyba że
      jawnie należy do znanych bezpiecznych: znaczników czasu, statusów,
      identyfikatorów i kartoteki towarowej. Nowa kolumna, o której nikt nie
      pomyślał, jest więc rozsypana, a nie wycieka. Kosztem bywa brzydszy
      ekran, nigdy wyciek.
   2. ROZSYP ZACHOWUJE KSZTAŁT. Litera zostaje literą tej samej wielkości
      i klasy (samogłoska za samogłoskę, spółgłoska za spółgłoskę), cyfra
      cyfrą, znaki interpunkcyjne i odstępy stoją. Zawijanie, ucinanie
      i szerokość wyglądają jak prawdziwe, a treść znika. Zwykłe losowanie
      liter dałoby inne szerokości niż prawdziwy tekst.
   3. LOGIN, PRACOWNIK I ODBIORCA MAJĄ SPÓJNY ZAMIENNIK. Ten sam login
      (bez wielkości liter) dostaje ten sam zamiennik w każdej tabeli, bo
      droga klienta łączy sprawy po loginie. Zamienniki są różnowartościowe,
      bo baza pilnuje unikalności loginów.
   4. JSON ZOSTAJE JSON-em. Klucze, liczby i identyfikatory stoją, teksty są
      rozsypane. Bez tego payload zdarzeń nie dałby się otworzyć.
   5. ZIARNO JEST LOSOWE przy każdym uruchomieniu i nigdzie nie leży.
      Rozsypu nie da się odtworzyć nawet znając to narzędzie.
   6. SKANER WYCIEKÓW NA KOŃCU. Przed rozsypem narzędzie zbiera wartości,
      które MUSZĄ zniknąć: loginy, imiona, telefony, ulice, adresy e-mail,
      tokeny. Potem szuka ich w gotowym pliku, po wartościach i po bajtach.
      Znalezienie czegokolwiek kasuje wynik i kończy pracę kodem 2. Skaner
      nie wypisuje znalezionych wartości, tylko miejsce i liczbę.
   7. WYNIK POWSTAJE PRZEZ `VACUUM INTO`, więc nie zawiera stron po
      skasowanych danych. Zwykły `UPDATE` zostawia stare treści w wolnych
      stronach pliku.

   ── CO ZOSTAJE BEZ ZMIAN ──────────────────────────────────────────────────
   Kartoteka towarowa i dokumenty Subiekta (`sgt_*`, oferty, silniki, modele,
   pasowania): to dane firmy, nie klientów. Liczby, kwoty i znaczniki czasu.
   Identyfikatory zamówień, ofert i wiadomości Allegro: bez konta sprzedawcy
   nic nie znaczą, a na nich stoją powiązania między tabelami.
   Tokeny Allegro, sesje i hasła są USUWANE, nie rozsypywane.

   Skrypt nie ma zależności poza Node 22 (`node:sqlite`), żeby uruchomić go
   tam, gdzie stoi kopia, bez `npm`. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

/* ── REGUŁY ─────────────────────────────────────────────────────────────── */

export const R = Object.freeze({
  ZOSTAJE: "zostaje",
  TEKST: "tekst",
  KLIENT: "klient",
  PRACOWNIK: "pracownik",
  OSOBA: "osoba",
  TELEFON: "telefon",
  TELEFON_CYFRY: "telefon_cyfry",
  PLIK: "plik",
  SEKRET: "sekret",
});

/** Tabele opróżniane w całości: tokeny Allegro i sesje nie mają prawa wyjść. */
export const TABELE_DO_OPROZNIENIA = ["allegro_token", "device_session"];

/** Kolumny opróżnianych tabel, które trafiają na listę do skanu. Nie wszystkie: znaczniki czasu byłyby wszędzie. */
const SEKRETNE_KOLUMNY = { allegro_token: ["access_token", "refresh_token"], device_session: ["token"] };

/** Tabele pełne danych firmy, nie klientów. Ich kolumny zostają, z wyjątkiem swobodnego tekstu. */
const KATALOG = [
  /^sgt_/, /^offer_snapshot$/, /^oferta_/, /^towar_identyfikator$/, /^alias_silnika$/, /^token_silnika/,
  /^model_urzadzenia$/, /^model_z_opisu$/, /^ean_/, /^strefa_regula$/, /^wymiar_kartoteki$/,
  /^zastosowanie$/, /^zabudowa_silnika$/, /^zamiennosc_oem$/, /^pasowanie_/, /^dostawca_logo$/,
];

/** Kolumny swobodnego tekstu: w kartotece też są rozsypywane, bo pisze je człowiek o czymkolwiek. */
const SWOBODNY = /(komentarz|notatka|powod|uzasadnienie|dowod_|tresc|instrukcja|blad|opis_zdarzenia)/;

/** Kto sprawił, że wiersz powstał: nazwa albo login pracownika. */
const PRACOWNIK = /(^|_)(przez|by)$|^(dodal|zaimportowal|wycofal|rozstrzygnal|zaproponowal|prowadzi|kto|zakonczyl|autor)$/;

/** Autorzy, którzy nie są ludźmi. Zamiennik zrobiłby z automatu osobę. */
const AUTOMATY = new Set([
  "automat", "system", "copilot", "takt", "sync", "import", "instalator", "dev", "jev",
  "allegro", "wlasciciel", "zaawansowane", "anonim",
]);

/**
 * Słowa, które bywają loginem, a są też wartością słownika (rola „admin”).
 * Nie trafiają na listę do skanu: skaner krzyczałby na kolumnę `role`,
 * w której to słowo ma prawo stać.
 */
const SLOWA_SLOWNIKOWE = new Set(["admin", "biuro", "magazynier", "system", "automat"]);

/** Kolumny, których wartości są słownikiem, znacznikiem czasu albo identyfikatorem. */
const ZOSTAJE = [
  /(^|_)(at|do|od|until)$/, /^(data|dzien|tydzien|utworzono|zmieniono)$/,
  /^(status|stan|typ|type|rodzaj|role|rola|direction|priorytet|waluta|channel|akcja|zrodlo|tryb|prawo|ocena|werdykt|kategoria|pewnosc|model|polaryzacja|pozycja|unit|mime|mime_type|etag|klucz|lokalizacja|kod|przewoznik)$/,
  /^(status|stan)_/, /_(status|stan|typ|type|rodzaj|kod|code|wersja|tryb|rola|zrodlo|metoda|przewoznik|kategoria|wariant)$/,
  /(^|_)ids?$/, /^external_/, /_(key|hash|symbol)$/,
  /^(symbol|sku|ean|reference_number|zamowienie|zamowienia|oferty|numer|nr_pelny|nr_oryg|kategorie_dodatkowe|kody_polityki|taksonomia_wersja|mapowanie_wersja|polityka_wersja|prompt_wersja|api_wersja)$/,
  /_(numer|number)$/,
];

/** Wyjątki pojedyncze, każdy z powodem. */
const JAWNE = {
  "events.user_id": [R.PRACOWNIK, "nazwa pracownika w dzienniku zdarzeń, mimo nazwy user_id"],
  "app_user.login": [R.PRACOWNIK, "login pracownika"],
  "app_user.name": [R.PRACOWNIK, "imię i nazwisko pracownika"],
  "app_user.haslo_hash": [R.SEKRET, "skrót hasła"],
  "zamowienie_klienta.odbiorca_nazwa": [R.OSOBA, "odbiorca przesyłki"],
  "zwrot_klienta.odbiorca_nazwa": [R.OSOBA, "odbiorca przesyłki"],
  "zamowienie_klienta.odbiorca_kod": [R.TEKST, "kod pocztowy adresu dostawy, nie słownik mimo końcówki _kod"],
  "channel_account.external_account_id": [R.TEKST, "identyfikator konta sprzedawcy"],
  "zamowienie_klienta.odbiorca_telefon": [R.TELEFON, "telefon z adresu dostawy"],
  "zamowienie_klienta.odbiorca_telefon_cyfry": [R.TELEFON_CYFRY, "te same cyfry do szukania po końcówce"],
  "message_attachment.file_name": [R.PLIK, "nazwa pliku od klienta"],
  "reklamacja_zalacznik.nazwa": [R.PLIK, "nazwa pliku od klienta"],
  "reklamacja_zalacznik_wysylki.nazwa": [R.PLIK, "nazwa pliku"],
  "wysylka_zalacznik.nazwa": [R.PLIK, "nazwa pliku"],
  "reklamacja_tag.nazwa": [R.ZOSTAJE, "etykiety zespołu, nie klientów"],
  "raport_tygodnia.od": [R.ZOSTAJE, "data"],
  "raport_tygodnia.do": [R.ZOSTAJE, "data"],
  "zamowienie_klienta_pozycja.nazwa": [R.ZOSTAJE, "nazwa towaru z oferty"],
  "zwrot_klienta_pozycja.nazwa": [R.ZOSTAJE, "nazwa towaru z oferty"],
  "zadanie_terenowe.zrodlo_ref": [R.ZOSTAJE, "odsyłacz do obiektu, po którym ekran nawiguje"],
  "dobor_rozmowy.marka": [R.ZOSTAJE, "opis maszyny, nie osoby"],
  "dobor_rozmowy.model": [R.ZOSTAJE, "opis maszyny, nie osoby"],
  "dobor_rozmowy.wariant": [R.ZOSTAJE, "opis maszyny, nie osoby"],
  "dobor_rozmowy.rocznik": [R.ZOSTAJE, "opis maszyny, nie osoby"],
  "dobor_rozmowy.silnik": [R.ZOSTAJE, "opis maszyny, nie osoby"],
  "dobor_rozmowy.oem": [R.ZOSTAJE, "numer części"],
  "dobor_rozmowy.nazwa_czesci": [R.ZOSTAJE, "nazwa części"],
  "dobor_rozmowy.wybrany_symbol": [R.ZOSTAJE, "symbol z kartoteki"],
  "dobor_rozmowy.wybrany_droga": [R.ZOSTAJE, "słownik"],
  "copilot_wywolanie.zadanie": [R.ZOSTAJE, "nazwa zadania modelu, nie jego treść"],
  "copilot_wywolanie.model": [R.ZOSTAJE, "identyfikator modelu"],
  "conversation.priorytet": [R.ZOSTAJE, "słownik"],
  "klient_dosylka.zamowienie": [R.ZOSTAJE, "identyfikator zamówienia"],
  "allegro_inbox_thread.watek_zamowienia": [R.ZOSTAJE, "identyfikator zamówienia"],
  "allegro_inbox_message.related_object_id": [R.ZOSTAJE, "identyfikator obiektu Allegro"],
  "message.related_object_id": [R.ZOSTAJE, "identyfikator obiektu Allegro"],
  "message.related_order_id": [R.ZOSTAJE, "identyfikator zamówienia"],
  "allegro_inbox_message.related_object_type": [R.ZOSTAJE, "rodzaj obiektu Allegro"],
  "message.related_object_type": [R.ZOSTAJE, "rodzaj obiektu Allegro"],
  "allegro_inbox_thread.watek_podtyp": [R.ZOSTAJE, "słownik Allegro"],
  "decyzja_klasyfikacji.watek_podtyp": [R.ZOSTAJE, "słownik Allegro"],
  "decyzja_klasyfikacji.kategoria_allegro": [R.ZOSTAJE, "słownik"],
  "decyzja_klasyfikacji.kategoria_modelu": [R.ZOSTAJE, "słownik"],
  "decyzja_klasyfikacji.kategoria_czlowieka": [R.ZOSTAJE, "słownik"],
  "decyzja_klasyfikacji.akcja_modelu": [R.ZOSTAJE, "słownik"],
  "delivery.dostawca": [R.ZOSTAJE, "nazwa dostawcy firmy"],
  "delivery.data_dok": [R.ZOSTAJE, "data dokumentu"],
  "delivery_line.tw_nazwa": [R.ZOSTAJE, "nazwa towaru z kartoteki"],
  "delivery_line.lok_oczekiwana": [R.ZOSTAJE, "lokalizacja w magazynie"],
  "delivery_line.lok_faktyczna": [R.ZOSTAJE, "lokalizacja w magazynie"],
  "kosz_pozycja.nazwa": [R.ZOSTAJE, "nazwa towaru z kartoteki"],
  "kosz_pozycja.lok_faktyczna": [R.ZOSTAJE, "lokalizacja w magazynie"],
  "import_odsylaczy.dostawca": [R.ZOSTAJE, "nazwa dostawcy firmy"],
  "problem.sym_obcy": [R.ZOSTAJE, "symbol obcego towaru"],
  "problem.foto_ref": [R.ZOSTAJE, "odsyłacz do zdjęcia"],
  "zadanie_zalacznik.foto_ref": [R.ZOSTAJE, "odsyłacz do zdjęcia"],
  "zbiorka.symbol_csv": [R.ZOSTAJE, "symbole z kartoteki"],
  "counters.name": [R.ZOSTAJE, "nazwa licznika"],
  "process_state.name": [R.ZOSTAJE, "nazwa procesu"],
  "process_state.sgt_mode": [R.ZOSTAJE, "tryb"],
  "process_state.sfera_mode": [R.ZOSTAJE, "tryb"],
  "towar_fts_config.k": [R.ZOSTAJE, "indeks pełnotekstowy"],
};

const jestKatalogiem = (tabela) => KATALOG.some((re) => re.test(tabela));

/**
 * Reguła dla kolumny. Kolejność jest treścią: jawne wyjątki, potem ludzie
 * (loginy i pracownicy wygrywają z kartoteką), potem znane bezpieczne, na
 * końcu odmowa.
 * @param {Set<string>} [wyliczenia] `tabela.kolumna` ze słownikiem w `CHECK`
 * @returns {{ regula: string, powod: string }}
 */
export function regulaKolumny(tabela, kolumna, wyliczenia = new Set()) {
  const jawna = JAWNE[`${tabela}.${kolumna}`];
  if (jawna) return { regula: jawna[0], powod: jawna[1] };
  if (/(^|_)login$/.test(kolumna)) return { regula: R.KLIENT, powod: "login Allegro" };
  if (PRACOWNIK.test(kolumna)) return { regula: R.PRACOWNIK, powod: "autor zmiany" };
  /* Kolumna z `CHECK (... IN (...))` ma słownik, a baza odrzuci każdą inną
     wartość. Rozsyp wywaliłby cały `UPDATE`, więc słownik zostaje. */
  if (wyliczenia.has(`${tabela}.${kolumna}`)) return { regula: R.ZOSTAJE, powod: "CHECK ... IN w schemacie" };
  if (jestKatalogiem(tabela) && !SWOBODNY.test(kolumna)) return { regula: R.ZOSTAJE, powod: "kartoteka firmy" };
  if (ZOSTAJE.some((re) => re.test(kolumna))) return { regula: R.ZOSTAJE, powod: "słownik, czas albo identyfikator" };
  return { regula: R.TEKST, powod: "domyślna odmowa" };
}

/* ── ROZSYP ─────────────────────────────────────────────────────────────── */

const SAMOGLOSKI = "aeiouy";
const SAMOGLOSKI_PL = "ąęó";
const SPOLGLOSKI = "bcdfghjklmnpqrstvwxz";
const SPOLGLOSKI_PL = "ćłńśźż";
const UUID_ROZDZIEL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const UUID_CALY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CZAS_ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const WYLICZENIE = /^[A-Z][A-Z0-9_]{1,40}$/;
const KLUCZ_IDENTYFIKATORA = /(^|_)ids?$|Ids?$|^(id|ids)$|offer|order|zamow|ofert|symbol|sku|ean|status|stan|type|typ$|kind|rodzaj|role|rola|kod$|code|currency|waluta|reference|external|version|wersja|model|zrodlo|source/i;

/** Generator liczb z ziarna. Mały, szybki, wystarczy do rozsypu. */
function generator(ziarno, klucz) {
  const bajty = crypto.createHmac("sha256", ziarno).update(klucz).digest();
  let a = bajty.readUInt32LE(0);
  return (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const wybierz = (zbior, los) => zbior[los(zbior.length)];

function rozsypZnak(c, los) {
  const mala = c.toLowerCase();
  let wynik;
  if (c >= "0" && c <= "9") return String(los(10));
  if (SAMOGLOSKI.includes(mala)) wynik = wybierz(SAMOGLOSKI, los);
  else if (SAMOGLOSKI_PL.includes(mala)) wynik = wybierz(SAMOGLOSKI_PL, los);
  else if (SPOLGLOSKI.includes(mala)) wynik = wybierz(SPOLGLOSKI, los);
  else if (SPOLGLOSKI_PL.includes(mala)) wynik = wybierz(SPOLGLOSKI_PL, los);
  else if (/\p{L}/u.test(c)) wynik = wybierz(SPOLGLOSKI, los);
  else return c;
  return c === mala ? wynik : wynik.toUpperCase();
}

/**
 * Rozsypuje tekst zachowując kształt. Ten sam tekst i ta sama przestrzeń dają
 * ten sam wynik, więc cytat powtórzony w dwóch wiadomościach zostaje cytatem.
 * UUID-y stoją: to identyfikatory, na których ekran łączy obiekty.
 */
export function rozsypTekst(tekst, ziarno, przestrzen) {
  const los = generator(ziarno, `${przestrzen}\0${tekst}`);
  const kawalki = tekst.split(UUID_ROZDZIEL);
  return kawalki.map((k, i) => (i % 2 === 1 ? k : Array.from(k, (c) => rozsypZnak(c, los)).join(""))).join("");
}

/**
 * Zamiennik różnowartościowy. Dwa różne wejścia nigdy nie dostają tego samego
 * wyjścia, a wyjście nigdy nie równa się wejściu. Unikalność loginów pilnuje
 * baza, więc kolizja wywaliłaby cały `UPDATE`.
 */
class Zamienniki {
  constructor(nazwa, ziarno, { bezWielkosci = true } = {}) {
    this.nazwa = nazwa;
    this.ziarno = ziarno;
    this.bezWielkosci = bezWielkosci;
    this.mapa = new Map();
    this.uzyte = new Set();
  }

  daj(wejscie) {
    const klucz = this.bezWielkosci ? wejscie.trim().toLowerCase() : wejscie;
    const znany = this.mapa.get(klucz);
    if (znany !== undefined) return znany;
    for (let proba = 0; ; proba++) {
      const rdzen = rozsypTekst(this.bezWielkosci ? wejscie.trim() : wejscie, this.ziarno, `${this.nazwa}:${proba}`);
      /* Bardzo krótkie wejścia mają za mało możliwych wyjść. Po wielu próbach
         dopisujemy numer, żeby pętla zawsze się kończyła. */
      const kandydat = proba > 200 ? `${rdzen}${proba}` : rdzen;
      const porownanie = kandydat.toLowerCase();
      if (porownanie === klucz || this.uzyte.has(porownanie)) continue;
      this.mapa.set(klucz, kandydat);
      this.uzyte.add(porownanie);
      return kandydat;
    }
  }
}

/** JSON: klucze, liczby i identyfikatory zostają, teksty są rozsypane. */
function rozsypJson(w, klucz, ziarno) {
  if (Array.isArray(w)) return w.map((x) => rozsypJson(x, klucz, ziarno));
  if (w !== null && typeof w === "object") {
    return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, rozsypJson(v, k, ziarno)]));
  }
  if (typeof w !== "string") return w;
  if (CZAS_ISO.test(w) || UUID_CALY.test(w) || WYLICZENIE.test(w)) return w;
  /* Tekst pod kluczem-identyfikatorem zostaje, ale tylko gdy wygląda jak
     identyfikator: bez odstępów. Zdanie pod kluczem `orderNote` ma zniknąć. */
  if (KLUCZ_IDENTYFIKATORA.test(klucz) && w.length <= 64 && /^[\w\-:./]+$/.test(w)) return w;
  return rozsypTekst(w, ziarno, "json");
}

/** Rozsypuje tekst albo JSON w tekście. */
function rozsypWartosc(w, ziarno) {
  const przyciety = w.trim();
  if ((przyciety.startsWith("{") && przyciety.endsWith("}")) || (przyciety.startsWith("[") && przyciety.endsWith("]"))) {
    try {
      return JSON.stringify(rozsypJson(JSON.parse(w), "", ziarno));
    } catch { /* nie JSON, więc zwykły tekst */ }
  }
  return rozsypTekst(w, ziarno, "tekst");
}

function rozsypPlik(nazwa, ziarno) {
  const m = /^(.*)\.([A-Za-z0-9]{1,5})$/.exec(nazwa);
  return m ? `${rozsypTekst(m[1], ziarno, "plik")}.${m[2]}` : rozsypTekst(nazwa, ziarno, "plik");
}

/* Najmniejszy poprawny PNG 1×1. Zdjęcia znikają, ekran pokazuje kwadrat. */
const PNG_ZASTEPCZY = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
  "base64"));

/**
 * Kolumny, które schemat sam ogranicza do słownika: `CHECK (k IN (...))`.
 * Czytane z `sqlite_master`, więc nowy słownik w migracji jest widoczny bez
 * dopisywania go tutaj.
 */
export function wyliczeniaZeSchematu(db) {
  const wynik = new Set();
  const tabele = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
  for (const { name, sql } of tabele) {
    if (!sql) continue;
    for (const check of sql.matchAll(/CHECK\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/gi)) {
      for (const m of check[1].matchAll(/"?(\w+)"?\s+IN\s*\(/gi)) wynik.add(`${name}.${m[1]}`);
    }
  }
  return wynik;
}

/* ── WARTOŚCI, KTÓRE MUSZĄ ZNIKNĄĆ ───────────────────────────────────────── */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const TELEFON_W_TEKSCIE = /(?<![\d])(?:\+?48[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}(?![\d])/g;

/**
 * Zbiór wartości do wyszukania w gotowym pliku. Krótkie wartości są
 * pomijane: trzy litery trafiają w połowę słownika i skaner, który krzyczy
 * bez powodu, przestaje być czytany.
 */
export class Igly {
  constructor() {
    this.slowa = new Set();
    this.pominiete = 0;
  }

  dodaj(wartosc, { minimum = 4 } = {}) {
    const w = String(wartosc ?? "").trim();
    if (w.length < minimum) { if (w.length > 0) this.pominiete++; return; }
    this.slowa.add(w);
    this.slowa.add(w.toLowerCase());
  }

  dodajCyfry(wartosc) {
    const c = String(wartosc ?? "").replace(/\D/g, "");
    if (c.length >= 7) this.slowa.add(c);
  }

  /** Adresy e-mail i telefony wpisane w tekst klienta. */
  zTekstu(tekst) {
    for (const m of tekst.matchAll(EMAIL)) this.dodaj(m[0]);
    for (const m of tekst.matchAll(TELEFON_W_TEKSCIE)) this.dodajCyfry(m[0]);
  }
}

/* ── SZUKANIE MNÓSTWA WARTOŚCI NARAZ (Aho–Corasick) ─────────────────────────
   Tysiące loginów w megabajtach tekstu. Osobne `includes` na każdą wartość
   liczyłyby się godzinami. */
class Automat {
  constructor(slowa) {
    this.wezly = [{ dalej: new Map(), porazka: 0, koniec: [] }];
    for (const s of slowa) {
      let n = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        let nast = this.wezly[n].dalej.get(c);
        if (nast === undefined) {
          nast = this.wezly.length;
          this.wezly.push({ dalej: new Map(), porazka: 0, koniec: [] });
          this.wezly[n].dalej.set(c, nast);
        }
        n = nast;
      }
      this.wezly[n].koniec.push(s.length);
    }
    const kolejka = [];
    for (const nast of this.wezly[0].dalej.values()) kolejka.push(nast);
    while (kolejka.length) {
      const n = kolejka.shift();
      for (const [c, nast] of this.wezly[n].dalej) {
        let p = this.wezly[n].porazka;
        while (p !== 0 && !this.wezly[p].dalej.has(c)) p = this.wezly[p].porazka;
        const cel = this.wezly[p].dalej.get(c);
        this.wezly[nast].porazka = cel !== undefined && cel !== nast ? cel : 0;
        this.wezly[nast].koniec.push(...this.wezly[this.wezly[nast].porazka].koniec);
        kolejka.push(nast);
      }
    }
  }

  /** Liczba trafień. Z `granice` trafienie musi stać między znakami niebędącymi literą ani cyfrą. */
  ile(tekst, { granice = true } = {}) {
    let n = 0;
    let trafien = 0;
    for (let i = 0; i < tekst.length; i++) {
      const c = tekst[i];
      while (n !== 0 && !this.wezly[n].dalej.has(c)) n = this.wezly[n].porazka;
      n = this.wezly[n].dalej.get(c) ?? 0;
      for (const dl of this.wezly[n].koniec) {
        if (!granice) { trafien++; continue; }
        const przed = tekst[i - dl];
        const po = tekst[i + 1];
        if (!(przed && /[\p{L}\p{N}]/u.test(przed)) && !(po && /[\p{L}\p{N}]/u.test(po))) trafien++;
      }
    }
    return trafien;
  }
}

/**
 * Szuka `igly` w gotowym pliku: po wartościach komórek (bez wielkości liter)
 * i po surowych bajtach (z wielkością). Drugie sito łapie to, czego pierwsze
 * nie widzi: strony indeksów i tabel wirtualnych. Nie wypisuje wartości.
 * @returns {{ miejsce: string, ile: number }[]}
 */
export function skanujWycieki(sciezka, igly, kolumnyStale = new Set()) {
  const wszystkie = [...igly.slowa];
  if (wszystkie.length === 0) return [];
  /* Same cyfry (telefony wyłuskane z tekstu) trafiałyby w identyfikatory,
     które zostają w kolumnach-słownikach. Szukamy ich tylko tam, gdzie
     wszystko jest rozsypane. */
  const slowa = wszystkie.filter((s) => !/^\d+$/.test(s));
  const cyfry = wszystkie.filter((s) => /^\d+$/.test(s));
  const trafienia = [];
  const db = new DatabaseSync(sciezka);
  try {
    const malePelne = new Automat(slowa.map((s) => s.toLowerCase()));
    const cyfrowe = cyfry.length ? new Automat(cyfry) : null;
    const tabele = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'towar_fts%' AND sql NOT LIKE 'CREATE VIRTUAL%'").all();
    for (const { name } of tabele) {
      const kolumny = db.prepare(`PRAGMA table_info("${name}")`).all().map((k) => k.name);
      const ile = new Map();
      const wiersze = db.prepare(`SELECT ${kolumny.map((k) => `"${k}"`).join(",")} FROM "${name}"`);
      for (const w of wiersze.all()) {
        for (const k of kolumny) {
          const v = w[k];
          if (typeof v !== "string" || v.length < 4) continue;
          let t = malePelne.ile(v.toLowerCase());
          if (cyfrowe && !kolumnyStale.has(`${name}.${k}`)) t += cyfrowe.ile(v);
          if (t > 0) ile.set(k, (ile.get(k) ?? 0) + t);
        }
      }
      for (const [k, n] of ile) trafienia.push({ miejsce: `${name}.${k}`, ile: n });
    }
  } finally {
    db.close();
  }
  /* Surowe bajty: wartości dłuższe niż 5 znaków, w obu wielkościach. */
  const bajtowe = slowa.filter((s) => s.length >= 6).map((s) => Buffer.from(s, "utf8").toString("latin1"));
  if (bajtowe.length) {
    const automat = new Automat(bajtowe);
    const maks = Math.max(...bajtowe.map((s) => s.length));
    const fd = fs.openSync(sciezka, "r");
    try {
      const ROZMIAR = 8 * 1024 * 1024;
      const bufor = Buffer.alloc(ROZMIAR + maks);
      let poz = 0;
      let ogon = 0;
      let surowe = 0;
      for (;;) {
        const przeczytano = fs.readSync(fd, bufor, ogon, ROZMIAR, poz);
        if (przeczytano === 0) break;
        poz += przeczytano;
        const razem = ogon + przeczytano;
        surowe += automat.ile(bufor.toString("latin1", 0, razem), { granice: false });
        /* Ogon o jeden bajt krótszy niż najdłuższa wartość przechodzi do
           następnej porcji, żeby trafienie na styku porcji nie uciekło.
           Trafienie w ogonie policzy się dwa razy, co nie szkodzi: liczy się
           zero albo nie-zero. */
        ogon = Math.min(maks - 1, razem);
        bufor.copy(bufor, 0, razem - ogon, razem);
      }
      if (surowe > 0) trafienia.push({ miejsce: "(surowe bajty pliku)", ile: surowe });
    } finally {
      fs.closeSync(fd);
    }
  }
  return trafienia;
}

/* ── PRZETWARZANIE TABEL ─────────────────────────────────────────────────── */

const TYP_LICZBOWY = /INT|REAL|NUM|BOOL|FLOA|DOUB|DEC/i;
const PORCJA = 2000;
const KROTKIE = 12;

function przetworzWartosc(regula, v, kolumnaId, ctx, igly) {
  switch (regula) {
    case R.KLIENT:
      if (!SLOWA_SLOWNIKOWE.has(v.trim().toLowerCase())) igly.dodaj(v);
      return ctx.klient.daj(v);
    case R.PRACOWNIK:
      if (AUTOMATY.has(v.trim().toLowerCase())) return v;
      if (!SLOWA_SLOWNIKOWE.has(v.trim().toLowerCase())) igly.dodaj(v);
      return ctx.pracownik.daj(v);
    case R.OSOBA:
      igly.dodaj(v);
      return ctx.osoba.daj(v);
    case R.TELEFON:
      igly.dodajCyfry(v);
      return rozsypTekst(v, ctx.ziarno, "telefon");
    case R.SEKRET:
      igly.dodaj(v, { minimum: 8 });
      /* Sam wykrzyknik: nie jest poprawnym skrótem, więc nikt się nie zaloguje,
         a nie zawiera słów, które skaner mógłby znaleźć w samym sobie. */
      return "!";
    case R.PLIK:
      return rozsypPlik(v, ctx.ziarno);
    default: {
      igly.zTekstu(v);
      const przyciety = v.trim();
      const jsonowy = (przyciety.startsWith("{") && przyciety.endsWith("}")) || (przyciety.startsWith("[") && przyciety.endsWith("]"));
      if (jsonowy || v.length >= KROTKIE) return rozsypWartosc(v, ctx.ziarno);
      /* Krótkie teksty mogą stać w kolumnach z unikalnością, więc dostają
         zamiennik różnowartościowy. Tekst bez liter i cyfr nic nie zdradza. */
      if (!/[\p{L}\p{N}]/u.test(v)) return v;
      let z = ctx.krotkie.get(kolumnaId);
      if (!z) ctx.krotkie.set(kolumnaId, (z = new Zamienniki(`krotki:${kolumnaId}`, ctx.ziarno, { bezWielkosci: false })));
      return z.daj(v);
    }
  }
}

/** Zapis wyjątku z nazwą kolumny, żeby dało się dopisać wyjątek zamiast szukać. */
class BladKolumny extends Error {
  constructor(kolumna, przyczyna) {
    super(`${kolumna}: ${przyczyna}`);
    this.kolumna = kolumna;
  }
}

function przetworzTabele(db, tabela, ctx, igly, raport) {
  const kolumny = db.prepare(`PRAGMA table_info("${tabela}")`).all();
  const plan = [];
  for (const k of kolumny) {
    const blob = /BLOB/i.test(k.type) || k.type === "";
    if (TYP_LICZBOWY.test(k.type) && !blob) continue;
    const nadpisana = ctx.nadpisania?.[`${tabela}.${k.name}`];
    const { regula, powod } = nadpisana
      ? { regula: nadpisana, powod: "nadpisana w wywołaniu" }
      : regulaKolumny(tabela, k.name, ctx.wyliczenia);
    raport.kolumny.push({ tabela, kolumna: k.name, regula, powod });
    if (regula !== R.ZOSTAJE || blob) plan.push({ nazwa: k.name, regula });
  }
  if (plan.length === 0) return 0;
  /* Telefon musi być przed swoimi cyframi, bo cyfry wynikają z niego. */
  plan.sort((a, b) => (a.regula === R.TELEFON_CYFRY) - (b.regula === R.TELEFON_CYFRY));
  const maMime = kolumny.some((k) => k.name === "mime");
  const wybor = db.prepare(`SELECT rowid AS _r, ${plan.map((p) => `"${p.nazwa}"`).join(",")}${maMime ? ',"mime"' : ""}
    FROM "${tabela}" WHERE rowid > ? ORDER BY rowid LIMIT ${PORCJA}`);
  const zapis = db.prepare(`UPDATE "${tabela}" SET ${plan.map((p) => `"${p.nazwa}"=?`).join(",")}${maMime ? ',"mime"=?' : ""} WHERE rowid=?`);
  let ostatni = -1;
  let zmienionych = 0;
  for (;;) {
    const porcja = wybor.all(ostatni);
    if (porcja.length === 0) break;
    for (const w of porcja) {
      let nowyTelefon = null;
      let podmienionoObraz = false;
      const nowe = plan.map((p) => {
        const v = w[p.nazwa];
        if (v === null || v === undefined) return v;
        if (v instanceof Uint8Array) { podmienionoObraz = true; return PNG_ZASTEPCZY; }
        if (typeof v !== "string" || p.regula === R.ZOSTAJE || v === "") return v;
        if (p.regula === R.TELEFON_CYFRY) {
          igly.dodajCyfry(v);
          return nowyTelefon !== null ? nowyTelefon.replace(/\D/g, "") : rozsypTekst(v, ctx.ziarno, "telefon");
        }
        const wynik = przetworzWartosc(p.regula, v, `${tabela}.${p.nazwa}`, ctx, igly);
        if (p.regula === R.TELEFON) nowyTelefon = wynik;
        return wynik;
      });
      if (maMime) nowe.push(podmienionoObraz ? "image/png" : w.mime);
      try {
        zapis.run(...nowe, w._r);
      } catch (e) {
        throw new BladKolumny(tabela, e instanceof Error ? e.message : String(e));
      }
      zmienionych++;
    }
    ostatni = porcja.at(-1)._r;
  }
  return zmienionych;
}

/* ── CAŁOŚĆ ──────────────────────────────────────────────────────────────── */

/**
 * @param {string} wejscie kopia bazy z folderu kopii
 * @param {string} wyjscie plik do utworzenia; nie może istnieć
 * @param {{ ziarno?: string, log?: (s: string) => void, reguly?: Record<string, string> }} [opcje]
 *   `reguly` nadpisuje regułę kolumny (`"tabela.kolumna": R.ZOSTAJE`). Służy testom,
 *   które sprawdzają, że błędna reguła kończy się odmową skanera, a nie wyciekiem.
 */
export function anonimizuj(wejscie, wyjscie, opcje = {}) {
  const log = opcje.log ?? (() => {});
  if (!fs.existsSync(wejscie)) throw new Error(`Nie ma pliku ${wejscie}.`);
  if (fs.existsSync(wyjscie)) throw new Error(`Plik ${wyjscie} już istnieje. Wskaż nową nazwę, nic nie nadpisuję.`);
  if (path.resolve(wejscie) === path.resolve(wyjscie)) throw new Error("Wejście i wynik to ten sam plik.");
  const wal = `${wejscie}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
    throw new Error("Obok pliku leży niepusty -wal, więc to żywa baza. Użyj kopii z folderu kopii serwera.");
  }
  const ziarno = opcje.ziarno ?? crypto.randomBytes(32).toString("hex");
  const praca = `${wyjscie}.praca`;
  fs.copyFileSync(wejscie, praca);
  const igly = new Igly();
  const raport = { tabele: 0, wierszy: 0, oproznione: [], kolumny: [], skaner: [], pominieteIgly: 0 };
  const liczby = new Map();
  try {
    const db = new DatabaseSync(praca);
    try {
      db.exec("PRAGMA foreign_keys = OFF; PRAGMA synchronous = OFF; PRAGMA journal_mode = OFF;");
      const ctx = {
        ziarno, wyliczenia: wyliczeniaZeSchematu(db), krotkie: new Map(), nadpisania: opcje.reguly,
        klient: new Zamienniki("klient", ziarno),
        pracownik: new Zamienniki("pracownik", ziarno),
        osoba: new Zamienniki("osoba", ziarno),
      };
      const tabele = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'towar_fts%' AND sql NOT LIKE 'CREATE VIRTUAL%' ORDER BY name").all().map((t) => t.name);
      for (const t of tabele) liczby.set(t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n);
      /* Adres dostawy i dane firmy nie mają reguły, która by je zbierała jako
         wartości do skanu, więc dopisujemy je tu, zanim znikną. */
      const doZebrania = [
        ["zamowienie_klienta", "odbiorca_ulica"], ["firma", "nazwa"], ["firma", "nip"], ["firma", "adres"],
        ["firma", "osoba"], ["firma", "telefon"], ["channel_account", "display_name"],
      ];
      db.exec("BEGIN");
      for (const [t, k] of doZebrania) {
        if (!liczby.has(t)) continue;
        let wartosci = [];
        try {
          wartosci = db.prepare(`SELECT DISTINCT "${k}" AS v FROM "${t}"`).all();
        } catch { /* kopia sprzed migracji: kolumny jeszcze nie ma */ }
        for (const w of wartosci) {
          if (k === "nip" || k === "telefon") igly.dodajCyfry(w.v); else igly.dodaj(w.v);
        }
      }
      for (const t of tabele) {
        if (TABELE_DO_OPROZNIENIA.includes(t)) {
          for (const k of SEKRETNE_KOLUMNY[t] ?? []) {
            for (const w of db.prepare(`SELECT "${k}" AS v FROM "${t}"`).all()) igly.dodaj(w.v, { minimum: 16 });
          }
          db.exec(`DELETE FROM "${t}"`);
          raport.oproznione.push(t);
          continue;
        }
        raport.wierszy += przetworzTabele(db, t, ctx, igly, raport);
        raport.tabele++;
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    const koncowa = new DatabaseSync(praca);
    try {
      koncowa.exec("PRAGMA journal_mode = DELETE");
      koncowa.prepare("VACUUM INTO ?").run(wyjscie);
    } finally {
      koncowa.close();
    }
  } catch (e) {
    fs.rmSync(wyjscie, { force: true });
    throw e;
  } finally {
    fs.rmSync(praca, { force: true });
  }
  raport.pominieteIgly = igly.pominiete;

  /* Sprawdzenie wyniku: spójność pliku, liczba wierszy, skaner wycieków. */
  const wynik = new DatabaseSync(wyjscie);
  try {
    const kontrola = wynik.prepare("PRAGMA quick_check").all().map((r) => Object.values(r)[0]);
    if (kontrola.length !== 1 || kontrola[0] !== "ok") throw new Error(`Wynik nie przeszedł quick_check: ${kontrola.join("; ")}`);
    for (const [t, n] of liczby) {
      if (TABELE_DO_OPROZNIENIA.includes(t)) continue;
      const po = wynik.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
      if (po !== n) throw new Error(`Tabela ${t} miała ${n} wierszy, a po anonimizacji ${po}.`);
    }
  } catch (e) {
    wynik.close();
    fs.rmSync(wyjscie, { force: true });
    throw e;
  }
  wynik.close();
  const stale = new Set(raport.kolumny.filter((k) => k.regula === R.ZOSTAJE).map((k) => `${k.tabela}.${k.kolumna}`));
  raport.skaner = skanujWycieki(wyjscie, igly, stale);
  log(`skaner: ${igly.slowa.size} wartości do sprawdzenia`);
  if (raport.skaner.length) {
    fs.rmSync(wyjscie, { force: true });
    const blad = new Error("Skaner znalazł w wyniku dane, które miały zniknąć. Wynik skasowany.");
    blad.raport = raport;
    throw blad;
  }
  return raport;
}

/* ── WIERSZ POLECEŃ ──────────────────────────────────────────────────────── */

function uruchom(argv) {
  const ziarno = argv.find((a) => a.startsWith("--ziarno="))?.slice(9);
  const pozycyjne = argv.filter((a) => !a.startsWith("--"));
  if (argv.includes("--pomoc") || pozycyjne.length !== 2) {
    console.error("Użycie: node tools/anonimizuj-baze.mjs <kopia.db> <wynik.db> [--ziarno=tekst]");
    console.error("Wejściem jest kopia z folderu kopii serwera, nigdy żywa baza.");
    return pozycyjne.length === 2 ? 0 : 1;
  }
  const [wejscie, wyjscie] = pozycyjne;
  try {
    const r = anonimizuj(wejscie, wyjscie, { ziarno });
    const licz = {};
    for (const k of r.kolumny) licz[k.regula] = (licz[k.regula] ?? 0) + 1;
    fs.writeFileSync(`${wyjscie}.kolumny.txt`,
      r.kolumny.map((k) => `${k.regula}\t${k.tabela}.${k.kolumna}\t${k.powod}`).join("\n") + "\n");
    console.log(`Gotowe: ${wyjscie}`);
    console.log(`Tabel: ${r.tabele}, przetworzonych wierszy: ${r.wierszy}.`);
    console.log(`Opróżnione tabele: ${r.oproznione.join(", ") || "brak"}.`);
    console.log(`Kolumny tekstowe wg reguły: ${Object.entries(licz).map(([k, n]) => `${k} ${n}`).join(", ")}.`);
    console.log(`Skaner wycieków: nic nie znaleziono (pominięto ${r.pominieteIgly} wartości krótszych niż 4 znaki).`);
    console.log(`Lista kolumn i reguł, bez danych: ${wyjscie}.kolumny.txt`);
    return 0;
  } catch (e) {
    console.error(`Błąd: ${e instanceof Error ? e.message : e}`);
    if (e && e.raport) {
      for (const t of e.raport.skaner) console.error(`  ${t.miejsce}: ${t.ile}`);
      return 2;
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = uruchom(process.argv.slice(2));
}
