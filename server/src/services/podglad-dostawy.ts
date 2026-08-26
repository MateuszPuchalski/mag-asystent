import { db } from "../db/db.js";
import { notatkiDokumentu, type Notatka } from "./notatki.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import {
  adresyOczekiwane,
  porownajAlejkowo,
  pozycjaNietknieta,
  pozycjeSnapshotu,
  TERMINAL_LINE,
} from "./delivery.js";
import { ktorzyMajaLogo } from "./logo-dostawcy.js";
import { listByDelivery, PROBLEM_TYPES_LABELS } from "./problems.js";
import type { ProblemType, ProblemView } from "../types.js";

/* ── Podgląd dokumentu dla biura (0.36.0) ────────────────────────────────────
   Podgląd pod `/biuro` pokazywał dostawy jako płaską tabelę z paskiem postępu.
   Biuro widziało „12/30" i nie miało jak sprawdzić, KTÓRE dwanaście, kto je
   odłożył ani gdzie faktycznie wylądowały — żeby to zobaczyć, trzeba było
   otworzyć Subiekta obok. Dane leżały tymczasem w bazie nieczytane: kolumny
   `done_by`, `done_at` i `lok_faktyczna` nie miały ANI JEDNEGO czytelnika.

   TEN SERWIS NICZEGO NIE ZAPISUJE — i to jest cały jego sens, nie deklaracja
   grzecznościowa. Kuszące byłoby wywołać `openDelivery` i mieć jedną ścieżkę
   zamiast dwóch. Ale `openDelivery` zakłada rekord dostawy, sprząta pozycje
   usługowe i przestawia dokument na liście z NIETKNIĘTA na W TOKU — czyli samo
   PATRZENIE zmieniałoby stan magazynu, a lista pracy zapełniłaby się dostawami,
   których nikt nie zaczął. Dlatego tu nie ma `openDelivery`, `closeIfComplete`,
   `usunPozycjeUslugowe` ani żadnego INSERT/UPDATE/DELETE, i pilnuje tego test.

   Typy poniżej NIE SĄ lustrem `android/core/.../net/Dtos.kt`. Dlatego mieszkają
   tutaj, a nie w `types.ts`: dopisanie choćby `doneBy` do `DeliveryLineView`
   wymusiłoby zmianę DTO Kotlina, testy `:core` i NOWY APK — czyli rozesłanie
   przez MDM aplikacji, w której nic się nie zmieniło. Czyta to wyłącznie
   `/biuro`, więc kolektor nie ma prawa za to płacić.                          */

export interface PodgladLinii {
  /** `null` przy dokumencie nietkniętym — linii jeszcze nie ma w bazie. */
  lineId: number | null;
  twId: number;
  sym: string;
  name: string;
  qtyDoc: number;
  qtyDone: number;
  locExpected: string | null;
  locActual: string | null;
  status: string;
  /** Odłożone GDZIE INDZIEJ, niż mówiła kartoteka — jedyna zmiana, jaką WERTIS zapisuje do Subiekta. */
  mismatch: boolean;
  /** SKU bez adresu w kartotece: decyzja dla biura, nie rutyna dla magazynu. */
  bezLokalizacji: boolean;
  doneBy: string | null;
  doneAt: string | null;
  problemy: ProblemView[];
}

export interface PodgladDokumentu {
  dokId: number;
  /** `null` = nikt nigdy nie otwierał tego dokumentu. */
  deliveryId: number | null;
  nrPelny: string;
  typ: string;
  dostawca: string;
  /** Płatnik z dokumentu — po nim panel sięga po logo. `null` = dokument bez kontrahenta. */
  khId: number | null;
  /** Czy dla tego płatnika wgrano logo. Panel pyta o obraz WYŁĄCZNIE wtedy. */
  maLogo: boolean;
  dataWyst: string;
  wBuforze: boolean;
  wPrzyjeciach: boolean;
  status: string | null;
  /**
   * Kto, kiedy i dlaczego zdjął tę dostawę z listy jako rozłożoną poza WERTIS.
   *
   * `null` dla każdej innej dostawy. Powód jedzie na ekran razem z nazwiskiem,
   * bo to jedyne, co odróżnia decyzję od pomyłki — a cofnięcie jest jedno
   * kliknięcie dalej.
   */
  zamkniecie: { kto: string; at: string; powod: string } | null;
  /**
   * Jak zwykle wygląda praca z TYM dostawcą — trzy liczby z naszych własnych
   * tabel, nie z Subiekta.
   *
   * Biuro rozstrzyga wyjątek, patrząc na jedną pozycję jednej faktury, i nie
   * ma z czego wiedzieć, czy niedobór u tego dostawcy zdarza się co drugi raz,
   * czy pierwszy raz w tym roku. To jest dokładnie ta różnica, po której
   * decyduje się między „policzyć ponownie" a „reklamować".
   */
  dostawcaStat: {
    /** Dostawy tego dostawcy otwarte w WERTIS w tym roku kalendarzowym. */
    dostawWRoku: number;
    /** Udział pozycji z wyjątkiem we wszystkich pozycjach — `null` przy zerze. */
    udzialWyjatkow: number | null;
    /** Mediana czasu otwarcie → domknięcie, w dniach. `null` bez domkniętych. */
    medianaDni: number | null;
  } | null;
  /** Notatki biura do tego dokumentu — panel pokazuje je razem z pozycjami. */
  notatki: Notatka[];
  /**
   * `snapshot` — to, co widzi kolektor. `podglad` — to, co zobaczy po otwarciu.
   *
   * Rozróżnienie jedzie na ekran, bo dwie te listy są prawdziwe inaczej: druga
   * jest prognozą i zmieni się, gdy księgowość poprawi fakturę przed otwarciem.
   */
  zrodlo: "snapshot" | "podglad";
  progress: { total: number; done: number; remaining: number; problems: number };
  lines: PodgladLinii[];
  /** Wyjątki bez linii (towar spoza dokumentu) — nie mają gdzie usiąść w wierszu. */
  problemyBezLinii: ProblemView[];
}

/** Wiersz `delivery_line` tak, jak leży w bazie. */
interface WierszLinii {
  id: number;
  tw_id: number;
  tw_symbol: string;
  tw_nazwa: string;
  ilosc_dok: number;
  ilosc_odlozona: number;
  lok_oczekiwana: string | null;
  lok_faktyczna: string | null;
  status: string;
  done_at: string | null;
  done_by: string | null;
}

/**
 * Pozycje dokumentu dla biura. `undefined`, gdy dokumentu nie ma w read-modelu
 * (nie istnieje albo wypadł z okna importu — dla biura to ten sam brak).
 */
export function podgladDokumentu(dokId: number): PodgladDokumentu | undefined {
  const doc = subiekt.getDocument(dokId);
  if (!doc) return undefined;

  const d = db()
    .prepare(
      `SELECT id, status, COALESCE(closed_by,'') AS closed_by,
              COALESCE(closed_at,'') AS closed_at, COALESCE(powod_zamkniecia,'') AS powod
       FROM delivery WHERE sgt_dok_id = ?`
    )
    .get(dokId) as
    | { id: number; status: string; closed_by: string; closed_at: string; powod: string }
    | undefined;

  /* Dostawa zdjęta z listy jako rozłożona poza WERTIS nie ma ANI JEDNEJ linii,
     bo zamknięcie świadomie nie robi snapshotu — nikt tego tutaj nie
     rozkładał. Pusta tabela byłaby jednak dla biura gorsza niż brak ekranu:
     ocena, czy zamknięcie było słuszne, wymaga zobaczenia, co stoi NA
     FAKTURZE. Dlatego wtedy — i tylko wtedy — wracamy do podglądu pozycji. */
  const bezSnapshotu = d?.status === "external" && liniePoOtwarciu(d.id).length === 0;
  const lines = d && !bezSnapshotu ? liniePoOtwarciu(d.id) : liniePrzedOtwarciem(dokId);
  lines.sort(porownajAlejkowo);

  const done = lines.filter((l) => TERMINAL_LINE.has(l.status)).length;
  const problems = lines.filter((l) => l.status === "problem").length;

  return {
    dokId: doc.dok_id,
    deliveryId: d?.id ?? null,
    nrPelny: doc.nr_pelny,
    typ: doc.typ,
    dostawca: doc.dostawca ?? "",
    khId: doc.kh_id ?? null,
    /* Ta sama para pól co na liście dostaw (`listDocuments`), z tego samego
       powodu: panel ma wiedzieć, czy w ogóle pytać o obraz. Żądanie „na wszelki
       wypadek" kończy się serią 404 w dzienniku — lekcja z 0.56.0. */
    maLogo: doc.kh_id != null && ktorzyMajaLogo([doc.kh_id]).size > 0,
    dataWyst: doc.data_wyst,
    wBuforze: !!doc.w_buforze,
    wPrzyjeciach: doc.mag_id !== config.magId.MAG,
    status: d?.status ?? null,
    notatki: notatkiDokumentu(dokId),
    zamkniecie:
      d && d.status === "external"
        ? { kto: d.closed_by, at: d.closed_at, powod: d.powod }
        : null,
    dostawcaStat: doc.dostawca ? statystykiDostawcy(doc.dostawca) : null,
    zrodlo: d && !bezSnapshotu ? "snapshot" : "podglad",
    progress: { total: lines.length, done, remaining: lines.length - done, problems },
    lines,
    problemyBezLinii: d ? listByDelivery(d.id).filter((p) => p.lineId == null) : [],
  };
}

/**
 * Trzy liczby o dostawcy, liczone z NASZYCH tabel.
 *
 * Dopasowanie idzie po `delivery.dostawca`, a nie po `kh_id`: `delivery` nosi
 * nazwę przepisaną w chwili otwarcia i to jedyne, co mamy dla dostaw sprzed
 * wprowadzenia płatnika. Nazwa bywa niestabilna w Subiekcie, ale skutkiem jest
 * najwyżej rozdzielona historia, a nie liczba policzona komuś innemu.
 *
 * `external` NIE wchodzi do mediany — dostawa zamknięta poza WERTIS nie ma
 * czasu rozłożenia, bo nikt jej tutaj nie rozkładał. Wchodzi za to do liczby
 * dostaw w roku: przyszła i ktoś się nią zajął.
 */
export function statystykiDostawcy(
  dostawca: string
): PodgladDokumentu["dostawcaStat"] {
  const d = db();
  const rok = new Date().getFullYear();

  const wRoku = d
    .prepare(
      "SELECT COUNT(*) AS ile FROM delivery WHERE dostawca = ? AND opened_at >= ?"
    )
    .get(dostawca, `${rok}-01-01`) as { ile: number };

  const linie = d
    .prepare(
      `SELECT COUNT(*) AS wszystkie,
              SUM(CASE WHEN l.status = 'problem' THEN 1 ELSE 0 END) AS zWyjatkiem
         FROM delivery_line l JOIN delivery dd ON dd.id = l.delivery_id
        WHERE dd.dostawca = ?`
    )
    .get(dostawca) as { wszystkie: number; zWyjatkiem: number | null };

  const dni = (
    d
      .prepare(
        `SELECT (julianday(closed_at) - julianday(opened_at)) AS dni
           FROM delivery
          WHERE dostawca = ? AND status = 'done' AND closed_at IS NOT NULL
          ORDER BY dni`
      )
      .all(dostawca) as Array<{ dni: number }>
  )
    .map((w) => w.dni)
    .filter((n) => Number.isFinite(n) && n >= 0);

  return {
    dostawWRoku: wRoku.ile,
    udzialWyjatkow: linie.wszystkie
      ? Math.round(((linie.zWyjatkiem ?? 0) / linie.wszystkie) * 1000) / 10
      : null,
    medianaDni: dni.length
      ? Math.round(
          (dni.length % 2 === 1
            ? dni[(dni.length - 1) / 2]
            : (dni[dni.length / 2 - 1] + dni[dni.length / 2]) / 2) * 10
        ) / 10
      : null,
  };
}

/* ── Analiza dostaw (0.100.0) ────────────────────────────────────────────────
   Czwarty zakres zakładki ANALIZA. Trzy pozostałe powstały z PRZENOSIN — ich
   liczby były już gdzieś liczone i chodziło o to, żeby stanęły tam, gdzie
   ich miejsce. Ten nie: zakładka DOSTAWY nie miała ani jednej karty wglądu,
   a `statystykiDostawcy` wyżej liczy trzy liczby dla JEDNEGO dostawcy, na
   potrzeby kontekstu otwartej sprawy.

   Pytanie, na które ta funkcja odpowiada, brzmi „U KOGO SĄ PROBLEMY" — i dziś
   panel nie umie na nie odpowiedzieć inaczej niż przez otwieranie faktur po
   kolei i patrzenie na kafel dostawcy w każdej z osobna.

   Wszystko z tabel, które już są: `delivery`, `delivery_line`, `problem`.  */

export interface AnalizaDostaw {
  dni: number;
  /** Zamknięte W OKNIE — `done` i `external` razem, bo obie są załatwione. */
  zamknietych: number;
  /** Z tego zdjęte z listy bez ani jednego skanu. */
  pozaWertis: number;
  pozycjiRozlozonych: number;
  /** Udział pozycji z wyjątkiem, w procentach; null bez pozycji w oknie. */
  udzialWyjatkow: number | null;
  /** Mediana dni od otwarcia do zamknięcia; null bez próbki. */
  medianaDni: number | null;
  dostawcy: Array<{
    dostawca: string;
    dostaw: number;
    pozycji: number;
    udzialWyjatkow: number | null;
    medianaDni: number | null;
  }>;
  wyjatki: Array<{ typ: string; nazwa: string; otwartych: number; rozwiazanych: number }>;
  tygodnie: Array<{ tydzien: string; ile: number }>;
  szczyt: { tydzien: string; ile: number; medianaPozostalych: number } | null;
  daneDo: string | null;
}

/** Mediana z tablicy liczb, zaokrąglona do dziesiątych; null dla pustej. */
function medianaDni(liczby: number[]): number | null {
  if (liczby.length === 0) return null;
  const s = [...liczby].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  const m = s.length % 2 === 1 ? s[i] : (s[i - 1] + s[i]) / 2;
  return Math.round(m * 10) / 10;
}

export function analizaDostaw(dni: number): AnalizaDostaw {
  const d = db();
  const odKiedy = `-${dni} days`;

  /* `external` (rozłożone poza WERTIS) wchodzi do LICZBY dostaw, a nie do
     mediany czasu — ta sama reguła i to samo uzasadnienie co przy
     `statystykiDostawcy`: przyszła i ktoś się nią zajął, ale nikt jej tutaj
     nie rozkładał, więc nie ma czasu rozłożenia do zmierzenia. */
  const zamkniete = d
    .prepare(
      `SELECT status, (julianday(closed_at) - julianday(opened_at)) AS dni
         FROM delivery
        WHERE status IN ('done','external') AND closed_at >= datetime('now', ?)`
    )
    .all(odKiedy) as Array<{ status: string; dni: number }>;

  const czasy = zamkniete
    .filter((w) => w.status === "done")
    .map((w) => w.dni)
    .filter((n) => Number.isFinite(n) && n >= 0);

  const linie = d
    .prepare(
      `SELECT COUNT(*) AS wszystkie,
              SUM(CASE WHEN l.status = 'problem' THEN 1 ELSE 0 END) AS zWyjatkiem,
              SUM(CASE WHEN l.status IN ('done','partial') THEN 1 ELSE 0 END) AS rozlozone
         FROM delivery_line l JOIN delivery dd ON dd.id = l.delivery_id
        WHERE dd.closed_at >= datetime('now', ?)`
    )
    .get(odKiedy) as {
    wszystkie: number;
    zWyjatkiem: number | null;
    rozlozone: number | null;
  };

  /* Dostawcy JEDNYM zapytaniem, nie `statystykiDostawcy` w pętli. Ta pętla
     robiłaby trzy zapytania na dostawcę, a przy dwudziestu dostawcach to
     sześćdziesiąt zapytań na jedno wejście na zakładkę. Dopasowanie po
     `delivery.dostawca` — nazwa przepisana w chwili otwarcia — dokładnie
     tak samo jak wyżej, więc obie liczby mówią o tym samym zbiorze. */
  const poDostawcy = d
    .prepare(
      `SELECT dd.dostawca AS dostawca,
              COUNT(DISTINCT dd.id) AS dostaw,
              COUNT(l.id) AS pozycji,
              SUM(CASE WHEN l.status = 'problem' THEN 1 ELSE 0 END) AS zWyjatkiem
         FROM delivery dd LEFT JOIN delivery_line l ON l.delivery_id = dd.id
        WHERE dd.dostawca IS NOT NULL AND dd.closed_at >= datetime('now', ?)
        GROUP BY dd.dostawca`
    )
    .all(odKiedy) as Array<{
    dostawca: string;
    dostaw: number;
    pozycji: number;
    zWyjatkiem: number | null;
  }>;

  const czasyDostawcy = new Map<string, number[]>();
  for (const w of d
    .prepare(
      `SELECT dostawca, (julianday(closed_at) - julianday(opened_at)) AS dni
         FROM delivery
        WHERE dostawca IS NOT NULL AND status = 'done'
          AND closed_at >= datetime('now', ?)`
    )
    .all(odKiedy) as Array<{ dostawca: string; dni: number }>) {
    if (!Number.isFinite(w.dni) || w.dni < 0) continue;
    czasyDostawcy.set(w.dostawca, [...(czasyDostawcy.get(w.dostawca) ?? []), w.dni]);
  }

  const dostawcy = poDostawcy
    .map((w) => ({
      dostawca: w.dostawca,
      dostaw: w.dostaw,
      pozycji: w.pozycji,
      udzialWyjatkow: w.pozycji
        ? Math.round(((w.zWyjatkiem ?? 0) / w.pozycji) * 1000) / 10
        : null,
      medianaDni: medianaDni(czasyDostawcy.get(w.dostawca) ?? []),
    }))
    /* Malejąco po UDZIALE wyjątków, nie po liczbie dostaw: karta odpowiada na
       „u kogo są problemy", a dostawca z dwiema dostawami i połową pozycji do
       wyjaśnienia jest ważniejszy od tego z czterdziestoma bez ani jednej. */
    .sort((a, b) => (b.udzialWyjatkow ?? -1) - (a.udzialWyjatkow ?? -1) || b.dostaw - a.dostaw);

  /* Wyjątki liczą się po DACIE ZGŁOSZENIA, nie po dacie zamknięcia dostawy:
     zgłoszenie sprzed dwóch miesięcy na dostawie domkniętej wczoraj opisuje
     tamten tydzień, nie ten. Otwarte i rozwiązane osobno, bo to dwie różne
     wiadomości — ile się psuje i ile biuro nadąża domykać. */
  const wyjatki = (
    d
      .prepare(
        `SELECT typ,
                SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS otwartych,
                SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS rozwiazanych
           FROM problem WHERE created_at >= datetime('now', ?)
          GROUP BY typ ORDER BY COUNT(*) DESC`
      )
      .all(odKiedy) as Array<{ typ: string; otwartych: number | null; rozwiazanych: number | null }>
  ).map((w) => ({
    typ: w.typ,
    nazwa: PROBLEM_TYPES_LABELS[w.typ as ProblemType] ?? w.typ,
    otwartych: w.otwartych ?? 0,
    rozwiazanych: w.rozwiazanych ?? 0,
  }));

  /* Tygodnie z KALENDARZA, nie z danych — tydzień bez ani jednej domkniętej
     dostawy ma zostać na osi jako zero. Ten sam zabieg co przy pytaniach
     i zwrotach; wykres z dziurami czyta się jako błąd danych. */
  const liczby = new Map(
    (
      d
        .prepare(
          `SELECT strftime('%Y-%W', closed_at) AS tydzien, COUNT(*) AS ile
             FROM delivery
            WHERE status IN ('done','external') AND closed_at >= datetime('now', ?)
            GROUP BY tydzien`
        )
        .all(odKiedy) as Array<{ tydzien: string; ile: number }>
    ).map((w) => [w.tydzien, w.ile])
  );
  const tygodnie = (
    d
      .prepare(
        `WITH RECURSIVE kalendarz(dzien) AS (
           SELECT date('now', ?)
           UNION ALL SELECT date(dzien, '+1 day') FROM kalendarz WHERE dzien < date('now')
         )
         SELECT DISTINCT strftime('%Y-%W', dzien) AS tydzien FROM kalendarz ORDER BY tydzien`
      )
      .all(odKiedy) as Array<{ tydzien: string }>
  ).map((w) => ({ tydzien: w.tydzien, ile: liczby.get(w.tydzien) ?? 0 }));

  return {
    dni,
    zamknietych: zamkniete.length,
    pozaWertis: zamkniete.filter((w) => w.status === "external").length,
    pozycjiRozlozonych: linie.rozlozone ?? 0,
    udzialWyjatkow: linie.wszystkie
      ? Math.round(((linie.zWyjatkiem ?? 0) / linie.wszystkie) * 1000) / 10
      : null,
    medianaDni: medianaDni(czasy),
    dostawcy,
    wyjatki,
    tygodnie,
    szczyt: szczytTygodnia(tygodnie),
    daneDo:
      (d.prepare("SELECT MAX(closed_at) AS ost FROM delivery").get() as { ost: string | null })
        .ost ?? null,
  };
}

/**
 * Tydzień szczytowy wobec mediany pozostałych — materiał na jedno zdanie.
 *
 * Ta sama zasada i te same progi, co przy pytaniach (`wyliczSzczyt`,
 * services/pytania.ts) i przy śladzie audytowym (`szczytDnia`,
 * services/raporty.ts): zwracamy FAKTY, nie interpretację, a przy próbce zbyt
 * cienkiej — `null`, i wtedy zdania nie ma wcale.
 */
function szczytTygodnia(
  tygodnie: Array<{ tydzien: string; ile: number }>
): AnalizaDostaw["szczyt"] {
  if (tygodnie.length < 3) return null;
  const szczyt = tygodnie.reduce((a, b) => (b.ile > a.ile ? b : a));
  if (szczyt.ile === 0) return null;
  const reszta = medianaDni(tygodnie.filter((t) => t !== szczyt).map((t) => t.ile));
  if (reszta == null) return null;
  if (reszta > 0 && szczyt.ile < reszta * 1.5) return null;
  return { tydzien: szczyt.tydzien, ile: szczyt.ile, medianaPozostalych: reszta };
}

/**
 * Dostawa otwarta — czytamy SNAPSHOT, wprost z `delivery_line`.
 *
 * NIE przeliczamy `lok_oczekiwana` z kartoteki, choć byłoby to o jedno
 * zapytanie prościej: kolektor pracuje na wartości z chwili otwarcia i na niej
 * stoi wykrywanie rozjazdu. Odświeżenie jej tutaj sprawiłoby, że biuro widzi
 * inny adres oczekiwany niż osoba przy półce — i to bez śladu, że to dwie różne
 * liczby.
 */
function liniePoOtwarciu(deliveryId: number): PodgladLinii[] {
  const rows = db()
    .prepare("SELECT * FROM delivery_line WHERE delivery_id = ?")
    .all(deliveryId) as unknown as WierszLinii[];

  // wyjątki jednym zapytaniem na dostawę, nie per wiersz — dokument bywa
  // kilkudziesięciowierszowy, a strona odpytuje go co pół minuty
  const wgLinii = new Map<number, ProblemView[]>();
  for (const p of listByDelivery(deliveryId)) {
    if (p.lineId == null) continue;
    const lista = wgLinii.get(p.lineId) ?? [];
    lista.push(p);
    wgLinii.set(p.lineId, lista);
  }

  /* Adres oczekiwany liczony TĄ SAMĄ regułą co na kolektorze: pozycja
     nietknięta bierze żywy (patrz `adresyOczekiwane`). Inaczej biuro czytałoby
     inny adres niż osoba przy półce — i żaden z dwóch ekranów nie mówiłby, że
     to dwie różne liczby. */
  const adresy = adresyOczekiwane(rows.map((r) => r.tw_id));

  return rows.map((r) => {
    const oczekiwany = pozycjaNietknieta(r) ? adresy.get(r.tw_id) ?? null : r.lok_oczekiwana;
    return {
      lineId: r.id,
      twId: r.tw_id,
      sym: r.tw_symbol,
      name: r.tw_nazwa,
      qtyDoc: r.ilosc_dok,
      qtyDone: r.ilosc_odlozona,
      locExpected: oczekiwany,
      locActual: r.lok_faktyczna,
      status: r.status,
      mismatch: !!r.lok_faktyczna && !!oczekiwany && r.lok_faktyczna !== oczekiwany,
      // „bez lokalizacji" znaczy „NIGDZIE jeszcze nie leży" — pozycja bez adresu
      // w kartotece, ale już odłożona, ma adres i przestaje być decyzją
      bezLokalizacji: !oczekiwany && !r.lok_faktyczna,
      doneBy: r.done_by,
      doneAt: r.done_at,
      problemy: wgLinii.get(r.id) ?? [],
    };
  });
}

/**
 * Dokument nietknięty — pozycje wprost z faktury, tym samym helperem, którego
 * użyje `openDelivery`. To jest PROGNOZA, nie stan pracy, i strona mówi o tym
 * wprost.
 */
function liniePrzedOtwarciem(dokId: number): PodgladLinii[] {
  return pozycjeSnapshotu(dokId).map((p) => ({
    lineId: null,
    twId: p.twId,
    sym: p.sym,
    name: p.nazwa,
    qtyDoc: p.qtyDoc,
    qtyDone: 0,
    locExpected: p.locExpected,
    locActual: null,
    status: "todo",
    mismatch: false,
    bezLokalizacji: !p.locExpected,
    doneBy: null,
    doneAt: null,
    problemy: [],
  }));
}
