import type { Adres } from "../locs.js";
import { db } from "../db/db.js";

/* ── Strefa złota: poziomy 75–140 cm ────────────────────────────────────────
   Wysokość, na której sięga się bez schylania i bez drabiny. Pobranie stamtąd
   to ~3 s; z podłogi albo z góry regału 10–25 s. Przy 342 m² to jest RZĄD
   WIELKOŚCI więcej niż cała droga po magazynie — dlatego przeslotowanie liczy
   pion, a nie odległość.

   Reguły są PER ZAKRES REGAŁÓW, nie globalne: ten sam numer poziomu oznacza
   inną wysokość w różnych alejkach, bo regały mają różną geometrię.

   OD 0.50.0 REGUŁY MIESZKAJĄ W TABELI `strefa_regula` i są edytowalne
   z panelu biura — regały zmieniają geometrię częściej niż wychodzi wydanie.
   Tablica niżej została ZIARNEM: `migrate()` wsiewa ją raz, do pustej tabeli.
   Zapis właściciela, słowo w słowo:
     „A,B,J,H(2,3,4) poziom  C(2,3) D01-D05(2,3), E03-04(2), E05-08(2,3),
      F(4,8), G(3,7)"

   `E05-08` to korekta wcześniejszego `E04-08` i ona rozstrzyga notację: to
   ZAKRESY REGAŁÓW (E05…E08), nie „regał-kolumna". F i G mają DWA NIEPRZYLEGŁE
   poziomy i to nie jest pomyłka: najwyższe alejki to najpewniej dwie
   kondygnacje regałów, każda ze swoją strefą złotą.                          */

export interface RegulaStrefy {
  id?: number;
  /** Cała alejka — gdy nie podano zakresu regałów. */
  alejka?: string;
  /** Zakres regałów włącznie, np. `D01`…`D05`. */
  od?: string;
  do?: string;
  poziomy: number[];
}

/**
 * Cache reguł — karta towaru jest odpytywana co 2 s i nie ma prawa czytać
 * tabeli przy każdym odczycie. Unieważniany JAWNIE przy zapisie reguł
 * (`zapiszReguly`), więc nie ma okna, w którym edycja z biura nie działa.
 */
let cache: RegulaStrefy[] | null = null;

export function regulyStrefy(): RegulaStrefy[] {
  if (cache) return cache;
  const rows = db()
    .prepare("SELECT id, alejka, regal_od, regal_do, poziomy FROM strefa_regula ORDER BY id")
    .all() as Array<{ id: number; alejka: string | null; regal_od: string | null; regal_do: string | null; poziomy: string }>;
  cache = rows.map((r) => ({
    id: r.id,
    ...(r.alejka ? { alejka: r.alejka } : {}),
    ...(r.regal_od ? { od: r.regal_od } : {}),
    ...(r.regal_do ? { do: r.regal_do } : {}),
    poziomy: r.poziomy
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p >= 0),
  }));
  return cache;
}

/** Błąd walidacji reguły albo `null`. Wołane PRZED zapisem — złej nie wpuszczamy. */
export function bladReguly(r: {
  alejka?: string | null;
  od?: string | null;
  do?: string | null;
  poziomy?: string | null;
}): string | null {
  const alejka = (r.alejka ?? "").trim().toUpperCase();
  const od = (r.od ?? "").trim().toUpperCase();
  const doR = (r.do ?? "").trim().toUpperCase();
  if (alejka && (od || doR)) return "Reguła ma mieć ALBO alejkę, ALBO zakres regałów — nie oba";
  if (!alejka && !(od && doR)) return "Podaj alejkę (np. A) albo pełny zakres regałów (np. D01–D05)";
  if (alejka && !/^[A-Z]$/.test(alejka)) return `Alejka to jedna litera, nie „${alejka}"`;
  const REGAL = /^[A-Z]\d{2}$/;
  if (od && !REGAL.test(od)) return `Regał to litera i dwie cyfry, nie „${od}"`;
  if (doR && !REGAL.test(doR)) return `Regał to litera i dwie cyfry, nie „${doR}"`;
  if (od && doR && od[0] !== doR[0]) return "Zakres regałów musi być w jednej alejce";
  const poziomy = (r.poziomy ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (poziomy.length === 0) return "Podaj poziomy strefy, np. 2,3";
  if (poziomy.some((p) => !/^\d{1,2}$/.test(p))) return "Poziomy to liczby rozdzielone przecinkami";
  return null;
}

/** Podmiana KOMPLETU reguł — edytor biura wysyła całość, nie różnicę. */
export function zapiszReguly(
  reguly: Array<{ alejka?: string | null; od?: string | null; do?: string | null; poziomy: string }>
): void {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    d.prepare("DELETE FROM strefa_regula").run();
    const ins = d.prepare(
      "INSERT INTO strefa_regula(alejka, regal_od, regal_do, poziomy) VALUES (?,?,?,?)"
    );
    for (const r of reguly) {
      ins.run(
        (r.alejka ?? "").trim().toUpperCase() || null,
        (r.od ?? "").trim().toUpperCase() || null,
        (r.do ?? "").trim().toUpperCase() || null,
        r.poziomy.trim()
      );
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  cache = null;
}

/** Wyłącznie dla testów — reguły czytane od nowa przy następnym pytaniu. */
export function zresetujCacheStrefy(): void {
  cache = null;
}

/** Numer regału bez litery — do porównań zakresu (`D05` → 5). */
const nr = (regal: string): number => Number(regal.slice(1));

function regulaDla(adres: Adres): RegulaStrefy | null {
  for (const r of regulyStrefy()) {
    if (r.alejka) {
      if (r.alejka === adres.alejka) return r;
      continue;
    }
    if (!r.od || !r.do) continue;
    if (r.od[0] !== adres.alejka) continue;
    if (nr(adres.regal) >= nr(r.od) && nr(adres.regal) <= nr(r.do)) return r;
  }
  return null;
}

/**
 * Czy adres leży w strefie złotej.
 *
 * `null` znaczy **„nie wiem"** — dla tego regału nie ma reguły — a nie „nie".
 * Ta trójwartościowość jest istotna: gdyby brak reguły znaczył „poza strefą",
 * martwy towar z takiego regału zniknąłby z listy eksmisji, a szybkorotujący
 * trafiłby na listę awansów bez żadnej podstawy. Regały bez reguły idą na
 * osobną, czwartą listę — widoczne, zamiast po cichu źle zaklasyfikowane.
 *
 * W ziarnie bez reguły są `D00`, `D06`, `D07`, `E01`.
 */
export function wStrefieZlotej(adres: Adres): boolean | null {
  const r = regulaDla(adres);
  return r ? r.poziomy.includes(adres.poziom) : null;
}

/** Poziomy strefy złotej dla regału — do podpowiedzi „dokąd przenieść". */
export function poziomyStrefy(adres: Adres): number[] | null {
  return regulaDla(adres)?.poziomy ?? null;
}