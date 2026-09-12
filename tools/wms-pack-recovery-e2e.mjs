import { expect } from "@playwright/test";
import path from "node:path";

export async function exercisePackingRecovery(page, output) {
  const request = (url, body) =>
    page.evaluate(
      async ({ url, body }) => {
        const r = await fetch(
          url,
          body === undefined
            ? { headers: { "x-session": token } }
            : {
                method: "POST",
                headers: {
                  "x-session": token,
                  "content-type": "application/json",
                  "idempotency-key": crypto.randomUUID(),
                },
                body: JSON.stringify(body),
              },
        );
        const result = await r.json();
        if (!r.ok) throw new Error(JSON.stringify(result));
        return result;
      },
      { url, body },
    );
  await request("/api/wms/bins", {
    bin: "RECOVERY-QUAR",
    mode: "quarantine",
    version: 1,
    reason: "Kontrola jakości seeded",
  });
  let o = await request("/api/wms/orders", {
    reference: "E2E-PACK-RECOVERY",
    dueAt: "2026-12-31T12:00:00Z",
    lines: [{ sku: "WMS-0030", quantity: 3 }],
  });
  const act = async (body) => {
    o = await request(`/api/wms/orders/${o.id}/actions`, {
      ...body,
      version: o.version,
    });
  };
  await act({ action: "allocate" });
  await act({ action: "pick-start", tote: "RECOVERY-BOX" });
  for (const a of o.allocations)
    await act({
      action: "pick",
      allocationId: a.id,
      bin: a.bin,
      barcode: "WMS-0030",
      quantity: a.quantity,
    });
  await act({ action: "pack-start", tote: o.tote });
  await act({ action: "pack", barcode: "WMS-0030", quantity: 3 });
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill(o.reference);
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${o.id}"]`).click();
  await page.locator(".wms-damage-correction > summary").click();
  const damage = page.locator("#wms-packing-damage");
  await damage.locator('[name="box"]').fill("LOC:RECOVERY-BOX");
  await damage.locator('[name="box"]').press("Enter");
  await expect(damage.locator('[name="barcode"]')).toBeFocused();
  await damage.locator('[name="barcode"]').fill("WMS-0030");
  await damage.locator('[name="barcode"]').press("Enter");
  await expect(damage.locator('[name="quantity"]')).toHaveValue("");
  await damage.locator('[name="quantity"]').fill("1");
  await damage.locator('[name="fromParcel"]').selectOption("1");
  await damage.locator('[name="quarantine"]').fill("LOC:RECOVERY-QUAR");
  await damage
    .locator('[name="reason"]')
    .fill("Pęknięta obudowa — test seeded");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await damage.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(output, `packing-damage-${width}.png`),
      fullPage: true,
    });
  }
  // Odpowiedź ginie po zapisie. Ponowienie musi odtworzyć jedną kwarantannę i jedno zadanie.
  await page.route(
    "**/api/wms/packing-damage",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await damage.locator("button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-step")).toContainText(
    "Czeka na wymianę: 1 szt.",
  );
  o = await request(`/api/wms/orders/${o.id}`);
  expect(o.lines[0].picked).toBe(2);
  expect(o.lines[0].packed).toBe(2);
  expect(o.packingContents[0].quantity).toBe(2);
  expect(o.shipments).toHaveLength(0);
  await page.locator(`[data-recovery-open="${o.packingRecovery.id}"]`).click();
  await page.locator("[data-recovery-claim]").click();
  const task = await request(
    `/api/wms/packing-recovery/${o.packingRecovery.id}`,
  );
  expect(task.picks).toHaveLength(1);
  expect(task.picks[0].quantity).toBe(1);
  const pick = page.locator(".wms-recovery-pick");
  await pick.locator('[name="source"]').fill("LOC:" + task.picks[0].bin);
  await pick.locator('[name="source"]').press("Enter");
  await expect(pick.locator('[name="barcode"]')).toBeFocused();
  await pick.locator('[name="barcode"]').fill("WMS-0030");
  await pick.locator('[name="barcode"]').press("Enter");
  await expect(pick.locator('[name="quantity"]')).toBeFocused();
  await expect(pick.locator('[name="quantity"]')).toHaveValue("");
  await pick.locator('[name="quantity"]').fill("1");
  await pick.locator('[name="quantity"]').press("Enter");
  await expect(pick.locator('[name="box"]')).toBeFocused();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(output, `packing-replacement-${width}.png`),
      fullPage: true,
    });
  }
  await page.route(
    "**/api/wms/packing-recovery/*/pick",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await pick.locator('[name="box"]').fill("LOC:RECOVERY-BOX");
  await pick.locator('[name="box"]').press("Enter");
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-content")).toContainText(
    "Zamienniki dostarczone",
  );
  await page.locator("[data-recovery-order]").click();
  o = await request(`/api/wms/orders/${o.id}`);
  expect(o.lines[0].picked).toBe(3);
  expect(o.lines[0].packed).toBe(2);
  expect(o.packingRecovery).toBeNull();
  const scan = page.locator('[data-action-wms="pack"] [name="barcode"]');
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  await expect(page.locator(".wms-parcel-label")).toHaveCount(1);
  o = await request(`/api/wms/orders/${o.id}`);
  expect(o.lines[0].packed).toBe(3);
  await act({
    action: "ship",
    carrier: "DEMO",
    tracking: "PACK-RECOVERY-1",
    weightG: 500,
  });
  expect(o.shipments).toHaveLength(1);
  expect(o.shipments[0].contents.reduce((sum, c) => sum + c.quantity, 0)).toBe(
    3,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-do-wms="queue"]').click();
}
