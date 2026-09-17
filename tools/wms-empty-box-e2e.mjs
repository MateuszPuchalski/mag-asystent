import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
export async function exerciseEmptyBox(page, output, api) {
  const sku = "WMS-0034",
    cart = "EMPTY-CART",
    box = "EMPTY-BOX",
    station = "PUTBACK-PACK";
  let order = await api("/api/wms/orders", {
    reference: "E2E-EMPTY-BOX",
    channel: "seeded",
    priority: 2,
    dueAt: "2000-01-01T12:00:00Z",
    lines: [{ sku, quantity: 3 }],
  });
  await api("/api/wms/carts", {
    code: cart,
    name: "Pusta skrzynka",
    capacity: 20,
    version: 0,
    boxes: Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      barcode: i === 0 ? box : null,
    })),
  });
  const run = (await api("/api/wms/cart-start", { barcode: cart })).run,
    pick = run.tasks.find((t) => t.order_id === order.id);
  expect(pick).toBeTruthy();
  order = await api("/api/wms/pick-exceptions", {
    orderId: order.id,
    version: pick.version,
    allocationId: pick.allocation_id,
    box,
    kind: "missing",
    reason: "Nie znaleziono żadnej części",
  });
  await api(`/api/wms/cart-runs/${run.id}/handoff`, { cart, station });
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill(order.reference);
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${order.id}"]`).click();
  const form = page.locator("#wms-empty-box");
  await expect(form).toBeVisible();
  expect(await form.evaluate((f) => f.checkValidity())).toBe(false);
  await form.locator('[name="place"]').fill(station);
  await form.locator('[name="place"]').press("Enter");
  await expect(form.locator('[name="box"]')).toBeFocused();
  await form.locator('[name="box"]').fill(box);
  await form.locator('[name="box"]').press("Enter");
  await expect(form.locator('[name="emptyConfirmed"]')).toBeFocused();
  await form
    .locator('[name="reason"]')
    .fill("Pusta skrzynka sprawdzona, klient zmienia zamówienie");
  expect(await form.evaluate((f) => f.checkValidity())).toBe(false);
  await form.locator('[name="emptyConfirmed"]').check();
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
      .screenshot({ path: path.join(output, `empty-box-${width}.png`) });
  }
  await page.route(
    "**/api/wms/cart-box-withdraw",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await form.locator("button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(form).toHaveCount(0);
  const result = await api(`/api/wms/orders/${order.id}`);
  expect(result.status).toBe("allocated");
  expect(result.tote).toBeNull();
  expect(result.hold_reason).toBe(order.hold_reason);
  expect(result.version).toBe(order.version + 1);
  await page.locator('[data-tab-wms="carts"]').click();
  await expect(
    page.locator('#wms-cart-start, [data-cart-action="list"]').first(),
  ).toBeVisible();
  if (await page.locator('[data-cart-action="list"]').count())
    await page.locator('[data-cart-action="list"]').first().click();
  await page.locator(`[data-cart-run="${run.id}"]`).click();
  await page.locator('[data-cart-position="1"]').click();
  await expect(
    page.getByText("Przydział zakończony.", { exact: false }),
  ).toBeVisible();
  await page.locator(`[data-cart-order="${order.id}"]`).click();
  await page.locator("#wms-amend summary").click();
  await page.locator('#wms-amend [name="lines"]').fill(`${sku};1`);
  await page
    .locator('#wms-amend [name="reason"]')
    .fill("Klient zmienił ilość bez anulowania");
  await page.locator("#wms-amend button").click();
  await expect
    .poll(
      async () => (await api(`/api/wms/orders/${order.id}`)).lines[0].quantity,
    )
    .toBe(1);
  const stock = await api(`/api/wms/stock-work?q=${sku}`);
  expect(stock.checks.some((c) => c.bin === pick.bin)).toBe(true);
  await api(`/api/wms/cart-runs/${run.id}/release`, { cart });
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  writeFileSync(
    path.join(output, "empty-box-e2e.json"),
    JSON.stringify(
      {
        seededOnly: true,
        emptyConfirmedExplicitly: true,
        scannerEnter: true,
        lostResponseRecovered: true,
        orderKeptAndAmended: true,
        shelfCheckStillOpen: true,
        endedPositionReadable: true,
        nativePhysicalDevice: false,
      },
      null,
      2,
    ),
  );
}
