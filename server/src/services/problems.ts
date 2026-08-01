import fs from "node:fs";
import path from "node:path";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import { closeIfComplete } from "./delivery.js";
import type { ProblemView, ProblemType } from "../types.js";

/* ── Faza 2: wyjątki jako obiekt pierwszej klasy (D8) ────────────────────────
   Wyjątek to wiersz w bazie, nie notatka w głowie magazyniera — inaczej nie da
   się zmierzyć, ile kosztują, ani zgłosić reklamacji dostawcy.               */

/** Typy zamknięte (§4.6). */
export const PROBLEM_TYPES: ProblemType[] = [
  "qty_short",
  "qty_over",
  "damaged",
  "wrong_item",
  "no_space",
  "unknown_barcode",
  "ean_conflict",
];

/** Typy, przy których zdjęcie jest OBOWIĄZKOWE — dowód do reklamacji (§4.6). */
const PHOTO_REQUIRED: ReadonlySet<string> = new Set(["damaged", "wrong_item", "unknown_barcode"]);

/** Typy wymagające ilości faktycznej. */
const QTY_REQUIRED: ReadonlySet<string> = new Set(["qty_short", "qty_over"]);

const nowIso = () => new Date().toISOString();

function photoDir(): string {
  const dir = path.resolve(path.dirname(config.dbPath), "photos");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Zapis zdjęcia (base64 z aparatu kolektora) na dysk; zwraca nazwę pliku. */
function savePhoto(base64: string): string {
  const clean = base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(clean, "base64");
  const name = `p${Date.now()}-${Math.round(buf.length / 1024)}kb.jpg`;
  fs.writeFileSync(path.join(photoDir(), name), buf);
  return name;
}

/** Referencja zdjęcia po id problemu (null = brak zdjęcia albo brak problemu). */
export function photoRefOf(id: number): string | null {
  const r = db().prepare("SELECT foto_ref FROM problem WHERE id=?").get(id) as
    | { foto_ref: string | null }
    | undefined;
  return r?.foto_ref ?? null;
}

export function photoPath(ref: string): string | null {
  // bez ../ w nazwie — ref pochodzi z bazy, ale nie ufamy mu na ścieżce
  const safe = path.basename(ref);
  const p = path.join(photoDir(), safe);
  return fs.existsSync(p) ? p : null;
}

export interface RaiseProblemInput {
  deliveryId: number;
  lineId?: number | null;
  typ: string;
  qty?: number | null;
  opis?: string | null;
  photoBase64?: string | null;
}

/**
 * Zgłoszenie wyjątku. Waliduje regułę domenową: uszkodzenie / zły towar /
 * nieznany kod bez zdjęcia nie jest zgłoszeniem, tylko opinią.
 */
export function raiseProblem(
  input: RaiseProblemInput,
  user: string
): { id: number } | { error: string } {
  if (!PROBLEM_TYPES.includes(input.typ as ProblemType)) {
    return { error: `Nieznany typ problemu: ${input.typ}` };
  }
  if (PHOTO_REQUIRED.has(input.typ) && !input.photoBase64) {
    return { error: "Ten typ problemu wymaga zdjęcia" };
  }
  if (QTY_REQUIRED.has(input.typ) && (input.qty == null || !Number.isFinite(input.qty))) {
    return { error: "Podaj ilość faktyczną" };
  }

  let fotoRef: string | null = null;
  if (input.photoBase64) {
    try {
      fotoRef = savePhoto(input.photoBase64);
    } catch {
      return { error: "Nie udało się zapisać zdjęcia" };
    }
  }

  const id = Number(
    db()
      .prepare(
        `INSERT INTO problem(delivery_id, line_id, typ, ilosc, opis, foto_ref, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        input.deliveryId,
        input.lineId ?? null,
        input.typ,
        input.qty ?? null,
        input.opis ?? null,
        fotoRef,
        nowIso(),
        user
      ).lastInsertRowid
  );

  // linia z problemem wypada z rutyny — nie blokuje zamknięcia reszty dostawy
  if (input.lineId) {
    db().prepare("UPDATE delivery_line SET status='problem' WHERE id=?").run(input.lineId);
    // jeśli to była ostatnia otwarta pozycja, dostawa domyka się tak samo jak
    // po zwykłym odłożeniu — wyjątek żyje dalej na liście nierozwiązanych
    closeIfComplete(input.deliveryId, user);
  }
  logEvent("problem_raised", user, null, { problemId: id, typ: input.typ, lineId: input.lineId ?? null });
  return { id };
}

function mapRow(r: any): ProblemView {
  return {
    id: r.id,
    deliveryId: r.delivery_id,
    lineId: r.line_id,
    typ: r.typ,
    qty: r.ilosc,
    opis: r.opis,
    hasPhoto: !!r.foto_ref,
    createdAt: r.created_at,
    createdBy: r.created_by,
    resolvedAt: r.resolved_at,
    resolvedNote: r.resolved_note,
    docNumber: r.doc_number ?? null,
    sym: r.sym ?? null,
    name: r.name ?? null,
  };
}

const SELECT_JOIN = `
  SELECT p.*, d.sgt_dok_numer AS doc_number, l.tw_symbol AS sym, l.tw_nazwa AS name
  FROM problem p
  LEFT JOIN delivery d ON d.id = p.delivery_id
  LEFT JOIN delivery_line l ON l.id = p.line_id`;

/** Nierozwiązane wyjątki — ekran na starcie aplikacji, inaczej nikt się nimi nie zajmie. */
export function listUnresolved(): ProblemView[] {
  return (db().prepare(`${SELECT_JOIN} WHERE p.resolved_at IS NULL ORDER BY p.id DESC`).all() as any[]).map(
    mapRow
  );
}

export function listByDelivery(deliveryId: number): ProblemView[] {
  return (
    db().prepare(`${SELECT_JOIN} WHERE p.delivery_id = ? ORDER BY p.id`).all(deliveryId) as any[]
  ).map(mapRow);
}

/**
 * Nagłówek dostawy do protokołu reklamacyjnego: numer, dostawca, data.
 * Czytany z lokalnej tabeli `delivery`, bo protokół bez dostawcy nie jest
 * dokumentem do wysłania. Osobna funkcja, żeby podgląd biura nie musiał
 * pobierać całej listy dokumentów tylko dla dwóch pól nagłówka.
 */
export function deliveryHeader(
  deliveryId: number
): { nrPelny: string; dostawca: string; dataWyst: string } | null {
  const r = db()
    .prepare("SELECT sgt_dok_numer, dostawca, data_dok FROM delivery WHERE id = ?")
    .get(deliveryId) as { sgt_dok_numer: string; dostawca: string | null; data_dok: string | null } | undefined;
  if (!r) return null;
  return { nrPelny: r.sgt_dok_numer, dostawca: r.dostawca ?? "", dataWyst: r.data_dok ?? "" };
}

export function resolveProblem(id: number, note: string | undefined, user: string): { ok: true } | { error: string } {
  const r = db()
    .prepare("UPDATE problem SET resolved_at=?, resolved_note=? WHERE id=? AND resolved_at IS NULL")
    .run(nowIso(), note ?? null, id);
  if (r.changes === 0) return { error: "Problem nie istnieje albo jest już rozwiązany" };
  logEvent("problem_resolved", user, null, { problemId: id });
  return { ok: true };
}

/** CSV do reklamacji u dostawcy (§4.6). Separator `;` — Excel PL. */
export function exportCsv(deliveryId: number): string {
  const rows = listByDelivery(deliveryId);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    "id",
    "dokument",
    "symbol",
    "nazwa",
    "typ",
    "ilosc",
    "opis",
    "zdjecie",
    "zgloszono",
    "zglosil",
    "rozwiazano",
    "notatka",
  ].join(";");
  const lines = rows.map((p) =>
    [
      p.id,
      p.docNumber,
      p.sym,
      p.name,
      p.typ,
      p.qty,
      p.opis,
      p.hasPhoto ? "tak" : "nie",
      p.createdAt,
      p.createdBy,
      p.resolvedAt,
      p.resolvedNote,
    ]
      .map(esc)
      .join(";")
  );
  // BOM — bez niego Excel PL rozjeżdża polskie znaki
  return "﻿" + [head, ...lines].join("\r\n") + "\r\n";
}

