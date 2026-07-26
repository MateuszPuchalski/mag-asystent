import { db } from "../db/db.js";
import { subiekt } from "../context.js";
import { config } from "../config.js";
import { parseLocs } from "../locs.js";

/* ── Nocna rekoncyliacja (plan §9) ──────────────────────────────────────────
   Aplikacja pisze do SGT przez kolejkę, ale NIKT nie sprawdzał, czy stan po
   stronie Subiekta odpowiada temu, co aplikacja myśli, że zapisała.

   To jest tania obrona przed cichym błędem: kod się kompiluje, działa, wygląda
   dobrze i przez trzy tygodnie rozjeżdża dane. Wszystkie cztery kontrole
   pytają o to samo — czy deklarowany niezmiennik jeszcze obowiązuje. Bo
   niezmienniki trzeba MIERZYĆ, nie deklarować.

   Zerowy wynik = zero raportu. Raport, który przychodzi codziennie, przestaje
   być czytany po tygodniu — a wtedy nie chroni już przed niczym.             */

export interface Rozjazd {
  rodzaj: "lokalizacja" | "zadanie_w_bledzie" | "utknelo_w_buforze" | "koszyk_bez_mm";
  klucz: string;
  opis: string;
  odKiedy: string | null;
}

export interface Rekoncyliacja {
  at: string;
  sprawdzono: { kartotek: number; zadan: number; koszykow: number };
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
 * 4. Koszyki zwrotów rozłożone, ale bez MM, starsze niż 24 h.
 *
 * README opisuje „adres przed sprzedawalnością" jako niezmiennik. Koszyk bez MM
 * to dokładnie ten stan po bezpiecznej stronie — towar leży z adresem, ale
 * jeszcze nie jest sprzedawalny. Bezpieczny nie znaczy jednak „może tak zostać
 * na zawsze": po dobie to utracona sprzedaż, o której nikt nie wie.
 */
function koszykiBezMm(): { rozjazdy: Rozjazd[]; sprawdzono: number } {
  const rows = db()
    .prepare(
      `SELECT d.sgt_dok_numer AS dok, l.koszyk,
              SUM(l.ilosc_odlozona - l.mm_ilosc) AS zaleglosc,
              MIN(l.done_at) AS od
       FROM delivery_line l JOIN delivery d ON d.id = l.delivery_id
       WHERE l.koszyk IS NOT NULL AND l.ilosc_odlozona > l.mm_ilosc
         AND d.source_mag_id IS NOT NULL AND d.source_mag_id <> ?
       GROUP BY d.id, l.koszyk
       HAVING od < datetime('now','-1 day')`
    )
    .all(config.magId.MAG) as Array<{
    dok: string;
    koszyk: string;
    zaleglosc: number;
    od: string;
  }>;
  return {
    sprawdzono: rows.length,
    rozjazdy: rows.map((r) => ({
      rodzaj: "koszyk_bez_mm" as const,
      klucz: `${r.dok} / koszyk ${r.koszyk}`,
      opis: `${r.zaleglosc} szt. leży na półce z adresem, ale wciąż na magazynie Zwroty — brak MM`,
      odKiedy: r.od,
    })),
  };
}

export function reconcile(): Rekoncyliacja {
  const loc = lokalizacje();
  const bledy = zadaniaWBledzie();
  const bufor = utknieteWBuforze();
  const kosz = koszykiBezMm();
  return {
    at: new Date().toISOString(),
    sprawdzono: {
      kartotek: loc.sprawdzono,
      zadan: bledy.length + bufor.length,
      koszykow: kosz.sprawdzono,
    },
    rozjazdy: [...loc.rozjazdy, ...bledy, ...bufor, ...kosz.rozjazdy],
  };
}

/** CSV jak eksport wyjątków: `;` + BOM, żeby Excel PL otworzył bez kreatora. */
export function reconcileCsv(r: Rekoncyliacja): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linie = [
    ["rodzaj", "klucz", "opis", "od_kiedy"].join(";"),
    ...r.rozjazdy.map((x) => [x.rodzaj, x.klucz, x.opis, x.odKiedy ?? ""].map(esc).join(";")),
  ];
  return "﻿" + linie.join("\r\n") + "\r\n";
}
