import { db } from "../db/db.js";
import { config } from "../config.js";
import type { ProductRow } from "../types.js";
import { parseLocs } from "../locs.js";
import { sqlBezPozycjiUslugowych } from "../pomijane.js";
import type {
  RawDocPosition,
  RawDocument,
  RawMagazyn,
  RawPosition,
  RawProduct,
  RawStock,
  RawStockRow,
  RawZamPosition,
} from "./subiekt.js";
import { etykietyDostaw } from "./typy-dokumentow.js";
import {
  naGlob,
  naLike,
  odlegloscOgraniczona,
  progLiterowki,
  sqlZloz,
  sqlZwin,
  sqlZwinSymbol,
  tokeny,
  zloz,
  zwin,
} from "../tekst.js";

/** Kształt wiersza wracającego z SELECT-ów listy — jeden dla trzech zapytań. */
interface WierszSurowy {
  id: number;
  sym: string;
  name: string;
  ean: string;
  lok: string;
  mag: number;
  mgp: number;
}

/* Symbole typów dokumentów mieszkają w `typy-dokumentow.ts` — tam, gdzie
   tłumaczy je także importer MSSQL. Re-eksport, bo miejsca wywołania (seed,
   testy) pytały dotąd tutaj i nie ma powodu ich przepisywać. */
export { etykietyDostaw };

/**
 * Odczyt kartoteki z tabel sgt_* (SQLite) — jedyna implementacja odczytu,
 * w każdym trybie. SGT_MODE zmienia tylko zasilenie read-modelu: seed
 * z mag.xlsx albo import z MSSQL (subiekt.mssql.ts). Odzwierciedla SELECT-y
 * ze spec §6.
 */
export class SeededSubiektAdapter {
  getProductById(twId: number): RawProduct | undefined {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE tw_id = ?")
      .get(twId) as RawProduct | undefined;
  }

  getProductByEan(ean: string): RawProduct | undefined {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE ean = ?")
      .get(ean) as RawProduct | undefined;
  }

  /**
   * WSZYSTKIE kartoteki o danym kodzie EAN. W kartotece istnieją kody wskazujące
   * na >1 SKU, więc ścieżki operacyjne muszą widzieć komplet kandydatów i same
   * rozstrzygnąć (D7) — nigdy „pierwsze dopasowanie".
   */
  findProductsByEan(ean: string): RawProduct[] {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE ean = ? ORDER BY symbol")
      .all(ean) as unknown as RawProduct[];
  }

  getProductBySymbol(symbol: string): RawProduct | undefined {
    return db()
      .prepare("SELECT * FROM sgt_towar WHERE symbol = ? COLLATE NOCASE")
      .get(symbol) as RawProduct | undefined;
  }

  /**
   * Wiersze listy dla zbioru symboli — jedno zapytanie, nie N. Symbole nie
   * istniejące w kartotece po prostu nie wracają; to jest cały mechanizm
   * odsiewania numerów obcych przy zamiennikach z opisu.
   */
  getProductsBySymbols(symbols: string[]): ProductRow[] {
    if (symbols.length === 0) return [];
    const dziury = symbols.map(() => "?").join(",");
    // `symbol COLLATE NOCASE IN (…)` — kolatacja PO stronie kolumny, żeby
    // zapytanie mogło skorzystać z ix_towar_symbol_nocase. Zapisane odwrotnie
    // (`IN (…) COLLATE NOCASE`) SQLite zejdzie do skanu całej kartoteki.
    const rows = db()
      .prepare(
        `SELECT t.tw_id AS id, t.symbol AS sym, t.nazwa AS name, t.ean AS ean,
                t.lokalizacja AS lok,
                COALESCE(mag.stan,0) AS mag, COALESCE(mgp.stan,0) AS mgp
         FROM sgt_towar t
         LEFT JOIN sgt_stan mag ON mag.tw_id = t.tw_id AND mag.mag_id = ?
         LEFT JOIN sgt_stan mgp ON mgp.tw_id = t.tw_id AND mgp.mag_id = ?
         WHERE t.symbol COLLATE NOCASE IN (${dziury})`
      )
      .all(config.magId.MAG, config.magId.MGP, ...symbols) as Array<{
      id: number; sym: string; name: string; ean: string; lok: string; mag: number; mgp: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sym: r.sym,
      name: r.name,
      ean: r.ean ?? "",
      mag: r.mag,
      mgp: r.mgp,
      locs: parseLocs(r.lok),
    }));
  }

  /**
   * Wyszukiwarka towarów.
   *
   * §5.1: symbol prefix > cała fraza w nazwie > rozproszone słowa > końcówka
   * EAN — a W OBRĘBIE tej samej trafności najpierw to, co REALNIE LEŻY NA
   * PÓŁCE.
   *
   * To nie jest kosmetyka listy. Z ~3600 kartotek aktywnych jest ~1000, więc
   * dwie trzecie wyników wyszukiwania to kartoteki martwe: zerowy stan
   * w obu magazynach i zerowa szansa, że magazynier czegoś takiego szuka.
   * Sortowanie po samym symbolu wypychało je na górę alfabetem, a człowiek
   * przy regale przewijał listę, żeby dojść do jedynej pozycji, którą można
   * podać klientowi.
   *
   * Trafność zostaje PIERWSZA i to jest świadome: wpisany symbol ma wygrać
   * z przypadkowym trafieniem w nazwie, choćby tamto miało pełny magazyn.
   * Surowy symbol zostaje ostatnim kryterium — dla powtarzalności przy równym
   * stanie; sortowanie po formie zwiniętej zgubiłoby rozstrzygnięcie tam,
   * gdzie różni je myślnik.
   *
   * @param opcje.literowki `false` wyłącza furtkę przybliżoną — patrz
   *   `szukajZFurtka`. Ścieżka skanu MUSI ją wyłączać.
   */
  search(q: string, limit: number, opcje: { literowki?: boolean } = {}): ProductRow[] {
    return opcje.literowki === false
      ? this.szukajDokladnie(q, limit)
      : this.szukajZFurtka(q, limit).wyniki;
  }

  /**
   * Wyszukiwanie z furtką na literówki. `przyblizone` mówi, czy wyniki wyszły
   * z dopasowania dosłownego, czy z niej.
   *
   * FURTKA ODPALA SIĘ WYŁĄCZNIE PRZY ZERZE WYNIKÓW i to jest cała jej
   * bezpieczna postać. Dopasowanie rozmyte wmieszane w ranking wypycha
   * trafienia dokładne — klasyczna wada wyszukiwarek, w których „gaz" wciąga
   * „gips". Jako odpowiedź na „nic nie znalazłem" nie ma czego zepsuć, a koszt
   * płaci się dokładnie wtedy, gdy człowiek i tak utknął.
   */
  szukajZFurtka(q: string, limit: number): { wyniki: ProductRow[]; przyblizone: boolean } {
    const dokladne = this.szukajDokladnie(q, limit);
    if (dokladne.length > 0) return { wyniki: dokladne, przyblizone: false };
    const przyblizone = this.szukajPrzyblizone(q, limit);
    return { wyniki: przyblizone, przyblizone: przyblizone.length > 0 };
  }

  private szukajDokladnie(q: string, limit: number): ProductRow[] {
    const toks = tokeny(q);
    /* Zapytanie bez ani jednego słowa („-", „///", same spacje). Koniunkcja po
       pustym zbiorze jest PRAWDZIWA, więc bez tego strażnika wyszukiwarka
       oddałaby całą kartotekę posortowaną po stanie. */
    if (toks.length === 0) return [];

    const symbolem = naLike(zwin(q));
    const fraza = naGlob(zloz(q).trim());
    const cyfry = q.replace(/\D/g, "");
    const jakEan = cyfry.length >= 5 ? 1 : 0;
    /* Token trafia w nazwę ALBO w symbol. Nazwa idzie przez GLOB (ogonki
       i wielkość liter w klasach znaków), symbol przez LIKE na formie
       zwiniętej — bo tam liczy się też brak myślnika.

       TRZECIA MOŻLIWOŚĆ TYLKO DLA TOKENÓW Z CYFRĄ: nazwa ze zdjętymi
       oddzielaczami. `sw40` ma znaleźć „SW-40 olej", a GLOB tego nie zrobi —
       myślnika w środku nazwy nie da się w tym wzorcu pominąć. Kosztuje to
       złożenie kolumny `nazwa`, czyli ~20 ms zamiast ~3 ms, więc bramkujemy
       je kształtem tokenu: słowa („gaznik") tej gałęzi nie dotykają wcale,
       a numery katalogowe są w wyszukiwarce rzadsze niż nazwy. */
    const zCyfra = toks.some((t) => /\d/.test(t));
    /* Przy zapytaniu jednosłownym wzorzec tokenu jest TYM SAMYM wzorcem co
       fraza z rangi 1, a jest to najdroższa część zapytania. Skoro ranga 1 go
       już sprawdziła i nie trafiła, powtórka w randze 2 nie ma prawa trafić —
       zostaje jej sam symbol. Oszczędza to jedno przejście po kartotece na
       najczęstszym kształcie zapytania. */
    const frazaToToken = toks.length === 1 && zloz(q).trim() === toks[0];
    const warunekTokenow = toks
      .map(
        () =>
          "(" +
          (frazaToToken ? "" : "t.nazwa GLOB ? OR ") +
          `t.sy LIKE '%' || ? || '%' ESCAPE '\\'` +
          (zCyfra ? ` OR t.nzw LIKE '%' || ? || '%' ESCAPE '\\')` : ")")
      )
      .join(" AND ");

    /* SKŁADANIE NAZWY ZOSTAŁO ZASTĄPIONE WZORCEM GLOB — decyzja z pomiaru.
       Łańcuch osiemnastu `replace` na kolumnie `nazwa` kosztował na prawdziwym
       katalogu ~22 ms na zapytanie, bo baza buduje wtedy dla każdego z 3415
       wierszy kilkanaście łańcuchów pośrednich. `GLOB` z klasami znaków daje
       ten sam wynik w ~3 ms, niczego nie alokując. Serwer jest jednowątkowy
       i w tym samym czasie odpowiada na odpytywanie listy rozkładania. */
    const rows = db()
      .prepare(
        `SELECT id, sym, name, ean, lok, mag, mgp FROM (
           SELECT t.tw_id AS id, t.symbol AS sym, t.nazwa AS name, t.ean AS ean,
                  t.lokalizacja AS lok,
                  COALESCE(mag.stan,0) AS mag, COALESCE(mgp.stan,0) AS mgp,
                  COALESCE(mag.stan,0) + COALESCE(mgp.stan,0) AS stanRazem,
                  CASE
                    WHEN t.sy LIKE ? || '%' ESCAPE '\\' THEN 0
                    WHEN t.nazwa GLOB ? THEN 1
                    WHEN ${warunekTokenow} THEN 2
                    WHEN ? = 1 AND t.ean LIKE '%' || ? THEN 3
                    ELSE 9
                  END AS rank
           FROM (SELECT tw_id, symbol, nazwa, ean, lokalizacja,
                        ${sqlZwinSymbol("symbol")} AS sy
                        ${zCyfra ? `, ${sqlZwin("nazwa")} AS nzw` : ""}
                 FROM sgt_towar) t
           LEFT JOIN sgt_stan mag ON mag.tw_id = t.tw_id AND mag.mag_id = ?
           LEFT JOIN sgt_stan mgp ON mgp.tw_id = t.tw_id AND mgp.mag_id = ?
         )
         WHERE rank < 9
         ORDER BY rank, stanRazem DESC, sym
         LIMIT ?`
      )
      .all(
        symbolem,
        fraza,
        ...toks.flatMap((t) => {
          const p: string[] = frazaToToken ? [] : [naGlob(t)];
          p.push(naLike(t));
          if (zCyfra) p.push(naLike(t));
          return p;
        }),
        jakEan,
        cyfry,
        config.magId.MAG,
        config.magId.MGP,
        limit
      ) as unknown as WierszSurowy[];
    return this.mapujWiersze(rows);
  }

  /**
   * Furtka: dopasowanie po odległości edycyjnej, gdy dosłowne nic nie dało.
   *
   * Porównujemy SŁOWO ZE SŁOWEM, nie z całą nazwą — odległość od
   * `gaznikkompletnydokosy` przekroczy każdy rozsądny próg, więc forma zwinięta
   * tu nie działa i pobieramy złożoną (ze spacjami).
   */
  private szukajPrzyblizone(q: string, limit: number): ProductRow[] {
    const toks = tokeny(q);
    if (toks.length === 0) return [];
    const progi = toks.map((t) => progLiterowki(t.length));
    // choć jedno słowo za krótkie na wybaczanie — całe zapytanie odpada
    if (progi.some((p) => p === null)) return [];

    const kandydaci = db()
      .prepare(
        `SELECT tw_id AS id, ${sqlZloz("symbol")} AS sy, ${sqlZloz("nazwa")} AS nz FROM sgt_towar`
      )
      .all() as Array<{ id: number; sy: string; nz: string }>;

    const trafienia: Array<{ id: number; dystans: number }> = [];
    for (const k of kandydaci) {
      const slowa = `${k.nz} ${k.sy}`.split(/[\s\-./,]+/).filter((s) => s.length > 0);
      let suma = 0;
      let komplet = true;
      for (let i = 0; i < toks.length; i++) {
        const max = progi[i] as number;
        let naj = max + 1;
        for (const s of slowa) {
          // podciąg dosłowny to odległość zero — nie ma po co liczyć macierzy
          if (s.includes(toks[i])) { naj = 0; break; }
          const d = odlegloscOgraniczona(toks[i], s, max);
          if (d < naj) naj = d;
          if (naj === 0) break;
        }
        if (naj > max) { komplet = false; break; }
        suma += naj;
      }
      if (komplet) trafienia.push({ id: k.id, dystans: suma });
    }
    if (trafienia.length === 0) return [];

    trafienia.sort((a, b) => a.dystans - b.dystans);
    const wybrane = trafienia.slice(0, limit);
    const dystansem = new Map(wybrane.map((t) => [t.id, t.dystans]));
    const wiersze = this.wierszeDlaId(wybrane.map((t) => t.id));
    /* Ta sama reguła co w etapie dosłownym: trafność pierwsza, stan rozstrzyga
       wewnątrz niej. `dystans` gra tu rolę `rank`. */
    return wiersze.sort(
      (a, b) =>
        (dystansem.get(a.id) ?? 9) - (dystansem.get(b.id) ?? 9) ||
        b.mag + b.mgp - (a.mag + a.mgp) ||
        a.sym.localeCompare(b.sym)
    );
  }

  /** Wiersze listy dla zbioru identyfikatorów — ten sam JOIN co reszta. */
  private wierszeDlaId(ids: number[]): ProductRow[] {
    if (ids.length === 0) return [];
    const dziury = ids.map(() => "?").join(",");
    const rows = db()
      .prepare(
        `SELECT t.tw_id AS id, t.symbol AS sym, t.nazwa AS name, t.ean AS ean,
                t.lokalizacja AS lok,
                COALESCE(mag.stan,0) AS mag, COALESCE(mgp.stan,0) AS mgp
         FROM sgt_towar t
         LEFT JOIN sgt_stan mag ON mag.tw_id = t.tw_id AND mag.mag_id = ?
         LEFT JOIN sgt_stan mgp ON mgp.tw_id = t.tw_id AND mgp.mag_id = ?
         WHERE t.tw_id IN (${dziury})`
      )
      .all(config.magId.MAG, config.magId.MGP, ...ids) as unknown as WierszSurowy[];
    return this.mapujWiersze(rows);
  }

  /** Jedno miejsce na kształt wiersza listy — trzy zapytania go dzielą. */
  private mapujWiersze(rows: WierszSurowy[]): ProductRow[] {
    return rows.map((r) => ({
      id: r.id,
      sym: r.sym,
      name: r.name,
      ean: r.ean ?? "",
      mag: r.mag,
      mgp: r.mgp,
      locs: parseLocs(r.lok),
    }));
  }

  getStock(twId: number, magId: number): RawStock {
    const row = db()
      .prepare("SELECT stan, stan_rez FROM sgt_stan WHERE tw_id = ? AND mag_id = ?")
      .get(twId, magId) as RawStock | undefined;
    return row ?? { stan: 0, stan_rez: 0 };
  }

  /**
   * Wszystkie magazyny ze słownika Subiekta.
   *
   * Do lipca 2026 aplikacja znała DOKŁADNIE TRZY magazyny — te z `MAG_ID_*` —
   * i nie było to ograniczenie wyświetlania: importer filtrował `tw_Stan`
   * po tych trzech identyfikatorach, więc stany reszty nigdy nie trafiały do
   * read-modelu. Magazynier nie miał jak się dowiedzieć, że towar leży jeszcze
   * gdzie indziej.
   */
  listMagazyny(): RawMagazyn[] {
    return db()
      .prepare("SELECT mag_id, kod, nazwa FROM sgt_magazyn ORDER BY mag_id")
      .all() as unknown as RawMagazyn[];
  }

  /** Stany towaru we WSZYSTKICH magazynach — do zestawienia na karcie. */
  getStockAll(twId: number): RawStockRow[] {
    return db()
      .prepare("SELECT mag_id, stan, stan_rez FROM sgt_stan WHERE tw_id = ? ORDER BY mag_id")
      .all(twId) as unknown as RawStockRow[];
  }

  listDeliveryDocuments(days: number): RawDocument[] {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    // Jedna lista, dwa magazyny skutku. Do 0.22.0 kontener na MGP miał własną
    // zakładkę i własną ścieżkę pracy; teraz rozkłada się identycznie — zapisem
    // adresu (D1) — a magazyn skutku mówi już tylko tyle, że po odłożeniu
    // zostaje jeszcze przesunięcie stanu na halę.
    // Typy dostaw biorą się z `DOK_TYPY_DOSTAW`, tak samo jak w adapterze MSSQL.
    // Para ('FZ','PZ') była tu ZASZYTA i czyniła demo niewiernym: zawężenie
    // konfiguracji do samych FZ nie robiło na tej liście żadnej różnicy, więc
    // pokaz i produkcja pokazywały co innego z tych samych ustawień.
    const etykiety = etykietyDostaw();
    const luki = etykiety.map(() => "?").join(",");
    return db()
      .prepare(
        `SELECT * FROM sgt_dokument
         WHERE typ IN (${luki}) AND mag_id IN (?, ?)
           AND data_wyst >= ?
         ORDER BY data_wyst DESC, dok_id DESC`
      )
      .all(...etykiety, config.magId.MAG, config.magId.MGP, cutoff) as unknown as RawDocument[];
  }

  getDocument(docId: number): RawDocument | undefined {
    return db()
      .prepare("SELECT * FROM sgt_dokument WHERE dok_id = ?")
      .get(docId) as RawDocument | undefined;
  }

  getDeliveryPositionsForProduct(twId: number, days: number): RawDocPosition[] {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    // Warunek na dokumenty jest DOKŁADNIE ten sam co w `listDeliveryDocuments`
    // wyżej — i musi taki pozostać. To dwie strony jednego pytania: tamta metoda
    // pyta „które dostawy są do rozłożenia", ta „na których z nich stoi ten
    // towar". Rozjazd kryteriów pokazałby na karcie dokument, którego nie da się
    // otworzyć z zakładki rozkładania.
    const etykiety = etykietyDostaw();
    const luki = etykiety.map(() => "?").join(",");
    return db()
      .prepare(
        `SELECT d.dok_id, d.typ, d.nr_pelny, d.data_wyst, d.mag_id, d.dostawca,
                d.w_buforze, SUM(p.ilosc) AS ilosc
         FROM sgt_pozycja p
         JOIN sgt_dokument d ON d.dok_id = p.dok_id
         WHERE p.tw_id = ?
           AND d.typ IN (${luki}) AND d.mag_id IN (?, ?)
           AND d.data_wyst >= ?
         GROUP BY d.dok_id
         ORDER BY d.data_wyst DESC, d.dok_id DESC`
      )
      .all(twId, ...etykiety, config.magId.MAG, config.magId.MGP, cutoff) as unknown as RawDocPosition[];
  }

  /**
   * Otwarte zamówienia do dostawcy (ZD), na których stoi TEN towar.
   *
   * Bez parametru `days`: okno wycina już import (zamówienie bywa starsze niż
   * dostawa i wciąż otwarte), a drugie okno tutaj tylko ukryłoby część tego, co
   * importer uznał za aktualne — i to bez śladu na ekranie.
   */
  getOrdersForProduct(twId: number): RawZamPosition[] {
    /* Bez odsiewu po dacie i bez odejmowania `zreal` — jedno i drugie należy do
       warstw obok: okno wycina import, a regułę „zostało <= 0 wypada" ma serwis
       razem ze swoim testem. Adapter zwraca to, co stoi w read-modelu. */
    return db()
      .prepare(
        `SELECT z.dok_id, z.nr_pelny, z.data_wyst, z.termin, z.dostawca,
                SUM(p.ilosc) AS ilosc, SUM(p.zreal) AS zreal
         FROM sgt_zam_pozycja p
         JOIN sgt_zamowienie z ON z.dok_id = p.dok_id
         WHERE p.tw_id = ?
         GROUP BY z.dok_id`
      )
      .all(twId) as unknown as RawZamPosition[];
  }

  getDocumentPositions(docId: number): RawPosition[] {
    return db()
      .prepare("SELECT tw_id, ilosc FROM sgt_pozycja WHERE dok_id = ? ORDER BY id")
      .all(docId) as unknown as RawPosition[];
  }

  /**
   * Stany kompletu towarów na hali i w przyjęciach — jedno zapytanie, nie N.
   *
   * Lista pozycji dostawy bywa kilkudziesięciowierszowa i odświeża się po
   * KAŻDYM odłożeniu, więc pytanie o stan per wiersz zjadłoby dokładnie ten
   * budżet, który przed chwilą odzyskaliśmy na innych trasach.
   */
  stanyDlaTowarow(twIds: number[]): Map<number, { mag: number; mgp: number }> {
    const out = new Map<number, { mag: number; mgp: number }>();
    if (twIds.length === 0) return out;
    const dziury = twIds.map(() => "?").join(",");
    const rows = db()
      .prepare(
        `SELECT tw_id, mag_id, stan FROM sgt_stan
         WHERE tw_id IN (${dziury}) AND mag_id IN (?, ?)`
      )
      .all(...twIds, config.magId.MAG, config.magId.MGP) as unknown as Array<{
      tw_id: number; mag_id: number; stan: number;
    }>;
    for (const r of rows) {
      const wpis = out.get(r.tw_id) ?? { mag: 0, mgp: 0 };
      if (r.mag_id === config.magId.MAG) wpis.mag = r.stan;
      else wpis.mgp = r.stan;
      out.set(r.tw_id, wpis);
    }
    return out;
  }

  /**
   * Liczba pozycji per dokument, jednym zapytaniem — lista dostaw pyta o nią
   * dla każdego dokumentu z okna, a zapytanie na dokument to N+1.
   */
  countPositionsByDoc(): Map<number, number> {
    /* Pozycje usługowe odsiewamy TU TAK SAMO jak przy otwieraniu dostawy
       (`src/pomijane.ts`). Gdyby liczyć je tylko przed otwarciem, dokument
       „5 pozycji" po otwarciu robiłby się dokumentem „4 z 4" — a liczba,
       która zmienia się od samego wejścia w ekran, wygląda jak zgubiona
       pozycja i tak właśnie zostałaby zgłoszona. */
    const bez = sqlBezPozycjiUslugowych("tw_id");
    const rows = db()
      .prepare(
        `SELECT dok_id, COUNT(*) AS n FROM sgt_pozycja
         ${bez ? `WHERE ${bez.warunek}` : ""}
         GROUP BY dok_id`
      )
      .all(...(bez?.parametry ?? [])) as Array<{ dok_id: number; n: number }>;
    return new Map(rows.map((r) => [r.dok_id, r.n]));
  }

  /** Wykaz istniejących kodów lokalizacji (słownik dla walidacji/podpowiedzi). */
  listLocations(): string[] {
    const rows = db()
      .prepare("SELECT lokalizacja FROM sgt_towar WHERE lokalizacja <> ''")
      .all() as Array<{ lokalizacja: string }>;
    const set = new Set<string>();
    for (const r of rows) {
      for (const c of parseLocs(r.lokalizacja)) set.add(c);
    }
    return [...set].sort();
  }

  /** Towary, których pole lokalizacji zawiera dany kod (reverse lookup). */
  getProductsByLocation(code: string): ProductRow[] {
    // dopasowanie po całym kodzie w spacja-separated polu (granice słowa)
    const rows = db()
      .prepare(
        `SELECT t.tw_id AS id, t.symbol AS sym, t.nazwa AS name, t.ean AS ean,
                t.lokalizacja AS lok,
                COALESCE(mag.stan,0) AS mag, COALESCE(mgp.stan,0) AS mgp
         FROM sgt_towar t
         LEFT JOIN sgt_stan mag ON mag.tw_id = t.tw_id AND mag.mag_id = ?
         LEFT JOIN sgt_stan mgp ON mgp.tw_id = t.tw_id AND mgp.mag_id = ?
         WHERE ' ' || t.lokalizacja || ' ' LIKE '% ' || ? || ' %'
         ORDER BY t.symbol
         LIMIT 200`
      )
      .all(config.magId.MAG, config.magId.MGP, code) as Array<{
      id: number; sym: string; name: string; ean: string; lok: string; mag: number; mgp: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sym: r.sym,
      name: r.name,
      ean: r.ean ?? "",
      mag: r.mag,
      mgp: r.mgp,
      locs: parseLocs(r.lok),
    }));
  }
}
