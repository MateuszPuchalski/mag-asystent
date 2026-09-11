import { expect } from "@playwright/test";

// Próby na gotowym ekranie wykrywają kaskadę CSS, której test samych tokenów nie widzi.
export async function exerciseDesign(page) {
  await expect(
    page.getByRole("button", { name: "Wyloguj", exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of [
      "orders",
      "stock",
      "stockwork",
      "inbound",
      "carts",
      "packing",
      "waves",
      "bins",
      "analytics",
      "dispatch",
      "import",
    ]) {
      await page.locator(`[data-tab-wms="${tab}"]`).click();
      await expect(page.locator("#widokWms")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      const active = page.locator('.wms-tabs [aria-current="page"]');
      await expect(active).toHaveCount(1);
      await expect(page.locator(".wms-head h1")).toHaveText(
        await active.textContent(),
      );
      expect(
        await active.evaluate((e) => {
          const r = e.getBoundingClientRect(),
            p = e.parentElement.getBoundingClientRect();
          return r.left >= p.left && r.right <= p.right;
        }),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await page
          .locator("#widokWms button, #widokWms summary")
          .evaluateAll((nodes) =>
            nodes
              .filter((e) => {
                const r = e.getBoundingClientRect();
                return r.height > 0 && r.height < 48;
              })
              .map((e) => e.textContent),
          ),
      ).toEqual([]);
    }
  }
  // Kontrolowany wolny odczyt: informacja pozostaje poza blokowanym formularzem.
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/wms/orders?**",
    async (route) => {
      await hold;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    await page.locator('[data-tab-wms="orders"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#wms-busy")).toBeVisible();
    expect(
      await page.locator("#wms-busy").evaluate((e) => !e.closest("[inert]")),
    ).toBe(true);
    await expect(page.locator('[data-tab-wms="orders"]')).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator("#widokWms")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#wms-busy")).toBeHidden();
  await expect(page.locator('[data-tab-wms="orders"]')).toBeFocused();
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  expect(
    await page.locator("html").evaluate((e) => getComputedStyle(e).colorScheme),
  ).toBe("light");
  expect(
    await page
      .locator("#wyloguj")
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe("0s");
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
}
