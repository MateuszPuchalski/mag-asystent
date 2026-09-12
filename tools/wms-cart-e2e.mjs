import { expect } from "@playwright/test";
import path from "node:path";

export async function exerciseCarts(page, output) {
  let photoRequests = 0;
  const countPhoto = (request) => {
    if (request.url().endsWith("/api/products/30/zdjecie")) photoRequests++;
  };
  page.on("request", countPhoto);
  await page.route(
    "**/api/products/30/zdjecie",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"temporary"}',
      }),
    { times: 1 },
  );
  const post = (url, body) =>
    page.evaluate(
      async ({ url, body }) => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "x-session": token,
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result));
        return result;
      },
      { url, body },
    );
  await post("/api/wms/inventory", {
    action: "receive",
    twId: 30,
    bin: "A04-01-02",
    quantity: 100,
    reason: "Zapas testu wózków",
  });
  for (const capacity of [20, 30]) {
    for (let i = 0; i < capacity; i++)
      await post("/api/wms/orders", {
        reference: `CART-E2E-${capacity}-${i}`,
        channel: "seeded",
        priority: 2,
        dueAt: "2026-01-01T12:00:00Z",
        lines: [{ sku: "WMS-0030", quantity: 1 }],
      });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-tab-wms="carts"]').click();
    await expect(
      page.locator('#wms-cart-start, [data-cart-action="list"]'),
    ).toBeVisible();
    if (!(await page.locator("#wms-cart-start").count()))
      await page.locator('[data-cart-action="list"]').click();
    await page
      .locator('#wms-cart-start [name="barcode"]')
      .fill(`CART-${capacity}`);
    await page.locator('#wms-cart-start [name="barcode"]').press("Enter");
    await expect(page.locator("#wms-cart-pick")).toBeVisible();
    if (capacity === 20) {
      await expect(page.locator(".wms-photo")).toContainText(
        "Nie udało się wczytać",
      );
      await expect(page.locator('#wms-cart-pick [name="bin"]')).toBeEnabled();
      await page.getByRole("button", { name: "Ponów zdjęcie" }).click();
    }
    await expect(page.locator(".wms-photo img")).toBeVisible();
    await expect
      .poll(() =>
        page.locator(".wms-photo img").evaluate((img) => img.naturalWidth),
      )
      .toBeGreaterThan(100);
    await page.locator('#wms-cart-pick [name="barcode"]').focus();
    await page
      .getByRole("button", { name: "Powiększ zdjęcie WMS-0030" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".wms-photo-dialog h2")).toContainText(
      "WMS-0030",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator('#wms-cart-pick [name="barcode"]')).toBeFocused();
    await expect(page.locator(".wms-cart h2")).toContainText(
      `${capacity}/${capacity}`,
    );
    await page.screenshot({
      path: path.join(output, `cart-${capacity}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(output, `cart-${capacity}-mobile.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const confirmation = await page
      .locator("#wms-cart-pick button.primary")
      .boundingBox();
    expect(confirmation.y + confirmation.height).toBeLessThanOrEqual(844);
    const boxWidth = await page
      .locator('#wms-cart-pick [name="tote"]')
      .evaluate((e) => e.getBoundingClientRect().width);
    const quantityWidth = await page
      .locator('#wms-cart-pick [name="quantity"]')
      .evaluate((e) => e.getBoundingClientRect().width);
    expect(boxWidth).toBeGreaterThan(quantityWidth);
    // Długi symbol części nie może wyciąć kodu skrzynki ani pola skanu.
    const name = page.locator(".wms-cart-product > strong:not(.wms-location)");
    const originalSku = await name.textContent();
    await name.evaluate((e) => {
      e.textContent = "SKU-".repeat(30);
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await name.evaluate((e, value) => {
      e.textContent = value;
    }, originalSku);
    let scans = 0;
    while (await page.locator("#wms-cart-pick").count()) {
      const task = await page.evaluate(
        () => document.getElementById("wms-content")._cartTask,
      );
      if (scans === 2) {
        await page.locator('[data-cart-action="reload"]').click();
        await expect(page.locator('#wms-cart-pick [name="bin"]')).toBeVisible();
      }
      const bin = page.locator('#wms-cart-pick [name="bin"]');
      if (await bin.isVisible()) {
        await bin.fill("loc:" + task.bin.toLowerCase());
        await bin.press("Enter");
        await expect(
          page.locator('#wms-cart-pick [name="barcode"]'),
        ).toBeFocused();
        await page.locator('#wms-cart-pick [name="barcode"]').fill(task.sku);
        await page.locator('#wms-cart-pick [name="barcode"]').press("Enter");
      }
      await expect(page.locator('#wms-cart-pick [name="tote"]')).toBeFocused();
      if (scans === 0) {
        await page.locator('#wms-cart-pick [name="tote"]').fill("WRONG-BOX");
        await page.locator('#wms-cart-pick [name="tote"]').press("Enter");
        await expect(page.locator("#wms-message")).toContainText("pojemnik");
        const unchanged = await page.evaluate(
          () => document.getElementById("wms-content")._cartTask,
        );
        expect(unchanged.version).toBe(task.version);
      }
      await page.locator('#wms-cart-pick [name="tote"]').fill(task.tote);
      await page.locator('#wms-cart-pick [name="tote"]').press("Enter");
      await expect
        .poll(() =>
          page.evaluate((previous) => {
            const next = document.getElementById("wms-content")._cartTask;
            return (
              !next ||
              next.allocation_id !== previous.allocation_id ||
              next.version !== previous.version
            );
          }, task),
        )
        .toBe(true);
      if (++scans > capacity) throw new Error("Wózek nie zakończył trasy");
    }
    expect(scans).toBe(capacity);
    await page
      .locator('#wms-cart-handoff [name="cart"]')
      .fill(`CART-${capacity}`);
    await page.locator('#wms-cart-handoff [name="station"]').fill("PACK-01");
    await page.locator("#wms-cart-handoff button").click();
    await expect(page.locator("#wms-content")).toContainText(
      "Wózek przekazany",
    );
    await page.locator('[data-tab-wms="packing"]').click();
    await page.locator('#wms-cart-pack [name="station"]').fill("PACK-01");
    await page.locator('#wms-cart-pack [name="box"]').fill(`BOX${capacity}-01`);
    await page.locator("#wms-cart-pack button").click();
    await expect(
      page.locator('#wms-work form[data-action-wms="pack"]'),
    ).toBeVisible();
    if (!(await page.locator('[data-tab-wms="carts"]').isVisible()))
      await page.locator('#wms-work [data-do-wms="queue"]').click();
    await page.locator('[data-tab-wms="carts"]').click();
    await page.locator('[data-cart-action="list"]').click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-cart-new="20"]').click();
  await page.locator('#wms-cart-configure [name="code"]').fill("STOCK-20");
  await page
    .locator('#wms-cart-configure [name="name"]')
    .fill("Kontrola zapasu");
  for (let position = 1; position <= 20; position++) {
    const input = page.locator(`#wms-cart-configure [name="box-${position}"]`);
    await input.fill(`STOCK-BOX-${position}`);
    await input.press("Enter");
    if (position < 20)
      await expect(
        page.locator(`#wms-cart-configure [name="box-${position + 1}"]`),
      ).toBeFocused();
  }
  await expect(page.locator("#wms-cart-start")).toBeVisible();
  for (let i = 0; i < 20; i++)
    await post("/api/wms/orders", {
      reference: `STOCK-WORK-${i}`,
      priority: 2,
      dueAt: "2025-01-01T12:00:00Z",
      lines: [{ sku: "WMS-0036", quantity: 1 }],
    });
  await post("/api/wms/bins", {
    bin: "RES-E2E",
    mode: "reserve",
    version: 1,
    reason: "Zaplecze testowe",
  });
  await post("/api/wms/inventory", {
    action: "receive",
    twId: 36,
    bin: "RES-E2E",
    quantity: 50,
    reason: "Zapas uzupełnienia",
  });
  await page.locator('#wms-cart-start [name="barcode"]').fill("STOCK-20");
  await page.locator('#wms-cart-start [name="barcode"]').press("Enter");
  await expect(page.locator("#wms-cart-pick")).toBeVisible();
  await page.locator("[data-cart-exception]").click();
  await page
    .locator('#wms-cart-exception [name="kind"]')
    .selectOption("missing");
  await page.locator('#wms-cart-exception [name="box"]').fill("STOCK-BOX-1");
  await page
    .locator('#wms-cart-exception [name="reason"]')
    .fill("Półka fizycznie pusta");
  await page.locator("#wms-cart-exception button").click();
  await expect(page.locator("#wms-content")).toContainText(
    "czeka na przeliczenie",
  );
  await expect(page.locator("#wms-cart-pick")).toHaveCount(0);
  await page.locator('[data-tab-wms="stockwork"]').click();
  await page.locator("[data-stockwork-check]").click();
  await page.locator('#wms-stockwork-count [name="bin"]').fill("A05-01-02");
  await page.locator('#wms-stockwork-count [name="barcode"]').fill("WMS-0036");
  await page.locator('#wms-stockwork-count [name="quantity"]').fill("0");
  await page
    .locator('#wms-stockwork-count [name="reason"]')
    .fill("Sprawdzono pustą półkę");
  await page.locator("#wms-stockwork-count button").click();
  await expect(page.locator("#wms-message")).toContainText("Przeliczono półkę");
  await page.locator('#wms-stockwork-filter [name="q"]').fill("WMS-0036");
  await page
    .locator(
      '#wms-stockwork-filter button[type="submit"], #wms-stockwork-filter button:not([type])',
    )
    .click();
  await expect(page.locator("[data-stockwork-claim]")).toHaveCount(1);
  await page.locator("[data-stockwork-claim]").click();
  await expect(
    page.locator('#wms-stockwork-complete [name="source"]'),
  ).toBeFocused();
  await page.locator('#wms-stockwork-complete [name="source"]').fill("RES-E2E");
  await page.locator('#wms-stockwork-complete [name="source"]').press("Enter");
  await expect(
    page.locator('#wms-stockwork-complete [name="barcode"]'),
  ).toBeFocused();
  await page
    .locator('#wms-stockwork-complete [name="barcode"]')
    .fill("WMS-0036");
  await page.locator('#wms-stockwork-complete [name="barcode"]').press("Enter");
  const counted = page.locator('#wms-stockwork-complete [name="quantity"]');
  await expect(counted).toBeFocused();
  await expect(counted).toHaveValue("");
  await counted.press("Enter");
  await expect(counted).toBeFocused();
  await counted.fill(await counted.getAttribute("max"));
  await counted.press("Enter");
  await expect(
    page.locator('#wms-stockwork-complete [name="target"]'),
  ).toBeFocused();
  await page
    .locator('#wms-stockwork-complete [name="target"]')
    .fill("A05-01-02");
  await page.locator("#wms-stockwork-complete button").click();
  await expect(page.locator("[data-stockwork-task]")).toHaveCount(0);
  await page.screenshot({
    path: path.join(output, "stock-work-desktop.png"),
    fullPage: true,
  });
  expect(photoRequests).toBe(2);
  page.off("request", countPhoto);
}
