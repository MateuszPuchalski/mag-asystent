import { expect } from "@playwright/test";
import path from "node:path";

export async function exerciseInbound(page, output) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tab-wms="inbound"]').click();
  await page.getByText("Nowa dostawa", { exact: true }).click();
  const create = page.locator("#wms-inbound-create");
  await create.locator('[name="reference"]').fill("E2E-INBOUND-001");
  await create.locator('[name="supplier"]').fill("Dostawca seeded");
  await create.locator('[name="lines"]').fill("WMS-0030;3");
  await create.locator("button").click();
  const scan = page.locator('#wms-inbound-scan [name="barcode"]');
  await expect(scan).toBeFocused();
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  const form = page.locator("#wms-inbound-putaway");
  await expect(form.locator('[name="quantity"]')).toBeFocused();
  await expect(page.locator('[data-photo-id="30"] img')).toBeVisible();
  await form.locator('[name="quantity"]').fill("2");
  await form.locator('[name="quantity"]').press("Enter");
  await expect(form.locator('[name="bin"]')).toBeFocused();
  await form.locator('[name="bin"]').fill("TYPO-UNKNOWN");
  await form.locator('[name="bin"]').press("Enter");
  await expect(page.locator("#wms-message")).toContainText(
    "Nieznana lokalizacja",
  );
  await expect(form.locator('[name="quantity"]')).toHaveValue("2");
  await form.locator('[name="bin"]').fill("A04-01-02");
  await page.screenshot({
    path: path.join(output, "inbound-mobile.png"),
    fullPage: true,
  });
  expect(
    await form
      .locator("button.primary")
      .evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight),
  ).toBe(true);
  // Serwer zapisuje, lecz klient traci odpowiedź. Ponowienie nie przyjmuje drugiej partii.
  await page.route(
    "**/api/wms/inbound/*/putaway",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await form.locator('[name="bin"]').press("Enter");
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(scan).toBeFocused();
  await expect(page.locator("#wms-content")).toContainText(
    "1 szt. do rozliczenia",
  );
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  await expect(page.locator("#wms-inbound-task")).toContainText(
    "Odłożono 2 / 3",
  );
  await form.locator('[name="quantity"]').press("Enter");
  await form.locator('[name="bin"]').fill("A04-01-02");
  await form.locator('[name="bin"]').press("Enter");
  await page.getByText("Zakończenie dostawy", { exact: true }).click();
  await page.locator("#wms-inbound-close button").click();
  await expect(page.locator("#wms-content")).toContainText("Zamknięte");
  await page
    .getByText("Ponowne otwarcie — korekta lub kolejna partia", { exact: true })
    .click();
  await page
    .locator('#wms-inbound-reopen [name="reason"]')
    .fill("Sprawdzenie pomyłki ilości");
  await page.locator("#wms-inbound-reopen button").click();
  await page.getByText("Ostatnie odłożenia", { exact: true }).click();
  await page.locator("[data-inbound-reverse]").first().click();
  const reverse = page.locator("#wms-inbound-reverse");
  await reverse.locator('[name="barcode"]').fill("WMS-0030");
  await reverse.locator('[name="bin"]').fill("A04-01-02");
  await reverse
    .locator('[name="reason"]')
    .fill("Przeliczono jedną sztukę za dużo");
  await reverse.locator("button").click();
  await expect(page.locator("#wms-content")).toContainText(
    "1 szt. do rozliczenia",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
}
