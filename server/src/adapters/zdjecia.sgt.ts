import fs from "node:fs";
import path from "node:path";
import sql from "mssql";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";

/* ── Zdjęcie kartoteki ze źródła — KAŻDA nazwa tabeli i kolumny to [WERYFIKUJ] ─
   Repozytorium NIE WIE, gdzie Subiekt GT trzyma obraz z zakładki „Opis":
   `docs/subiekt-gt-struktura.md` wylicza kolumny `tw__Towar` i żadnej binarnej
   wśród nich nie ma, a `tw_Opis` jest wszędzie traktowany jako czysty tekst
   (services/zamienniki.ts parsuje go po symbolach zamienników). Wartości ustala
   się na KOPII bazy zapytaniami z rozdziału „Gdzie Subiekt trzyma zdjęcie
   kartoteki" i wpisuje do wertis.env.

   Cały kontakt ze źródłem żyje w TYM pliku i to jest jego jedyny powód: gdy
   rozpoznanie zwróci co innego, niż zakładamy, zmienia się jeden plik, a nie
   trasa, cache, health i kolektor. Wzorzec: sfera-worker/src/SferaComAdapter.cs.

   Rozróżnienie, na którym stoi cały cache: `null` znaczy „ten towar zdjęcia NIE
   MA" (odpowiedź poprawna, ważna tygodniami), a wyjątek znaczy „nie dało się
   zapytać" (stan przejściowy, ponawiany po minutach). Zlanie ich w jedno
   zapisałoby awarię sieci jako trwały brak zdjęcia.                           */

export interface ZdjecieZrodlo {
  bajty: Buffer;
  /** Typ ROZPOZNANY z bajtów, nie zadeklarowany przez źródło. */
  mime: string;
}

/**
 * Ustawiane, gdy źródło odmawia (brak GRANT-u, brak tabeli, brak udziału).
 *
 * Czytane przez `/api/health` — bo objawem jest „karta bez zdjęcia", czyli
 * dokładnie to samo, co kartoteka bez zdjęcia. Bez tego zdania nikt by nie
 * skojarzył, że trzeba ponownie uruchomić skrypt uprawnień.
 * Wzorzec: `brakDostepuDoMagazynow` w subiekt.mssql.ts.
 */
export let brakDostepuDoZdjec: string | null = null;

/* Bezpiecznik: po tylu błędach z rzędu przestajemy pytać źródło aż do upływu
   `ZDJECIA_BLAD_TTL_MIN`. Bez niego zepsute źródło zamienia każde wejście na
   kartę w kilkusekundowy timeout — a to wygląda jak zawieszona aplikacja,
   nie jak brak zdjęć. */
const BLEDOW_DO_ODCIECIA = 3;
let bledowZRzedu = 0;
let odciecieDo = 0;

/** Ile bajtów wystarczy, żeby rozpoznać format. */
const NAGLOWEK = 16;

/**
 * Format z BAJTÓW, nie z deklaracji źródła.
 *
 * Kolumna binarna w bazie Subiekta może nieść kontener OLE albo dokument RTF
 * z obrazem w środku — jedno i drugie wysłane na kolektor daje pusty prostokąt
 * bez żadnego powodu na ekranie. Nierozpoznane = odrzucone, i to jest
 * odpowiedź uczciwsza niż „coś tam wysłaliśmy".
 *
 * BMP, GIF i TIFF przechodzą, choć nikt ich nie planuje: `BitmapFactory` na
 * kolektorze czyta wszystkie trzy, więc odrzucanie ich byłoby zgadywaniem
 * za magazyniera.
 */
export function rozpoznajMime(b: Buffer): string | null {
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return "image/tiff";
  return null;
}

/**
 * Nazwa pliku ze wzorca — `{symbol}` i `{twId}`.
 *
 * Symbol towaru bywa dowolnym łańcuchem z kartoteki (`W43-0506(K)`), więc
 * przechodzi przez `path.basename`: wzorzec ma nazywać PLIK, a nie ścieżkę,
 * i żaden symbol nie ma prawa wyprowadzić odczytu poza katalog.
 */
export function nazwaZeWzorca(wzorzec: string, twId: number, symbol: string): string {
  const wypelniony = wzorzec
    .replaceAll("{twId}", String(Math.trunc(twId)))
    .replaceAll("{symbol}", symbol);
  return path.basename(wypelniony);
}

/**
 * Zapytanie o zdjęcie po kluczu kartoteki.
 *
 * KARTOTEKA MOŻE MIEĆ KILKA ZDJĘĆ. Widać to wprost na zakładce „Opis"
 * w Subiekcie: obok podglądu stoją „Ustaw jako główną", „Sortuj" i strzałki
 * `<<` `>>`. Bierzemy więc GŁÓWNE, a przy równych — pierwsze wg kolejności
 * ustawionej w Subiekcie. Kolektor pokazuje jedno zdjęcie i ma to być to samo,
 * które biuro widzi jako główne.
 *
 * `ORDER BY` jest przez to OBOWIĄZKOWY, a nie kosmetyczny: `TOP 1` bez
 * porządku zwraca „cokolwiek", a za każdym razem inne bajty to za każdym razem
 * inny ETag — czyli wszystkie kolektory pobierają obraz od nowa przy każdym
 * wejściu na kartę, dokładnie odwrotnie niż cały ten cache zamierza. Gdy
 * kolumny głównej/kolejności nie ustawiono, porządkiem zostaje sam klucz —
 * arbitralny, ale STAŁY, a o to tu chodzi.
 *
 * Wydzielone z zapytania, bo to JEDYNA logika w tym module dająca się
 * przetestować bez serwera MSSQL (wzorzec: `budujFiltryDokumentow`).
 */
export function budujZapytanieBlob(opts: {
  tabela: string;
  kolumna: string;
  klucz: string;
  glowne?: string;
  kolejnosc?: string;
}): string {
  const t = assertSafeColumn(opts.tabela);
  const k = assertSafeColumn(opts.kolumna);
  const id = assertSafeColumn(opts.klucz);
  const porzadek = [
    // DESC, bo „główne" to zwykle 1/true, a ma iść pierwsze
    opts.glowne ? `${assertSafeColumn(opts.glowne)} DESC` : null,
    opts.kolejnosc ? assertSafeColumn(opts.kolejnosc) : null,
    id,
  ].filter(Boolean);
  return `SELECT TOP 1 ${k} AS bajty FROM ${t} WHERE ${id} = @id ORDER BY ${porzadek.join(", ")}`;
}

async function zBloba(twId: number): Promise<Buffer | null> {
  const c = config.zdjecia;
  const zapytanie = budujZapytanieBlob({
    tabela: c.tabela || "tw__Towar",
    kolumna: c.kolumna,
    klucz: c.kolumnaKlucza,
    glowne: c.kolumnaGlowne || undefined,
    kolejnosc: c.kolumnaKolejnosc || undefined,
  });
  const pool = await mssqlPool();
  const r = await pool.request().input("id", sql.Int, Math.trunc(twId)).query<{ bajty: Buffer | null }>(zapytanie);
  return r.recordset[0]?.bajty ?? null;
}

function zPliku(twId: number, symbol: string): Buffer | null {
  const c = config.zdjecia;
  const nazwa = nazwaZeWzorca(c.wzorzecPliku, twId, symbol);
  const plik = path.join(c.katalog, nazwa);
  if (!fs.existsSync(plik)) return null;
  return fs.readFileSync(plik);
}

/**
 * Zdjęcie JEDNEGO towaru prosto ze źródła — bez cache'u, bez zapisu na dysk.
 * Cache'owaniem zajmuje się `services/zdjecia.ts`; tutaj jest sam odczyt.
 *
 * @param symbol symbol kartoteki — używany wyłącznie przez źródło `plik`
 * @returns `null` gdy towar zdjęcia nie ma albo gdy bajty nie są obrazem
 * @throws gdy źródła nie dało się zapytać (brak GRANT-u, sieć, udział)
 */
export async function pobierzZeZrodla(twId: number, symbol: string): Promise<ZdjecieZrodlo | null> {
  const c = config.zdjecia;
  if (c.zrodlo === "") return null;

  if (Date.now() < odciecieDo) {
    throw new Error(brakDostepuDoZdjec ?? "Źródło zdjęć chwilowo odcięte po serii błędów");
  }

  let bajty: Buffer | null;
  try {
    bajty = c.zrodlo === "blob" ? await zBloba(twId) : zPliku(twId, symbol);
    bledowZRzedu = 0;
    brakDostepuDoZdjec = null;
  } catch (e) {
    const powod = e instanceof Error ? e.message : String(e);
    bledowZRzedu++;
    brakDostepuDoZdjec =
      c.zrodlo === "blob"
        ? `Nie da się odczytać zdjęć z bazy Subiekta (${powod}). Najczęstsza przyczyna: ` +
          "brak GRANT SELECT na tabelę ze zdjęciami — uruchom ponownie skrypt uprawnień " +
          "(DEPLOY §6) albo instalator z -TylkoKonfiguracja."
        : `Nie da się odczytać katalogu zdjęć ${c.katalog} (${powod}). Sprawdź, czy konto ` +
          "usługi wertis-api ma do niego dostęp.";
    if (bledowZRzedu >= BLEDOW_DO_ODCIECIA) {
      odciecieDo = Date.now() + c.bladTtlMin * 60_000;
      console.warn(`[zdjecia] ${BLEDOW_DO_ODCIECIA} błędy z rzędu — przerwa ${c.bladTtlMin} min`);
    }
    throw new Error(brakDostepuDoZdjec);
  }

  if (!bajty || bajty.length === 0) return null;
  const mime = rozpoznajMime(bajty.subarray(0, NAGLOWEK));
  if (!mime) {
    /* Nie błąd źródła — źródło odpowiedziało. To kartoteka niesie coś, co nie
       jest obrazem (kontener OLE, RTF, śmieci), i dla kolektora znaczy to
       dokładnie tyle samo, co brak zdjęcia. */
    console.warn(`[zdjecia] tw_id=${twId}: zawartość nie jest obrazem (${bajty.length} B) — pomijam`);
    return null;
  }
  return { bajty, mime };
}

/** Wyłącznie dla testów: kasuje bezpiecznik między przypadkami. */
export function zresetujBezpiecznik(): void {
  bledowZRzedu = 0;
  odciecieDo = 0;
  brakDostepuDoZdjec = null;
}
