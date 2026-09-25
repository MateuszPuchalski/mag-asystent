import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { buildProductCard } from "./stock.js";
import { kiedyBedzie } from "./copilot-szkic.js";
import { szukajPoIdentyfikatorze } from "./identyfikatory.js";
import { szukajModeli, zastosowaniaModelu, zastosowaniaTowaru, type Zastosowanie } from "./wiedza.js";
import { pasowaniaTowaru } from "./pasowania.js";
import { zamiennicyOem } from "./zamiennosc-oem.js";
import { zwin } from "../tekst.js";

/* ── Narzędzia Copilota: model sam sięga do bazy (@wydanie) ──────────────────

   Do tego wydania model dostawał fakty, które mu wybraliśmy, i nic więcej.
   Agent pytał „czy ten gaźnik pasuje do MS 250", a model mógł odpowiedzieć
   tylko z tego, co `kontekstSzkicu` położył na stole — albo z pamięci, ze
   źródłem `model` i sufitem „niepewne". Odpowiedź leżała w bazie, obok.

   Teraz model dostaje NARZĘDZIA i sam decyduje, o co zapytać. Każde jest:

   - TYLKO DO ODCZYTU. Żadne nie pisze, nie wysyła i nie woła sieci — ani
     Allegro, ani Subiekta na żywo (adapter czyta lokalny odczyt `sgt_*`).
     To jest twarda granica tego pliku, nie zwyczaj: model wybiera wywołania,
     więc jedno narzędzie z zapisem dawałoby mu prawo zapisu.
   - O NASZYM TOWARZE, nie o kliencie. Historii zakupów i profilu klienta tu
     nie ma, z tego samego powodu co w faktach szkicu (§14.4). Nie ma też
     półki ani opisu kartoteki w całości (§10.4 — opis bywa notatką magazynu).
   - UCIĘTE. Wynik ma sufit znaków, bo każdy wraca do modelu w następnej
     rundzie i płaci się za niego przy każdej kolejnej.

   ZNACZNIKI WIEDZY. Zatwierdzone zastosowanie niesie znacznik `WZ<id>`,
   niezatwierdzona propozycja `WP<id>`. Model wpisuje go w `odwolanie`
   twierdzenia, a serwer obniża do „niepewne" każde twierdzenie oparte na
   propozycji (`naPropozycjiNiepewne`). Instrukcja mówi to samo, ale sufit
   pewności stoi w kodzie, nie w dyscyplinie modelu — ta sama zasada, co
   przy fakcie „rozpoznanie". Litera `Z` była zajęta przez zdjęcia.        */

/** Wynik narzędzia. Rodzi się WYŁĄCZNIE tutaj, z naszej kartoteki i wiedzy. */
export type WynikNarzedzia = string & { readonly __narzedzie: unique symbol };

/** Kształt definicji zgodny z `Anthropic.Tool`; SDK zna tylko adapter. */
export interface DefinicjaNarzedzia {
  name: string;
  description: string;
  strict: true;
  input_schema: {
    type: "object";
    properties: Record<string, { type: "string"; description: string }>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ZestawNarzedzi {
  definicje: DefinicjaNarzedzia[];
  /** Synchroniczne, bo wszystko jest lokalnym odczytem SQLite. */
  wykonaj(nazwa: string, wejscie: unknown): { wynik: WynikNarzedzia; blad: boolean };
}

/** Ślad jednego wywołania — do zapisu przy wymianie i na ekran agenta. */
export interface UzycieNarzedzia {
  nazwa: string;
  argument: string;
  znakow: number;
}

/** Sufit znaków jednego wyniku. Cztery tysiące to kilkanaście kartotek. */
export const SUFIT_WYNIKU = 4000;
/** Ile trafień zwraca wyszukiwanie. Więcej i tak nie przeczyta nikt. */
const TRAFIEN = 8;
/** Ile modeli rozwija „części do maszyny". Fraza „Stihl" pasuje do setek. */
const MODELI = 5;
/** Ile pozycji listy zgodności oferty. Tyle samo co w faktach szkicu. */
const ZGODNOSCI = 30;
/** Ile znaków opisu oferty. Słowa sprzedawcy, nie kartoteka. */
const OPISU = 1500;

const argument = (nazwa: string, opis: string): DefinicjaNarzedzia => ({
  name: nazwa, description: opis, strict: true,
  input_schema: {
    type: "object",
    properties: { zapytanie: { type: "string", description: "Symbol, numer, nazwa albo model — zależnie od narzędzia." } },
    required: ["zapytanie"],
    additionalProperties: false,
  },
});

/* Kolejność stała: lista narzędzi stoi w prefiksie żądania, więc zmiana
   kolejności unieważnia cache. Opisy mówią, KIEDY sięgnąć — model wybiera
   po opisie, nie po nazwie. */
export const DEFINICJE: DefinicjaNarzedzia[] = [
  argument("szukaj_towaru",
    "Szuka naszej kartoteki po symbolu, nazwie, EAN albo numerze części (OEM, numer oryginalny, "
    + "numer z katalogu obcego). Zwraca symbole, nazwy i dostępność. Użyj, gdy nie znasz naszego symbolu."),
  argument("karta_towaru",
    "Karta jednej kartoteki po naszym symbolu: nazwa, EAN, numery OEM i oryginalne, dostępność dziś, "
    + "zamówienia u dostawcy przy braku, zamienniki z kartoteki i zatwierdzeni zamiennicy po numerze OEM."),
  argument("pasowanie_towaru",
    "Do jakich maszyn i silników pasuje kartoteka o danym symbolu, do czego NIE pasuje, jakie propozycje "
    + "czekają na zatwierdzenie i z jakimi częściami współpracuje. Użyj przy każdym pytaniu o pasowanie."),
  argument("czesci_do_maszyny",
    "Odwrotny kierunek: marka i model maszyny albo silnika (np. „Stihl MS 250”) → nasze kartoteki "
    + "zatwierdzone jako pasujące lub niepasujące. Użyj, gdy klient podał model maszyny."),
  argument("tresc_oferty",
    "Treść naszych ofert Allegro dla kartoteki o danym symbolu, z kopii w naszej bazie: parametry, "
    + "lista „Pasuje do” i początek opisu. To słowa sprzedawcy, nie kartoteka."),
];

const dostepnosc = (ile: number, jednostka: string | null) =>
  ile > 0 ? `dostępne dziś: ${ile} ${jednostka ?? "szt."}` : "dziś brak na stanie";

/** Tekst z bazy → wynik z sufitem. Ucięcie mówi o sobie, żeby model nie wziął reszty za brak. */
function wynik(linie: string[]): WynikNarzedzia {
  const t = linie.join("\n");
  if (t.length <= SUFIT_WYNIKU) return t as WynikNarzedzia;
  return `${t.slice(0, SUFIT_WYNIKU)}\n[…wynik ucięty — zawęź zapytanie]` as WynikNarzedzia;
}

function towarPoSymbolu(subiekt: SubiektAdapter, symbol: string) {
  const s = symbol.trim();
  if (!s) return undefined;
  return subiekt.getProductBySymbol(s) ?? subiekt.getProductBySymbol(s.toUpperCase());
}

const brakSymbolu = (symbol: string) => wynik([
  `Nie mamy kartoteki o symbolu „${symbol}”. Jeśli to numer części albo nazwa, użyj szukaj_towaru.`,
]);

function szukajTowaru(subiekt: SubiektAdapter, fraza: string, database: DatabaseSync): WynikNarzedzia {
  const poNumerze = szukajPoIdentyfikatorze(fraza, database);
  const widziane = new Set<number>();
  const linie: string[] = [];
  /* Numer części najpierw: trafienie po OEM mówi „ten numer stoi w tej
     kartotece" i to jest mocniejsze niż podobieństwo nazwy. */
  for (const i of poNumerze) {
    if (widziane.has(i.twId) || widziane.size >= TRAFIEN) continue;
    widziane.add(i.twId);
    const karta = buildProductCard(subiekt, i.twId);
    linie.push(`${i.symbol} — ${karta?.name ?? i.nazwa ?? "?"} — numer ${i.wartosc} (${i.nazwaRodzaju}) — `
      + (karta ? dostepnosc(karta.mag.avail, karta.unit) : "brak karty"));
  }
  for (const r of subiekt.search(fraza, TRAFIEN)) {
    if (widziane.has(r.id) || widziane.size >= TRAFIEN) continue;
    widziane.add(r.id);
    const karta = buildProductCard(subiekt, r.id);
    linie.push(`${r.sym} — ${r.name} — ${karta ? dostepnosc(karta.mag.avail, karta.unit) : "brak karty"}`);
  }
  if (!linie.length) return wynik([`Nic w naszej kartotece nie pasuje do „${fraza}”.`]);
  return wynik([`Trafienia w naszej kartotece dla „${fraza}”:`, ...linie]);
}

function kartaTowaru(subiekt: SubiektAdapter, symbol: string, database: DatabaseSync): WynikNarzedzia {
  const t = towarPoSymbolu(subiekt, symbol);
  if (!t) return brakSymbolu(symbol);
  const k = buildProductCard(subiekt, t.tw_id);
  if (!k) return brakSymbolu(symbol);
  const linie = [`Kartoteka ${k.sym}: ${k.name}`];
  if (k.ean) linie.push(`EAN: ${k.ean}`);
  linie.push(dostepnosc(k.mag.avail, k.unit));
  const kiedy = kiedyBedzie(k);
  if (kiedy) linie.push(kiedy);
  if (k.identyfikatory.length) {
    linie.push("Numery: " + k.identyfikatory.map((i) => `${i.rodzaj} ${i.wartosc}`).join("; "));
  }
  if (k.zamienniki.znane.length) {
    linie.push("Zamienniki z kartoteki (mamy je): "
      + k.zamienniki.znane.map((z) => `${z.sym} ${z.name}`).join("; "));
  }
  if (k.zamienniki.obce.length) {
    linie.push("Zamienniki z opisu, których NIE mamy w kartotece: " + k.zamienniki.obce.join(", "));
  }
  const oem = zamiennicyOem(k.id, database);
  if (oem.length) {
    linie.push("Zatwierdzeni zamiennicy po wspólnym numerze OEM: "
      + oem.map((z) => `${z.kartoteka.symbol} ${z.kartoteka.nazwa}`).join("; "));
  }
  return wynik(linie);
}

/* Zastosowanie jednym wierszem, ze znacznikiem na przodzie. Warunki idą
   w tym samym wierszu, bo „pasuje od 2014" bez roku to inne zdanie. */
const wierszZastosowania = (z: Zastosowanie, przod: string) =>
  `[${z.stan === "zatwierdzone" ? "WZ" : "WP"}${z.id}] ${przod}`
  + (z.zdanieWarunkow ? ` (${z.zdanieWarunkow})` : "")
  + (z.zdaniePowodu && z.polaryzacja === "nie_pasuje" ? ` — ${z.zdaniePowodu}` : "")
  + ` — ${z.zdanieZrodla}`;

function pasowanieTowaru(subiekt: SubiektAdapter, symbol: string, database: DatabaseSync): WynikNarzedzia {
  const t = towarPoSymbolu(subiekt, symbol);
  if (!t) return brakSymbolu(symbol);
  const z = zastosowaniaTowaru(t.tw_id, database);
  const p = pasowaniaTowaru(t.tw_id, database);
  const linie = [`Pasowanie kartoteki ${t.symbol}:`];
  linie.push(z.potwierdzone.length ? "PASUJE (zatwierdzone):" : "PASUJE: nic nie zatwierdzono.");
  for (const x of z.potwierdzone) linie.push(wierszZastosowania(x, x.model.etykieta));
  if (z.negatywne.length) linie.push("NIE PASUJE (zatwierdzone):");
  for (const x of z.negatywne) linie.push(wierszZastosowania(x, x.model.etykieta));
  /* Propozycje stoją osobno i mówią o sobie wprost. To kolejka dla
     człowieka — także ta z sieci, którą składa automat nocny. */
  if (z.propozycje.length) linie.push("PROPOZYCJE — NIEZATWIERDZONE, to nie są fakty:");
  for (const x of z.propozycje) {
    const link = x.dowody.find((d) => d.link)?.link;
    linie.push(wierszZastosowania(x, `${x.polaryzacja === "pasuje" ? "pasuje do" : "nie pasuje do"} `
      + x.model.etykieta) + (link ? ` — źródło: ${link}` : ""));
  }
  const pary = [...p.pasujeDo, ...p.pasujace];
  if (pary.length) linie.push("Współpracuje z częściami:");
  for (const x of pary) linie.push(`- ${x.zdanie}`);
  return wynik(linie);
}

function czesciDoMaszyny(fraza: string, database: DatabaseSync): WynikNarzedzia {
  const modele = szukajModeli(fraza, database);
  if (!modele.length) {
    return wynik([`W naszej bazie wiedzy nie ma maszyny ani silnika pasującego do „${fraza}”. `
      + "To znaczy: nie wiemy, nie: nic nie pasuje."]);
  }
  const linie: string[] = [];
  if (modele.length > MODELI) {
    linie.push(`Fraza pasuje do ${modele.length} modeli; rozwijam pierwsze ${MODELI}. `
      + `Pozostałe: ${modele.slice(MODELI).map((m) => m.etykieta).join("; ")}.`);
  }
  for (const m of modele.slice(0, MODELI)) {
    const z = zastosowaniaModelu(m.klucz, database);
    linie.push(`${m.etykieta}:`);
    if (!z.length) linie.push("  brak zatwierdzonych kartotek");
    for (const x of z) {
      linie.push("  " + wierszZastosowania(x,
        `${x.polaryzacja === "pasuje" ? "pasuje" : "NIE pasuje"}: ${x.symbol}`));
    }
  }
  return wynik(linie);
}

function czytajListe<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/* Z KOPII w naszej bazie, nie z Allegro. Treść dociąga `ulozSzkic` przy
   szkicu; tu nie ma prawa paść ani jedno żądanie, bo model wybiera, ile razy
   to narzędzie zawoła, a Allegro odcina za serie z jednego adresu. */
function trescOferty(subiekt: SubiektAdapter, symbol: string, database: DatabaseSync): WynikNarzedzia {
  const t = towarPoSymbolu(subiekt, symbol);
  if (!t) return brakSymbolu(symbol);
  const oferty = database.prepare(`SELECT s.external_id AS id, s.nazwa, s.opis, s.parametry_json, s.pasuje_do_json
      FROM offer_snapshot s
      LEFT JOIN oferta_kartoteka k ON k.channel_account_id=s.channel_account_id AND k.offer_id=s.external_id
     WHERE k.tw_id=? OR (k.tw_id IS NULL AND s.sku IS NOT NULL AND UPPER(TRIM(s.sku))=UPPER(?))
     ORDER BY s.tresc_synced_at IS NULL, s.external_id LIMIT 3`)
    .all(t.tw_id, t.symbol) as Array<{ id: string; nazwa: string; opis: string | null;
      parametry_json: string | null; pasuje_do_json: string | null }>;
  if (!oferty.length) return wynik([`Nie mamy w bazie oferty powiązanej z ${t.symbol}.`]);
  const linie: string[] = [];
  for (const o of oferty) {
    linie.push(`Oferta ${o.id}: ${o.nazwa}`);
    const par = czytajListe<{ nazwa: string; wartosci: string[] }>(o.parametry_json);
    if (par.length) linie.push("Parametry: " + par.map((p) => `${p.nazwa}: ${p.wartosci.join(", ")}`).join("; "));
    const lista = czytajListe<string>(o.pasuje_do_json);
    if (lista.length) {
      linie.push(`Pasuje do (lista sprzedawcy, ${lista.length} poz.): ${lista.slice(0, ZGODNOSCI).join(" | ")}`);
    }
    const opis = (o.opis ?? "").trim();
    if (opis) linie.push(`Opis: ${opis.slice(0, OPISU)}${opis.length > OPISU ? " […]" : ""}`);
    if (!par.length && !lista.length && !opis) linie.push("Treści tej oferty jeszcze nie pobrano.");
  }
  return wynik(linie);
}

/**
 * Zestaw narzędzi dla jednego wywołania. Wykonanie nigdy nie rzuca: błąd
 * wraca do modelu jako `is_error`, bo wywrócone dopytanie kosztuje agenta
 * więcej niż odpowiedź bez jednego sprawdzenia.
 */
export function zestawNarzedzi(subiekt: SubiektAdapter, database: DatabaseSync = db()): ZestawNarzedzi {
  return {
    definicje: DEFINICJE,
    wykonaj(nazwa, wejscie) {
      const q = String((wejscie as { zapytanie?: unknown } | null)?.zapytanie ?? "").trim().slice(0, 120);
      if (!zwin(q)) return { wynik: "Puste zapytanie." as WynikNarzedzia, blad: true };
      try {
        switch (nazwa) {
          case "szukaj_towaru": return { wynik: szukajTowaru(subiekt, q, database), blad: false };
          case "karta_towaru": return { wynik: kartaTowaru(subiekt, q, database), blad: false };
          case "pasowanie_towaru": return { wynik: pasowanieTowaru(subiekt, q, database), blad: false };
          case "czesci_do_maszyny": return { wynik: czesciDoMaszyny(q, database), blad: false };
          case "tresc_oferty": return { wynik: trescOferty(subiekt, q, database), blad: false };
          default: return { wynik: `Nie ma narzędzia „${nazwa}”.` as WynikNarzedzia, blad: true };
        }
      } catch (e) {
        return { wynik: `Narzędzie się wywróciło: ${(e as Error).message.slice(0, 200)}` as WynikNarzedzia, blad: true };
      }
    },
  };
}

/** Znacznik niezatwierdzonej propozycji w odwołaniu twierdzenia. */
const ZNACZNIK_PROPOZYCJI = /\bWP\d+\b/;

/**
 * Twierdzenie oparte na PROPOZYCJI schodzi do „niepewne". Propozycja czeka
 * na człowieka — także ta z sieci — więc model, który powoła się na nią jak
 * na bazę, dostałby sufit „pewne" za cudzą niezatwierdzoną tezę.
 */
export function naPropozycjiNiepewne<T extends { odwolanie: string | null; pewnosc: string; obnizona?: boolean }>(
  tw: T[],
): T[] {
  return tw.map((t) => t.odwolanie && ZNACZNIK_PROPOZYCJI.test(t.odwolanie) && t.pewnosc !== "niepewne"
    ? { ...t, pewnosc: "niepewne", obnizona: true }
    : t);
}
