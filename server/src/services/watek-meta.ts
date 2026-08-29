import { db, nowIso } from "../db/db.js";
import type { WiadomoscAllegro, WiadomoscDyskusji } from "../adapters/allegro.js";

/* ── Metadane wątku — piłka bez treści (0.127.0) ─────────────────────────────
   Fundament „kto ma piłkę" z docs/architektura-spraw.md: kto powiedział
   ostatnie słowo, kiedy i ile wiadomości padło. Treści NIE zapisujemy —
   listy wiadomości przelatują tędy tylko po to, żeby policzyć metadane.

   Upsert meta NIE woła logEvent — świadomy wyjątek od „każda mutacja woła
   logEvent": meta to projekcja operacji już zalogowanej (sync, wysyłka)
   albo cache tego, co człowiek właśnie przeczytał na klik; osobne zdarzenie
   podwajałoby dziennik bez nowej informacji.                                 */

export type RodzajWatku = "pytanie" | "dyskusja";
export type ZrodloMeta = "sync" | "odczyt" | "wysylka";

export interface MetaWatku {
  rodzaj: RodzajWatku;
  allegroId: string;
  ostatniGlos: "my" | "klient" | "allegro" | null;
  ostatniaAt: string | null;
  ostatniaKlientId: string | null;
  wiadomosci: number | null;
  zrodlo: ZrodloMeta;
  aktualizowanoAt: string;
}

function upsert(
  rodzaj: RodzajWatku,
  allegroId: string,
  pola: {
    ostatniGlos: string | null;
    ostatniaAt: string | null;
    ostatniaKlientId: string | null;
    wiadomosci: number | null;
  },
  zrodlo: ZrodloMeta
): void {
  db()
    .prepare(
      `INSERT INTO watek_meta
         (rodzaj, allegro_id, ostatni_glos, ostatnia_at, ostatnia_klient_id,
          wiadomosci, zrodlo, aktualizowano_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(rodzaj, allegro_id) DO UPDATE SET
         ostatni_glos = excluded.ostatni_glos,
         ostatnia_at = excluded.ostatnia_at,
         ostatnia_klient_id = COALESCE(excluded.ostatnia_klient_id, watek_meta.ostatnia_klient_id),
         wiadomosci = COALESCE(excluded.wiadomosci, watek_meta.wiadomosci),
         zrodlo = excluded.zrodlo,
         aktualizowano_at = excluded.aktualizowano_at`
    )
    .run(
      rodzaj,
      allegroId,
      pola.ostatniGlos,
      pola.ostatniaAt,
      pola.ostatniaKlientId,
      pola.wiadomosci,
      zrodlo,
      nowIso()
    );
}

/** Metadane z rozmowy dyskusji — lista przychodzi od najstarszej. */
export function zapiszMetaDyskusji(
  allegroId: string,
  wiadomosci: WiadomoscDyskusji[],
  zrodlo: ZrodloMeta
): void {
  if (wiadomosci.length === 0) return;
  const ostatnia = wiadomosci[wiadomosci.length - 1];
  /* ALLEGRO_ADVISOR to trzeci głos w sprawie — ani my, ani klient. */
  const glos = ostatnia.odNas
    ? "my"
    : ostatnia.autorRola === "ALLEGRO_ADVISOR"
      ? "allegro"
      : "klient";
  /* `ostatnia_klient_id` to PUNKT ODNIESIENIA kontroli świeżości, więc liczy
     każdy CUDZY głos — także mediatora Allegro. Filtrowanie advisora (jak
     przy `ostatni_glos`, gdzie ma własne znaczenie) zapętlało wysyłkę:
     rozmowa kończąca się głosem mediatora dawała 409 nawet po przeczytaniu,
     bo punkt odniesienia cofał się do wcześniejszej wiadomości klienta. */
  const odKlienta = wiadomosci.filter((m) => !m.odNas);
  upsert(
    "dyskusja",
    allegroId,
    {
      ostatniGlos: glos,
      ostatniaAt: ostatnia.at,
      ostatniaKlientId: odKlienta.length > 0 ? odKlienta[odKlienta.length - 1].id : null,
      wiadomosci: wiadomosci.length,
    },
    zrodlo
  );
}

/** Metadane z rozmowy pytania (Centrum wiadomości) — lista od najstarszej. */
export function zapiszMetaPytania(
  threadId: string,
  wiadomosci: WiadomoscAllegro[],
  zrodlo: ZrodloMeta
): void {
  if (wiadomosci.length === 0) return;
  const ostatnia = wiadomosci[wiadomosci.length - 1];
  const odKlienta = wiadomosci.filter((m) => m.odKupujacego);
  upsert(
    "pytanie",
    threadId,
    {
      ostatniGlos: ostatnia.odKupujacego ? "klient" : "my",
      ostatniaAt: ostatnia.at,
      ostatniaKlientId: odKlienta.length > 0 ? odKlienta[odKlienta.length - 1].id : null,
      wiadomosci: wiadomosci.length,
    },
    zrodlo
  );
}

/**
 * Stempel po naszej wysyłce, gdy rozmowy nie pobraliśmy (degradacja kontroli
 * świeżości): wiemy tylko tyle, że ostatnie słowo padło od nas — licznik
 * i id klienta zostają, jakie były.
 */
export function stempelWyslano(rodzaj: RodzajWatku, allegroId: string): void {
  upsert(
    rodzaj,
    allegroId,
    { ostatniGlos: "my", ostatniaAt: nowIso(), ostatniaKlientId: null, wiadomosci: null },
    "wysylka"
  );
}

export function metaWatku(rodzaj: RodzajWatku, allegroId: string): MetaWatku | null {
  const w = db()
    .prepare(
      `SELECT rodzaj, allegro_id, ostatni_glos, ostatnia_at, ostatnia_klient_id,
              wiadomosci, zrodlo, aktualizowano_at
         FROM watek_meta WHERE rodzaj = ? AND allegro_id = ?`
    )
    .get(rodzaj, allegroId) as
    | {
        rodzaj: RodzajWatku;
        allegro_id: string;
        ostatni_glos: "my" | "klient" | "allegro" | null;
        ostatnia_at: string | null;
        ostatnia_klient_id: string | null;
        wiadomosci: number | null;
        zrodlo: ZrodloMeta;
        aktualizowano_at: string;
      }
    | undefined;
  if (!w) return null;
  return {
    rodzaj: w.rodzaj,
    allegroId: w.allegro_id,
    ostatniGlos: w.ostatni_glos,
    ostatniaAt: w.ostatnia_at,
    ostatniaKlientId: w.ostatnia_klient_id,
    wiadomosci: w.wiadomosci,
    zrodlo: w.zrodlo,
    aktualizowanoAt: w.aktualizowano_at,
  };
}

/**
 * Wszystkie metadane jednego rodzaju naraz (0.129.0) — pod projekcję piłki
 * w kolejce. Tabela ma jeden wiersz na wątek, więc pełny odczyt jest tańszy
 * niż zapytanie per wiersz kolejki (ten sam wzorzec co `mapaZrodel`).
 */
export function metaHurtem(rodzaj: RodzajWatku): Map<string, MetaWatku> {
  const wiersze = db()
    .prepare(
      `SELECT rodzaj, allegro_id, ostatni_glos, ostatnia_at, ostatnia_klient_id,
              wiadomosci, zrodlo, aktualizowano_at
         FROM watek_meta WHERE rodzaj = ?`
    )
    .all(rodzaj) as Array<Record<string, unknown>>;
  const mapa = new Map<string, MetaWatku>();
  for (const w of wiersze) {
    mapa.set(w.allegro_id as string, {
      rodzaj: w.rodzaj as RodzajWatku,
      allegroId: w.allegro_id as string,
      ostatniGlos: (w.ostatni_glos as MetaWatku["ostatniGlos"]) ?? null,
      ostatniaAt: (w.ostatnia_at as string | null) ?? null,
      ostatniaKlientId: (w.ostatnia_klient_id as string | null) ?? null,
      wiadomosci: (w.wiadomosci as number | null) ?? null,
      zrodlo: w.zrodlo as ZrodloMeta,
      aktualizowanoAt: w.aktualizowano_at as string,
    });
  }
  return mapa;
}
