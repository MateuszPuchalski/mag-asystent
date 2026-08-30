import fs from "node:fs";
import { config } from "./config.js";
import { stanPolaczenia } from "./services/allegro-token.js";
import { opiszKsztalt, raportKoncowki } from "./services/ksztalt.js";
import {
  urlDyskusji,
  urlListyZwrotow,
  urlOpinii,
  urlOstatnichZamowien,
  urlWatkow,
  urlWiadomosci,
  urlWiadomosciDyskusji,
  zapytajAllegro,
} from "./adapters/allegro.http.js";

/* ── Sonda kształtu Allegro (0.137.2) ────────────────────────────────────────
   Etap 1 przebudowy obsługi klienta: zanim zaprojektujemy model danych od
   nowa, chcemy zobaczyć, co żywe konto NAPRAWDĘ oddaje. Dotychczasowy model
   stał na JSON-ie wymyślonym w testach adaptera i dokładnie tam pękł —
   pytanie o rozrusznik przyjechało bez numeru oferty, choć mail z Allegro tę
   ofertę nazywa.

   WYŁĄCZNIE GET. Sonda niczego nie zapisuje ani u nas, ani w Allegro; nie
   dotyka też bazy poza odczytem tokenu. Wypisuje KSZTAŁT (nazwy pól, typy,
   jak często puste), nigdy treści — raport ma wejść do repo jako
   `docs/allegro-ksztalt.md`, więc nie ma prawa nieść danych osobowych.
   Pilnują tego reguły w `services/ksztalt.ts` i testy obok nich.

   Uruchomienie:  npm run sonda            (raport na ekran)
                  npm run sonda -- plik.md (raport do pliku)                 */

/** Ile rekordów wystarczy, żeby zobaczyć kształt. Sonda nie jest eksportem. */
const PROBKA = 100;

/** Ile wątków rozwijamy do poziomu wiadomości — tam siedzi numer oferty. */
const ROZMOW = 10;

/* Klucz listy podajemy WSZYSTKIMI znanymi nazwami: `/sale/user-ratings`
   oddaje raz `ratings`, raz `userRatings` (patrz `mapujOpinie`), a sonda ma
   opisać kształt, nie wywrócić się na wariancie nazwy. */
const tablica = (json: unknown, ...klucze: string[]): unknown[] => {
  const root = (json ?? {}) as Record<string, unknown>;
  for (const k of klucze) {
    if (Array.isArray(root[k])) return (root[k] as unknown[]).slice(0, PROBKA);
  }
  return [];
};

const idy = (rekordy: unknown[], ile: number): string[] =>
  rekordy
    .map((r) => (r as Record<string, unknown>)?.id)
    .filter((v): v is string => typeof v === "string")
    .slice(0, ile);

/**
 * Jedna końcówka: pobranie, opis, sekcja raportu. Oddaje też same rekordy, bo
 * z wątku trzeba zejść do wiadomości.
 *
 * Awaria JEDNEJ rodziny końcówek nie kończy sondy — brak uprawnienia jest
 * wynikiem, nie wypadkiem: raport ma powiedzieć, czego konto nie widzi,
 * i lecieć dalej. Inaczej jedno 403 na wiadomościach zabrałoby nam obraz
 * zamówień i opinii, po które też przyszliśmy.
 */
async function sekcja(
  nazwa: string,
  pobierz: () => Promise<unknown[]>
): Promise<{ md: string; rekordy: unknown[] }> {
  try {
    const rekordy = await pobierz();
    return { md: raportKoncowki(nazwa, rekordy.length, opiszKsztalt(rekordy)), rekordy };
  } catch (e) {
    const powod = e instanceof Error ? e.message : String(e);
    return { md: `## ${nazwa}\n\n**Nie udało się pobrać.** ${powod}\n`, rekordy: [] };
  }
}

async function main(): Promise<void> {
  const stan = stanPolaczenia();
  if (stan.stan !== "polaczone") {
    console.error(
      `Konto Allegro nie jest sparowane (stan: ${stan.stan}). Sonda czyta żywe ` +
        "konto, więc bez tokenu nie ma czego oglądać — sparuj konto w panelu: " +
        "/biuro → REJESTRY → KONTO ALLEGRO."
    );
    process.exitCode = 1;
    return;
  }

  const api = config.allegro.apiUrl;
  const sekcje: string[] = [];

  /* Wątki wiadomości najpierw i z rozwinięciem do wiadomości: to jest pytanie,
     dla którego ta sonda powstała — gdzie siedzi numer oferty i czy siedzi
     tam zawsze. */
  const watki = await sekcja("`/messaging/threads` — nagłówki wątków", async () =>
    tablica(await zapytajAllegro(urlWatkow(api, 0)), "threads")
  );
  sekcje.push(watki.md);

  const wiadomosci = await sekcja(
    "`/messaging/threads/{id}/messages` — wiadomości",
    async () => {
      const zebrane: unknown[] = [];
      for (const threadId of idy(watki.rekordy, ROZMOW)) {
        zebrane.push(...tablica(await zapytajAllegro(urlWiadomosci(api, threadId)), "messages"));
      }
      return zebrane;
    }
  );
  sekcje.push(wiadomosci.md);

  const dyskusje = await sekcja("`/sale/issues` — dyskusje", async () =>
    tablica(await zapytajAllegro(urlDyskusji(api, 0)), "issues")
  );
  sekcje.push(dyskusje.md);

  sekcje.push(
    (
      await sekcja("`/sale/issues/{id}/messages` — rozmowa dyskusji", async () => {
        const zebrane: unknown[] = [];
        for (const id of idy(dyskusje.rekordy, ROZMOW)) {
          zebrane.push(
            ...tablica(await zapytajAllegro(urlWiadomosciDyskusji(api, id)), "messages")
          );
        }
        return zebrane;
      })
    ).md
  );

  sekcje.push(
    (
      await sekcja("`/sale/user-ratings` — opinie", async () =>
        tablica(await zapytajAllegro(urlOpinii(api, 0)), "ratings", "userRatings")
      )
    ).md
  );

  sekcje.push(
    (
      await sekcja("`/order/checkout-forms` — zamówienia", async () =>
        tablica(await zapytajAllegro(urlOstatnichZamowien(api, dawno(), 0)), "checkoutForms")
      )
    ).md
  );

  sekcje.push(
    (
      await sekcja("`/order/customer-returns` — zwroty", async () =>
        tablica(await zapytajAllegro(urlListyZwrotow(api, null, 0)), "customerReturns")
      )
    ).md
  );

  const raport = [
    "# Kształt odpowiedzi Allegro",
    "",
    "Wynik `npm run sonda` z żywego konta. Dokument opisuje NAZWY PÓL i ich",
    "obecność, nigdy treści — sonda nie wypisuje wiadomości, loginów, nazwisk",
    "ani numerów, a wartości pokazuje tylko dla pól słownikowych (enumów).",
    "",
    "Kolumna **niepuste** jest tu najważniejsza: pole obecne w każdym rekordzie,",
    "ale puste w połowie, wygląda w kodzie na pewne i pewne nie jest.",
    "",
    `Zdjęto: ${new Date().toISOString().slice(0, 10)}. Środowisko: \`${api}\`.`,
    "",
    ...sekcje,
  ].join("\n");

  const plik = process.argv[2];
  if (plik) {
    fs.writeFileSync(plik, raport, "utf8");
    console.log(`Raport zapisany: ${plik}`);
  } else {
    console.log(raport);
  }
}

/** Okno zamówień — rok wstecz wystarczy, żeby zobaczyć kształt. */
function dawno(): string {
  return new Date(Date.now() - 365 * 86_400_000).toISOString();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
