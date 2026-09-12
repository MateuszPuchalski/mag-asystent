import { expect } from "@playwright/test";
import path from "node:path";
export async function exercisePacking(page, output) {
  const post = (url, body) =>
    page.evaluate(
      async ({ url, body }) => {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "x-session": token,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(JSON.stringify(result));
        return result;
      },
      { url, body },
    );
  let o = await post("/api/wms/orders", {
    reference: "E2E-MULTI-CONTENTS",
    dueAt: "2026-12-31T12:00:00Z",
    lines: [{ sku: "WMS-0030", quantity: 3 }],
  });
  const act = async (body) => {
    o = await post(`/api/wms/orders/${o.id}/actions`, {
      ...body,
      version: o.version,
    });
  };
  await act({ action: "allocate" });
  await act({ action: "pick-start", tote: "MULTI-CONTENTS" });
  for (const a of o.allocations)
    await act({
      action: "pick",
      allocationId: a.id,
      bin: a.bin,
      barcode: "WMS-0030",
      quantity: a.quantity,
    });
  await act({ action: "pack-start", tote: o.tote });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill("E2E-MULTI-CONTENTS");
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${o.id}"]`).click();
  const scan = page.locator('[data-action-wms="pack"] [name="barcode"]');
  await expect(scan).toBeFocused();
  await expect(page.locator("#wms-filter")).toBeHidden();
  await expect(page.locator('[name="parcelNo"]')).toHaveValue("1");
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  await expect(scan).toHaveValue("");
  await page.locator('[name="parcelNo"]').selectOption("2");
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  await expect(scan).toHaveValue("");
  await expect(page.locator('[name="parcelNo"]')).toHaveValue("2");
  await expect(scan).toBeFocused();
  const confirmBox = await page
    .locator('[data-action-wms="pack"] button')
    .boundingBox();
  expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: path.join(output, "packing-parcel-mobile.png"),
    fullPage: true,
  });
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  await expect(page.locator(".wms-parcel-label")).toHaveCount(2);
  await expect(page.locator(".wms-parcel-label").nth(0)).toContainText(
    "1 szt.",
  );
  await expect(page.locator(".wms-parcel-label").nth(1)).toContainText(
    "2 szt.",
  );
  const ship = page.locator('[data-action-wms="ship"]');
  for (const [from, to] of [
    [1, 3],
    [3, 1],
  ]) {
    await page.locator(".wms-parcel-corrections > summary").click();
    const move = page.locator('[data-action-wms="pack-move"]');
    await move.locator('[name="barcode"]').fill("WMS-0030");
    await move.locator('[name="fromParcel"]').fill(String(from));
    await move.locator('[name="toParcel"]').fill(String(to));
    await move.locator("button").click();
    if (to === 3) {
      await expect(page.locator("#wms-step")).toContainText(
        "kolejne numery od 1",
      );
      await expect(ship).toHaveCount(0);
    } else await expect(page.locator(".wms-parcel-label")).toHaveCount(2);
  }
  for (const suffix of ["", "2"]) {
    await ship.locator(`[name="carrier${suffix}"]`).fill("MULTI");
    await ship
      .locator(`[name="tracking${suffix}"]`)
      .fill(`MULTI-CONTENTS-${suffix || "1"}`);
    await ship.locator(`[name="weightG${suffix}"]`).fill("500");
  }
  await page.screenshot({
    path: path.join(output, "packing-labels-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.route(
    "**/api/wms/orders/*/actions",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await ship.locator('button[type="submit"]').click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-step")).toContainText("Paczki przygotowane");
  const saved = await page.evaluate(
    async (id) =>
      (
        await fetch(`/api/wms/orders/${id}`, {
          headers: { "x-session": token },
        })
      ).json(),
    o.id,
  );
  expect(saved.shipments).toHaveLength(2);
  expect(saved.shipments.map((s) => s.contents[0].quantity)).toEqual([1, 2]);
  await page
    .getByRole("button", { name: "POKAŻ KOLEJKĘ", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
