import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import type { EnvFileResult } from "../env-file.js";
import { kluczZRejestru, type Edycja } from "../konfiguracja-rejestr.js";

/* ── Zmiana ustawienia z panelu (0.491.0) ────────────────────────────────────
   Do tego wydania każda zmiana `wertis.env` była pulpitem zdalnym, edytorem
   tekstu i restartem usług. Panel robi dziś to samo, w tej kolejności, i ani
   jednego kroku więcej:

   1. SPRAWDZA WARTOŚĆ według rodzaju z rejestru (liczba, data, wybór, tekst).
   2. SKŁADA NOWY PLIK, zmieniając jedną linię. Komentarze, klucze
      instalatora i wpisy dopisane ręką zostają, jak przy scalaniu
      w instalatorze.
   3. PRÓBUJE WSTAĆ Z NIM, zanim go zapisze. Osobny proces ładuje prawdziwy
      `config.ts` na pliku-kandydacie. Konfiguracja, przy której serwer
      odmówiłby startu, NIE trafia na dysk. Bez tego jedna literówka
      z panelu kładłaby usługę w pętlę restartów, a z nią sam panel — jedyne
      narzędzie, którym dałoby się ją cofnąć.
   4. ZAPISUJE ATOMOWO i zostawia poprzednią wersję w `wertis.env.poprzedni`.

   Walidacja w procesie potomnym, nie kopią reguł. `bledyKonfiguracji` ma
   kilkanaście reguł krzyżowych (klucz Allegro bez sekretu, ZW bez workera
   Sfery), a druga ich kopia rozjechałaby się przy pierwszej nowej regule.
   Pytanie brzmi „czy serwer wstanie", więc odpowiada na nie serwer.      */

export class BladZmiany extends Error {
  constructor(message: string, readonly kod = 400) { super(message); }
}

/**
 * Wartość w kształcie, który rozumie parser `env-file.ts` i `source` w bashu
 * — plik ma zostać wczytywalny obiema drogami (DEPLOY §2a).
 *
 * Bez cudzysłowu tylko znaki, których bash nie tłumaczy. `&` w adresie
 * Allegro albo `?` w haśle rozbiłyby `source`. Apostrofy, nie cudzysłów:
 * w apostrofach bash nie rozwija też `$`. Parser serwera zna obie formy.
 */
export function doPliku(wartosc: string): string {
  if (/^[A-Za-z0-9_.,:/@+-]*$/.test(wartosc)) return wartosc;
  return wartosc.includes("'") ? `"${wartosc}"` : `'${wartosc}'`;
}

/**
 * Nowa treść pliku ze zmienionym jednym kluczem. `null` usuwa wpis, czyli
 * wraca do wartości domyślnej. Czysta funkcja — cała logika tekstu w teście.
 */
export function scalPlik(tresc: string, klucz: string, wartosc: string | null): string {
  const nl = tresc.includes("\r\n") ? "\r\n" : "\n";
  const linie = tresc.length ? tresc.split(/\r?\n/) : [];
  const wzor = new RegExp(`^\\s*(?:export\\s+)?${klucz}\\s*=`);
  const nowa = wartosc === null ? null : `export ${klucz}=${doPliku(wartosc)}`;
  let wstawiona = false;
  const wynik: string[] = [];
  for (const l of linie) {
    if (!wzor.test(l)) { wynik.push(l); continue; }
    /* Duplikat klucza zostawiłby parser z ostatnią wartością, a człowieka
       czytającego plik — z pierwszą. Zostaje jedna linia, w miejscu pierwszej. */
    if (nowa !== null && !wstawiona) { wynik.push(nowa); wstawiona = true; }
  }
  if (nowa !== null && !wstawiona) {
    while (wynik.length && wynik[wynik.length - 1] === "") wynik.pop();
    wynik.push("", "# ── zmienione z panelu ──", nowa, "");
  }
  return wynik.join(nl);
}

/** Wartość zgodna z rodzajem klucza albo zdanie, dlaczego nie. */
export function bladWartosci(klucz: string, e: Edycja, wartosc: string): string | null {
  /* Znak nowej linii rozciąłby wpis na dwa, a cudzysłów zamknąłby wartość
     w połowie — parser nie zna ucieczek, tak samo jak `source`. */
  if (/[\r\n"]/.test(wartosc)) return `${klucz}: bez znaków nowej linii i cudzysłowu.`;
  if (wartosc.length > 500) return `${klucz}: najwyżej 500 znaków.`;
  switch (e.rodzaj) {
    case "liczba":
      return /^\d{1,9}$/.test(wartosc) ? null : `${klucz}: podaj liczbę całkowitą.`;
    case "data":
      /* Pusta data to „bez progu" i jest poprawna (`data()` w `config.ts`). */
      if (wartosc === "") return null;
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(wartosc)
        && Number.isFinite(Date.parse(wartosc))
        ? null : `${klucz}: data ISO ze strefą, np. 2026-08-31T22:00:00Z.`;
    case "wybor":
      return e.opcje?.includes(wartosc) ? null : `${klucz}: jedna z wartości ${e.opcje?.join(", ")}.`;
    case "tekst":
      return null;
  }
}

/** Plik `config` obok tego modułu: `.ts` pod tsx, `.js` w zbudowanym `dist/`. */
function plikKonfiguracji(): string {
  const tu = fileURLToPath(import.meta.url);
  return path.join(path.dirname(tu), "..", `config${path.extname(tu)}`);
}

/**
 * Czy serwer wstałby z tym plikiem. `null` = tak, inaczej zdanie z odmowy.
 *
 * ASYNCHRONICZNIE, nie `spawnSync`. Próba trwa od pół do dwóch sekund,
 * a synchroniczne wywołanie zamroziłoby na ten czas cały serwer — także
 * kolektory w hali, które nie mają z tą zmianą nic wspólnego.
 *
 * Środowisko potomka to środowisko tego procesu BEZ kluczy, które przyszły
 * z pliku przy starcie — inaczej stare wartości przykryłyby kandydata, bo
 * zmienna środowiskowa wygrywa z plikiem. Zmienne ustawione naprawdę
 * (na usłudze) zostają, bo zostaną też przy prawdziwym restarcie.
 */
export function sprawdzKandydata(plik: string, env: EnvFileResult): Promise<string | null> {
  const srodowisko: NodeJS.ProcessEnv = { ...process.env, WERTIS_ENV_FILE: plik };
  for (const k of env.applied) delete srodowisko[k];
  return new Promise((gotowe) => {
    execFile(process.execPath, [
      ...process.execArgv, "--input-type=module", "-e",
      "import(process.argv[1]).then(() => process.stdout.write('OK'), (e) => process.stdout.write('BLAD ' + (e && e.message || e)))",
      pathToFileURL(plikKonfiguracji()).href,
    ], { env: srodowisko, encoding: "utf8", timeout: 30_000 }, (blad, stdout) => {
      if (stdout === "OK") return gotowe(null);
      if (stdout.startsWith("BLAD ")) return gotowe(stdout.slice(5).trim());
      /* Proces nie odpowiedział wcale — nie wiemy, czy serwer by wstał, więc
         traktujemy to jak odmowę. Zapis „na ślepo" jest tym, czego ta
         funkcja ma nie dopuścić. */
      gotowe(`Nie udało się sprawdzić konfiguracji (${blad?.message ?? "brak odpowiedzi"}).`);
    });
  });
}

/* Jedna zmiana naraz. Dwa zapisy w tej samej sekundzie czytałyby ten sam
   plik i drugi zjadłby pierwszy — po cichu, bo oba dostałyby 200. */
let trwa = false;

export interface WynikZmiany {
  klucz: string;
  /** Do dziennika: stara i nowa wartość, a przy sekrecie tylko ślad zmiany. */
  z: string | null;
  na: string | null;
}

/**
 * Zmienia jeden klucz w `wertis.env`. Rzuca `BladZmiany` z gotowym zdaniem.
 * Restart i wpis do dziennika robi trasa — ta funkcja zna tylko plik.
 */
export async function zmienKlucz(
  env: EnvFileResult,
  klucz: string,
  wartosc: string | null,
  sprawdz: (plik: string, env: EnvFileResult) => Promise<string | null> = sprawdzKandydata,
): Promise<WynikZmiany> {
  const k = kluczZRejestru(klucz);
  if (!k?.edycja) throw new BladZmiany(`${klucz} nie zmienia się z panelu — to klucz instalatora albo pliku.`);
  if (!env.path) throw new BladZmiany("Serwer nie ma pliku wertis.env. Ustawienia zmienia się wtedy instalatorem.", 409);
  /* Zmienna usługi wygrywa z plikiem. Zapis przeszedłby, a serwer po
     restarcie dalej pracowałby na starej wartości — cicho, bez objawu. */
  if (env.overridden.includes(klucz)) {
    throw new BladZmiany(`${klucz} jest przykryty zmienną środowiskową usługi. `
      + "Najpierw ją usuń (nssm reset wertis-api AppEnvironmentExtra), inaczej zmiana nie zadziała.", 409);
  }
  if (wartosc !== null) {
    const b = bladWartosci(klucz, k.edycja, wartosc);
    if (b) throw new BladZmiany(b);
  }

  if (trwa) throw new BladZmiany("Inna zmiana konfiguracji właśnie się zapisuje. Spróbuj za chwilę.", 409);
  trwa = true;
  const kandydat = `${env.path}.kandydat`;
  try {
    const obecny = fs.readFileSync(env.path, "utf8");
    fs.writeFileSync(kandydat, scalPlik(obecny, klucz, wartosc), "utf8");
    const odmowa = await sprawdz(kandydat, env);
    if (odmowa) throw new BladZmiany(`Serwer nie wstałby z tą zmianą: ${odmowa}`);
    fs.copyFileSync(env.path, `${env.path}.poprzedni`);
    fs.renameSync(kandydat, env.path);
  } finally {
    fs.rmSync(kandydat, { force: true });
    trwa = false;
  }

  const poprzednio = /* wartość sprzed zmiany, taka jak widzi ją ten proces */ process.env[klucz] ?? null;
  return k.tajny
    ? { klucz, z: poprzednio === null ? null : "ustawione", na: wartosc === null ? null : "ustawione" }
    : { klucz, z: poprzednio, na: wartosc };
}

/**
 * Czy po `od` ktoś zmienił konfigurację z panelu. Pyta worker Node w swojej
 * pętli, żeby wstać z nowym plikiem razem z API.
 */
export function konfiguracjaZmienionaPo(od: string, database: DatabaseSync): boolean {
  const r = database
    .prepare("SELECT MAX(created_at) AS at FROM events WHERE type = 'konfiguracja_zmieniona'")
    .get() as { at: string | null };
  return r.at !== null && r.at > od;
}
