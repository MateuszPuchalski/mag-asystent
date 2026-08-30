import sql from "mssql";
import { db, nowIso, transaction } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
import { numerKosza } from "../services/przyjecia.js";
import { symbolTypu } from "./typy-dokumentow.js";

/**
 * PRODUKCJA / edu — odczyt z bazy MSSQL Subiekta GT (spec §6, D2).
 *
 * Zamiast żywych SELECT-ów per żądanie (interfejs SubiektAdapter jest
 * synchroniczny, a driver `mssql` asynchroniczny) importujemy dane do
 * lokalnego read-modelu sgt_* — tych samych tabel, z których czyta
 * SeededSubiektAdapter. Import działa przy starcie API, co MSSQL_SYNC_MS
 * oraz na żądanie (POST /api/admin/resync). Stany na ekranie i tak są
 * korygowane o kolejkę (spec §5.1), więc krótki lag odświeżania jest
 * niewidoczny dla magazyniera.
 *
 * Login: read-only, GRANT SELECT wyłącznie na tw__Towar, tw_Stan,
 * dok__Dokument, dok_Pozycja, kh__Kontrahent.
 * Nazwy tabel i kolumn są zweryfikowane wprost z oficjalnego opisu struktury
 * InsERT GT dla wersji bazy 1.8731.31.6933 — patrz docs/subiekt-gt-struktura.md.
 * Zostaje do ustalenia na własnej bazie tylko to, czego dokumentacja nie
 * zawiera: id magazynów.
 *
 * UWAGA: nowsze wersje SGT (z polami KSeF) NIE MAJĄ natywnej kolumny
 * tw_Lokalizacja na tw__Towar — lokalizację trzyma się w jednym z ośmiu pól
 * własnych tw_Pole1..tw_Pole8 (varchar(50) każde, potwierdzone w strukturze);
 * który konkretnie, ustala się przy zakładaniu kartotek (env MSSQL_LOC_COLUMN,
 * domyślnie tw_Pole1).
 */

/**
 * Dokumenty dostaw, których NIE ROZŁOŻONO do końca — ich `dok_Id` po stronie
 * Subiekta.
 *
 * Okno importu obcina dokumenty po dacie wystawienia, ale niedokończona praca
 * nie ma prawa zniknąć z ekranu tylko dlatego, że dostawa przyjechała trzy
 * tygodnie temu. Brak dokumentu na liście wygląda przecież identycznie jak
 * dokument rozłożony — a to dwie zupełnie różne sytuacje.
 *
 * Stan „niedokończona" jest po NASZEJ stronie: Subiekt nie wie nic o postępie
 * rozkładania. Stąd odczyt z SQLite przed zapytaniem do MSSQL.
 */
function otwarteDokumenty(): number[] {
  return (
    db()
      .prepare("SELECT sgt_dok_id FROM delivery WHERE status = 'open'")
      .all() as Array<{ sgt_dok_id: number }>
  ).map((r) => Math.trunc(r.sgt_dok_id));
}

/**
 * Fragmenty `WHERE` dla zapytania o dokumenty. Wydzielone z zapytania, bo to
 * JEDYNA logika w tym imporcie — reszta jest wejściem/wyjściem, którego bez
 * serwera MSSQL nie da się przetestować.
 *
 * @param typy      kody `dok_Typ` uznawane za dostawę (`DOK_TYPY_DOSTAW`)
 * @param otwarte   `dok_Id` dostaw nierozłożonych do końca — wchodzą niezależnie
 *                  od okna dat
 */
export function budujFiltryDokumentow(
  typy: number[],
  otwarte: number[]
): { dostawyTypFilter: string; oknoFilter: string } {
  /* Pusta lista typów znaczy „ŻADEN typ", a nie „każdy". Literówka w ustawieniu
     ma dać pustą listę pracy — zauważalną od razu — a nie wpuścić na ekran
     magazyniera wszystkiego, co leży na magazynie. */
  const dostawyTypFilter = `d.dok_Typ IN (${
    typy.length ? typy.map((n) => Math.trunc(n)).join(",") : "NULL"
  })`;

  /* Przy braku otwartych dostaw CAŁA gałąź `OR` znika, bo `IN ()` jest błędem
     składni SQL, a nie zbiorem pustym — zapytanie wywaliłoby się w całości. */
  const oknoFilter = otwarte.length
    ? `(d.dok_DataWyst >= @cutoff OR d.dok_Id IN (${otwarte.map((n) => Math.trunc(n)).join(",")}))`
    : "d.dok_DataWyst >= @cutoff";

  return { dostawyTypFilter, oknoFilter };
}

/**
 * Okno importu zamówień do dostawcy [dni] — WŁASNE, szersze niż dla dostaw.
 * Zamówienie bywa starsze niż dwa miesiące i wciąż otwarte, a jest ich o rząd
 * wielkości mniej niż dokumentów, więc szersze okno nic nie kosztuje.
 */
const ZAM_IMPORT_DAYS = 180;

interface TowarRow {
  tw_Id: number;
  tw_Symbol: string;
  tw_Nazwa: string;
  tw_PodstKodKresk: string | null;
  tw_JednMiary: string | null;
  tw_Opis: string | null;
  tw_Lokalizacja: string | null;
}
interface StanRow {
  st_TowId: number;
  st_MagId: number;
  st_Stan: number;
  st_StanRez: number;
}
interface DokRow {
  dok_Id: number;
  dok_Typ: number;
  dok_NrPelny: string;
  data_wyst: string;
  dok_MagId: number;
  dostawca: string | null;
  /* Identyfikator kontrahenta — do 0.56.0 stał w JOIN-ie i był wyrzucany.
     Po nim, a nie po nazwie, przypina się logo dostawcy: symbol w Subiekcie
     wolno poprawić, a ta sama firma potrafi wystąpić pod dwoma napisami. */
  kh_id: number | null;
  w_buforze: number;
}
interface PozRow {
  ob_DokHanId: number;
  ob_TowId: number;
  ob_IloscMag: number;
}

interface ZamRow {
  dok_Id: number;
  dok_NrPelny: string;
  data_wyst: string;
  termin: string | null;
  dok_Status: number;
  dostawca: string | null;
}
interface ZamPozRow {
  ob_DokHanId: number;
  ob_TowId: number;
  ob_IloscMag: number;
  zreal: number;
}

export interface ImportStats {
  towary: number;
  stany: number;
  dokumenty: number;
  pozycje: number;
  zamowienia: number;
  zamPozycje: number;
  /* Przyjęcia na regał zwrotów. Obie liczby stoją tu po to, żeby dało się
     odróżnić „dziś nie było przesunięć" od „dokumenty są, pozycji nie ma" —
     na ekranie kolektora oba wyglądają tak samo, a znaczą co innego. */
  mm: number;
  mmPozycje: number;
  at: string;
}

/** Znacznik ostatniego udanego importu (do /api/health). */
export let lastImport: ImportStats | null = null;

/**
 * Ustawiane, gdy login nie ma `GRANT SELECT ON dbo.sl_Magazyn`.
 *
 * Czytane przez `/api/health` — bo objawem braku uprawnienia jest „karta
 * pokazuje tylko trzy magazyny", czyli dokładnie to, co było przed zmianą.
 * Bez tego komunikatu nikt by nie skojarzył, że trzeba ponownie uruchomić
 * skrypt uprawnień.
 */
export let brakDostepuDoMagazynow: string | null = null;

/**
 * Ustawiane, gdy `dok_Pozycja` nie ma kolumny z ilością zrealizowaną
 * (`MSSQL_ZD_ZREAL_COLUMN`).
 *
 * Czytane przez `/api/health` i przenoszone na kartę jako `szacunek`. Bez tej
 * kolumny zamówienie zrealizowane w połowie pokazuje pełną ilość — magazynier
 * musi wiedzieć, że liczba jest górnym oszacowaniem, a nie tym, co przyjedzie.
 */
export let brakKolumnyZrealizowano: string | null = null;

/** Czy ostatni import umiał odczytać ilość zrealizowaną. Czyta serwis karty. */
export const zrealWiarygodne = () => brakKolumnyZrealizowano === null;

/**
 * Odczyt przesunięć MM na regał zwrotów padł — zdanie do `/api/health`.
 * Degraduje tak samo jak sprzedaż: zostaje ostatni udany odczyt, a zakładka
 * ZWROTY na kolektorze pokazuje to, co widziała przy poprzedniej synchronizacji.
 */
export let bladImportuMm: string | null = null;

/**
 * Dokumenty MM weszły, pozycji nie ma ani jednej.
 *
 * Dokładnie ten stan wystąpił po wdrożeniu 0.75.0 i był NIEWIDOCZNY: kolektor
 * pokazywał kosze z zerem pozycji, co wygląda jak spokojny dzień bez zwrotów.
 * Zero pozycji przy niezerowej liczbie dokumentów nie zdarza się naturalnie —
 * przesunięcie bez pozycji nie ma po co powstać.
 */
export function zdaniePrzyjecBezPozycji(mm: number, mmPozycje: number): string | null {
  if (mm === 0 || mmPozycje > 0) return null;
  return (
    `Import widzi ${mm} przesunięć MM na regał zwrotów, ale ZERO ich pozycji — ` +
    "kosze na kolektorze będą puste. Sprawdź kolumnę łączącą pozycje " +
    "z dokumentem magazynowym (ob_DokMagId, DEPLOY §6a)."
  );
}

/** To samo zdanie na danych ostatniego importu — wersja dla `/api/health`. */
export function przyjeciaBezPozycji(): string | null {
  if (config.sgtMode !== "mssql" || !lastImport) return null;
  return zdaniePrzyjecBezPozycji(lastImport.mm, lastImport.mmPozycje);
}

interface MagRow {
  mag_Id: number;
  mag_Symbol: string;
  mag_Nazwa: string;
}

async function pobierzMagazyny(pool: sql.ConnectionPool): Promise<MagRow[]> {
  try {
    const r = await pool
      .request()
      .query<MagRow>("SELECT mag_Id, mag_Symbol, mag_Nazwa FROM sl_Magazyn");
    brakDostepuDoMagazynow = null;
    return r.recordset;
  } catch (e) {
    /* Degradacja do stanu sprzed zmiany: trzy magazyny z konfiguracji, bez
       nazw ze słownika. Aplikacja działa dalej — traci tylko zestawienie
       „gdzie jeszcze leży". */
    brakDostepuDoMagazynow =
      "Brak GRANT SELECT na sl_Magazyn — karta towaru pokazuje tylko MAG, MGP " +
      "i Zwroty. Uruchom ponownie skrypt uprawnień (DEPLOY §6) albo instalator " +
      "z -TylkoKonfiguracja.";
    console.warn(`[mssql] ${brakDostepuDoMagazynow} (${e instanceof Error ? e.message : e})`);
    return [
      { mag_Id: config.magId.MAG, mag_Symbol: "MAG", mag_Nazwa: "Magazyn główny" },
      { mag_Id: config.magId.MGP, mag_Symbol: "MGP", mag_Nazwa: "Strefa przyjęć" },
      { mag_Id: config.magId.ZWROTY, mag_Symbol: "ZWROTY", mag_Nazwa: "Zwroty od klientów" },
    ];
  }
}

/**
 * Otwarte zamówienia do dostawcy wraz z pozycjami.
 *
 * Te same tabele co reszta importu (`dok__Dokument`, `dok_Pozycja`,
 * `kh__Kontrahent`), więc ZERO nowych GRANT-ów — konsekwencja tego, że adapter
 * MSSQL jest wyłącznie importerem, a odczyty idą przez read-model.
 */
async function pobierzZamowienia(
  pool: sql.ConnectionPool
): Promise<{ zamowienia: ZamRow[]; zamPozycje: ZamPozRow[] }> {
  const c = config.mssql;
  const statusy = c.dokStatusyZDOtwarte.map((n) => Math.trunc(n));
  if (statusy.length === 0) return { zamowienia: [], zamPozycje: [] };

  const terminSelect = c.zdTerminColumn
    ? `CONVERT(varchar(10), d.${assertSafeColumn(c.zdTerminColumn)}, 120)`
    : "NULL";
  const cutoff = new Date(Date.now() - ZAM_IMPORT_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);

  const zamowienia = (
    await pool
      .request()
      .input("zd", sql.Int, c.dokTypZD)
      .input("cutoff", sql.VarChar, cutoff)
      .query<ZamRow>(
        `SELECT d.dok_Id, d.dok_NrPelny,
                CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
                ${terminSelect} AS termin,
                d.dok_Status,
                ISNULL(k.kh_Symbol, '') AS dostawca
         FROM dok__Dokument d
         LEFT JOIN kh__Kontrahent k ON k.kh_Id = d.dok_PlatnikId
         WHERE d.dok_Typ = @zd
           AND d.dok_Status IN (${statusy.join(",")})
           AND d.dok_DataWyst >= @cutoff`
      )
  ).recordset;

  if (zamowienia.length === 0) return { zamowienia, zamPozycje: [] };
  const ids = zamowienia.map((z) => z.dok_Id).join(",");

  /* Ilość zrealizowana: najpierw z kolumną, a gdy jej nie ma — DRUGIE PODEJŚCIE
     bez niej. Wyjątek nie może tu wywrócić całej synchronizacji, bo stany
     i lokalizacje są ważniejsze od zamówień; ale nie może też przejść bez echa,
     stąd komunikat czytany przez /api/health. */
  if (c.zdZrealColumn) {
    const zrealCol = assertSafeColumn(c.zdZrealColumn);
    try {
      const zamPozycje = (
        await pool.request().query<ZamPozRow>(
          `SELECT ob_DokHanId, ob_TowId, ob_IloscMag, ${zrealCol} AS zreal
           FROM dok_Pozycja WHERE ob_DokHanId IN (${ids})`
        )
      ).recordset;
      brakKolumnyZrealizowano = null;
      return { zamowienia, zamPozycje };
    } catch (e) {
      brakKolumnyZrealizowano =
        `Kolumna ${zrealCol} nie istnieje w dok_Pozycja — zamówienia u dostawcy ` +
        "pokazują ilość ZAMÓWIONĄ, bez odjęcia już odebranej. Sprawdź nazwę " +
        "kolumny na własnej bazie i ustaw MSSQL_ZD_ZREAL_COLUMN (DEPLOY §6).";
      console.warn(
        `[mssql] ${brakKolumnyZrealizowano} (${e instanceof Error ? e.message : e})`
      );
    }
  } else {
    brakKolumnyZrealizowano = null; // puste = świadoma rezygnacja, nie awaria
  }

  const zamPozycje = (
    await pool.request().query<ZamPozRow>(
      `SELECT ob_DokHanId, ob_TowId, ob_IloscMag, 0 AS zreal
       FROM dok_Pozycja WHERE ob_DokHanId IN (${ids})`
    )
  ).recordset;
  return { zamowienia, zamPozycje };
}

/**
 * Dokumenty sprzedaży (FS/PA) z pozycjami — do dopasowywania zwrotów Allegro.
 *
 * Te same tabele co reszta importu (`dok__Dokument`, `dok_Pozycja`,
 * `kh__Kontrahent`), więc ZERO nowych GRANT-ów.
 *
 * SKALA JEST TU INNA NIŻ PRZY DOSTAWACH i wymusiła dwa odstępstwa (0.53.1):
 *
 * 1. Pozycje idą JOIN-em z tymi samymi filtrami co nagłówki, NIE listą
 *    `IN (id, id, …)`. Okno 90 dni sprzedaży to dziesiątki tysięcy dok_Id;
 *    lista tej długości położyła wdrożenie 0.53.0 błędem 8623 („query
 *    processor ran out of internal resources") na przemian z timeoutem 15 s —
 *    a że import startowy jest twardym błędem, API weszło w pętlę restartów.
 *    Wzorzec `IN` zostaje przy dostawach/zamówieniach, gdzie dokumentów są
 *    dziesiątki, nie tysiące.
 * 2. `WITH (NOLOCK)` na obu zapytaniach: to zasilanie read-modelu odświeżanego
 *    co 60 s, brudny odczyt niczego nie psuje — a w dzienniku wdrożenia był
 *    deadlock z Subiektem pracującym obok na tych samych tabelach.
 *
 * Kolumny `nr_oryg` i `uwagi` są OPCJONALNE i konfigurowalne: która z nich
 * niesie numer zamówienia Allegro (jeśli którakolwiek), wie tylko własna baza
 * ([WERYFIKUJ], DEPLOY §6). Nieistniejąca kolumna nie może wywrócić całej
 * synchronizacji — stany i lokalizacje są ważniejsze — więc drugie podejście
 * idzie bez obu, a przyczyna melduje się w /api/health (wzorzec `zdZrealColumn`).
 */
interface MmZwrotRow {
  dok_Id: number;
  dok_NrPelny: string;
  data_wyst: string;
  mag_z: number | null;
  mag_do: number | null;
}
interface MmPozRow {
  dok_id: number;
  ob_TowId: number;
  ob_IloscMag: number;
  symbol: string | null;
  nazwa: string | null;
}

/**
 * Zapytanie o pozycje przesunięcia MM.
 *
 * Wydzielone jak `budujFiltryDokumentow` — po to, żeby JEDNĄ rzecz, która się
 * tu psuje, dało się sprawdzić testem bez serwera MSSQL. Ta rzecz to kolumna
 * łącząca: MM jest dokumentem MAGAZYNOWYM, więc pozycje wiszą na
 * `ob_DokMagId`. Do 0.76.1 stało tu `ob_DokHanId` przepisane z zapytania
 * o sprzedaż — kolumna dokumentu HANDLOWEGO, której MM nie ma. JOIN nie łapał
 * ani jednego wiersza, a każdy kosz na kolektorze pokazywał zero pozycji.
 *
 * POTWIERDZONE na bazie firmy (sierpień 2026): pozycje MM mają `ob_DokHanId`
 * ustawione na NULL, a `ob_DokMagId` na identyfikator przesunięcia.
 *
 * `LEFT JOIN tw__Towar` niesie symbol i nazwę wprost z Subiekta. Importer
 * kartotek pomija towary zablokowane, a na regale zwrotów leży właśnie towar
 * wycofany ze sprzedaży — bez tego snapshotu pozycja miałaby w koszu sam
 * identyfikator zamiast nazwy.
 */
export function zapytaniePozycjiMm(gdzie: string): string {
  return `SELECT p.ob_DokMagId AS dok_id, p.ob_TowId, p.ob_IloscMag,
                 t.tw_Symbol AS symbol, t.tw_Nazwa AS nazwa
          FROM dok_Pozycja p WITH (NOLOCK)
          JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokMagId
          LEFT JOIN tw__Towar t WITH (NOLOCK) ON t.tw_Id = p.ob_TowId
          WHERE ${gdzie}`;
}

/**
 * Przesunięcia MM NA regał zwrotów — dokumenty, których numery magazyn pisze
 * odręcznie na koszach („1209").
 *
 * Kierunek bierzemy z dwóch kolumn opisanych w docs/subiekt-gt-struktura.md:
 * `dok_MagId` to magazyn ŹRÓDŁOWY, a `dok_OdbiorcaId` „dla MM oznacza
 * identyfikator magazynu" docelowego — i to po nim filtrujemy. `[WERYFIKUJ]`
 * na własnej bazie: pomyłka w tę stronę daje pustą listę przyjęć, a nie złe
 * dane, bo nic stąd nie idzie do zapisu.
 */
async function pobierzMmZwrotow(
  pool: sql.ConnectionPool
): Promise<{ mm: MmZwrotRow[]; mmPozycje: MmPozRow[] }> {
  const c = config.mssql;
  const cutoff = new Date(Date.now() - c.mmZwrotyDniWstecz * 86400_000)
    .toISOString()
    .slice(0, 10);
  const gdzie =
    "d.dok_Typ = @typ AND d.dok_OdbiorcaId = @magZwrotow AND d.dok_DataWyst >= @cutoff";
  const req = () =>
    pool
      .request()
      .input("typ", sql.Int, c.dokTypMM)
      .input("magZwrotow", sql.Int, config.magId.ZWROTY)
      .input("cutoff", sql.VarChar, cutoff);

  const mm = (
    await req().query<MmZwrotRow>(
      `SELECT d.dok_Id, d.dok_NrPelny,
              CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
              d.dok_MagId AS mag_z, d.dok_OdbiorcaId AS mag_do
       FROM dok__Dokument d WITH (NOLOCK)
       WHERE ${gdzie}`
    )
  ).recordset;
  if (mm.length === 0) return { mm, mmPozycje: [] };

  const mmPozycje = (await req().query<MmPozRow>(zapytaniePozycjiMm(gdzie))).recordset;
  return { mm, mmPozycje };
}

export async function importFromMssql(): Promise<ImportStats> {
  const pool = await mssqlPool();
  const c = config.mssql;
  // nowsze SGT nie mają natywnego tw_Lokalizacja — alias na skonfigurowane
  // pole dodatkowe (domyślnie tw_Pole1), żeby reszta kodu widziała stałą nazwę
  const locCol = assertSafeColumn(c.locColumn);

  const towary = (
    await pool.request().query<TowarRow>(
      `SELECT tw_Id, tw_Symbol, tw_Nazwa, tw_PodstKodKresk, tw_JednMiary,
              tw_Opis, ${locCol} AS tw_Lokalizacja
       FROM tw__Towar
       WHERE tw_Zablokowany = 0`
    )
  ).recordset;

  /* Magazyny ze słownika. NOWY GRANT: `GRANT SELECT ON dbo.sl_Magazyn`.
     Instalacja sprzed lipca 2026 go NIE MA, a `git pull` nie ma prawa jej
     wywrócić — dlatego brak uprawnienia degraduje import do dawnego
     zachowania (trzy magazyny z konfiguracji) i melduje się zdaniem
     w /api/health, zamiast przerywać synchronizację. */
  const magazyny = await pobierzMagazyny(pool);

  /* Stany WSZYSTKICH magazynów, nie tylko trzech z rolami. Wcześniejszy filtr
     `st_MagId IN (@mag,@mgp,@zw)` sprawiał, że reszta nigdy nie trafiała do
     read-modelu — karta towaru fizycznie nie miała skąd wziąć informacji, że
     towar leży gdzie indziej. Przy 3415 kartotekach i kilku magazynach to
     nadal kilkadziesiąt tysięcy wierszy, czyli dla SQLite nic. */
  const stany = (
    await pool.request().query<StanRow>(
      `SELECT st_TowId, st_MagId, st_Stan, st_StanRez FROM tw_Stan`
    )
  ).recordset;

  // dostawca: kh_Symbol jest pewny w każdej wersji SGT; pełna nazwa siedzi w
  // adr__Ekran (adr_NazwaPelna) — podmiana opisana w docs/subiekt-gt-edu-setup.md
  //
  const { dostawyTypFilter, oknoFilter } = budujFiltryDokumentow(
    c.dokTypyDostaw,
    otwarteDokumenty()
  );
  const dokumenty = (
    await pool
      .request()
      .input("mag", sql.Int, config.magId.MAG)
      .input("mgp", sql.Int, config.magId.MGP)
      .input("cutoff", sql.VarChar, new Date(Date.now() - c.dokDniWstecz * 86400_000).toISOString().slice(0, 10))
      .query<DokRow>(
        `SELECT d.dok_Id, d.dok_Typ, d.dok_NrPelny,
                CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
                d.dok_MagId,
                ISNULL(k.kh_Symbol, '') AS dostawca,
                k.kh_Id AS kh_id,
                ${c.bufferExpr} AS w_buforze
         FROM dok__Dokument d
         LEFT JOIN kh__Kontrahent k ON k.kh_Id = d.dok_PlatnikId
         -- Dostawy krajowe (MAG) i kontenery (MGP) idą jedną listą i jedną
         -- ścieżką rozkładania. Magazyn skutku mówi już tylko tyle, że po
         -- kontenerze zostaje jeszcze przesunięcie stanu na halę.
         WHERE d.dok_MagId IN (@mag, @mgp) AND ${dostawyTypFilter}
           AND ${oknoFilter}`
      )
  ).recordset;

  const pozycje = dokumenty.length
    ? (
        await pool.request().query<PozRow>(
          `SELECT ob_DokHanId, ob_TowId, ob_IloscMag
           FROM dok_Pozycja WHERE ob_DokHanId IN (${dokumenty.map((d) => d.dok_Id).join(",")})`
        )
      ).recordset
    : [];

  const { zamowienia, zamPozycje } = await pobierzZamowienia(pool);

  /* Przyjęcia na regał zwrotów degradują, nie przerywają importu: stany
     i lokalizacje są ważniejsze, a zakładka ZWROTY na kolektorze woli
     wczorajszą listę niż pustą. `mmOk` steruje też czyszczeniem niżej. */
  let mm: MmZwrotRow[] = [];
  let mmPozycje: MmPozRow[] = [];
  let mmOk = false;
  try {
    ({ mm, mmPozycje } = await pobierzMmZwrotow(pool));
    mmOk = true;
    bladImportuMm = null;
  } catch (e) {
    bladImportuMm =
      "Odczyt przesunięć MM na regał zwrotów nie powiódł się — zakładka ZWROTY " +
      "pokazuje dane z ostatniej udanej synchronizacji. Sprawdź MAG_ID_ZWROTY " +
      "i kolumnę dok_OdbiorcaId (DEPLOY §6a). " +
      `Przyczyna: ${e instanceof Error ? e.message : e}`;
    console.warn(`[mssql] ${bladImportuMm}`);
  }

  // ── wpis do read-modelu sgt_* (wzorzec wipe+insert z seed.ts) ─────────────
  const d = db();
  const knownTw = new Set(towary.map((t) => t.tw_Id));

  const insTowar = d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja)
     VALUES (@tw_id,@symbol,@nazwa,@ean,@unit,@opis,@lokalizacja)`
  );
  const insStan = d.prepare(
    "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)"
  );
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, kh_id, w_buforze)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insPoz = d.prepare(
    "INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)"
  );
  const insZam = d.prepare(
    `INSERT INTO sgt_zamowienie(dok_id, nr_pelny, data_wyst, termin, dostawca)
     VALUES (?,?,?,?,?)`
  );
  const insZamPoz = d.prepare(
    "INSERT INTO sgt_zam_pozycja(dok_id, tw_id, ilosc, zreal) VALUES (?,?,?,?)"
  );
  const insMm = d.prepare(
    `INSERT INTO sgt_mm_zwrot(dok_id, nr_pelny, numer, data_wyst, mag_z, mag_do)
     VALUES (?,?,?,?,?,?)`
  );
  const insMmPoz = d.prepare(
    "INSERT INTO sgt_mm_zwrot_pozycja(dok_id, tw_id, ilosc, symbol, nazwa) VALUES (?,?,?,?,?)"
  );

  const apply = transaction(d, () => {
    /* Kolejność ma znaczenie: pozycje przed nagłówkami, bo trzyma je klucz obcy.
       Na tej liście stoi WYŁĄCZNIE read-model sgt_* — tabele aplikacji
       (kosz, kosz_pozycja, allegro_token, ean_alias…) nie mają tu wstępu:
       import zaorałby wiedzę, której Subiekt nie ma.
       sgt_mm_zwrot* czyszczone tylko przy udanym odczycie — patrz `mmOk`. */
    for (const t of [
      ...(mmOk ? ["sgt_mm_zwrot_pozycja", "sgt_mm_zwrot"] : []),
      "sgt_zam_pozycja", "sgt_zamowienie",
      "sgt_pozycja", "sgt_dokument", "sgt_stan", "sgt_towar", "sgt_magazyn",
    ]) {
      d.prepare(`DELETE FROM ${t}`).run();
    }
    const insMag = d.prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
    for (const m of magazyny) {
      insMag.run(m.mag_Id, (m.mag_Symbol ?? "").trim() || `MAG${m.mag_Id}`, (m.mag_Nazwa ?? "").trim());
    }

    for (const t of towary) {
      insTowar.run({
        tw_id: t.tw_Id,
        symbol: t.tw_Symbol ?? "",
        nazwa: t.tw_Nazwa ?? "",
        ean: t.tw_PodstKodKresk ?? "",
        unit: t.tw_JednMiary || "szt.",
        opis: t.tw_Opis ?? "",
        lokalizacja: t.tw_Lokalizacja ?? "",
      });
    }
    for (const s of stany) {
      if (!knownTw.has(s.st_TowId)) continue;
      insStan.run(s.st_TowId, s.st_MagId, s.st_Stan ?? 0, s.st_StanRez ?? 0);
    }
    for (const doc of dokumenty) {
      const typ = symbolTypu(doc.dok_Typ);
      insDok.run(
        doc.dok_Id,
        typ,
        doc.dok_NrPelny,
        doc.data_wyst,
        doc.dok_MagId,
        doc.dostawca ?? "",
        doc.kh_id ?? null,
        doc.w_buforze ? 1 : 0
      );
    }
    for (const p of pozycje) {
      if (!knownTw.has(p.ob_TowId)) continue;
      insPoz.run(p.ob_DokHanId, p.ob_TowId, p.ob_IloscMag ?? 0);
    }
    for (const z of zamowienia) {
      insZam.run(
        z.dok_Id,
        z.dok_NrPelny,
        z.data_wyst,
        z.termin || null,
        z.dostawca ?? ""
      );
    }
    for (const p of zamPozycje) {
      if (!knownTw.has(p.ob_TowId)) continue;
      insZamPoz.run(p.ob_DokHanId, p.ob_TowId, p.ob_IloscMag ?? 0, p.zreal ?? 0);
    }
    for (const m of mm) {
      insMm.run(
        m.dok_Id,
        m.dok_NrPelny,
        /* Sama liczba z numeru — TO ONA jest napisana na kartce przy koszu.
           Liczona przy imporcie, żeby skan nie parsował numeru za każdym razem. */
        numerKosza(m.dok_NrPelny),
        m.data_wyst,
        m.mag_z ?? null,
        m.mag_do ?? null
      );
    }
    /* BEZ filtra `knownTw` — świadomie, inaczej niż przy dostawach. Towar
       zablokowany w kartotece nie wchodzi do importu, ale FIZYCZNIE leży
       w koszu i magazynier musi go odłożyć. Pominięcie wiersza dawało kosz
       krótszy niż papier przy nim, w dodatku bez śladu. */
    for (const p of mmPozycje) {
      insMmPoz.run(
        p.dok_id,
        p.ob_TowId,
        Math.abs(p.ob_IloscMag ?? 0),
        p.symbol ?? "",
        p.nazwa ?? ""
      );
    }
  });
  apply();

  lastImport = {
    towary: towary.length,
    stany: stany.length,
    dokumenty: dokumenty.length,
    pozycje: pozycje.length,
    zamowienia: zamowienia.length,
    zamPozycje: zamPozycje.length,
    mm: mm.length,
    mmPozycje: mmPozycje.length,
    at: nowIso(),
  };
  console.log(
    `[mssql] import: towary=${lastImport.towary}, stany=${lastImport.stany}, ` +
      `dokumenty=${lastImport.dokumenty}, pozycje=${lastImport.pozycje}, ` +
      `zamowienia=${lastImport.zamowienia}, zamPozycje=${lastImport.zamPozycje}, ` +
      `mm=${lastImport.mm}, mmPozycje=${lastImport.mmPozycje}`
  );
  return lastImport;
}
