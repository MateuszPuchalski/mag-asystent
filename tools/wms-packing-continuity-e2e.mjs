import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";

export async function exercisePackingContinuity(page, output, post) {
  const get = (url) =>
    page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { "x-session": token } });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }, url);
  const rows = (await get("/api/wms/orders?q=CART-E2E-30&status=all")).rows;
  const first = rows.find((o) => o.tote === "BOX30-01");
  const second = rows.find((o) => o.tote === "BOX30-02");
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  const finish = async (tracking) => {
    const scan = page.locator('[data-action-wms="pack"] [name="barcode"]');
    await expect(scan).toBeFocused();
    await scan.fill("WMS-0030");
    await scan.press("Enter");
    await page.locator('#wms-step [name="carrier"]').fill("SEEDED");
    await page.locator('#wms-step [name="tracking"]').fill(tracking);
    await page.locator('#wms-step [name="weightG"]').fill("500");
    await page
      .getByRole("button", { name: "ZAPISZ PRZYGOTOWANE PACZKI", exact: true })
      .click();
    await expect(page.locator("#wms-step")).toContainText(tracking);
    await expect(page.locator('#wms-cart-pack [name="box"]')).toBeFocused();
  };
  await finish("NEXT-PACK-1");
  const form = page.locator("#wms-cart-pack");
  await expect(form.locator('[name="station"]')).toHaveValue("PACK-01");
  await expect(form.locator('[name="box"]')).toHaveValue("");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(form).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .locator("#wms-step")
      .screenshot({ path: path.join(output, `packing-next-${width}.png`) });
  }
  await form.locator('[name="box"]').fill("WRONG-NEXT-BOX");
  await form.locator('[name="box"]').press("Enter");
  await expect(page.locator("#wms-message")).toContainText(
    "nie została przekazana",
  );
  const original = await get(`/api/wms/orders/${second.id}`);
  await form.locator('[name="station"]').fill("WRONG-STATION");
  await form.locator('[name="station"]').press("Enter");
  await expect(form.locator('[name="box"]')).toBeFocused();
  await form.locator('[name="box"]').fill("BOX30-02");
  await form.locator('[name="box"]').press("Enter");
  await expect(page.locator("#wms-message")).toHaveClass(/error/);
  expect((await get(`/api/wms/orders/${second.id}`)).version).toBe(
    original.version,
  );
  let held = await post(`/api/wms/orders/${second.id}/actions`, {
    action: "hold",
    version: original.version,
    reason: "Sprawdzenie adresu w teście ciągłości",
  });
  await form.locator('[name="station"]').fill("PACK-01");
  await form.locator('[name="station"]').press("Enter");
  await form.locator('[name="box"]').press("Enter");
  await expect(page.locator("#wms-message")).toContainText("wstrzymane");
  held = await post(`/api/wms/orders/${second.id}/actions`, {
    action: "resume",
    version: held.version,
    reason: "Adres sprawdzony w teście ciągłości",
  });
  await page.route(
    "**/api/wms/cart-box-pack",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await form.locator('[name="box"]').press("Enter");
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  const claimed = await get(`/api/wms/orders/${second.id}`);
  expect(claimed.status).toBe("packing");
  expect(claimed.version).toBe(held.version + 1);
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-work h2")).toHaveText(second.reference);
  expect((await get(`/api/wms/orders/${second.id}`)).version).toBe(
    claimed.version,
  );
  await finish("NEXT-PACK-2");
  const previous = await get(`/api/wms/orders/${first.id}`);
  const next = await get(`/api/wms/orders/${second.id}`);
  expect(previous.shipments[0].tracking).toBe("NEXT-PACK-1");
  expect(next.shipments[0].tracking).toBe("NEXT-PACK-2");
  expect(previous.shipments[0].dispatch_status).toBe("ready");
  expect(next.shipments[0].dispatch_status).toBe("ready");
  expect((await get("/api/wms/integrity")).ok).toBe(true);
  writeFileSync(
    path.join(output, "packing-continuity-e2e.json"),
    JSON.stringify(
      {
        seededOnly: true,
        consecutiveOrders: 2,
        navigationBetweenOrders: 0,
        stationRetained: true,
        wrongBoxRejected: true,
        wrongStationRejected: true,
        heldOrderRejected: true,
        retryOpenedCorrectOrder: true,
        claimAppliedOnce: true,
        parcelsAwaitPhysicalHandoff: true,
      },
      null,
      2,
    ),
  );
}
