import { db } from "../db/db.js";
import { cachedByDbVersion } from "./cache.js";
import { subiekt } from "../context.js";
import { config } from "../config.js";
import { parseLocs } from "../locs.js";
import { matchesLocPattern } from "../scan.js";
import type { PendingLocChange, ProductRow } from "../types.js";

/** Wzorzec EAN — kod towaru, którego NIE wolno zapisać jako lokalizacji. */
const EAN_RE = /^\d{8}$|^\d{12,14}$/;

/**
 * Komunikat o niedopasowaniu do wzorca — nazywa rzecz po imieniu.
 *
 * Kod z zerem albo jednym myślnikiem to niemal zawsze SYMBOL towaru
 * (`W32-0203`, `50-111`), czyli mis-skan etykiety towaru zamiast regału. Adres
 * regału ma zawsze dwa myślniki, a paleta — jedna, ale z prefiksem `PAL` — i tak
 * przechodzi wzorzec, więc tu nie trafia. Zdanie „nie pasuje do formatu" zostawia
 * człowieka z pytaniem, co zrobił źle; „to kod towaru" mówi mu to wprost.
 */
function wrongShape(code: string): string {
  const dashes = (code.match(/-/g) ?? []).length;
  if (dashes <= 1 && !code.startsWith("PAL")) return "To kod towaru, nie etykieta regału";
  return `Kod „${code}" nie jest poprawnym adresem (regał A01-02-03 albo paleta PAL-042)`;
}

/**
 * Walidacja kodu lokalizacji (spec §4, §12 + plan §1).
 * Reguły bazowe działają zawsze (chronią przed mis-skanem etykiety towaru):
 *  - brak pustego / spacji (spacja = separator w polu tw_Lokalizacja),
 *  - kod nie może być EAN-em (skan towaru zamiast etykiety regału).
 * Dodatkowo — gdy `locStrict` (domyślnie WŁĄCZONE) — twarde dopasowanie do
 * wzorca z `config.locPatterns`, wspólnego dla serwera i kolektora.
 *
 * Reguła „musi zawierać literę" została usunięta: przepuszczała całą rodzinę
 * symboli towarów, a nie chroniła przed niczym, czego nie łapie wzorzec.
 * Zwraca komunikat błędu lub `null` gdy kod jest poprawny.
 */
export function validateLocationCode(raw: string): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  if (!code) return "Pusty kod lokalizacji";
  if (/\s/.test(code)) return "Kod lokalizacji nie może zawierać spacji";
  if (EAN_RE.test(code)) return "To wygląda jak kod towaru (EAN), nie etykieta lokalizacji";
  if (config.locStrict && !matchesLocPattern(code)) return wrongShape(code);
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
    .all(twId, ...W_TOKU) as unknown as ZadanieLoc[];
  return pendingLocChangesFrom(rows, current);
}

/** Wiersz kolejki `set_location` w kształcie, jakiego potrzebuje różnica pól. */
interface ZadanieLoc {
  id: number;
  payload: string;
  status: string;
}

/**
 * Ta sama różnica, liczona z wierszy już odczytanych. Zawartość półki pyta
 * o zmiany dla KAŻDEGO towaru z listy — jeden odczyt całej kolejki i podział
 * po `tw_id` zamiast zapytania na wiersz (`getProductsByLocation`).
 */
export function pendingLocChangesFrom(rows: ZadanieLoc[], current: string[]): PendingLocChange[] {
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

/**
 * Wykaz istniejących kodów lokalizacji (słownik) — do ostrzeżeń o kodzie spoza
 * wykazu. Budowa to pełny skan `sgt_towar`, a wynik zmienia się tylko przy
 * imporcie i przy zapisie lokalizacji przez workera — do tego czasu odpowiada
 * cache (`cache.ts`).
 */
export function listLocations(): string[] {
  return cachedByDbVersion("locations", () => subiekt.listLocations());
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

  // Cała kolejka `set_location` jednym odczytem — półka odświeża się co 2 s,
  // a wierszy potrafi być 200; zapytanie na wiersz zjadało cały budżet.
  const zadania = db()
    .prepare(
      `SELECT id, tw_id, payload, status FROM sfera_queue
       WHERE type='set_location' AND tw_id IS NOT NULL
         AND status IN (${W_TOKU.map(() => "?").join(",")},'error')
       ORDER BY id`
    )
    .all(...W_TOKU) as Array<{ id: number; tw_id: number; payload: string; status: string }>;
  const poTowarze = new Map<number, typeof zadania>();
  for (const z of zadania) {
    const grupa = poTowarze.get(z.tw_id);
    if (grupa) grupa.push(z);
    else poTowarze.set(z.tw_id, [z]);
  }

  const mark = (r: ProductRow): ProductRow => {
    const zmiana = pendingLocChangesFrom(poTowarze.get(r.id) ?? [], r.locs).find(
      (p) => p.code === kod
    );
    return zmiana
      ? { ...r, pendingHere: zmiana.status === "error" ? "error" : zmiana.kind }
      : { ...r, pendingHere: null };
  };
  const out = rows.map(mark);

  // Towary DOJEŻDŻAJĄCE na tę półkę nie są jeszcze w read-modelu, więc nie
  // wyszłyby z zapytania po kartotece — trzeba je dobrać z kolejki.
  for (const tw_id of poTowarze.keys()) {
    if (out.some((r) => r.id === tw_id)) continue;
    const t = subiekt.getProductById(tw_id);
    if (!t) continue;
    const locs = parseLocs(t.lokalizacja);
    const zmiana = pendingLocChangesFrom(poTowarze.get(tw_id) ?? [], locs).find(
      (p) => p.code === kod && p.kind === "add"
    );
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
