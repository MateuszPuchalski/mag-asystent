import type { DatabaseSync } from "node:sqlite";
import { db, ftsDostepne } from "../db/db.js";
import { config } from "../config.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { kartotekaOferty, kartotekaPoSku } from "./dopasowanie-sku.js";
import { podzielZamienniki } from "./zamienniki.js";
import { doborRozmowy, DROGI_DOBORU, type DrogaDoboru } from "./dobor.js";
import { kluczModelu, zastosowaniaModelu } from "./wiedza.js";
import { szukajPoIdentyfikatorze } from "./identyfikatory.js";
import { szukajPelnotekst } from "./pelnotekst.js";
import { zwin } from "../tekst.js";

/**
 * Kandydaci doboru (§11.2) — osobny plik od `dobor.ts`, bo E2 i E3 dokładają
 * tu szczeble (zastosowanie, OEM, pełny tekst), a kręgosłup doboru ma zostać
 * nietknięty.
 *
 * Kandydaci NIE jadą w `osRozmowy`: tamten odczyt odświeża się na każde
 * zdarzenie szyny, także `presence`, a to jest wyszukiwarka i parser opisu.
 *
 * Każdy szczebel raportuje się OSOBNO jako sprawdzony albo pominięty
 * z powodem. Szczebel bez danych wejściowych to „pominięty", nie „zero
 * wyników" — blizna 0.153.1: milczący ekran każe zgadywać, czy automat
 * szukał i nie znalazł, czy nie miał czego szukać.
 *
 * Wyszukiwarka klikana ręcznie NIE jest kandydatem — jest od razu wyborem
 * z drogą `wyszukiwarka` (patrz `wybierzKandydata`).
 */

/* Pewność §11.3: `potwierdzone` niesie wyłącznie zatwierdzone zastosowanie
   z dowodem technicznym (E2); reszta dróg daje najwyżej „prawdopodobne". */
export type PewnoscKandydata = "potwierdzone" | "prawdopodobne" | "wymaga_danych";

export interface KandydatDoboru {
  nr: number;
  /** `null` = identyfikator bez wiersza w kartotece (§11.2, makieta Dobor.dc.html) — decyzja właściciela z E3. */
  twId: number | null;
  symbol: string;
  nazwa: string;
  /** Dostępne na magazynie głównym (stan minus rezerwacje). */
  stan: number | null;
  droga: DrogaDoboru;
  pewnosc: PewnoscKandydata;
  /** Zdanie dla ekranu — §11.3 żąda widocznego źródła, nie samej drogi. */
  zrodlo: string;
  /** Zdania negatywnych zastosowań TEJ kartoteki do wpisanej maszyny (§11.4). */
  ostrzezenia: string[];
}

/* Negatyw dotyczy także kartoteki, której NIE MA wśród kandydatów — dlatego
   osobna lista, nie tylko `ostrzezenia` przy kandydacie. §11.4: to jest
   ostrzeżenie, nie brak danych, i ma być widoczne zawsze. */
export interface NegatywDoboru {
  twId: number; symbol: string; nazwa: string | null;
  /** Zdanie z serwera: powód z §11.4 i dowód. */
  powod: string; zrodlo: string; at: string;
}

export interface SzczebelDoboru {
  droga: DrogaDoboru;
  sprawdzona: boolean;
  wynikow: number;
  /** Dlaczego pominięty. Tylko przy `sprawdzona: false`. */
  powod?: string;
}

/* Kolejność §11.2: dokładny symbol i EAN biją wszystko, oferta jest kontekstem
   pytania, zamiennik idzie z opisu. Dedup po `twId` zostawia najmocniejszą. */
const RANGA: Record<DrogaDoboru, number> = {
  symbol: 1, ean: 2, oem: 3, zastosowanie: 4, oferta: 5, zamiennik: 6, pelnotekst: 7, wyszukiwarka: 8,
};

const POMINIETE_DO: Partial<Record<DrogaDoboru, string>> = {
  wyszukiwarka: "wyszukiwarka to wybór ręczny, nie kandydat",
};

/** Coś, co wygląda na symbol albo numer: bez spacji, z cyfrą, rozsądnej długości. */
const JAK_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9\-_./+*]{1,39}$/;
const wygladaNaSymbol = (v: string | null) => Boolean(v && /\d/.test(v) && JAK_SYMBOL.test(v));
/* Luźniej niż symbol: `532 16 56-30` ma spacje. Dwie cyfry i cztery znaki,
   żeby `x2` albo `S` nie uruchamiały szczebla. */
const wygladaNaNumer = (v: string | null) =>
  Boolean(v && v.trim().length >= 4 && v.trim().length <= 40 && (v.match(/\d/g) ?? []).length >= 2);

/** Oferta, o którą chodzi: ręczne wskazanie bije numer z wiadomości. */
function ofertaRozmowy(database: DatabaseSync, conversationId: number): { konto: number; ofertaId: string } | null {
  const konto = database.prepare("SELECT channel_account_id AS konto FROM conversation WHERE id=?")
    .get(conversationId) as { konto: number } | undefined;
  if (!konto) throw new Error("Nie znaleziono rozmowy");
  const reczna = database.prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='offer_linked_manually' ORDER BY id DESC LIMIT 1`)
    .get(conversationId) as { payload: string | null } | undefined;
  if (reczna?.payload) {
    const p = JSON.parse(reczna.payload) as { ofertaId?: string };
    if (p.ofertaId) return { konto: Number(konto.konto), ofertaId: p.ofertaId };
  }
  /* Ta sama reguła co w `osRozmowy`: numer z najnowszej wiadomości KLIENTA,
     a gdy klient go nie podał — z najnowszej naszej. */
  const m = database.prepare(`SELECT related_object_id AS oferta FROM message
    WHERE conversation_id=? AND related_object_type='OFFER' AND related_object_id IS NOT NULL
    ORDER BY (direction='incoming') DESC, id DESC LIMIT 1`)
    .get(conversationId) as { oferta: string } | undefined;
  return m ? { konto: Number(konto.konto), ofertaId: String(m.oferta) } : null;
}

function towar(database: DatabaseSync, twId: number) {
  return database.prepare(`SELECT t.tw_id, t.symbol, t.nazwa, t.opis,
      COALESCE(s.stan,0) - COALESCE(s.stan_rez,0) AS dostepne
    FROM sgt_towar t LEFT JOIN sgt_stan s ON s.tw_id=t.tw_id AND s.mag_id=?
    WHERE t.tw_id=?`).get(config.magId.MAG, twId) as
    { tw_id: number; symbol: string; nazwa: string; opis: string | null; dostepne: number } | undefined;
}

export function kandydaciDoboru(
  conversationId: number, subiekt: SubiektAdapter, database: DatabaseSync = db(),
): { kandydaci: KandydatDoboru[]; drogi: SzczebelDoboru[]; negatywne: NegatywDoboru[] } {
  const dobor = doborRozmowy(conversationId, database);
  const oferta = ofertaRozmowy(database, conversationId);
  const znalezione = new Map<number, Omit<KandydatDoboru, "nr">>();
  const drogi = new Map<DrogaDoboru, SzczebelDoboru>();
  const pomin = (droga: DrogaDoboru, powod: string) =>
    drogi.set(droga, { droga, sprawdzona: false, wynikow: 0, powod });
  const dodaj = (k: Omit<KandydatDoboru, "nr">) => {
    // Mapa jest kluczowana po kartotece; kandydat bez niej (twId null) ma osobną
    // listę `bezKartoteki`, więc tu nigdy nie wchodzi — strażnik przed pomyłką.
    if (k.twId === null) return;
    const juz = znalezione.get(k.twId);
    if (!juz || RANGA[k.droga] < RANGA[juz.droga]) znalezione.set(k.twId, k);
  };

  /* SZCZEBEL: dokładny symbol i EAN — tylko, gdy agent wpisał coś, co na nie
     wygląda. Zawsze `literowki: false`: furtka na literówki prowadziła już
     do cudzej kartoteki (blizna „szarpaka"), a dobór nie ma prawa zgadywać. */
  const zapytania = [dobor.dane.oem, dobor.dane.nazwaCzesci].filter(wygladaNaSymbol) as string[];
  /* Wartości, które trafiły w kartotekę symbolem albo EAN-em. Szczebel OEM nie
     ma prawa dołożyć do nich karty „bez kartoteki": numer, który JEST naszym
     symbolem, nie jest „numerem, którego nie mamy". */
  const trafioneNumery = new Set<string>();
  if (zapytania.length === 0) {
    pomin("symbol", "agent nie wpisał symbolu ani numeru w danych wejściowych");
    pomin("ean", "agent nie wpisał kodu EAN w danych wejściowych");
  } else {
    let poSymbolu = 0; let poEan = 0;
    for (const q of zapytania) {
      const cyfry = q.replace(/\D/g, "");
      const trafienia = subiekt.search(q, 20, { literowki: false });
      for (const t of trafienia) {
        if (t.sym.trim().toUpperCase() === q.toUpperCase()) {
          const w = towar(database, t.id); if (!w) continue;
          poSymbolu++; trafioneNumery.add(zwin(q));
          dodaj({ twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa, stan: Number(w.dostepne), droga: "symbol",
            pewnosc: "prawdopodobne", zrodlo: `Dokładny symbol „${q}” z danych wejściowych`, ostrzezenia: [] });
        } else if (cyfry.length >= 8 && t.ean === cyfry) {
          const w = towar(database, t.id); if (!w) continue;
          poEan++; trafioneNumery.add(zwin(q));
          dodaj({ twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa, stan: Number(w.dostepne), droga: "ean",
            pewnosc: "prawdopodobne", zrodlo: `Kod EAN ${cyfry} z danych wejściowych`, ostrzezenia: [] });
        }
      }
    }
    drogi.set("symbol", { droga: "symbol", sprawdzona: true, wynikow: poSymbolu });
    drogi.set("ean", { droga: "ean", sprawdzona: true, wynikow: poEan });
  }

  /* SZCZEBEL: kartoteka oferty (pamięć wskazań albo SKU — `kartotekaOferty`
     rozstrzyga i pisze zdanie źródła), potem ZAMIENNIKI z jej opisu. */
  let kartotekaOfertyTwId: number | null = null;
  if (!oferta) {
    pomin("oferta", "rozmowa nie jest powiązana z ofertą");
  } else {
    const sku = database.prepare(`SELECT sku FROM offer_snapshot WHERE channel_account_id=? AND external_id=?`)
      .get(oferta.konto, oferta.ofertaId) as { sku: string | null } | undefined;
    const k = kartotekaOferty(database, oferta.konto, oferta.ofertaId, sku ? sku.sku : undefined);
    if (k.twId === null) {
      pomin("oferta", k.zrodlo);
    } else {
      const w = towar(database, k.twId);
      if (!w) {
        pomin("oferta", `kartoteki ${k.symbol ?? k.twId} nie ma w read-modelu Subiekta`);
      } else {
        kartotekaOfertyTwId = w.tw_id;
        drogi.set("oferta", { droga: "oferta", sprawdzona: true, wynikow: 1 });
        dodaj({ twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa, stan: Number(w.dostepne), droga: "oferta",
          pewnosc: "prawdopodobne", zrodlo: `Kartoteka oferty ${oferta.ofertaId} — ${k.zrodlo}`, ostrzezenia: [] });
      }
    }
  }

  if (kartotekaOfertyTwId === null) {
    pomin("zamiennik", "bez kartoteki oferty nie ma opisu, z którego czyta się zamienniki");
  } else {
    const w = towar(database, kartotekaOfertyTwId)!;
    const { znane } = podzielZamienniki(w.opis ?? "", w.symbol,
      (s) => kartotekaPoSku(database, s).stan !== "brak");
    let ile = 0;
    for (const symbol of znane) {
      const k = kartotekaPoSku(database, symbol);
      if (k.stan !== "jedno" || k.twId === null) continue;
      const z = towar(database, k.twId); if (!z) continue;
      ile++;
      /* `wymaga_danych`, nie `prawdopodobne`: opis mówi „zamiennie", ale nie
         mówi, do której maszyny — to trzeba sprawdzić parametrami. */
      dodaj({ twId: z.tw_id, symbol: z.symbol, nazwa: z.nazwa, stan: Number(z.dostepne), droga: "zamiennik",
        pewnosc: "wymaga_danych", zrodlo: `Zamiennik z opisu kartoteki „${w.symbol}”`, ostrzezenia: [] });
    }
    drogi.set("zamiennik", { droga: "zamiennik", sprawdzona: true, wynikow: ile });
  }

  /* SZCZEBEL: numer OEM (E3) — z tabeli identyfikatorów, nie z wyszukiwarki.
     Numer bez kartoteki NIE znika: decyzją właściciela staje się kandydatem
     bez wiersza (makieta Dobor.dc.html), bo „nie mamy tego u siebie" jest
     odpowiedzią dla klienta, a puste miejsce na liście nią nie jest. */
  const bezKartoteki: Array<Omit<KandydatDoboru, "nr">> = [];
  const numery = [dobor.dane.oem, dobor.dane.nazwaCzesci].filter(wygladaNaNumer) as string[];
  if (numery.length === 0) {
    pomin("oem", "agent nie wpisał numeru OEM w danych wejściowych");
  } else {
    let ile = 0;
    const widziane = new Set<string>();
    for (const numer of numery) {
      const norm = zwin(numer);
      if (!norm || widziane.has(norm)) continue;
      widziane.add(norm);
      const trafienia = szukajPoIdentyfikatorze(numer, database);
      for (const t of trafienia) {
        const w = towar(database, t.twId); if (!w) continue;
        ile++;
        dodaj({ twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa, stan: Number(w.dostepne), droga: "oem",
          pewnosc: "prawdopodobne", ostrzezenia: [],
          zrodlo: t.zrodlo === "reczne"
            ? `numer ${t.nazwaRodzaju} ${t.wartosc} wpisany ręcznie przez ${t.dodal}`
            : `numer ${t.nazwaRodzaju} ${t.wartosc} z opisu kartoteki „${w.symbol}”` });
      }
      /* Karta „bez kartoteki" tylko dla pola OEM: numer wpisany jako NAZWA
         części to nie deklaracja „mam numer producenta". */
      if (trafienia.length === 0 && numer === dobor.dane.oem && !trafioneNumery.has(norm)) {
        bezKartoteki.push({ twId: null, symbol: `OEM ${numer.trim()}`, nazwa: "identyfikator bez wiersza w kartotece",
          stan: null, droga: "oem", pewnosc: "wymaga_danych", ostrzezenia: [],
          zrodlo: "numer z danych wejściowych — nie ma go w żadnym opisie kartoteki" });
      }
    }
    drogi.set("oem", { droga: "oem", sprawdzona: true, wynikow: ile });
  }

  /* SZCZEBEL: potwierdzone zastosowanie z bazy wiedzy (E2). Tylko
     ZATWIERDZONE wpisy: propozycja czekająca w kolejce nie jest wiedzą.
     Pewność niesie sam wpis (dowód techniczny albo tylko ślad rozmowy),
     a zdanie źródła pisze serwis wiedzy — kandydat i szkic mówią to samo. */
  const negatywne: NegatywDoboru[] = [];
  if (!dobor.dane.marka || !dobor.dane.model) {
    pomin("zastosowanie", "agent nie wpisał marki i modelu maszyny");
  } else {
    const klucz = kluczModelu("maszyna", dobor.dane.marka, dobor.dane.model, dobor.dane.wariant);
    let ile = 0;
    for (const z of zastosowaniaModelu(klucz, database)) {
      const w = towar(database, z.twId);
      if (z.polaryzacja === "nie_pasuje") {
        negatywne.push({ twId: z.twId, symbol: w?.symbol ?? z.symbol, nazwa: w?.nazwa ?? null,
          powod: z.zdaniePowodu ?? "nie pasuje", zrodlo: z.zdanieZrodla, at: z.rozstrzygnietoAt ?? z.zaproponowanoAt });
        continue;
      }
      if (!w) continue;
      ile++;
      dodaj({ twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa, stan: Number(w.dostepne), droga: "zastosowanie",
        pewnosc: z.pewnosc, zrodlo: z.zdanieZrodla, ostrzezenia: [] });
    }
    drogi.set("zastosowanie", { droga: "zastosowanie", sprawdzona: true, wynikow: ile });
  }

  /* SZCZEBEL: pełny tekst (E3) — bm25 po symbolu, nazwie i opisie, WYŁĄCZNIE
     z danych wpisanych przez agenta (blizna „szarpaka": nigdy z treści
     wiadomości). Trafienie po treści to podpowiedź, nie dowód (§11.2). */
  const fraza = [dobor.dane.nazwaCzesci, dobor.dane.marka, dobor.dane.model].filter(Boolean).join(" ");
  if (!ftsDostepne()) {
    pomin("pelnotekst", "wyszukiwanie pełnotekstowe niedostępne — SQLite bez FTS5");
  } else if (!fraza) {
    pomin("pelnotekst", "agent nie wpisał nazwy części ani maszyny");
  } else {
    let ile = 0;
    for (const t of szukajPelnotekst(dobor.dane.nazwaCzesci ?? "", 5, database, [dobor.dane.marka ?? "", dobor.dane.model ?? ""])) {
      const w = towar(database, t.twId); if (!w) continue;
      ile++;
      dodaj({ twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa, stan: Number(w.dostepne), droga: "pelnotekst",
        pewnosc: "wymaga_danych", ostrzezenia: [],
        zrodlo: `trafienie po treści kartoteki dla „${fraza}” — nie dowód` });
    }
    drogi.set("pelnotekst", { droga: "pelnotekst", sprawdzona: true, wynikow: ile });
  }

  for (const droga of DROGI_DOBORU) {
    if (!drogi.has(droga)) pomin(droga, POMINIETE_DO[droga] ?? "szczebel bez nadawcy");
  }

  /* Ostrzeżenie przy kandydacie to skrót negatywu o TEJ SAMEJ kartotece —
     ta sama część bywa kandydatem z oferty i negatywem z wiedzy naraz. */
  const kandydaci = [...[...znalezione.values()]
    .sort((a, b) => RANGA[a.droga] - RANGA[b.droga] || (b.stan ?? 0) - (a.stan ?? 0) || a.symbol.localeCompare(b.symbol)),
  /* Numery bez kartoteki na końcu: nie da się ich wybrać, więc nie mają
     wyprzedzać niczego, co się da. */
  ...bezKartoteki]
    .map((k, i) => ({ nr: i + 1, ...k,
      ostrzezenia: negatywne.filter((n) => n.twId === k.twId).map((n) => `${n.powod} — ${n.zrodlo}`) }));
  return { kandydaci, drogi: DROGI_DOBORU.map((d) => drogi.get(d)!), negatywne };
}
