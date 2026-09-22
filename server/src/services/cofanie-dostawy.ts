import { db, transaction } from "../db/db.js";
import { config } from "../config.js";
import { dataLokalna } from "../czas.js";
import { parseLocs } from "../locs.js";
import { enqueueSetLocation } from "./queue.js";
import { logEvent } from "./events.js";
import { etykietaTypu } from "./problems.js";
import {
  statusZIlosci,
  validateDeliveryLocation,
  type CofniecieOdlozenia,
} from "./delivery.js";

/* ── Cofanie pomyłek przy rozkładaniu dostawy ────────────────────────────────
   ZGŁOSZENIE WŁAŚCICIELA: „jak już zaznaczyłem, że wszystko jest, a się
   pomyliłem, to nie mogę tego cofnąć".

   Do tego wydania pomyłka przy dostawie była w czterech miejscach nieodwracalna:
   - dostawa zamykała się sama po ostatniej pozycji, a korekta ilości na
     zamkniętej odmawiała — ostatniej pozycji nie dało się więc poprawić NIGDY;
   - zła półka nie miała drogi powrotnej wcale, bo korekta rusza tylko liczbę;
   - ZAKOŃCZ zamieniało nietknięte pozycje w pominięte na zawsze;
   - zgłoszony wyjątek trzymał pozycję w stanie `problem` bez wyjścia.

   Odłożenie kosztuje jeden skan i tak ma zostać (dekalog, punkt 3). Tani zapis
   jest jednak do przyjęcia tylko przy tanim odwróceniu. Pasek COFNIJ usunięty
   w 0.41.0 odwracał przez ZWŁOKĘ zapisu; tu zapis idzie od razu, a cofnięcie
   jest osobną operacją, więc ścieżka główna nie płaci za nie nic.

   Granica przez Subiekta jest ta sama co przy koszu (0.79.0): czekające
   zadanie adresu się anuluje. Inaczej niż przy koszu wykonanego nie zostawiamy
   — dostaje zapis odwrotny wprzód, z pełnym śladem w kolejce. Przy dostawie
   pomyłka adresowa jest częstsza niż przy koszu, a „popraw na karcie towaru"
   wymaga pamiętania adresu, który właśnie zniknął z ekranu.                  */

type Blad = { error: string; status?: number };

const nowIso = () => new Date().toISOString();

/** Pole adresów w postaci porównywalnej — kolejność zostaje, spacje nie. */
const norm = (pole: string | null | undefined): string => parseLocs(pole ?? "").join(" ");

interface LiniaZDostawa {
  id: number;
  delivery_id: number;
  tw_id: number;
  tw_symbol: string;
  ilosc_dok: number;
  ilosc_odlozona: number;
  lok_faktyczna: string | null;
  status: string;
  done_at: string | null;
  done_by: string | null;
  cofniecie: string | null;
  stanDostawy: string;
  closedAt: string | null;
}

function liniaZDostawa(lineId: number): LiniaZDostawa | undefined {
  return db()
    .prepare(
      `SELECT l.*, d.status AS stanDostawy, d.closed_at AS closedAt
         FROM delivery_line l JOIN delivery d ON d.id = l.delivery_id
        WHERE l.id = ?`
    )
    .get(lineId) as LiniaZDostawa | undefined;
}

/* ── Adres w Subiekcie ────────────────────────────────────────────────────── */

/**
 * Zadanie kolejki, które da się jeszcze zatrzymać, albo powód, że nie da się.
 *
 * `error` liczy się jak `pending`: zadanie, które nie weszło, nie zmieniło
 * Subiekta. `processing` odmawia — worker trzyma je w tej chwili w ręku
 * i wynik nie jest jeszcze znany nikomu.
 */
type StanZadania = "brak" | "do_anulowania" | "anulowane" | "wykonane" | { error: string };

function stanZadania(queueId: number | null): StanZadania {
  if (queueId == null) return "brak";
  const z = db().prepare("SELECT status FROM sfera_queue WHERE id = ?").get(queueId) as
    | { status: string }
    | undefined;
  if (!z || z.status === "cancelled") return "anulowane";
  if (z.status === "pending" || z.status === "error") return "do_anulowania";
  if (z.status === "done") return "wykonane";
  return { error: "Zapis adresu właśnie idzie do Subiekta — spróbuj za kilka sekund." };
}

/**
 * Czy ktoś zmieniał adres tego towaru PO odłożeniu, inną drogą niż ta pozycja.
 *
 * Bez tej bramki cofnięcie liczone z `locsPrzed` nadpisałoby cudzą, późniejszą
 * zmianę — np. półkę poprawioną w międzyczasie na karcie towaru. Ta pomyłka
 * byłaby cicha, więc odmawiamy głośno.
 */
function adresRuszanyPozniej(twId: number, c: CofniecieOdlozenia, doneAt: string | null): boolean {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM sfera_queue
        WHERE type = 'set_location' AND tw_id = ? AND status != 'cancelled'
          AND (id > ? OR (? IS NULL AND created_at > ?))`
    )
    .get(twId, c.queueId ?? 0, c.queueId, doneAt ?? "") as { n: number };
  return r.n > 0;
}

/**
 * Doprowadź adres towaru w Subiekcie do wartości `cel`. Wołane W TRANSAKCJI.
 *
 * Najpierw anuluje czekające zadanie tej pozycji, bo to jest zapis, który
 * jeszcze nie istnieje. Nowe zadanie powstaje tylko wtedy, gdy Subiekt po tym
 * anulowaniu nadal nie trzyma celu. Zwraca nowy stan przepisu.
 */
function ustawAdres(
  l: LiniaZDostawa,
  c: CofniecieOdlozenia,
  cel: string,
  user: string,
  opis: string
): { queueId: number | null; pole: string | null; baza: string; skutek: "bez_zmian" | "anulowany" | "zapisany" } {
  const stan = stanZadania(c.queueId);
  let obecne: string;
  let anulowano = false;
  if (stan === "do_anulowania") {
    db()
      .prepare(
        "UPDATE sfera_queue SET status='cancelled', processed_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?"
      )
      .run(c.queueId);
    obecne = c.baza;
    anulowano = true;
  } else if (stan === "wykonane") {
    obecne = c.pole ?? c.baza;
  } else {
    obecne = c.baza;
  }
  if (norm(obecne) === norm(cel)) {
    return { queueId: null, pole: null, baza: obecne, skutek: anulowano ? "anulowany" : "bez_zmian" };
  }
  const queueId = enqueueSetLocation(
    l.tw_id,
    norm(cel),
    {
      createdBy: user,
      twId: l.tw_id,
      label: "Lokalizacja · " + l.tw_symbol,
      detail: opis,
    },
    { locsPrzed: obecne, zrodlo: "dostawa" }
  );
  return { queueId, pole: norm(cel), baza: obecne, skutek: "zapisany" };
}

/** Pole adresów po odłożeniu na `kod` — ta sama reguła co w `putawayLine`. */
function poleDla(akcja: "add" | "replace", przed: string, kod: string): string {
  const obecne = parseLocs(przed);
  const nowe =
    akcja === "add"
      ? Array.from(new Set([...obecne, kod]))
      : Array.from(new Set([kod, ...obecne.slice(1)]));
  return nowe.join(" ");
}

/* ── Ponowne otwarcie dostawy ─────────────────────────────────────────────── */

interface ZgloszenieAutomatu {
  id: number;
  line_id: number | null;
  typ: string;
  zrodlo: string;
  resolved_at: string | null;
  ilosc: number | null;
  opis: string | null;
  created_at: string;
  created_by: string | null;
  sym: string | null;
}

function zgloszeniaZamkniecia(deliveryId: number): ZgloszenieAutomatu[] {
  return db()
    .prepare(
      `SELECT p.id, p.line_id, p.typ, p.zrodlo, p.resolved_at, p.ilosc, p.opis,
              p.created_at, p.created_by, l.tw_symbol AS sym
         FROM problem p LEFT JOIN delivery_line l ON l.id = p.line_id
        WHERE p.delivery_id = ? AND p.zrodlo IS NOT NULL`
    )
    .all(deliveryId) as unknown as ZgloszenieAutomatu[];
}

/**
 * Dokument MM, którym zgłoszenie braku zdjęło towar ze sprzedaży.
 *
 * Numer zadania stoi wyłącznie w zdarzeniu `brak_na_serwis` — zgłoszenie
 * nie ma na niego kolumny. Czytamy go stamtąd zamiast dokładać kolumnę,
 * bo zdarzenie powstaje w tej samej chwili co MM i zawsze obok niego.
 */
function mmBraku(problemId: number): number | null {
  const r = db()
    .prepare(
      `SELECT json_extract(payload, '$.queueId') AS q FROM events
        WHERE type = 'brak_na_serwis' AND json_extract(payload, '$.problemId') = ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(problemId) as { q: number | null } | undefined;
  return r?.q ?? null;
}

/** Powód, dla którego MM braku nie da się już zatrzymać — albo `null`. */
function mmNieDoZatrzymania(problemId: number): string | null {
  const s = stanZadania(mmBraku(problemId));
  if (s === "wykonane") {
    return "Brak z tej dostawy przesunięto już na magazyn serwisowy dokumentem w Subiekcie — poprawkę robi biuro.";
  }
  if (typeof s === "object") return s.error;
  return null;
}

function zatrzymajMmBraku(problemId: number): void {
  const q = mmBraku(problemId);
  if (q != null && stanZadania(q) === "do_anulowania") {
    db()
      .prepare(
        "UPDATE sfera_queue SET status='cancelled', processed_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?"
      )
      .run(q);
  }
}

/** Czy zamkniętą dostawę wolno otworzyć ponownie — i jeśli nie, dlaczego. */
export interface MozliwoscOtwarcia {
  mozna: boolean;
  /** Zdanie dla magazyniera; `null`, gdy wolno. */
  powod: string | null;
}

/**
 * Bramka ponownego otwarcia. CZYTA, niczego nie zapisuje.
 *
 * OKNO: dzień zamknięcia, czasu lokalnego. Pomyłkę zauważa się przy palecie
 * albo przy następnej dostawie tego dnia. Później liczby z dostawy bywają już
 * przepisane do Subiekta i rozmów z dostawcą.
 *
 * ZGŁOSZENIA Z ZAMKNIĘCIA: otwarcie je wycofuje, więc wolno otworzyć tylko
 * wtedy, gdy biuro żadnego jeszcze nie rozstrzygnęło. Wycofanie rozstrzygniętego
 * zmieniałoby dokument, na który ktoś już odpowiedział. Zgłoszenia człowieka
 * otwarcie omija, więc ich stan tu nie waży.
 */
export function mozliwoscOtwarcia(deliveryId: number): MozliwoscOtwarcia {
  const d = db()
    .prepare("SELECT status, closed_at AS closedAt FROM delivery WHERE id = ?")
    .get(deliveryId) as { status: string; closedAt: string | null } | undefined;
  if (!d) return { mozna: false, powod: "Nie ma takiej dostawy." };
  if (d.status === "open") return { mozna: false, powod: "Dostawa jest otwarta." };
  if (d.status === "external") {
    return { mozna: false, powod: "Dostawa jest oznaczona jako rozłożona poza WERTIS — cofa ją biuro." };
  }
  if (!d.closedAt || dataLokalna(d.closedAt) !== dataLokalna(nowIso())) {
    return {
      mozna: false,
      powod:
        "Ponownie otworzyć można tylko w dniu zamknięcia. Pomyłkę z wcześniejszej dostawy zgłoś biuru.",
    };
  }
  for (const z of zgloszeniaZamkniecia(deliveryId)) {
    if (z.resolved_at) {
      return {
        mozna: false,
        powod:
          `Biuro rozstrzygnęło już zgłoszenie z zamknięcia (${etykietaTypu(z.typ)}` +
          (z.sym ? ` · ${z.sym}` : "") +
          "). Poprawkę robi teraz biuro.",
      };
    }
    const mm = mmNieDoZatrzymania(z.id);
    if (mm) return { mozna: false, powod: mm };
  }
  return { mozna: true, powod: null };
}

/** Status pozycji po zniknięciu zgłoszenia — wyjątek człowieka nadal wygrywa. */
function przeliczStatus(lineId: number): string {
  const l = db()
    .prepare("SELECT ilosc_odlozona AS qty, ilosc_dok AS dok FROM delivery_line WHERE id = ?")
    .get(lineId) as { qty: number; dok: number } | undefined;
  if (!l) return "todo";
  /* `nadmiar` nie ustawia pozycji na `problem` (towar leży na półce), więc go
     tu nie liczymy. Rozwiązany wyjątek człowieka trzyma pozycję tak jak
     dotąd — rozwiązanie znaczy „biuro to załatwiło", nie „wraca do roboty". */
  const wyjatki = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM problem
        WHERE line_id = ? AND (zrodlo IS NULL OR zrodlo = 'zakonczenie')`
    )
    .get(lineId) as { n: number };
  const status = wyjatki.n > 0 ? "problem" : statusZIlosci(l.qty ?? 0, l.dok);
  db().prepare("UPDATE delivery_line SET status = ? WHERE id = ?").run(status, lineId);
  return status;
}

/** Wycofanie jednego zgłoszenia — wspólne dla otwarcia i dla człowieka. W TRANSAKCJI. */
function usunZgloszenie(problemId: number, lineId: number | null, powod: string, user: string): void {
  const p = db().prepare("SELECT * FROM problem WHERE id = ?").get(problemId) as
    | Record<string, unknown>
    | undefined;
  if (!p) return;
  zatrzymajMmBraku(problemId);
  /* Wiersz ZNIKA, a nie dostaje znacznika. Zgłoszenie nierozstrzygnięte nie
     wyszło jeszcze poza firmę, a znacznik musiałby pilnować sześciu miejsc,
     które czytają `problem` — z protokołem dla dostawcy włącznie. Treść
     zostaje w dzienniku zdarzeń, razem z nazwą pliku zdjęcia. */
  db().prepare("DELETE FROM problem WHERE id = ?").run(problemId);
  logEvent("problem_wycofany", user, null, {
    problemId,
    powod,
    deliveryId: p.delivery_id,
    lineId: p.line_id,
    typ: p.typ,
    zrodlo: p.zrodlo ?? null,
    ilosc: p.ilosc,
    opis: p.opis,
    fotoRef: p.foto_ref ?? null,
    zgloszone: p.created_at,
    zglaszajacy: p.created_by,
  });
  if (lineId != null) przeliczStatus(lineId);
}

/** Otwarcie wewnątrz cudzej transakcji — cofnięcie odłożenia woła je po drodze. */
function wznow(deliveryId: number, user: string, przyczyna: string): { wycofane: number; przywrocone: number } {
  const auto = zgloszeniaZamkniecia(deliveryId);
  for (const z of auto) usunZgloszenie(z.id, z.line_id, "otwarcie_dostawy", user);
  /* `skipped` powstaje wyłącznie przy ZAKOŃCZ, więc cała taka pozycja wraca
     do roboty. Pominięcie było skutkiem zamknięcia, a zamknięcie właśnie
     przestaje obowiązywać. */
  const przywrocone = db()
    .prepare("UPDATE delivery_line SET status = 'todo' WHERE delivery_id = ? AND status = 'skipped'")
    .run(deliveryId).changes;
  db()
    .prepare("UPDATE delivery SET status = 'open', closed_at = NULL WHERE id = ? AND status = 'done'")
    .run(deliveryId);
  logEvent("delivery_reopened", user, null, {
    deliveryId,
    przyczyna,
    wycofane: auto.length,
    przywrocone: Number(przywrocone),
  });
  return { wycofane: auto.length, przywrocone: Number(przywrocone) };
}

/**
 * Otwórz zamkniętą dostawę z powrotem.
 *
 * Automatyczne domknięcie po ostatniej pozycji ZOSTAJE — to najczęstsze
 * zakończenie pracy, a zabranie go dokładałoby tapnięcie do każdej dostawy.
 * Wycofuje się to, co zamknięcie zrobiło samo: zgłoszenia z ZAKOŃCZ i nadmiaru,
 * pominięcia oraz MM braku, jeśli jeszcze czeka.
 *
 * Bez bramki roli, wzorem korekty ilości: to poprawianie własnej pracy w dniu,
 * w którym się ją wykonało. Ślad z nazwiskiem zostaje w `events`.
 */
export function otworzPonownie(
  deliveryId: number,
  user: string
): { ok: true; wycofane: number; przywrocone: number } | Blad {
  const m = mozliwoscOtwarcia(deliveryId);
  if (!m.mozna) return { error: m.powod ?? "Tej dostawy nie da się otworzyć" };
  const r = transaction(db(), () => wznow(deliveryId, user, "przycisk"))();
  return { ok: true, ...r };
}

/* ── Cofnięcie odłożenia ──────────────────────────────────────────────────── */

/**
 * Cofnij OSTATNIE odłożenie pozycji: ilość, półkę i adres w Subiekcie.
 *
 * Gdy to odłożenie domknęło dostawę, cofnięcie ją otwiera — inaczej pomyłka
 * na ostatniej pozycji byłaby jedyną, której nie da się cofnąć, a to właśnie
 * ona zdarza się najczęściej: w pośpiechu, przy końcu palety.
 */
export function cofnijOdlozenie(
  lineId: number,
  user: string
): { ok: true; adres: "bez_zmian" | "anulowany" | "zapisany"; otwartaPonownie: boolean } | Blad {
  const l = liniaZDostawa(lineId);
  if (!l) return { error: "Brak pozycji", status: 404 };
  if (!l.cofniecie) {
    return {
      error:
        "Tego odłożenia nie da się już cofnąć — po korekcie albo cofnięciu popraw liczbę przez POPRAW ILOŚĆ.",
    };
  }
  if (l.status === "problem") {
    return { error: "Pozycja ma zgłoszony wyjątek — najpierw wycofaj zgłoszenie." };
  }
  if (l.stanDostawy === "external") {
    return { error: "Dostawa jest oznaczona jako rozłożona poza WERTIS — cofa ją biuro." };
  }
  const c = JSON.parse(l.cofniecie) as CofniecieOdlozenia;
  const zamknieta = l.stanDostawy === "done";
  if (zamknieta) {
    const m = mozliwoscOtwarcia(l.delivery_id);
    if (!m.mozna) return { error: m.powod ?? "Tej dostawy nie da się otworzyć" };
  }
  const stan = stanZadania(c.queueId);
  if (typeof stan === "object") return { error: stan.error };
  if (adresRuszanyPozniej(l.tw_id, c, l.done_at)) {
    return {
      error:
        "Adres tego towaru zmieniano po odłożeniu. Ilość popraw przez POPRAW ILOŚĆ, a adres na karcie towaru.",
    };
  }

  const nowaIlosc = Math.max((l.ilosc_odlozona ?? 0) - c.qty, 0);
  const wynik = transaction(db(), () => {
    if (zamknieta) wznow(l.delivery_id, user, "cofniecie_odlozenia");
    const adres = ustawAdres(l, c, c.locsPrzed, user, `${norm(c.locsPrzed) || "(puste)"} (dostawa, cofnięcie)`);
    db()
      .prepare(
        `UPDATE delivery_line SET ilosc_odlozona = ?, status = ?, lok_faktyczna = ?,
                done_at = ?, done_by = ?, cofniecie = NULL
          WHERE id = ?`
      )
      .run(nowaIlosc, statusZIlosci(nowaIlosc, l.ilosc_dok), c.lokPrzed, c.doneAtPrzed, c.doneByPrzed, lineId);
    logEvent("putaway_cofniete", user, l.tw_id, {
      lineId,
      deliveryId: l.delivery_id,
      qty: c.qty,
      qtyPo: nowaIlosc,
      byloNa: c.lok,
      adres: adres.skutek,
      ...(adres.queueId != null ? { queueId: adres.queueId } : {}),
      otwartaPonownie: zamknieta,
    });
    return adres.skutek;
  })();
  return { ok: true, adres: wynik, otwartaPonownie: zamknieta };
}

/* ── Zmiana półki ─────────────────────────────────────────────────────────── */

/**
 * Towar leży gdzie indziej, niż zeskanowano — przenieś adres ostatniego
 * odłożenia na właściwą półkę. Ilość zostaje, bo jej nikt nie kwestionuje.
 *
 * Akcja ZAMIEŃ/DODAJ jest ta sama co przy odłożeniu. Pytanie o nią padło
 * wtedy, a zmiana półki poprawia kod, nie decyzję.
 *
 * Działa także na dostawie zamkniętej. Adres nie należy do protokołu
 * rozbieżności, więc otwieranie dostawy dla samej półki byłoby rytuałem.
 */
export function zmienPolke(
  lineId: number,
  kodRaw: string,
  user: string,
  opts: { recznie?: boolean } = {}
): { ok: true; lok: string; adres: "bez_zmian" | "anulowany" | "zapisany" } | Blad {
  const kod = (kodRaw ?? "").trim().toUpperCase();
  const blad = validateDeliveryLocation(kod);
  if (blad) return { error: blad };
  const l = liniaZDostawa(lineId);
  if (!l) return { error: "Brak pozycji", status: 404 };
  if (!l.cofniecie) {
    return { error: "Półkę zmienia się tu zaraz po odłożeniu. Później — skanem półki na karcie towaru." };
  }
  if (l.stanDostawy === "external") {
    return { error: "Dostawa jest oznaczona jako rozłożona poza WERTIS — cofa ją biuro." };
  }
  const c = JSON.parse(l.cofniecie) as CofniecieOdlozenia;
  if (kod === c.lok) return { error: `Towar jest już zapisany na ${kod}.` };
  const stan = stanZadania(c.queueId);
  if (typeof stan === "object") return { error: stan.error };
  if (adresRuszanyPozniej(l.tw_id, c, l.done_at)) {
    return { error: "Adres tego towaru zmieniano po odłożeniu — popraw półkę na karcie towaru." };
  }
  const cel = poleDla(c.akcja, c.locsPrzed, kod);
  if (cel.length > config.locFieldLimit) {
    return {
      error:
        `Pole adresów jest pełne (limit ${config.locFieldLimit} znaków). ` +
        "Zdejmij niepotrzebny adres na karcie towaru.",
    };
  }

  const skutek = transaction(db(), () => {
    const adres = ustawAdres(l, c, cel, user, `${kod} (dostawa, zmiana półki)`);
    const nowy: CofniecieOdlozenia = { ...c, lok: kod, queueId: adres.queueId, pole: adres.pole, baza: adres.baza };
    db()
      .prepare("UPDATE delivery_line SET lok_faktyczna = ?, cofniecie = ? WHERE id = ?")
      .run(kod, JSON.stringify(nowy), lineId);
    /* Wpis ręczny to ten sam sygnał zniszczonej etykiety co przy odłożeniu —
       raport etykiet do przedruku czyta `manual_entry` bez względu na drogę. */
    if (opts.recznie) {
      logEvent("manual_entry", user, l.tw_id, { code: kod, kind: "LOC", zrodlo: "dostawa" });
    }
    logEvent("putaway_polka_zmieniona", user, l.tw_id, {
      lineId,
      deliveryId: l.delivery_id,
      bylo: c.lok,
      jest: kod,
      adres: adres.skutek,
      ...(adres.queueId != null ? { queueId: adres.queueId } : {}),
    });
    return adres.skutek;
  })();
  return { ok: true, lok: kod, adres: skutek };
}

/* ── Wycofanie zgłoszenia ─────────────────────────────────────────────────── */

/**
 * Wycofaj WŁASNE, nierozstrzygnięte zgłoszenie — np. „zła ilość", a brakujący
 * karton stał za paletą.
 *
 * Do tego wydania pozycja z wyjątkiem nie miała wyjścia ze stanu `problem`.
 * Nawet rozwiązanie wyjątku przez biuro zostawiało ją tam, a korekta ilości
 * odsyłała do „rozwiąż w wyjątkach" — czyli w pętlę.
 *
 * TYLKO ZGŁASZAJĄCY. Zgłoszenie jest twierdzeniem konkretnej osoby wobec
 * dostawcy. Cudze zdejmuje biuro, rozwiązując je z notatką.
 */
export function wycofajZgloszenie(
  problemId: number,
  user: string
): { ok: true; statusLinii: string | null } | Blad {
  const p = db()
    .prepare(
      `SELECT p.id, p.line_id AS lineId, p.delivery_id AS deliveryId, p.resolved_at AS resolvedAt,
              p.resolved_by AS resolvedBy, p.zrodlo, p.created_by AS createdBy,
              d.status AS stanDostawy
         FROM problem p LEFT JOIN delivery d ON d.id = p.delivery_id
        WHERE p.id = ?`
    )
    .get(problemId) as
    | {
        id: number;
        lineId: number | null;
        deliveryId: number | null;
        resolvedAt: string | null;
        resolvedBy: string | null;
        zrodlo: string | null;
        createdBy: string | null;
        stanDostawy: string | null;
      }
    | undefined;
  if (!p) return { error: "Nie ma takiego zgłoszenia", status: 404 };
  if (p.resolvedAt) {
    return {
      error: `Biuro rozstrzygnęło już to zgłoszenie${p.resolvedBy ? ` (${p.resolvedBy})` : ""} — wycofać go się nie da.`,
    };
  }
  if (p.zrodlo) {
    return { error: "To zgłoszenie powstało samo przy zamknięciu dostawy — znika po OTWÓRZ PONOWNIE." };
  }
  if (p.createdBy !== user) {
    return {
      error: `To zgłoszenie złożyło konto „${p.createdBy ?? "?"}". Wycofać je może tylko ono, a biuro — rozwiązać.`,
    };
  }
  if (p.stanDostawy && p.stanDostawy !== "open") {
    return { error: "Dostawa jest zamknięta — najpierw OTWÓRZ PONOWNIE." };
  }
  const mm = mmNieDoZatrzymania(problemId);
  if (mm) return { error: mm };

  const statusLinii = transaction(db(), () => {
    usunZgloszenie(problemId, p.lineId, "wycofane_przez_zglaszajacego", user);
    if (p.lineId == null) return null;
    const s = db().prepare("SELECT status FROM delivery_line WHERE id = ?").get(p.lineId) as
      | { status: string }
      | undefined;
    return s?.status ?? null;
  })();
  return { ok: true, statusLinii };
}

/* ── Co widok dostawy mówi o drogach powrotu ──────────────────────────────── */

/** Co pokazać przy pozycji: czy da się cofnąć ostatnie odłożenie. */
export function cofnijDlaLinii(r: { cofniecie?: string | null; status: string }):
  | { qty: number; lok: string }
  | null {
  if (!r.cofniecie || (r.status !== "done" && r.status !== "partial")) return null;
  try {
    const c = JSON.parse(r.cofniecie) as CofniecieOdlozenia;
    return { qty: c.qty, lok: c.lok };
  } catch {
    return null;
  }
}

/** Najnowsze wycofywalne zgłoszenie człowieka przy każdej pozycji dostawy. */
export function zgloszeniaDoWycofania(
  deliveryId: number
): Map<number, { id: number; typLabel: string; autor: string }> {
  const rows = db()
    .prepare(
      `SELECT id, line_id AS lineId, typ, created_by AS autor FROM problem
        WHERE delivery_id = ? AND line_id IS NOT NULL AND resolved_at IS NULL AND zrodlo IS NULL
        ORDER BY id`
    )
    .all(deliveryId) as Array<{ id: number; lineId: number; typ: string; autor: string | null }>;
  const m = new Map<number, { id: number; typLabel: string; autor: string }>();
  // ORDER BY id + nadpisywanie = zostaje najnowsze — to ono jest „ostatnią pomyłką"
  for (const r of rows) m.set(r.lineId, { id: r.id, typLabel: etykietaTypu(r.typ), autor: r.autor ?? "" });
  return m;
}
