import { expect, test } from "@playwright/test";
import { licznikZapisow, otworzKolejke, zalogujDoBiura, zapisJako } from "./pomoc";
import { KONTO, TOKEN } from "./srodowisko";

/* ── Odpowiedź do klienta ze skrzynki ────────────────────────────────────────
   Droga, na której pomyłka trafia do klienta. Te testy idą tak daleko, jak
   sięga prawdziwy serwer na bazie z seeda, i ani kroku dalej. Niczego nie
   podstawiają w przeglądarce: zielony test z atrapą wysyłki mówiłby
   o atrapie, a wydanie trafia do magazynu samo.

   Dalsze kroki czekają na dwie rzeczy po stronie serwera. Obie stoją przy
   `test.fixme` niżej, żeby brak był widać w wyniku przebiegu, a nie
   w pamięci tego, kto pisał plik. */

const LISTA = "/api/obsluga/rozmowy";

test("skrzynka otwiera się z prawdziwego serwera i samym otwarciem nic nie zapisuje", async ({ page }) => {
  await zalogujDoBiura(page, KONTO.biuro.login);
  const zapisy = licznikZapisow(page);
  await otworzKolejke(page, "/obsluga/skrzynka", LISTA);
  await expect(page.getByRole("heading", { name: "Rozmowy" })).toBeVisible();
  /* Okno na zapis spóźniony: ekran, który pisze dopiero po odpowiedzi serwera
     albo po pierwszym zdarzeniu ze strumienia, zrobiłby to w tej sekundzie.
     Krótszego dowodu na „nic nie wyszło" nie ma. */
  await page.waitForTimeout(1_000);
  expect(zapisy, "otwarcie skrzynki ma niczego nie mutować").toEqual([]);
});

test("wysyłki odpowiedzi nie wykona konto spoza biura ani żądanie bez sesji", async ({ request }) => {
  const cialo = { body: "Dzień dobry", expectedVersion: 1, expectedLastMessageId: null };
  /* 401 i 403 to dwie różne odmowy: pierwsza znaczy „nie wiem, kto pyta",
     druga „wiem i nie wolno". Zlanie ich w jedną ukryłoby bramkę roli, która
     przestała działać, za bramką sesji, która działa. */
  expect((await zapisJako(request, null, "/api/conversations/1/send", cialo)).status()).toBe(401);
  expect((await zapisJako(request, TOKEN.magazynier, "/api/conversations/1/send", cialo)).status()).toBe(403);
});

/* CZEGO BRAKUJE, żeby ten test dało się napisać uczciwie:

   1. Rozmowy w seedzie. `npm run seed:scenariusze` nie zakłada ani jednego
      wiersza w `conversation` i `message`, więc kolejka jest pusta i nie ma
      czego otworzyć. Potrzebna rozmowa nieprzypisana, z ostatnią wiadomością
      od klienta.
   2. Wysyłka w trybie `dev`. `wyslijOdpowiedz` (`server/src/services/wysylka.ts`)
      woła prawdziwego klienta HTTP Allegro w każdym trybie. Bez sparowanego
      konta kończy się to zdaniem „Konto Allegro niepołączone", zanim cokolwiek
      wyjdzie, więc skutku wysyłki nie da się zobaczyć bez żywego Allegro.

   Co test ma sprawdzić, gdy oba warunki będą spełnione: otwarcie rozmowy,
   napisanie odpowiedzi, wysłanie z przeczekaniem okna cofnięcia, a potem
   SKUTEK po odświeżeniu strony, czyli odpowiedź na osi i rozmowa poza
   kubełkiem „Do odpowiedzi". */
test.fixme("odpowiedź wysłana ze skrzynki stoi na osi, a rozmowa zmienia stan", async () => {});

/* Konflikt świeżości serwer sprawdza PRZED siecią, więc ten test potrzebuje
   wyłącznie rozmowy w seedzie i sposobu na dopisanie wiadomości klienta
   w trakcie redagowania. Ma sprawdzić, że wysyłka staje z pytaniem do agenta,
   a na osi nie przybywa odpowiedź. */
test.fixme("klient dopisał w trakcie redagowania: wysyłka staje i pyta, nie wysyła po cichu", async () => {});
