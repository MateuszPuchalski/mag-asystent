import { expect, test } from "@playwright/test";
import { licznikZapisow, otworzKolejke, zalogujDoBiura, zapisJako } from "./pomoc";
import { KONTO, TOKEN } from "./srodowisko";

/* ── Zwrot: decyzja i pieniądze ──────────────────────────────────────────────
   Droga, na której pomyłka kosztuje pieniądze wprost: zwrot płatności wychodzi
   do Allegro i nie da się go cofnąć następnym wydaniem. Testy idą tak daleko,
   jak sięga prawdziwy serwer na bazie z seeda. Reszta czeka przy `test.fixme`. */

const LISTA = "/api/obsluga/zwroty";
/* Numer zwrotu, którego w bazie nie ma. Bramka roli stoi przed odczytem
   sprawy, więc do jej sprawdzenia sprawa nie jest potrzebna. */
const NIEISTNIEJACY = 999_999;

test("kolejka zwrotów otwiera się z prawdziwego serwera i samym otwarciem nic nie zapisuje", async ({ page }) => {
  await zalogujDoBiura(page, KONTO.biuro.login);
  const zapisy = licznikZapisow(page);
  await otworzKolejke(page, "/obsluga/zwroty", LISTA);
  await expect(page.getByRole("heading", { name: "Zwroty" })).toBeVisible();
  /* Okno na zapis spóźniony, jak w skrzynce. */
  await page.waitForTimeout(1_000);
  expect(zapisy, "otwarcie kolejki zwrotów ma niczego nie mutować").toEqual([]);
});

test("pieniędzy nie odda ani nie odmówi konto spoza biura", async ({ request }) => {
  for (const trasa of ["pieniadze", "odmowa-platnosci"]) {
    const sciezka = `/api/obsluga/zwroty/${NIEISTNIEJACY}/${trasa}`;
    const cialo = { wersja: 1, kod: "REFUND_REJECTED", powod: "test bramki roli" };
    expect((await zapisJako(request, null, sciezka, cialo)).status(), `${trasa} bez sesji`).toBe(401);
    expect((await zapisJako(request, TOKEN.magazynier, sciezka, cialo)).status(), `${trasa} jako magazynier`).toBe(403);
  }
});

test("konto biura przechodzi bramkę roli i zatrzymuje się dopiero na samej sprawie", async ({ request }) => {
  /* Druga połowa testu wyżej. Sama odmowa dla magazyniera przeszłaby także
     wtedy, gdyby trasa odmawiała każdemu, a wtedy biuro nie oddałoby
     pieniędzy nikomu. Biuro ma dostać odpowiedź o SPRAWIE, nie o roli. */
  const odp = await zapisJako(request, TOKEN.biuro,
    `/api/obsluga/zwroty/${NIEISTNIEJACY}/pieniadze`, { wersja: 1 });
  expect([401, 403]).not.toContain(odp.status());
  expect(odp.ok(), "zwrot pieniędzy dla nieistniejącej sprawy nie może się udać").toBe(false);
});

/* CZEGO BRAKUJE, żeby te dwa testy dało się napisać uczciwie:

   1. Zwroty w seedzie. `npm run seed:scenariusze` nie zakłada ani jednego
      wiersza w `zwrot_klienta`, więc kolejka jest pusta. Potrzebne dwa zwroty
      z zamówieniem i pozycjami: jeden bez werdyktu w kubełku „Do decyzji”,
      drugi przyjęty, z policzoną kwotą, w kubełku „Do zwrotu”.
   2. Zwrot płatności w trybie `dev`. Trasa `…/pieniadze`
      (`server/src/routes/zwroty.ts`) woła `zwrocPlatnosc` z prawdziwego
      klienta HTTP Allegro w każdym trybie, więc skutku wypłaty nie da się
      zobaczyć bez żywego Allegro.

   Werdykt przyjęcia i odrzucenia zapisuje się wyłącznie u nas
   (`rozstrzygnijZwrot`), więc pierwszy test potrzebuje tylko punktu 1. */
test.fixme("zwrot z kolejki dostaje werdykt, a po odświeżeniu stoi w następnym kubełku", async () => {});

/* Ma sprawdzić, że przed wypłatą ekran pokazuje potwierdzenie z kwotą,
   że samo otwarcie potwierdzenia niczego nie wysyła, i dopiero po zgodzie
   wychodzi jedno żądanie. */
test.fixme("zwrot pieniędzy pyta o potwierdzenie z kwotą, zanim cokolwiek wyśle", async () => {});
