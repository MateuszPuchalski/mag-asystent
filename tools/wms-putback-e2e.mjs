import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
export async function exercisePutback(page, output) {
  const api = (url, body) =>
    page.evaluate(
      async ({ url, body }) => {
        const r = await fetch(url, {
          method: body ? "POST" : "GET",
          headers: {
            "x-session": token,
            ...(body
              ? {
                  "content-type": "application/json",
                  "idempotency-key": crypto.randomUUID(),
                }
              : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await r.json();
        if (!r.ok) throw Error(JSON.stringify(result));
        return result;
      },
      { url, body },
    );
  await api("/api/wms/stations", {
    code: "PUTBACK-PACK",
    name: "Pakowanie zwrotu",
    kind: "pack",
    version: 0,
    active: true,
  });
  let o = await api("/api/wms/orders", {
    reference: "E2E-PUTBACK",
    channel: "seeded",
    priority: 2,
    dueAt: "2026-01-01T12:00:00Z",
    lines: [{ sku: "WMS-0040", quantity: 3 }],
  });
  await api("/api/wms/carts", {
    code: "PUTBACK-CART",
    name: "Zwrot z pakowania",
    capacity: 20,
    selection: "all",
    maxUnits: 3,
    version: 0,
    boxes: Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      barcode: `PUTBACK-${i + 1}`,
    })),
  });
  let run = (await api("/api/wms/cart-start", { barcode: "PUTBACK-CART" })).run;
  while (run.tasks.some((t) => !t.hold_reason && !t.stock_blocked)) {
    const p = run.tasks.find((t) => !t.hold_reason && !t.stock_blocked);
    await api(`/api/wms/waves/${run.id}/pick`, {
      orderId: p.order_id,
      version: p.version,
      allocationId: p.allocation_id,
      bin: p.bin,
      barcode: p.sku,
      tote: p.tote,
      quantity: p.remaining,
    });
    run = await api(`/api/wms/cart-runs/${run.id}`);
  }
  await api(`/api/wms/cart-runs/${run.id}/handoff`, {
    cart: "PUTBACK-CART",
    station: "PUTBACK-PACK",
  });
  o = await api(`/api/wms/orders/${o.id}`);
  o = await api("/api/wms/cart-box-pack", {
    box: o.tote,
    station: "PUTBACK-PACK",
  });
  o = await api(`/api/wms/orders/${o.id}/actions`, {
    action: "pack",
    version: o.version,
    barcode: "WMS-0040",
    quantity: 1,
    parcelNo: 1,
  });
  o = await api(`/api/wms/orders/${o.id}/actions`, {
    action: "hold",
    version: o.version,
    reason: "Klient anulował po rozpoczęciu pakowania",
  });
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill(o.reference);
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${o.id}"]`).click();
  await page
    .getByText("Problem, przejęcie lub anulowanie", { exact: true })
    .click();
  const form = page.locator("#wms-putback-request");
  await expect(form).toBeVisible();
  await form
    .locator('[name="reason"]')
    .fill("Zlecony zwrot dobrych części przed anulowaniem");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await form.screenshot({
      path: path.join(output, `putback-request-${width}.png`),
    });
  }
  await page.route(
    "**/api/wms/putback",
    async (route) => {
      if (route.request().method() === "POST") {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
    { times: 1 },
  );
  await form.locator("button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-retry")).not.toContainText("PONÓW");
  o = await api(`/api/wms/orders/${o.id}`);
  expect(o.lines[0].packed).toBe(1);
  expect(o.putback).not.toBeNull();
  let t = await api(`/api/wms/putback/${o.putback.id}`);
  await page.locator('[data-tab-wms="putback"]').click();
  await expect(page.locator("#wms-content")).toContainText(o.reference);
  await page.locator(`[data-putback-order="${o.id}"]`).click();
  await page
    .getByText("Problem, przejęcie lub anulowanie", { exact: true })
    .click();
  await expect(page.locator("#wms-putback-abort")).toBeVisible();
  t = await api(`/api/wms/putback/${t.id}/claim`, {
    version: t.version,
    box: t.box,
    station: t.station,
    contentsConfirmed: true,
  });
  expect((await api(`/api/wms/orders/${o.id}`)).lines[0].packed).toBe(0);
  for (const quantity of [1, 2]) {
    const p = t.picks[0];
    t = await api(`/api/wms/putback/${t.id}/finish`, {
      version: t.version,
      orderVersion: t.order_version,
      box: t.box,
      allocationId: p.allocation_id,
      bin: p.bin,
      barcode: p.sku,
      quantity,
    });
  }
  expect(t.completed_at).not.toBeNull();
  o = await api(`/api/wms/orders/${o.id}`);
  expect(o.hold_reason).not.toBeNull();
  expect(o.lines[0].picked).toBe(0);
  await api(`/api/wms/orders/${o.id}/actions`, {
    action: "cancel",
    version: o.version,
    reason: "Pobrania zwrócone przez operatora",
  });
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  writeFileSync(
    path.join(output, "putback-e2e.json"),
    JSON.stringify(
      {
        seededOnly: true,
        officeInstruction: true,
        lostInstructionResponseRecovered: true,
        postHandoff: true,
        partialPackingClearedOnClaim: true,
        returned: 3,
        heldUntilOfficeDecision: true,
        nativePhysicalDevice: false,
      },
      null,
      2,
    ),
  );
}
