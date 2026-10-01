#!/usr/bin/env node
/* ── ANONIMIZACJA KOPII BAZY (0.550.2) ──────────────────────────────────────
   Robi z kopii `wertis.db` plik bez danych osobowych klientów i pracowników.
   Plik ma zachować KSZTAŁT danych: długości tekstów, liczbę wierszy, powiązania
   po loginie i numerze zamówienia. Po to powstał: ekran ocenia się na
   prawdziwych długościach i prawdziwym wolumenie, a dane klientów nie mają
   prawa opuścić biura.

     node tools/anonimizuj-baze.mjs <kopia.db> <wynik.db>

   Wejściem jest KOPIA z folderu kopii serwera (`server\data\kopie`), nigdy
   żywa baza. Kopia z `VACUUM INTO` jest samodzielnym plikiem. Żywa baza chodzi
   w WAL, więc jej kopia bywa niespójna: narzędzie odmawia pliku z trybem WAL
   w nagłówku i pliku z niepustym `-wal`. Wejście zostaje nietknięte,
   narzędzie pracuje na własnym duplikacie.

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
   4. JSON ZOSTAJE JSON-em. Klucze zostają. Pod kluczem osobowym (`buyer`,
      `login`, `address`, `text` i podobne) rozsypane jest wszystko, także
      liczby i identyfikatory, bo Allegro zostawia w lądowisku `buyer.id`.
      Poza nimi stoją liczby, UUID-y, znaczniki czasu, słowa
      WIELKIMI_LITERAMI i krótkie identyfikatory pod kluczem na Id. Loginy
      z JSON-a dostają ten sam zamiennik co loginy z kolumn.
   5. ZIARNO JEST LOSOWE przy każdym uruchomieniu i nigdzie nie leży. Wiersz
      poleceń nie przyjmuje ziarna: jawne ziarno daje wynik odtwarzalny, a kto
      je zna, może sprawdzać loginy przez ponowny rozsyp.
   6. SKANER WYCIEKÓW NA KOŃCU. Przed rozsypem narzędzie zbiera wartości,
      które MUSZĄ zniknąć: loginy, imiona, telefony, ulice, adresy e-mail,
      tokeny. Potem szuka ich w gotowym pliku, po wartościach i po bajtach.
      Znalezienie czegokolwiek kończy pracę kodem 2. Skaner nie wypisuje
      znalezionych wartości, tylko miejsce i liczbę. Nie widzi wartości
      krótszych niż 4 znaki i nie zna imion wpisanych w wolny tekst, tam
      chroni sam rozsyp.
   7. WYNIK DOSTAJE DOCELOWĄ NAZWĘ DOPIERO PO SKANIE. Cała praca, łącznie
      z pełną kopią z danymi osobowymi, idzie w katalogu tymczasowym systemu,
      a nie obok wyniku: pulpit i Dokumenty bywają synchronizowane z chmurą.
      Wynik powstaje przez `VACUUM INTO`, więc nie zawiera stron po
      skasowanych danych. Jeśli skaner albo cokolwiek innego zawiedzie, pod
      docelową nazwą nie ma nic.

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
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const SWOBODNY = /(komentarz|notatka|powod|uzasadnienie|dowod_|tresc|instrukcja|blad|opis_zdarzenia|warunek)/;

/** Kto sprawił, że wiersz powstał: nazwa albo login pracownika. */
const PRACOWNIK = /(^|_)(przez|by)$|^(dodal|zaimportowal|wycofal|rozstrzygnal|zaproponowal|prowadzi|kto|zakonczyl|autor)$/;

/** Autorzy, którzy nie są ludźmi. Zamiennik zrobiłby z automatu osobę. */
const AUTOMATY = new Set([
  "automat", "system", "copilot", "takt", "sync", "import", "instalator", "dev",
  "allegro", "wlasciciel", "zaawansowane", "anonim", "oferta",
]);

/**
 * Słowa, które bywają loginem, a są też wartością słownika (rola „admin”).
 * Nie trafiają na listę do skanu: skaner krzyczałby na kolumnę `role`,
 * w której to słowo ma prawo stać.
 */
const SLOWA_SLOWNIKOWE = new Set(["admin", "biuro", "magazynier", "system", "automat"]);

/**
 * Autor systemowy: sam znacznik („automat”) albo znacznik z dopiskiem („automat (oferta)”).
 * Kod zapisuje takie wartości wprost, w kolumnach autora i w JSON-ie. To nie człowiek,
 * więc nie dostaje zamiennika i nie jest igłą.
 */
const autorSystemowy = (v) => {
  const n = String(v).trim().toLowerCase();
  if (AUTOMATY.has(n)) return true;
  const m = /^([\p{L}_-]+) \(.*\)$/u.exec(n);
  return m !== null && AUTOMATY.has(m[1]);
};
const slowoNieOsobowe = (v) => autorSystemowy(v) || SLOWA_SLOWNIKOWE.has(String(v).trim().toLowerCase());

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
  "dobor_rozmowy.marka": [R.TEKST, "wpisuje pracownik w trakcie rozmowy, bez walidacji"],
  "dobor_rozmowy.model": [R.TEKST, "wpisuje pracownik w trakcie rozmowy, bez walidacji"],
  "dobor_rozmowy.wariant": [R.TEKST, "wpisuje pracownik w trakcie rozmowy, bez walidacji"],
  "dobor_rozmowy.rocznik": [R.TEKST, "wpisuje pracownik w trakcie rozmowy, bez walidacji"],
  "dobor_rozmowy.silnik": [R.TEKST, "wpisuje pracownik w trakcie rozmowy, bez walidacji"],
  "dobor_rozmowy.oem": [R.ZOSTAJE, "numer części"],
  "dobor_rozmowy.nazwa_czesci": [R.TEKST, "wpisuje pracownik w trakcie rozmowy, bez walidacji"],
  "dobor_rozmowy.wybrany_symbol": [R.ZOSTAJE, "symbol z kartoteki"],
  "dobor_rozmowy.wybrany_droga": [R.ZOSTAJE, "słownik"],
  "dobor.marka": [R.TEKST, "wpisuje pracownik albo automat z rozmowy, bez walidacji"],
  "dobor.model": [R.TEKST, "wpisuje pracownik albo automat z rozmowy, bez walidacji"],
  "dobor.wariant": [R.TEKST, "wpisuje pracownik albo automat z rozmowy, bez walidacji"],
  "dobor.rocznik": [R.TEKST, "wpisuje pracownik albo automat z rozmowy, bez walidacji"],
  "dobor.silnik": [R.TEKST, "wpisuje pracownik albo automat z rozmowy, bez walidacji"],
  "dobor.nazwa_czesci": [R.TEKST, "wpisuje pracownik albo automat z rozmowy, bez walidacji"],
  "dobor.dopytac": [R.TEKST, "zdanie pracownika o tym, czego brakuje"],
  "dobor.oem": [R.ZOSTAJE, "numer części"],
  "dobor.symbol": [R.ZOSTAJE, "symbol z kartoteki"],
  "dobor.podstawa": [R.ZOSTAJE, "słownik"],
  "dobor.wynik": [R.ZOSTAJE, "słownik"],
  "dobor.zmienil": [R.PRACOWNIK, "autor zmiany: pracownik albo automat"],
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
/* Zostają UUID-y (na nich ekran łączy obiekty) i znacznik „wycięto przy pobraniu”
   z `services/allegro-oczyszczanie.ts` (`USUNIETE`): bez niego sygnał, że pole
   celowo puste, wyglądałby po rozsypie jak losowy tekst. Znacznik jest stałą,
   nie daną, więc nie trafia też na listę wartości do skanu. */
const ZNACZNIK_USUNIECIA = "[usunięte przy pobraniu]";
const ZACHOWANE_ROZDZIEL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\[usunięte przy pobraniu\])/gi;
const UUID_CALY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CZAS_ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
/* Bez cyfr: „READY_FOR_PROCESSING” jest słownikiem, „GLS12345678” numerem listu. */
const WYLICZENIE = /^[A-Z][A-Z_]{1,40}$/;
/* Klucze, pod którymi JSON niesie osobę albo tekst od człowieka. Wartość pod takim
   kluczem, i pod każdym kluczem w jego wnętrzu, jest rozsypywana bez wyjątków:
   także liczba, identyfikator, UUID i słowo pisane wielkimi literami. Allegro
   zostawia w lądowisku `buyer.id`, a login bywa zapisany jako `OGRODNIK_77`. */
const KLUCZ_OSOBOWY = /login|name|nazw|imi[eę]|mail|phone|tel|miast|city|street|ulic|address|adres|zip|post|poczt|nip|pesel|iban|konto|account|note|uwag|komentarz|message|wiadom|text|tresc|buyer|interlocutor|author|seller|sender|recipient|odbiorc|kupuj|klient|customer|person|osob|owner|company|firma|pickup|tax|user|receiver|participant|autor|konta|full/i;
/* Co trafia na listę wartości do skanu. To węższy zbiór niż kluczy rozsypywanych:
   `name` pod `offer` czy `method` to nazwa towaru i sposobu dostawy, która zostaje
   w kolumnach z kartoteki, więc jako „dana do wyszukania” dawałaby fałszywy alarm na
   każdej bazie z zamówieniami. Igłą jest wartość pod kluczem, który sam mówi „człowiek”,
   albo pod dowolnym kluczem wewnątrz obiektu, który jest człowiekiem (`buyer.id`). */
/* BEZ `nazw`: pasowało do `nazwa`, czyli do nazwy części, modelu maszyny i dostawcy, które stoją też
   w kartotece i w słownikach. Do nazwisk służy `nazwisk`. */
const KLUCZ_DO_IGIEL = /login|mail|phone|tel|first|last|full|company|street|city|zip|post|poczt|nip|pesel|iban|konto|account|text|note|uwag|komentarz|message|wiadom|tresc|imi|nazwisk|odbiorc|kupuj|adres|address|tax|user|autor/i;
/* Klucze z tekstem pisanym przez człowieka. Krótki tekst („Okej”, „Tak”) nic nie identyfikuje, a stoi
   w tysiącach komórek, więc jako igła zatrzymywałby narzędzie na każdej kolumnie. */
const KLUCZ_TEKSTU_SWOBODNEGO = /text|note|uwag|komentarz|message|wiadom|tresc/i;
const MIN_TEKST_SWOBODNY = 12;
/* Dziennik działań biura niesie wiedzę o kartotece (komentarze do zastosowań), nie treść od klientów. */
const ZRODLA_BEZ_TEKSTU_KLIENTA = new Set(["events.payload"]);
const KLUCZ_CZLOWIEKA = /buyer|interlocutor|author|seller|sender|recipient|receiver|odbiorc|kupuj|customer|person|osob|participant|autor|user|owner|company|contact|address/i;

/* Poza kluczami osobowymi zostaje krótki identyfikator pod kluczem kończącym się na Id
   oraz słowo pod kluczem-słownikiem. Nie szukamy tu podciągów: „order” czy „source”
   w środku klucza otwierały furtkę dla loginu pod `orderBuyerLogin`. */
const KLUCZ_IDENTYFIKATORA = /^(id|ids|uuid)$|(Id|Ids|_id|_ids|UUID)$/;
const KLUCZ_WYLICZENIA = /^(status|stan|type|typ|kind|rodzaj|role|rola|currency|waluta|code|kod|direction|priorytet|tryb|channel)$/i;

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
export function rozsypTekst(tekst, ziarno, przestrzen, unikaj = null) {
  const kawalki = tekst.split(ZACHOWANE_ROZDZIEL);
  /* Losowe cyfry trafiają czasem w PRAWDZIWY numer innego klienta: przy 16 tysiącach
     telefonów i dziewięciu cyfrach to około jedna taka zbieżność na przebieg. Skaner
     nie odróżni jej od wycieku i odmówi. Dlatego `unikaj` (zbiór numerów, które muszą
     zniknąć) odrzuca każdy wynik z takim ciągiem cyfr i losuje jeszcze raz. */
  for (let proba = 0; ; proba++) {
    const los = generator(ziarno, `${przestrzen}${proba ? `~${proba}` : ""}\0${tekst}`);
    const wynik = kawalki.map((k, i) => (i % 2 === 1 ? k : Array.from(k, (c) => rozsypZnak(c, los)).join(""))).join("");
    if (!unikaj || unikaj.size === 0 || proba >= 200) return wynik;
    let trafia = false;
    for (const m of wynik.matchAll(/\d{7,}/g)) if (unikaj.has(m[0])) { trafia = true; break; }
    if (!trafia) return wynik;
  }
}

/**
 * Zamiennik różnowartościowy. Dwa różne wejścia nigdy nie dostają tego samego
 * wyjścia, wyjście nigdy nie równa się wejściu, a także żadnej innej wartości,
 * która jeszcze czeka na zamianę. Bez ostatniego warunku login `ab` mógłby dostać
 * zamiennik `cd`, będący prawdziwym loginem innego klienta, i baza odrzuciłaby
 * `UPDATE` na unikalności w połowie przebiegu.
 */
class Zamienniki {
  /**
   * `bezWielkosci`: wejścia różniące się wielkością liter to jedna wartość (login).
   * `unikalneBezWielkosci`: dwa zamienniki różniące się tylko wielkością liter też
   * kolidują. Indeks na `lower(nazwa)` w etykietach zespołu odrzuciłby taką parę,
   * choć dla samej mapy są to dwie różne wartości.
   */
  constructor(nazwa, ziarno, { bezWielkosci = true, unikalneBezWielkosci = bezWielkosci } = {}) {
    this.nazwa = nazwa;
    this.ziarno = ziarno;
    this.bezWielkosci = bezWielkosci;
    this.unikalneBezWielkosci = unikalneBezWielkosci;
    this.mapa = new Map();
    this.uzyte = new Set();
    this.zabronione = new Set();
  }

  #klucz(w) {
    return this.bezWielkosci ? w.trim().toLowerCase() : w;
  }

  #porownanie(w) {
    return this.unikalneBezWielkosci ? w.trim().toLowerCase() : w;
  }

  /** Zgłasza wartość, która istnieje w bazie i nie może stać się czyimś zamiennikiem. */
  zabron(wejscie) {
    this.zabronione.add(this.#porownanie(wejscie));
  }

  daj(wejscie) {
    const surowy = this.bezWielkosci ? wejscie.trim() : wejscie;
    const klucz = this.#klucz(wejscie);
    const znany = this.mapa.get(klucz);
    if (znany !== undefined) return znany;
    for (let proba = 0; ; proba++) {
      const rdzen = rozsypTekst(surowy, this.ziarno, `${this.nazwa}:${proba}`);
      /* Bardzo krótkie wejścia mają za mało możliwych wyjść. Po wielu próbach
         dopisujemy numer, żeby pętla zawsze się kończyła. */
      const kandydat = proba > 200 ? `${rdzen}${proba}` : rdzen;
      const porownanie = this.#porownanie(kandydat);
      if (porownanie === this.#porownanie(surowy) || this.uzyte.has(porownanie) || this.zabronione.has(porownanie)) continue;
      this.mapa.set(klucz, kandydat);
      this.uzyte.add(porownanie);
      return kandydat;
    }
  }
}

/**
 * JSON: klucze zostają zawsze. Pod kluczem osobowym rozsypane jest wszystko,
 * także liczby. Poza nim zostają liczby, znaczniki czasu, UUID-y, słowa
 * WIELKIMI_LITERAMI, krótkie identyfikatory pod kluczem na Id i słowa pod
 * kluczem-słownikiem. Reszta jest tekstem od człowieka.
 *
 * Teksty idą przez tę samą przestrzeń rozsypu co zwykłe kolumny, więc numer
 * listu w kolumnie i w surowym JSON-ie dostaje ten sam zamiennik. Serwer łączy
 * zwroty z przesyłkami po numerze listu.
 */
/** Klucz JSON do raportu. Schemat Allegro pisze klucze camelCase od małej litery; klucz, który
    wygląda jak dana (wielka litera, cyfry), nie trafia do raportu, bo mógłby nią być. */
const kluczDoRaportu = (k) => (/^[a-z_][A-Za-z0-9_]{0,39}$/.test(k) && !/\d{4}/.test(k) ? k : "<klucz>");

/** Czy wartość spod klucza może być igłą skanera. Rozsypywana jest zawsze, igłą bywa rzadziej. */
function mozeBycIgla(w, klucz, ctx) {
  if (typeof w !== "string") return true;
  if (w === ZNACZNIK_USUNIECIA) return false;
  if (KLUCZ_WYLICZENIA.test(klucz)) return false;
  if (slowoNieOsobowe(w)) return false;
  if (KLUCZ_TEKSTU_SWOBODNEGO.test(klucz)) {
    if (w.trim().length < MIN_TEKST_SWOBODNY) return false;
    if (ZRODLA_BEZ_TEKSTU_KLIENTA.has(ctx.zrodloJson)) return false;
  }
  return true;
}

function rozsypJson(w, klucz, ctx, rodzicOsobowy = false, kluczRodzica = "", sciezka = "") {
  const osobowe = rodzicOsobowy || KLUCZ_OSOBOWY.test(klucz);
  if (Array.isArray(w)) return w.map((x) => rozsypJson(x, klucz, ctx, rodzicOsobowy, kluczRodzica, `${sciezka}[]`));
  if (w !== null && typeof w === "object") {
    return Object.fromEntries(Object.entries(w).map(([k, v]) =>
      [k, rozsypJson(v, k, ctx, osobowe, klucz, sciezka ? `${sciezka}.${kluczDoRaportu(k)}` : kluczDoRaportu(k))]));
  }
  /* Pole pod kluczem człowieka (`buyer.id`, `delivery.address.name`) jest igłą, bo jego wartość
     stoi też w kolumnach, które zostają. Czas i UUID pod takim kluczem (`modifiedAt`) nie są:
     wpadłyby do skanu i zatrzymały narzędzie na kolumnie z datą. */
  const podCzlowiekiem = KLUCZ_CZLOWIEKA.test(kluczRodzica) && !(typeof w === "string" && (CZAS_ISO.test(w) || UUID_CALY.test(w)));
  const doIgiel = osobowe && (KLUCZ_DO_IGIEL.test(klucz) || podCzlowiekiem);
  if (typeof w === "number") {
    if (!osobowe) return w;
    if (doIgiel) ctx.igly.dodajCyfry(String(w));
    const n = Number(rozsypTekst(String(w), ctx.ziarno, "liczba", ctx.igly.cyfry));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof w !== "string") return w;
  ctx.igly.zTekstu(w);
  if (osobowe) {
    if (doIgiel && mozeBycIgla(w, klucz, ctx)) ctx.igly.dodaj(w, { zrodlo: `${ctx.zrodloJson}: ${sciezka}` });
    if (/login/i.test(klucz)) return ctx.klient.daj(w);
    if (/phone|tel/i.test(klucz)) {
      if (doIgiel) ctx.igly.dodajCyfry(w);
      return rozsypTekst(w, ctx.ziarno, "telefon", ctx.igly.cyfry);
    }
    return rozsypTekst(w, ctx.ziarno, "tekst", ctx.igly.cyfry);
  }
  if (CZAS_ISO.test(w) || UUID_CALY.test(w) || WYLICZENIE.test(w)) return w;
  /* Tekst pod kluczem-identyfikatorem zostaje, ale tylko gdy wygląda jak
     identyfikator: bez odstępów. */
  const wyglada = w.length <= 64 && /^[\w\-:./]+$/.test(w);
  if (wyglada && (KLUCZ_IDENTYFIKATORA.test(klucz) || KLUCZ_WYLICZENIA.test(klucz))) return w;
  return rozsypTekst(w, ctx.ziarno, "tekst", ctx.igly.cyfry);
}

const wyglądaNaJson = (t) => {
  const p = t.trim();
  return (p.startsWith("{") && p.endsWith("}")) || (p.startsWith("[") && p.endsWith("]"));
};

/** Rozsypuje tekst albo JSON w tekście. E-maile i telefony wyłuskuje tylko z tekstów, nie z liczb JSON-a. */
function rozsypWartosc(w, ctx, kolumnaId = "json") {
  if (wyglądaNaJson(w)) {
    let drzewo;
    try {
      drzewo = JSON.parse(w);
    } catch { /* nie JSON, więc zwykły tekst */ }
    if (drzewo !== undefined) {
      ctx.zrodloJson = kolumnaId;
      return JSON.stringify(rozsypJson(drzewo, "", ctx));
    }
  }
  ctx.igly.zTekstu(w);
  return rozsypTekst(w, ctx.ziarno, "tekst", ctx.igly.cyfry);
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
    /** Ciągi cyfr (telefony, NIP), które rozsyp ma omijać. */
    this.cyfry = new Set();
    this.pominiete = 0;
    /** Skąd wzięła się igła (małe litery → numer etykiety). Bez tego raport skanera
        mówi tylko GDZIE igła trafiła, a nie skąd ją mamy, i nie da się rozróżnić
        wycieku od nazwy towaru, która stoi też w kolumnie osobowej. */
    this.zrodla = new Map();
    this.etykiety = [];
    this.numeryEtykiet = new Map();
  }

  #etykieta(zrodlo) {
    let n = this.numeryEtykiet.get(zrodlo);
    if (n === undefined) {
      n = this.etykiety.length;
      this.etykiety.push(zrodlo);
      this.numeryEtykiet.set(zrodlo, n);
    }
    return n;
  }

  /**
   * `bezWyjatkow`: czas i UUID zwykle nie identyfikują człowieka, a lądowały na
   * liście i zatrzymywały skaner na każdej kolumnie z datą. Wyjątek nie obejmuje
   * sekretów: token w kształcie UUID ma zostać na liście.
   */
  dodaj(wartosc, { minimum = 4, zrodlo = null, bezWyjatkow = false } = {}) {
    const w = String(wartosc ?? "").trim();
    if (w.length < minimum) { if (w.length > 0) this.pominiete++; return; }
    if (!bezWyjatkow && (CZAS_ISO.test(w) || UUID_CALY.test(w))) return;
    this.slowa.add(w);
    this.slowa.add(w.toLowerCase());
    if (zrodlo) {
      const male = w.toLowerCase();
      if (!this.zrodla.has(male)) this.zrodla.set(male, this.#etykieta(zrodlo));
    }
  }

  dodajCyfry(wartosc) {
    const c = String(wartosc ?? "").replace(/\D/g, "");
    if (c.length >= 7) {
      this.slowa.add(c);
      this.cyfry.add(c);
    }
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
    /* Indeks zamiast `shift()`: przy dwustu tysiącach wartości `shift` kopiuje tablicę
       za każdym razem i budowa trwała ponad minutę. */
    for (let i = 0; i < kolejka.length; i++) {
      const n = kolejka[i];
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

  /** Trafione fragmenty tekstu (w postaci, w jakiej stoją w tekście), z tymi samymi granicami co `ile`. */
  znajdz(tekst, { granice = true } = {}) {
    const wynik = [];
    let n = 0;
    for (let i = 0; i < tekst.length; i++) {
      const c = tekst[i];
      while (n !== 0 && !this.wezly[n].dalej.has(c)) n = this.wezly[n].porazka;
      n = this.wezly[n].dalej.get(c) ?? 0;
      for (const dl of this.wezly[n].koniec) {
        if (granice) {
          const przed = tekst[i - dl];
          const po = tekst[i + 1];
          if ((przed && /[\p{L}\p{N}]/u.test(przed)) || (po && /[\p{L}\p{N}]/u.test(po))) continue;
        }
        wynik.push(tekst.slice(i - dl + 1, i + 1));
      }
    }
    return wynik;
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

/** Kształt igły do raportu. Nie zdradza wartości, a mówi, czy trafienie mogło być przypadkiem. */
function ksztaltIgly(s) {
  if (/^\d+$/.test(s)) return "same cyfry";
  if (s.includes("@")) return "adres e-mail";
  if (/\s/.test(s)) return "kilka słów";
  const dl = [...s].length;
  return dl <= 5 ? "jedno słowo, 4-5 znaków" : dl <= 9 ? "jedno słowo, 6-9 znaków" : "jedno słowo, 10+ znaków";
}

/**
 * Dla jednej kolumny z trafieniami: skąd pochodzą igły, które w niej trafiły. Wartości zostają
 * w narzędziu; do raportu idzie etykieta źródła, kształt igły i liczby.
 */
function skadTrafienia(db, tabela, kolumna, malePelne, cyfrowe, cyfryDozwolone, igly) {
  const grupy = new Map();
  for (const w of db.prepare(`SELECT "${kolumna}" AS v FROM "${tabela}"`).all()) {
    const v = w.v;
    if (typeof v !== "string" || v.length < 4) continue;
    const znalezione = malePelne.znajdz(v.toLowerCase());
    if (cyfrowe && cyfryDozwolone) znalezione.push(...cyfrowe.znajdz(v));
    for (const igla of znalezione) {
      const numer = igly.zrodla?.get(igla);
      const zrodlo = numer !== undefined ? igly.etykiety[numer]
        : /^\d+$/.test(igla) ? "(cyfry z kolumn telefonu i NIP)" : "(bez śladu pochodzenia)";
      const klucz = `${zrodlo}\u0000${ksztaltIgly(igla)}`;
      const g = grupy.get(klucz) ?? { zrodlo, ksztalt: ksztaltIgly(igla), trafien: 0, rozne: new Set() };
      g.trafien++;
      if (g.rozne.size < 5000) g.rozne.add(igla);
      grupy.set(klucz, g);
    }
  }
  return [...grupy.values()]
    .sort((a, b) => b.trafien - a.trafien)
    .slice(0, 6)
    .map((g) => ({ zrodlo: g.zrodlo, ksztalt: g.ksztalt, trafien: g.trafien, roznych: g.rozne.size }));
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
    /* Lista igieł niesie każdą wartość w dwóch wielkościach liter. Po zamianie na małe litery to
       duplikaty, a duplikat w automacie liczy każde trafienie podwójnie. */
    const malePelne = new Automat([...new Set(slowa.map((s) => s.toLowerCase()))]);
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
      for (const [k, n] of ile) {
        trafienia.push({
          miejsce: `${name}.${k}`, ile: n,
          zrodla: skadTrafienia(db, name, k, malePelne, cyfrowe, !kolumnyStale.has(`${name}.${k}`), igly),
        });
      }
    }
  } finally {
    db.close();
  }
  /* Surowe bajty: wartości dłuższe niż 5 znaków, w obu wielkościach. */
  const bajtowe = slowa.filter((s) => s.length >= 6).map((s) => Buffer.from(s, "utf8").toString("latin1"));
  if (bajtowe.length) {
    const automat = new Automat(bajtowe);
    const maks = bajtowe.reduce((m, s) => Math.max(m, s.length), 0);
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

/** Reguła kolumny z uwzględnieniem nadpisań z wywołania (tylko testy). */
function regulaDla(ctx, tabela, kolumna) {
  const nadpisana = ctx.nadpisania?.[`${tabela}.${kolumna}`];
  return nadpisana
    ? { regula: nadpisana, powod: "nadpisana w wywołaniu" }
    : regulaKolumny(tabela, kolumna, ctx.wyliczenia);
}

function przetworzWartosc(regula, v, kolumnaId, ctx) {
  const { igly } = ctx;
  const nazwa = v.trim().toLowerCase();
  switch (regula) {
    case R.KLIENT:
      /* Słowo słownikowe („admin”) jest loginem, ale nie osobą do szukania:
         baza z samym kontem administratora nie ma czego skanować i nie jest błędem. */
      if (!SLOWA_SLOWNIKOWE.has(nazwa)) { ctx.osobowych++; igly.dodaj(v, { zrodlo: kolumnaId }); }
      return ctx.klient.daj(v);
    case R.PRACOWNIK:
      if (autorSystemowy(v)) return v;
      if (!SLOWA_SLOWNIKOWE.has(nazwa)) { ctx.osobowych++; igly.dodaj(v, { zrodlo: kolumnaId }); }
      return ctx.pracownik.daj(v);
    case R.OSOBA:
      ctx.osobowych++;
      igly.dodaj(v, { zrodlo: kolumnaId });
      return ctx.osoba.daj(v);
    case R.TELEFON:
      ctx.osobowych++;
      igly.dodajCyfry(v);
      return rozsypTekst(v, ctx.ziarno, "telefon", igly.cyfry);
    case R.SEKRET:
      igly.dodaj(v, { minimum: 8, bezWyjatkow: true, zrodlo: kolumnaId });
      /* Sam wykrzyknik: nie jest poprawnym skrótem, więc nikt się nie zaloguje,
         a nie zawiera słów, które skaner mógłby znaleźć w samym sobie. */
      return "!";
    case R.PLIK:
      return rozsypPlik(v, ctx.ziarno);
    default: {
      /* Kolumna z unikalnością dostaje zamiennik różnowartościowy: baza
         odrzuciłaby dwa równe zamienniki. Zwykłe kolumny idą przez wspólną
         przestrzeń rozsypu, więc ta sama wartość wygląda tak samo w kolumnie
         i w JSON-ie. */
      const mapa = ctx.unikalne.get(kolumnaId);
      if (mapa && !wyglądaNaJson(v) && /[\p{L}\p{N}]/u.test(v)) {
        igly.zTekstu(v);
        return mapa.daj(v);
      }
      return rozsypWartosc(v, ctx, kolumnaId);
    }
  }
}

/** Kolumny objęte unikalnością: klucz główny i każdy indeks UNIQUE. */
function kolumnyUnikalne(db, tabela) {
  const wynik = new Set();
  for (const k of db.prepare(`PRAGMA table_info("${tabela}")`).all()) if (k.pk > 0) wynik.add(k.name);
  const kolumny = db.prepare(`PRAGMA table_info("${tabela}")`).all().map((k) => k.name);
  for (const ix of db.prepare(`PRAGMA index_list("${tabela}")`).all()) {
    if (!ix.unique) continue;
    let wyrazenie = false;
    for (const c of db.prepare(`PRAGMA index_info("${ix.name}")`).all()) {
      if (c.name) wynik.add(c.name); else wyrazenie = true;
    }
    /* Indeks na wyrażeniu (`lower(nazwa)`) nie podaje nazwy kolumny w `index_info`.
       Bierzemy z jego definicji każdą kolumnę tabeli, która się w niej pojawia. */
    if (wyrazenie) {
      const def = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(ix.name)?.sql ?? "";
      for (const k of kolumny) if (new RegExp(`\\b${k}\\b`).test(def)) wynik.add(k);
    }
  }
  return wynik;
}

const rozne = (db, tabela, kolumna) =>
  db.prepare(`SELECT DISTINCT "${kolumna}" AS v FROM "${tabela}" WHERE typeof("${kolumna}")='text'`).all().map((w) => w.v);

/** Zgłasza wszystkie istniejące loginy, nazwy i odbiorców jako zabronione zamienniki, zanim ktokolwiek dostanie zamiennik. */
function zabronZamienniki(db, tabele, ctx) {
  const przestrzenie = { [R.KLIENT]: ctx.klient, [R.PRACOWNIK]: ctx.pracownik, [R.OSOBA]: ctx.osoba };
  for (const t of tabele) {
    for (const k of db.prepare(`PRAGMA table_info("${t}")`).all()) {
      if (TYP_LICZBOWY.test(k.type)) continue;
      const regula = regulaDla(ctx, t, k.name).regula;
      const przestrzen = przestrzenie[regula];
      if (przestrzen) for (const v of rozne(db, t, k.name)) przestrzen.zabron(v);
      /* Telefony też: rozsyp nie może wylosować numeru istniejącego klienta. */
      if (regula === R.TELEFON || regula === R.TELEFON_CYFRY) for (const v of rozne(db, t, k.name)) ctx.igly.dodajCyfry(v);
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

function przetworzTabele(db, tabela, ctx, raport) {
  const kolumny = db.prepare(`PRAGMA table_info("${tabela}")`).all();
  const unikalne = kolumnyUnikalne(db, tabela);
  const plan = [];
  for (const k of kolumny) {
    const blob = /BLOB/i.test(k.type) || k.type === "";
    if (TYP_LICZBOWY.test(k.type) && !blob) continue;
    const { regula, powod } = regulaDla(ctx, tabela, k.name);
    raport.kolumny.push({ tabela, kolumna: k.name, regula, powod });
    if (regula !== R.ZOSTAJE || blob) plan.push({ nazwa: k.name, regula });
    if (regula === R.TEKST && unikalne.has(k.name)) {
      const id = `${tabela}.${k.name}`;
      const z = new Zamienniki(`unikalna:${id}`, ctx.ziarno, { bezWielkosci: false, unikalneBezWielkosci: true });
      for (const v of rozne(db, tabela, k.name)) z.zabron(v);
      ctx.unikalne.set(id, z);
    }
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
          ctx.igly.dodajCyfry(v);
          return nowyTelefon !== null ? nowyTelefon.replace(/\D/g, "") : rozsypTekst(v, ctx.ziarno, "telefon", ctx.igly.cyfry);
        }
        const wynik = przetworzWartosc(p.regula, v, `${tabela}.${p.nazwa}`, ctx);
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

/* ── PLIKI ROBOCZE ───────────────────────────────────────────────────────────
   Pełna kopia bazy z danymi osobowymi nie może leżeć obok wyniku: pulpit
   i Dokumenty bywają synchronizowane z chmurą, zanim praca się skończy.
   Praca idzie w katalogu tymczasowym systemu, a wynik dostaje docelową nazwę
   dopiero po skanie. Zwykły błąd sprząta `finally`. Po zabiciu procesu (Ctrl+C
   przy pracy synchronicznej, wyłączenie zasilania) katalog zostaje, więc
   każdy następny przebieg zamiata takie resztki. */
const PREFIKS_TMP = "wertis-anonim-";
const STARE_PO_MS = 60 * 60 * 1000;
const SPRZATANIE = new Set();

function sprzatnij() {
  for (const p of SPRZATANIE) fs.rmSync(p, { recursive: true, force: true });
  SPRZATANIE.clear();
}

function zamiotStare() {
  const teraz = Date.now();
  let nazwy = [];
  try { nazwy = fs.readdirSync(os.tmpdir()); } catch { return; }
  for (const nazwa of nazwy) {
    if (!nazwa.startsWith(PREFIKS_TMP)) continue;
    const p = path.join(os.tmpdir(), nazwa);
    try {
      if (teraz - fs.statSync(p).mtimeMs > STARE_PO_MS) fs.rmSync(p, { recursive: true, force: true });
    } catch { /* ktoś inny go właśnie sprząta */ }
  }
}

/** Żywa baza ma w nagłówku tryb WAL (bajty 18–19 równe 2). Kopia z `VACUUM INTO` ma 1. */
function nagloweWal(sciezka) {
  const b = Buffer.alloc(20);
  const fd = fs.openSync(sciezka, "r");
  try {
    fs.readSync(fd, b, 0, 20, 0);
  } finally {
    fs.closeSync(fd);
  }
  return { sqlite: b.toString("latin1", 0, 15) === "SQLite format 3", wal: b[18] === 2 || b[19] === 2 };
}

/* ── CAŁOŚĆ ──────────────────────────────────────────────────────────────── */

/**
 * @param {string} wejscie kopia bazy z folderu kopii
 * @param {string} wyjscie plik do utworzenia; nie może istnieć
 * @param {{ ziarno?: string, log?: (s: string) => void, reguly?: Record<string, string>, skaner?: Function }} [opcje]
 *   `ziarno`, `reguly` i `skaner` służą testom. Ziarno jawne daje wynik
 *   odtwarzalny, więc wiersz poleceń go nie przyjmuje. `reguly` nadpisuje regułę
 *   kolumny (`"tabela.kolumna": R.ZOSTAJE`), a `skaner` podmienia skaner, żeby
 *   sprawdzić, że jego awaria nie zostawia wyniku.
 */
export function anonimizuj(wejscie, wyjscie, opcje = {}) {
  const log = opcje.log ?? (() => {});
  if (!fs.existsSync(wejscie)) throw new Error(`Nie ma pliku ${wejscie}.`);
  if (path.resolve(wejscie) === path.resolve(wyjscie)) throw new Error("Wejście i wynik to ten sam plik.");
  if (fs.existsSync(wyjscie)) throw new Error(`Plik ${wyjscie} już istnieje. Wskaż nową nazwę, nic nie nadpisuję.`);
  const wal = `${wejscie}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
    throw new Error("Obok pliku leży niepusty -wal, więc to żywa baza. Użyj kopii z folderu kopii serwera.");
  }
  const czesciowyWczesnie = `${wyjscie}.czesciowy`;
  if (fs.existsSync(czesciowyWczesnie)) {
    throw new Error(`Obok wyniku leży ${czesciowyWczesnie}. To nie mój plik, więc go nie ruszam. Usuń go albo wskaż inną nazwę.`);
  }
  try {
    fs.accessSync(path.dirname(path.resolve(wyjscie)), fs.constants.W_OK);
  } catch {
    throw new Error(`Do katalogu wyniku (${path.dirname(path.resolve(wyjscie))}) nie da się zapisać. Sprawdzam to teraz, żeby nie wyszło po całej pracy.`);
  }
  const naglowek = nagloweWal(wejscie);
  if (!naglowek.sqlite) throw new Error("To nie jest baza SQLite.");
  if (naglowek.wal) {
    throw new Error("Plik jest w trybie WAL, czyli to żywa baza albo jej surowa kopia. Użyj kopii z folderu kopii serwera.");
  }
  const ziarno = opcje.ziarno ?? crypto.randomBytes(32).toString("hex");
  zamiotStare();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), PREFIKS_TMP));
  const czesciowy = `${wyjscie}.czesciowy`;
  SPRZATANIE.add(tmp);
  const igly = new Igly();
  const raport = { tabele: 0, wierszy: 0, oproznione: [], kolumny: [], skaner: [], pominieteIgly: 0, igly: 0 };
  const liczby = new Map();
  let mojCzesciowy = false;
  try {
    const praca = path.join(tmp, "praca.db");
    const kandydat = path.join(tmp, "wynik.db");
    fs.copyFileSync(wejscie, praca);
    const db = new DatabaseSync(praca);
    try {
      db.exec("PRAGMA foreign_keys = OFF; PRAGMA synchronous = OFF; PRAGMA journal_mode = OFF;");
      const ctx = {
        ziarno, igly, wyliczenia: wyliczeniaZeSchematu(db), nadpisania: opcje.reguly, osobowych: 0,
        unikalne: new Map(),
        klient: new Zamienniki("klient", ziarno),
        pracownik: new Zamienniki("pracownik", ziarno),
        osoba: new Zamienniki("osoba", ziarno),
      };
      const tabele = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'towar_fts%' AND sql NOT LIKE 'CREATE VIRTUAL%' ORDER BY name").all().map((t) => t.name);
      for (const t of tabele) liczby.set(t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n);
      zabronZamienniki(db, tabele, ctx);
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
          wartosci = rozne(db, t, k);
        } catch { /* kopia sprzed migracji: kolumny jeszcze nie ma */ }
        for (const v of wartosci) {
          if (k === "nip" || k === "telefon") igly.dodajCyfry(v); else igly.dodaj(v, { zrodlo: `${t}.${k}` });
        }
      }
      for (const t of tabele) {
        if (TABELE_DO_OPROZNIENIA.includes(t)) {
          for (const k of SEKRETNE_KOLUMNY[t] ?? []) {
            for (const w of db.prepare(`SELECT "${k}" AS v FROM "${t}"`).all()) igly.dodaj(w.v, { minimum: 16, bezWyjatkow: true, zrodlo: `${t}.${k}` });
          }
          db.exec(`DELETE FROM "${t}"`);
          raport.oproznione.push(t);
          continue;
        }
        raport.wierszy += przetworzTabele(db, t, ctx, raport);
        raport.tabele++;
      }
      db.exec("COMMIT");
      raport.osobowych = ctx.osobowych;
    } finally {
      db.close();
    }
    const koncowa = new DatabaseSync(praca);
    try {
      koncowa.exec("PRAGMA journal_mode = DELETE");
      koncowa.prepare("VACUUM INTO ?").run(kandydat);
    } finally {
      koncowa.close();
    }
    raport.pominieteIgly = igly.pominiete;
    raport.igly = igly.slowa.size;

    /* Skaner, który nie miał czego szukać, nie dowodzi niczego. Baza z wartościami
       osobowymi i zerem igieł to błąd narzędzia, a nie czysty wynik. */
    if (raport.osobowych > 0 && igly.slowa.size === 0 && igly.pominiete === 0) {
      throw new Error("Skaner nie miał czego szukać, choć w bazie są loginy albo odbiorcy. Przerwano.");
    }

    /* Spójność wyniku: plik jest bazą i nic nie zginęło ani nie doszło. */
    const wynik = new DatabaseSync(kandydat);
    try {
      const kontrola = wynik.prepare("PRAGMA quick_check").all().map((r) => Object.values(r)[0]);
      if (kontrola.length !== 1 || kontrola[0] !== "ok") throw new Error(`Wynik nie przeszedł quick_check: ${kontrola.join("; ")}`);
      for (const [t, n] of liczby) {
        if (TABELE_DO_OPROZNIENIA.includes(t)) continue;
        const po = wynik.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
        if (po !== n) throw new Error(`Tabela ${t} miała ${n} wierszy, a po anonimizacji ${po}.`);
      }
    } finally {
      wynik.close();
    }

    const stale = new Set(raport.kolumny.filter((k) => k.regula === R.ZOSTAJE).map((k) => `${k.tabela}.${k.kolumna}`));
    raport.skaner = (opcje.skaner ?? skanujWycieki)(kandydat, igly, stale);
    log(`skaner: ${igly.slowa.size} wartości do sprawdzenia`);
    if (raport.skaner.length) {
      const blad = new Error("Skaner znalazł w wyniku dane, które miały zniknąć. Wynik nie powstał.");
      blad.raport = raport;
      throw blad;
    }

    /* Docelowa nazwa pojawia się dopiero teraz i tylko w całości: kopia obok,
       potem zmiana nazwy w tym samym katalogu. */
    if (fs.existsSync(wyjscie)) throw new Error(`Plik ${wyjscie} pojawił się w trakcie pracy. Nic nie nadpisuję.`);
    /* Plik z tą nazwą, który pojawił się po wczesnym sprawdzeniu, jest cudzy: `COPYFILE_EXCL`
       odmawia jego nadpisania, a `finally` kasuje wyłącznie plik, który sami utworzyliśmy. */
    fs.copyFileSync(kandydat, czesciowy, fs.constants.COPYFILE_EXCL);
    mojCzesciowy = true;
    SPRZATANIE.add(czesciowy);
    fs.renameSync(czesciowy, wyjscie);
    mojCzesciowy = false;
    SPRZATANIE.delete(czesciowy);
  } finally {
    if (mojCzesciowy) fs.rmSync(czesciowy, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    SPRZATANIE.delete(tmp);
  }
  return raport;
}

/* ── WIERSZ POLECEŃ ──────────────────────────────────────────────────────── */

let uruchomiono = false;

/** Kody wyjścia: 0 gotowe, 1 błąd użycia albo pliku, 2 skaner znalazł dane osobowe. */
export function uruchom(argv) {
  const opcje = argv.filter((a) => a.startsWith("--"));
  const pozycyjne = argv.filter((a) => !a.startsWith("--"));
  const nieznana = opcje.find((o) => o !== "--pomoc");
  if (nieznana) {
    console.error(`Nieznana opcja ${nieznana}. Narzędzie nie przyjmuje żadnych, bo jawne ziarno daje wynik odtwarzalny.`);
    return 1;
  }
  if (opcje.includes("--pomoc") || pozycyjne.length !== 2) {
    console.error("Użycie: node tools/anonimizuj-baze.mjs <kopia.db> <wynik.db>");
    console.error("Wejściem jest kopia z folderu kopii serwera, nigdy żywa baza.");
    return pozycyjne.length === 2 ? 0 : 1;
  }
  const [wejscie, wyjscie] = pozycyjne;
  if (!uruchomiono) {
    uruchomiono = true;
    process.on("exit", sprzatnij);
  }
  try {
    const r = anonimizuj(wejscie, wyjscie);
    const licz = {};
    for (const k of r.kolumny) licz[k.regula] = (licz[k.regula] ?? 0) + 1;
    fs.writeFileSync(`${wyjscie}.kolumny.txt`,
      r.kolumny.map((k) => `${k.regula}\t${k.tabela}.${k.kolumna}\t${k.powod}`).join("\n") + "\n");
    console.log(`Gotowe: ${wyjscie}`);
    console.log(`Tabel: ${r.tabele}, przetworzonych wierszy: ${r.wierszy}.`);
    console.log(`Opróżnione tabele: ${r.oproznione.join(", ") || "brak"}.`);
    console.log(`Kolumny tekstowe wg reguły: ${Object.entries(licz).map(([k, n]) => `${k} ${n}`).join(", ")}.`);
    console.log(`Skaner wycieków sprawdził ${r.igly} wartości i nic nie znalazł. Pominięto ${r.pominieteIgly} krótszych niż 4 znaki, których skaner nie widzi.`);
    console.log(`Lista kolumn i reguł, bez danych: ${wyjscie}.kolumny.txt`);
    console.log(skrotNarzedzia());
    return 0;
  } catch (e) {
    console.error(`Błąd: ${e instanceof Error ? e.message : e}`);
    if (e && e.raport) {
      for (const t of e.raport.skaner) {
        console.error(`  ${t.miejsce}: ${t.ile}`);
        for (const z of t.zrodla ?? []) {
          console.error(`      <- ${z.zrodlo} | ${z.ksztalt} | trafień ${z.trafien}, różnych igieł ${z.roznych}`);
        }
      }
      console.error("Raport nie zawiera wartości z bazy. Klucz JSON, który wygląda jak dana, jest zastąpiony przez <klucz>.");
      console.error(skrotNarzedzia());
      return 2;
    }
    return 1;
  }
}

/** Skrót własnego pliku: po raporcie widać, której wersji narzędzia użyto. */
function skrotNarzedzia() {
  try {
    const skrot = crypto.createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 8);
    return `Narzędzie: anonimizuj-baze.mjs, skrót pliku ${skrot}.`;
  } catch {
    return "Narzędzie: anonimizuj-baze.mjs, skrótu pliku nie udało się policzyć.";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = uruchom(process.argv.slice(2));
}
