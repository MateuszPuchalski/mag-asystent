import { createHash } from "node:crypto";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Logo dostawcy (0.56.0) ──────────────────────────────────────────────────
   Biuro wgrywa logo raz, magazynier widzi je po lewej stronie wiersza na
   liście dostaw. Cała funkcja stoi na jednej decyzji: SERWER NIE DOTYKA
   OBRAZU.

   Loga przychodzą w czym popadnie — webp, svg, png. Przerobienie ich na
   serwerze znaczyłoby moduł natywny na maszynie z Subiektem, a to koszt
   nieproporcjonalny do funkcji ozdobnej (ta sama reguła, przez którą zdjęcia
   kartotek nie są skalowane). Konwerter jest gdzie indziej i już go mamy:
   panel biura to przeglądarka, a ta rysuje wszystkie te formaty natywnie.
   Normalizacja do jednego PNG dzieje się więc PRZED wysyłką, w `<canvas>`.

   Tutaj zostaje rola strażnika: sprawdzamy BAJTY, nie deklarację. Wpis, który
   nie zaczyna się sygnaturą PNG, nie przeszedł przez tę konwersję — i jest
   odrzucany, zamiast wylądować w bazie jako obraz, którego kolektor nie
   narysuje.                                                                  */

/** Logo po konwersji waży kilka kB; 128 kB to już sygnał, że coś poszło inną
 *  drogą niż `<canvas>` w panelu.
 *
 *  Limit podniesiony z 64 kB w 0.87.0 razem z dłuższym bokiem obrazu (128 →
 *  256 px). Panel zmniejsza obraz sam, dopóki się nie zmieści, więc ta liczba
 *  nie jest już granicą, o którą człowiek może się potknąć — jest granicą dla
 *  wpisu, który przyszedł z pominięciem panelu. */
const MAX_BAJTOW = 128 * 1024;

const nowIso = () => new Date().toISOString();

export interface LogoWpis {
  khId: number;
  nazwa: string;
  obraz: Buffer;
  bajtow: number;
  etag: string;
}

export interface DostawcaZLogo {
  khId: number;
  nazwa: string;
  maLogo: boolean;
  dokumentow: number;
}

/** `true` tylko dla PNG — patrz komentarz nagłówkowy. */
function czyPng(b: Buffer): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

/**
 * Zapis logo dla kontrahenta. Powtórne wgranie PODMIENIA — logo bywa
 * poprawiane i nie ma powodu, żeby wymagać wcześniejszego skasowania.
 */
export function zapiszLogo(
  khId: number,
  nazwa: string,
  base64: string,
  user: string
): { ok: true; etag: string; bajtow: number } | { ok: false; error: string } {
  if (!Number.isFinite(khId) || khId <= 0) {
    return { ok: false, error: "Brak identyfikatora kontrahenta" };
  }

  const czysty = String(base64 ?? "").replace(/^data:image\/\w+;base64,/, "");
  if (!czysty) return { ok: false, error: "Puste logo" };

  let obraz: Buffer;
  try {
    obraz = Buffer.from(czysty, "base64");
  } catch {
    return { ok: false, error: "Logo nie jest poprawnym base64" };
  }
  if (obraz.length === 0) return { ok: false, error: "Puste logo" };

  /* Odmowa NAZYWA powód i mówi, co zrobić — skalowania nie ma i nie będzie,
     więc „za duże" bez wskazówki zostawiłoby człowieka bez wyjścia. */
  if (obraz.length > MAX_BAJTOW) {
    return {
      ok: false,
      error: `Logo waży ${Math.round(obraz.length / 1024)} kB, a maksimum to ${MAX_BAJTOW / 1024} kB. Wgraj je jeszcze raz przez panel — panel zmniejsza obraz sam.`,
    };
  }
  if (!czyPng(obraz)) {
    return {
      ok: false,
      error: "Logo musi być plikiem PNG po konwersji w panelu. Wybierz plik przyciskiem, zamiast wysyłać go inną drogą.",
    };
  }

  const etag = createHash("sha1").update(obraz).digest("hex");
  db()
    .prepare(
      `INSERT INTO dostawca_logo(kh_id, nazwa, obraz, bajtow, etag, dodane_at, dodane_by)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(kh_id) DO UPDATE SET
         nazwa = excluded.nazwa, obraz = excluded.obraz, bajtow = excluded.bajtow,
         etag = excluded.etag, dodane_at = excluded.dodane_at, dodane_by = excluded.dodane_by`
    )
    .run(khId, nazwa ?? "", obraz, obraz.length, etag, nowIso(), user);

  logEvent("logo_dostawcy_zapis", user, null, { khId, nazwa, bajtow: obraz.length });
  return { ok: true, etag, bajtow: obraz.length };
}

/** Kasowanie. `false` = nie było czego kasować. */
export function usunLogo(khId: number, user: string): boolean {
  const r = db().prepare("DELETE FROM dostawca_logo WHERE kh_id = ?").run(khId);
  if (!r.changes) return false;
  logEvent("logo_dostawcy_usuniecie", user, null, { khId });
  return true;
}

export function logo(khId: number): LogoWpis | null {
  const w = db()
    .prepare("SELECT kh_id AS khId, nazwa, obraz, bajtow, etag FROM dostawca_logo WHERE kh_id = ?")
    .get(khId) as
    | { khId: number; nazwa: string; obraz: Uint8Array; bajtow: number; etag: string }
    | undefined;
  if (!w) return null;
  return { ...w, obraz: Buffer.from(w.obraz) };
}

/**
 * Dostawcy widziani na dokumentach dostaw, z informacją, czy mają logo.
 *
 * Lista bierze się z read-modelu, a nie z tabeli logo — biuro ma zobaczyć
 * firmy, KTÓRE COŚ PRZYWIOZŁY, także te bez logo. Odwrotna kolejność (lista
 * z `dostawca_logo`) pokazywałaby wyłącznie to, co już wgrano, czyli nie
 * odpowiadałaby na pytanie „komu jeszcze brakuje".
 *
 * Dokumenty bez płatnika (`kh_id IS NULL`) wypadają: nie ma do czego przypiąć
 * logo, a wiersz „brak" na liście byłby zaproszeniem do kliknięcia w nic.
 */
export function listaDostawcow(): DostawcaZLogo[] {
  return db()
    .prepare(
      `SELECT d.kh_id AS khId,
              MAX(d.dostawca) AS nazwa,
              COUNT(*) AS dokumentow,
              CASE WHEN l.kh_id IS NULL THEN 0 ELSE 1 END AS maLogo
       FROM sgt_dokument d
       LEFT JOIN dostawca_logo l ON l.kh_id = d.kh_id
       WHERE d.kh_id IS NOT NULL
       GROUP BY d.kh_id
       ORDER BY nazwa COLLATE NOCASE`
    )
    .all()
    .map((r) => {
      const w = r as { khId: number; nazwa: string | null; dokumentow: number; maLogo: number };
      return {
        khId: w.khId,
        nazwa: w.nazwa ?? "",
        dokumentow: w.dokumentow,
        maLogo: !!w.maLogo,
      };
    });
}

/** Które z podanych kontrahentów mają logo — jedno zapytanie na listę dostaw. */
export function ktorzyMajaLogo(khIds: ReadonlyArray<number>): Set<number> {
  const czyste = [...new Set(khIds.filter((k) => Number.isFinite(k) && k > 0))];
  if (czyste.length === 0) return new Set();
  const luki = czyste.map(() => "?").join(",");
  const wiersze = db()
    .prepare(`SELECT kh_id AS khId FROM dostawca_logo WHERE kh_id IN (${luki})`)
    .all(...czyste) as Array<{ khId: number }>;
  return new Set(wiersze.map((w) => w.khId));
}
