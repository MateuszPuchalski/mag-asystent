import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/* ── APK kolektora do samodzielnej aktualizacji (0.52.0) ─────────────────────
   Do 0.52.0 nowy APK trafiał na kolektory wyłącznie ręką człowieka: zalogowanie
   do GitHuba, pobranie artefaktu, obejście wszystkich urządzeń przez MDM albo
   `adb install`. Jedynym sygnałem, że trzeba to zrobić, był bursztynowy pasek
   „wersje różne" na dole ekranu — mówiący o problemie i nieoferujący wyjścia.

   Teraz plik leży na serwerze w sieci magazynu, a kolektor pyta o niego przy
   otwarciu aplikacji. Kolektor NIE WYCHODZI do internetu; do serwera plik
   przynosi instalator przy `-Aktualizuj`.

   WERSJĘ NIESIE NAZWA PLIKU, nie jego zawartość. Odczytanie `versionName`
   z APK znaczyłoby własny dekoder binarnego `AndroidManifest.xml` dla jednego
   pola — formatu, który Android potrafi zmienić między wersjami. Nazwa jest
   widoczna w `dir`, więc pomyłkę widać przed wdrożeniem, a nie po nim.

   ROZMIAR I SUMA ZAWSZE Z PLIKU. Ta sama lekcja, którą niesie już trasa zdjęć
   (`routes/products.ts`): długość wzięta skądkolwiek indziej niż ze `stat`
   ucina ciało odpowiedzi bez żadnego błędu, a plik wygląda na uszkodzony.    */

/** Nazwa, po której poznajemy APK kolektora. Cokolwiek innego w katalogu jest ignorowane. */
const NAZWA = /^wertis-kolektor-(\d+)\.(\d+)\.(\d+)\.apk$/;

/** APK gotowy do wydania kolektorom. */
export interface ApkNaSerwerze {
  wersja: string;
  kodWersji: number;
  bajtow: number;
  sha256: string;
  plik: string;
}

export function katalogApk(): string {
  // bez `mkdirSync` — brak katalogu jest tu stanem normalnym i ma znaczyć
  // „nie ma czego wydać", a nie być powodem do tworzenia czegokolwiek
  return path.resolve(path.dirname(config.dbPath), "apk");
}

/**
 * Numer wersji z nazwy pliku → liczba porównywalna.
 *
 * Ten sam wzór, co `versionCode` w `android/app/build.gradle.kts`, i to jest
 * warunek działania całości: kolektor odmówi instalacji pliku o niższym
 * `versionCode` niż zainstalowany, więc serwer musi porządkować pliki tak samo,
 * jak zrobi to Android.
 *
 * Człon powyżej 99 odrzucamy. `0.47.100` i `0.48.0` dają ten sam wynik, a taka
 * kolizja czyta się jako „ta sama wersja" — czyli aktualizacja po cichu znika
 * zamiast być błędna głośno.
 */
export function kodWersji(major: number, minor: number, patch: number): number | null {
  if (minor > 99 || patch > 99) return null;
  return major * 10_000 + minor * 100 + patch;
}

/* Suma z kilkunastu megabajtów liczona przy KAŻDYM pytaniu kolektora byłaby
   czytaniem całego pliku z dysku kilka razy na minutę, na każde urządzenie.
   Klucz obejmuje rozmiar i `mtime`, więc podmiana pliku pod tą samą nazwą
   unieważnia wpis sama z siebie. W bazie tego nie trzymamy: baza przeżyłaby
   podmianę pliku i kłamałaby o sumie, czyli dokładnie o tym, po co ona jest. */
let pamiec: { klucz: string; sha256: string } | null = null;

function sumaPliku(plik: string, bajtow: number, mtimeMs: number): string {
  const klucz = `${plik}|${bajtow}|${mtimeMs}`;
  if (pamiec?.klucz === klucz) return pamiec.sha256;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(plik)).digest("hex");
  pamiec = { klucz, sha256 };
  return sha256;
}

/**
 * Najnowszy APK w katalogu albo `undefined`, gdy nie ma czego wydać.
 *
 * Przy kilku plikach wygrywa najwyższy `kodWersji`, nie sortowanie napisów —
 * po napisach `0.9.0` wychodzi nowsze niż `0.10.0`.
 */
export function apkNaSerwerze(): ApkNaSerwerze | undefined {
  const dir = katalogApk();
  let pliki: string[];
  try {
    pliki = fs.readdirSync(dir);
  } catch {
    return undefined;
  }

  let najlepszy: ApkNaSerwerze | undefined;
  for (const nazwa of pliki) {
    const m = NAZWA.exec(nazwa);
    if (!m) continue;
    const kod = kodWersji(Number(m[1]), Number(m[2]), Number(m[3]));
    if (kod === null) continue;
    if (najlepszy && kod <= najlepszy.kodWersji) continue;

    const plik = path.join(dir, nazwa);
    const st = fs.statSync(plik);
    if (!st.isFile() || st.size === 0) continue;
    /* Dwa bajty nagłówka ZIP. Tanie sprawdzenie łapie plik wgrany w połowie
       albo README przemianowany na `.apk` — a kolektor dowiedziałby się o tym
       dopiero po pobraniu kilkunastu megabajtów. */
    const naglowek = Buffer.alloc(2);
    const fd = fs.openSync(plik, "r");
    try {
      fs.readSync(fd, naglowek, 0, 2, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (naglowek.toString("latin1") !== "PK") continue;

    najlepszy = {
      wersja: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`,
      kodWersji: kod,
      bajtow: st.size,
      sha256: sumaPliku(plik, st.size, st.mtimeMs),
      plik,
    };
  }
  return najlepszy;
}
