import type { DatabaseSync } from "node:sqlite";

/* ── Lista „Pasuje do" oferty dla ekranu rozmowy ─────────────────────────────
   Listę mamy w `offer_snapshot.pasuje_do_json`, a czytał ją wyłącznie model.
   Agent ma ją widzieć obok rozmowy, bo klient pyta właśnie o to, czy część
   pasuje do jego maszyny.

   Lista to DEKLARACJA SPRZEDAWCY, nie pomiar. Brak maszyny na liście nie
   jest dowodem, że część nie pasuje — lista bywa niepełna. */

export interface ZgodnoscOferty {
  /** Cała lista z oferty, w kolejności Allegro. */
  lista: string[];
}

/**
 * Lista zgodności oferty — CZYSTY ODCZYT snapshotu.
 *
 * `null`, gdy treści oferty nigdy nie pobrano albo lista jest pusta. Treść
 * dociąga wyłącznie układanie szkicu (`dociagnijTresc`), nie otwarcie
 * rozmowy — zero zapisu przy patrzeniu.
 */
export function zgodnoscOferty(
  database: DatabaseSync, konto: number, ofertaId: string,
): ZgodnoscOferty | null {
  const w = database.prepare(`SELECT pasuje_do_json FROM offer_snapshot
      WHERE channel_account_id=? AND external_id=?`).get(konto, ofertaId) as
    { pasuje_do_json: string | null } | undefined;
  let lista: string[] = [];
  try { lista = JSON.parse(w?.pasuje_do_json ?? "[]") as string[]; } catch { lista = []; }
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return { lista };
}
