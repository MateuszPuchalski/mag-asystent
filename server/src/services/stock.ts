import { db } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import type { SubiektAdapter } from "../adapters/subiekt.js";
import type { ProductCard, StockView, Zamienniki } from "../types.js";
import { parseLocs } from "../locs.js";
import { pendingLocChanges } from "./locations.js";
import { kandydaciZamiennikow, podzielZamienniki } from "./zamienniki.js";
import { magazynyTowaru } from "./magazyny.js";
import { nierozlozoneZDostaw } from "./dostawy-towaru.js";
import { zamowioneUDostawcy } from "./zamowienia-towaru.js";

/**
 * Suma oczekujących przesunięć MM per towar, z kolejki Sfery.
 *
 * Uwzględnia zadania typu `mm` w statusach pending/processing/waiting_for_doc
 * (spec §5.1 — „korekta o kolejkę"). Filtr `z` zawęża do przesunięć
 * wyjeżdżających z danego magazynu, `na` — do przyjeżdżających do niego.
 *
 * Do 0.22.0 funkcja znała tylko magazyn ŹRÓDŁOWY i milcząco zakładała, że
 * każde MM jedzie na MAG — bo jedyne, jakie umiała powstać, szło z wózka na
 * halę. Odkąd przesunięcie jest osobną czynnością między dowolną parą
 * magazynów, to założenie kłamałoby przy pierwszym przesunięciu z MAG albo
 * między magazynami bez roli.
 */
export function pendingMmByTw(filtr?: { z?: number; na?: number }): Map<number, number> {
  return sumujMm(czytajKolejkeMm(), filtr);
}

/** Zadanie MM z kolejki po sparsowaniu — para magazynów i pozycje. */
interface MmZadanie {
  z: number;
  na: number;
  items: Array<{ twId: number; qty: number }>;
}

/**
 * Jeden odczyt kolejki MM. `buildProductCard` pyta o oczekujące przesunięcia
 * raz dla każdego magazynu na karcie — czytamy i parsujemy kolejkę raz,
 * a filtrowanie zostaje w pamięci (`sumujMm`).
 */
function czytajKolejkeMm(): MmZadanie[] {
  const rows = db()
    .prepare(
      `SELECT payload FROM sfera_queue
       WHERE type = 'mm'
         AND status IN ('pending','processing','waiting_for_doc')`
    )
    .all() as Array<{ payload: string }>;
  const out: MmZadanie[] = [];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as {
        magFrom?: number;
        magTo?: number;
        items?: Array<{ twId: number; qty: number }>;
      };
      // zadania sprzed 0.16.0 nie niosły pary magazynów: wszystkie szły z MGP
      // na MAG, bo innej drogi wtedy nie było
      out.push({
        z: p.magFrom ?? config.magId.MGP,
        na: p.magTo ?? config.magId.MAG,
        items: p.items ?? [],
      });
    } catch {
      /* pomiń uszkodzony payload */
    }
  }
  return out;
}

function sumujMm(
  zadania: MmZadanie[],
  filtr?: { z?: number; na?: number }
): Map<number, number> {
  const map = new Map<number, number>();
  for (const zad of zadania) {
    if (filtr?.z != null && zad.z !== filtr.z) continue;
    if (filtr?.na != null && zad.na !== filtr.na) continue;
    for (const it of zad.items) {
      map.set(it.twId, (map.get(it.twId) ?? 0) + it.qty);
    }
  }
  return map;
}

/**
 * Ile sztuk wolno dziś ruszyć z danego magazynu: stan MINUS to, co już czeka
 * w kolejce na wyjazd stamtąd.
 *
 * Bez tego odejmowania dwa przesunięcia tego samego towaru, zrobione zanim
 * worker dobił do pierwszego, wysłałyby do Subiekta sumę większą niż stan —
 * a odmowa przyszłaby dopiero z kolejki, godzinę później i bez człowieka przy
 * palecie. Kolejka jest więc zarazem rezerwacją.
 */
export function dostepneW(magId: number, twId: number): number {
  const stan = subiekt.getStock(twId, magId).stan;
  return stan - (pendingMmByTw({ z: magId }).get(twId) ?? 0);
}

/**
 * Zamienniki karty: kandydaci z opisu → jedno zapytanie do kartoteki →
 * podział na klikalne i obce.
 *
 * Kartoteka jest tu JEDYNYM filtrem — wzorca na symbol towaru napisać się nie
 * da (patrz `zamienniki.ts`). Kolejność `znane` idzie za opisem, nie za stanem:
 * lista siedzi w karcie odświeżanej co 2 s, a wiersz, który przeskakuje pod
 * kciukiem, to dotknięcie w zły towar.
 */
function zamiennikiZOpisu(
  adapter: SubiektAdapter,
  desc: string,
  symbol: string
): Zamienniki {
  const kandydaci = kandydaciZamiennikow(desc, symbol);
  if (kandydaci.length === 0) return { znane: [], obce: [] };
  const wiersze = adapter.getProductsBySymbols(kandydaci);
  const poSymbolu = new Map(wiersze.map((r) => [r.sym.toUpperCase(), r]));
  const { znane, obce } = podzielZamienniki(desc, symbol, (s) =>
    poSymbolu.has(s.toUpperCase())
  );
  return {
    znane: znane.flatMap((s) => {
      const wiersz = poSymbolu.get(s.toUpperCase());
      return wiersz ? [wiersz] : [];
    }),
    obce,
  };
}

function stockView(stan: number, rez: number, pendingOut: number, pendingIn: number): StockView {
  return {
    stan,
    rez,
    avail: stan - rez,
    pendingOut,
    pendingIn,
    effective: stan - pendingOut + pendingIn,
  };
}

/** Karta towaru ze stanami MAG/MGP skorygowanymi o kolejkę. */
export function buildProductCard(
  adapter: SubiektAdapter,
  twId: number
): ProductCard | undefined {
  const t = adapter.getProductById(twId);
  if (!t) return undefined;
  const magRaw = adapter.getStock(twId, config.magId.MAG);
  const mgpRaw = adapter.getStock(twId, config.magId.MGP);
  const zwRaw = adapter.getStock(twId, config.magId.ZWROTY);
  /* Co z danego magazynu WYJEŻDŻA i co na MAG PRZYJEŻDŻA — dwa różne pytania,
     odkąd przesunięcie może iść między dowolną parą magazynów. Do 0.22.0
     wystarczyła jedna liczba, bo każde MM szło z wózka na halę.
     Kolejka czytana RAZ na kartę — karta odświeża się co 2 s na każdym
     kolektorze, a pytań o kierunek jest tyle, ile magazynów na ekranie. */
  const zadaniaMm = czytajKolejkeMm();
  const wyjezdzaZ = (magId: number) => sumujMm(zadaniaMm, { z: magId }).get(twId) ?? 0;
  const naMag = sumujMm(zadaniaMm, { na: config.magId.MAG }).get(twId) ?? 0;
  const locs = parseLocs(t.lokalizacja);

  return {
    id: t.tw_id,
    sym: t.symbol,
    name: t.nazwa,
    ean: t.ean ?? "",
    unit: t.unit,
    desc: t.opis ?? "",
    locs,
    // to, co jeszcze nie doszło do Subiekta — świadomie OBOK `locs`, żeby karta
    // nie zaczęła kłamać w drugą stronę (pokazywać niepotwierdzone jako pewne)
    pendingLocs: pendingLocChanges(twId, locs),
    /* Każdy magazyn traci to, co z niego jedzie; MAG dodatkowo zyskuje
       wszystko, co jedzie do niego — także z magazynów bez roli, co przed
       0.22.0 nie mogło się zdarzyć. MAG bywa teraz również źródłem. */
    mgp: stockView(mgpRaw.stan, mgpRaw.stan_rez, wyjezdzaZ(config.magId.MGP), 0),
    zwroty: stockView(zwRaw.stan, zwRaw.stan_rez, wyjezdzaZ(config.magId.ZWROTY), 0),
    mag: stockView(magRaw.stan, magRaw.stan_rez, wyjezdzaZ(config.magId.MAG), naMag),
    /* Magazyny BEZ ROLI, pominąwszy ukryte. Trójka wyżej ma własne kafle
       z własną semantyką, więc powtarzanie jej tutaj dublowałoby tę samą
       liczbę w dwóch miejscach ekranu.

       Korekta o kolejkę siedzi TUTAJ, a nie w `magazynyTowaru`: tamten plik
       jest właścicielem tożsamości i widoczności magazynów, a sięgnięcie
       z niego po `pendingMmByTw` zamknęłoby cykl importów ze `stock.ts`. */
    magazyny: magazynyTowaru(twId).map((m) => ({ ...m, wDrodze: wyjezdzaZ(m.magId) })),
    /* Dlaczego stan nie zgadza się z półką. Przy dostawie krajowej towar
       figuruje na MAG od zaksięgowania dokumentu, więc `mag.stan` nie odróżnia
       „leży w regale" od „stoi na palecie w przyjęciach". */
    wDostawie: nierozlozoneZDostaw(twId),
    /* Druga połowa tego samego pytania: nie „gdzie to jest", tylko „kiedy to
       będzie". Sekcja stoi na karcie POD `wDostawie`, bo kolejność jest tu
       treścią — najpierw „jest, ale nierozłożone", potem „nie ma, zamówione". */
    zamowione: zamowioneUDostawcy(twId),
    zamienniki: zamiennikiZOpisu(adapter, t.opis ?? "", t.symbol),
  };
}
