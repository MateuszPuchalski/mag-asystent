import { expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";

export async function exerciseReturns(page, output) {
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
  async function picked(reference, lines, tote) {
    let order = await api("/api/wms/orders", {
      reference,
      channel: "seeded",
      dueAt: "2026-12-31T12:00:00Z",
      lines,
    });
    const act = async (body) => {
      order = await api(`/api/wms/orders/${order.id}/actions`, {
        ...body,
        version: order.version,
      });
    };
    await act({ action: "allocate" });
    await act({ action: "pick-start", tote });
    for (const a of order.allocations)
      await act({
        action: "pick",
        allocationId: a.id,
        bin: a.bin,
        barcode: order.lines.find((l) => l.id === a.line_id).sku,
        quantity: a.quantity,
      });
    return order;
  }
  let order = await picked(
    "E2E-RETURN-A",
    [
      { sku: "WMS-0030", quantity: 2 },
      { sku: "WMS-0031", quantity: 2 },
    ],
    "RETURN-BOX-A",
  );
  const other = await picked(
    "E2E-RETURN-B",
    [{ sku: "WMS-0030", quantity: 2 }],
    "RETURN-BOX-B",
  );
  order = await api(`/api/wms/orders/${order.id}/actions`, {
    action: "hold",
    version: order.version,
    reason: "Zmiana klienta",
  });
  await page.locator('[data-tab-wms="orders"]').click();
  await page.locator('#wms-filter [name="q"]').fill(order.reference);
  await page.locator('#wms-filter [name="status"]').selectOption("all");
  await page.locator("#wms-filter").evaluate((f) => f.requestSubmit());
  await page.locator(`[data-order-wms="${order.id}"]`).click();
  await page
    .getByText("Problem, przejęcie lub anulowanie", { exact: true })
    .click();
  const form = page.locator('[data-action-wms="return"]');
  const field = (name) => form.locator(`[name="${name}"]`);
  await expect(field("quantity")).toHaveValue("");
  await field("tote").fill(other.tote);
  await field("tote").press("Enter");
  await expect(field("barcode")).toBeFocused();
  await field("barcode").fill("WMS-0030");
  await field("barcode").press("Enter");
  await expect(field("quantity")).toBeFocused();
  for (const value of ["", "0", "1.5", "3"]) {
    await field("quantity").fill(value);
    await field("quantity").press("Enter");
    await expect(field("quantity")).toBeFocused();
  }
  await field("quantity").fill("1");
  await field("quantity").press("Enter");
  await expect(field("reason")).toBeFocused();
  await field("reason").fill("Zwrot po zmianie klienta");
  await field("reason").press("Enter");
  await expect(field("bin")).toBeFocused();
  await field("bin").fill(order.allocations[0].bin);
  await field("allocationId").selectOption(String(order.allocations[1].id));
  for (const name of ["barcode", "quantity", "bin"])
    await expect(field(name)).toHaveValue("");
  await field("allocationId").selectOption(String(order.allocations[0].id));
  await field("barcode").fill("WMS-0030");
  await field("quantity").fill("1");
  await field("bin").fill(order.allocations[0].bin);
  const rejected = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/wms/orders/${order.id}/actions`) &&
      r.request().method() === "POST",
  );
  await form.locator("button").click();
  expect((await rejected).status()).toBe(400);
  expect((await api(`/api/wms/orders/${order.id}`)).lines[0].picked).toBe(2);
  await field("tote").fill(order.tote);
  await expect(field("bin")).toHaveValue("");
  await field("bin").fill(order.allocations[0].bin);
  const widths = [];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    widths.push(width);
    await form.screenshot({
      path: path.join(output, `picking-return-${width}.png`),
    });
  }
  await page.route(
    `**/api/wms/orders/${order.id}/actions`,
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await field("bin").press("Enter");
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-retry")).not.toContainText("PONÓW");
  const after = await api(`/api/wms/orders/${order.id}`);
  expect(after.lines.map((l) => l.picked)).toEqual([1, 2]);
  expect((await api(`/api/wms/orders/${other.id}`)).lines[0].picked).toBe(2);
  expect(after.hold_reason).toBe("Zmiana klienta");
  await expect(field("quantity")).toHaveValue("");
  await expect(field("tote")).toHaveValue("");
  const integrity = await api("/api/wms/integrity");
  expect(integrity.ok).toBe(true);
  writeFileSync(
    path.join(output, "picking-return-e2e.json"),
    JSON.stringify(
      { seededOnly: true, widths, returned: 1, otherBoxPicked: 2, integrity },
      null,
      2,
    ),
  );
}
