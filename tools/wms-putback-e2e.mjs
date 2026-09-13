import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { exerciseEmptyBox } from "./wms-empty-box-e2e.mjs";
export async function exercisePutback(page, output) {
  const api = (url, body, key) =>
    page.evaluate(
      async ({ url, body, key }) => {
        const r = await fetch(url, {
          method: body ? "POST" : "GET",
          headers: {
            "x-session": token,
            ...(body
              ? {
                  "content-type": "application/json",
                  "idempotency-key": key ?? crypto.randomUUID(),
                }
              : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await r.json();
        if (!r.ok) throw Error(JSON.stringify(result));
        return result;
      },
      { url, body, key },
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
  let p = t.picks[0];
  t = await api(`/api/wms/putback/${t.id}/finish`, {
    version: t.version,
    orderVersion: t.order_version,
    box: t.box,
    allocationId: p.allocation_id,
    bin: p.bin,
    barcode: p.sku,
    quantity: 1,
  });
  await api("/api/wms/bins", {
    bin: "PUTBACK-QUAR",
    mode: "quarantine",
    version: 1,
    reason: "Kwarantanna uszkodzeń zwrotu",
  });
  p = t.picks[0];
  const damage = {
    version: t.version,
    orderVersion: t.order_version,
    box: t.box,
    allocationId: p.allocation_id,
    barcode: p.sku,
    quantity: 1,
    quarantine: "PUTBACK-QUAR",
    reason: "Pęknięta część przy zwrocie",
  };
  const damageKey = crypto.randomUUID();
  t = await api(`/api/wms/putback/${t.id}/damage`, damage, damageKey);
  expect(
    await api(`/api/wms/putback/${t.id}/damage`, damage, damageKey),
  ).toEqual(t);
  expect(t.picks[0].remaining).toBe(1);
  expect(t.issues).toHaveLength(1);
  t = await api(`/api/wms/putback/${t.id}/release`, {
    version: t.version,
    station: t.station,
    box: t.box,
    reason: "Ostatniej sztuki nie znaleziono",
  });
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill(o.reference);
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${o.id}"]`).click();
  await page
    .getByText("Problem, przejęcie lub anulowanie", { exact: true })
    .click();
  await page
    .getByText("Po przeliczeniu nadal brakuje części", { exact: true })
    .click();
  const shortage = page.locator("#wms-putback-shortage");
  await expect(shortage.locator('[name="observedQuantity"]')).toHaveValue("");
  expect(await shortage.evaluate((f) => f.checkValidity())).toBe(false);
  await shortage.locator('[name="station"]').fill(t.station);
  await shortage.locator('[name="box"]').fill(t.box);
  await shortage.locator('[name="observedQuantity"]').fill("0");
  await shortage
    .locator('[name="reason"]')
    .fill("Przeliczono skrzynkę i sprawdzono stanowisko; brak części");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await shortage.screenshot({
      path: path.join(output, `putback-shortage-${width}.png`),
    });
  }
  await page.route(
    `**/api/wms/putback/${t.id}/shortage`,
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await shortage.locator("button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-retry")).not.toContainText("PONÓW");
  t = await api(`/api/wms/putback/${t.id}`);
  expect(t.issues).toHaveLength(2);
  expect(t.issues.find((i) => i.kind === "shortage").quarantine).toBeNull();
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
  // Zamknięcie dawnej sprawy musi działać z zamówienia, gdy skrzynki nie ma już na trasie.
  let returned = await api("/api/wms/orders", {
    reference: "E2E-RETURNED-EXCEPTION",
    channel: "seeded",
    priority: 2,
    dueAt: "2000-01-01T12:00:00Z",
    lines: [{ sku: "WMS-0035", quantity: 3 }],
  });
  await api("/api/wms/carts", {
    code: "REVIEW-CART",
    name: "Zwrot zgłoszenia",
    capacity: 20,
    version: 0,
    boxes: Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      barcode: i === 0 ? "REVIEW-BOX" : null,
    })),
  });
  const reviewRun = (
    await api("/api/wms/cart-start", { barcode: "REVIEW-CART" })
  ).run;
  const pick = reviewRun.tasks.find((p) => p.order_id === returned.id);
  expect(pick).toBeTruthy();
  await api(`/api/wms/waves/${reviewRun.id}/pick`, {
    orderId: returned.id,
    version: pick.version,
    allocationId: pick.allocation_id,
    bin: pick.bin,
    barcode: pick.sku,
    tote: pick.tote,
    quantity: 1,
  });
  returned = await api(`/api/wms/orders/${returned.id}`);
  await api("/api/wms/pick-exceptions", {
    orderId: returned.id,
    version: returned.version,
    allocationId: pick.allocation_id,
    box: pick.tote,
    kind: "missing",
    reason: "Brak pozostałych części na półce",
  });
  await api(`/api/wms/cart-runs/${reviewRun.id}/handoff`, {
    cart: "REVIEW-CART",
    station: "PUTBACK-PACK",
  });
  returned = await api(`/api/wms/orders/${returned.id}`);
  let rt = await api("/api/wms/putback", {
    orderId: returned.id,
    version: returned.version,
    reason: "Wycofanie do zmiany zamówienia",
  });
  rt = await api(`/api/wms/putback/${rt.id}/claim`, {
    version: rt.version,
    box: rt.box,
    station: rt.station,
    contentsConfirmed: true,
  });
  rt = await api(`/api/wms/putback/${rt.id}/finish`, {
    version: rt.version,
    orderVersion: rt.order_version,
    box: rt.box,
    allocationId: rt.picks[0].allocation_id,
    bin: pick.bin,
    barcode: pick.sku,
    quantity: 1,
  });
  expect(rt.completed_at).not.toBeNull();
  returned = await api(`/api/wms/orders/${returned.id}`);
  expect(returned.tote).toBeNull();
  expect(returned.returnedPickException.stock_check_open).toBe(1);
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill(returned.reference);
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${returned.id}"]`).click();
  const review = page.locator("#wms-returned-exception");
  await expect(review).toBeVisible();
  await expect(review.locator('[name="box"]')).toHaveCount(0);
  expect(await review.evaluate((f) => f.checkValidity())).toBe(false);
  await review
    .locator('[name="reason"]')
    .fill("Pobrania rozliczone; klient zmienia ilość");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(review).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await review.screenshot({
      path: path.join(output, `returned-exception-${width}.png`),
    });
  }
  await page.route(
    "**/api/wms/pick-exceptions/resolve",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await review.locator("button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(review).toHaveCount(0);
  const reviewed = await api(`/api/wms/orders/${returned.id}`);
  expect(reviewed.version).toBe(returned.version + 1);
  expect(reviewed.hold_reason).toBe(returned.hold_reason);
  await page.locator("#wms-amend summary").click();
  await page.locator('#wms-amend [name="lines"]').fill("WMS-0035;1");
  await page
    .locator('#wms-amend [name="reason"]')
    .fill("Klient zmienił ilość po zwrocie");
  await page.locator("#wms-amend button").click();
  await expect
    .poll(
      async () =>
        (await api(`/api/wms/orders/${returned.id}`)).lines[0].quantity,
    )
    .toBe(1);
  const work = await api("/api/wms/stock-work?q=WMS-0035");
  expect(work.checks.some((c) => c.bin === pick.bin)).toBe(true);
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  await exerciseEmptyBox(page, output, api);
  writeFileSync(
    path.join(output, "putback-e2e.json"),
    JSON.stringify(
      {
        seededOnly: true,
        officeInstruction: true,
        lostInstructionResponseRecovered: true,
        postHandoff: true,
        partialPackingClearedOnClaim: true,
        returned: 1,
        quarantined: 1,
        confirmedMissing: 1,
        repeatedDamageSavedOnce: true,
        lostShortageResponseRecovered: true,
        heldUntilOfficeDecision: true,
        returnedPickingExceptionReviewed: true,
        lostReviewResponseRecovered: true,
        orderAmendedWhileShelfCheckStaysOpen: true,
        nativePhysicalDevice: false,
      },
      null,
      2,
    ),
  );
}
