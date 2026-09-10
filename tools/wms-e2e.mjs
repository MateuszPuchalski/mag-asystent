import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(cwd, ".wms-artifacts");
mkdirSync(output, { recursive: true });
const port = process.env.WMS_TEST_PORT || "3012";
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), "wms-e2e-")), "demo.db"),
  WMS_DEMO_PASSWORD: randomUUID(),
  PORT: port,
  HOST: "127.0.0.1",
  SGT_MODE: "seeded",
  LOG_LEVEL: "silent",
  WERTIS_ENV_FILE: path.join(tmpdir(), "wms-test-no-env.local"),
};
execFileSync(
  process.execPath,
  ["--import", "tsx", "server/src/wms-demo-run.ts"],
  { cwd, env, stdio: "pipe" },
);
const api = spawn(
  process.execPath,
  process.argv.includes("--built")
    ? ["server/dist/index.js"]
    : ["--import", "tsx", "server/src/index.ts"],
  { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
let serverLog = "";
api.stdout.on("data", (d) => (serverLog += d));
api.stderr.on("data", (d) => (serverLog += d));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (api.exitCode !== null) throw new Error(serverLog);
    try {
      if ((await fetch(`${base}/biuro`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/biuro`);
  await page.locator("#poleLogin").fill("wms-demo");
  await page.locator("#poleHaslo").fill(env.WMS_DEMO_PASSWORD);
  await page.locator("#zaloguj").click();
  await page.locator('[data-widok="wms"]').click();
  await expect(page.locator("#wms-content")).toContainText(
    "Wybierz zamówienie",
  );
  await page.locator('[data-tab-wms="import"]').click();
  await page.locator('#wms-create [name="reference"]').fill("E2E-FULL-ORDER");
  await page.locator('#wms-create [name="dueAt"]').fill("2026-12-31T14:00");
  await page
    .locator('#wms-create [name="lines"]')
    .fill("WMS-0001;2\nWMS-0002;1");
  await page
    .getByRole("button", { name: "UTWÓRZ ZAMÓWIENIE", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ZAREZERWUJ TOWAR", exact: true })
    .click();
  await page.locator('#wms-step [name="tote"]').fill("E2E-BOX");
  await page
    .getByRole("button", { name: "ROZPOCZNIJ ZBIÓRKĘ", exact: true })
    .click();
  await page.locator('#wms-step [name="bin"]').fill("A01-01-02");
  await page.locator('#wms-step [name="bin"]').press("Enter");
  await expect(page.locator('#wms-step [name="barcode"]')).toBeFocused();
  await page.locator('#wms-step [name="barcode"]').fill("WRONG-SKU");
  await page
    .getByRole("button", { name: "POTWIERDŹ POBRANIE", exact: true })
    .click();
  await expect(page.locator("#wms-message")).toContainText("Inny towar");
  await page.locator('#wms-step [name="barcode"]').fill("WMS-0001");
  await page.locator('#wms-step [name="quantity"]').fill("2");
  // Serwer zatwierdza skan, ale odpowiedź ginie: UI musi odtworzyć wynik.
  await page.route(
    "**/api/wms/orders/*/actions",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "POTWIERDŹ POBRANIE", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "PONÓW POPRZEDNIĄ OPERACJĘ",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  // Wygaśnięcie sesji nie może zgubić klucza wcześniej zatwierdzonego skanu.
  await page.route(
    "**/api/wms/orders/*/actions",
    (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          "x-session": "expired-test-session",
        },
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "PONÓW POPRZEDNIĄ OPERACJĘ", exact: true })
    .click();
  await expect(page.locator("#poleLogin")).toBeVisible();
  await page.locator("#poleLogin").fill("wms-demo");
  await page.locator("#poleHaslo").fill(env.WMS_DEMO_PASSWORD);
  await page.locator("#zaloguj").click();
  await page.locator('[data-widok="wms"]').click();
  await page
    .getByRole("button", { name: "PONÓW POPRZEDNIĄ OPERACJĘ", exact: true })
    .click();
  await expect(page.locator("#wms-message")).toContainText(
    "Potwierdzono poprzednią operację",
  );
  await page.getByRole("button", { name: /E2E-FULL-ORDER/ }).click();
  await expect(page.locator(".wms-part")).toHaveText("WMS-0002");
  await page.locator('#wms-step [name="bin"]').fill("A01-01-02");
  await page.locator('#wms-step [name="barcode"]').fill("WMS-0002");
  await page
    .getByRole("button", { name: "POTWIERDŹ POBRANIE", exact: true })
    .click();
  await page.locator('#wms-step [name="tote"]').fill("E2E-BOX");
  await page
    .getByRole("button", { name: "ROZPOCZNIJ KONTROLĘ PACZKI", exact: true })
    .click();
  for (const [sku, qty] of [
    ["WMS-0001", "2"],
    ["WMS-0002", "1"],
  ]) {
    await page.locator('#wms-step [name="barcode"]').fill(sku);
    await page.locator('#wms-step [name="quantity"]').fill(qty);
    await page
      .getByRole("button", { name: "DODAJ DO PACZKI", exact: true })
      .click();
    await expect(page.locator("#wms-message")).toContainText("Zapisano");
  }
  await page.locator('#wms-step [name="carrier"]').fill("TEST");
  await page.locator('#wms-step [name="tracking"]').fill("TRACK-E2E-0001");
  await page.locator('#wms-step [name="weightG"]').fill("750");
  await page
    .getByRole("button", {
      name: "POTWIERDŹ PRZEKAZANIE DO WYSYŁKI",
      exact: true,
    })
    .click();
  await expect(page.locator("#wms-step")).toContainText("TRACK-E2E-0001");
  await page.screenshot({
    path: path.join(output, "fulfillment-desktop.png"),
    fullPage: true,
  });
  await page.locator('[data-tab-wms="stock"]').click();
  await page.locator('#wms-filter [name="q"]').fill("WMS-0040");
  await page.locator("#wms-filter button").click();
  await expect(
    page.getByRole("button", { name: "Zmień", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Zmień", exact: true }).click();
  await page.locator('#wms-stock-edit [name="quantity"]').fill("5");
  await page.locator('#wms-stock-edit [name="reason"]').fill("PZ E2E 5 sztuk");
  await page.getByRole("button", { name: "ZAPISZ RUCH", exact: true }).click();
  await expect(page.locator("#wms-content")).toContainText("105");
  await page
    .getByRole("button", { name: "Historia", exact: true })
    .first()
    .click();
  await expect(page.locator("#wms-stock-form")).toContainText(
    "historia ruchów",
  );
  await expect(page.locator("#wms-stock-form")).toContainText("Przyjęcie");
  await page.locator('[data-tab-wms="bins"]').click();
  await page
    .getByRole("button", { name: "DODAJ LOKALIZACJĘ", exact: true })
    .click();
  await page.locator('#wms-bin-edit [name="bin"]').fill("KONTROLA-01");
  await page.locator('#wms-bin-edit [name="mode"]').selectOption("quarantine");
  await page
    .locator('#wms-bin-edit [name="reason"]')
    .fill("Kontrola jakości dostawy");
  await page
    .getByRole("button", { name: "ZAPISZ LOKALIZACJĘ", exact: true })
    .click();
  await expect(page.locator("#wms-message")).toContainText(
    "Zapisano przeznaczenie",
  );
  await expect(page.locator("#wms-content")).toContainText("KONTROLA-01");
  await page.locator('[data-tab-wms="import"]').click();
  await page
    .getByText("Import wielu zamówień z pliku", { exact: true })
    .click();
  await page.locator("#wms-import-json").fill(
    JSON.stringify({
      orders: [1, 2].map((n) => ({
        reference: `BATCH-E2E-${n}`,
        dueAt: "2026-12-31T12:00:00Z",
        lines: [{ sku: "WMS-0039", quantity: 1 }],
      })),
    }),
  );
  await page
    .getByRole("button", { name: "PODGLĄD IMPORTU", exact: true })
    .click();
  await expect(page.locator("#wms-import-result")).toContainText("2 zamówień");
  await page
    .getByRole("button", { name: "IMPORTUJ ZAMÓWIENIA", exact: true })
    .click();
  await expect(page.locator("#wms-message")).toContainText("Dodano 2");
  await page
    .getByRole("button", { name: "ZAREZERWUJ NOWE Z TEJ STRONY", exact: true })
    .click();
  await expect(page.locator("#wms-message")).toContainText("Zarezerwowano");
  await page.locator('#wms-filter [name="status"]').selectOption("allocated");
  await page.locator('#wms-filter [name="q"]').fill("BATCH-E2E-1");
  await page.locator('#wms-filter button[type="submit"]').click();
  await page.getByRole("button", { name: /BATCH-E2E-1/ }).click();
  await page.locator('#wms-step [name="tote"]').fill("BATCH-BOX");
  await page
    .getByRole("button", { name: "ROZPOCZNIJ ZBIÓRKĘ", exact: true })
    .click();
  await expect(page.locator(".wms-part")).toContainText("WMS-0039");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, "picking-mobile.png"),
    fullPage: true,
  });
  const scanTargets = await page
    .locator("#wms-step input:not([type=hidden]), #wms-step button")
    .evaluateAll((elements) =>
      elements.map((e) => ({
        height: e.getBoundingClientRect().height,
        width: e.getBoundingClientRect().width,
      })),
    );
  if (scanTargets.some((e) => e.height < 48 || e.width < 48))
    throw new Error("Scanner controls smaller than 48px");
  const scanButton = await page
    .getByRole("button", { name: "POTWIERDŹ POBRANIE", exact: true })
    .boundingBox();
  if (!scanButton || scanButton.y + scanButton.height > 844)
    throw new Error("Mobile picking requires scrolling to confirm");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-tab-wms="waves"]').click();
  await page
    .getByRole("button", { name: "PRZYGOTUJ WÓZEK", exact: true })
    .click();
  await page.locator('#wms-wave-create [name="name"]').fill("Wózek E2E");
  const cartInputs = page.locator('#wms-wave-create input[name^="tote-"]');
  if ((await cartInputs.count()) < 2)
    throw new Error("Brak dwóch zamówień do próby wózka");
  await cartInputs.nth(0).fill("CART-E2E-1");
  await cartInputs.nth(1).fill("CART-E2E-2");
  await page
    .getByRole("button", { name: "ROZPOCZNIJ TRASĘ", exact: true })
    .click();
  await expect(page.locator("#wms-wave-pick")).toBeVisible();
  let cartScans = 0;
  while (await page.locator("#wms-wave-pick").count()) {
    const task = await page.evaluate(
      () => document.getElementById("widokWms")._waveTask,
    );
    await page.locator('#wms-wave-pick [name="bin"]').fill(task.bin);
    await page.locator('#wms-wave-pick [name="bin"]').press("Enter");
    await expect(page.locator('#wms-wave-pick [name="barcode"]')).toBeFocused();
    await page.locator('#wms-wave-pick [name="barcode"]').fill(task.sku);
    await page.locator('#wms-wave-pick [name="barcode"]').press("Enter");
    await expect(page.locator('#wms-wave-pick [name="tote"]')).toBeFocused();
    await page
      .locator('#wms-wave-pick [name="quantity"]')
      .fill(String(task.remaining));
    if (cartScans === 0) {
      await page.locator('#wms-wave-pick [name="tote"]').fill("WRONG-CART");
      await page
        .getByRole("button", { name: "ODŁOŻONO DO POJEMNIKA", exact: true })
        .click();
      await expect(page.locator("#wms-message")).toContainText("pojemnik");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(output, "cart-mobile.png"),
        fullPage: true,
      });
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        )
      )
        throw new Error("Cart overflows mobile viewport");
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.locator('#wms-wave-pick [name="tote"]').fill(task.tote);
    await page
      .getByRole("button", { name: "ODŁOŻONO DO POJEMNIKA", exact: true })
      .click();
    await expect(page.locator("#wms-message")).toContainText(
      "Potwierdzono odłożenie",
    );
    await expect
      .poll(() =>
        page.evaluate((previous) => {
          const next = document.getElementById("widokWms")._waveTask;
          return (
            !next ||
            next.allocation_id !== previous.allocation_id ||
            next.version !== previous.version
          );
        }, task),
      )
      .toBe(true);
    if (++cartScans > 50) throw new Error("Wózek nie kończy zbiórki");
  }
  await expect(page.locator("#wms-work")).toContainText("Trasa zebrana");
  await page.locator('[data-tab-wms="analytics"]').click();
  await page
    .getByRole("button", { name: "SPRAWDŹ ZGODNOŚĆ STANÓW", exact: true })
    .click();
  await expect(page.locator("#wms-message")).toContainText("są zgodne");
  await page.screenshot({
    path: path.join(output, "analytics-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "analytics-mobile.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (overflow) throw new Error("Mobile viewport overflows horizontally");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  writeFileSync(
    path.join(output, "e2e-result.json"),
    JSON.stringify(
      {
        passed: true,
        scenarios: [
          "login",
          "create",
          "allocate",
          "pick",
          "wrong scan",
          "lost response and reload",
          "expired session preserves pending scan",
          "pack",
          "ship",
          "receive",
          "stock movement history",
          "quarantine location",
          "batch import",
          "bulk allocation",
          "mobile scan targets",
          "cart route with tote verification",
          "analytics",
          "ledger integrity",
          "390px viewport",
        ],
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(`WMS E2E passed. Evidence: ${output}`);
} catch (e) {
  writeFileSync(path.join(output, "server.log"), serverLog);
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page
          .screenshot({
            path: path.join(output, "failure.png"),
            fullPage: true,
          })
          .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  api.kill();
}
