import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Osobna, nowa baza jest obowiązkowa: demo nigdy nie zasila istniejącego magazynu.
const target = process.env.DB_PATH;
if (!target || fs.existsSync(path.resolve(target)))
  throw new Error("Podaj DB_PATH wskazujący NOWY plik bazy demonstracyjnej");
process.env.SGT_MODE = "seeded";
process.env.WERTIS_ENV_FILE = path.resolve("wms-demo-no-env.local");
const { db } = await import("./db/db.js");
const { createUser } = await import("./services/users.js");
const W = await import("./services/wms.js");
const password = process.env.WMS_DEMO_PASSWORD;
if (!password || password.length < 10)
  throw new Error("Ustaw WMS_DEMO_PASSWORD (co najmniej 10 znaków)");
const user = createUser("Demo WMS", "admin", "wms-demo", password);
const actor = { id: user.userId, name: user.name, role: user.role };
const names = [
  "Nóż kosiarki 46 cm",
  "Filtr powietrza silnika",
  "Pasek napędu noża",
  "Świeca zapłonowa",
  "Linka napędu",
  "Koło przednie",
  "Łożysko piasty",
  "Uszczelka gaźnika",
];
for (let i = 1; i <= 40; i++) {
  db()
    .prepare(
      "INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean,lokalizacja) VALUES (?,?,?,?,?)",
    )
    .run(
      i,
      `WMS-${String(i).padStart(4, "0")}`,
      names[(i - 1) % names.length],
      `590999${String(i).padStart(7, "0")}`,
      `A${String(Math.ceil(i / 8)).padStart(2, "0")}-01-02`,
    );
  W.changeStock(actor, randomUUID(), {
    action: "receive",
    twId: i,
    bin: `A${String(Math.ceil(i / 8)).padStart(2, "0")}-01-02`,
    quantity: 100,
    reason: "Spis otwarcia DEMO",
  });
}
for (let i = 1; i <= 32; i++) {
  let o = W.createOrder(actor, randomUUID(), {
    reference: `SKLEP-${String(i).padStart(5, "0")}`,
    channel: i % 3 ? "sklep" : "Allegro",
    priority: i % 9 === 0 ? 1 : 0,
    dueAt: new Date(Date.now() + ((i % 5) - 1) * 86_400_000).toISOString(),
    lines: [
      { sku: `WMS-${String(i).padStart(4, "0")}`, quantity: (i % 3) + 1 },
    ],
  });
  const action = (input: Record<string, unknown>) => {
    o = W.actOnOrder(actor, randomUUID(), o.id, {
      version: o.version,
      ...input,
    });
  };
  if (i % 4 !== 0) action({ action: "allocate" });
  if (i % 4 === 1 || i % 4 === 2) {
    action({ action: "pick-start", tote: `BOX-${i}` });
    for (const a of o.allocations)
      action({
        action: "pick",
        allocationId: a.id,
        bin: a.bin,
        barcode: o.lines[0].sku,
        quantity: a.quantity,
      });
  }
  if (i % 4 === 1) {
    action({ action: "pack-start", tote: o.tote });
    action({
      action: "pack",
      barcode: o.lines[0].sku,
      quantity: o.lines[0].quantity,
    });
    action({
      action: "ship",
      carrier: "DEMO",
      tracking: `DEMO-${i}`,
      weightG: 500,
    });
  }
}
console.log(
  `Demo gotowe: ${path.resolve(target)}. Login: wms-demo. Hasło pobrano z WMS_DEMO_PASSWORD.`,
);
