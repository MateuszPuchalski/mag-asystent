import { db, transaction } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { BladOdpowiedziCopilota } from "../adapters/copilot.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  zamaskujWatek, zostalyDaneOsobowe, type TrescBezpieczna, type WiadomoscWatku,
} from "./copilot-maskowanie.js";
import type { Tokeny } from "./copilot-koszt.js";
import { doborRozmowy, wiedzaDoboru } from "./dobor.js";
import { kandydaciDoboru, ofertaRozmowy } from "./kandydaci.js";
import { kartotekaOferty } from "./dopasowanie-sku.js";
import { buildProductCard } from "./stock.js";
import { pasowaniaTowaru } from "./pasowania.js";
import { podzielStopke } from "./stopka.js";
import { LIMIT_ZNAKOW } from "./wysylka.js";

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
}

/** Surowa odpowiedź modelu. Walidacja jest niżej, w `ulozSzkic`. */
export interface OdpowiedzSzkicu {
  tresc: string;
  uzyteFakty: string[];
  zastrzezenia: string[];
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

export interface SzkicCopilota {
  tresc: string;
  zastrzezenia: string[];
  uzyteFakty: string[];
  messageId: number | null;
  model: string;
  at: string;
  przez: string;
  ocena: OcenaSzkicu | null;
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
    "długość pancerza", "długość rdzenia", "rodzaj końcówek" ] },
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
 * Podpis dowodu bez nazwiska pracownika: `— katalog dostawcy, 7.09.2026, Anna`
 * staje się `— katalog dostawcy, 7.09.2026`. Model nazwiska nie potrzebuje,
 * a klient nie ma go dostać; §14.4 mówi o „zbędnych danych osobowych" i to jest
 * taka dana. Wzorzec jest DATĄ, po której stoi autor — tak buduje podpis
 * `zdanieZrodla()` w `wiedza.ts`, `silniki.ts` i `pasowania.ts`.
 */
export function bezPodpisu(zdanie: string): string {
  return zdanie.replace(
    /(\b\d{1,2}\.\d{2}\.\d{4}), (?:[^;).]|\.(?=\s?\p{Lu}))+(?=;|\)|\.(?:\s|$)|$)/gu, "$1");
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

/** Login rozmówcy z WĄTKU Allegro — nie z tematu, bo temat bywa tytułem oferty. */
function loginRozmowcy(conversationId: number): string | null {
  const w = db().prepare(`SELECT t.interlocutor_login AS login
      FROM conversation c JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE c.id=?`).get(conversationId) as { login: string | null } | undefined;
  const l = String(w?.login ?? "").trim();
  return l || null;
}

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
    ["numer seryjny", d.nrSeryjny], ["silnik", d.silnik], ["numer OEM lub symbol", d.oem],
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
    dodaj("intake", `Gdy fakty nie rozstrzygają, zapytaj klienta (${i.typ}): ${i.pytania.join("; ")}`);
  }

  const tekstFaktow = fakty.map((f) => `${f.id}: ${f.zdanie}`).join("\n") as FaktyBezpieczne;
  return {
    fakty, tekstFaktow,
    watek: zamaskujWatek(watek, login),
    ostatniaWiadomoscId: ostatniaKlienta ? Number(ostatniaKlienta.id) : null,
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

  transaction(db(), () => {
    db().prepare(`INSERT INTO szkic_copilota
      (conversation_id,tresc,zastrzezenia,uzyte_fakty,message_id,model,at,przez,przez_user_id)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        tresc=excluded.tresc, zastrzezenia=excluded.zastrzezenia, uzyte_fakty=excluded.uzyte_fakty,
        message_id=excluded.message_id, model=excluded.model, at=excluded.at,
        przez=excluded.przez, przez_user_id=excluded.przez_user_id,
        /* Nowa propozycja — stara ocena jej nie dotyczy. */
        ocena=NULL, ocena_at=NULL`)
      .run(conversationId, odp.tresc, JSON.stringify(odp.zastrzezenia), JSON.stringify(odp.uzyteFakty),
        k.ostatniaWiadomoscId, odp.model, teraz.toISOString(), kto.name, kto.id);
    zapiszWywolanie(conversationId, odp, "ok", null, kto, teraz);
    /* Ładunki niosą identyfikatory i DŁUGOŚCI, nigdy treść (§19). */
    logEvent("copilot_szkic", kto.name, null, {
      conversationId, znakow: odp.tresc.length, zastrzezen: odp.zastrzezenia.length,
      faktow: k.fakty.length, model: odp.model, tokeny: odp.zuzycie,
    }, kto.id, db());
    db().prepare("INSERT INTO conversation_event(conversation_id, event_type, payload) VALUES (?,?,?)")
      .run(conversationId, "copilot_szkic",
        JSON.stringify({ znakow: odp.tresc.length, model: odp.model, autor: kto.name }));
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

/** Odczyt propozycji dla osi rozmowy. `null` = nikt jeszcze nie prosił. */
export function szkicCopilota(conversationId: number): SzkicCopilota | null {
  const w = db().prepare(`SELECT tresc, zastrzezenia, uzyte_fakty, message_id, model, at, przez, ocena
      FROM szkic_copilota WHERE conversation_id=?`).get(conversationId) as Record<string, unknown> | undefined;
  if (!w) return null;
  return {
    tresc: String(w.tresc),
    zastrzezenia: JSON.parse(String(w.zastrzezenia ?? "[]")) as string[],
    uzyteFakty: JSON.parse(String(w.uzyte_fakty ?? "[]")) as string[],
    messageId: w.message_id == null ? null : Number(w.message_id),
    model: String(w.model), at: String(w.at), przez: String(w.przez),
    ocena: w.ocena == null ? null : String(w.ocena) as OcenaSzkicu,
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
