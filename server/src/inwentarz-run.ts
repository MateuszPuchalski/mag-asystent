import fs from "node:fs";
import { db } from "./db/db.js";
import { czasyObslugi } from "./services/czasy-obslugi.js";

/* ── Inwentarz obsługi klienta przed cięciem (0.137.2) ───────────────────────
   Etap 1 przebudowy. Rejestry pytań, dyskusji, opinii, zwrotów i reklamacji
   mają zniknąć razem z danymi — a decyzje o nowym modelu chcemy oprzeć na
   tym, jaka praca NAPRAWDĘ przychodziła, nie na wspomnieniu. Po `DROP TABLE`
   tych liczb nikt już nie odtworzy.

   WYŁĄCZNIE ODCZYT: ani jednego INSERT-a, UPDATE-a i DELETE. Skrypt wolno
   puścić na kopii bazy produkcyjnej i puścić dwa razy.

   Uruchomienie:  npm run inwentarz            (raport na ekran)
                  npm run inwentarz -- plik.md (raport do pliku)             */

type Wiersz = Record<string, unknown>;

const czyta = (sql: string, ...param: unknown[]): Wiersz[] =>
  db().prepare(sql).all(...(param as never[])) as Wiersz[];

const liczba = (sql: string): number => {
  const w = czyta(sql)[0];
  return w ? Number(Object.values(w)[0] ?? 0) : 0;
};

/** Czy tabela w ogóle jest — skrypt ma działać też PO cięciu, bez wywrotki. */
const jest = (tabela: string): boolean =>
  czyta("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", tabela).length > 0;

/* Tabela bez wierszy wygląda jak zepsuty raport, a znaczy coś użytecznego:
   „tego w ogóle nie było". Piszemy to słowem. */
const tabela = (naglowki: string[], wiersze: string[][]): string =>
  wiersze.length === 0
    ? "Brak."
    : [
        `| ${naglowki.join(" | ")} |`,
        `|${naglowki.map(() => "---").join("|")}|`,
        ...wiersze.map((w) => `| ${w.join(" | ")} |`),
      ].join("\n");

const procent = (ile: number, z: number): string =>
  z === 0 ? "—" : `${Math.round((ile / z) * 100)}%`;

/** Wpływ miesiąc po miesiącu dla jednego rejestru. */
function miesiacami(nazwa: string, sql: string): string {
  const w = czyta(sql);
  if (w.length === 0) return `### ${nazwa}\n\nPusto.\n`;
  return [
    `### ${nazwa}`,
    "",
    tabela(
      ["miesiąc", "wpłynęło", "zamkniętych"],
      w.map((r) => [
        String(r.miesiac ?? "?"),
        String(r.ile ?? 0),
        String(r.zamknietych ?? 0),
      ])
    ),
    "",
  ].join("\n");
}

function sekcjaPytan(): string {
  if (!jest("pytanie")) return "## Pytania\n\nTabeli już nie ma.\n";
  const wszystkich = liczba("SELECT COUNT(*) FROM pytanie");
  const zOferta = liczba("SELECT COUNT(*) FROM pytanie WHERE oferta_id IS NOT NULL");
  const zKartoteka = liczba(
    "SELECT COUNT(*) FROM pytanie WHERE produkty_json IS NOT NULL AND produkty_json <> '[]'"
  );
  const zeSzkicem = liczba("SELECT COUNT(*) FROM pytanie WHERE szkic_ai IS NOT NULL");
  const bezEdycji = liczba(
    "SELECT COUNT(*) FROM pytanie WHERE wyslano_at IS NOT NULL AND edytowano = 0"
  );
  const wyslanych = liczba("SELECT COUNT(*) FROM pytanie WHERE wyslano_at IS NOT NULL");

  return [
    "## Pytania",
    "",
    tabela(
      ["miara", "ile", "udział"],
      [
        ["pytań w bazie", String(wszystkich), "100%"],
        ["**z numerem oferty**", String(zOferta), procent(zOferta, wszystkich)],
        ["**bez numeru oferty**", String(wszystkich - zOferta), procent(wszystkich - zOferta, wszystkich)],
        ["z dopasowaniem do kartoteki", String(zKartoteka), procent(zKartoteka, wszystkich)],
        ["ze szkicem AI", String(zeSzkicem), procent(zeSzkicem, wszystkich)],
        ["wysłanych", String(wyslanych), procent(wyslanych, wszystkich)],
        ["wysłanych bez edycji szkicu", String(bezEdycji), procent(bezEdycji, wyslanych)],
      ]
    ),
    "",
    "Wiersz „bez numeru oferty\" mierzy usterkę, od której zaczęła się cała",
    "przebudowa: bez oferty dopasowanie schodzi do zgadywania z treści pytania.",
    "",
    miesiacami(
      "Wpływ pytań",
      `SELECT substr(otrzymano_at, 1, 7) AS miesiac, COUNT(*) AS ile,
              SUM(CASE WHEN status NOT IN ('nowe','szkic') THEN 1 ELSE 0 END) AS zamknietych
         FROM pytanie GROUP BY miesiac ORDER BY miesiac`
    ),
  ].join("\n");
}

function sekcjaDyskusji(): string {
  if (!jest("dyskusja")) return "## Dyskusje\n\nTabeli już nie ma.\n";
  const typy = czyta(
    "SELECT COALESCE(typ,'(brak)') AS typ, COUNT(*) AS ile FROM dyskusja GROUP BY typ ORDER BY ile DESC"
  );
  return [
    "## Dyskusje",
    "",
    tabela(
      ["typ", "ile"],
      typy.map((r) => [String(r.typ), String(r.ile)])
    ),
    "",
    miesiacami(
      "Wpływ dyskusji",
      `SELECT substr(COALESCE(utworzono_allegro, utworzono_at), 1, 7) AS miesiac, COUNT(*) AS ile,
              SUM(CASE WHEN status IN ('zamknieta','pominieta') THEN 1 ELSE 0 END) AS zamknietych
         FROM dyskusja GROUP BY miesiac ORDER BY miesiac`
    ),
  ].join("\n");
}

function sekcjaOpinii(): string {
  if (!jest("opinia")) return "## Opinie\n\nTabeli już nie ma.\n";
  const oceny = czyta(
    `SELECT COALESCE(CAST(ocena AS TEXT), COALESCE(rekomendacja,'(brak)')) AS ocena,
            COUNT(*) AS ile FROM opinia GROUP BY ocena ORDER BY ocena`
  );
  return [
    "## Opinie",
    "",
    tabela(
      ["ocena", "ile"],
      oceny.map((r) => [String(r.ocena), String(r.ile)])
    ),
    "",
  ].join("\n");
}

function sekcjaZwrotow(): string {
  if (!jest("zwrot")) return "## Zwroty i reklamacje\n\nTabel już nie ma.\n";
  const decyzje = czyta(
    `SELECT COALESCE(decyzja,'(bez decyzji)') AS decyzja, COUNT(*) AS ile
       FROM zwrot_pozycja GROUP BY decyzja ORDER BY ile DESC`
  );
  const wyniki = czyta(
    `SELECT COALESCE(rekl_wynik,'(nierozpatrzona)') AS wynik, COUNT(*) AS ile
       FROM zwrot_pozycja WHERE decyzja = 'reklamacja' GROUP BY wynik ORDER BY ile DESC`
  );
  const zeSrodkami = liczba("SELECT COUNT(*) FROM zwrot WHERE zwrot_srodkow_at IS NOT NULL");
  const wszystkich = liczba("SELECT COUNT(*) FROM zwrot");

  return [
    "## Zwroty i reklamacje",
    "",
    `Zwrotów w bazie: **${wszystkich}**, z odnotowanym zwrotem środków: **${zeSrodkami}**.`,
    "",
    "### Decyzje na pozycjach",
    "",
    tabela(
      ["decyzja", "pozycji"],
      decyzje.map((r) => [String(r.decyzja), String(r.ile)])
    ),
    "",
    "### Wyniki reklamacji",
    "",
    tabela(
      ["wynik", "pozycji"],
      wyniki.map((r) => [String(r.wynik), String(r.ile)])
    ),
    "",
    miesiacami(
      "Wpływ zwrotów",
      `SELECT substr(COALESCE(utworzono_allegro, utworzono_at), 1, 7) AS miesiac, COUNT(*) AS ile,
              SUM(CASE WHEN status = 'rozliczony' THEN 1 ELSE 0 END) AS zamknietych
         FROM zwrot GROUP BY miesiac ORDER BY miesiac`
    ),
  ].join("\n");
}

/**
 * Najważniejsza liczba dla magazynu: po cięciu kosz można napełnić WYŁĄCZNIE
 * dokumentem MM ZWROTY z Subiekta. Ta tabelka mówi, jak dużą część pracy
 * odbierze zniknięcie drugiej drogi — przypięcia zwrotu.
 */
function sekcjaKoszy(): string {
  if (!jest("kosz")) return "## Kosze\n\nTabeli już nie ma.\n";
  const zMm = liczba("SELECT COUNT(*) FROM kosz WHERE mm_dok_id IS NOT NULL");
  const wszystkich = liczba("SELECT COUNT(*) FROM kosz");
  const zeZwrotow = wszystkich - zMm;
  return [
    "## Kosze — którędy napełniane",
    "",
    tabela(
      ["droga", "koszy", "udział"],
      [
        ["z dokumentu MM ZWROTY (zostaje)", String(zMm), procent(zMm, wszystkich)],
        ["z przypiętych zwrotów (znika)", String(zeZwrotow), procent(zeZwrotow, wszystkich)],
      ]
    ),
    "",
    "Jeśli druga droga niesie większość koszy, cięcie zmienia obieg na hali",
    "i wymaga rozmowy o nim PRZED wykonaniem, nie po.",
    "",
  ].join("\n");
}

function sekcjaCzasow(): string {
  if (!jest("sprawa_zdarzenie")) return "## Czasy odpowiedzi\n\nOsi czasu już nie ma.\n";
  /* Wołamy istniejący licznik z `services/czasy-obslugi.ts`, a nie piszemy
     drugiego: dwa liczniki tej samej rzeczy rozjeżdżają się przy pierwszej
     zmianie definicji, a ten jest obłożony testami. */
  const c = czasyObslugi(365);
  return [
    "## Czasy odpowiedzi (365 dni)",
    "",
    tabela(
      ["odcinek", "par głos→odpowiedź", "mediana", "p90"],
      c.odcinki.map((o) => [
        o.nazwa,
        String(o.ile),
        o.medianaH === null ? "—" : `${o.medianaH} h`,
        o.p90H === null ? "—" : `${o.p90H} h`,
      ])
    ),
    "",
    `Czekających w tej chwili: **${c.teraz.length}**. Osób z odpowiedziami: **${c.ludzie.length}**.`,
    "",
  ].join("\n");
}

const raport = [
  "# Obsługa klienta — stan zastany przed cięciem",
  "",
  "Wynik `npm run inwentarz`. Liczby zdjęte z bazy PRZED skasowaniem rejestrów",
  "pytań, dyskusji, opinii, zwrotów i reklamacji — po `DROP TABLE` nikt ich już",
  "nie odtworzy. Raport nie zawiera ani jednej treści rozmowy i ani jednego",
  "loginu: same zliczenia.",
  "",
  `Zdjęto: ${new Date().toISOString().slice(0, 19).replace("T", " ")}.`,
  "",
  sekcjaPytan(),
  sekcjaDyskusji(),
  sekcjaOpinii(),
  sekcjaZwrotow(),
  sekcjaKoszy(),
  sekcjaCzasow(),
].join("\n");

const plik = process.argv[2];
if (plik) {
  fs.writeFileSync(plik, raport, "utf8");
  console.log(`Raport zapisany: ${plik}`);
} else {
  console.log(raport);
}
