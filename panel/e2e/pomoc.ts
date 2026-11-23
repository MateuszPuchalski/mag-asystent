import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { HASLO, URL_API } from "./srodowisko";

/* Wejście FORMULARZEM, nie tokenem wsadzonym do przeglądarki. Logowanie jest
   pierwszym krokiem każdej drogi biura, a token wstawiony z boku ominąłby
   dokładnie ten krok, od którego agent zaczyna dzień. Kosztuje ułamek sekundy. */
export async function zaloguj(page: Page, login: string, haslo: string = HASLO) {
  await page.goto("/obsluga/");
  await page.getByLabel("Login").fill(login);
  await page.getByLabel("Hasło").fill(haslo);
  await page.getByRole("button", { name: "ZALOGUJ" }).click();
}

/* Formularz znika dopiero po odpowiedzi serwera, więc jego brak jest dowodem
   wejścia niezależnym od tego, jak pasek boczny wygląda w tym tygodniu. */
export async function zalogujDoBiura(page: Page, login: string) {
  await zaloguj(page, login);
  await expect(page.getByRole("form", { name: "Logowanie" })).toBeHidden();
}

/**
 * Zapisy wysłane do API od tej chwili: każde żądanie inne niż GET.
 *
 * Liczone na żądaniach PRZEGLĄDARKI do prawdziwego serwera. Strażnik
 * `src/ZeroZapisu.test.ts` pilnuje tego samego w jsdom, ale na atrapie
 * `fetch`: nie widzi zapisu, który ekran wysyła dopiero po prawdziwej
 * odpowiedzi serwera albo po zdarzeniu ze strumienia.
 */
export function licznikZapisow(page: Page): string[] {
  const zapisy: string[] = [];
  page.on("request", (z) => {
    const adres = new URL(z.url());
    if (adres.pathname.startsWith("/api/") && z.method() !== "GET") {
      zapisy.push(`${z.method()} ${adres.pathname}`);
    }
  });
  return zapisy;
}

/**
 * Otwiera kolejkę i czeka, aż serwer odda jej listę.
 *
 * Czeka na ODPOWIEDŹ, nie na napis: zdanie pustej kolejki i liczniki kubełków
 * zmienią się w dniu, w którym seed dostanie sprawy, a „lista przyszła
 * z serwera z kodem 200" zostaje prawdą przy każdej liczbie spraw.
 */
export async function otworzKolejke(page: Page, sciezka: string, lista: string) {
  const odpowiedz = page.waitForResponse((o) =>
    new URL(o.url()).pathname === lista && o.request().method() === "GET");
  await page.goto(sciezka);
  expect((await odpowiedz).status(), `lista ${lista} z prawdziwego serwera`).toBe(200);
}

/* Pytanie wprost do API, z pominięciem ekranu. Tylko do bramki roli: konto bez
   uprawnienia nie dostaje na ekranie przycisku, więc jedynym miejscem, gdzie
   da się sprawdzić samą odmowę serwera, jest żądanie złożone ręką. */
export function zapisJako(request: APIRequestContext, token: string | null, sciezka: string, cialo: unknown) {
  return request.post(`${URL_API}${sciezka}`, {
    headers: token ? { "x-session": token } : {},
    data: cialo,
  });
}
