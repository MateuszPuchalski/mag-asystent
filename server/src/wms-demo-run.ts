import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Osobna, nowa baza jest obowiązkowa: demo nigdy nie zasila istniejącego magazynu.
const target = process.env.DB_PATH;
if (!target || fs.existsSync(path.resolve(target)))
  throw new Error("Podaj DB_PATH wskazujący NOWY plik bazy demonstracyjnej");
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.resolve("wms-demo-no-env.local");
const { db } = await import("./db/db.js");
const { createUser } = await import("./services/users.js");
const W = await import("./services/wms.js");
const C = await import("./services/wms-carts.js");
const I = await import("./services/wms-inbound.js");
const D = await import("./services/wms-dispatch.js");
const { zapiszWlasne } = await import("./services/zdjecia-wlasne.js");
const { logEvent } = await import("./services/events.js");
const password = process.env.WMS_DEMO_PASSWORD;
if (!password || password.length < 10)
  throw new Error("Ustaw WMS_DEMO_PASSWORD (co najmniej 10 znaków)");
const user = createUser("Demo WMS", "admin", "wms-demo", password);
const actor = { id: user.userId, name: user.name, role: user.role };
for (const capacity of [20, 30] as const) {
  C.configureCart(actor, randomUUID(), {
    code: `CART-${capacity}`,
    name: `Wózek ${capacity}`,
    capacity,
    version: 0,
    boxes: Array.from({ length: capacity }, (_, i) => ({
      position: i + 1,
      barcode: `BOX${capacity}-${String(i + 1).padStart(2, "0")}`,
    })),
  });
}
C.configureStation(actor, randomUUID(), {
  code: "PACK-01",
  name: "Pakowanie 1",
  kind: "pack",
  active: true,
  version: 0,
});
C.configureStation(actor, randomUUID(), {
  code: "EXCEPT-01",
  name: "Wyjaśnienia",
  kind: "exception",
  active: true,
  version: 0,
});
for (const [bin, mode] of [
  ["BUF-01", "reserve"],
  ["QUAR-01", "quarantine"],
])
  W.configureBin(actor, randomUUID(), {
    bin,
    mode,
    version: 1,
    reason: "Strefy przyjęcia DEMO",
  });
const scale = process.argv.includes("--scale");
const skuCount = scale ? 5000 : 40;
const orderCount = scale ? 1500 : 32;
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
for (let i = 1; i <= skuCount; i++) {
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
// Obraz wygenerowany wyłącznie dla fikcyjnego koła WMS-0030, nigdy wzorzec części klienta.
zapiszWlasne({
  twId: 30,
  obraz: fs.readFileSync(
    new URL("../../tools/fixtures/wms-demo-wheel.png", import.meta.url),
  ),
  mime: "image/png",
  tloUsuniete: false,
  dodaneBy: actor.name,
  dodaneByRef: actor.id,
});
logEvent("wms_demo_photo", actor.name, 30, { source: "generated-demo-wheel" });
I.createInbound(actor, randomUUID(), {
  reference: "DEMO-PZ-001",
  supplier: "Dostawca demonstracyjny",
  lines: [
    { sku: "WMS-0030", quantity: 12 },
    { sku: "WMS-0002", quantity: 8 },
  ],
});
let demoHandoff = D.createHandoff(actor, randomUUID(), { carrier: "DEMO" });
for (let i = 1; i <= orderCount; i++) {
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
    demoHandoff = D.scanHandoff(actor, randomUUID(), demoHandoff.id, {
      tracking: `DEMO-${i}`,
    });
  }
}
if (demoHandoff.totals.parcels)
  D.closeHandoff(actor, randomUUID(), demoHandoff.id, {
    version: demoHandoff.version,
    parcels: Number(demoHandoff.totals.parcels),
  });
console.log(
  `Demo gotowe: ${path.resolve(target)}. ${skuCount} SKU, ${orderCount} zamówień. Login: wms-demo. Hasło pobrano z WMS_DEMO_PASSWORD.`,
);
