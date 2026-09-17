#!/usr/bin/env node
/**
 * Sonda danych pod projekt WMS — WYŁĄCZNIE ODCZYT z bazy Subiekta GT.
 *
 * Po co to istnieje: `docs/wms-projekt.md` podejmuje decyzje, które zależą od
 * liczb, a nie od gustu. Ile kartotek ma adres, ile pozycji ma zamówienie,
 * co naprawdę siedzi w `st_StanRez` — bez tych liczb projekt zgaduje.
 * Zgadywanie kształtu Subiekta kosztowało to repo trzy wydania.
 *
 * Skrypt NICZEGO nie zapisuje ani nie zmienia. Nie jest to obietnica w
 * komentarzu, tylko bramka niżej: każde zapytanie przechodzi przez `tylkoOdczyt`
 * i wszystko, co nie zaczyna się od SELECT, leci wyjątkiem przed połączeniem.
 *
 * Uruchomienie (zmienne te same, co czyta serwer — patrz `wertis.env.example`):
 *
 *     node tools/sonda-wms.mjs                  # raport na ekran
 *     node tools/sonda-wms.mjs --plik sonda.md  # raport do pliku
 *     node tools/sonda-wms.mjs --sql            # same zapytania, bez łączenia
 *
 * Wariant `--sql` jest dla sytuacji, w której skrypt nie ma jak dojść do bazy:
 * wypisuje zapytania do wklejenia w SSMS. Wtedy nie potrzebuje ani sieci, ani
 * `node_modules`.
 */
import { writeFileSync } from "node:fs";

/* Kolumna lokalizacji wchodzi do treści zapytania, więc NIE MA prawa przyjść
   z zewnątrz bez sprawdzenia. Subiekt ma dokładnie osiem pól własnych i tylko
   te osiem tu przechodzi. */
const POLE_RE = /^tw_Pole[1-8]$/;
const poleLok = process.env.MSSQL_LOC_COLUMN ?? "tw_Pole1";
if (!POLE_RE.test(poleLok)) {
  console.error(`MSSQL_LOC_COLUMN=${poleLok} — dozwolone są wyłącznie tw_Pole1..tw_Pole8`);
  process.exit(2);
}

/* Bramka odczytu. Świadomie prymitywna i świadomie przed połączeniem:
   ma nie dopuścić do bazy niczego, co nie jest SELECT-em, a nie tłumaczyć
   potem, dlaczego dopuściła. */
const ZAKAZANE = /\b(insert|update|delete|drop|alter|create|exec|merge|truncate|grant)\b/i;
function tylkoOdczyt(sql, nazwa) {
  // Wcięcie z literału szablonowego idzie do SSMS razem z zapytaniem i utrudnia
  // czytanie, więc schodzi tutaj — w jednym miejscu, nie przy każdej sondzie.
  const t = sql.trim().split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
  if (!/^select\b/i.test(t)) throw new Error(`Sonda „${nazwa}" nie jest SELECT-em`);
  if (ZAKAZANE.test(t)) throw new Error(`Sonda „${nazwa}" zawiera słowo zapisujące`);
  return t;
}

/**
 * Sondy. Każda niesie `decyduje` — zdanie o tym, KTÓRĄ decyzję projektu ta
 * liczba rozstrzyga. Sonda bez takiego zdania nie ma po co istnieć: dane,
 * które niczego nie zmieniają, kosztują czas właściciela i nic nie dają.
 */
const SONDY = [
  {
    id: "magazyny",
    tytul: "Magazyny i ich identyfikatory",
    decyduje: "Ile miejsc `nieznane` powstaje (jedno na magazyn) i co obejmuje niezmiennik N2.",
    sql: `SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny
          FROM sl_Magazyn WITH (NOLOCK) ORDER BY mag_Id;`,
  },
  {
    id: "dokumenty-status",
    tytul: "Kiedy system sprzedaży księguje dokument",
    decyduje:
      "Czy stan w Subiekcie schodzi PRZED zbiórką. Jeśli tak, zasiew i niezmiennik N2 stoją na fałszywym założeniu.",
    sql: `SELECT dok_Typ, dok_Status, COUNT(*) AS ile,
                 MIN(dok_DataWyst) AS od, MAX(dok_DataWyst) AS do_
          FROM dok__Dokument WITH (NOLOCK)
          WHERE dok_Typ IN (2,21) AND dok_DataWyst >= DATEADD(month,-3,GETDATE())
          GROUP BY dok_Typ, dok_Status ORDER BY dok_Typ, dok_Status;`,
  },
  {
    id: "adresy",
    tytul: "Adresy na kartotekach",
    decyduje: "Ile wierszy tworzy zasiew tabeli miejsc i ile kodów wymaga poprawki ręką.",
    sql: `SELECT ${poleLok} AS kod, COUNT(*) AS kartotek
          FROM tw__Towar WITH (NOLOCK)
          WHERE ${poleLok} IS NOT NULL AND LTRIM(RTRIM(${poleLok})) <> ''
          GROUP BY ${poleLok} ORDER BY COUNT(*) DESC;`,
  },
  {
    id: "adresy-wielokrotne",
    tytul: "Kartoteki z więcej niż jednym adresem",
    decyduje: "Czy pierwsze odłożenie musi umieć rozbić ilość na kilka miejsc.",
    sql: `SELECT LEN(${poleLok}) - LEN(REPLACE(${poleLok},' ','')) AS spacji,
                 COUNT(*) AS kartotek
          FROM tw__Towar WITH (NOLOCK)
          WHERE ${poleLok} IS NOT NULL AND LTRIM(RTRIM(${poleLok})) <> ''
          GROUP BY LEN(${poleLok}) - LEN(REPLACE(${poleLok},' ','')) ORDER BY 1;`,
  },
  {
    id: "stany",
    tytul: "Stany i rezerwacje po magazynach",
    decyduje:
      "Rozmiar zasiewu oraz to, czy `st_StanRez` już niesie rezerwacje — wtedy własna tabela rezerwacji liczyłaby je drugi raz.",
    sql: `SELECT st_MagId, COUNT(*) AS kartotek,
                 SUM(st_Stan) AS suma_stanu, SUM(st_StanRez) AS suma_rezerwacji,
                 SUM(CASE WHEN st_StanRez > 0 THEN 1 ELSE 0 END) AS z_rezerwacja
          FROM tw_Stan WITH (NOLOCK) WHERE st_Stan <> 0
          GROUP BY st_MagId ORDER BY st_MagId;`,
  },
  {
    id: "rotacja",
    tytul: "Rotacja kartotek przez rok",
    decyduje: "Klasy ABC dla liczenia ciągłego i próg strefy złotej na własnych danych.",
    sql: `SELECT TOP 500 p.ob_TowId, COUNT(*) AS wystapien, SUM(p.ob_IloscMag) AS sztuk
          FROM dok_Pozycja p WITH (NOLOCK)
          JOIN dok__Dokument d WITH (NOLOCK) ON d.dok_Id = p.ob_DokHanId
          WHERE d.dok_Typ IN (2,21) AND d.dok_Status = 1
            AND d.dok_DataWyst >= DATEADD(year,-1,GETDATE())
          GROUP BY p.ob_TowId ORDER BY COUNT(*) DESC;`,
  },
  {
    id: "pozycji-na-dokument",
    tytul: "Ile pozycji ma jedno zamówienie",
    decyduje:
      "Czy zbiórka zbiorcza w ogóle się opłaca i ile przegród ma mieć wózek. Przy medianie powyżej trzech pozycji zysk z łączenia maleje.",
    sql: `SELECT ile_pozycji, COUNT(*) AS dokumentow FROM (
            SELECT d.dok_Id, COUNT(*) AS ile_pozycji
            FROM dok__Dokument d WITH (NOLOCK)
            JOIN dok_Pozycja p WITH (NOLOCK) ON p.ob_DokHanId = d.dok_Id
            WHERE d.dok_Typ IN (2,21) AND d.dok_Status = 1
              AND d.dok_DataWyst >= DATEADD(month,-3,GETDATE())
            GROUP BY d.dok_Id) x
          GROUP BY ile_pozycji ORDER BY ile_pozycji;`,
  },
  {
    id: "dobowy-rytm",
    tytul: "Dokumenty sprzedaży na dobę",
    decyduje:
      "Ryzyko rywalizacji o zapis w SQLite, liczba kolektorów na zmianie i objętość wydruku w trybie awaryjnym.",
    sql: `SELECT CAST(d.dok_DataWyst AS date) AS dzien, COUNT(*) AS dokumentow
          FROM dok__Dokument d WITH (NOLOCK)
          WHERE d.dok_Typ IN (2,21) AND d.dok_Status = 1
            AND d.dok_DataWyst >= DATEADD(month,-3,GETDATE())
          GROUP BY CAST(d.dok_DataWyst AS date) ORDER BY 1;`,
  },
  {
    id: "jednostki",
    tytul: "Jednostki miary na kartotekach",
    decyduje:
      "Czy projekt ma prawo odmówić hierarchii opakowań. Udział jednostek zbiorczych tę odmowę unieważnia.",
    sql: `SELECT tw_JednMiary, COUNT(*) AS kartotek
          FROM tw__Towar WITH (NOLOCK) WHERE tw_Zablokowany = 0
          GROUP BY tw_JednMiary ORDER BY COUNT(*) DESC;`,
  },
  {
    id: "numer-obcy",
    tytul: "Czym dokument sprzedaży wskazuje zamówienie",
    decyduje: "Czy spakowane zlecenie da się powiązać z dokumentem Subiekta bez człowieka.",
    /* `dok_Uwagi` NIE WCHODZI do tej sondy, choć integracja wpisuje tam numer
       zamówienia. W tej samej kolumnie mieści się adres i telefon, a polityka
       danych tego repo nie przepuszcza adresów przez mapowanie. Numer wyciąga
       się z niej wzorcem UUID-a po stronie SQL — patrz `adapters/subiekt.uuid.ts`. */
    sql: `SELECT TOP 50 dok_Id, dok_Typ, dok_NrPelny, dok_NrPelnyOryg,
                 dok_DataWyst, dok_MagId, dok_Status
          FROM dok__Dokument WITH (NOLOCK)
          WHERE dok_Typ IN (2,21) ORDER BY dok_Id DESC;`,
  },
];

/* ── Wypis samych zapytań ──────────────────────────────────────────────────
   Tryb bez bazy. Człowiek z otwartym SSMS-em dostaje to, co ma wkleić, razem
   z powodem — bo zapytanie bez powodu wraca jako „po co mi to". */
function wypiszSql() {
  const linie = ["# Sonda WMS — zapytania do wklejenia", ""];
  for (const s of SONDY) {
    const sql = tylkoOdczyt(s.sql, s.id);
    linie.push(`## ${s.tytul}`, "", `**Decyduje:** ${s.decyduje}`, "", "```sql", sql, "```", "");
  }
  return linie.join("\n");
}

/* ── Przebieg po bazie ─────────────────────────────────────────────────────
   Brak uprawnienia do jednej tabeli NIE kończy sondy. Raport ma powiedzieć,
   czego nie wie, i policzyć resztę — tak samo jak `co_w_toku.sh` mówi wprost,
   że nie zna listy PR-ów, i pracuje dalej. */
async function przebieg() {
  const { default: sql } = await import("mssql");
  const cfg = {
    server: process.env.MSSQL_SERVER ?? "localhost",
    database: process.env.MSSQL_DATABASE ?? "",
    user: process.env.MSSQL_USER ?? "",
    password: process.env.MSSQL_PASSWORD ?? "",
    options: {
      instanceName: process.env.MSSQL_INSTANCE || undefined,
      encrypt: process.env.MSSQL_ENCRYPT === "1",
      trustServerCertificate: process.env.MSSQL_TRUST_CERT !== "0",
      readOnlyIntent: true,
    },
    port: process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : undefined,
    requestTimeout: Number(process.env.MSSQL_REQUEST_TIMEOUT_MS ?? 30000),
  };
  if (!cfg.database || !cfg.user) {
    throw new Error("Brak MSSQL_DATABASE albo MSSQL_USER — ustaw je albo użyj --sql");
  }
  const pula = await sql.connect(cfg);
  const linie = [`# Sonda WMS — ${new Date().toISOString()}`, "",
    `Baza: \`${cfg.database}\`, kolumna lokalizacji: \`${poleLok}\`.`, "",
    "Wszystkie zapytania są odczytem. Skrypt nie zmienia w Subiekcie niczego.", ""];
  for (const s of SONDY) {
    linie.push(`## ${s.tytul}`, "", `**Decyduje:** ${s.decyduje}`, "");
    try {
      const wynik = await pula.request().query(tylkoOdczyt(s.sql, s.id));
      linie.push(...tabelka(wynik.recordset), "");
    } catch (e) {
      linie.push(`**NIE WIEM.** ${e.message}`, "",
        "Zwykle znaczy to brak `GRANT SELECT` na tabelę z tego zapytania.", "");
    }
  }
  await pula.close();
  return linie.join("\n");
}

/** Wynik jako tabela markdown; pusty zbiór mówi to wprost, a nie pustym miejscem. */
function tabelka(wiersze) {
  if (!wiersze || wiersze.length === 0) return ["_Zero wierszy._"];
  const kol = Object.keys(wiersze[0]);
  const esc = (v) => (v === null || v === undefined ? "" : String(v).replace(/\|/g, "\\|"));
  return [
    `| ${kol.join(" | ")} |`,
    `|${kol.map(() => "---").join("|")}|`,
    ...wiersze.slice(0, 200).map((w) => `| ${kol.map((k) => esc(w[k])).join(" | ")} |`),
    ...(wiersze.length > 200 ? ["", `_Pokazano 200 z ${wiersze.length} wierszy._`] : []),
  ];
}

const arg = process.argv.slice(2);
const plik = arg.includes("--plik") ? arg[arg.indexOf("--plik") + 1] : null;

/* Niepowodzenie mówi, co zrobić dalej, a nie sypie stosem wywołań. Brak bazy
   pod ręką jest normalnym stanem tego skryptu, nie awarią — stąd wskazanie
   na `--sql` wprost w komunikacie. */
let raport;
try {
  raport = arg.includes("--sql") ? wypiszSql() : await przebieg();
} catch (e) {
  console.error(`Sonda nie doszła do bazy: ${e.message}`);
  console.error("Zapytania do wklejenia w SSMS wypisze: node tools/sonda-wms.mjs --sql");
  process.exit(1);
}
if (plik) {
  writeFileSync(plik, raport, "utf8");
  console.log(`Raport: ${plik}`);
} else {
  console.log(raport);
}
