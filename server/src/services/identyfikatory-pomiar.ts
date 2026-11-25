import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { ciagiNumerow, zwin } from "../tekst.js";
import { dosycCyfr, rodzajEtykiety } from "./identyfikatory.js";
import { ETYKIETA_ZESTAWU, KONIEC_SEKCJI } from "./opis-sekcje.js";

/* ── Pomiar parsera identyfikatorów ─────────────────────────────────────────
   Klient podaje numer z tabliczki i pyta, czy część pasuje. Numer, którego
   parser nie wyczytał z opisu, to pytanie bez odpowiedzi albo odpowiedź
   zgadnięta przez model. Ten plik liczy, ile numerów zostaje w opisach poza
   tabelą `towar_identyfikator` i SKĄD pochodzą, żeby poprawki parsera szły
   za liczbą, a nie za wrażeniem.

   WYŁĄCZNIE ODCZYT. Ani jednego INSERT-a i ani jednego `logEvent`: pomiar
   wolno puścić na bazie magazynu przy żywej usłudze i puścić dwa razy.

   Miarą jest TABELA, nie parser uruchomiony drugi raz. Liczy się to, co
   szukanie po numerze naprawdę znajdzie, razem z wpisami ręcznymi biura.

   Raport niesie symbole kartotek i numery z ich opisów. Danych klientów
   w kartotece towarów nie ma, więc raport wolno wkleić do rozmowy. */

/** Dlaczego ciąg w kształcie numeru raczej NIE jest numerem części. */
export type RodzajSzumu =
  | "gwint" | "wymiar" | "jednostka" | "rok" | "urywek" | "krotka_liczba"
  | "model_maszyny" | "zepsuta_liczba";

export const NAZWA_SZUMU: Record<RodzajSzumu, string> = {
  gwint: "gwint (`M10x1`)",
  wymiar: "wymiar (`25x47x7`)",
  jednostka: "liczba z jednostką (`48cm`, `500ml`)",
  rok: "rok (`2014`)",
  urywek: "urywek numeru pisanego ze spacjami (`56-30`)",
  krotka_liczba: "sama liczba do 4 cyfr: seria, model albo ilość (`5200`)",
  model_maszyny: "model maszyny (`MS170`, `GX160`, `240R`, sekcja `Modele:`)",
  zepsuta_liczba: "liczba zepsuta przez arkusz (`4.6e+23`)",
};

/** Skąd w opisie pochodzi ciąg, który nie trafił do tabeli. */
export type Pochodzenie =
  | "znana_etykieta" | "zestaw" | "nieznana_etykieta"
  | "sama_lista" | "lista_z_ukosnikami" | "proza";

export const NAZWA_POCHODZENIA: Record<Pochodzenie, string> = {
  znana_etykieta: "po etykiecie, którą parser czyta",
  zestaw: "zawartość zestawu (pomijana z decyzji)",
  nieznana_etykieta: "po etykiecie, której parser nie zna",
  sama_lista: "bez etykiety: opis to sama lista numerów",
  lista_z_ukosnikami: "bez etykiety: lista po `//` wśród słów",
  proza: "bez etykiety: numer w prozie",
};

export type KlasaCiagu = "wlasny" | "w_tabeli" | "nasz_symbol" | "poza_tabela";

export interface CiagOpisu {
  numer: string;
  klasa: KlasaCiagu;
  /** Tylko dla `poza_tabela`. */
  szum: RodzajSzumu | null;
  pochodzenie: Pochodzenie | null;
  /** Etykieta stojąca przed ciągiem, małymi literami i bez dwukropka. */
  etykieta: string | null;
  /** Spod znanej etykiety: czy odpadł na progu dwóch cyfr. */
  zaMaloCyfr: boolean;
}

/* ── Szum ────────────────────────────────────────────────────────────────────
   Kształt numeru łapie też wymiary, gwinty i modele maszyn. Bez tej reguły
   liczba „zgubionych numerów" byłaby zawyżona i nie nadawałaby się do decyzji.

   Reguła jest SZACUNKIEM i raport mówi to wprost. Modelu maszyny nie da się
   odróżnić od numeru części samym kształtem: `FS200` to kosa, `FTC272` to nasz
   symbol. Dlatego rodziny modeli są wypisane z nazwy, a nie zgadywane. */

const GWINT = /^M\d{1,2}x\d/i;
/* Cyfra, `x`, cyfra w dowolnym miejscu: `25x47x7`, `20x1594`, `TCT300X40`,
   `15x600-6`. W kartotece nie ma numeru części o takim kształcie. */
const WYMIAR = /\dx\d/i;
/* `A.418 B.18 D.65`: wymiary noża opisane literami. Kształt numeru ich nie
   łapie przez kropkę, ale parser czyta je z sekcji i trafiają do tabeli. */
const WYMIAR_LITEROWANY = /^[A-D]\.\d/;
/* Jednostki jednoliterowe świadomie odpadają: `34279A` i `1011G` to numery,
   a kształtem nie różnią się od „300 amperów". */
const JEDNOSTKA = /^\d+(?:mm|cm|kg|ml|kw|km|hp|cc|ah|szt|cali|cale|cal|og|psc|pcs|kpl|el)$/i;
const ROK = /^(?:19[89]\d|20[0-3]\d)$/;
/* `56-30` to końcówka `532 16 56-30`: kształt numeru nie obejmuje spacji,
   więc z zapisu Husqvarny widzi sam ogon. */
const URYWEK = /^\d{2}-\d{2}$/;
const KROTKA_LICZBA = /^\d{1,4}$/;
/* Rodziny modeli z opisów tej kartoteki: pilarki i kosy Stihla (`MS`, `FS`,
   `FC`, `FR`, `BG`, `BR`, `BT`, `HS`, `HT`, `KM`, `SH`, `SR`, `TS`, `MM`,
   `MB`), silniki Hondy (`GX`, `GXV`, `GCV`, `GC`), Makita i Dolmar (`DCS`,
   `PS`), kosiarki NAC i pokrewne (`LS`, `LE`, `MEX`, `RLM`, `SPS`, `CST`,
   `HKS`, `TC`). Po prefiksie stoją od razu cyfry. */
const MODEL_MASZYNY =
  /^(?:MS|FS|FC|FR|BG|BR|BT|HS|HT|KM|SH|SR|TS|MM|MB|GXV|GX|GCV|GC|DCS|PS|LS|LE|MEX|RLM|SPS|CST|HKS|TC)-?\d{2,4}(?![0-9])/i;
/* Trzy cyfry i jedna albo dwie litery: `240R`, `019T`, `346XP`, `168F`.
   Tak zapisują modele Husqvarna i Stihl, a numer części jest dłuższy. */
const MODEL_Z_LITERA = /^\d{3}[A-Z]{1,2}$/i;
/* Etykiety, po których stoją modele maszyn, nie numery części. */
const ETYKIETA_MODELI = /^(?:modele?|pasuje do|pasują do|do|silniki?|kosiarki|maszyny)$/;
/* `4.60303460773462e+23`: arkusz zamienił długi numer na liczbę. Numeru nie
   da się już odtworzyć, ale kartotekę warto pokazać biuru. */
const ZEPSUTA_LICZBA = /^\d\.\d+e\+\d+$/i;

export function rodzajSzumu(numer: string, slowo: string, etykieta: string | null): RodzajSzumu | null {
  if (ZEPSUTA_LICZBA.test(slowo)) return "zepsuta_liczba";
  if (GWINT.test(numer)) return "gwint";
  if (WYMIAR.test(numer) || WYMIAR_LITEROWANY.test(numer)) return "wymiar";
  if (JEDNOSTKA.test(numer)) return "jednostka";
  if (ROK.test(numer)) return "rok";
  if (URYWEK.test(numer)) return "urywek";
  if (KROTKA_LICZBA.test(numer)) return "krotka_liczba";
  if (etykieta !== null && ETYKIETA_MODELI.test(etykieta)) return "model_maszyny";
  if (MODEL_MASZYNY.test(numer) || MODEL_Z_LITERA.test(numer)) return "model_maszyny";
  return null;
}

/* ── Etykiety w opisie ───────────────────────────────────────────────────── */

interface Etykieta { indeks: number; tekst: string; zestaw: boolean }

function etykietyOpisu(opis: string): Etykieta[] {
  const out: Etykieta[] = [];
  /* Ta sama granica, którą widzi parser: generyczne „Słowo:". Kopia z flagą
     `g`, bo wzorzec z `opis-sekcje.ts` szuka tylko pierwszego trafienia. */
  for (const m of opis.matchAll(new RegExp(KONIEC_SEKCJI.source, "g"))) {
    out.push({
      indeks: m.index,
      tekst: m[0].replace(/\s*:$/, "").replace(/\s+/g, " ").trim().toLowerCase(),
      zestaw: false,
    });
  }
  for (const m of opis.matchAll(ETYKIETA_ZESTAWU)) {
    out.push({ indeks: m.index, tekst: "w zestawie", zestaw: true });
  }
  /* Przy remisie wygrywa zestaw: `DRUCIAK W zestawie:` to dla parsera granica
     zestawu, nie etykieta o nazwie „druciak w zestawie". */
  return out.sort((a, b) => a.indeks - b.indeks || Number(a.zestaw) - Number(b.zestaw));
}

/** Słowo wokół ciągu: do spacji albo separatora listy. `Z.KSI-0031` to jedno słowo. */
function slowoWokol(opis: string, indeks: number, dlugosc: number): string {
  const granica = /[\s,;|]/;
  let od = indeks; let dokad = indeks + dlugosc;
  while (od > 0 && !granica.test(opis[od - 1])) od--;
  while (dokad < opis.length && !granica.test(opis[dokad])) dokad++;
  return opis.slice(od, dokad).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}*+]+$/gu, "");
}

/**
 * Czym jest początek opisu, zanim padnie pierwsza etykieta.
 *
 * `sama_lista`: każde słowo niesie cyfrę (`G02922 M66495`). `lista_z_ukosnikami`:
 * są też słowa, ale stoi `//`, czyli znak świadomie wypisanej listy. Reszta to
 * proza. Podział służy decyzji właściciela, bo te trzy kształty mają różną
 * cenę pomyłki przy czytaniu numerów bez etykiety.
 */
function ksztaltBezEtykiety(glowa: string): Pochodzenie {
  const slowa = glowa.split(/[\s,;|/\\()]+/).filter((s) => /[\p{L}\p{N}]/u.test(s));
  if (slowa.length > 0 && slowa.every((s) => /\d/.test(s))) return "sama_lista";
  return glowa.includes("//") ? "lista_z_ukosnikami" : "proza";
}

/**
 * Wszystkie ciągi w kształcie numeru z jednego opisu, każdy sklasyfikowany.
 * Czysta funkcja: tabelę i kartotekę dostaje w argumentach.
 *
 * `identyfikatoryNorm` to zwinięte wartości z tabeli dla TEJ kartoteki.
 * Porównanie idzie przez zawieranie, bo `56-30` to kawałek `532 16 56-30`,
 * a kształt numeru nie obejmuje spacji.
 */
export function ciagiOpisu(
  opis: string, symbol: string, ean: string,
  identyfikatoryNorm: readonly string[], nasze: ReadonlySet<string>,
): CiagOpisu[] {
  const wlasny = zwin(symbol);
  const wlasnyEan = zwin(ean);
  const etykiety = etykietyOpisu(opis);
  const glowa = ksztaltBezEtykiety(etykiety.length > 0 ? opis.slice(0, etykiety[0].indeks) : opis);

  const klasa = (numer: string, slowo: string): KlasaCiagu => {
    const n = zwin(numer);
    const s = zwin(slowo);
    if (n === wlasnyEan || s === wlasny || wlasny.includes(n)) return "wlasny";
    if (identyfikatoryNorm.some((i) => i.includes(n))) return "w_tabeli";
    if (nasze.has(n) || nasze.has(s)) return "nasz_symbol";
    return "poza_tabela";
  };

  const out: CiagOpisu[] = [];
  for (const trafienie of ciagiNumerow(opis)) {
    /* Kształt numeru zna tylko litery ASCII i `ŚWI-032B` ucina do `WI-032B`.
       Dociągamy przyległe litery, żeby raport pokazywał numer, a nie jego ogon. */
    let indeks = trafienie.indeks;
    let koniec = indeks + trafienie.numer.length;
    while (indeks > 0 && /\p{L}/u.test(opis[indeks - 1])) indeks--;
    while (koniec < opis.length && /\p{L}/u.test(opis[koniec])) koniec++;
    const caly = opis.slice(indeks, koniec);
    const slowo = slowoWokol(opis, indeks, caly.length);
    /* `S10250/PF10249` to dwa numery sklejone ukośnikiem. Całość sprawdzamy
       pierwszą (`81001145/0` jest jednym numerem GGP), a człony dopiero wtedy,
       gdy całość niczego nie znaczy. Krótki sufiks `/0` wtedy odpada. */
    let kandydaci = [caly];
    if (caly.includes("/") && klasa(caly, slowo) === "poza_tabela") {
      const czlony = caly.split("/").filter((c) => c.length >= 4 && /\d/.test(c));
      if (czlony.length > 0) kandydaci = czlony;
    }
    for (const numer of kandydaci) {
      let k = klasa(numer, numer === caly ? slowo : numer);
      /* Parser obcina przyklejone litery spoza ASCII (`PRO-LS42-375-NÓŻ` zapisuje
         bez `ÓŻ`), więc ciąg dociągnięty wyżej sprawdzamy też w postaci surowej. */
      if (k === "poza_tabela" && numer === caly && caly !== trafienie.numer) {
        k = klasa(trafienie.numer, slowo);
      }
      if (k !== "poza_tabela") {
        out.push({ numer, klasa: k, szum: null, pochodzenie: null, etykieta: null, zaMaloCyfr: false });
        continue;
      }
      let przed: Etykieta | null = null;
      for (const e of etykiety) { if (e.indeks < indeks) przed = e; else break; }
      const znana = przed !== null && !przed.zestaw && rodzajEtykiety(`${przed.tekst}:`) !== null;
      const pochodzenie: Pochodzenie = przed === null ? glowa
        : przed.zestaw ? "zestaw" : znana ? "znana_etykieta" : "nieznana_etykieta";
      out.push({
        numer, klasa: k,
        szum: rodzajSzumu(numer, slowo, przed?.tekst ?? null),
        pochodzenie,
        etykieta: przed?.tekst ?? null,
        zaMaloCyfr: znana && !dosycCyfr(numer),
      });
    }
  }
  return out;
}

/* ── Zliczenie na bazie ──────────────────────────────────────────────────── */

export interface GrupaKartotek {
  kartotek: number;
  /** Kartoteki z choć jednym ciągiem innym niż własny symbol i EAN. */
  zCiagami: number;
  /** Kartoteki z choć jednym ciągiem poza tabelą, który nie jest szumem. */
  zeZgubionymi: number;
  ciagow: number;
  wTabeli: number;
  naszeSymbole: number;
  szum: number;
  /** Poza tabelą i nie szum: tyle numerów raczej zostało nieodczytanych. */
  zgubione: number;
}

export interface WierszPochodzenia { kartotek: number; ciagow: number; szum: number; przyklady: string[] }

export interface WierszEtykiety extends WierszPochodzenia { etykieta: string }

export interface Pomiar {
  kartotek: number;
  zOpisem: number;
  identyfikatorow: number;
  wgRodzaju: Array<{ rodzaj: string; zrodlo: string; ile: number }>;
  zIdentyfikatorem: GrupaKartotek;
  bezIdentyfikatora: GrupaKartotek;
  pochodzenie: Record<Pochodzenie, WierszPochodzenia>;
  /** Etykiety, których parser nie zna, od najliczniejszej. */
  etykiety: WierszEtykiety[];
  szum: Record<RodzajSzumu, number>;
  /** Spod znanej etykiety, a jednak poza tabelą: ile odpadło na progu dwóch cyfr. */
  znanaZaMaloCyfr: number;
  /** Druga strona pomyłki: wiersze tabeli wyczytane z opisów, które są szumem. */
  szumWTabeli: { wierszy: number; wgReguly: Record<RodzajSzumu, number>; przyklady: string[] };
}

const ILE_PRZYKLADOW = 3;
const ILE_PRZYKLADOW_SZUMU = 12;

const zeroSzumu = (): Record<RodzajSzumu, number> => ({
  gwint: 0, wymiar: 0, jednostka: 0, rok: 0, urywek: 0, krotka_liczba: 0, model_maszyny: 0, zepsuta_liczba: 0,
});

const pustaGrupa = (): GrupaKartotek => ({
  kartotek: 0, zCiagami: 0, zeZgubionymi: 0, ciagow: 0, wTabeli: 0, naszeSymbole: 0, szum: 0, zgubione: 0,
});
const pustyWiersz = (): WierszPochodzenia => ({ kartotek: 0, ciagow: 0, szum: 0, przyklady: [] });

/** Czy pomiar ma na czym stanąć. Baza bez read-modelu to nie błąd, tylko brak danych. */
export function brakujaceTabele(database: DatabaseSync = db()): string[] {
  return ["sgt_towar", "towar_identyfikator"].filter((t) => database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t) === undefined);
}

export function zmierzIdentyfikatory(database: DatabaseSync = db()): Pomiar {
  const kartoteki = database.prepare(
    "SELECT tw_id, symbol, COALESCE(ean,'') AS ean, COALESCE(opis,'') AS opis FROM sgt_towar ORDER BY tw_id").all() as
    Array<{ tw_id: number; symbol: string; ean: string; opis: string }>;
  const nasze = new Set(kartoteki.map((k) => zwin(k.symbol)));

  const wTabeli = new Map<number, string[]>();
  for (const w of database.prepare("SELECT tw_id, wartosc_norm FROM towar_identyfikator").all() as
    Array<{ tw_id: number; wartosc_norm: string }>) {
    const lista = wTabeli.get(w.tw_id);
    /* Forma z kolumny bywa zapisana przez starszy kod inną wielkością liter. */
    if (lista) lista.push(zwin(w.wartosc_norm)); else wTabeli.set(w.tw_id, [zwin(w.wartosc_norm)]);
  }

  const p: Pomiar = {
    kartotek: kartoteki.length, zOpisem: 0, identyfikatorow: 0,
    wgRodzaju: (database.prepare(
      "SELECT rodzaj, zrodlo, count(*) AS ile FROM towar_identyfikator GROUP BY rodzaj, zrodlo ORDER BY ile DESC")
      .all() as Array<{ rodzaj: string; zrodlo: string; ile: number }>)
      .map((w) => ({ rodzaj: String(w.rodzaj), zrodlo: String(w.zrodlo), ile: Number(w.ile) })),
    zIdentyfikatorem: pustaGrupa(), bezIdentyfikatora: pustaGrupa(),
    pochodzenie: {
      znana_etykieta: pustyWiersz(), zestaw: pustyWiersz(), nieznana_etykieta: pustyWiersz(),
      sama_lista: pustyWiersz(), lista_z_ukosnikami: pustyWiersz(), proza: pustyWiersz(),
    },
    etykiety: [],
    szum: zeroSzumu(),
    znanaZaMaloCyfr: 0,
    szumWTabeli: { wierszy: 0, wgReguly: zeroSzumu(), przyklady: [] },
  };

  /* Ta sama reguła szumu przyłożona do TABELI. Numer zgubiony to pytanie bez
     odpowiedzi, a wiersz-szum to odpowiedź błędna: `5200` wpisane przez
     klienta jako model piły trafia w kartotekę, która ma je za „zamiennik".
     Tylko `zrodlo='opis'`: wpis ręczny biura ma podpis człowieka. */
  for (const w of database.prepare(
    "SELECT tw_symbol, wartosc FROM towar_identyfikator WHERE zrodlo='opis' ORDER BY id").all() as
    Array<{ tw_symbol: string; wartosc: string }>) {
    const szum = rodzajSzumu(String(w.wartosc), String(w.wartosc), null);
    if (!szum) continue;
    p.szumWTabeli.wierszy++;
    p.szumWTabeli.wgReguly[szum]++;
    /* Przykłady rozłożone po regułach, żeby jedna liczna nie zajęła całej listy. */
    if (p.szumWTabeli.wgReguly[szum] <= 2 && p.szumWTabeli.przyklady.length < ILE_PRZYKLADOW_SZUMU) {
      p.szumWTabeli.przyklady.push(`\`${w.wartosc}\` w \`${w.tw_symbol}\``);
    }
  }
  const etykiety = new Map<string, WierszEtykiety>();

  for (const k of kartoteki) {
    if (!k.opis.trim()) continue;
    p.zOpisem++;
    const ids = wTabeli.get(k.tw_id) ?? [];
    p.identyfikatorow += ids.length;
    const grupa = ids.length > 0 ? p.zIdentyfikatorem : p.bezIdentyfikatora;
    grupa.kartotek++;

    const ciagi = ciagiOpisu(k.opis, k.symbol, k.ean, ids, nasze).filter((c) => c.klasa !== "wlasny");
    if (ciagi.length > 0) grupa.zCiagami++;
    grupa.ciagow += ciagi.length;

    const policzoneTu = new Set<string>();
    let zgubioneTu = 0;
    for (const c of ciagi) {
      if (c.klasa === "w_tabeli") { grupa.wTabeli++; continue; }
      if (c.klasa === "nasz_symbol") { grupa.naszeSymbole++; continue; }
      if (c.szum) { grupa.szum++; p.szum[c.szum]++; } else { grupa.zgubione++; zgubioneTu++; }
      if (c.zaMaloCyfr && !c.szum) p.znanaZaMaloCyfr++;

      const przyklad = `\`${c.numer}\` w \`${k.symbol}\``;
      const dolicz = (w: WierszPochodzenia, klucz: string) => {
        w.ciagow++;
        if (c.szum) w.szum++;
        if (!policzoneTu.has(klucz)) { policzoneTu.add(klucz); w.kartotek++; }
        /* Przykładem jest numer, nie szum: szum niczego o luce nie mówi. */
        if (!c.szum && w.przyklady.length < ILE_PRZYKLADOW) w.przyklady.push(przyklad);
      };
      const poch = c.pochodzenie as Pochodzenie;
      dolicz(p.pochodzenie[poch], `p:${poch}`);
      if (poch === "nieznana_etykieta" && c.etykieta !== null) {
        let w = etykiety.get(c.etykieta);
        if (!w) { w = { etykieta: c.etykieta, ...pustyWiersz() }; etykiety.set(c.etykieta, w); }
        dolicz(w, `e:${c.etykieta}`);
      }
    }
    if (zgubioneTu > 0) grupa.zeZgubionymi++;
  }

  /* Ranking po numerach, nie po wszystkich ciągach: etykieta `modele` niesie
     sto ciągów, z których żaden nie jest numerem części. */
  p.etykiety = [...etykiety.values()].sort((a, b) =>
    (b.ciagow - b.szum) - (a.ciagow - a.szum) || b.ciagow - a.ciagow || a.etykieta.localeCompare(b.etykieta));
  return p;
}

/* ── Raport ──────────────────────────────────────────────────────────────── */

const tabela = (naglowki: string[], wiersze: string[][]): string =>
  wiersze.length === 0 ? "Brak." : [
    `| ${naglowki.join(" | ")} |`,
    `|${naglowki.map(() => "---").join("|")}|`,
    ...wiersze.map((w) => `| ${w.join(" | ")} |`),
  ].join("\n");

const procent = (ile: number, z: number): string => (z === 0 ? "—" : `${Math.round((ile / z) * 100)}%`);

/** Ile etykiet wypisać z nazwy; reszta idzie jednym wierszem zbiorczym. */
const ILE_ETYKIET = 40;

export function raportPomiaru(p: Pomiar, zdjeto: string): string {
  const z = p.zIdentyfikatorem; const bez = p.bezIdentyfikatora;
  const poza = (g: GrupaKartotek) => g.szum + g.zgubione;
  const grupa = (g: GrupaKartotek): string[][] => [
    ["kartotek w grupie", String(g.kartotek), ""],
    ["z ciągiem w kształcie numeru (poza własnym symbolem i EAN-em)", String(g.zCiagami), procent(g.zCiagami, g.kartotek)],
    ["**z ciągiem poza tabelą, który nie jest szumem**", String(g.zeZgubionymi), procent(g.zeZgubionymi, g.kartotek)],
    ["ciągów razem", String(g.ciagow), "100%"],
    ["— w tabeli", String(g.wTabeli), procent(g.wTabeli, g.ciagow)],
    ["— symbol innej naszej kartoteki", String(g.naszeSymbole), procent(g.naszeSymbole, g.ciagow)],
    ["— poza tabelą: szum według reguły", String(g.szum), procent(g.szum, g.ciagow)],
    ["— **poza tabelą: raczej numer części**", String(g.zgubione), procent(g.zgubione, g.ciagow)],
  ];
  const pochodzenia = (Object.keys(p.pochodzenie) as Pochodzenie[]).map((k) => {
    const w = p.pochodzenie[k];
    return [NAZWA_POCHODZENIA[k], String(w.kartotek), String(w.ciagow), String(w.szum),
      String(w.ciagow - w.szum), w.przyklady.join(", ")];
  });
  const gora = p.etykiety.slice(0, ILE_ETYKIET);
  const reszta = p.etykiety.slice(ILE_ETYKIET);
  const wierszeEtykiet = gora.map((w) => [`\`${w.etykieta}:\``, String(w.kartotek), String(w.ciagow),
    String(w.szum), String(w.ciagow - w.szum), w.przyklady.join(", ")]);
  if (reszta.length > 0) {
    const suma = (f: (w: WierszEtykiety) => number) => String(reszta.reduce((s, w) => s + f(w), 0));
    wierszeEtykiet.push([`pozostałe (${reszta.length} etykiet)`, "—", suma((w) => w.ciagow),
      suma((w) => w.szum), suma((w) => w.ciagow - w.szum), ""]);
  }
  const wszystkiePoza = poza(z) + poza(bez);

  return [
    "# Parser identyfikatorów — pomiar na kartotece",
    "",
    "Wynik `npm run identyfikatory:pomiar`. Sam odczyt: liczy, ile ciągów w kształcie",
    "numeru części stoi w opisach kartotek poza tabelą `towar_identyfikator`.",
    "Raport niesie symbole towarów i numery z ich opisów, bez danych klientów.",
    "",
    `Zdjęto: ${zdjeto}.`,
    "",
    "## 1. Kartoteki",
    "",
    tabela(["miara", "ile", "udział"], [
      ["kartotek w read-modelu", String(p.kartotek), ""],
      ["z opisem", String(p.zOpisem), procent(p.zOpisem, p.kartotek)],
      ["**z opisem i choć jednym identyfikatorem**", String(z.kartotek), procent(z.kartotek, p.zOpisem)],
      ["**z opisem i bez identyfikatora**", String(bez.kartotek), procent(bez.kartotek, p.zOpisem)],
      ["identyfikatorów tych kartotek w tabeli", String(p.identyfikatorow), ""],
    ]),
    "",
    "Tabela według rodzaju i źródła:",
    "",
    tabela(["rodzaj", "źródło", "wierszy"], p.wgRodzaju.map((w) => [w.rodzaj, w.zrodlo, String(w.ile)])),
    "",
    "## 2. Kartoteki bez identyfikatora",
    "",
    tabela(["miara", "ile", "udział"], grupa(bez)),
    "",
    "## 3. Kartoteki z identyfikatorami",
    "",
    tabela(["miara", "ile", "udział"], grupa(z)),
    "",
    "## 4. Skąd pochodzą ciągi spoza tabeli",
    "",
    `Razem poza tabelą: **${wszystkiePoza}** ciągów, z tego szum **${z.szum + bez.szum}**`,
    `i raczej numery **${z.zgubione + bez.zgubione}**.`,
    "",
    tabela(["pochodzenie", "kartotek", "ciągów", "w tym szum", "raczej numery", "przykłady"], pochodzenia),
    "",
    `Spod etykiet, które parser czyta, **${p.znanaZaMaloCyfr}** ciągów odpadło na progu dwóch cyfr.`,
    "Pozostałe numery tego wiersza ucina limit na opis albo skleja je sąsiednie słowo.",
    "",
    "### Etykiety, których parser nie zna",
    "",
    "Etykieta to „Słowo:\" w tym kształcie, w jakim widzi ją parser, czyli do czterech słów.",
    "Kolejność według liczby ciągów, które nie są szumem.",
    "",
    tabela(["etykieta", "kartotek", "ciągów", "w tym szum", "raczej numery", "przykłady"], wierszeEtykiet),
    "",
    "## 5. Szum, czyli ciągi, które raczej nie są numerami części",
    "",
    tabela(["reguła", "ciągów"],
      (Object.keys(p.szum) as RodzajSzumu[]).map((k) => [NAZWA_SZUMU[k], String(p.szum[k])])),
    "",
    "Reguła, w tej kolejności:",
    "",
    "1. słowo ma kształt liczby w notacji wykładniczej, czyli arkusz zepsuł numer;",
    "2. gwint: `M`, jedna albo dwie cyfry, `x`, cyfra;",
    "3. wymiar: gdziekolwiek w ciągu stoi cyfra, `x`, cyfra;",
    "4. same cyfry z jednostką (`mm`, `cm`, `cc`, `ml`, `szt`, `cali` i podobne);",
    "5. rok: cztery cyfry od 1980 do 2039;",
    "6. sama liczba do czterech cyfr;",
    "7. ciąg stoi po etykiecie modeli (`Modele:`, `Do:`, `Pasuje do:`, `Silnik:`, `Kosiarki:`);",
    "8. ciąg zaczyna się od rodziny modeli (`MS`, `FS`, `GX`, `DCS`, `LS` i podobne) z cyframi.",
    "",
    "To szacunek, nie rozstrzygnięcie. Model maszyny i numer części bywają tym samym",
    "kształtem, a krótka liczba bywa numerem katalogowym.",
    "",
    "## 6. Druga strona: wiersze tabeli, które są szumem",
    "",
    "Ta sama reguła przyłożona do wierszy wyczytanych z opisów. Wiersz-szum jest gorszy",
    "od numeru zgubionego, bo prowadzi do kartoteki, do której nie powinien.",
    "",
    `Wierszy z opisów, które reguła uznaje za szum: **${p.szumWTabeli.wierszy}**.`,
    "",
    tabela(["reguła", "wierszy"],
      (Object.keys(p.szumWTabeli.wgReguly) as RodzajSzumu[])
        .map((k) => [NAZWA_SZUMU[k], String(p.szumWTabeli.wgReguly[k])])),
    "",
    p.szumWTabeli.przyklady.length > 0 ? `Przykłady: ${p.szumWTabeli.przyklady.join(", ")}.` : "Przykładów brak.",
    "",
    "## Granice pomiaru",
    "",
    "- Kształt numeru nie obejmuje kropki ani spacji. `110.004.065` pomiar pomija,",
    "  a `574 71 93-01` liczy jako jeden ciąg `93-01`.",
    "- Ciąg uznaje się za obecny w tabeli, gdy zawiera go któryś identyfikator tej kartoteki.",
    "  Krótki ciąg może więc trafić w dłuższy numer przypadkiem.",
    "- Symbol innej naszej kartoteki nie jest luką: po symbolu szuka się wprost,",
    "  a zamienniki czyta osobny parser.",
    "",
  ].join("\n");
}
