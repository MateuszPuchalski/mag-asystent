import { db } from "../db/db.js";
import { metaWatku, type MetaWatku } from "./watek-meta.js";

/* ── Kanały odpowiedzi w sprawie (0.131.0) ───────────────────────────────────
   Etap D3 z docs/architektura-spraw.md. Sprawa bywa złożona z kilku obiektów
   Allegro, ale ODPOWIEDZIEĆ da się tylko przez niektóre z nich: przez wątek
   pytania i przez dyskusję. Zwrot i reklamacja niosą mechanikę (pozycje,
   kosze, korekty), nie rozmowę — do klienta nie mówi się „przez zwrot".

   Ten moduł odpowiada na jedno pytanie panelu: gdzie mam napisać, stojąc
   w TEJ sprawie. Bez niego agent oceniający zwrot musiał zgadnąć, że klient
   czeka w dyskusji, i przejść na drugi ekran, żeby to sprawdzić.

   Kanał POLECANY to ten, w którym klient odezwał się ostatni — a nie ten,
   który akurat otworzył ekran. Metadane biorą się z `watek_meta`, więc
   wskazanie nie wymaga ani jednego zapytania do Allegro.

   WYŁĄCZNIE ODCZYT: wysyłką dalej zajmują się trasy rejestrów, każda ze
   swoją kontrolą świeżości i swoim zdarzeniem w dzienniku.                  */

export type RodzajKanalu = "pytanie" | "dyskusja";

export interface KanalOdpowiedzi {
  rodzaj: RodzajKanalu;
  /** Id w rejestrze — tym samym, do którego panel wyśle odpowiedź. */
  id: number;
  /** Co pokazać na przycisku: PYTANIE, DYSKUSJA albo CLAIM. */
  etykieta: string;
  /** Temat dyskusji albo tytuł oferty pytania — po czym człowiek je pozna. */
  tytul: string | null;
  ostatniGlos: MetaWatku["ostatniGlos"];
  ostatniaAt: string | null;
  wiadomosci: number | null;
  /** Kanał, w którym klient odezwał się ostatni; przy jednym kanale zawsze on. */
  polecany: boolean;
}

export interface KanalyWSprawie {
  /** Encja sprawy; null = pseudo-sprawa bez wiązania (patrz services/sprawa.ts). */
  sprawaId: number | null;
  kanaly: KanalOdpowiedzi[];
}

/** Otwarte źródła sprawy tego samego rodzaju co kolejka (services/sprawy.ts). */
const OTWARTE = {
  pytanie: "status IN ('nowe','szkic')",
  dyskusja: "status IN ('nowa','w_toku')",
} as const;

function kanalPytania(id: number): KanalOdpowiedzi | null {
  const w = db()
    .prepare(
      `SELECT id, thread_id, oferta_tytul, tresc FROM pytanie
        WHERE id = ? AND ${OTWARTE.pytanie}`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!w) return null;
  /* Wklejka nie ma `thread_id` i nie ma dokąd odpisać — kanałem nie jest,
     choć sprawą jest jak najbardziej. */
  const threadId = (w.thread_id as string | null) ?? null;
  if (!threadId) return null;
  const meta = metaWatku("pytanie", threadId);
  return {
    rodzaj: "pytanie",
    id: w.id as number,
    etykieta: "PYTANIE",
    tytul: (w.oferta_tytul as string | null) ?? null,
    ostatniGlos: meta?.ostatniGlos ?? null,
    ostatniaAt: meta?.ostatniaAt ?? null,
    wiadomosci: meta?.wiadomosci ?? null,
    polecany: false,
  };
}

function kanalDyskusji(id: number): KanalOdpowiedzi | null {
  const w = db()
    .prepare(
      `SELECT id, allegro_id, typ, temat FROM dyskusja
        WHERE id = ? AND ${OTWARTE.dyskusja}`
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!w) return null;
  const meta = metaWatku("dyskusja", w.allegro_id as string);
  return {
    rodzaj: "dyskusja",
    id: w.id as number,
    /* CLAIM ma ustawowy zegar i inną wagę niż zwykła dyskusja — ta różnica
       jest w kolejce od 0.121.0 i przy odpowiedzi też musi być widoczna. */
    etykieta: (w.typ as string | null) === "CLAIM" ? "CLAIM" : "DYSKUSJA",
    tytul: (w.temat as string | null) ?? null,
    ostatniGlos: meta?.ostatniGlos ?? null,
    ostatniaAt: meta?.ostatniaAt ?? null,
    wiadomosci: meta?.wiadomosci ?? null,
    polecany: false,
  };
}

/**
 * Kanały odpowiedzi CAŁEJ sprawy, o którą pyta panel. Wejściem jest źródło,
 * bo tyle wie każdy szczegół; źródło bez wiązania odpowiada za siebie samo.
 */
export function kanalyOdpowiedzi(
  rodzaj: "pytanie" | "zwrot" | "dyskusja" | "reklamacja" | "opinia",
  lokalnyId: number
): KanalyWSprawie {
  const d = db();
  const wiazanie = d
    .prepare("SELECT sprawa_id FROM sprawa_zrodlo WHERE rodzaj = ? AND lokalny_id = ?")
    .get(rodzaj, lokalnyId) as { sprawa_id: number } | undefined;

  const zrodla = wiazanie
    ? (d
        .prepare("SELECT rodzaj, lokalny_id FROM sprawa_zrodlo WHERE sprawa_id = ?")
        .all(wiazanie.sprawa_id) as Array<Record<string, unknown>>
      ).map((w) => ({ rodzaj: w.rodzaj as string, lokalnyId: w.lokalny_id as number }))
    : [{ rodzaj, lokalnyId }];

  const kanaly: KanalOdpowiedzi[] = [];
  for (const z of zrodla) {
    const kanal =
      z.rodzaj === "pytanie"
        ? kanalPytania(z.lokalnyId)
        : z.rodzaj === "dyskusja"
          ? kanalDyskusji(z.lokalnyId)
          : null;
    if (kanal) kanaly.push(kanal);
  }

  /* Polecenie liczy się z OSTATNIEGO GŁOSU KLIENTA, nie z wieku sprawy:
     pytanie sprzed tygodnia, w którym klient właśnie dopisał, bije dyskusję
     założoną wczoraj i milczącą od tamtej pory. Bez metadanych zostaje
     kolejność źródeł — wtedy poleca się pierwszy otwarty kanał, żeby pole
     odpowiedzi nigdy nie stało bez adresata. */
  const czeka = (k: KanalOdpowiedzi) => k.ostatniGlos === "klient" || k.ostatniGlos === "allegro";
  const czekajace = kanaly.filter(czeka);
  const wybrany = czekajace.length
    ? czekajace.reduce((a, b) => ((a.ostatniaAt ?? "") >= (b.ostatniaAt ?? "") ? a : b))
    : kanaly[0];
  if (wybrany) wybrany.polecany = true;

  return { sprawaId: wiazanie?.sprawa_id ?? null, kanaly };
}
