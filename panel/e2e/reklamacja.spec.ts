import { expect, test, type Page } from "@playwright/test";
import {
  licznikZapisow, numerZAdresu, odczytJakoBiuro, otworzKolejke, zadaniaDoAllegro, zalogujDoBiura, zapisJako,
} from "./pomoc";
import { KONTO, SPRAWA, TOKEN } from "./srodowisko";

/* ── Werdykt reklamacji ──────────────────────────────────────────────────────
   Pierwszy zapis tej aplikacji nieodwracalny wobec kupującego: uznanie albo
   odrzucenie idzie do Allegro i drugiego werdyktu w tej samej sprawie nie ma.
   Idzie przez prawdziwy ekran i prawdziwy serwer, a werdykt przyjmuje udawane
   Allegro na tej samej maszynie (`udawane-allegro.mjs`).

   Testy stoją na ODRZUCENIU. Uznanie wymaga na ekranie stanowiska o towarze,
   a to jest druga wiadomość do Allegro, w czacie sprawy. Udawany serwer czatu
   nie prowadzi, bo musiałby zgadywać, jak wiadomość przestawia sprawę
   w kolejce. Uznanie zostaje więc bez testu przeglądarkowego. */

const LISTA = "/api/obsluga/reklamacje";
const NIEISTNIEJACA = 999_999;
const { numer, login, sprawa } = SPRAWA.reklamacja;
const SPRAWA_ALLEGRO = `/sale/issues/${sprawa}`;

interface SzczegolReklamacji {
  reklamacja: {
    id: number; numer: string; kupujacyLogin: string; orderId: string | null; opis: string | null;
    oczekiwanie: string | null; statusAllegro: string | null; decyzjaDo: string | null;
    wiadomosciIle: number; werdykt: string | null; werdyktStatus: string | null; wersja: number; kubelek: string;
  };
}

async function wejdzWSprawe(page: Page) {
  await otworzKolejke(page, "/obsluga/reklamacje", LISTA);
  await page.getByRole("region", { name: "Kolejka reklamacji" }).getByRole("button", { name: new RegExp(numer) }).click();
  await expect(page.getByRole("region", { name: `Reklamacja ${numer}` })).toBeVisible();
}

test("kolejka reklamacji otwiera się z prawdziwego serwera i samym otwarciem nic nie zapisuje", async ({ page }) => {
  await zalogujDoBiura(page, KONTO.biuro.login);
  const zapisy = licznikZapisow(page);
  await otworzKolejke(page, "/obsluga/reklamacje", LISTA);
  await expect(page.getByRole("heading", { name: "Reklamacje" })).toBeVisible();
  /* Wyjątek od zera zapisu dotyczy WEJŚCIA W SPRAWĘ: jedno odświeżenie
     z Allegro. Sam ekran kolejki nie ma go prawa wysłać. */
  await page.waitForTimeout(1_000);
  expect(zapisy, "otwarcie kolejki reklamacji ma niczego nie mutować").toEqual([]);
});

test("werdyktu nie wyda konto spoza biura ani żądanie bez sesji", async ({ request }) => {
  const sciezka = `/api/obsluga/reklamacje/${NIEISTNIEJACA}/werdykt`;
  const cialo = { werdykt: "REJECTED_OTHER", wiadomosc: "test bramki roli", wersja: 1 };
  expect((await zapisJako(request, null, sciezka, cialo)).status()).toBe(401);
  expect((await zapisJako(request, TOKEN.magazynier, sciezka, cialo)).status()).toBe(403);
});

test("wejście w sprawę odświeża ją z Allegro jednym żądaniem i niczego w niej nie gubi", async ({ page, request }) => {
  await zalogujDoBiura(page, KONTO.biuro.login);
  const przyjetePrzed = (await zadaniaDoAllegro(request, "GET", SPRAWA_ALLEGRO)).filter((w) => w.przyjete).length;
  const zapisy = licznikZapisow(page);
  await wejdzWSprawe(page);
  const id = numerZAdresu(page);
  const obszar = page.getByRole("region", { name: `Reklamacja ${numer}` });
  /* Przyciski decyzji pojawiają się po wczytaniu sprawy, a ta wczytuje się
     po odświeżeniu z Allegro. Ich obecność znaczy, że odświeżenie już wróciło. */
  await expect(page.getByRole("button", { name: "Odrzuć reklamację…" })).toBeVisible();
  await page.waitForTimeout(1_000);

  /* Jedyny zapis przy patrzeniu w całym panelu, decyzją właściciela: jedno
     odświeżenie sprawy. Dwa znaczyłyby dwa żądania do Allegro na każde
     kliknięcie w kolejce. */
  expect(zapisy).toEqual([`POST /api/obsluga/reklamacje/${id}/odswiez`]);
  /* Liczone są żądania PRZYJĘTE. Pierwsza próba idzie w `public.v1`, dostaje
     406 i dopiero druga, w `beta.v1`, przynosi sprawę. Obie są w dzienniku. */
  const pobrania = await zadaniaDoAllegro(request, "GET", SPRAWA_ALLEGRO);
  expect(pobrania.filter((w) => w.przyjete).length - przyjetePrzed, "jedno przyjęte pobranie sprawy").toBe(1);
  expect(pobrania.filter((w) => w.przyjete).every((w) => w.accept.includes("beta.v1")),
    "sprawy posprzedażowe żyją wyłącznie w beta.v1").toBe(true);

  /* ── Odświeżenie NADPISUJE wiersz sprawy odpowiedzią Allegro ──────────────
     Pole, którego odpowiedź nie niesie, wraca jako puste. Sprawa ma więc po
     wejściu nieść to samo, co zasiał seed. */
  const stan = (await odczytJakoBiuro<SzczegolReklamacji>(request, `/api/obsluga/reklamacje/${id}`)).reklamacja;
  expect(stan).toMatchObject({ numer, kupujacyLogin: login, oczekiwanie: "REFUND", wiadomosciIle: 1, werdykt: null });
  expect(stan.orderId).toBeTruthy();
  expect(stan.opis).toBeTruthy();
  expect(stan.decyzjaDo, "termin decyzji przeżył odświeżenie").toBeTruthy();
  await expect(obszar).toContainText("Czeka na decyzję");
  await expect(obszar.getByRole("list", { name: "Wiadomości" })).toContainText(stan.opis ?? "");
});

test("werdykt reklamacji dochodzi do Allegro raz, zostaje po odświeżeniu, a drugiego wydać się nie da", async ({ page, request }) => {
  const wiadomosc = "Towar jest zgodny z umową, reklamacji nie uznajemy.";
  await zalogujDoBiura(page, KONTO.biuro.login);
  await wejdzWSprawe(page);
  const id = numerZAdresu(page);
  await expect(page.getByRole("button", { name: "Odrzuć reklamację…" })).toBeVisible();
  const przed = (await odczytJakoBiuro<SzczegolReklamacji>(request, `/api/obsluga/reklamacje/${id}`)).reklamacja;

  /* Magazynier na PRAWDZIWEJ sprawie czekającej na decyzję. */
  expect((await zapisJako(request, TOKEN.magazynier, `/api/obsluga/reklamacje/${id}/werdykt`,
    { werdykt: "REJECTED_OTHER", wiadomosc, wersja: przed.wersja })).status()).toBe(403);

  await page.getByRole("button", { name: "Odrzuć reklamację…" }).click();
  const formularz = page.getByRole("form", { name: "Werdykt" });
  await formularz.getByRole("radio", { name: "Towar zgodny z umową" }).check();
  await formularz.getByRole("textbox", { name: /Wiadomość do klienta/ }).fill(wiadomosc);
  const wyslij = formularz.getByRole("button", { name: /wyślij do Allegro/i });
  /* ZGODA PRZED PRZYCISKIEM. Werdyktu nie da się cofnąć, więc gotowy formularz
     ma jeszcze nie dać się wysłać, dopóki agent nie potwierdzi nazwy werdyktu. */
  await expect(wyslij).toBeDisabled();
  await formularz.getByRole("checkbox", { name: /Odrzucona — towar zgodny z umową/ }).check();
  expect(await zadaniaDoAllegro(request, "POST", `${SPRAWA_ALLEGRO}/status`), "przed kliknięciem nic nie wyszło").toEqual([]);

  const odpowiedz = page.waitForResponse((o) => new URL(o.url()).pathname === `/api/obsluga/reklamacje/${id}/werdykt`);
  await wyslij.click();
  /* Trasa oddaje 200 TAKŻE przy porażce wysyłki, z `status: "send_failed"`.
     Sam kod odpowiedzi niczego więc nie dowodzi. */
  const wynik = await (await odpowiedz).json() as { status: string; werdykt: string };
  expect(wynik).toMatchObject({ status: "sent", werdykt: "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT" });

  /* ── Skutek pierwszy: DOKŁADNIE JEDEN werdykt u Allegro ───────────────────── */
  const werdykty = await zadaniaDoAllegro(request, "POST", `${SPRAWA_ALLEGRO}/status`);
  expect(werdykty, "jedno żądanie, bez drugiej próby i bez odrzuconej").toHaveLength(1);
  expect(werdykty[0].przyjete).toBe(true);
  expect(werdykty[0].cialo).toEqual({ status: "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT", message: wiadomosc });
  expect(werdykty[0].contentType, "ciało niesie wersję zasobu").toBe(werdykty[0].accept);

  /* ── Skutek drugi: po odświeżeniu strony werdykt stoi w sprawie ──────────── */
  await page.reload();
  const decyzja = page.getByRole("region", { name: "Decyzja" });
  await expect(decyzja).toContainText("Allegro przyjęło werdykt");
  await expect(decyzja).toContainText("Odrzucona — towar zgodny z umową");
  await expect(decyzja).toContainText(wiadomosc);
  await expect(page.getByRole("button", { name: /reklamację…/ }), "przycisków decyzji już nie ma").toHaveCount(0);

  /* „DO ODPOWIEDZI”, NIE „ROZSTRZYGNIĘTE”. Werdykt nie jest wiadomością czatu,
     a ostatnie słowo w czacie należy dalej do kupującego. Kolejka pokazuje
     więc sprawę jako czekającą na naszą odpowiedź i tak ma zostać, dopóki
     ktoś tego świadomie nie zmieni. */
  const po = (await odczytJakoBiuro<SzczegolReklamacji>(request, `/api/obsluga/reklamacje/${id}`)).reklamacja;
  expect(po).toMatchObject({ werdyktStatus: "sent", statusAllegro: "CLAIM_REJECTED", kubelek: "odpowiedz" });
  const kolejka = page.getByRole("region", { name: "Kolejka reklamacji" });
  await kolejka.getByRole("button", { name: /^Do odpowiedzi \d+$/ }).click();
  await expect(kolejka.getByRole("button", { name: new RegExp(numer) })).toContainText("Odrzucona — towar zgodny z umową");

  /* ── Drugi werdykt: odmowa przed jakimkolwiek żądaniem do Allegro ─────────
     Raz z wersją sprawy sprzed werdyktu, czyli z ekranu, który go nie widział,
     i raz z bieżącą. Obie drogi mają skończyć się odmową naszego serwera. */
  for (const wersja of [przed.wersja, po.wersja]) {
    const drugi = await zapisJako(request, TOKEN.biuro, `/api/obsluga/reklamacje/${id}/werdykt`,
      { werdykt: "ACCEPTED_REFUND", wiadomosc: "Jednak uznajemy.", wersja });
    expect(drugi.status(), `drugi werdykt z wersją ${wersja}`).toBe(409);
  }
  /* WSZYSTKIE żądania, nie tylko przyjęte: udawane Allegro przyjęłoby drugi
     werdykt, więc dowodem jest to, że żaden do niego nie doszedł. */
  expect(await zadaniaDoAllegro(request, "POST", `${SPRAWA_ALLEGRO}/status`)).toHaveLength(1);
});
