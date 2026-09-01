import fs from "node:fs";
import path from "node:path";

/* ── Wczytanie wertis.env z dysku ────────────────────────────────────────────
   POWSTAŁO, ŻEBY KONFIGURACJA MIAŁA JEDNO ŹRÓDŁO. Do tej pory żyła w trzech
   kopiach: `wertis.env` (dla uruchomienia ręcznego przez `source`) plus
   `AppEnvironmentExtra` osobno dla usługi API i osobno dla workera. Kopie
   synchronizował człowiek, a rozjazd nie dawał żadnego objawu: worker bez
   `SGT_MODE=mssql` dostaje adapter demo, pisze do lokalnego SQLite i ZGŁASZA
   SUKCES. Na kolektorze zielono, w Subiekcie zero zmian.

   Teraz oba procesy czytają ten sam plik z dysku — NSSM nie musi już niczego
   przenosić.

   Zmienne środowiskowe MAJĄ PIERWSZEŃSTWO nad plikiem (zwykła semantyka
   dotenv): testy i `npm run dev` nadpisują pojedyncze wartości bez ruszania
   pliku. Bezpieczeństwo nie stoi na tej regule, tylko na porównaniu trybów
   obu procesów w `/api/health` — działa niezależnie od tego, skąd wartość
   przyszła.                                                                   */

/**
 * Parser zgodny z tym, co robi `source wertis.env` w bashu — plik jest dziś
 * wczytywany właśnie tak i ma pozostać wczytywalny obiema drogami.
 *
 * Obsługuje: `export KEY=VALUE`, `KEY=VALUE`, puste linie, komentarze pełne
 * i doklejone na końcu linii, wartości w cudzysłowach.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key] = m;
    let value = m[2];

    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // W cudzysłowie `#` jest zwykłym znakiem — hasło może go zawierać.
      const end = value.indexOf(quote, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      /* Bez cudzysłowu bash ucina komentarz dopiero po BIAŁYM ZNAKU, więc
         `haslo#7` zostaje w całości, a `INSERTGT   # albo port` traci ogon.
         Ta sama reguła tutaj — inaczej plik działający pod `source` dawałby
         przez aplikację inne hasło i nikt by nie zgadł dlaczego. */
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Katalog i jego rodzice, od najbliższego. Czysta funkcja, bo to jedyna
 * reguła szukania, którą da się sprawdzić bez dotykania dysku.
 */
export function katalogiWGore(start: string): string[] {
  const out: string[] = [];
  let dir = path.resolve(start);
  for (;;) {
    out.push(dir);
    const wyzej = path.dirname(dir);
    if (wyzej === dir) return out;
    dir = wyzej;
  }
}

/* ── Katalog roboczy I JEGO RODZICE (0.153.1) ────────────────────────────────
   Do 0.153.0 lista kończyła się na samym katalogu roboczym i to wystarczało
   wyłącznie usługom: NSSM ma `AppDirectory C:\wertis`, więc plik leży dokładnie
   tam. Każde narzędzie z konsoli npm uruchamia W KATALOGU WORKSPACE'U —
   `npm run sonda`, `reconcile`, `reslot`, `inwentarz`, a także `npm run dev`
   startują w `C:\wertis\server`. Plik stoi piętro wyżej, więc nie był
   wczytywany wcale, a proces po cichu wracał do wartości domyślnych: pusty
   `SGT_MODE` znaczy tryb demo, a demo znaczy `allegroTryb() === "dev"`.

   Objaw kłamał. Sonda mówiła „konto nie jest sparowane", choć konto było
   sparowane — tyle że pytał o nie proces czytający inny zestaw ustawień niż
   usługa, z tej samej instalacji. Chodzenie w górę kasuje różnicę między
   „uruchomione z korzenia" a „uruchomione z server/": obie drogi trafiają na
   ten sam plik. Najbliższy wygrywa, a `/api/health` i tak pokazuje, który to
   był — pomyłka w wyborze pliku ma więc gdzie wyjść na jaw.                  */

/** Miejsca, w których szukamy pliku — w kolejności. */
export function envFileCandidates(): string[] {
  const explicit = process.env.WERTIS_ENV_FILE;
  if (explicit) return [explicit];
  return [
    // obok pliku wykonywalnego — tak stoi instalacja produkcyjna (.exe)
    path.join(path.dirname(process.execPath), "wertis.env"),
    // katalog roboczy, potem w górę — korzeń repo widziany też z `server/`
    ...katalogiWGore(process.cwd()).map((d) => path.join(d, "wertis.env")),
  ];
}

export interface EnvFileResult {
  /** Ścieżka wczytanego pliku; null = nie znaleziono (poprawne w dev). */
  path: string | null;
  /** Klucze wzięte z pliku (bez tych przykrytych przez środowisko). */
  applied: string[];
  /** Klucze obecne w pliku, ale nadpisane przez zmienną środowiskową. */
  overridden: string[];
  /**
   * Wartości Z PLIKU dla kluczy przykrytych — do zdania diagnostycznego
   * „w pliku stoi X, a proces pracuje na Y".
   *
   * **Ta mapa nie ma prawa trafić do odpowiedzi HTTP w całości**: plik trzyma
   * `MSSQL_PASSWORD`. Wystawia się z niej pojedyncze, jawne wartości — dziś
   * wyłącznie `SGT_MODE`, którego treścią jest „mssql" albo „seeded".
   */
  overriddenValues: Record<string, string>;
}

/**
 * Znajduje `wertis.env` i wstawia jego wartości do `process.env`.
 *
 * Wywoływane RAZ, na górze `config.ts`, zanim powstanie literał konfiguracji.
 * Brak pliku nie jest błędem — w trybie demo i w testach go nie ma.
 */
export function loadEnvFile(): EnvFileResult {
  for (const candidate of envFileCandidates()) {
    let text: string;
    try {
      text = fs.readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    const parsed = parseEnvFile(text);
    const applied: string[] = [];
    const overridden: string[] = [];
    const overriddenValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
        applied.push(k);
      } else {
        overridden.push(k);
        overriddenValues[k] = v;
      }
    }
    return { path: candidate, applied, overridden, overriddenValues };
  }
  return { path: null, applied: [], overridden: [], overriddenValues: {} };
}

/**
 * Klucze, których przykrycie ZMIENIA ZACHOWANIE, a nie tylko wartość.
 *
 * Reszta pliku też bywa nadpisywana i to jest w porządku — `LOG_LEVEL` czy
 * `PORT` z powłoki nikogo nie zaskoczą. Te siedem decyduje o tym, DOKĄD idą
 * zapisy, a pomyłka na nich nie daje żadnego objawu poza cichą demówką.
 */
export const KLUCZE_KRYTYCZNE = [
  "SGT_MODE",
  "MSSQL_SERVER",
  "MSSQL_INSTANCE",
  "MSSQL_DATABASE",
  "MSSQL_USER",
  "MSSQL_PASSWORD",
  "MSSQL_LOC_COLUMN",
];

/**
 * Zdanie do `problemy` w `/api/health`, gdy środowisko przykryło konfigurację
 * z pliku. `null`, gdy nie ma o czym mówić.
 *
 * POWSTAŁO PO WDROŻENIU, KTÓRE PRZESZŁO CAŁY KREATOR I WYLĄDOWAŁO NA DEMÓWCE.
 * Kreator zapisał `SGT_MODE=mssql`, plik został wczytany, a proces i tak
 * pracował w trybie `seeded` — bo starsza instalacja zostawiła `SGT_MODE`
 * w `AppEnvironment` usługi, a środowisko ma nad plikiem pierwszeństwo.
 * Instalator kasował wtedy wyłącznie `AppEnvironmentExtra`, więc tamta wartość
 * przeżywała każdą reinstalację.
 *
 * Sama lista przykrytych kluczy istniała już wcześniej — i była wyrzucana do
 * kosza. To jedyne pole, które nazwałoby tę awarię z jednego spojrzenia.
 *
 * @param biezacyTryb wartość, na której proces FAKTYCZNIE pracuje
 */
export function problemPrzykrytejKonfiguracji(
  env: EnvFileResult,
  biezacyTryb: string
): string | null {
  /* Bez pliku nie ma sprzeczności do zgłoszenia. Tak wygląda `npm run dev`
     i każdy test — nadpisywanie środowiskiem jest tam normalną drogą, a nie
     usterką, i alarm w tym miejscu uczyłby ignorować `problemy`. */
  if (!env.path) return null;

  const krytyczne = env.overridden.filter((k) => KLUCZE_KRYTYCZNE.includes(k));
  if (krytyczne.length === 0) return null;

  /* Wartość podajemy TYLKO dla SGT_MODE. Reszta listy to nazwa bazy, login
     i MSSQL_PASSWORD — odpowiedź /api/health nie jest miejscem na hasło. */
  const zPliku = env.overriddenValues.SGT_MODE;
  const tryb =
    zPliku && zPliku !== biezacyTryb
      ? ` W pliku stoi SGT_MODE=${zPliku}, a proces pracuje w trybie ${biezacyTryb} —` +
        " zapisy NIE trafiają tam, gdzie wskazuje konfiguracja."
      : "";

  return (
    `Zmienne środowiskowe usługi przykrywają ${env.path}: ${krytyczne.join(", ")}.` +
    tryb +
    " Wyczyść je: nssm reset wertis-api AppEnvironment oraz AppEnvironmentExtra" +
    " (to samo dla wertis-worker), potem zrestartuj obie usługi."
  );
}
