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
  await expect(form.locator('[name="quantity"]')).toHaveValue("");
  await form.locator('[name="quantity"]').press("Enter");
  await expect(form.locator('[name="quantity"]')).toBeFocused();
  await expect(page.locator('[data-photo-id="30"] img')).toBeVisible();
  await expect(page.locator("#wms-inbound-task")).toContainText(
    "sprawdź miejsce",
  );
  await form.locator('[name="quantity"]').fill("1");
  await form.locator('[name="bin"]').fill("LOC:A04-01-02");
  await form.locator('[name="disposition"]').selectOption("damaged");
  await expect(form.locator('[name="quantity"]')).toHaveValue("");
  await expect(form.locator('[name="bin"]')).toHaveValue("");
  await form.locator('[name="disposition"]').selectOption("good");
  await form.locator("details summary").click();
  await form.locator('[name="quantity"]').fill("2");
  await form.locator('[name="quantity"]').press("Enter");
  await expect(form.locator('[name="bin"]')).toBeFocused();
  await form.locator('[name="bin"]').fill("TYPO-UNKNOWN");
  await form.locator('[name="bin"]').press("Enter");
  await expect(page.locator("#wms-message")).toContainText(
    "Nieznana lokalizacja",
  );
  await expect(form.locator('[name="quantity"]')).toHaveValue("2");
  await form.locator('[name="bin"]').fill("LOC:A04-01-02");
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
    "Policzono 2 / 3",
  );
  await expect(form.locator('[name="quantity"]')).toHaveValue("");
  await form.locator('[name="quantity"]').fill("1");
  await form.locator('[name="quantity"]').press("Enter");
  await form.locator('[name="bin"]').fill("LOC:A04-01-02");
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
  await reverse.locator('[name="bin"]').fill("LOC:A04-01-02");
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

  await page.locator('[data-inbound="list"]').click();
  await page.getByText("Nowa dostawa", { exact: true }).click();
  await create.locator('[name="reference"]').fill("E2E-BUFFER-001");
  await create.locator('[name="supplier"]').fill("Dostawca seeded");
  await create.locator('[name="lines"]').fill("WMS-0030;5");
  await create.locator("button").click();
  await page.locator("#wms-receiving-mode").selectOption("buffer");
  await scan.fill("WMS-0030");
  await scan.press("Enter");
  await form.locator('[name="quantity"]').fill("5");
  await form.locator('[name="quantity"]').press("Enter");
  await form.locator('[name="bin"]').fill("LOC:RES-E2E");
  await form.locator('[name="bin"]').press("Enter");
  await expect(page.locator("#wms-content")).toContainText("5 szt. w buforze");
  await page.evaluate(async () => {
    const response = await fetch("/api/wms/inventory?q=WMS-0030", {
      headers: { "x-session": token },
    });
    if (!response.ok) throw new Error("Nie odczytano półki seeded");
    const shelf = (await response.json()).rows.find(
      (row) => row.bin === "A04-01-02",
    );
    const result = await fetch("/api/wms/inventory", {
      method: "POST",
      headers: {
        "x-session": token,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        action: "limits",
        twId: 30,
        bin: shelf.bin,
        capacity: shelf.on_hand + 5,
        minimum: 0,
        version: shelf.version,
        reason: "Miejsce na pięć sztuk seeded",
      }),
    });
    if (!result.ok) throw new Error(await result.text());
  });
  await page.locator('[data-inbound="putaway"]').click();
  await page.locator("[data-putaway-open]").first().click();
  await page.locator("#wms-putaway-claim button").click();
  const putaway = page.locator("#wms-putaway-finish");
  await expect(putaway.locator('[name="quantity"]')).toHaveValue("");
  await expect(page.locator("#wms-content")).toContainText(
    "A04-01-02 (do 5 szt.)",
  );
  await expect(putaway.locator('[name="source"]')).toBeFocused();
  await putaway.locator("details summary").click();
  await putaway.locator('[name="quantity"]').fill("1");
  await putaway.locator('[name="target"]').fill("LOC:A04-01-02");
  await putaway.locator('[name="disposition"]').selectOption("damaged");
  await expect(putaway.locator('[name="quantity"]')).toHaveValue("");
  await expect(putaway.locator('[name="target"]')).toHaveValue("");
  await putaway.locator('[name="disposition"]').selectOption("good");
  await putaway.locator("details summary").click();
  await putaway.locator('[name="source"]').fill("LOC:RES-E2E");
  await putaway.locator('[name="source"]').press("Enter");
  await expect(putaway.locator('[name="barcode"]')).toBeFocused();
  await putaway.locator('[name="barcode"]').fill("WMS-0030");
  await putaway.locator('[name="barcode"]').press("Enter");
  for (const invalid of ["", "0", "1.5", "6"]) {
    await putaway.locator('[name="quantity"]').fill(invalid);
    await putaway.locator('[name="quantity"]').press("Enter");
    await expect(putaway.locator('[name="quantity"]')).toBeFocused();
  }
  await putaway.locator('[name="quantity"]').fill("2");
  await putaway.locator('[name="quantity"]').press("Enter");
  await expect(putaway.locator('[name="target"]')).toBeFocused();
  await putaway.locator('[name="target"]').fill("LOC:A04-01-02");
  await page.route(
    "**/api/wms/putaway-work/*/finish",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await putaway.locator('[name="target"]').press("Enter");
  await expect(page.locator("#wms-retry")).toContainText("PONÓW");
  await page.locator('[data-do-wms="retry"]').click();
  await expect(page.locator("#wms-content")).toContainText(
    "3 szt. do odłożenia",
  );
  await expect(page.locator("#wms-content")).toContainText(
    "A04-01-02 (do 3 szt.)",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await putaway
      .locator("button.primary")
      .evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight),
  ).toBe(true);
  await page.screenshot({
    path: path.join(output, "putaway-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByText("Brakuje policzonych sztuk — korekta", { exact: true })
    .click();
  const correction = page.locator("#wms-putaway-correct");
  await expect(correction.locator('[name="quantity"]')).toHaveValue("");
  await correction.locator('[name="source"]').fill("LOC:RES-E2E");
  await correction.locator('[name="barcode"]').fill("WMS-0030");
  await correction.locator('[name="quantity"]').fill("1");
  await correction
    .locator('[name="reason"]')
    .fill("Jedna sztuka policzona podwójnie");
  await correction.locator("button").click();
  await expect(page.locator("#wms-content")).toContainText(
    "2 szt. do odłożenia",
  );
  await putaway.locator('[name="source"]').fill("LOC:RES-E2E");
  await putaway.locator('[name="barcode"]').fill("WMS-0030");
  await expect(putaway.locator('[name="quantity"]')).toHaveValue("");
  await putaway.locator('[name="quantity"]').fill("2");
  await putaway.locator('[name="target"]').fill("LOC:A04-01-02");
  await putaway.locator('[name="target"]').press("Enter");
  await expect(page.locator("#wms-content")).toContainText(
    "Brak zadań do odłożenia.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
}
