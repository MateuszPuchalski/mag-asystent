import { config } from "../config.js";
import { subiekt } from "../context.js";
import { db } from "../db/db.js";
import { parseLocs } from "../locs.js";
import { validateLocationCode } from "./locations.js";
import { enqueueSetLocation } from "./queue.js";

/* ── Masowa podmiana adresów z arkusza (0.138.0) ─────────────────────────────
   Właściciel eksportuje kartoteki z Subiekta, poprawia kolumnę adresu
   w Excelu i wgrywa plik z powrotem. Przestawienie jednego regału to 125
   kartotek — dotąd jedyną drogą była karta towaru na kolektorze, jeden towar
   na raz, czyli dzień pracy zamiast dwóch minut.

   TA FUNKCJA NICZEGO NIE ZAPISUJE. Liczy raport i to samo liczenie obsługuje
   podgląd oraz wykonanie — bo podgląd, który pokazuje co innego, niż się
   wykona, jest gorszy niż brak podglądu. Zapis robi `zastosujImport`, i tylko
   na raporcie policzonym chwilę wcześniej.

   Arkusz jest EKSPORTEM, więc przy poprawianiu jednego regału większość
   wierszy niesie adres, który w Subiekcie już stoi. Bez odsiania ich wgranie
   własnego eksportu zakolejkowałoby setki zapisów do bazy firmy po nic — i to
   jest najczęstsza pomyłka, jaką ta funkcja może popełnić.                   */

/** Wiersz arkusza po stronie przeglądarki: symbol kartoteki i docelowe pole. */
export interface WierszArkusza {
  symbol: string;
  lokalizacja: string;
}

/** Wiersz, który faktycznie coś zmieni. `przed`/`po` to CAŁE pole, nie kod. */
export interface ZmianaAdresu {
  symbol: string;
  twId: number;
  nazwa: string;
  przed: string;
  po: string;
}

/** Wiersz odrzucony wraz z powodem — arkusz poprawia się po tej liście. */
export interface OdrzuconyWiersz {
  symbol: string;
  powod: string;
}

export interface RaportImportu {
  /** Ile wierszy z treścią przyszło z arkusza (po odsianiu pustych). */
  wierszy: number;
  doZmiany: ZmianaAdresu[];
  /** Arkusz mówi to samo, co Subiekt — nic do roboty. */
  bezZmian: number;
  /** Symbol, którego nie ma w kartotece. */
  nieznane: string[];
  /** Adres, który nie przechodzi wzorca albo limitu pola. */
  odrzucone: OdrzuconyWiersz[];
  /**
   * Wiersz, którego zmiana JUŻ CZEKA w kolejce z poprzedniego wgrania.
   *
   * Read-model (`sgt_towar.lokalizacja`) aktualizuje się dopiero po zapisie
   * przez workera, a kolejka idzie jedno zadanie na sekundę — więc arkusz
   * wgrany drugi raz „dla pewności" widzi jeszcze STARE adresy i bez tego
   * licznika zakolejkowałby wszystko po raz drugi. Sto zadań duplikatów nie
   * psuje wyniku (ostatnie i tak wygrywa), ale każe czekać dwa razy dłużej
   * i wygląda w kolejce jak awaria.
   */
  wKolejce: number;
  /** Wypełniane wyłącznie przez `zastosujImport`; przy podglądzie `null`. */
  zakolejkowano: number | null;
}

/**
 * Ile wierszy wolno wgrać naraz.
 *
 * Worker bierze JEDNO zadanie na obrót pętli (`WORKER_POLL_MS`, domyślnie
 * 1200 ms), więc 2000 wierszy to około czterdziestu minut kolejki. Powyżej
 * tego odmawiamy z podaniem liczby — plik wykonujący się godzinami wygląda
 * potem jak zawieszona aplikacja, a nie jak przyjęty import.
 */
export const LIMIT_WIERSZY = 2000;

/** Puste pole adresu znaczy „nie ruszaj tego wiersza", nie „skasuj adres". */
const pusty = (s: string): boolean => s.trim() === "";

/** Statusy zadania, które jeszcze się wykona — te same, co w `locations.ts`. */
const W_TOKU = ["pending", "processing", "waiting_for_doc"];

/**
 * Docelowy adres, który JUŻ czeka w kolejce, per kartoteka.
 *
 * Liczy się OSTATNIE zadanie dla danej kartoteki: wcześniejsze i tak nadpisze.
 * Zadania w `error` pomijamy świadomie — one się nie wykonają bez PONÓW, więc
 * ich cel nie jest niczym obiecanym.
 */
function celeWKolejce(): Map<number, string> {
  const rows = db()
    .prepare(
      `SELECT tw_id, payload FROM sfera_queue
       WHERE type='set_location' AND tw_id IS NOT NULL
         AND status IN (${W_TOKU.map(() => "?").join(",")})
       ORDER BY id`
    )
    .all(...W_TOKU) as Array<{ tw_id: number; payload: string }>;
  const cele = new Map<number, string>();
  for (const r of rows) {
    try {
      const v = (JSON.parse(r.payload) as { newValue?: string }).newValue;
      if (typeof v === "string") cele.set(r.tw_id, v);
    } catch {
      // zadanie z zepsutym payloadem nie jest niczyją obietnicą — pomijamy
    }
  }
  return cele;
}

/**
 * Raport z arkusza. Rzuca wyjątkiem TYLKO wtedy, gdy pliku nie da się przyjąć
 * w całości (za dużo wierszy) — pojedynczy zły wiersz jest treścią raportu,
 * a nie awarią: właściciel ma zobaczyć 124 dobre wiersze obok jednego złego.
 */
export function przeliczImport(wiersze: WierszArkusza[]): RaportImportu {
  if (wiersze.length > LIMIT_WIERSZY) {
    throw new Error(
      `Arkusz ma ${wiersze.length} wierszy, a naraz wolno wgrać ${LIMIT_WIERSZY}. ` +
        "Podziel plik — kolejka zapisów wykonuje jedno zadanie na sekundę."
    );
  }

  const raport: RaportImportu = {
    wierszy: 0,
    doZmiany: [],
    bezZmian: 0,
    nieznane: [],
    odrzucone: [],
    wKolejce: 0,
    zakolejkowano: null,
  };
  const czekaja = celeWKolejce();

  for (const w of wiersze) {
    const symbol = (w.symbol ?? "").trim();
    const zadany = (w.lokalizacja ?? "").trim();
    // Wiersz bez symbolu to zwykle stopka albo pusty wiersz z Excela.
    if (pusty(symbol)) continue;
    raport.wierszy++;

    if (pusty(zadany)) {
      raport.odrzucone.push({
        symbol,
        powod: "Pusta lokalizacja — żeby zdjąć adres, użyj karty towaru",
      });
      continue;
    }

    /* `getProductBySymbol`, a NIE `getProductsBySymbols`: ta druga zwraca
       `ProductRow` z polem już rozbitym przez `parseLocs`, a do audytu
       (`locsPrzed`) potrzebna jest zawartość SUROWA. Wycofanie zmiany polega
       na wpisaniu z powrotem dokładnie tego, co w polu stało — wartość
       zrekonstruowana cofnęłaby przy pierwszej rozbieżności formatowania coś
       innego, niż było. Zapytanie idzie po indeksie, więc 2000 wywołań to
       nadal ułamek milisekundy. */
    const towar = subiekt.getProductBySymbol(symbol);
    if (!towar) {
      raport.nieznane.push(symbol);
      continue;
    }

    const kody = parseLocs(zadany.toUpperCase());
    /* Zły kod odrzuca CAŁY wiersz, a nie sam siebie. „A05-02-02 PAL38II
       A10-06-06" zapisane bez palety byłoby cichym skasowaniem adresu,
       którego nikt nie kazał kasować — a po zapisie nie ma już z czego go
       odtworzyć. */
    const bledny = kody.map((k) => ({ k, err: validateLocationCode(k) })).find((x) => x.err);
    if (bledny) {
      raport.odrzucone.push({ symbol, powod: `„${bledny.k}" — ${bledny.err}` });
      continue;
    }

    const po = kody.join(" ");
    if (po.length > config.locFieldLimit) {
      raport.odrzucone.push({
        symbol,
        powod: `Pole ma ${po.length} znaków, a mieści się ${config.locFieldLimit}`,
      });
      continue;
    }

    /* Porównanie po ZBIORZE kodów, nie po tekście pola: arkusz bywa zapisany
       w innej kolejności albo z podwójną spacją, a to nie jest zmiana adresu.
       Bez tego wgranie własnego eksportu wyglądałoby na 125 zmian. */
    const przed = parseLocs(towar.lokalizacja ?? "");
    const tosamo =
      przed.length === kody.length && przed.every((k) => kody.includes(k));
    if (tosamo) {
      raport.bezZmian++;
      continue;
    }

    /* Ta sama zmiana już czeka w kolejce — nie kolejkujemy jej drugi raz.
       Porównanie po ZBIORZE kodów, jak wyżej: zadanie zapisane w innej
       kolejności prowadzi do tego samego adresu. */
    const wDrodze = parseLocs(czekaja.get(towar.tw_id) ?? "");
    if (wDrodze.length === kody.length && wDrodze.every((k) => kody.includes(k))) {
      raport.wKolejce++;
      continue;
    }

    raport.doZmiany.push({
      symbol: towar.symbol,
      twId: towar.tw_id,
      nazwa: towar.nazwa ?? "",
      przed: towar.lokalizacja ?? "",
      po,
    });
  }

  return raport;
}

/** Kto wykonuje — kształt wzięty z `autorOperacji` w trasach. */
export interface AutorImportu {
  nazwa: string;
  ref?: number | null;
}

/**
 * Kolejkuje zmiany z raportu. JEDNO zadanie na kartotekę, jak z kolektora.
 *
 * Zadanie zbiorcze byłoby kuszące (jedno zamiast stu), ale guard kolejności
 * workera Sfery — „adres przed sprzedawalnością" — działa po KOLUMNIE `tw_id`
 * wiersza kolejki. Zadanie wielopozycyjne prześlizgnęłoby się obok niego
 * i mogłoby wejść po MM, zamiast przed nim.
 *
 * Wpis audytowy emituje `enqueueSetLocation`, nie ta funkcja — inaczej każda
 * zmiana miałaby w dzienniku dwa wpisy.
 */
export function zastosujImport(raport: RaportImportu, autor: AutorImportu): number {
  for (const z of raport.doZmiany) {
    enqueueSetLocation(
      z.twId,
      z.po,
      {
        createdBy: autor.nazwa,
        createdByRef: autor.ref,
        twId: z.twId,
        label: "Lokalizacja · " + z.symbol,
        detail: `${z.przed || "(puste)"} → ${z.po}`,
      },
      {
        locsPrzed: z.przed,
        zrodlo: "arkusz",
        akcja: "replace",
        wartosc: z.po,
      }
    );
  }
  raport.zakolejkowano = raport.doZmiany.length;
  return raport.zakolejkowano;
}
