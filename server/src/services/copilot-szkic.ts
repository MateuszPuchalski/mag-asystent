import { db, transaction } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { BladOdpowiedziCopilota } from "../adapters/copilot.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  zamaskujWatek, zostalyDaneOsobowe, type TrescBezpieczna, type WiadomoscWatku,
} from "./copilot-maskowanie.js";
import type { Tokeny } from "./copilot-koszt.js";
import { doborRozmowy, wiedzaDoboru, zapiszDane, type DaneDoboru } from "./dobor.js";
import { kandydaciDoboru, ofertaRozmowy } from "./kandydaci.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { buildProductCard } from "./stock.js";
import { pasowaniaTowaru } from "./pasowania.js";
import { silnikZTekstu } from "./silniki.js";
import { podzielStopke } from "./stopka.js";
import { LIMIT_ZNAKOW } from "./wysylka.js";
import { bezPodpisu, zwin } from "../tekst.js";

/* ── Copilot: szkic odpowiedzi z faktów (§14.6, etap F, przyrost drugi) ──────

   Decyzja właściciela z 7 września 2026: „w oknie odpowiedzi powinien być
   guzik, który konstruuje odpowiedź z pomocą AI, kartotek etc." Doktryna
   z jego krytyki promptu doboru obowiązuje tu dosłownie: MODEL NIE ZNA
   DOPASOWAŃ Z PAMIĘCI. Każde twierdzenie ma dowód z narzędzi, brak trafienia
   to puste pole, a nie zgadywanie.

   Stąd podział ról, który jest całą treścią tego pliku:
   - SERWER układa FAKTY (F1, F2, …) ze zdań, które już pisze dla ekranu —
     `zdanieDoSzkicu`, `zdanieZrodla`, `kandydat.zrodlo`. Druga kopia tych
     zdań w prompcie rozjechałaby się z pierwszą przy pierwszej nowej drodze.
   - MODEL pisze prozę WYŁĄCZNIE z faktów i cytuje ich identyfikatory.
   - SERWER SPRAWDZA wynik deterministycznie: każdy numer w szkicu musi stać
     w faktach albo w rozmowie, inaczej szkic jest odrzucony. Zła proza kosztuje
     „brzmi nieładnie"; wymyślony numer kosztowałby zwrot — i tego drugiego
     kod nie przepuszcza niezależnie od tego, jak dobry jest prompt.

   Propozycja NIE trafia do `conversation_draft`: tam mieszka szkic agenta
   pilnowany przez `conversation.version` (blizna 409 w trakcie pisania). Wraca
   jako osobny wiersz i do szkicu wchodzi na jawne kliknięcie — polityka
   danych skrzynki: „wynik nie staje się odpowiedzią sam".                    */

export type RodzajFaktu =
  | "oferta" | "kartoteka" | "dobor" | "kandydat" | "negatyw" | "wiedza" | "pasowanie" | "intake";

export interface Fakt { id: string; rodzaj: RodzajFaktu; zdanie: string }

/**
 * Fakty w kształcie do wysyłki. Typ OZDOBIONY jak `TrescBezpieczna`, ale
 * z INNEGO powodu: fakty nie przechodzą przez `zamaskuj()`, bo reguła „dziewięć
 * cyfr to telefon" zjadłaby numery OEM — dokładnie te dane, które szkic ma
 * cytować. Bezpieczeństwo bierze się z KONSTRUKCJI: fakty składa wyłącznie
 * `kontekstSzkicu()` z własnych danych firmy, bez tekstu klienta, bez półki,
 * bez nazwiska pracownika. Producentem tego typu jest ten jeden plik.
 */
export type FaktyBezpieczne = string & { readonly __fakty: unique symbol };

export interface KontekstSzkicu {
  fakty: Fakt[];
  tekstFaktow: FaktyBezpieczne;
  watek: TrescBezpieczna;
  /** Ostatnia wiadomość KLIENTA — na niej liczymy świeżość propozycji. */
  ostatniaWiadomoscId: number | null;
  /** Wersja doboru w chwili układania — zmiana danych po szkicu czyni go nieświeżym. */
  doborWersja: number;
}

/** Surowa odpowiedź modelu. Walidacja jest niżej, w `ulozSzkic`. */
export interface OdpowiedzSzkicu {
  tresc: string;
  uzyteFakty: string[];
  zastrzezenia: string[];
  /**
   * Dane maszyny i części, które model ODCZYTAŁ z rozmowy (przyrost trzeci).
   * `null` = nadawca ich nie oddaje (atrapy w testach). Surowe: sprawdzenie
   * przeciw rozmowie robi `oczyscPropozycje`, nie adapter.
   */
  daneDoboru: DaneDoboru | null;
  model: string;
  zuzycie: Tokeny;
  ms: number;
}

/**
 * Wysyłka do dostawcy — wstrzykiwana, jak `NadawcaKlasyfikacji`. Dwa argumenty,
 * dwa zamki: wątek musi być `TrescBezpieczna` (tylko `zamaskuj*`), fakty muszą
 * być `FaktyBezpieczne` (tylko ten plik). Goły `string` nie wejdzie żadną
 * z tych dróg nawet przez pomyłkę.
 */
export type NadawcaSzkicu = (watek: TrescBezpieczna, fakty: FaktyBezpieczne) => Promise<OdpowiedzSzkicu>;

export const OCENY_SZKICU = ["wstawiony", "zastapiony", "odrzucony"] as const;
export type OcenaSzkicu = (typeof OCENY_SZKICU)[number];

/** Los propozycji DANYCH — osobny od losu szkicu, bo bywają różne. */
export const OCENY_DANYCH = ["wpisane", "odrzucone"] as const;
export type OcenaDanych = (typeof OCENY_DANYCH)[number];

export interface SzkicCopilota {
  tresc: string;
  zastrzezenia: string[];
  uzyteFakty: string[];
  messageId: number | null;
  model: string;
  at: string;
  przez: string;
  ocena: OcenaSzkicu | null;
  /**
   * Dane doboru rozpoznane w rozmowie i SPRAWDZONE przeciw niej. `null` = nic
   * nie rozpoznano. To propozycja: do `dobor_rozmowy` wchodzi na kliknięcie
   * agenta (`przyjmijDaneDoboru`), wyłącznie w puste pola.
   */
  daneDoboru: DaneDoboru | null;
  daneOcena: OcenaDanych | null;
  /** Wersja doboru, na której szkic powstał — inna dziś = szkic nieświeży. */
  doborWersja: number;
}

/* ── Pytania z intake per typ części (krytyka właściciela, punkt 4) ──────────
   Kupujący nie pisze „OEM 17211-ZL8-023". Pisze „mam kosiarkę z Castoramy,
   jaki filtr". Gdy fakty nie dają odpowiedzi, szkic ma zadać DOKŁADNIE te
   pytania, a nie ogólne „proszę o więcej danych". Słownik jest KODEM, nie
   promptem: biuro dopisze typ części bez dotykania instrukcji modelu.      */
const INTAKE: Array<{ typ: string; slowa: RegExp; pytania: string[] }> = [
  { typ: "nóż", slowa: /\bn[oó]ż|no[zż]e|ostrz/i, pytania: [
    "długość całkowita noża", "średnica otworu centralnego",
    "liczba i rozstaw otworów dodatkowych", "kształt: prosty, mulczujący czy z podniesionymi skrzydłami",
    "grubość", "zdjęcie starego noża na tle linijki" ] },
  { typ: "pasek", slowa: /\bpas(ek|ka|ki|kiem)\b/i, pytania: [
    "profil paska (Z/A/B, 3L/4L/5L, SPZ)", "długość zewnętrzna La albo wewnętrzna Li",
    "zwykły klinowy czy aramidowy (kevlar)", "ile pasków w komplecie" ] },
  { typ: "filtr", slowa: /\bfiltr/i, pytania: [
    "wymiary długość × szerokość × wysokość", "kształt: płaski, okrągły czy owalny",
    "papierowy czy piankowy", "z filtrem wstępnym czy bez", "zdjęcie tabliczki znamionowej silnika" ] },
  { typ: "linka", slowa: /\blink[aiąę]\b|cięgn/i, pytania: [
    "długość pancerza", "długość rdzenia", "rodzaj końcówek",
    "zdjęcie starej linki na tle linijki z widocznymi końcówkami" ] },
  { typ: "rozrusznik", slowa: /rozruszn|spręż/i, pytania: [
    "średnica bębna", "kierunek nawinięcia", "zdjęcie tabliczki znamionowej silnika" ] },
  { typ: "gaźnik lub uszczelka", slowa: /ga[zź]nik|uszczelk|membran/i, pytania: [
    "symbol gaźnika z jego korpusu albo tabliczki silnika",
    "pozycja uszczelki: od strony filtra, od strony kolektora czy między dystansem",
    "zdjęcie starej części" ] },
];

const PYTANIA_OGOLNE = [
  "marka i model maszyny z tabliczki znamionowej", "model silnika, jeśli maszyna go ma osobno",
  "zdjęcie starej części na tle linijki",
];

export function pytaniaIntake(nazwaCzesci: string | null): { typ: string; pytania: string[] } {
  const n = (nazwaCzesci ?? "").trim();
  const w = n ? INTAKE.find((i) => i.slowa.test(n)) : undefined;
  return w ? { typ: w.typ, pytania: w.pytania } : { typ: "część", pytania: PYTANIA_OGOLNE };
}

/**
 * Odwołania do faktów „(F3)", „(F1, F2)" znikają z treści PO sprawdzeniu.
 * Model ma je pisać — to na nich stoi kontrola pokrycia — ale klient nie ma
 * ich czytać. Na zrzucie właściciela (8.09.2026) stały w szkicu gotowym do
 * wstawienia. `uzyteFakty` zostaje w wierszu jako ślad dla pomiaru.
 */
export function bezZnacznikow(tresc: string): string {
  return tresc
    .replace(/\s*\(\s*F\d+(?:\s*,\s*F\d+)*\s*\)/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1");
}

/* Kształt numeru części: litery i cyfry z myślnikiem albo ukośnikiem, co
   najmniej cztery znaki, co najmniej jedna cyfra. Łapie `W09-0211`, `GX160`,
   `17211-ZL8-023`, `5901234567890`; nie łapie „148 mm" ani słów bez cyfr. */
const NUMER = /\b[A-Z0-9][A-Z0-9\-\/]{3,}\b/gi;

/** Numery ze szkicu, których NIE MA ani w faktach, ani w rozmowie. */
export function numerySpozaFaktow(tresc: string, dozwolone: string): string[] {
  const korpus = dozwolone.toUpperCase();
  const obce = new Set<string>();
  for (const m of tresc.match(NUMER) ?? []) {
    if (!/\d/.test(m)) continue;
    if (!korpus.includes(m.toUpperCase())) obce.add(m);
  }
  return [...obce];
}

/* ── Dane doboru z rozmowy: sprawdzenie przeciw temu, co model widział ──────
   Model może POMYLIĆ pole (wpisać silnik jako model), ale nie może DOPISAĆ
   wartości, której w rozmowie nie ma — a to drugie kosztowałoby zły dobór,
   bo dane doboru karmią szczeble wyszukiwania. Reguła jest deterministyczna
   jak `numerySpozaFaktow`: każdy token z cyfrą musi stać w rozmowie po `zwin`
   („532 19 93-77" = „532199377"), a każde słowo bez cyfry musi mieć swoje
   pierwsze cztery litery w rozmowie — „śrubę do noża" pokrywa „śruba noża",
   „linki napędowej" pokrywa „linka napędu". Sprawdzamy przeciw ZAMASKOWANEMU
   wątkowi, bo to on poszedł do modelu: wartość, która zniknęła jako
   `[telefon]`, nie ma jak wrócić do danych.                                  */

const KLUCZE_DANYCH: Array<keyof Omit<DaneDoboru, "parametry">> = [
  "marka", "model", "wariant", "rocznik", "nrSeryjny", "silnik", "oem", "nazwaCzesci",
];

export function wartoscZRozmowy(wartosc: string, watek: string): boolean {
  const w = wartosc.trim();
  if (!w || w.length > 120) return false;
  const tekst = watek.toLowerCase();
  const zwiniety = zwin(watek).toLowerCase();
  const tokeny = w.split(/[\s,;:()]+/).filter(Boolean);
  if (tokeny.length === 0) return false;
  for (const t of tokeny) {
    if (/\d/.test(t)) {
      if (!zwiniety.includes(zwin(t).toLowerCase())) return false;
    } else {
      const rdzen = t.toLowerCase().replace(/[^\p{L}]/gu, "").slice(0, 4);
      if (rdzen && !tekst.includes(rdzen)) return false;
    }
  }
  return true;
}

/**
 * Propozycja po sprawdzeniu: zostają wyłącznie wartości, które stoją
 * w rozmowie. `null`, gdy nie zostało nic. Druga liczba to ile wypadło —
 * idzie do dziennika jako miara, ile model zmyśla.
 */
export function oczyscPropozycje(
  dane: DaneDoboru | null, watek: string,
): { dane: DaneDoboru | null; odrzuconych: number } {
  if (!dane) return { dane: null, odrzuconych: 0 };
  let odrzuconych = 0;
  let cokolwiek = false;
  const czyste: DaneDoboru = {
    marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null,
    silnik: null, oem: null, nazwaCzesci: null, parametry: {},
  };
  for (const k of KLUCZE_DANYCH) {
    const v = (dane[k] ?? "").trim();
    if (!v) continue;
    if (wartoscZRozmowy(v, watek)) { czyste[k] = v; cokolwiek = true; } else odrzuconych += 1;
  }
  for (const [nazwa, wartosc] of Object.entries(dane.parametry ?? {})) {
    const n = nazwa.trim(); const v = String(wartosc ?? "").trim();
    if (!n || !v) continue;
    if (wartoscZRozmowy(v, watek)) { czyste.parametry[n] = v; cokolwiek = true; } else odrzuconych += 1;
  }
  return { dane: cokolwiek ? czyste : null, odrzuconych };
}

/** Login rozmówcy z WĄTKU Allegro — nie z tematu, bo temat bywa tytułem oferty. */
function loginRozmowcy(conversationId: number): string | null {
  const w = db().prepare(`SELECT t.interlocutor_login AS login
      FROM conversation c JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE c.id=?`).get(conversationId) as { login: string | null } | undefined;
  const l = String(w?.login ?? "").trim();
  return l || null;
}

const zdanieSilnika = (tekst: string | null): string | null => {
  if (!tekst) return null;
  const alias = silnikZTekstu(tekst);
  return alias ? `${tekst} (wg słownika: ${alias.silnik.etykieta})` : tekst;
};

const dostepnosc = (ile: number | null, jednostka: string | null) =>
  ile != null && ile > 0 ? `dostępne dziś: ${ile} ${jednostka ?? "szt."}` : "dziś brak na stanie";

/**
 * Fakty dla modelu — czysty ODCZYT, niczego nie zapisuje.
 *
 * Co świadomie NIE wchodzi: półka, rezerwacje, rozbicie na magazyny (§10.4 —
 * adres regału mówi obcemu, jak zbudowany jest magazyn), opis kartoteki
 * w całości (bywa notatką magazynu), historia zakupów klienta (§14.4).
 */
export function kontekstSzkicu(conversationId: number, subiekt: SubiektAdapter): KontekstSzkicu {
  const wiadomosci = db().prepare(`SELECT id, direction, body FROM message
      WHERE conversation_id=? ORDER BY sent_at, id`).all(conversationId) as
    Array<{ id: number; direction: string; body: string | null }>;
  if (wiadomosci.length === 0) {
    throw new Error("Rozmowa nie ma żadnej wiadomości — nie ma na co odpowiadać");
  }
  const login = loginRozmowcy(conversationId);
  const watek: WiadomoscWatku[] = wiadomosci.map((m) => ({
    odKlienta: m.direction === "incoming",
    /* Stopka firmowa wycięta tą samą funkcją, którą czyta ją oś rozmowy —
       model nie ma się uczyć naszego podpisu, a znaki kosztują. */
    tresc: m.direction === "outgoing" ? podzielStopke(String(m.body ?? "")).tresc : String(m.body ?? ""),
  }));
  const ostatniaKlienta = [...wiadomosci].reverse().find((m) => m.direction === "incoming");

  const fakty: Fakt[] = [];
  const dodaj = (rodzaj: RodzajFaktu, zdanie: string) =>
    fakty.push({ id: `F${fakty.length + 1}`, rodzaj, zdanie: bezPodpisu(zdanie.replace(/\s+/g, " ").trim()) });

  /* Oferta i jej kartoteka — tą samą regułą, którą czyta je dobór. */
  const oferta = ofertaRozmowy(db(), conversationId);
  let kartotekaTwId: number | null = null;
  if (oferta) {
    const snap = db().prepare(`SELECT nazwa, sku FROM offer_snapshot
        WHERE channel_account_id=? AND external_id=?`).get(oferta.konto, oferta.ofertaId) as
      { nazwa: string; sku: string | null } | undefined;
    if (snap) dodaj("oferta", `Oferta, o którą pyta klient: „${snap.nazwa}"`);
    const k = kartotekaOferty(db(), oferta.konto, oferta.ofertaId, snap?.sku ?? undefined);
    if (k.twId !== null) {
      const karta = buildProductCard(subiekt, k.twId);
      if (karta) {
        kartotekaTwId = k.twId;
        const numery = karta.identyfikatory.map((i) => i.wartosc).join(", ");
        dodaj("kartoteka", `Kartoteka oferty: ${karta.sym} — ${karta.name}; EAN ${karta.ean || "brak"};`
          + ` numery: ${numery || "brak"}; ${dostepnosc(karta.mag.avail, karta.unit)} (${k.zrodlo})`);
      }
    } else {
      dodaj("oferta", `Oferta bez kartoteki w Subiekcie: ${k.zrodlo}`);
    }
  }

  /* Dane doboru wpisane przez AGENTA — nigdy wyciągnięte z treści (blizna szarpaka). */
  const dobor = doborRozmowy(conversationId);
  const d = dobor.dane;
  const pola = [
    ["marka", d.marka], ["model", d.model], ["wariant", d.wariant], ["rocznik", d.rocznik],
    /* Silnik z aliasu słownika (0.238.0): model dostaje KANONICZNĄ nazwę
       do zdania „mają Państwo silnik…", zamiast zgadywać, co znaczy „Lonci". */
    ["numer seryjny", d.nrSeryjny], ["silnik", zdanieSilnika(d.silnik)], ["numer OEM lub symbol", d.oem],
    ["szukana część", d.nazwaCzesci],
  ].filter((p): p is [string, string] => Boolean(p[1]));
  const parametry = Object.entries(d.parametry).map(([k, v]) => `${k}: ${v}`);
  if (pola.length || parametry.length) {
    dodaj("dobor", `Dane doboru wpisane przez agenta: ${[...pola.map(([k, v]) => `${k} ${v}`), ...parametry].join("; ")}`);
  }
  if (dobor.brakuje) dodaj("dobor", `Agent zaznaczył, czego brakuje do doboru: ${dobor.brakuje}`);
  if (dobor.wybrany) dodaj("dobor", `Część wybrana przez agenta: ${dobor.wybrany.zdanieDoSzkicu}`);

  const kand = kandydaciDoboru(conversationId, subiekt);
  for (const k of kand.kandydaci.slice(0, 6)) {
    dodaj("kandydat", `Kandydat ${k.symbol} — ${k.nazwa}; pewność: ${k.pewnosc}; ${k.zrodlo};`
      + ` ${dostepnosc(k.stan, null)}${k.ostrzezenia.length ? `; ostrzeżenia: ${k.ostrzezenia.join("; ")}` : ""}`);
  }
  for (const n of kand.negatywne) {
    dodaj("negatyw", `NIE PASUJE: ${n.symbol}${n.nazwa ? ` (${n.nazwa})` : ""} — ${n.powod}; ${n.zrodlo}`);
  }

  const wiedza = wiedzaDoboru(conversationId);
  if (wiedza.zastosowanie) dodaj("wiedza", `Wybrana część: ${wiedza.zastosowanie.zdanieZrodla}`);
  if (wiedza.zabudowa) dodaj("wiedza", `Silnik maszyny: ${wiedza.zabudowa.zdanieZrodla}`);
  for (const z of wiedza.silniki) dodaj("wiedza", `Silnik maszyny wg bazy: ${z.zdanieZrodla}`);
  for (const p of wiedza.pomiary) dodaj("wiedza", `Pomiar z hali „${p.tytul}": ${p.wynik}`);
  if (wiedza.pasowanie) dodaj("pasowanie", `Wybrana część: ${wiedza.pasowanie.zdanie}`);

  if (kartotekaTwId !== null) {
    const pas = pasowaniaTowaru(kartotekaTwId);
    for (const t of [...pas.pasujace, ...pas.pasujeDo]) dodaj("pasowanie", t.zdanie);
    for (const n of pas.negatywne) {
      dodaj("negatyw", `NIE PASUJE: ${n.czesc.symbol} do ${n.doCzego.symbol} — ${n.zdaniePowodu}; ${n.zdanieZrodla}`);
    }
  }

  /* Intake dopiero, gdy nie ma wyboru POTWIERDZONEGO: przy dowodzie w bazie
     pytania o wymiary byłyby udawaniem, że nie wiemy. */
  const wybranyPewny = dobor.wybrany
    && kand.kandydaci.some((k) => k.twId === dobor.wybrany!.twId && k.pewnosc === "potwierdzone");
  if (!wybranyPewny) {
    const i = pytaniaIntake(d.nazwaCzesci);
    /* „TYLKO o to, czego jeszcze nie podał" stoi w FAKCIE, nie tylko w
       instrukcji (0.232.2): klientka podała komplet danych z tabliczki,
       a szkic poprosił o tabliczkę raz jeszcze, bo fakt brzmiał „zapytaj o…". */
    dodaj("intake", `Gdy fakty nie rozstrzygają, zapytaj klienta TYLKO o to, czego w rozmowie jeszcze nie podał`
      + ` (${i.typ}): ${i.pytania.join("; ")}; to, co już podał, potwierdź jednym zdaniem`);
  }

  const tekstFaktow = fakty.map((f) => `${f.id}: ${f.zdanie}`).join("\n") as FaktyBezpieczne;
  return {
    fakty, tekstFaktow,
    watek: zamaskujWatek(watek, login),
    ostatniaWiadomoscId: ostatniaKlienta ? Number(ostatniaKlienta.id) : null,
    doborWersja: dobor.wersja,
  };
}

/**
 * Ułożenie szkicu: fakty → model → SPRAWDZENIE → zapis. Rzuca, gdy dostawca
 * odmówił albo gdy model wyszedł poza fakty; w obu razach wywołanie było
 * płatne i ląduje w księdze jako `blad`.
 */
export async function ulozSzkic(
  conversationId: number, kto: { id: number; name: string },
  nadaj: NadawcaSzkicu, subiekt: SubiektAdapter, teraz = new Date(),
): Promise<SzkicCopilota> {
  const k = kontekstSzkicu(conversationId, subiekt);
  /* Asercja przed siecią — na WĄTKU, bo tam jest tekst klienta. Faktów nie
     sprawdzamy tymi wzorcami celowo: dziewięć cyfr numeru OEM zapaliłoby
     „telefon" i to byłby fałszywy alarm, a nie zepsute maskowanie. */
  if (zostalyDaneOsobowe(String(k.watek))) {
    zapiszBlad(conversationId, "maskowanie", kto, teraz);
    throw new Error("Maskowanie nie oczyściło rozmowy — nic nie wyszło do dostawcy");
  }

  let odp: OdpowiedzSzkicu;
  try {
    odp = await nadaj(k.watek, k.tekstFaktow);
  } catch (e) {
    const slad = (e as { slad?: string }).slad || (e as Error).message;
    zapiszBlad(conversationId, slad, kto, teraz);
    throw e;
  }

  /* SPRAWDZENIE DETERMINISTYCZNE — orkiestrator, nie wyrocznia. Bez ponowienia:
     wywołanie jest zapłacone, agent widzi zdanie i klika drugi raz, jeśli chce. */
  const obce = numerySpozaFaktow(odp.tresc, `${k.tekstFaktow}\n${k.watek}`);
  if (obce.length) {
    zapiszWywolanie(conversationId, odp, "blad", `numer_spoza_faktow: ${obce.join(", ")}`, kto, teraz);
    throw new BladOdpowiedziCopilota(
      `Model użył numeru ${obce[0]}, którego nie ma w faktach — szkic odrzucony. `
      + "Kliknij ponownie albo napisz odpowiedź sam.", 200, "numer_spoza_faktow");
  }
  const znane = new Set(k.fakty.map((f) => f.id));
  const nieznane = odp.uzyteFakty.filter((f) => !znane.has(f));
  if (nieznane.length) {
    zapiszWywolanie(conversationId, odp, "blad", `fakt_spoza_listy: ${nieznane.join(", ")}`, kto, teraz);
    throw new BladOdpowiedziCopilota(
      `Model powołał się na fakt ${nieznane[0]}, którego nie dostał — szkic odrzucony.`, 200, "fakt_spoza_listy");
  }
  /* Nadmiar to BŁĄD, nie przycięcie: ucięte zdanie na końcu szkicu wyglądałoby
     na gotowe, a wysyłka i tak odmówiłaby ponad limitem Allegro. */
  if (odp.tresc.length > LIMIT_ZNAKOW) {
    zapiszWywolanie(conversationId, odp, "blad", `za_dlugi: ${odp.tresc.length}`, kto, teraz);
    throw new BladOdpowiedziCopilota(
      `Model napisał ${odp.tresc.length} znaków, a Allegro przyjmuje ${LIMIT_ZNAKOW} — szkic odrzucony.`,
      200, "za_dlugi");
  }

  /* Dopiero TERAZ, po sprawdzeniu: odwołania były potrzebne kontroli, klientowi nie. */
  const tresc = bezZnacznikow(odp.tresc);
  /* Dane z rozmowy: zmyślona wartość NIE odrzuca szkicu (szkic jest wart
     pieniędzy sam w sobie), tylko wypada z propozycji; liczbę notujemy. */
  const propozycja = oczyscPropozycje(odp.daneDoboru, String(k.watek));
  transaction(db(), () => {
    db().prepare(`INSERT INTO szkic_copilota
      (conversation_id,tresc,zastrzezenia,uzyte_fakty,message_id,model,at,przez,przez_user_id,
       dane_doboru,dobor_wersja)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        tresc=excluded.tresc, zastrzezenia=excluded.zastrzezenia, uzyte_fakty=excluded.uzyte_fakty,
        message_id=excluded.message_id, model=excluded.model, at=excluded.at,
        przez=excluded.przez, przez_user_id=excluded.przez_user_id,
        dane_doboru=excluded.dane_doboru, dobor_wersja=excluded.dobor_wersja,
        /* Nowa propozycja — stara ocena jej nie dotyczy; danych też. */
        ocena=NULL, ocena_at=NULL, dane_ocena=NULL, dane_ocena_at=NULL`)
      .run(conversationId, tresc, JSON.stringify(odp.zastrzezenia), JSON.stringify(odp.uzyteFakty),
        k.ostatniaWiadomoscId, odp.model, teraz.toISOString(), kto.name, kto.id,
        propozycja.dane ? JSON.stringify(propozycja.dane) : null, k.doborWersja);
    zapiszWywolanie(conversationId, odp, "ok", null, kto, teraz);
    /* Ładunki niosą identyfikatory i DŁUGOŚCI, nigdy treść (§19). */
    logEvent("copilot_szkic", kto.name, null, {
      conversationId, znakow: tresc.length, zastrzezen: odp.zastrzezenia.length,
      faktow: k.fakty.length, model: odp.model, tokeny: odp.zuzycie,
      polDoboru: propozycja.dane ? liczbaPol(propozycja.dane) : 0,
      polOdrzuconych: propozycja.odrzuconych,
    }, kto.id, db());
    db().prepare("INSERT INTO conversation_event(conversation_id, event_type, payload) VALUES (?,?,?)")
      .run(conversationId, "copilot_szkic",
        JSON.stringify({ znakow: tresc.length, model: odp.model, autor: kto.name }));
  })();
  publishConversationEvent("assignment.changed", conversationId, { szkic: true });
  return szkicCopilota(conversationId)!;
}

/** Werdykt agenta o propozycji — jedyna liczba mówiąca, czy przycisk jest wart pieniędzy. */
export function ocenSzkic(
  conversationId: number, ocena: string, kto: { id: number; name: string }, teraz = new Date(),
): { ocena: OcenaSzkicu } {
  if (!(OCENY_SZKICU as readonly string[]).includes(ocena)) {
    throw new Error("Ocena może być „wstawiony”, „zastapiony” albo „odrzucony”.");
  }
  const jest = db().prepare("SELECT 1 FROM szkic_copilota WHERE conversation_id=?").get(conversationId);
  if (!jest) throw new Error("Ta rozmowa nie ma jeszcze szkicu Copilota");
  transaction(db(), () => {
    db().prepare("UPDATE szkic_copilota SET ocena=?, ocena_at=? WHERE conversation_id=?")
      .run(ocena, teraz.toISOString(), conversationId);
    logEvent("copilot_szkic_ocena", kto.name, null, { conversationId, ocena }, kto.id, db());
  })();
  return { ocena: ocena as OcenaSzkicu };
}

const liczbaPol = (d: DaneDoboru) =>
  KLUCZE_DANYCH.filter((k) => d[k]).length + Object.keys(d.parametry).length;

/**
 * Agent kliknął „Wpisz do danych": propozycja wchodzi do `dobor_rozmowy`
 * WYŁĄCZNIE w puste pola — to, co agent wpisał sam, jest jego słowem i zostaje.
 * Zapis idzie przez `zapiszDane`, więc dostaje wszystko, co ręczny: wersję,
 * dziennik `dobor_dane`, przejście `not_started → searching`, zdarzenie dla
 * ekranów i 409 przy wyścigu (leci dalej, jak z ręki). Gdy nic nie było puste,
 * los jest „wpisane" bez zapisu doboru — agent to już miał.
 */
export function przyjmijDaneDoboru(
  conversationId: number, expectedVersion: number, kto: { id: number; name: string }, teraz = new Date(),
): SzkicCopilota {
  const s = szkicCopilota(conversationId);
  if (!s || !s.daneDoboru) throw new Error("Ta rozmowa nie ma propozycji danych doboru");
  if (s.daneOcena !== null) throw new Error("Propozycja danych została już oceniona");
  const biezace = doborRozmowy(conversationId).dane;
  const czesc: Partial<DaneDoboru> = {};
  let pol = 0;
  for (const k of KLUCZE_DANYCH) {
    if (s.daneDoboru[k] && !biezace[k]) { czesc[k] = s.daneDoboru[k]; pol += 1; }
  }
  const parametry = { ...biezace.parametry };
  for (const [n, v] of Object.entries(s.daneDoboru.parametry)) {
    if (!(n in parametry)) { parametry[n] = v; pol += 1; }
  }
  if (pol > 0) {
    czesc.parametry = parametry;
    zapiszDane(conversationId, czesc, expectedVersion, kto.id);
  }
  transaction(db(), () => {
    db().prepare("UPDATE szkic_copilota SET dane_ocena='wpisane', dane_ocena_at=? WHERE conversation_id=?")
      .run(teraz.toISOString(), conversationId);
    /* Liczby, nie wartości (§19) — wartości są w `dobor_dane` z ręcznego zapisu. */
    logEvent("copilot_dane_doboru", kto.name, null, { conversationId, ocena: "wpisane", pol }, kto.id, db());
  })();
  return szkicCopilota(conversationId)!;
}

/** Agent odesłał propozycję danych. Wiersz zostaje dla pomiaru. */
export function odrzucDaneDoboru(
  conversationId: number, kto: { id: number; name: string }, teraz = new Date(),
): SzkicCopilota {
  const s = szkicCopilota(conversationId);
  if (!s || !s.daneDoboru) throw new Error("Ta rozmowa nie ma propozycji danych doboru");
  transaction(db(), () => {
    db().prepare("UPDATE szkic_copilota SET dane_ocena='odrzucone', dane_ocena_at=? WHERE conversation_id=?")
      .run(teraz.toISOString(), conversationId);
    logEvent("copilot_dane_doboru", kto.name, null, { conversationId, ocena: "odrzucone" }, kto.id, db());
  })();
  return szkicCopilota(conversationId)!;
}

/** Odczyt propozycji dla osi rozmowy. `null` = nikt jeszcze nie prosił. */
export function szkicCopilota(conversationId: number): SzkicCopilota | null {
  const w = db().prepare(`SELECT tresc, zastrzezenia, uzyte_fakty, message_id, model, at, przez, ocena,
      dane_doboru, dane_ocena, dobor_wersja
      FROM szkic_copilota WHERE conversation_id=?`).get(conversationId) as Record<string, unknown> | undefined;
  if (!w) return null;
  return {
    tresc: String(w.tresc),
    zastrzezenia: JSON.parse(String(w.zastrzezenia ?? "[]")) as string[],
    uzyteFakty: JSON.parse(String(w.uzyte_fakty ?? "[]")) as string[],
    messageId: w.message_id == null ? null : Number(w.message_id),
    model: String(w.model), at: String(w.at), przez: String(w.przez),
    ocena: w.ocena == null ? null : String(w.ocena) as OcenaSzkicu,
    daneDoboru: w.dane_doboru == null ? null : JSON.parse(String(w.dane_doboru)) as DaneDoboru,
    daneOcena: w.dane_ocena == null ? null : String(w.dane_ocena) as OcenaDanych,
    doborWersja: Number(w.dobor_wersja ?? 0),
  };
}

function zapiszWywolanie(
  conversationId: number, odp: OdpowiedzSzkicu, wynik: "ok" | "blad", blad: string | null,
  kto: { id: number }, teraz: Date,
): void {
  db().prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,
     tokeny_cache_odczyt,ms,wynik,blad,przez_user_id,at)
    VALUES ('szkic',?,?,?,?,?,?,?,?,?,?,?)`)
    .run(conversationId, odp.model, odp.zuzycie.wej, odp.zuzycie.wyj,
      odp.zuzycie.cacheZapis, odp.zuzycie.cacheOdczyt, odp.ms, wynik,
      blad ? blad.slice(0, 300) : null, kto.id, teraz.toISOString());
}

function zapiszBlad(conversationId: number, powod: string, kto: { id: number }, teraz: Date): void {
  db().prepare(`INSERT INTO copilot_wywolanie
    (zadanie,conversation_id,model,wynik,blad,przez_user_id,at)
    VALUES ('szkic',?,'',?,?,?,?)`)
    .run(conversationId, "blad", powod.slice(0, 300), kto.id, teraz.toISOString());
}
