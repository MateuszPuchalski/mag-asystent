import { expect } from "@playwright/test";
import path from "node:path";
export async function exerciseHandoff(page, output) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tab-wms="handoff"]').first().click();
  await page
    .locator('#wms-handoff-create [name="carrier"]')
    .selectOption("TEST");
  await page.locator("#wms-handoff-create button").click();
  const scan = page.locator('#wms-handoff-scan [name="tracking"]');
  await expect(scan).toBeFocused();
  await scan.fill("WRONG-CARRIER-LABEL");
  await scan.press("Enter");
  await expect(page.locator("#wms-message")).toContainText(
    "Brak jednoznacznej paczki",
  );
  await scan.fill("TRACK-E2E-0001");
  await scan.press("Enter");
  await expect(scan).toBeFocused();
  await expect(scan).toHaveValue("");
  await expect(page.locator("#wms-content tbody tr")).toHaveCount(1);
  await scan.fill("TRACK-E2E-0001");
  await scan.press("Enter");
  await expect(page.locator("#wms-message")).toContainText("już na liście");
  await expect(page.locator("#wms-content tbody tr")).toHaveCount(1);
  await page
    .getByText("Potwierdzenie odbioru przez kuriera", { exact: true })
    .click();
  await page.locator('#wms-handoff-close [name="confirmed"]').check();
  await page.screenshot({
    path: path.join(output, "handoff-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Odbiór zapisany przed utratą odpowiedzi pozostaje jedną operacją.
  await page.route(
    "**/api/wms/handoffs/*/close",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.locator("#wms-handoff-close button").click();
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-content")).toContainText(
    "Potwierdzony odbiór",
  );
  await expect(page.locator("#wms-handoff-scan")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.locator('[data-handoff="csv"]').click();
  await download;
  await page.setViewportSize({ width: 1440, height: 1000 });
}
