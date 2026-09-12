import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";

export async function exerciseReroute(page, output) {
  const api = (url, body) =>
    page.evaluate(
      async ({ url, body }) => {
        const response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "x-session": token,
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "idempotency-key": crypto.randomUUID(),
                }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result));
        return result;
      },
      { url, body },
    );
  await api("/api/wms/inventory", {
    action: "receive",
    twId: 40,
    bin: "00-REROUTE",
    quantity: 60,
    reason: "Zapas testowy przekierowania",
  });
  await api("/api/wms/carts", {
    code: "REROUTE-20",
    name: "Przekierowanie",
    capacity: 20,
    selection: "all",
    maxUnits: 100,
    version: 0,
    boxes: Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      barcode: `RE-BOX-${i + 1}`,
    })),
  });
  for (let i = 0; i < 20; i++)
    await api("/api/wms/orders", {
      reference: `REROUTE-${i}`,
      channel: "seeded",
      priority: 2,
      dueAt: "2024-01-01T12:00:00Z",
      lines: [{ sku: "WMS-0040", quantity: 2 }],
    });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-tab-wms="carts"]').click();
  if (!(await page.locator("#wms-cart-start").count()))
    await page.locator('[data-cart-action="list"]').click();
  await page.locator('#wms-cart-start [name="barcode"]').fill("REROUTE-20");
  await page.locator('#wms-cart-start [name="barcode"]').press("Enter");
  await expect(page.locator("#wms-cart-pick")).toBeVisible();
  const initial = await page.evaluate(
    () => document.getElementById("wms-content")._cartTask,
  );
  expect(initial.bin).toBe("00-REROUTE");
  await page.locator('#wms-cart-pick [name="bin"]').fill(initial.bin);
  await page.locator('#wms-cart-pick [name="bin"]').press("Enter");
  await page.locator('#wms-cart-pick [name="barcode"]').fill(initial.sku);
  await page.locator('#wms-cart-pick [name="barcode"]').press("Enter");
  await page.locator('#wms-cart-pick [name="quantity"]').fill("1");
  await page.locator('#wms-cart-pick [name="tote"]').fill(initial.tote);
  await page.locator('#wms-cart-pick [name="tote"]').press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getElementById("wms-content")._cartTask.version,
      ),
    )
    .not.toBe(initial.version);
  await api("/api/wms/inventory", {
    action: "receive",
    twId: 40,
    bin: "01-REROUTE",
    quantity: 40,
    reason: "Zapas zastępczy",
  });
  await page.locator("[data-cart-exception]").click();
  await page
    .locator('#wms-cart-exception [name="kind"]')
    .selectOption("missing");
  await page.locator('#wms-cart-exception [name="box"]').fill(initial.tote);
  await page
    .locator('#wms-cart-exception [name="reason"]')
    .fill("Nie znaleziono pozostałych sztuk");
  await page.route(
    "**/api/wms/pick-exceptions",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.locator("#wms-cart-exception button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  const saved = await api(`/api/wms/orders/${initial.order_id}`);
  expect(saved.hold_reason).toBeNull();
  expect(saved.lines[0].picked).toBe(1);
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator('#wms-cart-pick [name="bin"]')).toBeVisible();
  const next = await page.evaluate(
    () => document.getElementById("wms-content")._cartTask,
  );
  expect(next.bin).toBe("01-REROUTE");
  expect(next.tote).toBe(initial.tote);
  expect(next.remaining).toBe(1);
  await page.locator('#wms-cart-pick [name="bin"]').fill(next.bin);
  await page.locator('#wms-cart-pick [name="bin"]').press("Enter");
  await page.locator('#wms-cart-pick [name="barcode"]').fill(next.sku);
  await page.locator('#wms-cart-pick [name="barcode"]').press("Enter");
  await page.locator('#wms-cart-pick [name="tote"]').fill(next.tote);
  await page.locator('#wms-cart-pick [name="tote"]').press("Enter");
  await expect
    .poll(async () => (await api(`/api/wms/orders/${initial.order_id}`)).status)
    .toBe("picked");
  const stock = await api("/api/wms/inventory?q=WMS-0040");
  expect(stock.rows.find((r) => r.bin === "00-REROUTE").on_hand).toBe(59);
  const checks = await api("/api/wms/stock-work?q=WMS-0040");
  expect(checks.checks.some((c) => c.bin === "00-REROUTE")).toBe(true);
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  writeFileSync(
    path.join(output, "reroute-e2e.json"),
    JSON.stringify(
      {
        passed: true,
        seeded: true,
        orders: 20,
        partialPickPreserved: true,
        sameBox: initial.tote === next.tote,
        sourceStillBlocked: true,
        responseLossRecovered: true,
      },
      null,
      2,
    ),
  );
  // Ten sam zgłoszony brak kończy się wynikiem z hali i decyzją biura.
  const check = checks.checks.find((c) => c.bin === "00-REROUTE");
  const countTask = await api(`/api/wms/count-work/${check.id}`);
  expect(countTask.on_hand).toBeUndefined();
  await api(`/api/wms/stock-checks/${check.id}/observe`, {
    bin: countTask.bin,
    barcode: countTask.sku,
    quantity: 0,
    version: countTask.version,
  });
  expect(
    (await api("/api/wms/inventory?q=WMS-0040")).rows.find(
      (r) => r.bin === "00-REROUTE",
    ).on_hand,
  ).toBe(59);
  await page.locator('[data-tab-wms="stockwork"]').click();
  await page.locator(`[data-stockwork-check="${check.id}"]`).click();
  await expect(page.locator("#wms-stockwork-detail")).toContainText(
    "Policzono 0 szt.",
  );
  await page
    .locator('#wms-stockwork-review [name="decision"]')
    .selectOption("recount");
  await page
    .locator('#wms-stockwork-review [name="reason"]')
    .fill("Sprawdź także tył półki");
  await page.locator("#wms-stockwork-review button").click();
  await expect
    .poll(async () => (await api(`/api/wms/count-work/${check.id}`)).pending)
    .toBe(0);
  const again = await api(`/api/wms/count-work/${check.id}`);
  expect(again.recount_reason).toBe("Sprawdź także tył półki");
  await api(`/api/wms/stock-checks/${check.id}/observe`, {
    bin: again.bin,
    barcode: again.sku,
    quantity: 0,
    version: again.version,
  });
  await page.locator('[data-tab-wms="stockwork"]').click();
  await page.locator(`[data-stockwork-check="${check.id}"]`).click();
  await page
    .locator('#wms-stockwork-review [name="reason"]')
    .fill("Powtórne liczenie potwierdziło brak");
  await page.route(
    `**/api/wms/stock-checks/${check.id}/review`,
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.locator("#wms-stockwork-review button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(
    page.locator(`[data-stockwork-check="${check.id}"]`),
  ).toHaveCount(0);
  expect(
    (await api(`/api/wms/count-work/${check.id}`)).resolved_at,
  ).toBeTruthy();
  expect(
    (await api("/api/wms/inventory?q=WMS-0040")).rows.find(
      (r) => r.bin === "00-REROUTE",
    ).on_hand,
  ).toBe(0);
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  writeFileSync(
    path.join(output, "counting-e2e.json"),
    JSON.stringify(
      {
        passed: true,
        seeded: true,
        blindRead: true,
        recount: true,
        approvalResponseLossRecovered: true,
        integrity: true,
      },
      null,
      2,
    ),
  );
}
