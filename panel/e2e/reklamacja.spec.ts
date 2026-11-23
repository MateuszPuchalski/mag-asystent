import { expect, test } from "@playwright/test";
import { licznikZapisow, otworzKolejke, zalogujDoBiura, zapisJako } from "./pomoc";
import { KONTO, TOKEN } from "./srodowisko";

/* ── Werdykt reklamacji ──────────────────────────────────────────────────────
   Pierwszy zapis tej aplikacji nieodwracalny wobec kupującego: uznanie albo
   odrzucenie idzie do Allegro i drugiego werdyktu w tej samej sprawie nie ma.
   Testy idą tak daleko, jak sięga prawdziwy serwer na bazie z seeda. */

const LISTA = "/api/obsluga/reklamacje";
const NIEISTNIEJACA = 999_999;

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
  const cialo = { werdykt: "REJECTED_OTHER",wiadomosc: "test bramki roli", wersja: 1 };
  expect((await zapisJako(request, null, sciezka, cialo)).status()).toBe(401);
  expect((await zapisJako(request, TOKEN.magazynier, sciezka, cialo)).status()).toBe(403);
});

/* CZEGO BRAKUJE, żeby ten test dało się napisać uczciwie:

   1. Reklamacje w seedzie. `npm run seed:scenariusze` nie zakłada ani jednego
      wiersza w `reklamacja_klienta`, więc kolejka jest pusta. Potrzebna sprawa
      typu CLAIM bez werdyktu, z zamówieniem i rozmową.
   2. Wejście w sprawę w trybie `dev`. Ekran odświeża sprawę jednym POST-em
      (`…/odswiez` w `server/src/routes/reklamacje.ts`), a trasa bez
      `ALLEGRO_CLIENT_ID` odpowiada „Konto Allegro nie jest sparowane”.
   3. Werdykt w trybie `dev`. `wydajWerdykt`
      (`server/src/services/reklamacja-werdykt.ts`) woła `zmienStatusSprawy`
      z prawdziwego klienta HTTP Allegro w każdym trybie.

   Co test ma sprawdzić: wejście w sprawę, wybór werdyktu, zgodę przed
   przyciskiem, a po odświeżeniu strony sprawę w „Rozstrzygniętych”
   z nazwą werdyktu. Osobno: drugi werdykt w tej samej sprawie kończy się
   odmową serwera. */
test.fixme("werdykt reklamacji widać po odświeżeniu strony, a drugiego wydać się nie da", async () => {});
