import { createHash, randomUUID } from "node:crypto";
import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { rozpoznajMime } from "../adapters/zdjecia.sgt.js";

/* ── Zdjęcie kartoteki dodane z kolektora (0.88.0) ───────────────────────────
   Magazynier stoi przy regale z towarem w ręku i widzi na karcie pusty slot.
   Do 0.87.0 jedyną drogą było „powiedz biuru", czyli ta sama ślepa uliczka,
   którą 0.37.0 zlikwidowało dla kodów kreskowych.

   DWA STOPNIE, BO WYCINANIE TŁA BYWA NIEUDANE. Najpierw powstaje PODGLĄD:
   zdjęcie idzie na serwer, usługa `wertis-tlo` wycina tło, a człowiek ogląda
   wynik. Dopiero drugie wywołanie ZAPISUJE — i dopiero ono cokolwiek kolejkuje.
   Bez tego kroku zdjęcie regału z pięcioma kartonami wchodziłoby do bazy firmy,
   a odkręcić mogłoby to wyłącznie biuro.

   Podgląd trzyma OBIE wersje, wyciętą i oryginał. Przycisk „ZOSTAW TŁO" musi
   mieć co zapisać bez drugiego przesyłania zdjęcia przez Wi-Fi hali.

   Obraz zapisany siedzi W BAZIE, nie w `data/zdjecia` — ta sama różnica co przy
   `dostawca_logo`. Cache zdjęć wolno skasować, bo odtworzy się z Subiekta;
   tego nikt nie odtworzy.                                                     */

/** Podgląd starszy niż to kasuje się sam — nikt do niego nie wróci. */
const podgladMs = () => config.zdjecia.podgladMin * 60_000;

export interface ZdjeciePodgladu {
  id: string;
  twId: number;
  /** `null` = tła nie usunięto (usługa wyłączona albo odmówiła). */
  bezTla: Buffer | null;
  oryginal: Buffer;
  /** Typ ORYGINAŁU. Wycięte tło jest zawsze PNG. */
  mime: string;
}

export interface ZdjecieWlasne {
  twId: number;
  obraz: Buffer;
  mime: string;
  bajtow: number;
  etag: string;
  tloUsuniete: boolean;
  dodaneAt: string;
  dodaneBy: string;
  queueId: number | null;
  wSubiekcieAt: string | null;
}

/** Czy w tej instalacji wolno w ogóle dodawać zdjęcia. */
export function dodawanieWlaczone(): boolean {
  return config.zdjecia.dodawanie !== "";
}

/**
 * Bajty z base64 przysłanego przez kolektor — albo zdanie o tym, co jest nie tak.
 *
 * Sprawdzamy BAJTY, nie deklarację, i to jest cała rola tej funkcji. Wpis, który
 * nie zaczyna się sygnaturą obrazu, nie przyszedł z aparatu ani z galerii i nie
 * ma prawa wylądować w bazie jako coś, czego kolektor nie narysuje. Ta sama
 * reguła co przy logo dostawcy (`services/logo-dostawcy.ts`).
 */
export function bajtyZeZdjecia(
  base64: string
): { ok: true; obraz: Buffer; mime: string } | { ok: false; error: string } {
  const czysty = String(base64 ?? "").replace(/^data:image\/\w+;base64,/, "");
  if (!czysty) return { ok: false, error: "Puste zdjęcie" };

  let obraz: Buffer;
  try {
    obraz = Buffer.from(czysty, "base64");
  } catch {
    return { ok: false, error: "Zdjęcie nie jest poprawnym base64" };
  }
  if (obraz.length === 0) return { ok: false, error: "Puste zdjęcie" };

  const kb = Math.round(obraz.length / 1024);
  if (kb > config.zdjecia.uploadMaxKb) {
    /* Kolektor zmniejsza zdjęcie przed wysyłką (PhotoCapture, 1600 px), więc
       przekroczenie tej liczby znaczy, że coś poszło z jego pominięciem.
       Odmowa NAZYWA powód — „za duże" bez wskazówki zostawia człowieka bez
       wyjścia, a wyjście jest jedno: zrobić zdjęcie kolektorem. */
    return {
      ok: false,
      error:
        `Zdjęcie waży ${kb} kB, a maksimum to ${config.zdjecia.uploadMaxKb} kB. ` +
        "Zrób je jeszcze raz z karty towaru — kolektor zmniejsza obraz sam.",
    };
  }

  const mime = rozpoznajMime(obraz);
  if (mime !== "image/jpeg" && mime !== "image/png") {
    return { ok: false, error: "To nie jest zdjęcie JPEG ani PNG" };
  }
  return { ok: true, obraz, mime };
}

/* ── Podgląd ─────────────────────────────────────────────────────────────── */

export function zapiszPodglad(
  twId: number,
  oryginal: Buffer,
  mime: string,
  bezTla: Buffer | null
): string {
  posprzatajPodglady();
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO zdjecie_podglad(id, tw_id, bez_tla, oryginal, mime, utworzone_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run(id, twId, bezTla, oryginal, mime, nowIso());
  return id;
}

/** Podgląd albo `null`, gdy nie ma go, wygasł, albo dotyczy innego towaru. */
export function podglad(id: string, twId: number): ZdjeciePodgladu | null {
  const w = db()
    .prepare("SELECT * FROM zdjecie_podglad WHERE id = ? AND tw_id = ?")
    .get(id, twId) as
    | { id: string; tw_id: number; bez_tla: Uint8Array | null; oryginal: Uint8Array; mime: string; utworzone_at: string }
    | undefined;
  if (!w) return null;
  if (Date.now() - Date.parse(w.utworzone_at) > podgladMs()) {
    usunPodglad(id, twId);
    return null;
  }
  return {
    id: w.id,
    twId: w.tw_id,
    bezTla: w.bez_tla ? Buffer.from(w.bez_tla) : null,
    oryginal: Buffer.from(w.oryginal),
    mime: w.mime,
  };
}

export function usunPodglad(id: string, twId: number): boolean {
  return db().prepare("DELETE FROM zdjecie_podglad WHERE id = ? AND tw_id = ?").run(id, twId)
    .changes > 0;
}

/** Kasuje przeterminowane podglądy. Zwraca liczbę skasowanych. */
export function posprzatajPodglady(): number {
  const prog = new Date(Date.now() - podgladMs()).toISOString();
  return Number(
    db().prepare("DELETE FROM zdjecie_podglad WHERE utworzone_at < ?").run(prog).changes
  );
}

/* ── Zapisane zdjęcie ────────────────────────────────────────────────────── */

export function zapiszWlasne(dane: {
  twId: number;
  obraz: Buffer;
  mime: string;
  tloUsuniete: boolean;
  dodaneBy: string;
  dodaneByRef: number | null;
}): { etag: string; bajtow: number } {
  const etag = createHash("sha1").update(dane.obraz).digest("hex");
  db()
    .prepare(
      `INSERT INTO zdjecie_wlasne(tw_id, obraz, mime, bajtow, etag, tlo_usuniete,
                                  dodane_at, dodane_by, dodane_by_ref, queue_id, w_subiekcie_at)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL)
       ON CONFLICT(tw_id) DO UPDATE SET
         obraz = excluded.obraz, mime = excluded.mime, bajtow = excluded.bajtow,
         etag = excluded.etag, tlo_usuniete = excluded.tlo_usuniete,
         dodane_at = excluded.dodane_at, dodane_by = excluded.dodane_by,
         dodane_by_ref = excluded.dodane_by_ref, queue_id = NULL, w_subiekcie_at = NULL`
    )
    .run(
      dane.twId,
      dane.obraz,
      dane.mime,
      dane.obraz.length,
      etag,
      dane.tloUsuniete ? 1 : 0,
      nowIso(),
      dane.dodaneBy,
      dane.dodaneByRef
    );
  return { etag, bajtow: dane.obraz.length };
}

/**
 * Metadane BEZ OBRAZU — do rozstrzygnięcia, czy plik w cache'u jest aktualny.
 *
 * Osobno od `wlasneZdjecie`, bo `zapewnijZdjecie` woła się przy KAŻDYM wejściu
 * na kartę, także wtedy, gdy odpowiedzią będzie samo 304. Czytanie przy tym
 * blobu znaczyłoby 300 kB z bazy na odpowiedź o rozmiarze nagłówka — dokładnie
 * ten koszt, którego cały ten cache miał uniknąć.
 */
export function metaWlasnego(
  twId: number
): { twId: number; mime: string; bajtow: number; etag: string } | null {
  const w = db()
    .prepare("SELECT tw_id, mime, bajtow, etag FROM zdjecie_wlasne WHERE tw_id = ?")
    .get(twId) as { tw_id: number; mime: string; bajtow: number; etag: string } | undefined;
  return w ? { twId: w.tw_id, mime: w.mime, bajtow: w.bajtow, etag: w.etag } : null;
}

export function wlasneZdjecie(twId: number): ZdjecieWlasne | null {
  const w = db().prepare("SELECT * FROM zdjecie_wlasne WHERE tw_id = ?").get(twId) as
    | {
        tw_id: number;
        obraz: Uint8Array;
        mime: string;
        bajtow: number;
        etag: string;
        tlo_usuniete: number;
        dodane_at: string;
        dodane_by: string;
        queue_id: number | null;
        w_subiekcie_at: string | null;
      }
    | undefined;
  if (!w) return null;
  return {
    twId: w.tw_id,
    obraz: Buffer.from(w.obraz),
    mime: w.mime,
    bajtow: w.bajtow,
    etag: w.etag,
    tloUsuniete: w.tlo_usuniete === 1,
    dodaneAt: w.dodane_at,
    dodaneBy: w.dodane_by,
    queueId: w.queue_id,
    wSubiekcieAt: w.w_subiekcie_at,
  };
}

export function przypiszZadanie(twId: number, queueId: number): void {
  db().prepare("UPDATE zdjecie_wlasne SET queue_id = ? WHERE tw_id = ?").run(queueId, twId);
}

/**
 * Zapis do Subiekta NAPRAWDĘ wszedł — od tej chwili źródłem jest znowu Subiekt.
 *
 * Kasujemy wiersz, a nie tylko stemplujemy datę, i to jest sedno całej zapasowej
 * drogi: dopóki wiersz stoi, karta rysuje się z niego i nie pyta bazy firmy
 * o nic. Zostawienie go na zawsze znaczyłoby, że poprawka zdjęcia zrobiona
 * później w Subiekcie nigdy nie dotarłaby na kolektor.
 */
export function oznaczWSubiekcie(twId: number): void {
  db().prepare("DELETE FROM zdjecie_wlasne WHERE tw_id = ?").run(twId);
}

/** Ile zdjęć czeka na wejście do Subiekta — do `/api/health`. */
export function statystykiWlasnych(): { sztuk: number; bajtow: number } {
  const r = db()
    .prepare("SELECT COUNT(*) AS sztuk, COALESCE(SUM(bajtow),0) AS bajtow FROM zdjecie_wlasne")
    .get() as { sztuk: number; bajtow: number };
  return r;
}
