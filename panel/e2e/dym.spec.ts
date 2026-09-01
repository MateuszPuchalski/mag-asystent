import { expect, test } from "@playwright/test";

test("niezalogowany trafia na logowanie, nie na pusty ekran", async ({ page }) => {
  await page.goto("/obsluga/");
  await expect(page.getByRole("heading", { name: "WERTIS" })).toBeVisible();
  await expect(page.getByLabel("Login")).toBeVisible();
});

test("głęboki adres rozmowy też prowadzi do logowania", async ({ page }) => {
  /* Router ma objąć `/obsluga/skrzynka/:id`. Gdy go nie obejmie, ekran
     zostaje pusty i nikt tego nie zauważa aż do wdrożenia. */
  await page.goto("/obsluga/skrzynka/4821");
  await expect(page.getByLabel("Hasło")).toBeVisible();
});
