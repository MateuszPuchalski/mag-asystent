import sql from "mssql";
import { db, nowIso, transaction } from "../db/db.js";
import { mssqlPool, assertSafeColumn } from "../db/mssql.js";
import { config } from "../config.js";
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

/**
 * Dokumenty sprzedaży wskazane przez NIEROZLICZONE zwroty Allegro — `dok_Id`
 * po stronie Subiekta. Ten sam wyjątek okna co `otwarteDokumenty`: dopasowany
 * zwrot ma pokazywać pozycje dokumentu także wtedy, gdy dokument wypadł już
 * z okna `DOK_SPRZEDAZ_DNI_WSTECZ` — paczka potrafi leżeć w „do wyjaśnienia"
 * tygodniami, a brak dokumentu na ekranie wygląda jak zerwane dopasowanie.
 */
function dokumentyOtwartychZwrotow(): number[] {
  return (
    db()
      .prepare(
        "SELECT DISTINCT sgt_dok_id FROM zwrot WHERE sgt_dok_id IS NOT NULL AND status <> 'rozliczony'"
      )
      .all() as Array<{ sgt_dok_id: number }>
  ).map((r) => Math.trunc(r.sgt_dok_id));
}

/**
 * Fragmenty `WHERE` dla zapytania o dokumenty SPRZEDAŻY — lustro
 * `budujFiltryDokumentow`, z tych samych powodów wydzielone: to jedyna logika,
 * reszta to I/O nietestowalne bez serwera MSSQL.
 */
export function budujFiltrySprzedazy(
  typy: number[],
  otwarte: number[]
): { typFilter: string; oknoFilter: string } {
  const typFilter = `d.dok_Typ IN (${
    typy.length ? typy.map((n) => Math.trunc(n)).join(",") : "NULL"
  })`;
  const oknoFilter = otwarte.length
    ? `(d.dok_DataWyst >= @cutoff OR d.dok_Id IN (${otwarte.map((n) => Math.trunc(n)).join(",")}))`
    : "d.dok_DataWyst >= @cutoff";
  return { typFilter, oknoFilter };
}

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

interface SprzedazRow {
  dok_Id: number;
  dok_Typ: number;
  dok_NrPelny: string;
  nr_oryg: string | null;
  data_wyst: string;
  kontrahent: string | null;
  uwagi: string | null;
  mag_id: number | null;
}

export interface ImportStats {
  towary: number;
  stany: number;
  dokumenty: number;
  pozycje: number;
  zamowienia: number;
  zamPozycje: number;
  sprzedaz: number;
  sprzedazPozycje: number;
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
 * Ustawiane, gdy `dok__Dokument` nie ma którejś z opcjonalnych kolumn sprzedaży
 * (`MSSQL_SPRZEDAZ_NR_ORYG_COLUMN` / `MSSQL_SPRZEDAZ_UWAGI_COLUMN`).
 *
 * Czytane przez `/api/health`. Objawem braku kolumny jest „zwroty nigdy nie
 * dopasowują się same" — czyli dokładnie to samo, co przy integracji, która
 * numeru zamówienia nigdzie nie wpisuje. Bez tego zdania nikt nie odróżni
 * jednej sytuacji od drugiej.
 */
export let brakKolumnSprzedazy: string | null = null;

/**
 * Ustawiane, gdy odczyt sprzedaży NIE UDAŁ SIĘ w ogóle (timeout, błąd 8623,
 * deadlock) — w odróżnieniu od `brakKolumnSprzedazy`, które mówi o złej nazwie
 * kolumny opcjonalnej.
 *
 * Sprzedaż jest paliwem dopasowywania zwrotów, a nie warunkiem pracy magazynu:
 * jej awaria degraduje (zostaje ostatni udany odczyt sgt_sprzedaz i zdanie
 * w /api/health), zamiast wywracać cały import. Wdrożenie 0.53.0 pokazało cenę
 * odwrotnej decyzji: import startowy jest twardym błędem, więc każda usterka
 * zapytania sprzedaży kładła API w pętlę restartów.
 */
export let bladImportuSprzedazy: string | null = null;

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
async function pobierzSprzedaz(
  pool: sql.ConnectionPool
): Promise<{ sprzedaz: SprzedazRow[]; sprzedazPozycje: PozRow[] }> {
  const c = config.mssql;
  const typy = [c.dokTypFS, c.dokTypPA];
  const { typFilter, oknoFilter } = budujFiltrySprzedazy(typy, dokumentyOtwartychZwrotow());
  const cutoff = new Date(Date.now() - c.sprzedazDniWstecz * 86400_000)
    .toISOString()
    .slice(0, 10);

  const zapytanie = (nrOryg: string, uwagi: string) =>
    pool
      .request()
      .input("cutoff", sql.VarChar, cutoff)
      .query<SprzedazRow>(
        `SELECT d.dok_Id, d.dok_Typ, d.dok_NrPelny,
                ${nrOryg} AS nr_oryg,
                CONVERT(varchar(10), d.dok_DataWyst, 120) AS data_wyst,
                ISNULL(k.kh_Symbol, '') AS kontrahent,
                ${uwagi} AS uwagi,
                d.dok_MagId AS mag_id
         FROM dok__Dokument d WITH (NOLOCK)
         LEFT JOIN kh__Kontrahent k WITH (NOLOCK) ON k.kh_Id = d.dok_PlatnikId
         WHERE ${typFilter} AND ${oknoFilter}`
      );

  const nrOrygCol = c.sprzedazNrOrygColumn ? `d.${assertSafeColumn(c.sprzedazNrOrygColumn)}` : "NULL";
  const uwagiCol = c.sprzedazUwagiColumn ? `d.${assertSafeColumn(c.sprzedazUwagiColumn)}` : "NULL";

  let sprzedaz: SprzedazRow[];
  try {
    sprzedaz = (await zapytanie(nrOrygCol, uwagiCol)).recordset;
    brakKolumnSprzedazy = null;
  } catch (e) {
    if (nrOrygCol === "NULL" && uwagiCol === "NULL") throw e; // to nie kolumny opcjonalne
    /* Rozróżnienie „zła nazwa kolumny" od „baza nie odpowiada" po numerze błędu
       SQL Servera (207 = invalid column name). Timeout potraktowany jak brak
       kolumny dawałby fałszywy komunikat i DRUGIE ciężkie zapytanie do bazy,
       która właśnie nie wyrabia. */
    const nr = (e as { number?: unknown }).number;
    if (nr !== 207) throw e;
    brakKolumnSprzedazy =
      `Kolumna ${[nrOrygCol, uwagiCol].filter((k) => k !== "NULL").join(" lub ")} nie istnieje ` +
      "w dok__Dokument — zwroty Allegro dopasowują dokument tylko po pozycjach, bez numeru " +
      "zamówienia. Sprawdź nazwy na własnej bazie i ustaw MSSQL_SPRZEDAZ_NR_ORYG_COLUMN / " +
      "MSSQL_SPRZEDAZ_UWAGI_COLUMN (DEPLOY §6); puste = świadoma rezygnacja.";
    console.warn(`[mssql] ${brakKolumnSprzedazy} (${e instanceof Error ? e.message : e})`);
    sprzedaz = (await zapytanie("NULL", "NULL")).recordset;
  }

  if (sprzedaz.length === 0) return { sprzedaz, sprzedazPozycje: [] };
  const sprzedazPozycje = (
    await pool
      .request()
      .input("cutoff", sql.VarChar, cutoff)
      .query<PozRow>(
        `SELECT p.ob_DokHanId, p.ob_TowId, p.ob_IloscMag
         FROM dok_Pozycja p WITH (NOLOCK)
         JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId
         WHERE ${typFilter} AND ${oknoFilter}`
      )
  ).recordset;
  return { sprzedaz, sprzedazPozycje };
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

  /* Awaria sprzedaży degraduje, nie przerywa — stany i lokalizacje są
     ważniejsze od dopasowywania zwrotów. `sprzedazOk` steruje niżej także
     czyszczeniem: przy błędzie sgt_sprzedaz* zostaje z ostatniego udanego
     odczytu, bo puste tabele wyglądałyby jak „zero sprzedaży", a to
     nieprawda — to my nie umieliśmy zapytać. */
  let sprzedaz: SprzedazRow[] = [];
  let sprzedazPozycje: PozRow[] = [];
  let sprzedazOk = false;
  try {
    ({ sprzedaz, sprzedazPozycje } = await pobierzSprzedaz(pool));
    sprzedazOk = true;
    bladImportuSprzedazy = null;
  } catch (e) {
    bladImportuSprzedazy =
      "Odczyt dokumentów sprzedaży (FS/PA) nie powiódł się — zwroty Allegro " +
      "dopasowują dokumenty na danych z ostatniej udanej synchronizacji. " +
      `Przyczyna: ${e instanceof Error ? e.message : e}`;
    console.warn(`[mssql] ${bladImportuSprzedazy}`);
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
  const insSprzedaz = d.prepare(
    `INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, nr_oryg, data_wyst, kontrahent, uwagi, mag_id)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insSprzedazPoz = d.prepare(
    "INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)"
  );

  const apply = transaction(d, () => {
    /* Kolejność ma znaczenie: pozycje przed nagłówkami, bo trzyma je klucz obcy.
       Na tej liście stoi WYŁĄCZNIE read-model sgt_* — tabele aplikacji
       (zwrot, zwrot_pozycja, allegro_token, ean_alias…) nie mają tu wstępu:
       import zaorałby wiedzę, której Subiekt nie ma.
       sgt_sprzedaz* czyszczone tylko przy udanym odczycie — patrz `sprzedazOk`. */
    for (const t of [
      ...(sprzedazOk ? ["sgt_sprzedaz_pozycja", "sgt_sprzedaz"] : []),
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
    for (const s of sprzedaz) {
      insSprzedaz.run(
        s.dok_Id,
        symbolTypu(s.dok_Typ),
        s.dok_NrPelny,
        s.nr_oryg || null,
        s.data_wyst,
        s.kontrahent ?? "",
        s.uwagi || null,
        /* Magazyn sprzedaży — źródło MM na bufor zwrotowy (0.57.0). Sprzedaż
           nie zawsze idzie z magazynu głównego, a MM z niewłaściwego magazynu
           to brak stanu i zadanie w błędzie. */
        s.mag_id ?? null
      );
    }
    for (const p of sprzedazPozycje) {
      if (!knownTw.has(p.ob_TowId)) continue;
      /* ABS świadomie: znak ilości na dokumencie rozchodowym zależy od wersji
         bazy, a dopasowanie zwrotu porównuje „ile sprzedano" z „ile wraca" —
         obie liczby mają być dodatnie. */
      insSprzedazPoz.run(p.ob_DokHanId, p.ob_TowId, Math.abs(p.ob_IloscMag ?? 0));
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
    sprzedaz: sprzedaz.length,
    sprzedazPozycje: sprzedazPozycje.length,
    at: nowIso(),
  };
  console.log(
    `[mssql] import: towary=${lastImport.towary}, stany=${lastImport.stany}, ` +
      `dokumenty=${lastImport.dokumenty}, pozycje=${lastImport.pozycje}, ` +
      `zamowienia=${lastImport.zamowienia}, zamPozycje=${lastImport.zamPozycje}, ` +
      `sprzedaz=${lastImport.sprzedaz}, sprzedazPozycje=${lastImport.sprzedazPozycje}`
  );
  return lastImport;
}
