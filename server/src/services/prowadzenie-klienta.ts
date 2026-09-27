import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { chwilaUtc, czasLokalny, dataLokalna } from "../czas.js";
import { kontaLoginu, rozmowyPoLoginie } from "./klient-historia.js";
import { podziekowanieKlienta } from "./conversations.js";
import { mojeSprawy, ROZMOWA_ZAMOWIENIA, type MojaSprawa } from "./droga-klienta.js";
import {
  DOSYLKI_SQL, dzienMiesiac, naDosylkeSprawy, najwazniejszaDosylka, OKNO_SLEDZENIA_MS, pilnaDosylka,
  type DosylkaSprawy,
} from "./dosylka-opis.js";

/* ── Sprawa klienta: kto prowadzi, następny krok, zakończenie (0.535.0) ─────
   S6 `docs/obsluga-klienta-calosc.md`, decyzja właściciela. Kolejki mówią, co
   czeka w każdej z nich z osobna, ale nie mówią, co z KLIENTEM: „czekamy na
   zwrot, potem dosyłamy” żyło w głowie agenta albo w notatce, której nic nie
   pilnuje. Sprawa klienta to JEDEN wiersz na login z następnym krokiem
   i terminem — nie piąta kolejka ze wspólnym statusem nad czterema.

   DWA STANY, NIE SŁOWNIK. „W toku” zawsze ma krok z datą, „zakończona” nie
   ma biegnącego kroku. Status bez następnego kroku to lista rzeczy „w toku”,
   na które nikt nie patrzy — dokładnie ten kształt, który kosztował cztery
   tabele nakładki spraw (blizna 0.140.0).

   NOWE LICZY SIĘ PRZY ODCZYCIE, nie tickerem. W wierszu leży ODCISK faktów
   po stronie klienta z chwili ostatniego ruchu człowieka (`znane_json`),
   a „nowe” to różnica między nim a odciskiem teraz. Zakończona sprawa
   z nowym zdarzeniem wraca na „Moje” prowadzącego sama — ticker, który raz
   nie wstanie, zostawiłby ją zakończoną na zawsze.

   OKNO OBUDZENIA: TRZYDZIEŚCI DNI OD ZAKOŃCZENIA (decyzja właściciela
   z 27 września 2026, S6). Decyzja z 26 września mówiła o obudzeniu bez
   granicy; okno ją zawęża z powodu niżej. „Moje” liczy odcisk prowadzonych spraw przy każdym
   odświeżeniu, co 30 sekund, synchronicznie na pętli serwera. Bez granicy
   ten koszt rósłby z każdą sprawą zakończoną kiedykolwiek. Miesiąc mieści
   ustawowe 14 dni na odstąpienie i drogę paczki z powrotem. Później nowa
   wiadomość to nowa sprawa: pokazuje ją skrzynka, a agent zaczyna od kroku.

   ZNACZNIK BEZ STREFY TO UTC (`chwilaUtc`), jak w `julianday`. Porządek
   wiadomości liczy SQL, a próg obudzenia — kod; dwa zegary rozjechałyby
   się latem o dwie godziny na każdym napisie `'RRRR-MM-DD GG:MM:SS'`.

   ODCISK NIE UFA DATOM ALLEGRO. Część z nich jest zmyślona przez nasze
   `?? at` przy mapowaniu i nadpisywana przy każdej synchronizacji, więc
   zwroty i sprawy liczy się SZTUKAMI. Wiadomość idzie po NASZYM czasie
   wstawienia: import z opóźnieniem budzi (nie wiedzieliśmy o niej), a rozmowa
   dowiązana wstecz ręcznym wskazaniem zamówienia nie budzi (wiedzieliśmy).

   PODZIĘKOWANIE NIE BUDZI. „Dziękuję” to rozstrzygnięcie, nie powrót klienta
   (S5a) — ta sama reguła co zakończenie rozmowy w skrzynce, bez drugiej kopii.

   PRYWATNOŚĆ. Do dziennika idzie numer sprawy, długość kroku i termin —
   NIGDY login ani treść kroku. `events` nie ma retencji, a krok bywa zdaniem
   o człowieku (polityka w `docs/obsluga-klienta.md`).

   Ten plik NIE importuje profilu (`profil-klienta.ts` czyta stąd), a
   `droga-klienta.ts` nie importuje tego pliku. Pętla importów przy stałej
   liczonej w chwili ładowania modułu bywa pustym zbiorem — blizna opisana
   w `statusy-spraw.ts`.

   DOSYŁKA (0.536.0) mieszka w `dosylka.ts`, który importuje ten plik —
   więc tu jest wyłącznie SQL na `klient_dosylka` i zdanie z czystego
   `dosylka-opis.ts`. Doręczenie dosyłki i kłopot u przewoźnika budzą sprawę.
   To POSZERZENIE reguły z 26 września, nie jej przypadek: dosyłkę wysyła
   biuro, więc to nasz ruch, ale jej los zgłasza przewoźnik. Stoi jawnie
   w S6, do oceny właściciela. */

export interface NoweZdarzenie {
  rodzaj: "rozmowa" | "zwrot_nowy" | "zwrot_nadany" | "zwrot_dotarl" | "reklamacja" | "dyskusja"
    | "wiadomosc_sprawy" | "dosylka_doreczona" | "dosylka_problem";
  /** Zdanie panelu, jego słowami: „Klient napisał 26.09 14:10”, „Zwrot dotarł”. */
  tekst: string;
  at: string | null;
  /** Ekran źródła — tam się zdarzenie załatwia. */
  cel: string | null;
}

export interface SprawaKlienta {
  id: number;
  login: string;
  wersja: number;
  stan: "w_toku" | "zakonczona";
  krok: string;
  krokDo: string;
  /** Termin kroku wypada dziś (doba lokalna magazynu); tylko w toku. */
  dzis: boolean;
  /** Termin kroku minął przed dzisiejszą dobą; tylko w toku. */
  poTerminie: boolean;
  prowadzi: string | null;
  prowadziId: number | null;
  zakonczonoAt: string | null;
  zakonczyl: string | null;
  /** Co klient (albo Allegro) zrobił po ostatnim ruchu człowieka — od najnowszego. */
  nowe: NoweZdarzenie[];
  /** Odcisk, który ekran narysował; zapis, który potwierdza, odsyła go z powrotem (dekalog 4). */
  odcisk: string;
  /** Dosyłki bieżącego epizodu sprawy w toku, od najnowszej; zakończona nie ma biegnącej dosyłki, więc pusta lista. */
  dosylki: DosylkaSprawy[];
}

/** Krok to jedno zdanie na wiersz „Moje”, nie akta sprawy. */
export const LIMIT_KROKU = 200;
/* Dostawca potrafi czekać tygodniami, więc krok „czekamy na dostawcę” musi
   się zmieścić. Dalej niż dwa miesiące to już nie jest następny krok, tylko
   odłożenie sprawy bez daty — a takiego stanu model nie zna. */
export const NAJDLUZSZY_KROK_DNI = 60;

/** Zapis odrzucony, bo ktoś zmienił sprawę albo klient dopisał coś po otwarciu ekranu. */
export class KonfliktSprawy extends Error {
  constructor(message: string, readonly sprawa: SprawaKlienta | null) {
    super(message);
    this.name = "KonfliktSprawy";
  }
}

/** Login nie występuje w żadnej z czterech kolejek — sprawy nie ma do czego przypiąć. */
export class BrakKlienta extends Error {
  constructor() {
    super("Nie znamy klienta o takim loginie");
    this.name = "BrakKlienta";
  }
}

/* Treści błędów są STAŁE: trasa oddaje je w 400, a powód odrzucenia ląduje
   w `events` (`http_rejected`). Login albo krok w komunikacie byłby
   wyciekiem tylnymi drzwiami. */
export class BladSprawy extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BladSprawy";
  }
}

type Wiersz = Record<string, unknown>;
type Autor = { id: number; name: string };

const DZIEN = 86_400_000;
const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/* ── Odcisk ─────────────────────────────────────────────────────────────── */

/**
 * Fakty po stronie klienta, z których wynika „nowe”. Kolejność kluczy jest
 * stała, bo odcisk porównuje się jako napis — ten sam stan daje ten sam JSON.
 */
interface Odcisk {
  /** Czas WSTAWIENIA u nas najnowszej wiadomości klienta (bez podziękowania). */
  m: string | null;
  /** Zwroty z Allegro (nie paczki nieodebrane — te zakłada biuro). */
  z: number;
  /** …z nich nadane przez klienta. */
  p: number;
  /** …z nich doręczone do nas. */
  d: number;
  /** Reklamacje. */
  r: number;
  /** Dyskusje. */
  s: number;
  /** Wiadomości klienta albo doradcy Allegro w reklamacjach i dyskusjach. */
  w: number;
  /** Doręczenia dosyłek (0.536.1): suma liczników PRZEJŚĆ z wierszy, która
   *  nigdy nie maleje. Druga doręczona budzi, choć pierwszą ktoś potwierdził,
   *  a zastąpienie wiersza nie cofa licznika, więc nie udaje nowego zdarzenia. */
  k: number;
  /** Wejścia dosyłek w kłopot u przewoźnika (`ISSUE` albo `RETURNED`) — też przejścia. */
  q: number;
}

interface WiadomoscKlienta { rozmowa: number; wstawiono: string; napisano: string }

/**
 * Najnowsza wiadomość klienta po NASZYM czasie wstawienia, z pominięciem
 * podziękowania, na którym stoi rozmowa.
 *
 * Zbiór rozmów jest ten sam co w profilu (`rozmowyPoLoginie` na każdym
 * koncie z `kontaLoginu`), więc sprawa budzi się z tego, co agent widzi na
 * osi klienta — nie z drugiej, ręcznie przepisanej definicji.
 *
 * Podziękowanie sprawdza się LENIWIE, rozmowa po rozmowie, od najnowszej
 * wiadomości: zwykle wystarcza jedno pytanie, a pełny przegląd wszystkich
 * rozmów przy każdym wierszu „Moje” kosztowałby na każdym odświeżeniu.
 */
function ostatniaWiadomoscKlienta(database: DatabaseSync, login: string): WiadomoscKlienta | null {
  const rozmowy = new Set<number>();
  for (const konto of new Set(kontaLoginu(database, login).map((k) => k.konto))) {
    for (const r of rozmowyPoLoginie(database, konto, login)) rozmowy.add(r.id);
  }
  if (rozmowy.size === 0) return null;
  const id = [...rozmowy];
  /* `julianday`, nie porządek napisów: znaczniki porównuje się jako chwile,
     także tam, gdzie kolumna ma dziś jeden format — jutro może mieć dwa. */
  const kandydaci = database.prepare(`
    SELECT id, conversation_id, created_at, sent_at FROM message
     WHERE direction = 'incoming' AND conversation_id IN (${id.map(() => "?").join(",")})
     ORDER BY julianday(created_at) DESC, id DESC`).all(...id) as Wiersz[];

  /* PODZIĘKOWANIE NIE BUDZI (S5a) — ale rozstrzyga o tym WIADOMOŚĆ, nie
     stan rozmowy. `podziekowanieKlienta` to dokładnie wejście `podziekowal`
     statusu rozmowy, bez werdyktu agenta i bez „Otwórz ponownie”. Po stanie
     rozmowy sprawa budziła się od NASZEGO kliknięcia w skrzynce, a ekran
     otwarty chwilę wcześniej dostawał 409 bez niczego nowego. Nowszy dopisek
     klienta zdejmuje podziękowanie, więc wtedy nic tu nie jest pomijane. */
  const podziekowanie = new Map<number, number | null>();
  for (const w of kandydaci) {
    const rozmowa = Number(w.conversation_id);
    if (!podziekowanie.has(rozmowa)) podziekowanie.set(rozmowa, podziekowanieKlienta(database, rozmowa));
    if (podziekowanie.get(rozmowa) === Number(w.id)) continue;
    return { rozmowa, wstawiono: String(w.created_at), napisano: String(w.sent_at) };
  }
  return null;
}

type Licznik = keyof Omit<Odcisk, "m">;

/**
 * Osiem liczników odcisku jako wyrażenia SQL po loginie `l` — parametrze
 * albo kolumnie. JEDNA definicja dla odcisku i dla sita „Moje” (`wierszeMoich`):
 * sito z drugiej, ręcznie przepisanej kopii mogłoby odrzucić sprawę, którą
 * odcisk budzi, a takie obudzenie przepadłoby bez śladu.
 *
 * Po loginie na wszystkich kontach naraz — tak samo jak liczby profilu.
 * SZTUKI, nie daty: kasowanie zwrotów rozliczonych (ręczne i rzadkie) może
 * zjeść jedno obudzenie, a zmyślona data budziłaby przy każdej synchronizacji.
 * Licznik `w` jest bez typu: wiadomość klienta liczy się w reklamacji i w
 * dyskusji jednakowo, bo obie czekają na naszą odpowiedź.
 *
 * `k` i `q` (0.536.1) sumują liczniki przejść dosyłek tego loginu, także
 * archiwalnych. Dosyłkę zakłada biuro, ale doręczenie i kłopot zgłasza
 * przewoźnik — to jedyne fakty dosyłki, o których prowadzący może nie
 * wiedzieć. Suma PRZEJŚĆ, nie wierszy w stanie: kłopot, potem „w drodze”,
 * potem znów kłopot budzi dwa razy, a zastąpiony wiersz nie odejmuje nic.
 * `coalesce`, bo `sum` po pustym zbiorze to NULL, a NULL w sicie nie budzi.
 */
const LICZNIKI = (l: string): Record<Licznik, string> => ({
  z: `(SELECT count(*) FROM zwrot_klienta
        WHERE kupujacy_login = ${l} COLLATE NOCASE AND zrodlo = 'allegro')`,
  p: `(SELECT count(*) FROM zwrot_klienta
        WHERE kupujacy_login = ${l} COLLATE NOCASE AND zrodlo = 'allegro' AND paczka_at IS NOT NULL)`,
  d: `(SELECT count(*) FROM zwrot_klienta
        WHERE kupujacy_login = ${l} COLLATE NOCASE AND zrodlo = 'allegro' AND dostarczono_at IS NOT NULL)`,
  r: `(SELECT count(*) FROM reklamacja_klienta
        WHERE kupujacy_login = ${l} COLLATE NOCASE AND typ = 'CLAIM')`,
  s: `(SELECT count(*) FROM reklamacja_klienta
        WHERE kupujacy_login = ${l} COLLATE NOCASE AND typ = 'DISPUTE')`,
  w: `(SELECT count(*) FROM reklamacja_wiadomosc rw JOIN reklamacja_klienta rk ON rk.id = rw.reklamacja_id
        WHERE rk.kupujacy_login = ${l} COLLATE NOCASE AND rw.autor_rola IN ('BUYER','ADMIN'))`,
  k: `(SELECT coalesce(sum(kd.doreczen), 0) FROM klient_dosylka kd JOIN klient_prowadzenie kp ON kp.id = kd.sprawa_id
        WHERE kp.login = ${l} COLLATE NOCASE)`,
  q: `(SELECT coalesce(sum(kd.problemow), 0) FROM klient_dosylka kd JOIN klient_prowadzenie kp ON kp.id = kd.sprawa_id
        WHERE kp.login = ${l} COLLATE NOCASE)`,
});

function policzOdcisk(
  database: DatabaseSync, login: string,
): { odcisk: Odcisk; wiadomosc: WiadomoscKlienta | null } {
  const wiadomosc = ostatniaWiadomoscKlienta(database, login);
  const n = database.prepare(`SELECT ${Object.entries(LICZNIKI("?1"))
    .map(([k, sql]) => `${sql} AS ${k}`).join(",\n")}`).get(login) as Record<Licznik, number>;
  return {
    odcisk: {
      m: wiadomosc?.wstawiono ?? null,
      z: Number(n.z), p: Number(n.p), d: Number(n.d), r: Number(n.r), s: Number(n.s), w: Number(n.w),
      k: Number(n.k), q: Number(n.q),
    },
    wiadomosc,
  };
}

/* Klucze `k` i `q` doszły w 0.536.0, więc odcisk każdej sprawy zmienił
   napis: ekran otwarty w chwili aktualizacji dostaje raz 409 ze świeżą
   sprawą. Zapamiętany odcisk bez tych kluczy nie budzi (`noweZdarzenia`). */
const naNapis = (o: Odcisk): string =>
  JSON.stringify({ m: o.m, z: o.z, p: o.p, d: o.d, r: o.r, s: o.s, w: o.w, k: o.k, q: o.q });

/** Odcisk faktów po stronie klienta w tej chwili (JSON) — ten sam, który niesie `SprawaKlienta.odcisk`. */
export function odciskTeraz(login: string, database: DatabaseSync = defaultDb()): string {
  return naNapis(policzOdcisk(database, login.trim()).odcisk);
}

/** Najnowszy wiersz źródła, który podbił licznik — tam prowadzi odnośnik zdarzenia. */
function najnowszy(database: DatabaseSync, sql: string, login: string): Wiersz | undefined {
  return database.prepare(sql).get(login) as Wiersz | undefined;
}

/**
 * Co zdarzyło się po ostatnim ruchu człowieka — od najnowszego.
 *
 * Wiadomość liczy się, gdy wstawiliśmy ją PO ostatnim ruchu przy sprawie,
 * a nie tylko po zapamiętanym odcisku. Rozmowa dowiązana wstecz może nieść
 * wiadomość młodszą od odcisku, a starszą od ruchu człowieka — o tej
 * wiedzieliśmy, więc „Klient napisał” byłoby nieprawdą. Oba zegary są
 * zegarem serwera: `message.created_at` i `zmieniono_at`.
 */
function noweZdarzenia(
  database: DatabaseSync, login: string, znane: Partial<Odcisk>, biezacy: Odcisk,
  wiadomosc: WiadomoscKlienta | null, zmienionoAt: string,
): NoweZdarzenie[] {
  const nowe: NoweZdarzenie[] = [];
  /* `chwilaUtc`, nie `Date.parse`: `created_at` bez strefy SQL czyta jako
     UTC, a `Date.parse` jako czas maszyny — próg i sito „Moje” (`julianday`)
     mówiłyby wtedy o dwóch różnych chwilach. */
  const granica = Math.max(
    znane.m ? chwilaUtc(znane.m) : Number.NEGATIVE_INFINITY, chwilaUtc(zmienionoAt));
  if (wiadomosc && biezacy.m && chwilaUtc(biezacy.m) > granica) {
    const t = chwilaUtc(wiadomosc.napisano);
    const napisano = Number.isFinite(t) ? new Date(t).toISOString() : wiadomosc.napisano;
    const dzien = dataLokalna(napisano).split("-").reverse().slice(0, 2).join(".");
    nowe.push({ rodzaj: "rozmowa", tekst: `Klient napisał ${dzien} ${czasLokalny(napisano)}`,
      at: napisano, cel: `/obsluga/skrzynka/${wiadomosc.rozmowa}` });
  }
  /* Klucz nieobecny w zapamiętanym odcisku (pole dołożone w późniejszym
     wydaniu) NIE budzi: inaczej każda zakończona sprawa wróciłaby naraz. */
  const urosl = (k: keyof Omit<Odcisk, "m">) => typeof znane[k] === "number" && biezacy[k] > znane[k]!;

  const ZWROT = `FROM zwrot_klienta WHERE kupujacy_login = ? COLLATE NOCASE AND zrodlo = 'allegro'`;
  if (urosl("z")) {
    const w = najnowszy(database, `SELECT id, created_at AS at ${ZWROT}
      ORDER BY julianday(created_at) DESC, id DESC LIMIT 1`, login);
    nowe.push({ rodzaj: "zwrot_nowy", tekst: "Nowy zwrot", at: tekst(w?.at), cel: w ? `/obsluga/zwroty/${w.id}` : null });
  }
  if (urosl("p")) {
    const w = najnowszy(database, `SELECT id, paczka_at AS at ${ZWROT} AND paczka_at IS NOT NULL
      ORDER BY julianday(paczka_at) DESC, id DESC LIMIT 1`, login);
    nowe.push({ rodzaj: "zwrot_nadany", tekst: "Klient nadał zwrot", at: tekst(w?.at),
      cel: w ? `/obsluga/zwroty/${w.id}` : null });
  }
  if (urosl("d")) {
    const w = najnowszy(database, `SELECT id, dostarczono_at AS at ${ZWROT} AND dostarczono_at IS NOT NULL
      ORDER BY julianday(dostarczono_at) DESC, id DESC LIMIT 1`, login);
    nowe.push({ rodzaj: "zwrot_dotarl", tekst: "Zwrot dotarł", at: tekst(w?.at),
      cel: w ? `/obsluga/zwroty/${w.id}` : null });
  }
  /* Reklamacja i dyskusja mają osobne liczniki i osobne zdania — to dwa
     różne byty, a jedna etykieta na oba to blizna 0.121.0. */
  for (const [k, typ, rodzaj, zdanie, sciezka] of [
    ["r", "CLAIM", "reklamacja", "Nowa reklamacja", "reklamacje"],
    ["s", "DISPUTE", "dyskusja", "Nowa dyskusja", "dyskusje"],
  ] as const) {
    if (!urosl(k)) continue;
    const w = database.prepare(`SELECT id, otwarto_at AS at FROM reklamacja_klienta
      WHERE kupujacy_login = ? COLLATE NOCASE AND typ = ?
      ORDER BY julianday(otwarto_at) DESC, id DESC LIMIT 1`).get(login, typ) as Wiersz | undefined;
    nowe.push({ rodzaj, tekst: zdanie, at: tekst(w?.at), cel: w ? `/obsluga/${sciezka}/${w.id}` : null });
  }
  if (urosl("w")) {
    /* bez typu: wiadomość klienta budzi sprawę tak samo w reklamacji jak
       w dyskusji. Rodzaj wychodzi kolumną `typ` do zdania i do odnośnika. */
    const w = najnowszy(database, `SELECT k.id, k.typ, w.autor_rola AS rola, w.utworzono_at AS at
      FROM reklamacja_wiadomosc w JOIN reklamacja_klienta k ON k.id = w.reklamacja_id
      WHERE k.kupujacy_login = ? COLLATE NOCASE AND w.autor_rola IN ('BUYER','ADMIN')
      ORDER BY julianday(w.utworzono_at) DESC, w.id DESC LIMIT 1`, login);
    const dyskusja = String(w?.typ) === "DISPUTE";
    /* Doradca Allegro (`ADMIN`) to nie klient — zdanie mówi, kto pisał. */
    const kto = String(w?.rola) === "ADMIN" ? "Allegro napisało" : "Klient napisał";
    nowe.push({ rodzaj: "wiadomosc_sprawy", tekst: `${kto} w ${dyskusja ? "dyskusji" : "reklamacji"}`,
      at: tekst(w?.at), cel: w ? `/obsluga/${dyskusja ? "dyskusje" : "reklamacje"}/${w.id}` : null });
  }
  /* Dosyłka (0.536.0). Odnośnika nie ma: dosyłka stoi na karcie sprawy,
     a sprawa i tak prowadzi na profil — `cel: null` znaczy „tu, na profilu”. */
  const DOSYLKA = `FROM klient_dosylka d JOIN klient_prowadzenie p ON p.id = d.sprawa_id
    WHERE p.login = ? COLLATE NOCASE`;
  if (urosl("k")) {
    const w = najnowszy(database, `SELECT d.dostarczono_at AS at, d.sprawdzono_at AS zapisano
      ${DOSYLKA} AND d.dostarczono_at IS NOT NULL
      ORDER BY julianday(COALESCE(d.sprawdzono_at, d.dostarczono_at)) DESC LIMIT 1`, login);
    /* Data tylko przy doręczeniu PO ostatnim ruchu człowieka. Licznik rośnie
       też za dosyłkę, którą nowa odmowa zastąpiła — jej daty już nie ma,
       a data najnowszej ZNANEJ przypisałaby obudzenie dosyłce potwierdzonej.

       „Po ruchu” liczy się chwilą, w której SERWER zapisał doręczenie
       (`sprawdzono_at`), nie datą kuriera (0.536.1). Numer wpisany w poniedziałek
       do paczki doręczonej w piątek dawał doręczenie „sprzed” wpisania — więc
       bez daty i na końcu listy. Oba zegary po stronie serwera, jak przy
       wiadomościach klienta. */
    const at = tekst(w?.at);
    const zapisano = tekst(w?.zapisano) ?? at;
    const nowa = at !== null && zapisano !== null && chwilaUtc(zapisano) > chwilaUtc(zmienionoAt);
    nowe.push({ rodzaj: "dosylka_doreczona", tekst: nowa ? `Dosyłka doręczona ${dzienMiesiac(at)}` : "Dosyłka doręczona",
      at: nowa ? at : null, cel: null });
  }
  if (urosl("q")) {
    /* Chwila kłopotu to chwila, w której się o nim dowiedzieliśmy — przewoźnik
       podaje `occurredAt`, ale zapisujemy wynik, nie historię. */
    const w = najnowszy(database, `SELECT d.status, d.sprawdzono_at AS at ${DOSYLKA}
      AND d.status IN ('ISSUE','RETURNED') ORDER BY julianday(d.sprawdzono_at) DESC LIMIT 1`, login);
    nowe.push({ rodzaj: "dosylka_problem", at: tekst(w?.at), cel: null,
      tekst: String(w?.status) === "RETURNED" ? "Dosyłka wraca do nadawcy"
        : "Problem z dosyłką: przewoźnik zgłosił kłopot" });
  }
  return nowe.sort((a, b) => chwila(b.at, Number.NEGATIVE_INFINITY) - chwila(a.at, Number.NEGATIVE_INFINITY));
}

/** Chwila jako liczba; pusta albo niepoprawna dostaje wartość zastępczą, żeby sortowanie nie kłamało po cichu. */
const chwila = (at: string | null | undefined, zastepcza: number): number => {
  const t = chwilaUtc(at);
  return Number.isFinite(t) ? t : zastepcza;
};

/**
 * Zakończona sprawa budzi się tylko w oknie od zakończenia — powód
 * w nagłówku pliku. Granica WŁĄCZNIE, na milisekundzie `zakonczono_at`.
 */
export const OKNO_OBUDZENIA_DNI = 30;

const wOknieObudzenia = (zakonczonoAt: unknown, teraz: Date): boolean =>
  teraz.getTime() - chwilaUtc(zakonczonoAt == null ? null : String(zakonczonoAt)) <= OKNO_OBUDZENIA_DNI * DZIEN;

/* ── Odczyt ─────────────────────────────────────────────────────────────── */

/** Wiersz sprawy po loginie, bez wielkości liter. Eksport dla `dosylka.ts`, który pisze w tej samej transakcji. */
export function wierszSprawy(database: DatabaseSync, login: string): Wiersz | undefined {
  return database.prepare("SELECT * FROM klient_prowadzenie WHERE login = ? COLLATE NOCASE")
    .get(login) as Wiersz | undefined;
}

/**
 * Dosyłki BIEŻĄCEGO epizodu sprawy, od najnowszej. Archiwalne odchodzą:
 * dosyłka sprzed wznowienia nie ma kroku, na który czeka, a jej „brak
 * numeru od 60 dni” wołałby w nowej sprawie o numer, którego nikt nie wpisze.
 * Kolejność po `julianday`, jak każde porównanie chwil w tym pliku.
 */
function dosylkiSprawy(database: DatabaseSync, id: number, teraz: Date): DosylkaSprawy[] {
  return (database.prepare(`${DOSYLKI_SQL} WHERE d.sprawa_id = ? AND d.archiwalna = 0
      ORDER BY julianday(d.zalozono_at) DESC, d.zamowienie`).all(id) as Wiersz[])
    .map((w) => naDosylkeSprawy(w, teraz));
}

function zbudujSprawe(database: DatabaseSync, w: Wiersz, teraz: Date): SprawaKlienta {
  const login = String(w.login);
  const { odcisk, wiadomosc } = policzOdcisk(database, login);
  let znane: Partial<Odcisk> = {};
  try { znane = JSON.parse(String(w.znane_json)) as Partial<Odcisk>; } catch { /* uszkodzony — nic nie budzi */ }
  const stan = w.zakonczono_at == null ? "w_toku" as const : "zakonczona" as const;
  const krokDo = String(w.krok_do);
  /* Doba LOKALNA magazynu, nie UTC: krok „na jutro” ustawiony wieczorem
     świeciłby „po terminie” o północy Greenwich, dwie godziny za wcześnie. */
  const dzien = Date.parse(dataLokalna(teraz.toISOString()));
  const dzienKroku = Date.parse(dataLokalna(krokDo));
  return {
    id: Number(w.id), login, wersja: Number(w.wersja), stan,
    krok: String(w.krok), krokDo,
    dzis: stan === "w_toku" && dzienKroku === dzien,
    poTerminie: stan === "w_toku" && dzienKroku < dzien,
    prowadzi: tekst(w.prowadzi),
    prowadziId: w.prowadzi_user_id == null ? null : Number(w.prowadzi_user_id),
    zakonczonoAt: tekst(w.zakonczono_at), zakonczyl: tekst(w.zakonczyl),
    /* Poza oknem zakończona sprawa nie ma „nowego” W OGÓLE, nie tylko na
       „Moje”: profil, linijka przy źródle i lista mówią jedno. Odcisk liczy
       się dalej, bo krok od nowa i tak sprawdza świeżość ekranu. */
    nowe: stan === "w_toku" || wOknieObudzenia(w.zakonczono_at, teraz)
      ? noweZdarzenia(database, login, znane, odcisk, wiadomosc, String(w.zmieniono_at))
      : [],
    odcisk: naNapis(odcisk),
    /* Zakończona sprawa nie śledzi dosyłki (ticker jej nie pyta), więc stan
       na karcie byłby zatrzymanym zegarem udającym bieżący. */
    dosylki: stan === "w_toku" ? dosylkiSprawy(database, Number(w.id), teraz) : [],
  };
}

/**
 * Sprawa klienta po loginie (bez wielkości liter) albo `null`, gdy jej nie ma.
 * ODCZYT: zero zapisu, bo „nowe” wylicza się z odcisku, a nie z flagi.
 */
export function sprawaKlienta(
  login: string, teraz = new Date(), database: DatabaseSync = defaultDb(),
): SprawaKlienta | null {
  const l = login.trim();
  if (!l) return null;
  const w = wierszSprawy(database, l);
  return w ? zbudujSprawe(database, w, teraz) : null;
}

/* ── Zapis ──────────────────────────────────────────────────────────────── */

/** Login tak, jak zapisało go Allegro; nieznany login to `BrakKlienta`. */
export function loginZAllegro(database: DatabaseSync, login: string): string {
  const konta = kontaLoginu(database, login.trim());
  if (konta.length === 0) throw new BrakKlienta();
  return konta[0].login;
}

/**
 * `wersja` 0 znaczy „wiersza jeszcze nie ma”. Rozjazd to 409 ze świeżą
 * sprawą — ekran przegranego rysuje ją od razu, bez drugiego żądania.
 */
function sprawdzWersje(
  database: DatabaseSync, w: Wiersz | undefined, wersja: number, login: string, teraz: Date,
): void {
  if ((w ? Number(w.wersja) : 0) !== wersja) {
    throw new KonfliktSprawy("Sprawę zmienił ktoś inny — odśwież", sprawaKlienta(login, teraz, database));
  }
}

/**
 * Zapis, który potwierdza stan klienta, musi znać odcisk z ekranu (dekalog 4).
 * Agent nie zakończy sprawy, nie widząc wiadomości, która przyszła po
 * otwarciu profilu. Dotyczy KAŻDEGO z czterech zapisów: wiadomość klienta nie
 * podbija `wersji`, więc sama wersja przepuściłaby przejęcie albo „Cofnij”
 * z ekranu sprzed tej wiadomości — i zapis zgasiłby ją bez świadka.
 *
 * Przy PIERWSZYM kroku (wiersza nie ma) odcisku się nie sprawdza: ekran bez
 * sprawy nie miał czego narysować ani odesłać, a nowy wiersz niczego
 * wcześniej nie potwierdzał.
 */
function sprawdzOdcisk(
  database: DatabaseSync, w: Wiersz | undefined, odcisk: string, biezacy: Odcisk,
  login: string, teraz: Date,
): void {
  if (w && naNapis(biezacy) !== odcisk) {
    throw new KonfliktSprawy(tylkoDosylka(odcisk, biezacy)
      ? "Dosyłka zmieniła stan po otwarciu ekranu — sprawdź i zapisz jeszcze raz."
      : "Klient dopisał coś po otwarciu ekranu", sprawaKlienta(login, teraz, database));
  }
}

/**
 * Czy odcisk ekranu różni się od bieżącego WYŁĄCZNIE licznikami dosyłki.
 * Doręczenie albo kłopot zgłasza przewoźnik, nie klient — zdanie „Klient
 * dopisał coś” kazałoby szukać wiadomości, której nie ma. Odcisk ekranu bez
 * `k` i `q` (sprzed 0.536.0) nie przechodzi: tam różnica to nowy kształt.
 */
function tylkoDosylka(odcisk: string, biezacy: Odcisk): boolean {
  let ekran: Partial<Odcisk>;
  try { ekran = JSON.parse(odcisk) as Partial<Odcisk>; } catch { return false; }
  if (!ekran || typeof ekran !== "object" || typeof ekran.k !== "number" || typeof ekran.q !== "number") return false;
  return (["m", "z", "p", "d", "r", "s", "w"] as const).every((k) => ekran[k] === biezacy[k]);
}

/**
 * Obaj strażnicy świeżości naraz — wersja i odcisk z ekranu — dla zapisów
 * dosyłki z profilu (`dosylka.ts`). Ta sama reguła co przy czterech
 * zapisach sprawy, nie druga kopia: wołający jest w otwartej transakcji.
 */
export function sprawdzSwiezosc(
  database: DatabaseSync, w: Wiersz | undefined, p: { wersja: number; odcisk: string },
  login: string, teraz: Date,
): void {
  sprawdzWersje(database, w, p.wersja, login, teraz);
  sprawdzOdcisk(database, w, p.odcisk, policzOdcisk(database, login).odcisk, login, teraz);
}

/** Krok przycięty i termin jako ISO; zły to `BladSprawy` ze stałym zdaniem. */
function poprawnyKrok(krokWpisany: string, krokDoWpisany: string, teraz: Date): { krok: string; krokDo: string } {
  const krok = (krokWpisany ?? "").trim();
  if (krok.length < 1 || krok.length > LIMIT_KROKU) {
    throw new BladSprawy(`Krok ma od 1 do ${LIMIT_KROKU} znaków`);
  }
  const t = Date.parse(krokDoWpisany);
  if (!Number.isFinite(t)) throw new BladSprawy("Termin kroku nie jest datą");
  if (t <= teraz.getTime()) throw new BladSprawy("Termin kroku musi być w przyszłości");
  if (t > teraz.getTime() + NAJDLUZSZY_KROK_DNI * DZIEN) {
    throw new BladSprawy(`Termin kroku najdalej za ${NAJDLUZSZY_KROK_DNI} dni`);
  }
  return { krok, krokDo: new Date(t).toISOString() };
}

/**
 * Zapis kroku w OTWARTEJ transakcji wołającego — jedyne miejsce, które
 * zakłada, wznawia i przestawia sprawę. Woła go `ustawKrok` i odmowa wypłaty
 * z dosyłką (`dosylka.ts`), więc „krok jest jedyną drogą założenia
 * i wznowienia” zostaje prawdą także wtedy, gdy krok stawia ekran zwrotu.
 * Transakcji tu nie ma: `transaction` w `db.ts` to gołe BEGIN IMMEDIATE,
 * a zagnieżdżone BEGIN wywraca się na SQLite.
 *
 * `znane` to odcisk do zapamiętania razem z chwilą ruchu. `null` zostawia
 * oba bez zmian — odmowa ze zwrotu nie potwierdza „nowego”, którego agent
 * na tamtym ekranie nie widział. Nowa sprawa musi dostać odcisk.
 */
export function zapiszKrokSprawy(
  database: DatabaseSync,
  p: { w: Wiersz | undefined; login: string; krok: string; krokDo: string; autor: Autor; teraz: Date;
    znane: string | null; domyslny?: boolean },
): { id: number; nowa: boolean; poprzedniKrok: string | null; wToku: boolean } {
  const { w, krok, krokDo, autor } = p;
  const at = p.teraz.toISOString();
  let id: number;
  if (w) {
    id = Number(w.id);
    /* WZNOWIENIE ZAKOŃCZONEJ ZACZYNA NOWY EPIZOD. Jej SKOŃCZONE dosyłki idą
       do historii, każdą drogą — „Ustaw krok”, odmowa ze zwrotu, propozycja
       z profilu. Bez tego dosyłka sprzed miesięcy stanęłaby na karcie
       i w „Moje” nowej sprawy z „brakiem numeru od 60 dni”. Ślad w dzienniku
       niesie `klient_sprawa_krok` niżej: to jeden ruch, nie dwa.

       Skończona to doręczona, zawrócona albo spoza okna śledzenia. Dosyłka
       w drodze zostaje żywa (0.536.1): agent kończy sprawę, gdy nada
       etykietę, a wznawia, gdy klient pyta „gdzie paczka?”. Odłożona do
       historii przestałaby być śledzona, a panel nie ma jak jej wskrzesić. */
    if (w.zakonczono_at != null) {
      database.prepare(`UPDATE klient_dosylka SET archiwalna = 1
         WHERE sprawa_id = ? AND (dostarczono_at IS NOT NULL OR status = 'RETURNED'
           OR julianday(COALESCE(numer_at, zalozono_at)) < julianday(?))`)
        .run(id, new Date(p.teraz.getTime() - OKNO_SLEDZENIA_MS).toISOString());
    }
    /* Prowadzący zostaje. Ustawia go tylko sprawa bez prowadzącego —
       tak jak odpowiedź przydziela rozmowę od 0.159.0. Zapas dla „Cofnij”
       znika: po nowym kroku nie ma już zakończenia do cofnięcia. */
    database.prepare(`UPDATE klient_prowadzenie SET krok = ?, krok_do = ?,
        zakonczono_at = NULL, zakonczyl = NULL, zakonczyl_user_id = NULL,
        przed_zakonczeniem_znane_json = NULL, przed_zakonczeniem_zmieniono_at = NULL,
        prowadzi = CASE WHEN prowadzi_user_id IS NULL THEN ? ELSE prowadzi END,
        prowadzi_user_id = COALESCE(prowadzi_user_id, ?),
        znane_json = COALESCE(?, znane_json), wersja = wersja + 1,
        zmieniono_at = CASE WHEN ? IS NULL THEN zmieniono_at ELSE ? END,
        zmieniono_przez = CASE WHEN ? IS NULL THEN zmieniono_przez ELSE ? END
      WHERE id = ?`)
      .run(krok, krokDo, autor.name, autor.id, p.znane, p.znane, at, p.znane, autor.name, id);
  } else {
    if (p.znane === null) throw new Error("Nowa sprawa bez odcisku — błąd wołającego");
    id = Number(database.prepare(`INSERT INTO klient_prowadzenie(login, prowadzi, prowadzi_user_id,
        krok, krok_do, znane_json, wersja, zmieniono_at, zmieniono_przez)
      VALUES (?,?,?,?,?,?,1,?,?)`)
      .run(p.login, autor.name, autor.id, krok, krokDo, p.znane, at, autor.name).lastInsertRowid);
  }
  /* `domyslny` tylko wtedy, gdy termin postawił automat — miara z S6 odróżnia
     po nim terminy wybrane od narzuconych. Klucz bez wartości zmieniałby
     kształt wpisu każdego kroku, a z niego liczy się już pierwsza miara. */
  logEvent("klient_sprawa_krok", autor.name, null,
    p.domyslny ? { sprawa: id, znakow: krok.length, termin: krokDo, nowa: !w, domyslny: true }
      : { sprawa: id, znakow: krok.length, termin: krokDo, nowa: !w }, autor.id, database);
  return {
    id, nowa: !w, poprzedniKrok: w ? String(w.krok) : null, wToku: w ? w.zakonczono_at == null : false,
  };
}

/**
 * Ustawia następny krok — JEDYNA droga do założenia i wznowienia sprawy.
 * Sprawa bez kroku nie istnieje: kto nie ma następnego kroku, kończy sprawę.
 */
export function ustawKrok(
  login: string, p: { krok: string; krokDo: string; wersja: number; odcisk: string }, autor: Autor,
  teraz = new Date(), database: DatabaseSync = defaultDb(),
): SprawaKlienta {
  const { krok, krokDo } = poprawnyKrok(p.krok, p.krokDo, teraz);
  const l = loginZAllegro(database, login);

  /* NAWIASY NA KOŃCU: `transaction` zwraca opakowaną funkcję (db.ts). */
  transaction(database, () => {
    const w = wierszSprawy(database, l);
    sprawdzWersje(database, w, p.wersja, l, teraz);
    const { odcisk } = policzOdcisk(database, l);
    sprawdzOdcisk(database, w, p.odcisk, odcisk, l, teraz);
    zapiszKrokSprawy(database, { w, login: l, krok, krokDo, autor, teraz, znane: naNapis(odcisk) });
  })();
  return sprawaKlienta(l, teraz, database)!;
}

/**
 * Ruch człowieka przy dosyłce z PROFILU: odcisk liczony PO zapisie
 * `klient_dosylka` jako „znane”, chwila ruchu teraz. Odcisk ekranu sprawdził
 * wołający PRZED zapisem (`sprawdzSwiezosc`). Odcisk sprzed zapisu zostawiłby
 * różnicę, którą zrobił sam agent — i sprawa obudziłaby się jego ruchem.
 * `podbij` podnosi wersję, gdy nic innego w tym zapisie jej nie podniosło.
 */
export function potwierdzPoZapisie(
  database: DatabaseSync, id: number, login: string, autor: Autor, teraz: Date, podbij: boolean,
): void {
  database.prepare(`UPDATE klient_prowadzenie SET znane_json = ?, zmieniono_at = ?, zmieniono_przez = ?,
      wersja = wersja + ? WHERE id = ?`)
    .run(naNapis(policzOdcisk(database, login).odcisk), teraz.toISOString(), autor.name, podbij ? 1 : 0, id);
}

/**
 * Odmowa ze zwrotu dopisuje do „znanego” brakujące klucze `k` i `q` — i nic
 * poza tym, bo odmowa niczego nie potwierdza.
 *
 * Sprawa sprzed 0.536.0 ma odcisk bez `k` i `q`, a klucz nieobecny nie budzi
 * (`noweZdarzenia`). Odmowa nie zapisuje odcisku, więc bez tego dopisku
 * dosyłka takiej sprawy nie obudziłaby jej nigdy. Liczniki nie maleją, więc
 * zastąpiony wiersz nie wymaga tu żadnej poprawki.
 */
export function wyrownajZnane(database: DatabaseSync, id: number, login: string): void {
  const w = database.prepare("SELECT znane_json FROM klient_prowadzenie WHERE id = ?").get(id) as Wiersz | undefined;
  let znane: Record<string, unknown>;
  try { znane = JSON.parse(String(w?.znane_json)) as Record<string, unknown>; } catch { return; }
  if (!znane || typeof znane !== "object") return;
  if (typeof znane.k === "number" && typeof znane.q === "number") return;
  const biezacy = policzOdcisk(database, login).odcisk;
  for (const k of ["k", "q"] as const) {
    if (typeof znane[k] !== "number") znane[k] = biezacy[k];
  }
  database.prepare("UPDATE klient_prowadzenie SET znane_json = ? WHERE id = ?").run(JSON.stringify(znane), id);
}

/**
 * „Zakończ sprawę”. Krok i termin ZOSTAJĄ w wierszu — cofnięcie z paska
 * (`wznowSprawe`) przywraca je bez pytania agenta drugi raz. Obok zostaje
 * odcisk i chwila ruchu SPRZED zakończenia: „Cofnij” oddaje sprawie jej
 * „nowe”, zamiast potwierdzić je po cichu.
 *
 * ZAKOŃCZONĄ OBUDZONĄ kończy się znów tym samym zapisem. Inaczej jedynym
 * zapisem, który gasi obudzenie, był krok wymyślony na jutro i drugie
 * zakończenie — trzy ruchy i fałszywy wpis `klient_sprawa_krok`, a wiersz
 * stał do tego czasu na samej górze „Moje”. Zakończona BEZ „nowego” dalej
 * dostaje 409: dwa razy tego samego się nie kończy. Wpis dziennika niesie
 * `ponownie: true`, bo z niego liczy się miara z S6 (obudzenie zgaszone
 * w ciągu dziesięciu minut).
 */
export function zakonczSprawe(
  login: string, p: { wersja: number; odcisk: string }, autor: Autor,
  teraz = new Date(), database: DatabaseSync = defaultDb(),
): SprawaKlienta {
  const l = loginZAllegro(database, login);
  transaction(database, () => {
    const w = wierszSprawy(database, l);
    sprawdzWersje(database, w, p.wersja, l, teraz);
    const ponownie = w?.zakonczono_at != null;
    if (!w || (ponownie && zbudujSprawe(database, w, teraz).nowe.length === 0)) {
      throw new KonfliktSprawy("Sprawa nie jest w toku", sprawaKlienta(l, teraz, database));
    }
    const { odcisk } = policzOdcisk(database, l);
    sprawdzOdcisk(database, w, p.odcisk, odcisk, l, teraz);
    const at = teraz.toISOString();
    /* Ponowne zakończenie NIE ma zapasu dla „Cofnij”. Cofnięcie otworzyłoby
       sprawę z krokiem, którego termin zwykle już minął, zamiast przywrócić
       obudzoną zakończoną — więc panel go nie proponuje, a serwer odmawia. */
    database.prepare(`UPDATE klient_prowadzenie SET zakonczono_at = ?, zakonczyl = ?, zakonczyl_user_id = ?,
        prowadzi = CASE WHEN prowadzi_user_id IS NULL THEN ? ELSE prowadzi END,
        prowadzi_user_id = COALESCE(prowadzi_user_id, ?),
        przed_zakonczeniem_znane_json = CASE WHEN ? THEN NULL ELSE znane_json END,
        przed_zakonczeniem_zmieniono_at = CASE WHEN ? THEN NULL ELSE zmieniono_at END,
        znane_json = ?, wersja = wersja + 1, zmieniono_at = ?, zmieniono_przez = ?
      WHERE id = ?`)
      .run(at, autor.name, autor.id, autor.name, autor.id, ponownie ? 1 : 0, ponownie ? 1 : 0,
        naNapis(odcisk), at, autor.name, Number(w.id));
    logEvent("klient_sprawa_zakonczona", autor.name, null,
      ponownie ? { sprawa: Number(w.id), ponownie: true } : { sprawa: Number(w.id) }, autor.id, database);
  })();
  return sprawaKlienta(l, teraz, database)!;
}

/**
 * Cofnięcie zakończenia — pasek „Cofnij” przez osiem sekund po „Zakończ
 * sprawę”. Nie jest drugą drogą wznawiania: sprawę po czasie wznawia się
 * krokiem, bo sprawa bez następnego kroku nie istnieje.
 *
 * PRZYWRACA, NIE POTWIERDZA. Odcisk i chwila ruchu wracają z zapasu sprzed
 * zakończenia. Odcisk liczony od nowa zgasiłby „Klient napisał” z listy,
 * choć nikt klientowi nie odpisał — pomyłka i jej cofnięcie nie mogą
 * załatwić sprawy. Chwila wraca razem z odciskiem, bo granica wiadomości
 * to późniejsza z nich i sama by obudzenie ukryła.
 *
 * Odcisk z ekranu (tu: z odpowiedzi zakończenia) sprawdza się jak wszędzie:
 * wiadomość, która przyszła w tych ośmiu sekundach, daje 409, a sprawa
 * zostaje zakończona i obudzona — tak, jak jest naprawdę.
 */
export function wznowSprawe(
  login: string, p: { wersja: number; odcisk: string }, autor: Autor,
  teraz = new Date(), database: DatabaseSync = defaultDb(),
): SprawaKlienta {
  const l = loginZAllegro(database, login);
  transaction(database, () => {
    const w = wierszSprawy(database, l);
    sprawdzWersje(database, w, p.wersja, l, teraz);
    if (!w || w.zakonczono_at == null) {
      throw new KonfliktSprawy("Sprawa nie jest zakończona", sprawaKlienta(l, teraz, database));
    }
    if (w.przed_zakonczeniem_znane_json == null || w.przed_zakonczeniem_zmieniono_at == null) {
      throw new KonfliktSprawy("Tego zakończenia nie cofa się — ustaw krok", sprawaKlienta(l, teraz, database));
    }
    const { odcisk } = policzOdcisk(database, l);
    sprawdzOdcisk(database, w, p.odcisk, odcisk, l, teraz);
    database.prepare(`UPDATE klient_prowadzenie SET zakonczono_at = NULL, zakonczyl = NULL,
        zakonczyl_user_id = NULL, znane_json = przed_zakonczeniem_znane_json,
        zmieniono_at = przed_zakonczeniem_zmieniono_at,
        przed_zakonczeniem_znane_json = NULL, przed_zakonczeniem_zmieniono_at = NULL,
        wersja = wersja + 1, zmieniono_przez = ?
      WHERE id = ?`)
      .run(autor.name, Number(w.id));
    logEvent("klient_sprawa_wznowiona", autor.name, null, { sprawa: Number(w.id) }, autor.id, database);
  })();
  return sprawaKlienta(l, teraz, database)!;
}

/**
 * „Przejmij” — tylko sprawę w toku, którą prowadzi KTOŚ INNY. Wymaga
 * bieżącej `wersji`, więc przejęcie jest jawne: nikt nie zabierze sprawy
 * koledze przyciskiem na ekranie sprzed jego ruchu. Wymaga też odcisku:
 * przejęcie potwierdza „nowe” (S6), więc wolno mu potwierdzić tylko to,
 * co przejmujący widział.
 */
export function przejmijSprawe(
  login: string, p: { wersja: number; odcisk: string }, autor: Autor,
  teraz = new Date(), database: DatabaseSync = defaultDb(),
): SprawaKlienta {
  const l = loginZAllegro(database, login);
  transaction(database, () => {
    const w = wierszSprawy(database, l);
    sprawdzWersje(database, w, p.wersja, l, teraz);
    const poprzedni = w?.prowadzi_user_id == null ? null : Number(w.prowadzi_user_id);
    if (!w || w.zakonczono_at != null || poprzedni === null || poprzedni === autor.id) {
      throw new KonfliktSprawy("Nie ma czego przejąć", sprawaKlienta(l, teraz, database));
    }
    const { odcisk } = policzOdcisk(database, l);
    sprawdzOdcisk(database, w, p.odcisk, odcisk, l, teraz);
    database.prepare(`UPDATE klient_prowadzenie SET prowadzi = ?, prowadzi_user_id = ?,
        znane_json = ?, wersja = wersja + 1, zmieniono_at = ?, zmieniono_przez = ?
      WHERE id = ?`)
      .run(autor.name, autor.id, naNapis(odcisk), teraz.toISOString(), autor.name, Number(w.id));
    logEvent("klient_sprawa_przejeta", autor.name, null, { sprawa: Number(w.id), poprzedni }, autor.id, database);
  })();
  return sprawaKlienta(l, teraz, database)!;
}

/* ── „Moje” ─────────────────────────────────────────────────────────────── */

/**
 * Dosyłka, która woła o ruch dziś: kłopot u przewoźnika albo brak numeru za
 * długo. Taka sprawa staje na piętrze „na dziś” niezależnie od terminu kroku
 * — termin trzech dni roboczych jeszcze nie minął, a numer trzeba wpisać już.
 */
const pilna = (s: SprawaKlienta): boolean => s.dosylki.some(pilnaDosylka);

const naWierszMoich = (s: SprawaKlienta, at: string, czeka: boolean): MojaSprawa => ({
  kolejka: "klient", id: s.id,
  opis: `${s.login}: ${s.krok}`,
  at,
  /* Zakończona sprawa nie ma biegnącego kroku — jej termin jest tylko
     zapasem dla cofnięcia i na liście udawałby zegar, którego nie ma. */
  terminDo: s.stan === "w_toku" ? s.krokDo : null,
  cel: s.nowe[0]?.cel ?? `/obsluga/klient/${encodeURIComponent(s.login)}`,
  login: s.login, czeka, dzis: s.dzis || pilna(s), poTerminie: s.poTerminie,
  nowe: s.nowe[0]?.tekst ?? null,
  /* Osobne pole, nie dopisek do `opis`: opis ucina się na szerokości wiersza,
     a stan dosyłki zastępuje w panelu „czeka do …” (`StanKroku`). `at` to
     ostatni ruch człowieka — doręczenie sprzed niego nie zasłania kroku. */
  dosylka: najwazniejszaDosylka(s.dosylki, at)?.opis ?? null,
});

const rosnaco = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

/**
 * Scala dwie listy już ułożone po terminie, nie sortując żadnej od nowa —
 * kolejność wierszy z kolejek zostaje co do joty taka, jaką dał im
 * `mojeSprawy`. Przy równym terminie wygrywa kolejka: jej termin stawia
 * Allegro albo ustawa, a krok sprawy klienta stawiamy sobie sami.
 */
function scal(kolejki: MojaSprawa[], sprawy: MojaSprawa[]): MojaSprawa[] {
  const wynik: MojaSprawa[] = [];
  let i = 0;
  let j = 0;
  while (i < kolejki.length && j < sprawy.length) {
    const a = chwila(kolejki[i].terminDo, Number.POSITIVE_INFINITY);
    const b = chwila(sprawy[j].terminDo, Number.POSITIVE_INFINITY);
    wynik.push(a <= b ? kolejki[i++] : sprawy[j++]);
  }
  return [...wynik, ...kolejki.slice(i), ...sprawy.slice(j)];
}

/**
 * Wiersze spraw tej osoby, które MOGĄ stanąć na „Moje”: w toku zawsze,
 * zakończone tylko w oknie obudzenia i tylko te, przy których po stronie
 * klienta coś się ruszyło od ostatniego ruchu człowieka.
 *
 * SITO, NIE WYROK. Warunek jest NADZBIOREM obudzenia: któryś licznik większy
 * niż w zapamiętanym odcisku albo wiadomość przychodząca wstawiona po
 * `zmieniono_at` w dowolnej rozmowie loginu. Rozmowy bierze bez konta, więc
 * to nadzbiór `rozmowyPoLoginie` na kontach z `kontaLoginu`. Obudzenie wymaga
 * jednego z dwóch, bo granica wiadomości to co najmniej `zmieniono_at`.
 * Rozstrzyga dalej `zbudujSprawe`: podziękowanie i rozmowa dowiązana wstecz
 * przechodzą przez sito, ale nie budzą.
 *
 * Bez sita odcisk liczył się przy KAŻDYM odświeżeniu dla każdej zakończonej
 * sprawy, choć prawie żadna nie jest obudzona. Pomiar na 5000 rozmowach:
 * 300 zakończonych to 133 ms synchronicznie na pętli serwera, co 30 sekund
 * z każdego otwartego panelu — a ta sama pętla obsługuje kolektory.
 */
function wierszeMoich(database: DatabaseSync, userId: number, teraz: Date): Wiersz[] {
  const urosl = Object.entries(LICZNIKI("p.login"))
    .map(([k, sql]) => `${sql} > json_extract(p.znane_json, '$.${k}')`).join("\n OR ");
  /* `CASE`, nie `AND`: SQLite nie obiecuje kolejności warunków, a
     `json_extract` na uszkodzonym JSON-ie wywraca całe zapytanie. Uszkodzony
     odcisk nie budzi licznikiem — tak samo jak w `noweZdarzenia`. */
  const wiersze = database.prepare(`
    SELECT p.*, CASE WHEN p.zakonczono_at IS NULL THEN 1
                     WHEN json_valid(p.znane_json) THEN (${urosl})
                     ELSE 0 END AS sito
      FROM klient_prowadzenie p
     WHERE p.prowadzi_user_id = ?
       AND (p.zakonczono_at IS NULL OR julianday(p.zakonczono_at) >= julianday(?))`)
    .all(userId, new Date(teraz.getTime() - OKNO_OBUDZENIA_DNI * DZIEN).toISOString()) as Wiersz[];
  return wiersze.filter((w) => Number(w.sito) === 1
    || wiadomoscPoRuchu(database, String(w.login), String(w.zmieniono_at)));
}

/**
 * Czy klient napisał cokolwiek wstawionego u nas po `zmienionoAt` — druga
 * połowa sita `wierszeMoich`. Osobnym zapytaniem, nie podzapytaniem sita:
 * numer zamówienia skorelowany z wierszem sprawy nie schodzi do
 * `ROZMOWA_ZAMOWIENIA` i SQLite przeglądał wtedy wszystkie wiadomości
 * z numerem, raz na każdą sprawę. Numery podane wprost idą po indeksach,
 * tak jak w `rozmowyPoLoginie`.
 */
function wiadomoscPoRuchu(database: DatabaseSync, login: string, zmienionoAt: string): boolean {
  const numery = (database.prepare(
    "SELECT external_id FROM zamowienie_klienta WHERE kupujacy_login = ? COLLATE NOCASE",
  ).all(login) as Wiersz[]).map((z) => String(z.external_id));
  /* `IN ()` z pustą listą to błąd składni SQLite. */
  const warunek = numery.length ? numery : [""];
  return database.prepare(`
    SELECT 1 FROM message m
     WHERE m.direction = 'incoming'
       AND julianday(m.created_at) > julianday(?)
       AND m.conversation_id IN (
             SELECT c.id FROM allegro_inbox_thread t
               JOIN conversation c ON c.external_conversation_id = t.id
              WHERE t.interlocutor_login = ? COLLATE NOCASE
             UNION
             SELECT rz.conversation_id FROM ${ROZMOWA_ZAMOWIENIA} rz
              WHERE rz.numer IN (${warunek.map(() => "?").join(",")}))
     LIMIT 1`).get(zmienionoAt, login, ...warunek) !== undefined;
}

/**
 * „Moje” razem ze sprawami klientów, które prowadzi ta osoba (S4 i S6).
 *
 * `droga-klienta.ts` nie zna tego pliku i poznać nie może (cykl importów),
 * więc scalenie stoi tutaj, a trasa woła tylko tę funkcję. Sprawy wchodzą
 * te w toku oraz zakończone, w których klient zrobił coś nowego — to jest
 * „obudzenie”, bez tickera i bez zapisu. Zakończone przechodzą najpierw
 * przez sito `wierszeMoich`, a odcisk liczy się tylko tym, które przeszły.
 *
 * PIĘTRA, od góry:
 *   1. sprawy z NOWYM zdarzeniem — najdłużej czekające pierwsze, bo klient
 *      ruszył się sam i czeka na nas;
 *   2. terminy: kolejki z terminem i kroki na dziś albo po terminie, a także
 *      sprawy z dosyłką bez numeru za długo albo z kłopotem u przewoźnika;
 *   3. reszta kolejek, wedle ostatniego ruchu — jak w `mojeSprawy`;
 *   4. kroki na przyszłość, oznaczone `czeka` — są na liście, żeby prowadzący
 *      widział swoje sprawy w całości, ale nie wołają o ruch dziś.
 *
 * Tożsamość bierze trasa z SESJI; tu przychodzi już numer konta.
 */
export function mojaLista(
  database: DatabaseSync = defaultDb(), userId: number, teraz = new Date(),
  /* Trasa, która oddaje obok samą listę kolejek, podaje ją tu gotową —
     inaczej te same dwa zapytania szłyby dwa razy na jedno odświeżenie. */
  kolejki: MojaSprawa[] = mojeSprawy(database, userId),
): MojaSprawa[] {
  const sprawy: Array<{ s: SprawaKlienta; at: string }> = [];
  for (const w of wierszeMoich(database, userId, teraz)) {
    const s = zbudujSprawe(database, w, teraz);
    if (s.stan === "w_toku" || s.nowe.length > 0) sprawy.push({ s, at: String(w.zmieniono_at) });
  }
  const najstarszeNowe = (s: SprawaKlienta) =>
    Math.min(...s.nowe.map((n) => chwila(n.at, Number.POSITIVE_INFINITY)));
  const poKroku = (a: { s: SprawaKlienta }, b: { s: SprawaKlienta }) =>
    rosnaco(chwila(a.s.krokDo, Number.POSITIVE_INFINITY), chwila(b.s.krokDo, Number.POSITIVE_INFINITY));

  const zNowymi = sprawy.filter((x) => x.s.nowe.length > 0)
    .sort((a, b) => rosnaco(najstarszeNowe(a.s), najstarszeNowe(b.s)));
  const bezNowych = sprawy.filter((x) => x.s.nowe.length === 0);
  const naDzis = bezNowych.filter((x) => x.s.dzis || x.s.poTerminie || pilna(x.s)).sort(poKroku);
  const czekaja = bezNowych.filter((x) => !x.s.dzis && !x.s.poTerminie && !pilna(x.s)).sort(poKroku);

  return [
    ...zNowymi.map((x) => naWierszMoich(x.s, x.at, false)),
    ...scal(kolejki.filter((k) => k.terminDo !== null), naDzis.map((x) => naWierszMoich(x.s, x.at, false))),
    ...kolejki.filter((k) => k.terminDo === null),
    ...czekaja.map((x) => naWierszMoich(x.s, x.at, true)),
  ];
}
