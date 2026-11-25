import { expect, test } from "@playwright/test";
import { zaloguj, zalogujDoBiura } from "./pomoc";
import { KONTO } from "./srodowisko";

/* Wejście do biura przez prawdziwy formularz i prawdziwy serwer. Każda droga,
   na której pomyłka kosztuje pieniądze, zaczyna się tutaj: test odpowiedzi,
   zwrotu i werdyktu nie ma na czym stanąć, gdy logowanie nie wpuszcza. */

test("konto biura wchodzi formularzem i ma pod ręką trzy kolejki klienta", async ({ page }) => {
  await zalogujDoBiura(page, KONTO.biuro.login);
  /* Po nazwie odnośnika, nie po miejscu w pasku: kolejność i grupowanie
     zakładek zmieniają się, a to, że praca ma swoje wejścia, zostaje. */
  for (const kolejka of ["Skrzynka", "Zwroty", "Reklamacje"]) {
    await expect(page.getByRole("link", { name: kolejka, exact: true })).toBeVisible();
  }
});

test("błędne hasło nie wpuszcza i zostawia formularz ze zdaniem serwera", async ({ page }) => {
  const odpowiedz = page.waitForResponse((o) => new URL(o.url()).pathname === "/api/auth/login");
  await zaloguj(page, KONTO.biuro.login, "nie-to-haslo");
  const odmowa = await odpowiedz;
  expect(odmowa.status()).toBe(401);
  /* Zdanie bierzemy z odpowiedzi, nie z pamięci: test ma pilnować, że agent
     widzi to, co serwer powiedział, a nie konkretnego brzmienia. */
  const { error } = await odmowa.json() as { error: string };
  const formularz = page.getByRole("form", { name: "Logowanie" });
  await expect(formularz).toContainText(error);
  /* Sesja nie ma prawa powstać przy odmowie. Sam formularz na ekranie tego
     nie dowodzi: token zapisany mimo błędu wpuściłby po odświeżeniu strony. */
  await page.reload();
  await expect(page.getByLabel("Hasło")).toBeVisible();
});

test("magazynier dostaje zdanie o braku dostępu, także pod adresem zwrotów", async ({ page }) => {
  /* Zwrot pieniędzy i werdykt należą do biura. Magazynier z poprawnym hasłem
     nie może zobaczyć kolejki, z której się je wykonuje, również wtedy, gdy
     wpisze jej adres ręcznie. */
  await zaloguj(page, KONTO.magazynier.login);
  await expect(page.getByText("To konto nie ma dostępu do biura")).toBeVisible();
  await page.goto("/obsluga/zwroty");
  await expect(page.getByText("To konto nie ma dostępu do biura")).toBeVisible();
  await expect(page.getByRole("link", { name: "Zwroty", exact: true })).toHaveCount(0);
});
