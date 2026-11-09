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

/* ── Rama okna trzyma wysokość ───────────────────────────────────────────────
   Panel ma się mieścić na jednej stronie, bez przewijania dokumentu. Rama
   nie używa żadnej jednostki okna: `position: fixed; inset: 0`.

   Ten test stoi TUTAJ, a nie w Vitest, i to jest jedyne miejsce, gdzie ma
   sens: jsdom nie liczy układu, a niezmiennik brzmi „dokument się nie
   przewija" — czyli jest o pikselach, nie o klasach. Cena: `e2e/` nie biegnie
   w CI, więc to strażnik na żądanie, nie bramka. Niezmiennik „rama równa się
   kadrowi" da się sprawdzić w każdej przeglądarce.

   Token wstawiamy do `localStorage` PRZED wczytaniem, bo ekran logowania nie
   renderuje ramy wcale — `App` zwraca go wcześniejszym `return`. Test na
   logowaniu przechodziłby zawsze, a strażnik, który nie umie upaść, kłamie
   zielenią. Serwera API tu nie ma i nie musi być:
   ekrany pokażą błąd wczytywania, ale rama jest nad nimi i to ona jest
   mierzona — usterka nigdy nie zależała od treści kolumn.                   */
test("okno nie przewija się w poziomie ani w pionie", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/obsluga/");
  await page.evaluate(() => localStorage.setItem("wertis-panel-token", "rama-test"));
  await page.reload();
  await expect(page.locator(".rama-okna")).toBeVisible();

  /* WYSOKĄ TREŚĆ WSTAWIAMY SAMI. Druga wersja tego testu mierzyła panel bez
     serwera API, czyli ekrany puste — okno nie miało czym się rozepchnąć
     i test przechodził nawet z wykasowanym zapasem w CSS. Niezmiennik brzmi
     „rama przycina, cokolwiek w niej stoi", więc trzeba dać jej co przyciąć. */
  const m = await page.evaluate(() => {
    const slup = document.createElement("div");
    slup.style.height = "5000px";
    document.querySelector("main")!.appendChild(slup);
    const d = document.documentElement;
    return { pion: d.scrollHeight - d.clientHeight, poziom: d.scrollWidth - d.clientWidth };
  });
  expect(m.pion).toBe(0);
  expect(m.poziom).toBe(0);
});
