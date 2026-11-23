import { expect, test, type Page } from "@playwright/test";
import {
  licznikZapisow, numerZAdresu, odczytJakoBiuro, otworzKolejke, zadaniaDoAllegro, zalogujDoBiura, zapisJako,
} from "./pomoc";
import { KONTO, SPRAWA, TOKEN } from "./srodowisko";

/* ── Zwrot: decyzja i pieniądze ──────────────────────────────────────────────
   Droga, na której pomyłka kosztuje pieniądze wprost: zwrot płatności wychodzi
   do Allegro i następne wydanie go nie cofnie. Idzie przez prawdziwy ekran
   i prawdziwy serwer, a wypłatę przyjmuje udawane Allegro na tej samej
   maszynie (`udawane-allegro.mjs`). */

const LISTA = "/api/obsluga/zwroty";
/* Numer zwrotu, którego w bazie nie ma. Bramka roli stoi przed odczytem
   sprawy, więc do jej sprawdzenia sprawa nie jest potrzebna. */
const NIEISTNIEJACY = 999_999;

interface SzczegolZwrotu {
  zwrot: { id: number; wersja: number; werdykt: string | null };
  pieniadze: { kwotaGrosze: number | null; moznaZwrocic: boolean; oddane: { id: string | null; potwierdzone: boolean } | null };
}

const kubelek = (page: Page, nazwa: string) =>
  page.getByRole("region", { name: "Kolejka zwrotów" }).getByRole("button", { name: new RegExp(`^${nazwa} \\d+$`) });
const wiersz = (page: Page, numer: string) =>
  page.getByRole("region", { name: "Kolejka zwrotów" }).getByRole("button", { name: new RegExp(numer) });

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

test("przyjęcie zwrotu zostaje po odświeżeniu strony i nie wychodzi do Allegro", async ({ page, request }) => {
  const { numer } = SPRAWA.zwrotDoDecyzji;
  await zalogujDoBiura(page, KONTO.biuro.login);
  await otworzKolejke(page, "/obsluga/zwroty", LISTA);
  await wiersz(page, numer).click();
  await expect(page.getByRole("heading", { name: numer })).toBeVisible();
  const id = numerZAdresu(page);

  await page.getByRole("button", { name: "P Przyjmij", exact: true }).click();
  await expect(page.getByText("Zwrot przyjęty")).toBeVisible();

  /* ── Skutek: po odświeżeniu strony werdykt stoi tam, gdzie go zapisano ───── */
  await page.reload();
  await expect(page.getByRole("heading", { name: numer })).toBeVisible();
  await expect(page.getByText("Zwrot przyjęty")).toBeVisible();
  await kubelek(page, "Do oceny").click();
  await expect(wiersz(page, numer), "zwrot czeka teraz na ocenę towaru").toBeVisible();
  await kubelek(page, "Do decyzji").click();
  await expect(wiersz(page, numer), "zwrot zszedł z „Do decyzji”").toHaveCount(0);

  const stan = await odczytJakoBiuro<SzczegolZwrotu>(request, `/api/obsluga/zwroty/${id}`);
  expect(stan.zwrot.werdykt).toBe("przyjety");
  /* Werdykt przyjęcia zapisuje się wyłącznie u nas. Żądanie do Allegro w tym
     miejscu znaczyłoby, że kliknięcie „Przyjmij” zaczęło ruszać cudzy system. */
  expect(await zadaniaDoAllegro(request, "POST", /customer-returns|payments/)).toEqual([]);
});

test("zwrot pieniędzy wychodzi do Allegro raz, z właściwą płatnością i liniami", async ({ page, request }) => {
  const { numer, platnosc, zamowienie } = SPRAWA.zwrotDoWyplaty;
  await zalogujDoBiura(page, KONTO.biuro.login);
  await otworzKolejke(page, "/obsluga/zwroty", LISTA);
  await kubelek(page, "Do zwrotu").click();
  await wiersz(page, numer).click();
  await expect(page.getByRole("heading", { name: numer })).toBeVisible();
  const id = numerZAdresu(page);
  const pieniadze = page.getByRole("region", { name: "Pieniądze" });

  /* ── Przed kliknięciem: kwota na ekranie, a u Allegro cisza ───────────────
     Ekran NIE pyta o potwierdzenie. Jedyną zaporą przed pomyłką jest kwota
     stojąca obok przycisku, więc test pilnuje, że ona tam jest i że zgadza
     się z tym, co serwer za chwilę wyśle. */
  await expect(pieniadze).toContainText("125,41 PLN");
  const przed = await odczytJakoBiuro<SzczegolZwrotu>(request, `/api/obsluga/zwroty/${id}`);
  expect(przed.pieniadze.kwotaGrosze).toBe(12_541);
  expect(przed.pieniadze.oddane).toBeNull();

  /* Magazynier na PRAWDZIWEJ sprawie z policzoną kwotą: bramka roli ma stać
     także wtedy, gdy jest co oddać. */
  expect((await zapisJako(request, TOKEN.magazynier, `/api/obsluga/zwroty/${id}/pieniadze`,
    { wersja: przed.zwrot.wersja })).status()).toBe(403);
  expect(await zadaniaDoAllegro(request, "POST", "/payments/refunds"), "przed kliknięciem nic nie wyszło").toEqual([]);

  const zapisy = licznikZapisow(page);
  await pieniadze.getByRole("button", { name: /Oddaj pieniądze/ }).click();
  await expect(pieniadze.getByText(/Zlecone|Oddano/)).toBeVisible();

  /* ── Skutek pierwszy: DOKŁADNIE JEDNO polecenie zwrotu u Allegro ──────────
     Kubełek tego nie dowodzi: zwrot schodzi z „Do zwrotu” także po wypłacie
     nieudanej. Dowodem jest żądanie po drugiej stronie. */
  const polecenia = await zadaniaDoAllegro(request, "POST", "/payments/refunds");
  expect(polecenia, "jedno polecenie, bez drugiej próby").toHaveLength(1);
  expect(polecenia[0].przyjete).toBe(true);
  const cialo = polecenia[0].cialo as {
    payment: { id: string }; order: { id: string }; commandId: string; reason: string;
    lineItems: Array<{ id: string; type: string; quantity?: number }>;
    delivery?: { value: { amount: string; currency: string } };
  };
  expect(cialo.payment).toEqual({ id: platnosc });
  expect(cialo.order).toEqual({ id: zamowienie });
  expect(cialo.reason).toBe("REFUND");
  expect(cialo.commandId, "numer polecenia chroni przed podwójną wypłatą").toBeTruthy();
  expect(cialo.lineItems.map((l) => [l.type, l.quantity]).sort(), "dwie linie: dwie sztuki i jedna")
    .toEqual([["QUANTITY", 1], ["QUANTITY", 2]]);
  expect(cialo.delivery?.value).toEqual({ amount: "12.99", currency: "PLN" });
  /* Przeglądarka nie podaje kwoty. Gdyby ją podawała, dałoby się oddać
     dowolną sumę żądaniem z pominięciem ekranu. */
  expect(zapisy).toEqual([`POST /api/obsluga/zwroty/${id}/pieniadze`]);

  /* ── Skutek drugi: serwer zapisał numer, który nadało Allegro ─────────────── */
  const numerZwrotuPlatnosci = String(polecenia[0].odpowiedz?.id);
  const po = await odczytJakoBiuro<SzczegolZwrotu>(request, `/api/obsluga/zwroty/${id}`);
  expect(po.pieniadze.oddane?.id).toBe(numerZwrotuPlatnosci);
  expect(po.pieniadze.moznaZwrocic, "drugiej wypłaty tej samej sprawy nie ma").toBe(false);

  /* ── Skutek trzeci: po odświeżeniu strony ekran mówi to samo ──────────────── */
  await page.reload();
  await expect(page.getByRole("heading", { name: numer })).toBeVisible();
  await expect(pieniadze).toContainText(numerZwrotuPlatnosci);
  /* „Zlecone”, nie „Oddano”: Allegro przyjęło polecenie, a wypłatę potwierdza
     dopiero status zwrotu płatności. Ekran ma tych dwóch rzeczy nie mylić. */
  await expect(pieniadze).toContainText("Zlecone");
  await expect(pieniadze.getByRole("button", { name: /Oddaj pieniądze/ })).toHaveCount(0);
});

/* POTWIERDZENIA PRZED WYPŁATĄ NIE MA, i test wyżej opisuje to wprost: jedno
   kliknięcie albo sam klawisz `Z` wysyła polecenie zwrotu płatności. To
   decyzja zapisana w `src/zwroty/Pieniadze.tsx` („odmowa ma potwierdzenie,
   zwrot nie”). Testu, który żądałby potwierdzenia, tu nie ma, bo żądałby
   funkcji, której nikt nie zamówił. */
