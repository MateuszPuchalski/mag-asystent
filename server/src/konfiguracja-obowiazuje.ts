import type { Config } from "./config.js";

/* ── Wartość, która obowiązuje (0.543.0) ────────────────────────────────────
   Panel pokazywał przy kluczu z wartością domyślną kreskę. „Termin na zwrot:
   —" nie odpowiada na pytanie, ile dni ma biuro. Znał to tylko `config.ts`.

   Domyślnych NIE przepisujemy do rejestru (nagłówek `konfiguracja-rejestr.ts`):
   druga kopia rozjechałaby się przy pierwszej zmianie. Zamiast tego każdy
   wpis tutaj CZYTA gotowe pole `config`. To jest ta sama liczba, którą
   pracuje serwer, łącznie z wartościami wyliczonymi, jak model rozpoznawania
   dziedziczony po modelu szkiców. Zła ścieżka łapie się przy `tsc`.

   Zakres to decyzje właściciela czytane przez serwer, bez sekretów. Klucze
   workerów C# mają domyślne w C#, których serwer nie zna — panel mówi przy
   nich „domyślna". Kompletność pilnuje `konfiguracja-obowiazuje.test.ts`. */

type Pole = (c: Config) => string | number | boolean | null | readonly (string | number)[];

export const OBOWIAZUJE: Readonly<Record<string, Pole>> = {
  MAG_ID_ODP: (c) => c.magId.ODP,
  MAG_ID_SERWIS: (c) => c.magId.SERWIS,
  DOK_TYPY_DOSTAW: (c) => c.mssql.dokTypyDostaw,
  POZYCJE_NIE_TOWAROWE: (c) => c.pozycjeNieTowarowe,
  TW_ID_PRZESYLKA: (c) => c.twIdPrzesylka,
  ALLOW_MANUAL_LOC: (c) => c.allowManualLoc,
  ZDJECIA_DODAWANIE: (c) => c.zdjecia.dodawanie,

  ALLEGRO_CLIENT_ID: (c) => c.allegro.clientId,
  ALLEGRO_USER_AGENT: (c) => c.allegro.userAgent,
  ALLEGRO_INBOX_OD: (c) => c.allegro.inboxOd,
  ALLEGRO_ZWROTY_OD: (c) => c.allegro.zwrotyOd,
  REKLAMACJE_OD: (c) => c.allegro.reklamacjeOd,
  ZWROT_ROZLICZONE_OD: (c) => c.allegro.zwrotyRozliczoneOd,
  ZWROT_TERMIN_DNI: (c) => c.allegro.zwrotTerminDni,
  ZWROT_WYGASA_DNI: (c) => c.allegro.zwrotWygasaDni,

  COPILOT_MODE: (c) => c.copilot.mode,
  COPILOT_MODEL: (c) => c.copilot.model,
  COPILOT_MODEL_KLASYFIKACJA: (c) => c.copilot.modelKlasyfikacji,
  COPILOT_AUTO_SZKIC: (c) => c.copilot.autoSzkic,
  COPILOT_AUTO_KLASYFIKACJA: (c) => c.copilot.autoKlasyfikacja,
  COPILOT_SZKIC_PO_ROZPOZNANIU: (c) => c.copilot.szkicPoRozpoznaniu,
  COPILOT_AUTO_NA_GODZINE: (c) => c.copilot.autoNaGodzine,
  COPILOT_AUTO_KLASYFIKACJA_NA_GODZINE: (c) => c.copilot.autoKlasyfikacjaNaGodzine,
  COPILOT_PRZED_PRACA: (c) => c.copilot.przedPraca,
  COPILOT_PRZED_PRACA_OKNO: (c) => c.copilot.przedPracaOkno,
  COPILOT_PRZED_PRACA_LIMIT: (c) => c.copilot.przedPracaLimit,
  WIEDZA_AUTOMAT: (c) => c.wiedzaAutomat.wlaczony,
  WIEDZA_AUTOMAT_MODEL: (c) => c.wiedzaAutomat.model,
  PASOWANIE_Z_SIECI: (c) => c.pasowanieZSieci.wlaczony,
  SFERA_ZW: (c) => c.sferaZw,

  KOPIE_KATALOG: (c) => c.kopie.katalog,
  AKTUALIZACJA_AUTO: (c) => c.aktualizacja.tryb,
  AKTUALIZACJA_OKNO: (c) => c.aktualizacja.okno,
  AKTUALIZACJA_DOJRZALOSC_H: (c) => c.aktualizacja.dojrzaloscGodz,
  AKTUALIZACJA_KANAREK: (c) => c.aktualizacja.kanarek,
};

/**
 * Wartość obowiązująca w kształcie, w jakim wpisuje się ją do `wertis.env`:
 * przełącznik jako 0/1, lista po przecinku, brak progu jako pusty tekst.
 * Panel porównuje ją ze słowami z rejestru (`wartosci`), a te mówią językiem
 * pliku — `"0": "wyłączony"` — więc tłumaczenie musi wrócić do tego kształtu.
 * `null`, gdy serwer tej wartości nie zna.
 */
export function wartoscObowiazujaca(klucz: string, c: Config): string | null {
  const pole = OBOWIAZUJE[klucz];
  if (!pole) return null;
  const v = pole(c);
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (Array.isArray(v)) return v.join(",");
  return String(v);
}
