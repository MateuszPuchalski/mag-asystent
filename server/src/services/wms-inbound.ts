import { createHash } from "node:crypto";
import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import {
  applyStock,
  checkBarcode,
  command,
  manager,
  move,
  readSnapshot,
  WmsError,
  type Actor,
} from "./wms.js";

const text = z.string().trim().min(1).max(120);
const id = z.number().int().positive();
const quantity = z.number().int().positive().max(1_000_000);
const reason = z.string().trim().min(3).max(500);
const code = text
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/));
const fail = (message: string, status = 409): never => {
  throw new WmsError(status, message);
};
type Header = {
  id: number;
  reference: string;
  supplier: string;
  fingerprint: string;
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
  version: number;
};
type Line = {
  id: number;
  inbound_id: number;
  tw_id: number;
  sku: string;
  name: string;
  barcode: string | null;
  expected: number;
  received: number;
  damaged: number;
  version: number;
};
function header(inboundId: number) {
  return (
    (db().prepare("SELECT * FROM wms_inbound WHERE id=?").get(inboundId) as
      | Header
      | undefined) ?? fail("Nie ma takiego przyjęcia", 404)
  );
}

export function getInbound(inboundId: number, raw: unknown = {}) {
  const input = z
    .object({
      historyOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    })
    .parse(raw);
  return readSnapshot(() => {
    const document = header(inboundId);
    const lines = db()
      .prepare(
        `SELECT l.*,coalesce((SELECT sum(w.remaining) FROM wms_putaway_work w JOIN wms_inbound_putaway p ON p.id=w.receipt_id WHERE p.line_id=l.id),0) AS awaiting_putaway FROM wms_inbound_line l WHERE inbound_id=? ORDER BY (received>=expected),sku`,
      )
      .all(inboundId) as Line[];
    // Podpowiedź pokazuje istniejące miejsca, nie udaje dowodu zeskanowania półki.
    const bins = db()
      .prepare(
        `SELECT * FROM (SELECT s.tw_id,s.bin,coalesce(b.mode,'pick') AS mode,s.on_hand,
      row_number() OVER(PARTITION BY s.tw_id ORDER BY (coalesce(b.mode,'pick')='pick') DESC,s.bin) AS rank FROM wms_stock s
      JOIN wms_inbound_line l ON l.tw_id=s.tw_id AND l.inbound_id=?
      LEFT JOIN wms_bin b ON b.bin=s.bin WHERE coalesce(b.mode,'pick')<>'quarantine'
      AND NOT EXISTS(SELECT 1 FROM wms_stock_check c WHERE c.tw_id=s.tw_id AND c.bin=s.bin AND c.resolved_at IS NULL)
      ) WHERE rank<=8 ORDER BY tw_id,rank`,
      )
      .all(inboundId);
    const byProduct = new Map<number, typeof bins>();
    for (const bin of bins) {
      const key = Number(bin.tw_id);
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key)!.push(bin);
    }
    return {
      ...document,
      lines: lines.map((l) => ({ ...l, bins: byProduct.get(l.tw_id) ?? [] })),
      putawayCount: Number(
        db()
          .prepare(
            "SELECT count(*) AS n FROM wms_inbound_putaway p JOIN wms_inbound_line l ON l.id=p.line_id WHERE l.inbound_id=?",
          )
          .get(inboundId)!.n,
      ),
      putaways: db()
        .prepare(
          `SELECT p.*,l.sku,w.id AS work_id,w.remaining,r.created_at AS reversed_at,r.reason AS reversal_reason FROM wms_inbound_putaway p JOIN wms_inbound_line l ON l.id=p.line_id
        LEFT JOIN wms_putaway_work w ON w.receipt_id=p.id LEFT JOIN wms_inbound_reversal r ON r.putaway_id=p.id WHERE l.inbound_id=? ORDER BY p.id DESC LIMIT 100 OFFSET ?`,
        )
        .all(inboundId, input.historyOffset),
    };
  });
}

export function listInbound(raw: unknown) {
  const input = z
    .object({
      q: z.string().trim().max(120).default(""),
      closed: z.enum(["0", "1"]).default("0"),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    })
    .parse(raw);
  return readSnapshot(() => {
    const where = `WHERE (d.closed_at IS NOT NULL)=? AND instr(lower(d.reference||' '||d.supplier),lower(?))>0`;
    return {
      total: Number(
        db()
          .prepare(`SELECT count(*) AS n FROM wms_inbound d ${where}`)
          .get(Number(input.closed), input.q)!.n,
      ),
      rows: db()
        .prepare(
          `SELECT d.*,sum(l.expected) AS expected,sum(l.received) AS received,sum(l.damaged) AS damaged,
        sum(max(0,l.expected-l.received)) AS remaining,count(l.id) AS lines
        FROM wms_inbound d JOIN wms_inbound_line l ON l.inbound_id=d.id ${where}
        GROUP BY d.id ORDER BY d.created_at,d.id LIMIT 50 OFFSET ?`,
        )
        .all(Number(input.closed), input.q, input.offset),
    };
  });
}

const createInput = z
  .object({
    reference: text.transform((v) => v.toUpperCase()),
    supplier: text,
    lines: z
      .array(z.object({ sku: text, quantity }).strict())
      .min(1)
      .max(5000),
  })
  .strict();
export function createInbound(actor: Actor, key: string, raw: unknown) {
  manager(actor);
  const input = createInput.parse(raw);
  return command(key, actor, "inbound_create", input, () => {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          input.supplier.toUpperCase(),
          input.lines
            .map((l) => [l.sku.toUpperCase(), l.quantity])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ]),
      )
      .digest("hex");
    const old = db()
      .prepare("SELECT * FROM wms_inbound WHERE reference=?")
      .get(input.reference) as Header | undefined;
    if (old) {
      if (old.fingerprint !== fingerprint)
        fail(
          "Przyjęcie o tym numerze ma inną treść. Otwórz istniejący dokument",
        );
      return { id: old.id, alreadyCreated: true };
    }
    if (
      db()
        .prepare("SELECT 1 FROM wms_stock_document WHERE reference=?")
        .get(input.reference)
    )
      fail(
        "Ten dokument zapisano już w zapasach. Sprawdź historię przed ponownym przyjęciem",
      );
    const lookup = db()
      .prepare(`SELECT tw_id,symbol,nazwa,ean FROM sgt_towar WHERE symbol=? COLLATE NOCASE
      UNION ALL SELECT tw_id,symbol,nazwa,ean FROM wms_product p WHERE symbol=? COLLATE NOCASE
      AND NOT EXISTS(SELECT 1 FROM sgt_towar t WHERE t.tw_id=p.tw_id) LIMIT 2`);
    const seen = new Set<number>();
    const products = input.lines.map((l) => {
      const found = lookup.all(l.sku, l.sku);
      if (found.length !== 1)
        fail(
          `SKU ${l.sku} nie wskazuje jednego towaru. Sprawdź kartotekę`,
          400,
        );
      const p = found[0] as {
        tw_id: number;
        symbol: string;
        nazwa: string;
        ean: string | null;
      };
      if (seen.has(Number(p.tw_id)))
        fail(`Powtórzony SKU ${l.sku}. Zsumuj ilości w jednym wierszu`, 400);
      seen.add(Number(p.tw_id));
      return { ...p, quantity: l.quantity };
    });
    const inboundId = Number(
      db()
        .prepare(
          "INSERT INTO wms_inbound(reference,supplier,fingerprint,created_at) VALUES (?,?,?,?)",
        )
        .run(input.reference, input.supplier, fingerprint, nowIso())
        .lastInsertRowid,
    );
    const insert = db().prepare(
      "INSERT INTO wms_inbound_line(inbound_id,tw_id,sku,name,barcode,expected) VALUES (?,?,?,?,?,?)",
    );
    for (const p of products)
      insert.run(inboundId, p.tw_id, p.symbol, p.nazwa, p.ean, p.quantity);
    return { id: inboundId, alreadyCreated: false };
  });
}

export function putawayInbound(
  actor: Actor,
  key: string,
  inboundId: number,
  raw: unknown,
) {
  const input = z
    .object({
      lineId: id,
      version: id,
      barcode: text,
      bin: code,
      quantity,
      disposition: z.enum(["good", "damaged"]),
      staged: z.boolean().default(false),
      reason: z.string().trim().max(500).default(""),
    })
    .strict()
    .parse(raw);
  // Stare ponowienia nie zawierały pola staged. Ich odcisk musi pozostać taki sam.
  const { staged, ...legacyInput } = input;
  return command(
    key,
    actor,
    `inbound_putaway:${inboundId}`,
    staged ? input : legacyInput,
    () => {
      const document = header(inboundId);
      if (document.closed_at)
        fail("Przyjęcie jest zamknięte. Otwórz dokument kolejnej dostawy");
      const line = db()
        .prepare("SELECT * FROM wms_inbound_line WHERE id=? AND inbound_id=?")
        .get(input.lineId, inboundId) as Line | undefined;
      if (!line) fail("Pozycja nie należy do tego przyjęcia", 404);
      if (line!.version !== input.version)
        fail("Ilość przyjęta zmieniła się. Odśwież i sprawdź pozostałe sztuki");
      checkBarcode(line!, input.barcode);
      const bin = db()
        .prepare(
          `SELECT mode FROM wms_bin WHERE bin=? UNION ALL SELECT 'pick' AS mode
      WHERE EXISTS(SELECT 1 FROM wms_stock WHERE bin=?) AND NOT EXISTS(SELECT 1 FROM wms_bin WHERE bin=?) LIMIT 1`,
        )
        .get(input.bin, input.bin, input.bin);
      if (!bin)
        fail(
          "Nieznana lokalizacja. Zeskanuj istniejącą półkę lub zarejestruj ją w Lokalizacjach",
          400,
        );
      if (
        input.staged &&
        (bin!.mode !== "reserve" || input.disposition !== "good")
      )
        fail(
          "Przyjęcie do bufora wymaga pełnowartościowego towaru i lokalizacji zaplecza",
          400,
        );
      if ((input.disposition === "damaged") !== (bin!.mode === "quarantine"))
        fail(
          input.disposition === "damaged"
            ? "Uszkodzony towar odłóż do kwarantanny"
            : "Ta lokalizacja jest kwarantanną. Wybierz stan Uszkodzone lub inną półkę",
        );
      if (
        db()
          .prepare(
            "SELECT 1 FROM wms_stock_check WHERE tw_id=? AND bin=? AND resolved_at IS NULL",
          )
          .get(line!.tw_id, input.bin)
      )
        fail("Półka czeka na przeliczenie. Odłóż towar na inną lokalizację");
      if (input.disposition === "damaged") reason.parse(input.reason);
      if (line!.received + input.quantity > line!.expected) {
        manager(actor);
        if (input.reason.length < 3)
          fail(
            "Nadwyżka wymaga uzasadnienia biura. Sprawdź ilość i dokument",
            400,
          );
      }
      // Zachowujemy kartotekę nawet gdy lustro ERP zmieniło się po otwarciu dokumentu.
      db()
        .prepare(
          "INSERT OR IGNORE INTO wms_product(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)",
        )
        .run(line!.tw_id, line!.sku, line!.name, line!.barcode);
      applyStock(actor, {
        action: "receive",
        twId: line!.tw_id,
        bin: input.bin,
        quantity: input.quantity,
        reason: `Przyjęcie ${document.reference}`,
      });
      db()
        .prepare(
          `UPDATE wms_inbound_line SET received=received+?,damaged=damaged+?,version=version+1 WHERE id=?`,
        )
        .run(
          input.quantity,
          input.disposition === "damaged" ? input.quantity : 0,
          line!.id,
        );
      db()
        .prepare("UPDATE wms_inbound SET version=version+1 WHERE id=?")
        .run(inboundId);
      const putawayId = Number(
        db()
          .prepare(
            "INSERT INTO wms_inbound_putaway(line_id,bin,quantity,disposition,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            line!.id,
            input.bin,
            input.quantity,
            input.disposition,
            input.reason,
            actor.id,
            nowIso(),
          ).lastInsertRowid,
      );
      return {
        id: inboundId,
        putawayId,
        ...(input.staged
          ? {
              workId: Number(
                db()
                  .prepare(
                    "INSERT INTO wms_putaway_work(receipt_id,tw_id,source,quantity,remaining,created_at) VALUES (?,?,?,?,?,?)",
                  )
                  .run(
                    putawayId,
                    line!.tw_id,
                    input.bin,
                    input.quantity,
                    input.quantity,
                    nowIso(),
                  ).lastInsertRowid,
              ),
            }
          : {}),
        received: line!.received + input.quantity,
      };
    },
  );
}

export function closeInbound(
  actor: Actor,
  key: string,
  inboundId: number,
  raw: unknown,
) {
  const input = z
    .object({ version: id, reason: z.string().trim().max(500).default("") })
    .strict()
    .parse(raw);
  return command(key, actor, `inbound_close:${inboundId}`, input, () => {
    const document = header(inboundId);
    if (document.closed_at || document.version !== input.version)
      fail("Przyjęcie zmieniło się. Odśwież dokument przed zamknięciem");
    const missing = Number(
      db()
        .prepare(
          "SELECT sum(max(0,expected-received)) AS n FROM wms_inbound_line WHERE inbound_id=?",
        )
        .get(inboundId)!.n,
    );
    if (missing) {
      manager(actor);
      if (input.reason.length < 3)
        fail(
          `Brakuje ${missing} szt. Zostaw dostawę otwartą albo wpisz uzasadnienie zamknięcia`,
          400,
        );
    }
    db()
      .prepare(
        "UPDATE wms_inbound SET closed_at=?,close_reason=?,version=version+1 WHERE id=?",
      )
      .run(nowIso(), input.reason, inboundId);
    return { id: inboundId, closed: true, missing };
  });
}

export function reopenInbound(
  actor: Actor,
  key: string,
  inboundId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z.object({ version: id, reason }).strict().parse(raw);
  return command(key, actor, `inbound_reopen:${inboundId}`, input, () => {
    const document = header(inboundId);
    if (!document.closed_at || document.version !== input.version)
      fail("Przyjęcie zmieniło się. Odśwież dokument");
    db()
      .prepare(
        "UPDATE wms_inbound SET closed_at=NULL,close_reason=NULL,version=version+1 WHERE id=?",
      )
      .run(inboundId);
    return { id: inboundId, reopened: true };
  });
}

export function reverseInbound(
  actor: Actor,
  key: string,
  inboundId: number,
  raw: unknown,
) {
  manager(actor);
  const input = z
    .object({ putawayId: id, version: id, barcode: text, bin: code, reason })
    .strict()
    .parse(raw);
  return command(key, actor, `inbound_reverse:${inboundId}`, input, () => {
    const document = header(inboundId);
    if (document.closed_at || document.version !== input.version)
      fail("Otwórz aktualny dokument przed korektą");
    const original = db()
      .prepare(
        `SELECT p.*,l.tw_id,l.sku,l.barcode FROM wms_inbound_putaway p JOIN wms_inbound_line l ON l.id=p.line_id WHERE p.id=? AND l.inbound_id=?`,
      )
      .get(input.putawayId, inboundId) as
      | {
          id: number;
          line_id: number;
          tw_id: number;
          sku: string;
          barcode: string | null;
          bin: string;
          quantity: number;
          disposition: string;
        }
      | undefined;
    if (!original) fail("Odłożenie nie należy do tego przyjęcia", 404);
    const p = original!;
    if (
      db()
        .prepare("SELECT 1 FROM wms_putaway_work WHERE receipt_id=?")
        .get(p.id)
    )
      fail(
        "Przyjęcie do bufora koryguj w zadaniu odkładania. Odłożone sztuki rozlicz przez spis lub zwrot",
      );
    checkBarcode(p, input.barcode);
    if (input.bin !== p.bin)
      fail("Zeskanuj lokalizację pierwotnego odłożenia", 400);
    if (
      db()
        .prepare("SELECT 1 FROM wms_inbound_reversal WHERE putaway_id=?")
        .get(p.id)
    )
      fail("To odłożenie zostało już skorygowane");
    if (
      db()
        .prepare(
          "SELECT 1 FROM wms_stock_check WHERE tw_id=? AND bin=? AND resolved_at IS NULL",
        )
        .get(p.tw_id, p.bin)
    )
      fail("Najpierw zakończ przeliczenie półki");
    // Ruch kompensujący zachowuje historię i odmawia zabrania już zarezerwowanych sztuk.
    move(
      actor,
      p.tw_id,
      p.bin,
      -p.quantity,
      0,
      "receive_correction",
      input.reason,
    );
    db()
      .prepare(
        "INSERT INTO wms_inbound_reversal(putaway_id,reason,user_id,created_at) VALUES (?,?,?,?)",
      )
      .run(p.id, input.reason, actor.id, nowIso());
    db()
      .prepare(
        "UPDATE wms_inbound_line SET received=received-?,damaged=damaged-?,version=version+1 WHERE id=?",
      )
      .run(p.quantity, p.disposition === "damaged" ? p.quantity : 0, p.line_id);
    db()
      .prepare("UPDATE wms_inbound SET version=version+1 WHERE id=?")
      .run(inboundId);
    return { id: inboundId, reversed: p.id, quantity: p.quantity };
  });
}
