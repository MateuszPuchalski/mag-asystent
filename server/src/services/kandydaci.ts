import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { config } from "../config.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import { kartotekaOferty, kartotekaPoSku } from "./dopasowanie-sku.js";
import { podzielZamienniki } from "./zamienniki.js";
import { doborRozmowy, DROGI_DOBORU, type DrogaDoboru } from "./dobor.js";

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

/* Pewność §11.3 w E1: `potwierdzone` zostaje w typie dla E2 (zastosowanie
   z dowodem), bo panel ma jedną listę plakietek, nie dwie rosnące osobno. */
export type PewnoscKandydata = "potwierdzone" | "prawdopodobne" | "wymaga_danych";

export interface KandydatDoboru {
  nr: number;
  twId: number;
  symbol: string;
  nazwa: string;
  /** Dostępne na magazynie głównym (stan minus rezerwacje). */
  stan: number;
  droga: DrogaDoboru;
  pewnosc: PewnoscKandydata;
  /** Zdanie dla ekranu — §11.3 żąda widocznego źródła, nie samej drogi. */
  zrodlo: string;
  /** Negatywne dopasowania z E2; w E1 zawsze puste, ale panel już je rysuje. */
  ostrzezenia: string[];
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
  oem: "numery OEM dochodzą w etapie E3",
  zastosowanie: "baza zastosowań dochodzi w etapie E2",
  pelnotekst: "wyszukiwanie pełnotekstowe dochodzi w etapie E3",
  wyszukiwarka: "wyszukiwarka to wybór ręczny, nie kandydat",
};

/** Coś, co wygląda na symbol albo numer: bez spacji, z cyfrą, rozsądnej długości. */
const JAK_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9\-_./+*]{1,39}$/;
const wygladaNaSymbol = (v: string | null) => Boolean(v && /\d/.test(v) && JAK_SYMBOL.test(v));

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
): { kandydaci: KandydatDoboru[]; drogi: SzczebelDoboru[] } {
  const dobor = doborRozmowy(conversationId, database);
  const oferta = ofertaRozmowy(database, conversationId);
  const znalezione = new Map<number, Omit<KandydatDoboru, "nr">>();
  const drogi = new Map<DrogaDoboru, SzczebelDoboru>();
  const pomin = (droga: DrogaDoboru, powod: string) =>
    drogi.set(droga, { droga, sprawdzona: false, wynikow: 0, powod });
  const dodaj = (k: Omit<KandydatDoboru, "nr">) => {
    const juz = znalezione.get(k.twId);
    if (!juz || RANGA[k.droga] < RANGA[juz.droga]) znalezione.set(k.twId, k);
  };

  /* SZCZEBEL: dokładny symbol i EAN — tylko, gdy agent wpisał coś, co na nie
     wygląda. Zawsze `literowki: false`: furtka na literówki prowadziła już
     do cudzej kartoteki (blizna „szarpaka"), a dobór nie ma prawa zgadywać. */
  const zapytania = [dobor.dane.oem, dobor.dane.nazwaCzesci].filter(wygladaNaSymbol) as string[];
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
          poSymbolu++;
          dodaj({ twId: w.tw_id, symbol: w.symbol, nazwa: w.nazwa, stan: Number(w.dostepne), droga: "symbol",
            pewnosc: "prawdopodobne", zrodlo: `Dokładny symbol „${q}” z danych wejściowych`, ostrzezenia: [] });
        } else if (cyfry.length >= 8 && t.ean === cyfry) {
          const w = towar(database, t.id); if (!w) continue;
          poEan++;
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

  for (const droga of DROGI_DOBORU) {
    if (!drogi.has(droga)) pomin(droga, POMINIETE_DO[droga] ?? "szczebel bez nadawcy");
  }

  const kandydaci = [...znalezione.values()]
    .sort((a, b) => RANGA[a.droga] - RANGA[b.droga] || b.stan - a.stan || a.symbol.localeCompare(b.symbol))
    .map((k, i) => ({ nr: i + 1, ...k }));
  return { kandydaci, drogi: DROGI_DOBORU.map((d) => drogi.get(d)!) };
}
