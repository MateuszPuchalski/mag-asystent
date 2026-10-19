import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { buildProductCard } from "./stock.js";
import { kiedyBedzie } from "./copilot-szkic.js";
import { szukajPoIdentyfikatorze } from "./identyfikatory.js";
import { zwin } from "../tekst.js";
import { linkOferty } from "./allegro-linki.js";

/* ── Narzędzia Copilota: model sam sięga do bazy (0.507.0) ──────────────────

   Fakty szkicu to tylko to, co `kontekstSzkicu` położył na stole. Agent
   dopytuje często o towar spoza nich, a odpowiedź leży w bazie, obok.
   Dlatego model dostaje NARZĘDZIA i sam decyduje, o co zapytać. Każde jest:

   - TYLKO DO ODCZYTU. Żadne nie pisze, nie wysyła i nie woła sieci — ani
     Allegro, ani Subiekta na żywo (adapter czyta lokalny odczyt `sgt_*`).
     To jest twarda granica tego pliku, nie zwyczaj: model wybiera wywołania,
     więc jedno narzędzie z zapisem dawałoby mu prawo zapisu.
   - O NASZYM TOWARZE, nie o kliencie. Historii zakupów i profilu klienta tu
     nie ma, z tego samego powodu co w faktach szkicu (§14.4). Nie ma też
     półki ani opisu kartoteki w całości (§10.4 — opis bywa notatką magazynu).
   - UCIĘTE. Wynik ma sufit znaków, bo każdy wraca do modelu w następnej
     rundzie i płaci się za niego przy każdej kolejnej.
   - CENY SPRZEDAŻY TAK, ZAKUPU NIGDY. Ceny poziomów sprzedaży i nasze
     aktywne oferty wolno pokazać, bo szkic podaje je klientowi. Poziom 0
     to cena zakupu i nie wychodzi z tego pliku; `cenySprzedazy` jest
     jedynym miejscem czytającym ceny, a pilnuje tego test obok.          */

/** Wynik narzędzia. Rodzi się WYŁĄCZNIE tutaj, z naszej kartoteki i kopii ofert. */
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

/**
 * Wynik jednego wywołania z numerem `N#`. Treść zostaje przy szkicu, bo
 * serwis sprawdza nią numery i odwołania, tak jak sprawdza faktami `F#`.
 */
export interface WynikWywolania {
  id: string;
  nazwa: string;
  argument: string;
  tresc: string;
}

/** Sufit znaków jednego wyniku. Cztery tysiące to kilkanaście kartotek. */
export const SUFIT_WYNIKU = 4000;
/** Ile trafień zwraca wyszukiwanie. Więcej i tak nie przeczyta nikt. */
const TRAFIEN = 8;
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
    + "zamówienia u dostawcy przy braku i zamienniki z kartoteki."),
  argument("tresc_oferty",
    "Treść naszych ofert Allegro dla kartoteki o danym symbolu, z kopii w naszej bazie: parametry, "
    + "lista „Pasuje do” i początek opisu. To słowa sprzedawcy, nie kartoteka."),
  /* Na końcu, bo dopisane później: wcześniejsze definicje zostają w prefiksie cache. */
  argument("oferty_towaru",
    "Nasze AKTYWNE oferty Allegro dla kartoteki o danym symbolu: adres aukcji, tytuł i cena. "
    + "Użyj, gdy chcesz podać klientowi link do naszej aukcji albo cenę, za którą sprzedajemy."),
];

/** Ile aktywnych ofert pokazuje `oferty_towaru`. Więcej linków klient i tak nie kliknie. */
const OFERT = 5;

/** Grosze na złote z przecinkiem, jak pisze się cenę klientowi. */
const zl = (grosze: number) => (grosze / 100).toFixed(2).replace(".", ",");

/**
 * Cennik sprzedaży kartoteki. JEDYNE miejsce w pliku, które czyta `karta.ceny`.
 * Poziom 0 to cena zakupu: zdradza naszą marżę, więc nie wychodzi do modelu,
 * a stąd do klienta. Zerowa albo brakująca kwota znaczy „nie wiemy”, nie „za darmo”.
 */
export function cenySprzedazy(
  karta: { ceny?: Array<{ poziom: number; nazwa: string; bruttoGrosze: number | null }> },
): string | null {
  const ceny = (karta.ceny ?? [])
    .filter((c) => c.poziom !== 0 && c.bruttoGrosze != null && c.bruttoGrosze > 0);
  if (!ceny.length) return null;
  return "Cennik sklepu (kartoteka): "
    + ceny.map((c) => `${c.nazwa.trim() || `poziom ${c.poziom}`} ${zl(c.bruttoGrosze!)} zł brutto`).join("; ");
}

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
  /* „Nie znaleźliśmy”, nie „nie pasuje”: wyszukiwanie zna nasze nazwy i numery,
     nie wszystkie zamienniki, więc pusty wynik to brak wiedzy, nie dowód. */
  if (!linie.length) {
    return wynik([`Nie znaleźliśmy w naszej kartotece „${fraza}”. To nie znaczy, że takiej części nie ma.`]);
  }
  return wynik([`Trafienia w naszej kartotece dla „${fraza}”:`, ...linie]);
}

function kartaTowaru(subiekt: SubiektAdapter, symbol: string): WynikNarzedzia {
  const t = towarPoSymbolu(subiekt, symbol);
  if (!t) return brakSymbolu(symbol);
  const k = buildProductCard(subiekt, t.tw_id);
  if (!k) return brakSymbolu(symbol);
  const linie = [`Kartoteka ${k.sym}: ${k.name}`];
  if (k.ean) linie.push(`EAN: ${k.ean}`);
  linie.push(dostepnosc(k.mag.avail, k.unit));
  const cennik = cenySprzedazy(k);
  if (cennik) linie.push(cennik);
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
interface OfertaKartoteki {
  id: string; nazwa: string; opis: string | null;
  parametry_json: string | null; pasuje_do_json: string | null;
  cena_grosze: number | null; waluta: string | null; synced_at: string | null;
}

/* Jedno powiązanie oferty z kartoteką dla obu narzędzi: wskazanie ręczne
   w `oferta_kartoteka`, a bez niego SKU równe symbolowi. Dwie kopie tego
   warunku rozjechałyby się i model widziałby treść innej oferty niż link. */
function ofertyKartoteki(
  database: DatabaseSync, twId: number, symbol: string, o: { tylkoAktywne: boolean; limit: number },
): OfertaKartoteki[] {
  return database.prepare(`SELECT s.external_id AS id, s.nazwa, s.opis, s.parametry_json, s.pasuje_do_json,
        s.cena_grosze, s.waluta, s.synced_at
      FROM offer_snapshot s
      LEFT JOIN oferta_kartoteka k ON k.channel_account_id=s.channel_account_id AND k.offer_id=s.external_id
     WHERE (k.tw_id=? OR (k.tw_id IS NULL AND s.sku IS NOT NULL AND UPPER(TRIM(s.sku))=UPPER(?)))
       ${o.tylkoAktywne ? "AND s.status='ACTIVE'" : ""}
     ORDER BY s.tresc_synced_at IS NULL, s.external_id LIMIT ?`)
    .all(twId, symbol, o.limit) as unknown as OfertaKartoteki[];
}

/* Z kopii w bazie, jak treść oferty: link i cenę model może chcieć dla
   każdej kartoteki z rozmowy, a seria żądań do Allegro skończyłaby się odcięciem. */
function ofertyTowaru(subiekt: SubiektAdapter, symbol: string, database: DatabaseSync): WynikNarzedzia {
  const t = towarPoSymbolu(subiekt, symbol);
  if (!t) return brakSymbolu(symbol);
  const oferty = ofertyKartoteki(database, t.tw_id, t.symbol, { tylkoAktywne: true, limit: OFERT });
  /* Kopia zna tylko aukcje, pod którymi ktoś napisał albo które synchronizacja
     zebrała, i bywa sprzed doby. Pusty wynik mówi to wprost, żeby model nie
     napisał klientowi, że oferty nie ma. */
  if (!oferty.length) {
    return wynik(["W naszej kopii nie ma aktywnej oferty tego towaru. To nie znaczy, że jej nie ma."]);
  }
  return wynik([`Nasze aktywne oferty dla ${t.symbol}:`, ...oferty.map((o) => {
    const cena = o.cena_grosze != null && o.cena_grosze > 0
      ? `${zl(o.cena_grosze)} ${!o.waluta || o.waluta === "PLN" ? "zł" : o.waluta}` : "cena nieznana";
    /* Data kopii przy każdej ofercie: cena i status mogły się zmienić od tej chwili. */
    const kopia = o.synced_at ? `stan z kopii z ${o.synced_at.slice(0, 10)}` : "data kopii nieznana";
    return `${linkOferty(o.id) ?? `oferta ${o.id}`} — ${o.nazwa} — ${cena} (${kopia})`;
  })]);
}

function trescOferty(subiekt: SubiektAdapter, symbol: string, database: DatabaseSync): WynikNarzedzia {
  const t = towarPoSymbolu(subiekt, symbol);
  if (!t) return brakSymbolu(symbol);
  const oferty = ofertyKartoteki(database, t.tw_id, t.symbol, { tylkoAktywne: false, limit: 3 });
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
          case "karta_towaru": return { wynik: kartaTowaru(subiekt, q), blad: false };
          case "tresc_oferty": return { wynik: trescOferty(subiekt, q, database), blad: false };
          case "oferty_towaru": return { wynik: ofertyTowaru(subiekt, q, database), blad: false };
          default: return { wynik: `Nie ma narzędzia „${nazwa}”.` as WynikNarzedzia, blad: true };
        }
      } catch (e) {
        return { wynik: `Narzędzie się wywróciło: ${(e as Error).message.slice(0, 200)}` as WynikNarzedzia, blad: true };
      }
    },
  };
}
