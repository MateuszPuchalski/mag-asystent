import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";

export async function exerciseCapacity(page, output) {
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
  const twId = 38,
    sku = "WMS-0038",
    source = "CAP-RES",
    target = "CAP-PICK";
  await api("/api/wms/bins", {
    bin: source,
    mode: "reserve",
    version: 1,
    reason: "Zaplecze testowe",
  });
  for (const [bin, quantity] of [
    [source, 10],
    [target, 1],
  ])
    await api("/api/wms/inventory", {
      action: "receive",
      twId,
      bin,
      quantity,
      reason: "Zapas seeded",
    });
  await page.locator('[data-tab-wms="stock"]').click();
  await page.locator('#wms-filter [name="q"]').fill(target);
  await page.locator("#wms-filter button").click();
  await expect(page.locator("[data-stock-wms]")).toHaveCount(1);
  await page.locator("[data-stock-wms]").click();
  await page.locator("#wms-stock-form summary").click();
  const limits = page.locator("#wms-stock-limits");
  await limits.locator('[name="minimum"]').fill("5");
  await limits.locator('[name="capacity"]').fill("5");
  await limits
    .locator('[name="reason"]')
    .fill("Sprawdzono miejsce na pięć sztuk");
  await limits.locator("button").click();
  await expect(page.locator("#wms-message")).toContainText("Zapisano minimum");
  expect((await api("/api/wms/inventory?q=" + target)).rows[0].capacity).toBe(
    5,
  );
  await page.locator('[data-tab-wms="stockwork"]').click();
  await page.locator('#wms-stockwork-filter [name="q"]').fill(target);
  await page.locator("#wms-stockwork-filter button").first().click();
  await expect(page.locator("[data-stockwork-claim]")).toHaveCount(1);
  await page.locator("[data-stockwork-claim]").click();
  const id = Number(
    await page.locator("#wms-stockwork-complete").getAttribute("data-task"),
  );
  await page
    .getByText("Cel pełny — odłożenie i zwrot reszty", { exact: true })
    .click();
  const form = page.locator("#wms-stockwork-space-finish");
  for (const [name, value] of Object.entries({
    source: "LOC:" + source,
    barcode: sku,
    pickedQuantity: "4",
    quantity: "2",
    target: "LOC:" + target,
    returnedSource: "LOC:" + source,
    reason: "Mieszczą się tylko dwie sztuki",
  })) {
    await form.locator(`[name="${name}"]`).fill(value);
    const next = {
      source: "barcode",
      barcode: "pickedQuantity",
      pickedQuantity: "quantity",
      quantity: "target",
      target: "returnedSource",
      returnedSource: "reason",
    }[name];
    if (next) {
      await form.locator(`[name="${name}"]`).press("Enter");
      await expect(form.locator(`[name="${next}"]`)).toBeFocused();
    }
  }
  const widths = [];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await form.scrollIntoViewIfNeeded();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    );
    expect(fits).toBe(true);
    widths.push({ width, fits });
    await page.screenshot({
      path: path.join(output, `capacity-return-${width}.png`),
    });
  }
  await page.route(
    `**/api/wms/replenishments/${id}/complete`,
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await form.locator("button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator(`[data-stockwork-task="${id}"]`)).toHaveCount(0);
  const task = await api(`/api/wms/replenishment-work/${id}`);
  expect(task.moved).toBe(2);
  expect(task.returned_quantity).toBe(2);
  expect(task.target_full).toBe(1);
  const work = await api("/api/wms/stock-work"),
    issue = work.capacityIssues.find(
      (c) => c.tw_id === twId && c.bin === target,
    );
  expect(issue).toBeTruthy();
  expect(work.checks.some((c) => c.tw_id === twId && c.bin === source)).toBe(
    false,
  );
  const inventory = await api("/api/wms/inventory?q=" + sku);
  expect(inventory.rows.find((s) => s.bin === source).on_hand).toBe(8);
  expect(inventory.rows.find((s) => s.bin === target).on_hand).toBe(3);
  expect(
    (await api("/api/wms/replenishment-work?view=plans&q=" + target)).total,
  ).toBe(0);
  await page.locator('[data-tab-wms="analytics"]').click();
  await expect(page.locator('[data-flow-queue="capacity"]')).toBeVisible();
  await page.locator('[data-flow-queue="capacity"]').click();
  await page.locator(`[data-stockwork-space="${issue.id}"]`).click();
  const resolve = page.locator("#wms-stockwork-space-resolve");
  await resolve.locator('[name="bin"]').fill(target);
  await resolve.locator('[name="reason"]').fill("Zwolniono miejsce po zbiórce");
  await resolve.locator("button").click();
  await expect(
    page.locator(`[data-stockwork-space="${issue.id}"]`),
  ).toHaveCount(0);
  expect(
    (await api("/api/wms/replenishment-work?view=plans&q=" + target)).plans[0]
      .quantity,
  ).toBe(2);
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  // Wszystkie dotychczasowe półki części są pełne; nowe zapotrzebowanie musi trafić na wolny drugi cel.
  const alternateSku = "WMS-0037",
    alternateTw = 37,
    alternateTarget = "ROOM-B";
  const existing = (
    await api(`/api/wms/inventory?q=${alternateSku}`)
  ).rows.filter((s) => s.mode === "pick");
  for (const row of existing)
    await api("/api/wms/inventory", {
      action: "limits",
      twId: alternateTw,
      bin: row.bin,
      minimum: 0,
      capacity: row.on_hand,
      version: row.version,
      reason: "Test pełnych półek",
    });
  await api("/api/wms/bins", {
    bin: "ROOM-RES",
    mode: "reserve",
    version: 1,
    reason: "Zapas alternatywnego celu",
  });
  await api("/api/wms/inventory", {
    action: "receive",
    twId: alternateTw,
    bin: "ROOM-RES",
    quantity: 10,
    reason: "Dostawa seeded",
  });
  await api("/api/wms/inventory", {
    action: "limits",
    twId: alternateTw,
    bin: alternateTarget,
    minimum: 0,
    capacity: 10,
    version: 1,
    reason: "Wolny cel dla części",
  });
  await api("/api/wms/orders", {
    reference: "CAPACITY-ALTERNATE",
    channel: "seeded",
    dueAt: "2026-12-31T12:00:00Z",
    lines: [
      {
        sku: alternateSku,
        quantity: existing.reduce((n, s) => n + s.available, 0) + 3,
      },
    ],
  });
  await page.locator('[data-tab-wms="stockwork"]').click();
  await page.locator('#wms-stockwork-filter [name="q"]').fill(alternateSku);
  await page.locator("#wms-stockwork-filter button").first().click();
  await expect(page.locator("[data-stockwork-claim]")).toHaveCount(1);
  await expect(page.locator("[data-stockwork-claim]")).toContainText("3 SZT.");
  await expect(
    page.locator("[data-stockwork-claim]").locator("xpath=ancestor::tr"),
  ).toContainText("ZAMÓWIENIA · brak 3 szt. SKU");
  await page.locator('[data-stockwork-action="all"]').click();
  await expect(
    page
      .locator("[data-stockwork-claim]")
      .first()
      .locator("xpath=ancestor::tr"),
  ).toContainText(alternateSku);
  await page.locator("[data-stockwork-claim]").first().click();
  await expect(page.locator("#wms-stockwork-detail")).toContainText(
    alternateTarget,
  );
  expect(
    (await api(`/api/wms/replenishment-work?view=plans&q=${alternateSku}`))
      .total,
  ).toBe(0);
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  writeFileSync(
    path.join(output, "capacity-e2e.json"),
    JSON.stringify(
      {
        limits: 5,
        moved: 2,
        returned: 2,
        sourceShortage: false,
        recoveredLostResponse: true,
        resolvedIssue: issue.id,
        widths,
        integrity: true,
        alternateTarget,
        alternateQuantity: 3,
        demandBeforeMinimum: true,
      },
      null,
      2,
    ),
  );
}
