import { db } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { parseLocs } from "../locs.js";
import { wierszCsv, zbudujCsv } from "./csv.js";

/* ── Nocna rekoncyliacja (plan §9) ──────────────────────────────────────────
   Aplikacja pisze do SGT przez kolejkę, ale NIKT nie sprawdzał, czy stan po
   stronie Subiekta odpowiada temu, co aplikacja myśli, że zapisała.

   To jest tania obrona przed cichym błędem: kod się kompiluje, działa, wygląda
   dobrze i przez trzy tygodnie rozjeżdża dane. Wszystkie trzy kontrole
   pytają o to samo — czy deklarowany niezmiennik jeszcze obowiązuje. Bo
   niezmienniki trzeba MIERZYĆ, nie deklarować.

   Zerowy wynik = zero raportu. Raport, który przychodzi codziennie, przestaje
   być czytany po tygodniu — a wtedy nie chroni już przed niczym.             */

export interface Rozjazd {
  rodzaj: "lokalizacja" | "zadanie_w_bledzie" | "utknelo_w_buforze" | "mm_czeka";
  klucz: string;
  opis: string;
  odKiedy: string | null;
}

export interface Rekoncyliacja {
  at: string;
  sprawdzono: { kartotek: number; zadan: number };
  rozjazdy: Rozjazd[];
}

/** 1. Adres w Subiekcie vs ostatni udany zapis aplikacji (24 h). */
function lokalizacje(): { rozjazdy: Rozjazd[]; sprawdzono: number } {
  const zadania = db()
    .prepare(
      `SELECT tw_id, payload, MAX(processed_at) AS at FROM sfera_queue
       WHERE type='set_location' AND status='done' AND tw_id IS NOT NULL
         AND processed_at >= datetime('now','-1 day')
       GROUP BY tw_id`
    )
    .all() as Array<{ tw_id: number; payload: string; at: string }>;

  const rozjazdy: Rozjazd[] = [];
  for (const z of zadania) {
    let oczekiwane: string[];
    try {
      oczekiwane = parseLocs((JSON.parse(z.payload) as { newValue?: string }).newValue ?? "");
    } catch {
      continue;
    }
    const t = subiekt.getProductById(z.tw_id);
    if (!t) continue;
    const rzeczywiste = parseLocs(t.lokalizacja);
    // porównanie po ZBIORZE kodów, nie po całym polu: kolejność ma znaczenie
    // tylko dla pierwszego (pickingowego), a jego pilnuje osobno tryb A
    const rowne =
      oczekiwane.length === rzeczywiste.length &&
      oczekiwane.every((c) => rzeczywiste.includes(c));
    if (!rowne) {
      rozjazdy.push({
        rodzaj: "lokalizacja",
        klucz: t.symbol,
        opis: `aplikacja zapisała „${oczekiwane.join(" ") || "(puste)"}”, w Subiekcie „${
          rzeczywiste.join(" ") || "(puste)"
        }”`,
        odKiedy: z.at,
      });
    }
  }
  return { rozjazdy, sprawdzono: zadania.length };
}

/** 2. Zadania w `error` starsze niż 24 h — nikt ich nie ponowił. */
function zadaniaWBledzie(): Rozjazd[] {
  const rows = db()
    .prepare(
      `SELECT id, type, label, error_msg, processed_at FROM sfera_queue
       WHERE status='error' AND processed_at < datetime('now','-1 day')
       ORDER BY id`
    )
    .all() as Array<{
    id: number;
    type: string;
    label: string;
    error_msg: string | null;
    processed_at: string;
  }>;
  return rows.map((r) => ({
    rodzaj: "zadanie_w_bledzie" as const,
    klucz: `#${r.id} ${r.type}`,
    opis: `${r.label} — ${r.error_msg ?? "bez komunikatu"}`,
    odKiedy: r.processed_at,
  }));
}

/** 3. `waiting_for_doc` starsze niż 72 h — dokument raczej nie wyjdzie z bufora. */
function utknieteWBuforze(): Rozjazd[] {
  const rows = db()
    .prepare(
      `SELECT id, label, source_doc_id, created_at FROM sfera_queue
       WHERE status='waiting_for_doc' AND created_at < datetime('now','-3 days')
       ORDER BY id`
    )
    .all() as Array<{ id: number; label: string; source_doc_id: number | null; created_at: string }>;
  return rows.map((r) => ({
    rodzaj: "utknelo_w_buforze" as const,
    klucz: `#${r.id}`,
    opis: `${r.label} — dokument ${r.source_doc_id ?? "?"} nie wyszedł z bufora od 3 dni; ktoś musi spojrzeć`,
    odKiedy: r.created_at,
  }));
}

/**
 * 4. MM czekające ponad dobę — worker Sfery nie działa albo zadanie blokuje
 *    guard kolejności (zapis lokalizacji tego samego towaru w błędzie).
 *
 * Ten wpis domyka decyzję z guardu w `sfera-worker/sql/`: poprzednik
 * `set_location` w `error` BLOKUJE MM w nieskończoność — świadomie, bo stan
 * bezpieczny to „adres zapisany, stan czeka". Blokada bez tego pomiaru byłaby
 * jednak cichym zakleszczeniem; tu dostaje nazwisko i instrukcję.
 */
function mmCzekajace(): Rozjazd[] {
  /* Tylko przy SFERA_WORKER=1 — bez przełącznika mm wykonuje (albo ubija
     czytelnym błędem) worker Node, więc wiszący pending znaczy „zatrzymany
     worker", a to melduje już /api/health. Zdanie o Sferze by tu myliło. */
  if (!config.sferaWorker) return [];
  /* strftime w formacie ISO, nie datetime(): created_at ma `T…Z`, datetime()
     spację — leksykalnie kłamią w obrębie tego samego dnia (patrz zaleglosciMm). */
  const rows = db()
    .prepare(
      `SELECT id, label, created_at FROM sfera_queue
       WHERE type='mm' AND status IN ('pending','waiting_for_doc')
         AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
       ORDER BY id`
    )
    .all() as Array<{ id: number; label: string; created_at: string }>;
  return rows.map((r) => ({
    rodzaj: "mm_czeka" as const,
    klucz: `#${r.id}`,
    opis:
      `${r.label} — MM czeka ponad dobę: worker Sfery nie działa albo zadanie ` +
      "blokuje błąd zapisu lokalizacji (PONÓW lokalizację na kolektorze)",
    odKiedy: r.created_at,
  }));
}

export function reconcile(): Rekoncyliacja {
  const loc = lokalizacje();
  const bledy = zadaniaWBledzie();
  const bufor = utknieteWBuforze();
  const mm = mmCzekajace();
  return {
    at: new Date().toISOString(),
    sprawdzono: {
      kartotek: loc.sprawdzono,
      zadan: bledy.length + bufor.length + mm.length,
    },
    rozjazdy: [...loc.rozjazdy, ...bledy, ...bufor, ...mm],
  };
}

/** CSV jak eksport wyjątków: `;` + BOM, żeby Excel PL otworzył bez kreatora. */
export function reconcileCsv(r: Rekoncyliacja): string {
  const linie = [
    ["rodzaj", "klucz", "opis", "od_kiedy"].join(";"),
    ...r.rozjazdy.map((x) => wierszCsv([x.rodzaj, x.klucz, x.opis, x.odKiedy ?? ""], ";")),
  ];
  return zbudujCsv(linie);
}
