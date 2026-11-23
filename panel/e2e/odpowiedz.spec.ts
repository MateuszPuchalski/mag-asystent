import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  licznikZapisow, numerZAdresu, odczytJakoBiuro, otworzKolejke, wybierzKubelek, zadaniaDoAllegro,
  zalogujDoBiura, zapisJako,
} from "./pomoc";
import { KONTO, SPRAWA, TOKEN, URL_ALLEGRO } from "./srodowisko";

/* ── Odpowiedź do klienta ze skrzynki ────────────────────────────────────────
   Droga, na której pomyłka trafia do klienta. Idzie przez prawdziwy ekran
   i prawdziwy serwer, a ten rozmawia własnym klientem HTTP z udawanym Allegro
   na tej samej maszynie (`udawane-allegro.mjs`).

   SKUTEK, NIE NAPIS. Pasek „Wysłano" rysuje panel. O tym, czy klient coś
   dostał, mówi dopiero dziennik żądań po drugiej stronie i to, co stoi na
   osi po odświeżeniu strony. Każdy test wysyłki kończy się na obu.

   Kolejność testów w pliku ma znaczenie: cofnięcie stoi przed wysyłką, bo
   oba idą na tej samej rozmowie, a wysłana odpowiedź zmienia jej stan. */

const LISTA = "/api/obsluga/rozmowy";
/* Okno cofnięcia z `skrzynka/Odlozone.tsx`. Test czeka prawdziwe dziesięć
   sekund: zegar podmieniony w przeglądarce sprawdzałby podmieniony zegar. */
const OKNO_COFNIECIA_MS = 10_000;

const wiadomosciWatku = (watek: string) => `/messaging/threads/${watek}/messages`;

interface OsRozmowy {
  rozmowa: { id: number; status: string; wersja: number };
  os: Array<{ rodzaj: string; odKlienta?: boolean; messageId?: number; tresc?: string }>;
}

async function otworzRozmowe(page: Page, login: string) {
  await otworzKolejke(page, "/obsluga/skrzynka", LISTA);
  await page.getByRole("button", { name: new RegExp(login.replace(".", "\\.")) }).first().click();
  await expect(page.getByRole("link", { name: "Profil klienta" })).toBeVisible();
}

/**
 * Pisze odpowiedź i wysyła ją skrótem z pola.
 *
 * KLAWIATURĄ, NIE MYSZĄ. Przy oknie 1280 px pierwsze kliknięcie myszą
 * w „Wyślij" po pisaniu przepada. Osobny test niżej pokazuje to wprost
 * i zostaje czerwony do naprawy. Tu chodzi o resztę drogi, więc idzie nią
 * skrót, który ekran sam podpowiada przy przycisku.
 */
async function napiszIWyslij(page: Page, tresc: string) {
  const pole = page.getByRole("textbox", { name: "Szkic odpowiedzi" });
  await pole.fill(tresc);
  await pole.press("Control+Enter");
}

const pasekWysylki = (page: Page, zdanie: string | RegExp) =>
  page.getByRole("status").filter({ hasText: zdanie });

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

test("cofnięcie w oknie nie wysyła niczego, a treść wraca do pola", async ({ page, request }) => {
  test.setTimeout(60_000);
  const tresc = "Odpowiedź cofnięta przed wysłaniem — nie ma prawa wyjść.";
  const { watek, login } = SPRAWA.rozmowaWolna;
  await zalogujDoBiura(page, KONTO.biuro.login);
  await otworzRozmowe(page, login);
  const zapisy = licznikZapisow(page);

  await napiszIWyslij(page, tresc);
  await pasekWysylki(page, `Odpowiedź do ${login} wyjdzie za`).getByRole("button", { name: "Cofnij" }).click();

  /* Treść wraca do pola tej samej rozmowy: cofnięcie, które kasuje napisany
     tekst, kosztowałoby agenta całą odpowiedź za jedną pomyłkę. */
  await expect(page.getByRole("textbox", { name: "Szkic odpowiedzi" })).toHaveValue(tresc);
  await expect(pasekWysylki(page, "wyjdzie za")).toHaveCount(0);

  /* Dowód na „nie wyszło" wymaga przeczekania CAŁEGO okna i chwili dłużej.
     Asercja zaraz po kliknięciu przeszłaby także wtedy, gdy „Cofnij" chowa
     pasek, a zegar wysyłki tyka dalej. */
  await page.waitForTimeout(OKNO_COFNIECIA_MS + 2_000);
  expect(zapisy.filter((z) => z.endsWith("/send")), "przeglądarka nie zleciła wysyłki").toEqual([]);
  expect(await zadaniaDoAllegro(request, "POST", wiadomosciWatku(watek)),
    "do Allegro nie doszło żadne żądanie w tym wątku, przyjęte ani odrzucone").toEqual([]);
});

test.fail("pierwsze kliknięcie myszą w „Wyślij” po napisaniu odpowiedzi odkłada wysyłkę", async ({ page }) => {
  /* ZNANY BŁĄD PANELU, jeszcze nienaprawiony. `test.fail` znaczy: ten test
     MA dziś padać. Po naprawie zacznie przechodzić i wtedy wywróci przebieg,
     żeby ktoś zdjął znacznik i zostawił zwykły test.

     Przy oknie 1280 px (zmierzone także przy 1536 px) kliknięcie przepada.
     Naciśnięcie przycisku zabiera fokus z pola, a wtedy „Zakończ” w nagłówku
     rozmowy dostaje znaczek skrótu `Z`. Nagłówek łamie się na drugi wiersz
     i zsuwa rozmowę o 37 px, zanim palec puści mysz. Puszczenie trafia obok
     przycisku, więc kliknięcia nie ma: ani paska, ani błędu. Drugie
     kliknięcie działa. Zależy to od długości loginu w nagłówku, dlatego test
     stoi na tej rozmowie, na której usterkę zmierzono.

     Stoi PRZED testem wysyłki: odkłada wysyłkę i zaraz ją cofa, więc po
     naprawie niczego w tej rozmowie nie zużyje. */
  const { login } = SPRAWA.rozmowaWolna;
  await zalogujDoBiura(page, KONTO.biuro.login);
  await otworzRozmowe(page, login);
  const pole = page.getByRole("textbox", { name: "Szkic odpowiedzi" });
  await pole.click();
  await pole.pressSequentially("Mamy dwie sztuki.");
  await page.getByRole("button", { name: "Wyślij do klienta" }).click();

  const pasek = pasekWysylki(page, `Odpowiedź do ${login} wyjdzie za`);
  await expect(pasek, "jedno kliknięcie w „Wyślij” ma odłożyć wysyłkę").toBeVisible({ timeout: 3_000 });
  await pasek.getByRole("button", { name: "Cofnij" }).click();
});

test("odpowiedź wysłana ze skrzynki dochodzi do Allegro raz, stoi na osi i zmienia stan rozmowy", async ({ page, request }) => {
  test.setTimeout(90_000);
  const tresc = "Tak, mamy dwie sztuki od ręki. Wyślemy jutro.";
  const { watek, login } = SPRAWA.rozmowaWolna;
  await zalogujDoBiura(page, KONTO.biuro.login);
  await otworzRozmowe(page, login);
  const id = numerZAdresu(page);

  await napiszIWyslij(page, tresc);
  await expect(pasekWysylki(page, `Odpowiedź do ${login} wyjdzie za`)).toBeVisible();
  /* W oknie cofnięcia nic nie wychodzi. To jest cała obietnica okna: agent
     ma dziesięć sekund, w których klient jeszcze nic nie widzi. */
  expect(await zadaniaDoAllegro(request, "POST", wiadomosciWatku(watek))).toEqual([]);

  await expect(pasekWysylki(page, `Wysłano do ${login}`)).toBeVisible({ timeout: OKNO_COFNIECIA_MS + 15_000 });

  /* ── Skutek pierwszy: druga strona dostała DOKŁADNIE JEDNO żądanie ──────── */
  const wyslane = await zadaniaDoAllegro(request, "POST", wiadomosciWatku(watek));
  expect(wyslane.filter((w) => w.przyjete), "jedno przyjęte żądanie z odpowiedzią").toHaveLength(1);
  expect(wyslane, "żadnej drugiej próby, także odrzuconej").toHaveLength(1);
  /* Całe ciało, nie samo `text`: pole dołożone do wiadomości bez załączników
     zmieniłoby kształt żądania, którym chodzi każda odpowiedź biura. */
  expect(wyslane[0].cialo).toEqual({ text: tresc });
  expect(wyslane[0].contentType, "ciało niesie wersję zasobu").toBe(wyslane[0].accept);

  /* ── Skutek drugi: po odświeżeniu strony odpowiedź stoi na osi ───────────── */
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(login.replace(".", "\\.")) }),
    "rozmowa zeszła z „Do odpowiedzi”").toHaveCount(0);
  await wybierzKubelek(page, "Oczekujące");
  await page.getByRole("button", { name: new RegExp(login.replace(".", "\\.")) }).first().click();
  await expect(page.getByRole("article").filter({ hasText: tresc })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Szkic odpowiedzi" }), "wysłana treść nie wraca jako szkic").toHaveValue("");

  /* ── Skutek trzeci: stan po stronie serwera ───────────────────────────────
     Kubełek liczy panel. Status i to, że na osi stoi jedna odpowiedź biura
     z tą treścią, mówi serwer, z którego kubełek dopiero się bierze. */
  const stan = await odczytJakoBiuro<OsRozmowy>(request, `/api/obsluga/rozmowy/${id}`);
  expect(stan.rozmowa.status).toBe("waiting_for_customer");
  expect(stan.os.filter((w) => w.rodzaj === "wiadomosc" && !w.odKlienta && w.tresc === tresc)).toHaveLength(1);

  /* ── Ta sama odpowiedź drugi raz nie wychodzi ─────────────────────────────
     Podwójne kliknięcie albo ponowienie po zerwanym połączeniu niesie tę samą
     treść do tej samej wiadomości klienta. Serwer ma oddać wynik pierwszej
     próby, a klient nie może dostać odpowiedzi dwa razy. */
  const ostatniaKlienta = [...stan.os].reverse().find((w) => w.rodzaj === "wiadomosc" && w.odKlienta)?.messageId ?? null;
  const powtorka = await zapisJako(request, TOKEN.biuro, `/api/conversations/${id}/send`,
    { body: tresc, expectedVersion: stan.rozmowa.wersja, expectedLastMessageId: ostatniaKlienta });
  expect(powtorka.status()).toBe(200);
  expect((await powtorka.json() as { status: string }).status).toBe("sent");
  expect(await zadaniaDoAllegro(request, "POST", wiadomosciWatku(watek)), "powtórka nie doszła do Allegro").toHaveLength(1);
});

/* Klient dopisuje w wątku po stronie Allegro, a synchronizacja skrzynki
   przynosi dopisek do naszej bazy. Tak samo dzieje się to na produkcji, tyle
   że tam synchronizację woła takt, a tu test. */
async function klientDopisuje(request: APIRequestContext, watek: string, tekst: string) {
  expect((await request.post(`${URL_ALLEGRO}/__e2e/dopisz`, { data: { watek, tekst } })).ok()).toBe(true);
  const sync = await zapisJako(request, TOKEN.biuro, "/api/obsluga/synchronizuj", undefined);
  expect(sync.ok(), `synchronizacja skrzynki: ${await sync.text()}`).toBe(true);
}

test("klient dopisał w trakcie redagowania: odpowiedź na stare pytanie nie wychodzi bez wiedzy agenta", async ({ page, request }) => {
  /* Projekt ekranu daje dwie zapory. Pasek „Klient dopisał nową wiadomość”
     zatrzymuje wysyłkę przy kliknięciu, a serwer odmawia kodem 409, gdy
     odpowiedź niesie numer starej wiadomości.

     Ten test znalazł błąd, którego testy w jsdom nie widziały: panel czytał
     `odKlienta` z wierzchu zdarzenia, a serwer wysyła pola w kopercie `data`.
     Dopisek wyglądał jak nasza własna wiadomość, rozmowa odświeżała się po
     cichu i odpowiedź na stare pytanie wychodziła do klienta. Dlatego droga
     idzie tu przez prawdziwą szynę zdarzeń prawdziwego serwera.

     Test nie wymusza żadnej z dwóch zapór. Sprawdza skutek, który obie mają
     dać: do Allegro nic nie wychodzi, a ekran mówi o dopisku. */
  test.setTimeout(60_000);
  const tresc = "Zawleczka pasuje do sworznia 8 mm.";
  const dopisek = "Poprawka: sworzeń ma jednak 10 mm, nie 8.";
  const { watek, login } = SPRAWA.rozmowaDopisek;
  await zalogujDoBiura(page, KONTO.biuro.login);
  await otworzRozmowe(page, login);
  const id = numerZAdresu(page);
  const pole = page.getByRole("textbox", { name: "Szkic odpowiedzi" });
  await pole.fill(tresc);

  await klientDopisuje(request, watek, dopisek);
  /* Wiersz kolejki niesie ostatnie słowa klienta. Gdy pokaże dopisek,
     zdarzenie o nim na pewno doszło do tej przeglądarki. Bez tego czekania
     test ścigałby się ze strumieniem i raz mierzył jedną drogę, raz drugą. */
  await expect(page.getByRole("button", { name: new RegExp(dopisek) })).toBeVisible();

  await pole.press("Control+Enter");
  await page.waitForTimeout(OKNO_COFNIECIA_MS + 3_000);

  expect(await zadaniaDoAllegro(request, "POST", wiadomosciWatku(watek)),
    "odpowiedź pisana na stare pytanie nie wychodzi, dopóki agent nie przeczyta dopisku").toEqual([]);
  await expect(page.getByText(/Klient dopisał/).first(), "ekran mówi agentowi o dopisku").toBeVisible();
  const stan = await odczytJakoBiuro<OsRozmowy>(request, `/api/obsluga/rozmowy/${id}`);
  expect(stan.os.filter((w) => w.rodzaj === "wiadomosc" && !w.odKlienta), "na osi nie przybyła odpowiedź biura").toEqual([]);
});
