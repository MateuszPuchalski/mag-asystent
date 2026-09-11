import { z } from "zod";
import { db, nowIso } from "../db/db.js";
import { manager, WmsError, type Actor } from "./wms.js";
import { wierszCsv, zbudujCsv } from "./csv.js";

const filters = z.object({
  day: z.iso.date().refine((v) => v >= "2000-01-01" && v <= "2099-12-31"),
  q: z.string().trim().max(120).default(""),
});
const pageInput = filters.extend({
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type Parcel = {
  id: number;
  order_id: number;
  reference: string;
  channel: string;
  package_no: number;
  carrier: string;
  tracking: string;
  weight_g: number;
  created_at: string;
};
const columns = "s.*,o.reference,o.channel";

function selection(input: z.infer<typeof filters>) {
  const start = `${input.day}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  // instr traktuje %, _ i apostrofy jak dane, bez poszerzania wyszukiwania.
  return {
    sql: `FROM wms_shipment s JOIN wms_order o ON o.id=s.order_id
      WHERE s.created_at>=? AND s.created_at<?
      AND (?='' OR instr(lower(o.reference),lower(?))>0
        OR instr(lower(s.tracking),lower(?))>0 OR instr(lower(s.carrier),lower(?))>0
        OR instr(lower(o.channel),lower(?))>0)`,
    args: [start, end, input.q, input.q, input.q, input.q, input.q],
  };
}

export function dispatchRegister(actor: Actor, raw: unknown) {
  manager(actor);
  const input = pageInput.parse(raw);
  const { sql, args } = selection(input),
    d = db();
  // Liczniki i strona muszą opisywać tę samą chwilę przy równoległej wysyłce.
  d.exec("BEGIN");
  try {
    const totals = d
      .prepare(
        `SELECT count(*) AS parcels,count(DISTINCT s.order_id) AS orders,
      coalesce(sum(s.weight_g),0) AS weightG ${sql}`,
      )
      .get(...args);
    const rows = d
      .prepare(
        `SELECT ${columns} ${sql} ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, input.limit, input.offset) as Parcel[];
    d.exec("COMMIT");
    return { ...input, totals, rows };
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

export function dispatchCsv(actor: Actor, raw: unknown) {
  manager(actor);
  const input = filters.parse(raw);
  const { sql, args } = selection(input);
  // Eksport obejmuje cały filtr, nigdy tylko widoczną stronę. Nie wolno go ucinać po cichu.
  const rows = db()
    .prepare(`SELECT ${columns} ${sql} ORDER BY s.created_at,s.id LIMIT 30001`)
    .all(...args) as Parcel[];
  if (rows.length > 30000)
    throw new WmsError(
      422,
      "Ponad 30000 paczek. Zawęź wyszukiwanie przed eksportem",
    );
  // Numery i kanały pochodzą od użytkownika; Excel nie może wykonać ich jako formuł.
  const cell = (value: string) =>
    /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return zbudujCsv([
    wierszCsv(
      [
        "ID paczki",
        "Zamówienie",
        "Kanał",
        "Paczka",
        "Przewoźnik",
        "Numer przesyłki",
        "Masa g",
        "Wysłano UTC",
      ],
      ";",
    ),
    ...rows.map((r) =>
      wierszCsv(
        [
          r.id,
          cell(r.reference),
          cell(r.channel),
          r.package_no,
          cell(r.carrier),
          cell(r.tracking),
          r.weight_g,
          r.created_at,
        ],
        ";",
      ),
    ),
  ]);
}

export const dispatchToday = () => nowIso().slice(0, 10);
