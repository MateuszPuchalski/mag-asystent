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
import { listByDelivery } from "./problems.js";
import type { ProblemView } from "../types.js";

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
    dataWyst: doc.data_wyst,
    wBuforze: !!doc.w_buforze,
    wPrzyjeciach: doc.mag_id !== config.magId.MAG,
    status: d?.status ?? null,
    notatki: notatkiDokumentu(dokId),
    zamkniecie:
      d && d.status === "external"
        ? { kto: d.closed_by, at: d.closed_at, powod: d.powod }
        : null,
    zrodlo: d && !bezSnapshotu ? "snapshot" : "podglad",
    progress: { total: lines.length, done, remaining: lines.length - done, problems },
    lines,
    problemyBezLinii: d ? listByDelivery(d.id).filter((p) => p.lineId == null) : [],
  };
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
