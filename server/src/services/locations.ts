import { db } from "../db/db.js";
import { subiekt } from "../context.js";
import { config } from "../config.js";
import { parseLocs } from "../locs.js";
import type { PendingLocChange, ProductRow } from "../types.js";

/** Wzorzec EAN — kod towaru, którego NIE wolno zapisać jako lokalizacji. */
const EAN_RE = /^\d{8}$|^\d{12,14}$/;

/**
 * Walidacja kodu lokalizacji (spec §4, §12 + analiza „widmowe lokalizacje").
 * Reguły bazowe działają zawsze (chronią przed mis-skanem etykiety towaru):
 *  - brak pustego / spacji (spacja = separator w polu tw_Lokalizacja),
 *  - kod nie może być EAN-em (skan towaru zamiast etykiety regału),
 *  - kod musi zawierać literę (lokalizacje mają litery A–J/PALETA; EAN nie).
 * Dodatkowo — gdy `locStrict` — twarde dopasowanie do `locFormat`.
 * Zwraca komunikat błędu lub `null` gdy kod jest poprawny.
 */
export function validateLocationCode(raw: string): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  if (!code) return "Pusty kod lokalizacji";
  if (/\s/.test(code)) return "Kod lokalizacji nie może zawierać spacji";
  if (EAN_RE.test(code)) return "To wygląda jak kod towaru (EAN), nie etykieta lokalizacji";
  if (!/[A-Z]/.test(code)) return "Kod lokalizacji musi zawierać literę — to nie wygląda na miejsce";
  if (config.locStrict) {
    try {
      if (!new RegExp(config.locFormat).test(code))
        return "Kod nie pasuje do formatu lokalizacji (np. E08-03-01)";
    } catch {
      /* zły regex w konfiguracji — pomiń twardą walidację formatu */
    }
  }
  return null;
}

/* ── Lokalizacje „w drodze" ─────────────────────────────────────────────────
   Read-model `sgt_towar.lokalizacja` aktualizuje się DOPIERO po udanym zapisie
   przez workera, więc do tego czasu karta towaru pokazuje stan sprzed zmiany:
   dodana lokalizacja nie widnieje nigdzie, usunięta nadal wisi. Przy błędzie
   zapisu ten stan jest TRWAŁY, a jedynym sygnałem zostaje czerwona pastylka
   Sfery — wspólna dla wszystkich zadań, więc nie mówiąca, której lokalizacji
   dotyczy.

   Dla stanów magazynowych aplikacja rozwiązała to dawno (`pendingMmByTw`
   w services/stock.ts, „⏳ N szt w drodze"). To jest ten sam pomysł dla
   drugiego pola.                                                             */

/** Statusy zadania, które jeszcze się wykona (w odróżnieniu od `error`). */
const W_TOKU = ["pending", "processing", "waiting_for_doc"];

/**
 * Co czeka w kolejce dla tej kartoteki, wyrażone jako zmiany POJEDYNCZYCH kodów.
 *
 * Payload `set_location` niesie `newValue` — CAŁE pole po sklejeniu, nie
 * pojedynczy kod. Zmianę trzeba więc wyprowadzić różnicą: ostatnie zadanie
 * w toku (najwyższe `id`) opisuje stan docelowy, a porównanie z bieżącym daje
 * kody dochodzące i schodzące. Zadania w `error` liczone są osobno, bo one się
 * NIE wykonają bez PONÓW — niosą inny komunikat niż „czekaj".
 */
export function pendingLocChanges(twId: number, current: string[]): PendingLocChange[] {
  const rows = db()
    .prepare(
      `SELECT id, payload, status FROM sfera_queue
       WHERE type='set_location' AND tw_id=? AND status IN (${W_TOKU.map(() => "?").join(",")},'error')
       ORDER BY id`
    )
    .all(twId, ...W_TOKU) as Array<{ id: number; payload: string; status: string }>;
  if (!rows.length) return [];

  const target = (r: { payload: string }): string[] | null => {
    try {
      return parseLocs((JSON.parse(r.payload) as { newValue?: string }).newValue ?? "");
    } catch {
      return null;
    }
  };

  const out: PendingLocChange[] = [];
  const add = (code: string, kind: "add" | "remove", status: "pending" | "error", queueId: number) => {
    // jeden kod, jeden komunikat — błąd ma pierwszeństwo nad „czekaj"
    const been = out.find((p) => p.code === code);
    if (been) {
      if (status === "error") Object.assign(been, { kind, status, queueId });
      return;
    }
    out.push({ code, kind, status, queueId });
  };

  // błędy: każde zadanie osobno, bo każde wymaga osobnego PONÓW
  for (const r of rows.filter((r) => r.status === "error")) {
    const t = target(r);
    if (!t) continue;
    for (const c of t) if (!current.includes(c)) add(c, "add", "error", r.id);
    for (const c of current) if (!t.includes(c)) add(c, "remove", "error", r.id);
  }

  // w toku: liczy się WYNIK, czyli ostatnie zadanie — wcześniejsze i tak nadpisze
  const last = rows.filter((r) => r.status !== "error").at(-1);
  if (last) {
    const t = target(last);
    if (t) {
      for (const c of t) if (!current.includes(c)) add(c, "add", "pending", last.id);
      for (const c of current) if (!t.includes(c)) add(c, "remove", "pending", last.id);
    }
  }
  return out;
}

/** Wykaz istniejących kodów lokalizacji (słownik) — do ostrzeżeń o kodzie spoza wykazu. */
export function listLocations(): string[] {
  return subiekt.listLocations();
}

/**
 * Zawartość półki — z uwzględnieniem tego, co jest w drodze.
 *
 * Sam read-model pokazałby stan sprzed zmiany: towar, który właśnie „przyjechał"
 * na tę półkę, jeszcze się nie pojawia, a ten, który z niej schodzi, wciąż na
 * niej wisi. To ten sam problem co na karcie towaru, tylko oglądany z drugiej
 * strony — więc i odpowiedź jest ta sama.
 */
export function getProductsByLocation(code: string): ProductRow[] {
  const kod = code.trim().toUpperCase();
  const rows = subiekt.getProductsByLocation(kod);

  const mark = (r: ProductRow): ProductRow => {
    const zmiana = pendingLocChanges(r.id, r.locs).find((p) => p.code === kod);
    return zmiana
      ? { ...r, pendingHere: zmiana.status === "error" ? "error" : zmiana.kind }
      : { ...r, pendingHere: null };
  };
  const out = rows.map(mark);

  // Towary DOJEŻDŻAJĄCE na tę półkę nie są jeszcze w read-modelu, więc nie
  // wyszłyby z zapytania po kartotece — trzeba je dobrać z kolejki.
  const jadace = db()
    .prepare(
      `SELECT DISTINCT tw_id FROM sfera_queue
       WHERE type='set_location' AND tw_id IS NOT NULL
         AND status IN (${W_TOKU.map(() => "?").join(",")},'error')`
    )
    .all(...W_TOKU) as Array<{ tw_id: number }>;
  for (const { tw_id } of jadace) {
    if (out.some((r) => r.id === tw_id)) continue;
    const t = subiekt.getProductById(tw_id);
    if (!t) continue;
    const locs = parseLocs(t.lokalizacja);
    const zmiana = pendingLocChanges(tw_id, locs).find((p) => p.code === kod && p.kind === "add");
    if (!zmiana) continue;
    const stan = (m: number) => subiekt.getStock(tw_id, m).stan;
    out.push({
      id: tw_id,
      sym: t.symbol,
      name: t.nazwa,
      ean: t.ean ?? "",
      mag: stan(config.magId.MAG),
      mgp: stan(config.magId.MGP),
      locs,
      pendingHere: zmiana.status === "error" ? "error" : "add",
    });
  }
  return out;
}
