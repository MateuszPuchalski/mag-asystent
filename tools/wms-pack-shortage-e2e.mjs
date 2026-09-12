import { expect } from "@playwright/test";
import path from "node:path";

export async function exercisePackingShortage(page, output) {
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
  let o = await api("/api/wms/orders", {
    reference: "E2E-PACK-SHORTAGE",
    dueAt: "2026-12-31T12:00:00Z",
    lines: [{ sku: "WMS-0030", quantity: 3 }],
  });
  const act = async (body) =>
    (o = await api(`/api/wms/orders/${o.id}/actions`, {
      ...body,
      version: o.version,
    }));
  await act({ action: "allocate" });
  await act({ action: "pick-start", tote: "SHORTAGE-BOX" });
  for (const a of o.allocations)
    await act({
      action: "pick",
      allocationId: a.id,
      bin: a.bin,
      barcode: "WMS-0030",
      quantity: a.quantity,
    });
  await act({ action: "pack-start", tote: o.tote });
  await act({ action: "pack", barcode: "WMS-0030", quantity: 1, parcelNo: 1 });
  await act({ action: "pack", barcode: "WMS-0030", quantity: 2, parcelNo: 2 });
  await act({ action: "hold", reason: "Wyjaśnienie braku przy pakowaniu" });
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill(o.reference);
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${o.id}"]`).click();
  await page.locator(".wms-shortage-correction > summary").click();
  const form = page.locator("#wms-packing-shortage");
  await expect(form.locator('[name="observedQuantity"]')).toHaveValue("");
  await form.locator('[name="box"]').fill("LOC:SHORTAGE-BOX");
  await form.locator('[name="lineId"]').selectOption(String(o.lines[0].id));
  await form.locator('[name="fromParcel"]').selectOption("2");
  await form
    .locator('[name="reason"]')
    .fill("Przeliczono paczkę i sprawdzono stanowisko — seeded");
  // Pusta ilość nie może zostać zamieniona na zero przez serializację formularza.
  expect(await form.evaluate((f) => f.checkValidity())).toBe(false);
  await form.locator('[name="observedQuantity"]').fill("1");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await form.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(output, `packing-shortage-${width}.png`),
      fullPage: true,
    });
  }
  await page.route(
    "**/api/wms/packing-shortage",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await form.locator("button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-step")).toContainText(
    "Czeka na wymianę: 1 szt.",
  );
  o = await api(`/api/wms/orders/${o.id}`);
  expect(o.lines[0].picked).toBe(2);
  expect(o.lines[0].packed).toBe(2);
  expect(o.packingContents.map((c) => c.quantity)).toEqual([1, 1]);
  expect(o.hold_reason).toBe("Wyjaśnienie braku przy pakowaniu");
  await act({
    action: "resume",
    reason: "Brak rozliczony przez biuro; zamiennik do pobrania",
  });
  let t = await api(`/api/wms/packing-recovery/${o.packingRecovery.id}`);
  expect(t.lines[0].kind).toBe("shortage");
  expect(t.lines[0].quarantine).toBe("");
  const report = await api("/api/wms/analytics?days=1");
  expect(report.packingIssues.find((r) => r.kind === "shortage")).toMatchObject(
    { cases: 1, units: 1, waiting_units: 1 },
  );
  await page.locator(`[data-recovery-open="${t.id}"]`).click();
  await expect(page.locator("#wms-content")).toContainText(
    "brak potwierdzony po przeliczeniu",
  );
  await page.locator("[data-recovery-claim]").click();
  t = await api(`/api/wms/packing-recovery/${t.id}`);
  const pick = page.locator(".wms-recovery-pick");
  for (const [name, value] of Object.entries({
    source: t.picks[0].bin,
    barcode: "WMS-0030",
    quantity: "1",
    box: o.tote,
  }))
    await pick.locator(`[name="${name}"]`).fill(value);
  await pick.locator("button").click();
  await expect(page.locator("#wms-content")).toContainText(
    "Zamienniki dostarczone",
  );
  await page.locator("[data-recovery-order]").click();
  await page
    .locator('[data-action-wms="pack"] [name="parcelNo"]')
    .selectOption("2");
  const scan = page.locator('[data-action-wms="pack"] [name="barcode"]');
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  await expect(page.locator(".wms-parcel-label")).toHaveCount(2);
  o = await api(`/api/wms/orders/${o.id}`);
  expect(o.lines[0].packed).toBe(3);
  expect((await api("/api/wms/integrity")).ok).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-do-wms="queue"]').click();
}
