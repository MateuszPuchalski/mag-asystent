import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { DROGI_DOBORU, STATUSY_DOBORU, type DrogaDoboru, type StatusDoboru } from "./dobor.js";
import { mediana, OKNO, PODSTAWA_PRAWNA, PROG_WIARYGODNOSCI } from "./raporty.js";

/**
 * Skuteczność doboru (0.267.0) — WYŁĄCZNIE ODCZYT.
 *
 * ── SKĄD TEN RAPORT ─────────────────────────────────────────────────────────
 * `dobor_rozmowy.wybrany_droga` zapisuje, którym z JEDENASTU szczebli §11.2
 * przyszedł kandydat wybrany przez agenta. Kolumna stoi w bazie od 0.229.0
 * i do tego wydania miała dwóch czytelników: odczyt jednego wiersza do ekranu
 * i dwa `UPDATE`. Zero agregacji — więc nie dało się odpowiedzieć na pytanie,
 * od którego zależy każda decyzja o rozwoju doboru: czy szczebel „zgodne
 * wymiary" dał kiedykolwiek wybraną część, czy dziewięć szczebli nie jest
 * teatrem wokół trzech.
 *
 * ── DLACZEGO Z `events`, A NIE Z `dobor_rozmowy` ────────────────────────────
 * Pierwsza wersja tego serwisu liczyła z tabeli i była błędna na trzy sposoby.
 * Każdy z nich jest osobnym powodem, żeby nie wracać do tamtego pomysłu:
 *
 * 1. TABELA PAMIĘTA TYLKO OSTATNI WYBÓR. Agent, który wybrał z pełnego tekstu,
 *    zmienił zdanie i wziął trafienie po OEM, zostawia w tabeli sam OEM.
 *    Histogram z tabeli mierzy „drogę, która przetrwała", a pytanie brzmi
 *    „droga, która dała trafienie". Zdjęcie wyboru (`wybierzKandydata(null)`)
 *    kasuje `wybrany_droga`, `wybrano_at` i `wybrano_user_id` — wybór znika
 *    z historii całkowicie.
 * 2. `status='confirmed'` DZIŚ to nie to samo, co „doszło do zatwierdzenia".
 *    Status jest cofalny: zmiana wyboru sprowadza `confirmed` z powrotem do
 *    `candidates_found` (`dobor.ts`), a `rejected` da się ustawić ręcznie.
 *    Tabela zna stan końcowy, nie przebieg.
 * 3. RETENCJA KASUJE PRZEDMIOT POMIARU. `sprzatnijSprzedGranicy` biegnie przy
 *    KAŻDYM starcie procesu i kasuje rozmowy bez wiadomości od
 *    `ALLEGRO_INBOX_OD`; `dobor_rozmowy` wisi na `ON DELETE CASCADE`. Raport
 *    z tabeli potrafiłby zmienić liczby między dwoma odświeżeniami strony.
 *    `events` nie ma klucza obcego do rozmowy i przeżywa sprzątanie.
 *
 * Tabela zostaje do JEDNEJ rzeczy, nazwanej wprost: `naStole` — co leży teraz,
 * w jakich statusach. To inne pytanie i inna populacja, więc stoi osobno,
 * a nie doklejone do liczb historycznych.
 *
 * ── CZEGO TEN RAPORT NIE LICZY ──────────────────────────────────────────────
 * Rozkładu POWODÓW pominięcia szczebli. Powody powstają przy każdym odczycie
 * w `kandydaciDoboru()` i nigdzie nie są zapisane; policzenie ich wstecz
 * wymagałoby przeliczenia doboru dla każdej rozmowy w historii, z pytaniami
 * do Subiekta włącznie. Raport liczy wyłącznie to, co w bazie STOI — zasada
 * z nagłówka `sygnatury.ts`: raport ma liczyć to samo, co robi mechanizm.
 *
 * Nie liczy też ŻADNEGO UŁAMKA „ile doborów się udało". Mianownika na to nie
 * ma: wiersz doboru istnieje tylko tam, gdzie ktoś kliknął, więc rozmowy,
 * w których nikt doboru nie zaczął, są niewidoczne. Liczby tutaj są udziałami
 * WEWNĄTRZ rozpoczętych doborów i tak się nazywają.
 */

const DOMYSLNE_DNI = 30;

/* Zdarzenia doboru, po których biegnie ten raport. Nazwy z `slad()` w `dobor.ts`. */
const WYBOR = "dobor_wybor";
const STATUS = "dobor_status";

/**
 * Granica okna w formacie `events.created_at`, czyli ISO z `T` i `Z`.
 *
 * NIE `datetime('now', ?)`, i to nie jest kosmetyka. `datetime()` zwraca
 * `'2026-08-11 19:59:47'` — ze SPACJĄ — a znaczniki w bazie mają `'T'`.
 * W porównaniu tekstowym `'T'` (0x54) jest większe od spacji (0x20), więc
 * `'2026-08-11T00:05:00.000Z' >= datetime('now','-30 days')` daje PRAWDĘ,
 * choć 00:05 jest wcześniejsze niż 19:59. Każde okno zbudowane tamtym
 * sposobem jest do doby szersze, niż deklaruje, zawsze w stronę „więcej".
 * Sprawdzone na uruchomionym `node:sqlite`, nie wywnioskowane.
 */
const GRANICA = "strftime('%Y-%m-%dT%H:%M:%fZ','now',?)";

export interface WierszDrogi {
  droga: DrogaDoboru;
  /** Ile razy agent wybrał kandydata tą drogą — każdy wybór, także później zmieniony. */
  wybranych: number;
  /** Ile z tych wyborów DOSZŁO do zatwierdzenia, licząc tylko wybór bezpośrednio je poprzedzający. */
  zatwierdzonych: number;
}

export interface WierszOsoby {
  userId: number | null;
  /** Nazwa z konta; `null` w bazie znaczy wybór sprzed kont — nie zgadujemy, kto to był. */
  osoba: string;
  wybranych: number;
  zatwierdzonych: number;
  /**
   * KTÓRĄ drogą ta osoba najczęściej kończy — zdanie o SPOSOBIE pracy, nie
   * o jej jakości, i jedyna kolumna „jakościowa" w tej tabeli. Patrz nagłówek
   * sekcji osób niżej: liczby rankingowej tu nie ma i nie ma jej przez pomyłkę.
   */
  najczestszaDroga: DrogaDoboru | null;
  /** Mediana minut do wyboru; `null` poniżej progu wiarygodności. */
  medianaMin: number | null;
}

export interface SkutecznoscDoboru {
  dni: number;
  /**
   * `ALLEGRO_INBOX_OD` — próg, przed którym rozmów w bazie NIE MA. Idzie do
   * panelu, bo bez niego selektor „ostatnie 90 dni" obiecywałby kwartał,
   * którego nikt nie ma z czego policzyć.
   */
  granicaHistorii: string | null;
  /** Wybory kandydata w oknie — z `events`, więc także te później zmienione. */
  wyborow: number;
  /** JEDENAŚCIE wierszy zawsze, także z zerami. */
  drogi: WierszDrogi[];
  medianaDoWyboruMin: number | null;
  /** Ile wyborów weszło do mediany — mediana bez tej liczby jest liczbą bez wagi. */
  wyborowZCzasem: number;
  osoby: WierszOsoby[];
  /** Ile wyborów nie ma konta autora (bazy sprzed kolumny `*_user_id`). */
  bezKonta: number;
  /** STAN NA DZIŚ z `dobor_rozmowy` — inne pytanie niż reszta raportu. */
  naStole: { doborow: number; statusy: Array<{ status: StatusDoboru; ile: number }> };
  progWiarygodnosci: number;
  podstawaPrawna: string;
}

/**
 * Punkt w księdze: znacznik ORAZ numer wiersza.
 *
 * Sam znacznik nie wystarcza. `created_at` ma rozdzielczość milisekundy,
 * a `wybierzKandydata` i `ustawStatusDoboru` piszą po kilka wierszy w jednym
 * przebiegu — remis jest tu regułą, nie wyjątkiem. `events.id` to
 * `INTEGER PRIMARY KEY AUTOINCREMENT`: jedyny w tej tabeli porządek ściśle
 * rosnący i bez ponownego użycia, więc to on rozstrzyga remis.
 */
interface Chwila {
  at: string;
  id: number;
}

/* `at` to ISO o stałej szerokości, więc porównanie tekstowe jest
   chronologicznym — to samo założenie, na którym stoi `ORDER BY created_at`
   w obu zapytaniach niżej. `id` porównujemy OSTRO, bo wybór i zmiana statusu
   nigdy nie dzielą wiersza, a zdarzenie nie poprzedza samo siebie. */
const wczesniej = (a: Chwila, b: Chwila) =>
  a.at < b.at || (a.at === b.at && a.id < b.id);

interface ZdarzenieWyboru extends Chwila {
  conversationId: number;
  droga: DrogaDoboru | null;
  userRef: number | null;
  osoba: string;
}

export function skutecznoscDoboru(
  days = DOMYSLNE_DNI, database: DatabaseSync = db(),
): SkutecznoscDoboru {
  const okno = OKNO(days);

  /* `json_valid` przed każdym `json_extract` — blizna S59 z `raporty.ts`:
     jeden uszkodzony ładunek kładł cały raport piątką. */
  const wybory = (database.prepare(
    `SELECT CAST(json_extract(e.payload,'$.conversationId') AS INTEGER) AS rozmowa,
            json_extract(e.payload,'$.droga') AS droga,
            e.id AS id, e.created_at AS at, e.user_ref AS uref,
            COALESCE(u.name, e.user_id) AS osoba
     FROM events e LEFT JOIN app_user u ON u.user_id = e.user_ref
     WHERE e.type=? AND e.created_at >= ${GRANICA} AND json_valid(e.payload)
       AND json_extract(e.payload,'$.conversationId') IS NOT NULL
     ORDER BY e.created_at, e.id`).all(WYBOR, okno) as
    Array<{ rozmowa: number; id: number; droga: string | null; at: string;
            uref: number | null; osoba: string }>)
    .map((r): ZdarzenieWyboru => ({
      conversationId: Number(r.rozmowa), id: Number(r.id),
      droga: DROGI_DOBORU.includes(r.droga as DrogaDoboru) ? r.droga as DrogaDoboru : null,
      at: String(r.at), userRef: r.uref == null ? null : Number(r.uref), osoba: String(r.osoba),
    }));

  /* Zatwierdzenia liczymy z PRZEJŚĆ statusu, nie ze stanu tabeli: `po='confirmed'`
     zdarzyło się i zostaje w księdze, choćby agent potem zmienił zdanie. */
  const zatwierdzenia = new Map<number, Chwila[]>();
  for (const r of database.prepare(
    `SELECT CAST(json_extract(payload,'$.conversationId') AS INTEGER) AS rozmowa,
            id AS id, created_at AS at
     FROM events
     WHERE type=? AND created_at >= ${GRANICA} AND json_valid(payload)
       AND json_extract(payload,'$.po')='confirmed'
     ORDER BY created_at, id`).all(STATUS, okno) as
    Array<{ rozmowa: number; id: number; at: string }>) {
    const rozmowa = Number(r.rozmowa);
    zatwierdzenia.set(rozmowa,
      [...(zatwierdzenia.get(rozmowa) ?? []), { at: String(r.at), id: Number(r.id) }]);
  }

  /* Zatwierdzenie kredytuje WYŁĄCZNIE wybór bezpośrednio je poprzedzający.
     Agent, który wziął kandydata z pełnego tekstu, zmienił zdanie na trafienie
     po OEM i dopiero to zatwierdził, nie ma prawa dopisać punktu pełnemu
     tekstowi — a tak liczyłby każdy prostszy sposób.

     „Poprzedzający" idzie po PARZE (at, id), nie po samym znaczniku. Po samym
     `at` remis milisekundy przewracał tę regułę do góry nogami: `w.at <= chwila`
     było prawdziwe także dla wyboru zapisanego PO zatwierdzeniu, a `.reverse()`
     stawiało go pierwszym — kredyt szedł do drogi, która zatwierdzenia nie
     poprzedzała. Wychodziło to migotaniem testu raz na kilka przebiegów, więc
     na produkcji nie wyszłoby wcale. */
  const trafione = new Set<ZdarzenieWyboru>();
  for (const [rozmowa, chwile] of zatwierdzenia) {
    const wTejRozmowie = wybory.filter((w) => w.conversationId === rozmowa);
    for (const chwila of chwile) {
      const poprzedzajacy = [...wTejRozmowie].reverse().find((w) => wczesniej(w, chwila));
      if (poprzedzajacy) trafione.add(poprzedzajacy);
    }
  }

  const czasy = czasyDoWyboru(database, wybory);
  const minuty = [...czasy.values()];

  return {
    dni: days,
    granicaHistorii: config.allegro.inboxOd || null,
    wyborow: wybory.length,
    drogi: rozkladDrog(wybory, trafione),
    medianaDoWyboruMin: zaokraglij(mediana(minuty)),
    wyborowZCzasem: minuty.length,
    osoby: osoby(wybory, trafione, czasy),
    bezKonta: wybory.filter((w) => w.userRef === null).length,
    naStole: naStole(database),
    progWiarygodnosci: PROG_WIARYGODNOSCI,
    podstawaPrawna: PODSTAWA_PRAWNA,
  };
}

const zaokraglij = (v: number | null) => v === null ? null : Math.round(v);

/**
 * JEDENAŚCIE wierszy, zawsze, także z zerami.
 *
 * Szczebel bez ani jednego wyboru jest w tym raporcie NAJCENNIEJSZYM
 * ustaleniem — mówi, że droga, którą utrzymujemy w kodzie, nie dała jeszcze
 * nikomu odpowiedzi. Wypadnięcie go z listy razem z zerem zamieniłoby
 * ustalenie w ciszę. Ta sama reguła, co „pominięty z powodem, nie zero
 * wyników" przy szczeblach kandydatów (blizna 0.153.1).
 */
function rozkladDrog(wybory: ZdarzenieWyboru[], trafione: Set<ZdarzenieWyboru>): WierszDrogi[] {
  return DROGI_DOBORU.map((droga) => {
    const moje = wybory.filter((w) => w.droga === droga);
    return {
      droga,
      wybranych: moje.length,
      zatwierdzonych: moje.filter((w) => trafione.has(w)).length,
    };
  });
}

/**
 * Minuty od PYTANIA KLIENTA do wyboru kandydata.
 *
 * Punkt zero to OSTATNIA wiadomość klienta przed wyborem, nie pierwsza w wątku
 * — i to jest definicja zegara, którą repozytorium ma już zapisaną przy
 * `pytanieAt` w `skrzynka.ts`: liczenie od początku wątku dałoby „zegar,
 * którego nikt nie odmierza". Rozmowa ciągnąca się od stycznia mierzyłaby wiek
 * relacji z klientem, nie pracę nad doborem.
 *
 * `sent_at` przychodzi z Allegro dosłownie, `created_at` zdarzenia stawia nasz
 * serwer — dwa różne zegary, więc różnicę liczy `julianday()`, nigdy
 * porównanie tekstu. Ujemne odpadają: to znaczy, że wybór poprzedza pytanie,
 * czyli że któryś z zegarów skłamał.
 *
 * Wybór w rozmowie skasowanej przez retencję nie ma z czym się porównać
 * i wypada — dlatego `wyborowZCzasem` jedzie w raporcie obok mediany.
 */
function czasyDoWyboru(
  database: DatabaseSync, wybory: ZdarzenieWyboru[],
): Map<ZdarzenieWyboru, number> {
  const pytanie = database.prepare(
    `SELECT MAX(sent_at) v FROM message
     WHERE conversation_id=? AND direction='incoming' AND sent_at <= ?`);
  const out = new Map<ZdarzenieWyboru, number>();
  for (const w of wybory) {
    const p = pytanie.get(w.conversationId, w.at) as { v: string | null } | undefined;
    if (!p?.v) continue;
    const minut = (Date.parse(w.at) - Date.parse(p.v)) / 60000;
    if (Number.isFinite(minut) && minut >= 0) out.set(w, minut);
  }
  return out;
}

/**
 * ── DLACZEGO PODZIAŁ NA OSOBY MA TRZY HAMULCE ───────────────────────────────
 * Decyzja właściciela: raport ma pokazywać, kto jak pracuje. `raporty.ts`
 * zapisuje już, czym taki pomiar JEST — monitoringiem pracowniczym wg art. 22²
 * Kodeksu pracy, wymagającym zapisu w regulaminie i uprzedzenia pracowników.
 * Stąd `podstawaPrawna` w ładunku: karta ma to powiedzieć, a nie pozwolić
 * czytelnikowi zapomnieć.
 *
 * Drugi hamulec to PRÓG: mediana z czterech doborów jest szumem, który przy
 * nazwisku i tak zostanie przeczytany jako werdykt o człowieku.
 *
 * Trzeci to BRAK LICZBY RANKINGOWEJ. Nie ma tu tempa ani skuteczności per
 * osoba. `najczestszaDroga` mówi „Ola kończy na wyszukiwarce, Ala na wiedzy"
 * — czyli komu warto pokazać bazę wiedzy. Kolumna, po której da się posortować
 * ludzi od najlepszego do najgorszego, odpowiadałaby na inne pytanie niż to,
 * które ten raport zadaje.
 *
 * Grupujemy po `user_ref` (koncie), nigdy po nazwisku z `user_id`: „Jan",
 * „jan" i „Jan K" byłyby trzema osobami — antywzorzec nazwany w `raporty.ts`.
 */
function osoby(
  wybory: ZdarzenieWyboru[], trafione: Set<ZdarzenieWyboru>, czasy: Map<ZdarzenieWyboru, number>,
): WierszOsoby[] {
  const konta = new Map<number, ZdarzenieWyboru[]>();
  for (const w of wybory) {
    if (w.userRef === null) continue;
    konta.set(w.userRef, [...(konta.get(w.userRef) ?? []), w]);
  }
  return [...konta.entries()]
    .map(([userId, moje]) => {
      const licznik = new Map<DrogaDoboru, number>();
      for (const w of moje) {
        if (w.droga) licznik.set(w.droga, (licznik.get(w.droga) ?? 0) + 1);
      }
      const naj = [...licznik.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      const mojeMinuty = moje.map((w) => czasy.get(w)).filter((m): m is number => m !== undefined);
      return {
        userId,
        osoba: moje[0].osoba,
        wybranych: moje.length,
        zatwierdzonych: moje.filter((w) => trafione.has(w)).length,
        najczestszaDroga: naj ? naj[0] : null,
        medianaMin: moje.length >= PROG_WIARYGODNOSCI ? zaokraglij(mediana(mojeMinuty)) : null,
      };
    })
    .sort((a, b) => b.wybranych - a.wybranych || a.osoba.localeCompare(b.osoba));
}

/**
 * Co leży na stole TERAZ — jedyna liczba brana z `dobor_rozmowy`.
 *
 * Osobne pole i osobna nazwa, bo to inna populacja niż reszta raportu: bez
 * okna czasowego i bez rozmów skasowanych przez retencję. Doklejenie tego do
 * liczb historycznych sugerowałoby, że sumują się do jednej całości.
 */
function naStole(database: DatabaseSync): SkutecznoscDoboru["naStole"] {
  const poStatusie = new Map((database.prepare(
    "SELECT status, count(*) n FROM dobor_rozmowy GROUP BY status").all() as
    Array<{ status: string; n: number }>).map((r) => [r.status, Number(r.n)]));
  return {
    doborow: [...poStatusie.values()].reduce((a, b) => a + b, 0),
    /* WSZYSTKIE dziewięć statusów, także z zerem: status, który zniknął z listy,
       czyta się jako „nie ma takiego stanu", a nie „nikt w nim nie utknął". */
    statusy: STATUSY_DOBORU.map((status) => ({ status, ile: poStatusie.get(status) ?? 0 })),
  };
}
