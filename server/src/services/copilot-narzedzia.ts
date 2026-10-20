import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { buildProductCard } from "./stock.js";
import { kiedyBedzie } from "./copilot-szkic.js";
import { szukajPoIdentyfikatorze } from "./identyfikatory.js";
import { zloz, zwin } from "../tekst.js";
import { linkOferty } from "./allegro-linki.js";
import { ofertyPoSygnaturze, type LinkDoOferty } from "./allegro-oferty-po-sygnaturze.js";
import { kandydaciZamiennikow } from "./zamienniki.js";
import type { RawProduct } from "../adapters/subiekt.js";

/* ── Narzędzia Copilota: model sam sięga do bazy ────────────────────────────

   Fakty szkicu to tylko to, co `kontekstSzkicu` położył na stole. Agent
   dopytuje często o towar spoza nich, a odpowiedź leży w bazie, obok.
   Dlatego model dostaje NARZĘDZIA i sam decyduje, o co zapytać. Każde jest:

   - BEZ ZAPISU DO NASZYCH DANYCH I BEZ WYSYŁKI. Żadne nie zmienia sprawy,
     rozmowy, kartoteki ani kolejek i niczego nie wysyła. To twarda granica
     pliku, nie zwyczaj: model wybiera wywołania, więc jedno narzędzie
     z zapisem dawałoby mu prawo zapisu.
   - LOKALNE, Z JEDNYM WYJĄTKIEM SIECIOWYM. Subiekt czytamy z lokalnego
     odczytu `sgt_*`, nie na żywo. Jedyne żądanie to ODCZYT naszych aktywnych
     ofert Allegro po sygnaturze w `oferty_towaru`, tą samą funkcją co fakty
     szkicu. Powód, decyzją właściciela: szkic ma od razu nieść link, a kopia
     ofert zna tylko aukcje, pod którymi ktoś pisał. W żądaniu idzie sam
     symbol kartoteki, nic o kliencie. Sufit to jedno żądanie na wywołanie,
     a ten sam symbol w jednym zestawie pytamy raz.
     Skutek uboczny nazywamy wprost: `ofertyPoSygnaturze` zapisuje snapshot
     znalezionej oferty przez jedynego pisarza `zapiszSnapshotOferty`. To kopia
     naszej aukcji, nie dane sprawy, i ten sam zapis robi już szkic.
   - O NASZYM TOWARZE, nie o kliencie. Historii zakupów i profilu klienta tu
     nie ma, z tego samego powodu co w faktach szkicu (§14.4). Nie ma też
     półki ani opisu kartoteki w całości (§10.4 — opis bywa notatką magazynu).
   - UCIĘTE. Wynik ma sufit znaków, bo każdy wraca do modelu w następnej
     rundzie i płaci się za niego przy każdej kolejnej.
   - CENY SPRZEDAŻY TAK, ZAKUPU NIGDY. Ceny poziomów sprzedaży i nasze
     aktywne oferty wolno pokazać, bo szkic podaje je klientowi. Poziom 0
     to cena zakupu i nie wychodzi z tego pliku; `cenySprzedazy` jest
     jedynym miejscem czytającym ceny, a pilnuje tego test obok.          */

/** Wynik narzędzia. Rodzi się WYŁĄCZNIE tutaj, z naszej kartoteki i naszych ofert. */
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
  /** Asynchroniczne, bo `oferty_towaru` umie zapytać Allegro, gdy kopia nie zna oferty. */
  wykonaj(nazwa: string, wejscie: unknown): Promise<{ wynik: WynikNarzedzia; blad: boolean }>;
}

/** Odczyt ofert po sygnaturze. Wstrzykiwany, żeby żaden test nie strzelał do Allegro. */
export type OfertyPoSygnaturze = (symbole: readonly string[]) => Promise<Map<string, LinkDoOferty>>;

export interface ZaleznosciNarzedzi {
  ofertyPoSygnaturze?: OfertyPoSygnaturze;
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
    + "Gdy kopia w bazie nie zna oferty, sprawdza Allegro teraz. Użyj dla każdej kartoteki, "
    + "którą proponujesz klientowi, i gdy chcesz podać link do naszej aukcji albo cenę."),
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

/* ── Podział łańcucha zapisany na kilka sposobów ────────────────────────────
   Kartoteka pisze ten sam podział jako „3/8''”, „3/8lp” albo „3/8P”, a klient
   i model jeszcze inaczej. Wyszukiwarka tnie frazę na słowa, więc „8lp” nie
   trafia w nazwę z „8''” i odwrotnie. Przez to model nie widział łańcucha
   11103 („3/8lp”) obok MF381356 („3/8''”), choć to ta sama długość.

   Granica: „3/8” bez LP i „3/8 LP” (Picco) to fizycznie RÓŻNE łańcuchy.
   Dlatego tylko poszerzamy wyszukiwanie, a wynik zostawia pełne nazwy
   i mówi wprost, że rozstrzyga zapis w nazwie. Nie zgadujemy niczego spoza
   kartoteki. Przedrostek i przyrostek pilnują, żeby „13/8” i „3/80” nie
   były podziałem, a „3/8 piły” nie zjadało słowa. */
const PODZIAL = /(?<![\d.,/])3\s*\/\s*8(?!\d)(?:\s*(?:'{1,2}|"|”|″|lp\b|p\b))?/gi;

const OSTRZEZENIE_PODZIALU = "Podział zapisany różnie (3/8, 3/8lp, 3/8P): sprawdź w nazwie, "
  + "czy to łańcuch 3/8 LP (Picco), czy pełny 3/8.";

/** Rodzaje zapisu podziału w tekście: „lp” dla LP i P (Picco), „pelny” dla reszty. */
function zapisyPodzialu(tekst: string): Set<"lp" | "pelny"> {
  const out = new Set<"lp" | "pelny">();
  for (const m of tekst.matchAll(PODZIAL)) out.add(/(?:lp|p)$/i.test(m[0]) ? "lp" : "pelny");
  return out;
}

/** Fraza z podziałem zapisanym gołym „3/8”, który jako słowa „3” i „8” trafia w każdy zapis. */
function frazaBezZapisuPodzialu(fraza: string): string | null {
  if (!zapisyPodzialu(fraza).size) return null;
  const gola = fraza.replace(PODZIAL, "3/8");
  return gola === fraza ? null : gola;
}

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
  /* Fraza w zapisie pytającego idzie pierwsza, więc jej trafienia stoją na
     górze. Goły zapis podziału dokłada resztę zapisów, do wspólnego sufitu. */
  const gola = frazaBezZapisuPodzialu(fraza);
  for (const f of gola ? [fraza, gola] : [fraza]) {
    for (const r of subiekt.search(f, TRAFIEN)) {
      if (widziane.has(r.id) || widziane.size >= TRAFIEN) continue;
      widziane.add(r.id);
      const karta = buildProductCard(subiekt, r.id);
      linie.push(`${r.sym} — ${r.name} — ${karta ? dostepnosc(karta.mag.avail, karta.unit) : "brak karty"}`);
    }
  }
  /* „Nie znaleźliśmy”, nie „nie pasuje”: wyszukiwanie zna nasze nazwy i numery,
     nie wszystkie zamienniki, więc pusty wynik to brak wiedzy, nie dowód. */
  if (!linie.length) {
    return wynik([`Nie znaleźliśmy w naszej kartotece „${fraza}”. To nie znaczy, że takiej części nie ma.`]);
  }
  const ostrzezenie = zapisyPodzialu(fraza).size ? [OSTRZEZENIE_PODZIALU] : [];
  return wynik([`Trafienia w naszej kartotece dla „${fraza}”:`, ...linie, ...ostrzezenie]);
}

/* ── Nasze zamienniki zapisane w opisie obcym numerem ───────────────────────
   Opis kartoteki wymienia zamienniki numerami z katalogów, np. „G74040 //
   S11103”. Parser zamienników (`zamienniki.ts`) bierze tylko tokeny równe
   naszemu symbolowi, a bez etykiety żąda dwóch trafień. Przez to karta
   MF381356 milczała o naszej kartotece 11103, choć opis wskazuje ją jako
   „S11103”. Tu rozwiązujemy tokeny opisu na NASZE kartoteki trzema drogami:

   1. token jest naszym symbolem;
   2. token to jedna litera przedrostka producenta i co najmniej cztery cyfry,
      a same cyfry są naszym symbolem („S11103” → „11103”);
   3. ten sam numer stoi w innej kartotece w `towar_identyfikator`.

   Granica: każde trafienie musi mieć to samo pierwsze słowo nazwy, czyli ten
   sam rodzaj towaru. Bez tego cyfry z listy modeli trafiłyby w przypadkową
   kartotekę. Wynik nazywa się „z opisu” i niesie token, z którego wyszedł,
   bo to słabsze świadectwo niż zamiennik zapisany naszym symbolem. */

/** Ile tokenów opisu sprawdzamy. Zapora na opis-listę modeli. */
const TOKENOW_OPISU = 20;
/** Ile naszych zamienników z opisu pokazujemy. Dalsze to już katalog, nie odpowiedź. */
const ZAMIENNIKOW_Z_OPISU = 5;
const PRZEDROSTEK_PRODUCENTA = /^[A-Za-z](\d{4,})$/;

/** Pierwsze słowo nazwy bez ogonków: „Łańcuch do piły…” → „lancuch”. */
const rodzajTowaru = (nazwa: string) => zloz(nazwa).match(/[a-z]{3,}/)?.[0] ?? null;

interface ZamiennikZOpisu { twId: number; sym: string; nazwa: string; token: string }

function naszeZamiennikiZOpisu(
  subiekt: SubiektAdapter, database: DatabaseSync, t: RawProduct, juzZnane: ReadonlySet<string>,
): ZamiennikZOpisu[] {
  const rodzaj = rodzajTowaru(t.nazwa);
  if (!rodzaj || !t.opis) return [];
  const tokeny = kandydaciZamiennikow(t.opis, t.symbol)
    .filter((k) => /\d/.test(k) && !/\s/.test(k))
    .slice(0, TOKENOW_OPISU);
  if (!tokeny.length) return [];

  /* Drogi 1 i 2 jednym zapytaniem do kartoteki. Pytamy zapisem z opisu,
     a token odnajdujemy po formie zwiniętej symbolu, który wrócił. */
  const zToken = new Map<string, string>();
  const pytane = new Set<string>();
  for (const tok of tokeny) {
    const cyfry = PRZEDROSTEK_PRODUCENTA.exec(tok)?.[1];
    for (const s of cyfry ? [tok, cyfry] : [tok]) {
      pytane.add(s);
      if (!zToken.has(zwin(s))) zToken.set(zwin(s), tok);
    }
  }
  const kandydaci: ZamiennikZOpisu[] = subiekt.getProductsBySymbols([...pytane])
    .flatMap((r) => {
      const token = zToken.get(zwin(r.sym));
      return token ? [{ twId: r.id, sym: r.sym, nazwa: r.name, token }] : [];
    })
    .sort((a, b) => tokeny.indexOf(a.token) - tokeny.indexOf(b.token));
  /* Droga 3: numer z opisu zapisany w innej kartotece. */
  for (const tok of tokeny) {
    for (const i of szukajPoIdentyfikatorze(tok, database)) {
      kandydaci.push({ twId: i.twId, sym: i.symbol, nazwa: i.nazwa ?? "", token: tok });
    }
  }

  const wlasny = zwin(t.symbol);
  const widziane = new Set<string>();
  const out: ZamiennikZOpisu[] = [];
  for (const k of kandydaci) {
    const klucz = zwin(k.sym);
    if (klucz === wlasny || juzZnane.has(klucz) || widziane.has(klucz)) continue;
    if (rodzajTowaru(k.nazwa) !== rodzaj) continue;
    widziane.add(klucz);
    out.push(k);
    if (out.length >= ZAMIENNIKOW_Z_OPISU) break;
  }
  return out;
}

function kartaTowaru(subiekt: SubiektAdapter, symbol: string, database: DatabaseSync): WynikNarzedzia {
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
  const nasze = naszeZamiennikiZOpisu(subiekt, database, t,
    new Set(k.zamienniki.znane.map((z) => zwin(z.sym))));
  if (nasze.length) {
    linie.push("Nasze zamienniki z opisu: " + nasze.map((z) => {
      const kz = buildProductCard(subiekt, z.twId);
      return `${z.sym} — ${z.nazwa} — ${kz ? dostepnosc(kz.mag.avail, kz.unit) : "brak karty"} (w opisie: ${z.token})`;
    }).join("; "));
  }
  if (k.zamienniki.obce.length) {
    linie.push("Zamienniki z opisu, których NIE mamy w kartotece: " + k.zamienniki.obce.join(", "));
  }
  /* Karta z zamiennikiem w innym zapisie podziału niesie to samo ostrzeżenie
     co wyszukiwanie: model widzi obie nazwy i ma je porównać, nie zrównać. */
  const nazwy = [k.name, ...k.zamienniki.znane.map((z) => z.name), ...nasze.map((z) => z.nazwa)];
  const zapisy = new Set(nazwy.flatMap((n) => [...zapisyPodzialu(n)]));
  if (zapisy.size > 1) linie.push(OSTRZEZENIE_PODZIALU);
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

/* Treść oferty idzie wyłącznie z KOPII w naszej bazie. Dociąga ją `ulozSzkic`
   przy szkicu; `tresc_oferty` nie pyta Allegro wcale, bo model wybiera, ile
   razy je zawoła, a Allegro odcina za serie z jednego adresu. Wyjątkiem
   sieciowym jest tylko link w `oferty_towaru` (nagłówek pliku). */
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

const cenaTekstem = (grosze: number | null | undefined, waluta: string | null | undefined) =>
  grosze != null && grosze > 0 ? `${zl(grosze)} ${!waluta || waluta === "PLN" ? "zł" : waluta}` : "cena nieznana";

/* Najpierw kopia w bazie, bo nic nie kosztuje. Kopia zna tylko aukcje, pod
   którymi ktoś napisał albo które synchronizacja zebrała, więc przy jej
   braku pytamy Allegro jednym żądaniem po sygnaturze (nagłówek pliku). */
async function ofertyTowaru(
  subiekt: SubiektAdapter, symbol: string, database: DatabaseSync,
  naZywo: (symbol: string) => Promise<LinkDoOferty | null>,
): Promise<WynikNarzedzia> {
  const t = towarPoSymbolu(subiekt, symbol);
  if (!t) return brakSymbolu(symbol);
  const oferty = ofertyKartoteki(database, t.tw_id, t.symbol, { tylkoAktywne: true, limit: OFERT });
  if (!oferty.length) {
    const z = await naZywo(t.symbol);
    if (z) {
      return wynik([`Nasza aktywna oferta dla ${t.symbol} (kopia w bazie jej nie znała):`,
        `${z.link} — ${z.nazwa} — ${cenaTekstem(z.cenaGrosze, z.waluta)} (stan z Allegro teraz)`]);
    }
    /* Błąd, limit, brak konta i pusta odpowiedź mówią to samo. Odpowiedź
       Allegro też bywa niepełna, choćby przy sygnaturze wpisanej inaczej niż
       symbol, więc zdanie nie pozwala modelowi napisać, że oferty nie ma. */
    return wynik(["W naszej kopii nie ma aktywnej oferty tego towaru. To nie znaczy, że jej nie ma."]);
  }
  return wynik([`Nasze aktywne oferty dla ${t.symbol}:`, ...oferty.map((o) => {
    const cena = cenaTekstem(o.cena_grosze, o.waluta);
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
export function zestawNarzedzi(
  subiekt: SubiektAdapter, database: DatabaseSync = db(), zalezne: ZaleznosciNarzedzi = {},
): ZestawNarzedzi {
  const pytaj: OfertyPoSygnaturze = zalezne.ofertyPoSygnaturze
    ?? ((symbole) => ofertyPoSygnaturze(symbole, { database }));
  /* Pamięć na czas jednego zestawu, czyli jednego szkicu albo dopytania.
     Model potrafi zapytać o ten sam symbol w kolejnej rundzie, a drugie
     żądanie oddałoby to samo. Trzymamy obietnicę, więc dwa wywołania w jednej
     rundzie też pytają raz. Błąd zamienia się w „nie wiemy”, nie w wyjątek. */
  const pamiec = new Map<string, Promise<LinkDoOferty | null>>();
  const naZywo = (symbol: string): Promise<LinkDoOferty | null> => {
    const klucz = zwin(symbol);
    let p = pamiec.get(klucz);
    if (!p) {
      p = Promise.resolve()
        .then(() => pytaj([symbol]))
        .then((m) => m.get(klucz) ?? null, () => null);
      pamiec.set(klucz, p);
    }
    return p;
  };
  return {
    definicje: DEFINICJE,
    async wykonaj(nazwa, wejscie) {
      const q = String((wejscie as { zapytanie?: unknown } | null)?.zapytanie ?? "").trim().slice(0, 120);
      if (!zwin(q)) return { wynik: "Puste zapytanie." as WynikNarzedzia, blad: true };
      try {
        switch (nazwa) {
          case "szukaj_towaru": return { wynik: szukajTowaru(subiekt, q, database), blad: false };
          case "karta_towaru": return { wynik: kartaTowaru(subiekt, q, database), blad: false };
          case "tresc_oferty": return { wynik: trescOferty(subiekt, q, database), blad: false };
          case "oferty_towaru": return { wynik: await ofertyTowaru(subiekt, q, database, naZywo), blad: false };
          default: return { wynik: `Nie ma narzędzia „${nazwa}”.` as WynikNarzedzia, blad: true };
        }
      } catch (e) {
        return { wynik: `Narzędzie się wywróciło: ${(e as Error).message.slice(0, 200)}` as WynikNarzedzia, blad: true };
      }
    },
  };
}
