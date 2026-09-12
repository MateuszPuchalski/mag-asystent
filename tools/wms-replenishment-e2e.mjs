import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";

export async function exerciseReplenishment(page, output) {
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
  const twId = 39,
    source = "REPL-E2E",
    target = "REPL-PICK",
    sku = "WMS-0039";
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
      reason: "Dostawa testowa",
    });
  await api("/api/wms/inventory", {
    action: "minimum",
    twId,
    bin: target,
    quantity: 5,
    version: 2,
    reason: "Minimum półki",
  });
  await page.locator('[data-tab-wms="stockwork"]').click();
  await page.locator('#wms-stockwork-filter [name="q"]').fill(target);
  await page.locator("#wms-stockwork-filter button").first().click();
  await expect(page.locator("[data-stockwork-claim]")).toHaveCount(1);
  await page.locator("[data-stockwork-claim]").click();
  const form = page.locator("#wms-stockwork-complete");
  await expect(form).toBeVisible();
  const id = Number(await form.getAttribute("data-task"));
  await form.locator('[name="source"]').fill(source);
  await form.locator('[name="barcode"]').fill(sku);
  await expect(form.locator('[name="quantity"]')).toHaveValue("");
  await form.locator('[name="quantity"]').fill("2");
  await form.locator('[name="quantity"]').press("Enter");
  await expect(form.locator('[name="reason"]')).toBeFocused();
  await form.locator('[name="reason"]').press("Enter");
  await expect(form.locator('[name="reason"]')).toBeFocused();
  await form.locator('[name="reason"]').fill("Znaleziono tylko dwie sztuki");
  await form.locator('[name="reason"]').press("Enter");
  await expect(form.locator('[name="target"]')).toBeFocused();
  await form.locator('[name="target"]').fill(target);
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
  const inventory = await api(`/api/wms/inventory?q=${sku}`);
  expect(inventory.rows.find((r) => r.bin === source).on_hand).toBe(8);
  expect(inventory.rows.find((r) => r.bin === target).on_hand).toBe(3);
  expect(
    (await api(`/api/wms/replenishment-work?view=plans&q=${target}`)).total,
  ).toBe(0);
  const check = (await api("/api/wms/stock-work")).checks.find(
    (c) => c.tw_id === twId && c.bin === source,
  );
  expect(check).toBeTruthy();
  await api(`/api/wms/stock-checks/${check.id}/count`, {
    bin: source,
    barcode: sku,
    quantity: 0,
    version: check.stock_version,
    reason: "Zweryfikowano puste źródło",
  });

  // Nowa dostawa otwiera kolejny przydział; zero także musi pozostać widocznym wynikiem bez ruchu.
  await api("/api/wms/inventory", {
    action: "receive",
    twId,
    bin: source,
    quantity: 4,
    reason: "Kolejna dostawa testowa",
  });
  const plan = (await api(`/api/wms/replenishment-work?view=plans&q=${target}`))
    .plans[0];
  const empty = await api("/api/wms/replenishments", {
    twId,
    source,
    target,
    quantity: 2,
    sourceVersion: plan.source_version,
    targetVersion: plan.target_version,
  });
  await page.locator('[data-tab-wms="stockwork"]').click();
  await page.locator(`[data-stockwork-task="${empty.id}"]`).click();
  await page
    .getByText("Puste źródło — zero pobranych sztuk", { exact: true })
    .click();
  const zero = page.locator("#wms-stockwork-empty");
  await zero.locator('[name="source"]').fill(source);
  await zero.locator('[name="barcode"]').fill(sku);
  await zero.locator('[name="reason"]').fill("Pusta lokalizacja");
  await zero.locator("button").click();
  await expect(page.locator(`[data-stockwork-task="${empty.id}"]`)).toHaveCount(
    0,
  );
  expect((await api(`/api/wms/replenishment-work/${empty.id}`)).moved).toBe(0);
  const after = await api(`/api/wms/inventory?q=${sku}`);
  expect(after.rows.find((r) => r.bin === source).on_hand).toBe(4);
  expect(after.rows.find((r) => r.bin === target).on_hand).toBe(3);
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  writeFileSync(
    path.join(output, "replenishment-e2e.json"),
    JSON.stringify(
      {
        partial: { task: id, moved: 2, lostResponseRecovered: true },
        empty: { task: empty.id, moved: 0, sourceUnchanged: 4 },
        integrity: true,
      },
      null,
      2,
    ),
  );
}
