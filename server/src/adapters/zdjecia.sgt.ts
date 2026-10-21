import fs from "node:fs";
import path from "node:path";
import sql from "mssql";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import { brakKolumnyKorekty } from "./subiekt.mssql.js";

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
  /* WebP: `RIFF....WEBP` — telefony z Androidem wysyłają go w Centrum
     Wiadomości, a `TYPY_PODGLADU` skrzynki obiecuje go od 0.218.0. Do tego
     wydania sygnatura go nie znała, więc podgląd po bajtach dawałby 415
     przy pliku, który przeglądarka narysuje. */
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  /* PDF: `%PDF-` na samym początku. Funkcja nazywa FORMAT, nie obiecuje
     obrazu — PDF rozpoznajemy dla podglądu dokumentu na osi rozmowy.
     Wołający, któremu wolno przyjąć tylko obraz, sprawdza typ sam
     (`wybierzObraz`, `typPodgladu`, zdjęcia z kolektora). */
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
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
 * wejściu na kartę, dokładnie odwrotnie niż cały ten cache zamierza.
 *
 * UWAGA NA OSTATNIE KRYTERIUM. Klucz dopisujemy na końcu jako rozstrzygnięcie
 * ostateczne, ale jest ono warte tyle, ile jego UNIKALNOŚĆ. Przy zdjęciach na
 * samej kartotece (`tw_Id`) klucz jest unikalny i wystarcza. W osobnej tabeli
 * (`tw_ZdjecieTw.zd_IdTowar`) klucz jest OBCY — ten sam dla wszystkich zdjęć
 * jednego towaru — więc niczego nie rozstrzyga i porządek trzeba domknąć
 * kolumną `kolejnosc` (dla `tw_ZdjecieTw` jest nią `zd_Id`). Pilnuje tego
 * walidacja w `config.ts`, bo objawem pomyłki byłby ruch sieciowy, a nie błąd.
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
  return `SELECT TOP ${KANDYDATOW} ${k} AS bajty FROM ${t} WHERE ${id} = @id ORDER BY ${porzadek.join(", ")}`;
}

/**
 * Ile zdjęć kartoteki bierzemy pod uwagę.
 *
 * Nie jedno, i to jest poprawka po zgłoszeniu z magazynu. Zakładka „Opis"
 * przyjmuje dowolną zawartość, więc GŁÓWNE zdjęcie bywa kontenerem OLE albo
 * metaplikiem — czymś, czego nie narysuje żaden kolektor. Przy `TOP 1` taka
 * kartoteka wyglądała na pozbawioną zdjęcia, choć obok leżały normalne JPEG-i.
 *
 * Liczba jest mała świadomie: to są BLOB-y, a pobranie pięciu skanów po kilka
 * megabajtów po to, żeby użyć jednego, kosztowałoby więcej niż problem, który
 * rozwiązuje.
 */
const KANDYDATOW = 3;

/**
 * Pierwszy kandydat, który JEST obrazem — w kolejności ustalonej przez bazę.
 *
 * Wydzielone, bo to jedyna część tej ścieżki dająca się sprawdzić bez MSSQL.
 * Rozmiar NIE jest tu kryterium: zdjęcie za duże to nadal właściwe zdjęcie
 * kartoteki i decyduje o nim `services/zdjecia.ts`, zdaniem, po którym dobiera
 * się `ZDJECIA_MAX_KB`. Podmiana na inne ukryłaby powód, dla którego główne
 * się nie pokazuje.
 */
export function wybierzObraz(kandydaci: Array<Buffer | null>, twId = 0): ZdjecieZrodlo | null {
  let odrzuconych = 0;
  for (const bajty of kandydaci) {
    if (!bajty || bajty.length === 0) continue;
    const mime = rozpoznajMime(bajty.subarray(0, NAGLOWEK));
    /* Tylko `image/*`: zakładka „Opis" przyjmuje też PDF, a `rozpoznajMime`
       go zna. PDF wysłany na kolektor to ten sam pusty prostokąt, co OLE. */
    if (mime?.startsWith("image/")) {
      if (odrzuconych > 0) {
        console.warn(
          `[zdjecia] tw_id=${twId}: pierwsze ${odrzuconych} zdjęć nie jest obrazem — biorę kolejne`
        );
      }
      return { bajty, mime };
    }
    odrzuconych++;
  }
  if (odrzuconych > 0) {
    /* Nie błąd źródła — źródło odpowiedziało. To kartoteka niesie coś, co nie
       jest obrazem (kontener OLE, RTF, śmieci), i dla kolektora znaczy to
       dokładnie tyle samo, co brak zdjęcia. */
    console.warn(`[zdjecia] tw_id=${twId}: żadne z ${odrzuconych} zdjęć nie jest obrazem — pomijam`);
  }
  return null;
}

async function zBloba(twId: number): Promise<Array<Buffer | null>> {
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
  return r.recordset.map((w) => w.bajty ?? null);
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

  let kandydaci: Array<Buffer | null>;
  try {
    kandydaci = c.zrodlo === "blob" ? await zBloba(twId) : [zPliku(twId, symbol)];
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

  return wybierzObraz(kandydaci, twId);
}

/** Wyłącznie dla testów: kasuje bezpiecznik między przypadkami. */
export function zresetujBezpiecznik(): void {
  bledowZRzedu = 0;
  odciecieDo = 0;
  brakDostepuDoZdjec = null;
}

/* ── Kartoteki BEZ zdjęcia — lista dla biura ────────────────────────────────
   Biuro dokłada zdjęcia z panelu i potrzebuje wiedzieć, KTÓRYM towarom ich
   brakuje. Pytamy Subiekt wprost, nie nasz cache: cache zna tylko kartoteki,
   które ktoś otworzył, więc lista z niego byłaby losową próbką. */

export interface TowarBezZdjecia {
  twId: number;
  symbol: string;
  nazwa: string;
  ean: string | null;
  /** Suma stanu ze wszystkich magazynów; 0, gdy towar nie ma wiersza w `tw_Stan`. */
  stan: number;
  /** Sztuki sprzedane na FS i PA w ostatnich `DNI_SPRZEDAZY` dniach. */
  sprzedaz: number;
}

/** Okno sprzedaży listy braków. Miesiąc pokazuje, co schodzi teraz, a nie w sezonie sprzed roku. */
export const DNI_SPRZEDAZY = 30;

/**
 * Porządek listy braków. Domyślnie wygrywa sprzedaż: zdjęcie towaru, który
 * schodzi co dzień, pracuje na każdej ofercie, a leżącego — na żadnej.
 */
export const SORTOWANIA_BEZ_ZDJECIA = ["sprzedaz", "stan", "symbol", "nazwa", "najnowsze"] as const;
export type SortBezZdjecia = (typeof SORTOWANIA_BEZ_ZDJECIA)[number];

/* Klauzule z tej mapy, nigdy z wejścia: nazwa sortowania przychodzi
   z adresu, a ORDER BY nie przyjmuje parametru. Każda domyka się `tw_Id`,
   bo stronicowanie bez pełnego porządku gubi i dubluje wiersze. */
const PORZADEK: Record<SortBezZdjecia, string> = {
  /* Remis w sprzedaży rozstrzyga stan: z dwóch równie chodliwych pierwszy
     ten, którego więcej leży na półce. */
  sprzedaz: "ISNULL(sp.sprzedaz, 0) DESC, ISNULL(s.stan, 0) DESC, t.tw_Symbol, t.tw_Id",
  stan: "ISNULL(s.stan, 0) DESC, t.tw_Symbol, t.tw_Id",
  symbol: "t.tw_Symbol, t.tw_Id",
  nazwa: "t.tw_Nazwa, t.tw_Id",
  /* tw_Id rośnie z każdą nową kartoteką, więc to najświeższe towary. */
  najnowsze: "t.tw_Id DESC",
};

/**
 * Warunek „ta kartoteka nie ma zdjęcia" dla skonfigurowanego źródła.
 *
 * Dwa kształty, bo zdjęcie siedzi albo w kolumnie samej kartoteki, albo
 * w osobnej tabeli z kluczem obcym. Wiersz z OLE zamiast obrazu liczy się
 * jako zdjęcie: odróżnić go można tylko po bajtach, a tu bajtów nie czytamy.
 */
function warunekBrakuZdjecia(opts: { tabela: string; kolumna: string; klucz: string }): string {
  const k = assertSafeColumn(opts.kolumna);
  if (!opts.tabela || opts.tabela === "tw__Towar") {
    return `(t.${k} IS NULL OR DATALENGTH(t.${k}) = 0)`;
  }
  const tab = assertSafeColumn(opts.tabela);
  const id = assertSafeColumn(opts.klucz);
  return `NOT EXISTS (SELECT 1 FROM ${tab} z WITH (NOLOCK) WHERE z.${id} = t.tw_Id)`;
}

/**
 * Pozycje sprzedaży z okna: FS i PA od `@odSprzedazy`, bez faktury do paragonu.
 *
 * Ta sama reguła co sprzedaż w przekroju towaru (`services/przekroj-towaru.ts`):
 * paragon wydał towar, a faktura do niego dodałaby te sztuki drugi raz. Parę
 * rozpoznajemy w obie strony, bo kierunek odnośnika jest `[WERYFIKUJ]`
 * (docs/subiekt-gt-struktura.md). Bez kolumny odnośnika para nie istnieje
 * i sprzedaż jest zawyżona o faktury do paragonów — jak w przekroju.
 *
 * Pozycje wiszą na `ob_DokHanId`: FS i PA są dokumentami handlowymi.
 */
export function zrodloSprzedazy(opts: { fs: number; pa: number; odnosnik?: string }): string {
  const fs = Number(opts.fs);
  const pa = Number(opts.pa);
  let warunek = `d.dok_Typ IN (${fs}, ${pa}) AND d.dok_DataWyst >= @odSprzedazy`;
  if (opts.odnosnik) {
    const o = assertSafeColumn(opts.odnosnik);
    warunek +=
      ` AND NOT (d.dok_Typ = ${fs} AND (` +
      `EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.dok_Id = d.${o} AND pa.dok_Typ = ${pa}) OR ` +
      `EXISTS (SELECT 1 FROM dok__Dokument pa WITH (NOLOCK) WHERE pa.${o} = d.dok_Id AND pa.dok_Typ = ${pa})))`;
  }
  return (
    "FROM dok_Pozycja p WITH (NOLOCK) JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId " +
    `WHERE ${warunek}`
  );
}

/**
 * Dwa zapytania: strona i liczba wszystkich. Osobno, bo `COUNT(*) OVER()`
 * na pustej stronie nie zwraca nic i panel straciłby licznik przy przewinięciu.
 *
 * Tylko `tw_Zablokowany = 0`, ten sam filtr co import kartoteki. Usług nie
 * wycinamy: import też ich nie wycina, a kolumny rodzaju repo nie potwierdziło.
 * Porządek domyka `tw_Id`, bo symbol nie musi być unikalny, a stronicowanie
 * bez pełnego porządku gubi i dubluje wiersze między stronami.
 */
export function budujZapytanieBezZdjecia(opts: {
  tabela: string;
  kolumna: string;
  klucz: string;
  zFiltrem: boolean;
  sortuj?: SortBezZdjecia;
  /** Tylko towary, które gdziekolwiek leżą — reszty i tak nie ma czym sfotografować. */
  naStanie?: boolean;
  /** Tylko towary sprzedane w oknie `DNI_SPRZEDAZY`. */
  sprzedane?: boolean;
  /** Kody dokumentów sprzedaży i kolumna odnośnika faktury do paragonu. */
  sprzedaz?: { fs: number; pa: number; odnosnik?: string };
}): { strona: string; razem: string } {
  const zrodlo = zrodloSprzedazy(opts.sprzedaz ?? { fs: 2, pa: 21 });
  const warunki = ["t.tw_Zablokowany = 0", warunekBrakuZdjecia(opts)];
  if (opts.zFiltrem) {
    warunki.push(
      "(t.tw_Symbol LIKE @q ESCAPE '!' OR t.tw_Nazwa LIKE @q ESCAPE '!' OR t.tw_PodstKodKresk LIKE @q ESCAPE '!')"
    );
  }
  if (opts.naStanie) {
    warunki.push("EXISTS (SELECT 1 FROM tw_Stan st WITH (NOLOCK) WHERE st.st_TowId = t.tw_Id AND st.st_Stan > 0)");
  }
  if (opts.sprzedane) {
    warunki.push(`EXISTS (SELECT 1 ${zrodlo} AND p.ob_TowId = t.tw_Id AND p.ob_IloscMag > 0)`);
  }
  const gdzie = `WHERE ${warunki.join(" AND ")}`;
  /* Stan sumowany po magazynach w podzapytaniu: złączenie wprost z tw_Stan
     mnożyłoby wiersze towaru przez liczbę magazynów. Licznik go nie
     potrzebuje, więc liczy bez złączenia. */
  const stan =
    "LEFT JOIN (SELECT st_TowId, SUM(st_Stan) AS stan FROM tw_Stan WITH (NOLOCK) GROUP BY st_TowId) s " +
    "ON s.st_TowId = t.tw_Id";
  /* Sprzedaż tak samo: suma w podzapytaniu, żeby pozycje wielu dokumentów
     nie mnożyły wierszy towaru. */
  const sprzedaz =
    `LEFT JOIN (SELECT p.ob_TowId, SUM(p.ob_IloscMag) AS sprzedaz ${zrodlo} GROUP BY p.ob_TowId) sp ` +
    "ON sp.ob_TowId = t.tw_Id";
  const porzadek = PORZADEK[opts.sortuj ?? "sprzedaz"] ?? PORZADEK.sprzedaz;
  return {
    strona:
      "SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, " +
      "t.tw_PodstKodKresk AS ean, ISNULL(s.stan, 0) AS stan, ISNULL(sp.sprzedaz, 0) AS sprzedaz " +
      `FROM tw__Towar t WITH (NOLOCK) ${stan} ${sprzedaz} ${gdzie} ` +
      `ORDER BY ${porzadek} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
    razem: `SELECT COUNT(*) AS razem FROM tw__Towar t WITH (NOLOCK) ${gdzie}`,
  };
}

/**
 * Wzorzec LIKE z tekstu wpisanego przez człowieka.
 *
 * `%`, `_` i `[` w symbolu to zwykłe znaki, nie wieloznaczniki. Bez ucieczki
 * wpisanie „W43_05" pasowałoby do „W43-05" i lista kłamałaby o trafieniu.
 * Znakiem ucieczki jest `!`, bo ukośnik wsteczny bywa w symbolach kartotek.
 */
export function wzorzecLike(q: string): string {
  return "%" + q.replace(/[!%_[]/g, (z) => "!" + z) + "%";
}

/** Strona kartotek bez zdjęcia prosto z Subiekta; wyjątek = nie dało się zapytać. */
export async function towaryBezZdjecia(z: {
  q: string;
  limit: number;
  offset: number;
  sortuj: SortBezZdjecia;
  naStanie: boolean;
  sprzedane: boolean;
}): Promise<{ razem: number; pozycje: TowarBezZdjecia[] }> {
  const c = config.zdjecia;
  const m = config.mssql;
  /* Odnośnik bierzemy tylko wtedy, gdy import faktur go znalazł. Kolumna,
     której nie ma, wywróciłaby całą listę błędem 207. */
  const odnosnik = m.korektaColumn && !brakKolumnyKorekty ? m.korektaColumn : undefined;
  const zapytania = budujZapytanieBezZdjecia({
    tabela: c.tabela,
    kolumna: c.kolumna,
    klucz: c.kolumnaKlucza,
    zFiltrem: z.q !== "",
    sortuj: z.sortuj,
    naStanie: z.naStanie,
    sprzedane: z.sprzedane,
    sprzedaz: { fs: m.dokTypFS, pa: m.dokTypPA, odnosnik },
  });
  const od = new Date(Date.now() - DNI_SPRZEDAZY * 86400_000).toISOString().slice(0, 10);
  const pool = await mssqlPool();
  const zapytanie = () => {
    const r = pool.request().input("odSprzedazy", sql.VarChar(10), od);
    if (z.q !== "") r.input("q", sql.NVarChar(200), wzorzecLike(z.q));
    return r;
  };
  const strona = await zapytanie()
    .input("offset", sql.Int, z.offset)
    .input("limit", sql.Int, z.limit)
    .query<{ twId: number; symbol: string; nazwa: string; ean: string | null; stan: number | null; sprzedaz: number | null }>(
      zapytania.strona
    );
  const razem = await zapytanie().query<{ razem: number }>(zapytania.razem);
  return {
    razem: Number(razem.recordset[0]?.razem ?? 0),
    pozycje: strona.recordset.map((w) => ({
      twId: w.twId,
      symbol: w.symbol,
      nazwa: w.nazwa,
      ean: w.ean && w.ean.trim() ? w.ean.trim() : null,
      /* st_Stan to decimal, a sterownik oddaje go jako liczbę albo tekst. */
      stan: Number(w.stan ?? 0) || 0,
      sprzedaz: Number(w.sprzedaz ?? 0) || 0,
    })),
  };
}

/* ── Dopasowanie symboli z nazw plików — import zdjęć z folderu ──────────────
   Biuro ma folder plików nazwanych symbolem towaru i pyta, które z nich da
   się przypiąć do kartoteki. Odczyt i nic więcej: zapis idzie potem po jednym
   zdjęciu, tą samą drogą co zatwierdzenie podglądu. */

/** Wiersz kartoteki trafionej po symbolu. Symbol jest taki, jak leży w Subiekcie. */
export interface TowarPoSymbolu {
  twId: number;
  symbol: string;
  nazwa: string;
  maZdjecie: boolean;
  zablokowany: boolean;
}

/* MSSQL przyjmuje najwyżej 2100 parametrów na zapytanie. 500 zostawia zapas
   i trzyma pojedyncze zapytanie krótkim. */
export const SYMBOLI_W_PACZCE = 500;

/* Dłuższy symbol i tak nie istnieje w kartotece. Parametr krótszy niż
   wartość uciąłby ją po cichu i dał fałszywe trafienie, więc dłuższe
   odrzuca serwis, zanim tu dojdą. */
export const DLUGOSC_SYMBOLU = 100;

/**
 * Zapytanie o kartoteki po liście symboli, parametry `@s0..@sN`.
 *
 * Porównanie zostawiamy kolacji bazy: Subiekt stoi na kolacji bez wielkości
 * liter, tak jak `COLLATE NOCASE` w naszym read-modelu. Przycinamy kolumnę,
 * bo import kartoteki nie przycina `tw_Symbol` (services/dopasowanie-sku.ts).
 * Brak zdjęcia liczy ten sam warunek co lista braków, żeby oba ekrany
 * nie mogły się rozjechać. Zablokowanych NIE wycinamy: biuro ma zobaczyć,
 * czemu plik nie trafi, zamiast „brak w Subiekcie".
 */
export function budujZapytanieDopasowania(opts: {
  tabela: string;
  kolumna: string;
  klucz: string;
  ile: number;
}): string {
  const ile = Math.trunc(opts.ile);
  if (!(ile >= 1 && ile <= SYMBOLI_W_PACZCE)) {
    throw new Error(`Paczka symboli musi mieć od 1 do ${SYMBOLI_W_PACZCE} pozycji`);
  }
  const parametry = Array.from({ length: ile }, (_, i) => `@s${i}`).join(", ");
  return (
    "SELECT t.tw_Id AS twId, t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa, " +
    `CASE WHEN ${warunekBrakuZdjecia(opts)} THEN 0 ELSE 1 END AS maZdjecie, ` +
    "CASE WHEN t.tw_Zablokowany = 1 THEN 1 ELSE 0 END AS zablokowany " +
    `FROM tw__Towar t WITH (NOLOCK) WHERE LTRIM(RTRIM(t.tw_Symbol)) IN (${parametry}) ` +
    "ORDER BY t.tw_Id"
  );
}

/** Dzieli listę na paczki mieszczące się w limicie parametrów. */
export function paczkiSymboli(symbole: string[], rozmiar = SYMBOLI_W_PACZCE): string[][] {
  const paczki: string[][] = [];
  for (let i = 0; i < symbole.length; i += rozmiar) paczki.push(symbole.slice(i, i + rozmiar));
  return paczki;
}

/** Kartoteki o podanych symbolach prosto z Subiekta; wyjątek = nie dało się zapytać. */
export async function towaryPoSymbolach(symbole: string[]): Promise<TowarPoSymbolu[]> {
  if (symbole.length === 0) return [];
  const c = config.zdjecia;
  const pool = await mssqlPool();
  const wynik: TowarPoSymbolu[] = [];
  for (const paczka of paczkiSymboli(symbole)) {
    const zapytanie = budujZapytanieDopasowania({
      tabela: c.tabela,
      kolumna: c.kolumna,
      klucz: c.kolumnaKlucza,
      ile: paczka.length,
    });
    const r = pool.request();
    paczka.forEach((s, i) => r.input(`s${i}`, sql.NVarChar(DLUGOSC_SYMBOLU), s));
    const w = await r.query<{ twId: number; symbol: string; nazwa: string; maZdjecie: number; zablokowany: number }>(
      zapytanie
    );
    for (const x of w.recordset) {
      wynik.push({
        twId: x.twId,
        symbol: x.symbol,
        nazwa: x.nazwa,
        maZdjecie: Number(x.maZdjecie) === 1,
        zablokowany: Number(x.zablokowany) === 1,
      });
    }
  }
  return wynik;
}
