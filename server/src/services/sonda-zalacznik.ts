import type { WynikSondyZalacznika } from "../adapters/allegro.http.js";

/* ── Raport sondy załącznika — czysta warstwa, bez sieci i bez bazy ──────────
   Osobno od skryptu, żeby test sprawdził jedno: że z tabeli NIE wychodzi
   adres, host ani identyfikator załącznika. Raport ma zdjąć `[WERYFIKUJ]`
   z `docs/allegro-ksztalt.md`, a nie przenieść zdjęcia klienta do dziennika. */

const nazwaDrogi = (w: WynikSondyZalacznika) =>
  w.droga === "api" ? "końcówka API" : "zapisany adres";

const nazwaAkceptu = (a: string | null) =>
  a === null ? "bez Accept" : a.replace("application/vnd.allegro.", "").replace("+json", "");

/** Tabela markdown: droga, Accept, status, typ, bajty, przekierowanie. */
export function tabelaSondy(wyniki: WynikSondyZalacznika[]): string {
  const wiersze = wyniki.map((w) => [
    nazwaDrogi(w), nazwaAkceptu(w.akcept),
    w.status === null ? `błąd: ${w.blad ?? "?"}` : String(w.status),
    w.typ ?? "—", w.bajtow === null ? "—" : String(w.bajtow),
    /* Host końcowy pokazujemy WYŁĄCZNIE przy przekierowaniu — wtedy jest
       odpowiedzią na pytanie, czy Bearer przeżył skok na inny origin. */
    w.przekierowany ? `tak → ${w.hostKoncowy ?? "?"}` : "nie",
  ]);
  return [
    "| droga | Accept | status | typ | bajtów | przekierowanie |",
    "|---|---|---|---|---|---|",
    ...wiersze.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

/**
 * Zdanie-werdykt. Droga API z 200 — NIEZALEŻNIE od `Accept` — potwierdza
 * specyfikację (`downloadAttachmentGET` oddaje plik dowolnego typu); sam zapisany adres →
 * zostajemy przy zapasie; wszystko 403 → uprawnienie; API 406 → to nasz
 * nagłówek, nie Allegro. Do 0.248.0 werdykt liczył wyłącznie wiersze API
 * Z nagłówkiem i przy 200 „bez Accept" mówił „żadna droga nie oddała pliku" —
 * sonda właściciela pokazała 200 i przeczytała to jako porażkę.
 */
export function werdyktSondy(wyniki: WynikSondyZalacznika[]): string {
  const api = wyniki.find((w) => w.droga === "api" && w.status === 200);
  const url = wyniki.find((w) => w.droga === "url" && w.akcept === null && w.status === 200);
  if (api) {
    return `Droga API działa (${nazwaAkceptu(api.akcept)}, ${api.typ ?? "bez typu"}) — ` +
      "zgodnie ze specyfikacją (`downloadAttachmentGET`, odpowiedź `*/*`); panel idzie tą drogą.";
  }
  if (url) {
    return "Działa WYŁĄCZNIE zapisany adres — panel zostaje przy zapasie; " +
      "kody z tej tabeli idą do sekcji w `docs/allegro-ksztalt.md`.";
  }
  if (wyniki.every((w) => w.status === 403)) {
    return "Obie drogi 403 — sprawdź uprawnienie `allegro:api:messaging` w aplikacji na developer.allegro.pl " +
      "i sparuj konto ponownie (token wydany pod stary zakres sam się nie rozszerzy).";
  }
  if (wyniki.some((w) => w.droga === "api" && w.akcept === null && w.status === 406)) {
    return "Końcówka API odrzuca nagłówek Accept (406) — to nasze żądanie, nie brak uprawnienia; " +
      "kody z tabeli idą do zgłoszenia razem z wersją serwera.";
  }
  return "Żadna droga nie oddała pliku — kody w tabeli wyżej idą do zgłoszenia.";
}
