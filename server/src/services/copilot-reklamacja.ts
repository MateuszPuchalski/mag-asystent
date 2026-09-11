import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { kosztUsd, type Tokeny } from "./copilot-koszt.js";
import {
  polacz, zamaskujBlok, zamaskujWatek,
  type TrescBezpieczna, type WiadomoscWatku,
} from "./copilot-maskowanie.js";
import { faktySprawy, odsiejZnane, tekstFaktow } from "./copilot-fakty-sprawy.js";

/* ── Copilot reklamacyjny: ZBIERA DANE, nie radzi (0.275.0) ──────────────────

   Zgłoszenie właściciela z 11 września: „zintegruj z copilotem, wersja do
   reklamacji zbierająca dane". Słowo „zbierająca" jest tu całym projektem.

   OD 0.276.0 COPILOT TAKŻE RADZI. Do 0.275.0 ten moduł odrzucał kartę,
   w której padło słowo z rodziny werdyktu — moja decyzja, uzasadniona tym, że
   uznanie jest nieodwracalne. Właściciel odwrócił ją tego samego dnia:
   „copilot powinien też radzić w reklamacji". Wie to lepiej: to on wydaje te
   werdykty i on płaci za ich skutki.

   BRAMKA NIE ZNIKA, TYLKO ZMIENIA CEL. Rada mieszka WYŁĄCZNIE w polu
   `rekomendacja` — typowanym, podpisanym na ekranie jako zdanie maszyny.
   Pola faktograficzne (`usterka`, `kiedy`, `oczekiwanie`, `dowody`) mają
   zostać opisem tego, co powiedział klient, i pilnuje tego ta sama
   deterministyczna bramka co wcześniej. Bez niej model przemyciłby werdykt
   w polu, które wygląda jak cytat z kupującego, a agent czytałby to jako
   słowa klienta.

   REKOMENDACJA JEST TYPOWANA, NIE PROZĄ. Prozą byłoby ładniej i nie dałoby
   się tego zmierzyć — a rada bez pomiaru to nie rada. Trafność liczy się
   z FAKTU: porównujemy radę z werdyktem, który agent naprawdę wysłał.

   Co robi: czyta rozmowę, która bywa długa i wielojęzyczna, i wyciąga z niej
   cztery rzeczy, których agent szuka za każdym razem ręcznie — co się zepsuło,
   kiedy, czego klient chce i czego BRAKUJE, żeby dało się rozstrzygnąć.
   Ostatnia pozycja jest najcenniejsza: sprawa stoi tygodniami nie dlatego, że
   nikt nie umie zdecydować, tylko dlatego, że nikt nie zapytał o zdjęcie
   tabliczki.

   KAŻDE ZDANIE MA CYTAT. Model dostaje rozmowę ponumerowaną (`W1`, `W2`, …)
   i przy każdym polu ma podać numer wiadomości, z której to wziął. Serwer
   sprawdza numery przed zapisem: pole z numerem, którego nie ma, znika.
   To ta sama doktryna, co przy szkicu (§14.6) — model pisze prozę wyłącznie
   z materiału, a sprawdza go kod, nie dobra wola.

   MASKOWANIE PILNUJE KOMPILATOR. Nadawca przyjmuje wyłącznie `TrescBezpieczna`,
   więc „zapomniałem zamaskować" jest błędem kompilacji, a nie pomyłką do
   wyłapania w przeglądzie.                                                  */

/** Pole karty razem z cytatem — numer wiadomości, z której pochodzi. */
export interface PoleKarty { tresc: string; zrodlo: string }

/**
 * Co maszyna radzi zrobić (0.276.0).
 *
 * Jedenaście wartości `ClaimStatusChangeRequest.status` plus dwunasta, NASZA:
 * `POPROSIC_O_DOWODY` znaczy „nie ma jeszcze czego rozstrzygać". Bez niej
 * model musiałby wybrać werdykt nawet wtedy, gdy w rozmowie brakuje podstaw —
 * czyli zgadywać, i to zgadywać w najgorszym możliwym miejscu.
 */
export const REKOMENDACJE = [
  "ACCEPTED_REPAIR", "ACCEPTED_REFUND", "ACCEPTED_EXCHANGE", "ACCEPTED_PARTIAL_REFUND",
  "REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED", "REJECTED_PRODUCT_NOT_RETURNED",
  "REJECTED_PRODUCT_DAMAGED_BY_USER", "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT",
  "REJECTED_MINOR_DEFECT", "REJECTED_OTHER", "REJECTED_CLAIM_WITHDRAWN_BY_BUYER",
  "POPROSIC_O_DOWODY",
] as const;
export type Rekomendacja = (typeof REKOMENDACJE)[number];

/** Trzy poziomy, te same co przy klasyfikacji — jeden słownik w głowie agenta. */
export const PEWNOSCI_RADY = ["wysoka", "srednia", "niska"] as const;
export type PewnoscRady = (typeof PEWNOSCI_RADY)[number];

/**
 * Rada maszyny: co zrobić, dlaczego, jak pewnie i CZEGO NIE WIE.
 *
 * `czegoNieWiem` jest przeciwwagą dla `pewnosc`, a nie ozdobą: model, który
 * nie umie nazwać własnej niewiedzy, nie ma prawa deklarować wysokiej
 * pewności — i serwis mu na to nie pozwala.
 */
export interface RadaMaszyny {
  co: Rekomendacja;
  uzasadnienie: PoleKarty;
  pewnosc: PewnoscRady;
  czegoNieWiem: string[];
}

export interface KartaSprawy {
  /** Co jest zepsute, słowami klienta. */
  usterka: PoleKarty | null;
  /** Od kiedy — data zakupu, moment awarii, „po tygodniu". */
  kiedy: PoleKarty | null;
  /** Czego klient chce: naprawa, wymiana, zwrot pieniędzy. */
  oczekiwanie: PoleKarty | null;
  /** Co klient już przysłał: zdjęcia, paragon, opis prób. */
  dowody: PoleKarty[];
  /** Czego BRAKUJE, żeby dało się rozstrzygnąć. Najcenniejsza pozycja. */
  brakuje: string[];
  /** Co maszyna radzi (0.276.0); `null`, gdy nie miała z czego poradzić. */
  rada: RadaMaszyny | null;
}

export interface OdpowiedzRozpoznania extends KartaSprawy {
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

/** Wysyłka do dostawcy — wstrzykiwana, jak `NadawcaKlasyfikacji`. */
export type NadawcaRozpoznania = (tresc: TrescBezpieczna) => Promise<OdpowiedzRozpoznania>;

/**
 * Słowa werdyktu w polach FAKTOGRAFICZNYCH (0.276.0).
 *
 * Do 0.275.0 ta lista odrzucała całą kartę, bo maszyna nie miała radzić wcale.
 * Od 0.276.0 radzi — ale wyłącznie w polu `rada`, typowanym i podpisanym na
 * ekranie. `usterka`, `kiedy`, `oczekiwanie` i `dowody` mają zostać OPISEM
 * tego, co powiedział klient.
 *
 * Bez tej bramki model przemyciłby werdykt w polu, które wygląda jak cytat
 * z kupującego — a agent czytałby „reklamacja zasadna" jako słowa klienta,
 * nie jako opinię maszyny. Podpis pod radą chroni przed pomyleniem autora
 * tylko wtedy, gdy rada stoi tam, gdzie ma stać.
 *
 * Lista jest krótka i celowo nie próbuje być kompletna — nie da się wyliczyć
 * wszystkich sposobów, na jakie da się zasugerować decyzję. Łapie przypadek
 * typowy: model, który „pomaga" wnioskiem wciśniętym w opis usterki.
 */
const SLOWA_WERDYKTU = [
  "uzna", "odrzu", "zasadn", "niezasadn", "bezpodstawn", "przyzna", "odmów", "odmow",
  "rekomend", "proponuj", "radzę", "powinieneś", "należy uznać",
];

/** Czy tekst niesie sugestię rozstrzygnięcia. */
export function sugerujeWerdykt(tekst: string): boolean {
  const t = tekst.toLowerCase();
  return SLOWA_WERDYKTU.some((s) => t.includes(s));
}

/** Rozmowa ponumerowana dla modelu i zbiór numerów do sprawdzenia cytatów. */
export function ponumerujRozmowe(
  wiadomosci: Array<{ odKlienta: boolean; tresc: string }>,
): { watek: WiadomoscWatku[]; numery: Set<string> } {
  const numery = new Set<string>();
  const watek = wiadomosci.map((w, i) => {
    const numer = `W${i + 1}`;
    numery.add(numer);
    return { odKlienta: w.odKlienta, tresc: `[${numer}] ${w.tresc}` };
  });
  return { watek, numery };
}

/**
 * Odsianie pól bez pokrycia w rozmowie.
 *
 * Pole z numerem, którego w rozmowie nie ma, ZNIKA — nie unieważnia całej
 * karty. To jest różnica wobec szkicu, gdzie wymyślony numer kasuje wszystko:
 * tam liczba wchodzi do zdania wysyłanego kupującemu, tutaj karta jest notatką
 * dla agenta, który ma rozmowę przed oczami. Odsiane pola idą do audytu, żeby
 * dało się zmierzyć, jak często model zmyśla.
 */
export function odsiejBezPokrycia(
  karta: KartaSprawy, numery: Set<string>,
): { karta: KartaSprawy; odsiano: number } {
  let odsiano = 0;
  /* NUMER BEZ NAWIASÓW (0.282.0). Model widzi w rozmowie `[W3]` i regularnie
     tak właśnie cytuje — a wtedy `numery.has("[W3]")` jest fałszem i fakt
     znikał z karty BEZ ŚLADU, jako rzekomo niepokryty. To było poluzowanie
     doktryny przez literówkę, nie przez decyzję.

     To NIE jest rozluźnienie sita: `"W3, Z1"` dalej wypada, bo po zdjęciu
     nawiasów nie jest żadnym znanym numerem. Rozszerzamy zapis, nie regułę. */
  const pokryte = (zrodlo: string) =>
    numery.has(String(zrodlo).trim().replace(/^\[|\]$/g, "").toUpperCase());
  const pole = (p: PoleKarty | null): PoleKarty | null => {
    if (!p) return null;
    if (pokryte(p.zrodlo)) return p;
    odsiano += 1;
    return null;
  };
  const dowody = karta.dowody.filter((d) => {
    if (pokryte(d.zrodlo)) return true;
    odsiano += 1;
    return false;
  });
  /* UZASADNIENIE RADY TEŻ MA CYTAT i jest sprawdzane tak samo. Rada oparta na
     wiadomości, której nie ma, jest gorsza od braku rady: wygląda na
     ugruntowaną. Odsiew kasuje wtedy CAŁĄ radę, nie samo uzasadnienie —
     rekomendacja bez podstawy to gołe „uznaj", a tego agent ma nie zobaczyć. */
  let rada = karta.rada;
  if (rada && !pokryte(rada.uzasadnienie.zrodlo)) {
    rada = null;
    odsiano += 1;
  }
  return {
    karta: {
      usterka: pole(karta.usterka),
      kiedy: pole(karta.kiedy),
      oczekiwanie: pole(karta.oczekiwanie),
      dowody,
      /* `brakuje` NIE MA cytatu z natury rzeczy: mówi o tym, czego w rozmowie
         NIE MA. Sprawdza je bramka słów werdyktu, nie bramka numerów. */
      brakuje: karta.brakuje,
      rada,
    },
    odsiano,
  };
}

/** Czy z karty cokolwiek zostało — pusta nie ma po co trafiać na ekran. */
export function pustaKarta(k: KartaSprawy): boolean {
  return !k.usterka && !k.kiedy && !k.oczekiwanie && k.dowody.length === 0
    && k.brakuje.length === 0 && !k.rada;
}

export interface ZadanieRozpoznania {
  reklamacjaId: number;
  kto: { id: number; name: string };
  nadaj: NadawcaRozpoznania;
  database?: DatabaseSync;
  now?: () => Date;
}

/**
 * Rozpoznanie jednej sprawy: rozmowa → karta faktów.
 *
 * Sieć stoi POZA transakcją, jak wszędzie w tym module. Wywołanie zapisuje się
 * w księdze Copilota niezależnie od wyniku — próba, która nie doszła, też bywa
 * płatna, a brak wiersza gubiłby tę część rachunku.
 */
export async function rozpoznajSprawe(z: ZadanieRozpoznania): Promise<KartaSprawy> {
  const database = z.database ?? db();
  const teraz = (z.now ?? (() => new Date()))();

  const sprawa = database.prepare(
    "SELECT id, kupujacy_login FROM reklamacja_klienta WHERE id=?").get(z.reklamacjaId) as
    { id: number; kupujacy_login: string | null } | undefined;
  if (!sprawa) throw new Error("Nie znaleziono reklamacji");

  const wiersze = database.prepare(
    `SELECT autor_rola, tresc FROM reklamacja_wiadomosc
      WHERE reklamacja_id=? ORDER BY utworzono_at IS NULL, utworzono_at, id`)
    .all(z.reklamacjaId) as Array<{ autor_rola: string | null; tresc: string }>;
  if (wiersze.length === 0) throw new Error("Ta sprawa nie ma jeszcze rozmowy do rozpoznania");

  /* „Nie nasze" znaczy klienta ALBO doradcy Allegro — ta sama reguła, co przy
     kontroli świeżości. Rozmowa bywa trójstronna i zdanie doradcy niesie
     fakty tak samo jak zdanie kupującego. */
  const { watek, numery } = ponumerujRozmowe(wiersze.map((w) => ({
    odKlienta: (w.autor_rola ?? "") !== "SELLER",
    tresc: w.tresc,
  })));

  /* ── FAKTY ZE SPRAWY PRZED WĄTKIEM (0.282.0) ──────────────────────────────
     Do tego wydania model widział wyłącznie czat i dlatego prosił o dane,
     które Allegro przysłało razem ze sprawą: numer zamówienia, datę, model
     towaru. Blok dostaje własny numer `S`, bo to też są SŁOWA KLIENTA —
     z formularza reklamacyjnego zamiast z wiadomości — i fakt na nich oparty
     musi przejść przez `odsiejBezPokrycia` tak samo jak fakt z rozmowy.

     CZEGO W BLOKU NIE MA: notatki biura, znacznika „kto prowadzi", tagów,
     kartoteki Subiekta ani naszych kwot. Wychodzą fakty o SPRAWIE i o ZAKUPIE,
     nie fakty o nas. */
  const f = faktySprawy(database, z.reklamacjaId);
  const blok = f
    ? zamaskujBlok("FAKTY ZE SPRAWY [S] — z formularza reklamacyjnego i z Allegro:",
      tekstFaktow(f), sprawa.kupujacy_login)
    : null;
  if (blok) numery.add("S");

  const watekBezpieczny = zamaskujWatek(watek, sprawa.kupujacy_login);
  const tresc = blok ? polacz(blok, watekBezpieczny) : watekBezpieczny;

  let odp: OdpowiedzRozpoznania;
  try {
    odp = await z.nadaj(tresc);
  } catch (e) {
    zapiszWywolanie(database, z.reklamacjaId, null, "blad",
      (e as Error).message, z.kto, teraz);
    throw e;
  }

  /* BRAMKA WERDYKTU obejmuje POLA FAKTOGRAFICZNE, nie całą kartę (0.276.0).
     Rada jest teraz dozwolona, ale ma stać w swoim polu — w `usterka` czy
     `dowody` byłaby podpisana słowami klienta. */
  const fakty = JSON.stringify([odp.usterka, odp.kiedy, odp.oczekiwanie, odp.dowody]);
  if (sugerujeWerdykt(fakty)) {
    zapiszWywolanie(database, z.reklamacjaId, odp, "blad", "werdykt w faktach", z.kto, teraz);
    throw new Error(
      "Copilot wpisał rozstrzygnięcie w pole opisujące słowa klienta — karta " +
      "odrzucona. Rada ma stać w swoim polu i być podpisana jako rada.");
  }

  /* PEWNOŚĆ BEZ NAZWANEJ NIEWIEDZY TO BRAWURA, nie pewność. Model, który
     deklaruje „wysoka" i nie umie powiedzieć, co by go przekonało do zmiany
     zdania, nie zważył sprawy — zgadł. Karta leci, a nie sama rada: taka
     odpowiedź podważa też resztę. */
  if (odp.rada && odp.rada.pewnosc === "wysoka" && odp.rada.czegoNieWiem.length === 0) {
    zapiszWywolanie(database, z.reklamacjaId, odp, "blad", "pewnosc bez niewiedzy", z.kto, teraz);
    throw new Error(
      "Copilot zadeklarował wysoką pewność, nie nazywając ani jednej rzeczy, " +
      "której nie wie — karta odrzucona.");
  }

  const { karta: zPokryciem, odsiano } = odsiejBezPokrycia(odp, numery);

  /* SITO NA „BRAKUJE" (0.282.0). To jedyne pole karty bez cytatu, więc
     `odsiejBezPokrycia` go nie dotyka — a właśnie ono trzymało sprawę
     w miejscu, prosząc agenta o datę zakupu, którą podaliśmy modelowi
     dwadzieścia linii wyżej. Instrukcja o to prosi, kod tego pilnuje:
     ta sama para co przy bramce słów werdyktu. */
  const { brakuje, odsiano: znane } = f
    ? odsiejZnane(zPokryciem.brakuje, f)
    : { brakuje: zPokryciem.brakuje, odsiano: 0 };
  const karta = { ...zPokryciem, brakuje };

  if (pustaKarta(karta)) {
    zapiszWywolanie(database, z.reklamacjaId, odp, "blad", "karta bez pokrycia", z.kto, teraz);
    throw new Error("Copilot nie znalazł w tej rozmowie niczego, co dałoby się zacytować");
  }

  transaction(database, () => {
    database.prepare(`INSERT INTO reklamacja_karta
      (reklamacja_id, usterka, usterka_zrodlo, kiedy, kiedy_zrodlo,
       oczekiwanie, oczekiwanie_zrodlo, dowody, brakuje,
       rekomendacja, pewnosc, uzasadnienie, uzasadnienie_zrodlo, czego_nie_wiem,
       model, przez, przez_user_id, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(reklamacja_id) DO UPDATE SET
        usterka=excluded.usterka, usterka_zrodlo=excluded.usterka_zrodlo,
        kiedy=excluded.kiedy, kiedy_zrodlo=excluded.kiedy_zrodlo,
        oczekiwanie=excluded.oczekiwanie, oczekiwanie_zrodlo=excluded.oczekiwanie_zrodlo,
        dowody=excluded.dowody, brakuje=excluded.brakuje,
        rekomendacja=excluded.rekomendacja, pewnosc=excluded.pewnosc,
        uzasadnienie=excluded.uzasadnienie, uzasadnienie_zrodlo=excluded.uzasadnienie_zrodlo,
        czego_nie_wiem=excluded.czego_nie_wiem, model=excluded.model,
        przez=excluded.przez, przez_user_id=excluded.przez_user_id, at=excluded.at,
        /* NOWA RADA KASUJE STARĄ OCENĘ. Trafność dotyczy TAMTEJ rekomendacji;
           przeniesiona na nową byłaby pomiarem czegoś, czego nikt nie ocenił. */
        ocena=NULL, ocena_at=NULL`).run(
      z.reklamacjaId,
      karta.usterka?.tresc ?? null, karta.usterka?.zrodlo ?? null,
      karta.kiedy?.tresc ?? null, karta.kiedy?.zrodlo ?? null,
      karta.oczekiwanie?.tresc ?? null, karta.oczekiwanie?.zrodlo ?? null,
      JSON.stringify(karta.dowody), JSON.stringify(karta.brakuje),
      karta.rada?.co ?? null, karta.rada?.pewnosc ?? null,
      karta.rada?.uzasadnienie.tresc ?? null, karta.rada?.uzasadnienie.zrodlo ?? null,
      JSON.stringify(karta.rada?.czegoNieWiem ?? []),
      odp.model, z.kto.name, z.kto.id, teraz.toISOString());

    zapiszWywolanie(database, z.reklamacjaId, odp, "ok", null, z.kto, teraz);

    /* Do dziennika idą LICZBY, nigdy treść karty: `events` nie ma retencji,
       a karta niesie słowa klienta. */
    logEvent("reklamacja_rozpoznanie", z.kto.name, null,
      /* `znane` mierzy SITO, nie model: bez tej liczby nikt po miesiącu nie
         odpowie, czy nie tnie za dużo. Heurystyka bez licznika to wiara. */
      { id: z.reklamacjaId, brakuje: karta.brakuje.length, dowody: karta.dowody.length,
        odsiano, znane, zFaktami: Boolean(f) },
      z.kto.id, database);
  })();

  return karta;
}

/** Karta zapisana przy sprawie; `null`, gdy nikt jeszcze nie prosił. */
export function kartaSprawy(database: DatabaseSync, reklamacjaId: number): (KartaSprawy & {
  model: string; przez: string | null; at: string; ocena: string | null;
}) | null {
  const w = database.prepare("SELECT * FROM reklamacja_karta WHERE reklamacja_id=?")
    .get(reklamacjaId) as Record<string, unknown> | undefined;
  if (!w) return null;
  const pole = (t: unknown, z: unknown): PoleKarty | null =>
    t == null ? null : { tresc: String(t), zrodlo: String(z ?? "") };
  const lista = <T>(v: unknown): T[] => {
    try { return JSON.parse(String(v ?? "[]")) as T[]; } catch { return []; }
  };
  const uzasadnienie = pole(w.uzasadnienie, w.uzasadnienie_zrodlo);
  return {
    usterka: pole(w.usterka, w.usterka_zrodlo),
    kiedy: pole(w.kiedy, w.kiedy_zrodlo),
    oczekiwanie: pole(w.oczekiwanie, w.oczekiwanie_zrodlo),
    dowody: lista<PoleKarty>(w.dowody),
    brakuje: lista<string>(w.brakuje),
    rada: w.rekomendacja == null || !uzasadnienie ? null : {
      co: String(w.rekomendacja) as Rekomendacja,
      uzasadnienie,
      pewnosc: String(w.pewnosc ?? "niska") as PewnoscRady,
      czegoNieWiem: lista<string>(w.czego_nie_wiem),
    },
    ocena: w.ocena == null ? null : String(w.ocena),
    model: String(w.model ?? ""),
    przez: w.przez == null ? null : String(w.przez),
    at: String(w.at ?? ""),
  };
}

function zapiszWywolanie(
  database: DatabaseSync, reklamacjaId: number, odp: OdpowiedzRozpoznania | null,
  wynik: "ok" | "blad", blad: string | null, kto: { id: number }, teraz: Date,
): void {
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,reklamacja_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES ('rozpoznanie_reklamacji',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(reklamacjaId, odp?.model ?? "", odp?.zuzycie.wej ?? 0, odp?.zuzycie.wyj ?? 0,
      odp?.zuzycie.cacheZapis ?? 0, odp?.zuzycie.cacheOdczyt ?? 0, odp?.ms ?? null,
      wynik, blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}

/** Koszt jednego rozpoznania — do paska na ekranie ustawień. */
export const kosztRozpoznania = (model: string, t: Tokeny): number => kosztUsd(model, t);

/**
 * Trafność rady — liczona z FAKTU, nie z ankiety (0.276.0).
 *
 * `schema.sql` niesie przy klasyfikacji zdanie z krytyki właściciela:
 * „confidence bez konsekwencji to…". Tutaj domyka się ono samo, bo nie trzeba
 * nikogo pytać: rekomendacja jest typowana tym samym słownikiem, co werdykt,
 * więc porównanie jest równością dwóch napisów.
 *
 * Wołane PO udanym werdykcie i nigdy przed. Funkcja jest CICHA przy braku
 * karty: Copilot jest dodatkiem, a werdykt podstawową pracą biura — reklamacja
 * rozstrzygnięta bez rady ma zapaść dokładnie tak samo.
 *
 * `POPROSIC_O_DOWODY` NIE JEST porównywane z werdyktem i to nie jest luka.
 * Ta rada mówi „jeszcze nie rozstrzygaj", więc każdy werdykt po niej może być
 * słuszny — zapadł później i na innym materiale. Ocena zostaje `null`, czyli
 * „nie ma z czym porównać", zamiast udawać pomiar.
 */
export function ocenRekomendacje(
  database: DatabaseSync, reklamacjaId: number, werdykt: string, teraz = new Date(),
): "trafna" | "nietrafna" | null {
  const w = database.prepare(
    "SELECT rekomendacja FROM reklamacja_karta WHERE reklamacja_id=?").get(reklamacjaId) as
    { rekomendacja: string | null } | undefined;
  const rada = w?.rekomendacja ?? null;
  if (!rada || rada === "POPROSIC_O_DOWODY") return null;

  const ocena = rada === werdykt ? "trafna" : "nietrafna";
  database.prepare("UPDATE reklamacja_karta SET ocena=?, ocena_at=? WHERE reklamacja_id=?")
    .run(ocena, teraz.toISOString(), reklamacjaId);
  return ocena;
}

/**
 * Ile rad, ile trafnych — do karty Copilota na ekranie ustawień.
 *
 * Bez tej liczby po miesiącu nikt nie będzie umiał powiedzieć, czy rada pomaga.
 * `ocenionych` jest osobno od `rad`, bo sprawy bez werdyktu nie są ani
 * sukcesem, ani porażką modelu — są niedokończone.
 */
export function trafnoscRad(database: DatabaseSync): {
  rad: number; ocenionych: number; trafnych: number;
} {
  const w = database.prepare(`SELECT
      COUNT(rekomendacja) AS rad,
      COUNT(ocena) AS ocenionych,
      SUM(CASE WHEN ocena='trafna' THEN 1 ELSE 0 END) AS trafnych
    FROM reklamacja_karta`).get() as Record<string, number | null>;
  return {
    rad: Number(w.rad ?? 0),
    ocenionych: Number(w.ocenionych ?? 0),
    trafnych: Number(w.trafnych ?? 0),
  };
}
