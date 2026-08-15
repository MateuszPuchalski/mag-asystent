import { db, transaction } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { enqueueSetLocation } from "./queue.js";
import { logEvent } from "./events.js";
import { validateLocationCode } from "./locations.js";
import { parseLocs, pickingLoc } from "../locs.js";
import { pomijanaPozycja } from "../pomijane.js";
import { matchesLocPattern } from "../scan.js";
import { recordEanConflict } from "./ean.js";
import { raiseProblem } from "./problems.js";
import { bezOdpowiedzi, czekaNaOdpowiedz, notatkiDokumentu } from "./notatki.js";
import { aliasKodu } from "./ean-alias.js";
import { freshLock, lockedByOther } from "./locks.js";
import type {
  DeliveryDocument,
  DeliveryLineView,
  DeliveryView,
  ScanResolution,
} from "../types.js";

/* ── Tryb A: rozkładanie faktur zakupu (redesign v2.0) ───────────────────────
   Jednostką pracy jest DOKUMENT (D2), nie sesja.

   Skutek magazynowy niesie sam dokument w Subiekcie (księgowany wprost na MAG),
   więc zapisujemy WYŁĄCZNIE lokalizację (D1) — zero MM, zero waiting_for_doc,
   zero zależności od bufora; dostawę można rozkładać, zanim księgowość
   zaksięguje FZ.

   Zwroty wróciły do obsługi ręcznej w Subiekcie w 0.17.0.                     */

const nowIso = () => new Date().toISOString();

/**
 * Statusy linii, które nie wracają już do rutyny alejkowej.
 *
 * Eksportowane, bo postęp liczą trzy miejsca — `getDelivery`, `closeIfComplete`
 * i podgląd biura. Trzy własne listy rozjechałyby się przy pierwszym nowym
 * statusie, a objawem byłaby dostawa „zamknięta" z niezerowym licznikiem.
 */
export const TERMINAL_LINE: ReadonlySet<string> = new Set(["done", "skipped", "problem"]);

/**
 * Walidacja kodu lokalizacji w trybie A — twarda (§9, §16). Poza bazowymi
 * regułami (pusty / spacja / EAN) kod MUSI pasować do jednego ze wzorców:
 * regał `A01-02-03` albo miejsce paletowe `PAL-042`. Literówka w kartotece
 * („paletq29", „lA03-04-01") nigdy nie dopasuje się do skanu — ma być błędem
 * przy odkładaniu, a nie cichym zapisem fikcyjnego adresu.
 *
 * Wzorzec jest ten sam co w `validateLocationCode` (plan §3, jedno źródło);
 * różni się WYMUSZENIE: tu bezwarunkowe, tam sterowane `LOC_STRICT`, bo skan
 * lokalizacji jest w trybie A jedynym dowodem odłożenia (D3).
 */
export function validateDeliveryLocation(code: string): string | null {
  const base = validateLocationCode(code);
  if (base) return base;
  if (matchesLocPattern(code)) return null;
  return `Kod „${code}" nie jest poprawnym adresem (regał A01-02-03 albo paleta PAL-042)`;
}

/**
 * Lista faktur zakupu (N dni) z postępem liczonym z delivery_line.
 *
 * Dostawy oznaczone jako rozłożone POZA WERTIS wypadają z listy w całości.
 * Nie „wyszarzone na dole", tylko nieobecne: to nie jest praca ukończona,
 * tylko praca, której ta aplikacja nigdy nie dostała, a lista rozkładania
 * odpowiada wyłącznie na pytanie „co mam zrobić".
 *
 * Odsiew stoi TUTAJ, a nie w kolektorze, i to jest decyzja o wdrożeniu:
 * `stanDokumentu` w module `:core` zna trzy stany i nieznany status wrzuciłaby
 * do „w toku", czyli na sam GÓRĘ listy. Zmiana po stronie serwera działa
 * z APK, który magazynierzy mają w rękach dzisiaj — bez czekania na MDM.
 */
export function listDocuments(days = 14): DeliveryDocument[] {
  const poza = dokumentyPozaWertis();
  const docs = subiekt.listDeliveryDocuments(days).filter((d) => !poza.has(d.dok_id));
  const progress = db()
    .prepare(
      `SELECT d.id AS deliveryId,
              d.sgt_dok_id AS dokId,
              COUNT(l.id) AS total,
              SUM(CASE WHEN l.status IN ('done','skipped','problem') THEN 1 ELSE 0 END) AS done,
              d.status AS status
       FROM delivery d LEFT JOIN delivery_line l ON l.delivery_id = d.id
       GROUP BY d.id`
    )
    .all() as Array<{ deliveryId: number; dokId: number; total: number; done: number; status: string }>;
  const byDoc = new Map(progress.map((p) => [p.dokId, p]));
  const pozycje = subiekt.countPositionsByDoc();

  return docs.map((d) => {
    const p = byDoc.get(d.dok_id);
    const positions = pozycje.get(d.dok_id) ?? 0;
    return {
      dokId: d.dok_id,
      typ: d.typ,
      nrPelny: d.nr_pelny,
      dataWyst: d.data_wyst,
      dostawca: d.dostawca ?? "",
      positions,
      /** dokument w buforze jest normalnie dostępny do pracy (D1) */
      wBuforze: !!d.w_buforze,
      wPrzyjeciach: d.mag_id !== config.magId.MAG,
      linesTotal: p?.total ?? 0,
      linesDone: p?.done ?? 0,
      status: p?.status ?? null,
    };
  });
}

/**
 * Sprzątanie dostaw otwartych PRZED wprowadzeniem odsiewu pozycji usługowych.
 *
 * Snapshot jest snapshotem i normalnie się go nie rusza — ale wiersz
 * `PRZESYŁKA` jest tam skutkiem naszego niedopatrzenia, a nie stanem faktury,
 * i bez tego zostałby w bazie na zawsze: dostawa raz otwarta nigdy nie wraca
 * do gałęzi snapshotującej. Efektem byłaby garść dostaw, których NIE DA SIĘ
 * domknąć, bo jedyna zaległa pozycja jest niemożliwa do odłożenia.
 *
 * Kasujemy WYŁĄCZNIE linie nietknięte (`todo`, zero odłożone, bez blokady).
 * Gdyby ktoś zdążył coś na tej linii zrobić — odłożyć „na siłę" albo zgłosić
 * problem — to jest ślad ludzkiej decyzji i kasowanie go byłoby zacieraniem
 * historii, a nie sprzątaniem.
 */
function usunPozycjeUslugowe(deliveryId: number): void {
  const linie = db()
    .prepare(
      `SELECT id, tw_symbol FROM delivery_line
       WHERE delivery_id = ? AND status = 'todo' AND COALESCE(ilosc_odlozona, 0) = 0`
    )
    .all(deliveryId) as Array<{ id: number; tw_symbol: string }>;
  const doKasacji = linie.filter((l) => pomijanaPozycja(l.tw_symbol));
  if (doKasacji.length === 0) return;
  const del = db().prepare("DELETE FROM delivery_line WHERE id = ?");
  transaction(db(), () => {
    for (const l of doKasacji) del.run(l.id);
  })();
}

/** Pozycja dokumentu po agregacji i odsiewie — tak, jak wejdzie do snapshotu. */
export interface PozycjaSnapshotu {
  twId: number;
  sym: string;
  nazwa: string;
  qtyDoc: number;
  locExpected: string | null;
}

/**
 * Co wejdzie (albo weszło) do snapshotu dokumentu. CZYTA, niczego nie zapisuje.
 *
 * Wydzielone z `openDelivery`, bo od 0.36.0 ma DWÓCH wołających: snapshot przy
 * otwieraniu i podgląd biura dla dokumentu, którego nikt jeszcze nie tknął.
 * Gdyby każdy liczył zestaw wierszy po swojemu, biuro i hala patrzyłyby na dwie
 * różne faktury — i nikt by się nie dowiedział, która jest prawdziwa, bo obie
 * wyglądałyby wiarygodnie.
 *
 * Fallbacki (`?? String(twId)`, `?? ""`) są częścią kontraktu, nie ostrożnością:
 * kartoteka potrafi zniknąć z read-modelu między importami, a wtedy obie strony
 * muszą zmyślić DOKŁADNIE tak samo.
 */
export function pozycjeSnapshotu(dokId: number): PozycjaSnapshotu[] {
  /* Agregacja tego samego towaru (różne partie/ceny → jedna linia robocza).
     Magazynier ma przed sobą JEDNĄ paletę, więc widzi towar raz, z sumą.
     W Subiekcie duplikat jest normalny: dwie ceny, dwie partie, dwa wiersze. */
  const agg = new Map<number, number>();
  for (const p of subiekt.getDocumentPositions(dokId)) {
    agg.set(p.tw_id, (agg.get(p.tw_id) ?? 0) + p.ilosc);
  }
  const out: PozycjaSnapshotu[] = [];
  for (const [twId, qty] of agg) {
    const t = subiekt.getProductById(twId);
    // pozycja usługowa (`PRZESYŁKA`) nie wchodzi do rozkładania — uzasadnienie
    // i cena tej decyzji stoją w `src/pomijane.ts`
    if (pomijanaPozycja(t?.symbol)) continue;
    out.push({
      twId,
      sym: t?.symbol ?? String(twId),
      nazwa: t?.nazwa ?? "",
      qtyDoc: qty,
      locExpected: pickingLoc(t?.lokalizacja),
    });
  }
  return out;
}

/**
 * Kolejność alejkowa: sort po adresie docelowym, pozycje BEZ adresu na końcu.
 *
 * Faza 1 — alfabetycznie po kodzie, bo układ A→J odpowiada układowi alejek;
 * zamiana na prawdziwą trasę to zmiana tego jednego komparatora (§5).
 *
 * Wydzielone, żeby podgląd biura pokazywał pozycje w TEJ SAMEJ kolejności, co
 * kolektor. Dwa niezależne sortowania rozjechałyby się przy pierwszej zmianie
 * jednego z nich, a objawem byłoby „biuro czyta co innego, niż ja mam na
 * ekranie" — zgłoszenie nie do odtworzenia.
 */
export function porownajAlejkowo(
  a: { locExpected: string | null; sym: string },
  b: { locExpected: string | null; sym: string }
): number {
  if (!a.locExpected && !b.locExpected) return a.sym.localeCompare(b.sym);
  if (!a.locExpected) return 1;
  if (!b.locExpected) return -1;
  return a.locExpected.localeCompare(b.locExpected) || a.sym.localeCompare(b.sym);
}

/* ── Adres oczekiwany: co jest snapshotem, a co nie ──────────────────────────
   POWSTAŁO PO ZGŁOSZENIU Z HALI: ten sam towar na dwóch dostawach. Magazynier
   rozkłada pierwszą i nadaje nowy adres; w drugiej dostawie ten towar dalej
   pokazuje STARY. Przyczyny są dwie i każda osobno wystarczy:

     1. `lok_oczekiwana` zapisywała się RAZ, przy otwarciu dostawy. Dostawa
        otwarta wcześniej pokazywała stary adres już na zawsze — także długo po
        tym, jak kartoteka w Subiekcie była poprawna.
     2. Nawet dostawa otwarta ZARAZ po odłożeniu widziała stary adres, bo zapis
        leżał jeszcze w kolejce: worker go nie wykonał, a read-model `sgt_towar`
        odświeża się dopiero przy kolejnej synchronizacji z MSSQL.

   Skutek nie kończył się na złym adresie. Rozjazd (§4.3) liczył się względem
   zamrożonej wartości, więc odłożenie towaru pod adresem AKTUALNYM podnosiło
   fałszywy alarm ZAMIEŃ/DODAJ i zapisywało `location_mismatch` do raportu
   przepełnionych gniazd. Kolejność alejkowa też idzie po tym polu, czyli trasa
   prowadziła do starej półki.

   ROZSTRZYGNIĘCIE. Snapshot ma sens dla danych DOKUMENTU (co i ile przyjechało)
   — tam chroni pracę przed korektą faktury w trakcie. Adres nie jest daną
   dokumentu, tylko kartoteki, i zamrażanie go nie chroniło niczego. Dlatego:

     - pozycja, której NIKT jeszcze nie ruszył, bierze adres ŻYWY,
     - pozycja tknięta zachowuje swój snapshot, bo to zapis tego, czego
       spodziewaliśmy się w chwili wykonywania pracy.

   Cena jest jawna: gdy ktoś zmieni adres w trakcie czyjejś pracy, wiersz może
   przeskoczyć w kolejności. Przeskakuje jednak dokładnie wtedy, kiedy człowiek
   ma o tym wiedzieć, a alternatywą jest wysłanie go do złego regału.          */

/** Statusy zadania kolejki, które jeszcze NIE dotarły do Subiekta. */
const LOC_W_TOKU = ["pending", "processing", "waiting_for_doc", "error"];

/**
 * Jak długo po wykonaniu zadania ufamy jeszcze KOLEJCE, a nie kartotece.
 *
 * Zadanie `done` zapisało się do Subiekta, ale read-model `sgt_towar` dowiaduje
 * się o tym dopiero przy kolejnym imporcie. W tym oknie kartoteka mówi starą
 * prawdę i to ona jest źródłem przyczyny nr 2. Okno musi być dłuższe niż cykl
 * importu (stąd dwukrotność) i skończone, żeby zadanie sprzed tygodnia nie
 * nadpisywało w nieskończoność adresu zmienionego potem ręcznie w Subiekcie.
 */
const oknoPoZapisieMs = () => 2 * config.mssql.syncMs;

interface ZadanieAdresu {
  tw_id: number;
  payload: string;
}

/**
 * Adres oczekiwany dla kompletu towarów — kartoteka skorygowana o kolejkę.
 *
 * Ta sama zasada, którą stosuje już karta towaru i zawartość regału: pokazujemy
 * to, co BĘDZIE w Subiekcie, bo zapis jest tylko opóźniony, nie niepewny.
 * Zadanie w błędzie też się liczy — towar fizycznie leży tam, gdzie ktoś go
 * położył, niezależnie od tego, czy zapis przeszedł.
 */
export function adresyOczekiwane(twIds: number[]): Map<number, string | null> {
  const out = new Map<number, string | null>();
  if (twIds.length === 0) return out;

  for (const [twId, pole] of subiekt.lokalizacjeDlaTowarow(twIds)) {
    out.set(twId, pickingLoc(pole));
  }
  for (const twId of twIds) if (!out.has(twId)) out.set(twId, null);

  const dziury = twIds.map(() => "?").join(",");
  const luki = LOC_W_TOKU.map(() => "?").join(",");
  const swiezo = new Date(Date.now() - oknoPoZapisieMs()).toISOString();
  /* Ostatnie zadanie wygrywa — wcześniejsze i tak zostanie przez nie nadpisane.
     `ORDER BY id` plus nadpisywanie w pętli daje ten sam wynik co „ostatnie per
     towar", bez okna analitycznego. */
  const zadania = db()
    .prepare(
      `SELECT tw_id, payload FROM sfera_queue
       WHERE type='set_location' AND tw_id IN (${dziury})
         AND (status IN (${luki}) OR (status='done' AND processed_at >= ?))
       ORDER BY id`
    )
    .all(...twIds, ...LOC_W_TOKU, swiezo) as unknown as ZadanieAdresu[];

  for (const z of zadania) {
    try {
      const cel = pickingLoc((JSON.parse(z.payload) as { newValue?: string }).newValue ?? "");
      if (cel) out.set(z.tw_id, cel);
    } catch {
      // zadanie z popsutym payloadem nie ma prawa zepsuć adresu całej listy
    }
  }
  return out;
}

/**
 * Czy tej pozycji nikt jeszcze nie ruszył — tylko taka bierze adres żywy.
 *
 * `partial` NIE jest nietknięta: część partii już gdzieś leży i reszta ma
 * dojechać tam samo, więc adres z chwili pierwszego odłożenia jest tu
 * właściwą odpowiedzią, a nie przeszkodą.
 */
export const pozycjaNietknieta = (r: { status: string; ilosc_odlozona: number }): boolean =>
  r.status === "todo" && (r.ilosc_odlozona ?? 0) === 0;

/**
 * Adres oczekiwany JEDNEJ linii — żywy dla nietkniętej, snapshot dla reszty.
 *
 * Jedno miejsce dla wszystkich czytelników (lista, skan towaru, wykrywanie
 * rozjazdu, podgląd biura). Cztery własne warianty tej reguły rozjechałyby się
 * przy pierwszej poprawce, a objawem byłby inny adres na liście niż w panelu.
 */
export function adresLinii(r: {
  tw_id: number;
  status: string;
  ilosc_odlozona: number;
  lok_oczekiwana: string | null;
}): string | null {
  if (!pozycjaNietknieta(r)) return r.lok_oczekiwana;
  return adresyOczekiwane([r.tw_id]).get(r.tw_id) ?? null;
}

/**
 * Otwórz (lub wznów) rozkładanie dokumentu. Pozycje są snapshotowane w chwili
 * otwarcia — jeśli księgowość zmieni FZ w trakcie, praca się nie rozjeżdża.
 */
export function openDelivery(dokId: number, user: string): number {
  const existing = db()
    .prepare("SELECT id, status FROM delivery WHERE sgt_dok_id = ?")
    .get(dokId) as { id: number; status: string } | undefined;
  if (existing) {
    /* Dostawa zamknięta jako rozłożona poza WERTIS NIE otwiera się skanem.
       Ciche wskrzeszenie omijałoby rolę i powód, na których cała ta operacja
       stoi — a wskrzeszony dokument nie ma ani jednej linii, więc kolektor
       pokazałby pustą listę pracy i wyglądałoby to na awarię. */
    if (existing.status === "external") {
      throw new Error(
        "Dostawa jest oznaczona jako rozłożona poza WERTIS — cofa ją biuro w panelu /biuro"
      );
    }
    usunPozycjeUslugowe(existing.id);
    return existing.id;
  }

  const doc = subiekt.getDocument(dokId);
  if (!doc) throw new Error("Nie znaleziono dokumentu");

  // Magazyn skutku jest SNAPSHOTOWANY razem z pozycjami: decyduje o tym, czy
  // po rozłożeniu potrzebny jest MM. Gdyby czytać go na bieżąco z read-modelu,
  // przeksięgowanie dokumentu w połowie pracy zmieniałoby reguły w jej trakcie.
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, source_mag_id, status, opened_at)
         VALUES (?,?,?,?,?, 'open', ?)`
      )
      .run(doc.dok_id, doc.nr_pelny, doc.dostawca ?? "", doc.data_wyst, doc.mag_id, nowIso())
      .lastInsertRowid
  );

  /* Zestaw wierszy liczy `pozycjeSnapshotu` — ta sama funkcja, z której czyta
     podgląd biura. Odpytywanie adaptera dzieje się PRZED transakcją, więc
     transakcja obejmuje już tylko zapisy. */
  const pozycje = pozycjeSnapshotu(dokId);
  const ins = db().prepare(
    `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, lok_oczekiwana)
     VALUES (?,?,?,?,?,?)`
  );
  transaction(db(), () => {
    for (const p of pozycje) {
      ins.run(id, p.twId, p.sym, p.nazwa, p.qtyDoc, p.locExpected);
    }
  })();

  logEvent("delivery_open", user, null, { deliveryId: id, dokId });
  return id;
}

/**
 * Widok dostawy. Linie sortowane po lokalizacji docelowej (magazynier chodzi
 * alejkami, nie w kolejności z faktury), pozycje BEZ lokalizacji na końcu —
 * to są SKU wymagające decyzji, nie rutyny.
 */
export function getDelivery(id: number): DeliveryView | undefined {
  const d = db().prepare("SELECT * FROM delivery WHERE id = ?").get(id) as
    | {
        id: number;
        sgt_dok_id: number;
        sgt_dok_numer: string;
        dostawca: string | null;
        data_dok: string | null;
        source_mag_id: number | null;
        status: string;
        nr_przesylki: string | null;
        kurier_protokol: string | null;
      }
    | undefined;
  if (!d) return undefined;

  const rows = db()
    .prepare("SELECT * FROM delivery_line WHERE delivery_id = ?")
    .all(id) as Array<any>;

  /* Stany do panelu odkładania — komplet jednym zapytaniem (patrz adapter).
     SUROWE, bez korekty o kolejkę: przy półce liczy się to, co fizycznie
     stoi w regale, a nie to, co czeka na zapis do Subiekta. Rezerwacje też
     są tu nieistotne — towar zarezerwowany nadal zajmuje miejsce. */
  const twIds = rows.map((r) => r.tw_id as number);
  const stany = subiekt.stanyDlaTowarow(twIds);
  // pozycja nietknięta bierze adres ŻYWY — powód i cena przy `adresyOczekiwane`
  const adresy = adresyOczekiwane(twIds);

  const lines: DeliveryLineView[] = rows
    .map((r) => {
      const oczekiwany = pozycjaNietknieta(r) ? adresy.get(r.tw_id) ?? null : r.lok_oczekiwana;
      return {
        id: r.id,
        twId: r.tw_id,
        sym: r.tw_symbol,
        name: r.tw_nazwa,
        qtyDoc: r.ilosc_dok,
        qtyDone: r.ilosc_odlozona,
        locExpected: oczekiwany,
        locActual: r.lok_faktyczna,
        status: r.status,
        stanMag: stany.get(r.tw_id)?.mag ?? 0,
        stanMgp: stany.get(r.tw_id)?.mgp ?? 0,
        /** litera alejki — nagłówek sekcji na liście */
        aisle: oczekiwany ? String(oczekiwany)[0] : null,
      };
    })
    .sort(porownajAlejkowo);

  // linia z problemem wychodzi z rutyny alejkowej (żyje dalej na liście wyjątków),
  // więc nie trzyma dostawy otwartej — inaczej zgłoszenie problemu karałoby
  // zgłaszającego i nikt by go nie zgłaszał (D8)
  const done = lines.filter((l) => TERMINAL_LINE.has(l.status)).length;
  const problems = lines.filter((l) => l.status === "problem").length;
  return {
    id: d.id,
    dokId: d.sgt_dok_id,
    nrPelny: d.sgt_dok_numer,
    dostawca: d.dostawca ?? "",
    dataWyst: d.data_dok ?? "",
    status: d.status,
    progress: { total: lines.length, done, remaining: lines.length - done, problems },
    /* NULL, gdy dostawa zaksięgowała się wprost na halę — wtedy nie ma czego
       przesuwać i kolektor chowa cały skrót. Kontener stoi na MGP i zostawia
       stan do przeniesienia, więc niesie tu swój magazyn. */
    sourceMagId:
      d.source_mag_id != null && d.source_mag_id !== config.magId.MAG ? d.source_mag_id : null,
    // null tu znaczy „jeszcze nie pytano" — kolektor pyta wtedy i tylko wtedy
    nrPrzesylki: d.nr_przesylki ?? null,
    kurierProtokol: d.kurier_protokol ?? null,
    notatki: notatkiDokumentu(d.sgt_dok_id),
    lines,
  };
}

/**
 * Skan towaru w kontekście dostawy → rozstrzygnięcie na linię.
 *
 * Niejednoznaczny EAN ZATRZYMUJE operację (D7): kod wskazujący >1 kartotekę
 * nigdy nie wybiera „pierwszego dopasowania". Jedyne automatyczne zawężenie:
 * gdy dokładnie jeden kandydat występuje w otwartym dokumencie.
 */
export function resolveScan(deliveryId: number, rawCode: string, user: string): ScanResolution {
  const code = rawCode.trim();
  const lines = db()
    .prepare("SELECT * FROM delivery_line WHERE delivery_id = ?")
    .all(deliveryId) as Array<any>;
  const lineByTw = new Map<number, any>(lines.map((l) => [l.tw_id, l]));

  // kandydaci: po EAN (może być wiele!) albo po symbolu
  let candidates = subiekt.findProductsByEan(code);
  if (candidates.length === 0) {
    const bySym = subiekt.getProductBySymbol(code);
    if (bySym) candidates = [bySym];
  }
  if (candidates.length === 0) {
    /* Kod nadany w WERTIS — FURTKA, sprawdzana dopiero, gdy kartoteka nie zna
       kodu ani jako EAN, ani jako symbol (0.37.0). Bez niej kod nadany przy
       jednej dostawie nie działałby przy następnej, dopóki worker i import nie
       przepchną go do Subiekta — czyli dokładnie tam, gdzie ktoś go nadał, żeby
       działał od razu. */
    const alias = aliasKodu(code);
    const t = alias ? subiekt.getProductById(alias.twId) : undefined;
    if (t) candidates = [t];
  }
  if (candidates.length === 0) return { kind: "unknown", code };

  if (candidates.length > 1) {
    const inDoc = candidates.filter((c) => lineByTw.has(c.tw_id));
    if (inDoc.length === 1) {
      // zawężenie kontekstem dokumentu — kolizja zostaje w logu jako dług w kartotece
      logEvent("ean_conflict_autoresolved", user, inDoc[0].tw_id, {
        ean: code,
        candidates: candidates.map((c) => c.tw_id),
      });
      recordEanConflict(code, candidates.map((c) => c.tw_id), true);
      return toResolution(inDoc[0], lineByTw.get(inDoc[0].tw_id));
    }
    logEvent("ean_conflict", user, null, {
      ean: code,
      candidates: candidates.map((c) => c.tw_id),
    });
    recordEanConflict(code, candidates.map((c) => c.tw_id), false);
    return {
      kind: "conflict",
      code,
      candidates: candidates.map((c) => {
        const l = lineByTw.get(c.tw_id);
        return {
          twId: c.tw_id,
          sym: c.symbol,
          name: c.nazwa,
          inDocument: !!l,
          qtyDoc: l?.ilosc_dok ?? null,
          locExpected: l ? l.lok_oczekiwana : pickingLoc(c.lokalizacja),
        };
      }),
    };
  }

  const p = candidates[0];
  const line = lineByTw.get(p.tw_id);
  if (!line) {
    return { kind: "off_document", code, twId: p.tw_id, sym: p.symbol, name: p.nazwa };
  }
  // Przy natłoku dostawę robi kilka osób. Nie odbieramy linii koledze po cichu:
  // druga osoba dowiaduje się, kto ją trzyma, i idzie dalej po alejce.
  const holder = lockedByOther(line.locked_by, line.locked_at, user);
  // `lineId` jedzie w odpowiedzi, bo bez niego brygadzista nie ma jak
  // odebrać linii przed TTL — a 30 minut czekania na kolegę, który
  // skończył zmianę, to czekanie na nic
  if (holder) {
    return { kind: "locked", code, lineId: line.id, lockedBy: holder, sym: p.symbol, name: p.nazwa };
  }

  claimLine(line.id, user);
  return toResolution(p, line);
}

/** Zajęcie linii na czas odkładania (TTL — patrz services/locks.ts). */
export function claimLine(lineId: number, user: string): void {
  db()
    .prepare("UPDATE delivery_line SET locked_by=?, locked_at=? WHERE id=?")
    .run(user, nowIso(), lineId);
}

/** Zwolnienie linii (anulowanie karty odkładania albo zakończenie operacji). */
export function releaseLine(lineId: number, user: string): { ok: true } {
  db()
    .prepare("UPDATE delivery_line SET locked_by=NULL, locked_at=NULL WHERE id=? AND locked_by=?")
    .run(lineId, user);
  return { ok: true };
}

/**
 * Zdjęcie CUDZEGO locka przed wygaśnięciem TTL.
 *
 * Bez tego jedyną drogą jest odczekanie 30 minut — a najczęstsza przyczyna
 * wiszącego locka to kolega, który skończył zmianę albo zgubił zasięg, więc
 * czeka się na nic. Operacja jest jednak uprzywilejowana i zawsze zostawia
 * ślad: to jedyne miejsce, gdzie jedna osoba odbiera pracę drugiej bez jej
 * wiedzy, więc audyt musi wiedzieć KOMU i przez KOGO.
 */
export function forceReleaseLine(lineId: number, user: string): { ok: true; odebrano: string | null } {
  const row = db()
    .prepare("SELECT locked_by, locked_at FROM delivery_line WHERE id=?")
    .get(lineId) as { locked_by: string | null; locked_at: string | null } | undefined;
  const holder = row ? freshLock(row.locked_by, row.locked_at) : null;
  db().prepare("UPDATE delivery_line SET locked_by=NULL, locked_at=NULL WHERE id=?").run(lineId);
  if (holder) logEvent("lock_forced", user, null, { lineId, odebrano: holder });
  return { ok: true, odebrano: holder };
}

function toResolution(p: { tw_id: number; symbol: string; nazwa: string }, line: any): ScanResolution {
  /* Ta trasa odpowiada na SKAN TOWARU, czyli dokładnie na moment rozwinięcia
     panelu odkładania — stan musi tu być, inaczej panel pokazywałby zera do
     najbliższego odświeżenia całej dostawy. Jeden towar, jedno zapytanie. */
  const stan = subiekt.stanyDlaTowarow([line.tw_id]).get(line.tw_id);
  /* Adres liczy się TU tak samo jak na liście — to jest ekran, na który
     magazynier patrzy przed pójściem do regału, więc rozjazd tych dwóch dróg
     wysyłałby go gdzie indziej, niż pokazywała lista sekundę wcześniej. */
  const oczekiwany = adresLinii(line);
  return {
    kind: "line",
    line: {
      id: line.id,
      twId: line.tw_id,
      sym: p.symbol,
      name: p.nazwa,
      qtyDoc: line.ilosc_dok,
      qtyDone: line.ilosc_odlozona,
      locExpected: oczekiwany,
      locActual: line.lok_faktyczna,
      status: line.status,
      stanMag: stan?.mag ?? 0,
      stanMgp: stan?.mgp ?? 0,
      aisle: oczekiwany ? String(oczekiwany)[0] : null,
    },
  };
}

export interface PutawayLineOpts {
  /** Ile sztuk odłożono; brak = cała reszta z dokumentu. */
  qty?: number;
  /**
   * Co zrobić z dotychczasowymi lokalizacjami, gdy magazynier odłożył gdzie
   * indziej (§4.3): 'replace' = towar przeniesiony, 'add' = druga lokalizacja.
   * Domyślnie 'replace' — zgodność ze ścieżką bez rozjazdu.
   */
  locAction?: "add" | "replace";
  /** Kod WPISANY z ręki, nie zeskanowany — zasila raport etykiet do przedruku. */
  recznie?: boolean;
}

/**
 * Odłożenie linii: skan lokalizacji jest OBOWIĄZKOWY (D3) — to jedyny dowód,
 * że towar trafił tam, gdzie system myśli. Zapis lokalizacji idzie do kolejki
 * jako `set_location`; ŻADNEGO dokumentu MM (D1).
 *
 * (`closeBasket`). Dzięki temu niezmiennik „ADRES ZAWSZE PRZED
 * SPRZEDAWALNOŚCIĄ" trzyma się sam: `set_location` każdej pozycji jest
 * zakolejkowany wcześniej niż MM, a worker bierze zadania po `id` rosnąco.
 */
export function putawayLine(
  lineId: number,
  location: string,
  user: string,
  opts: PutawayLineOpts = {}
): { ok: true; queueId?: number; mismatch: boolean; status: string } | { error: string; status?: number } {
  const line = db().prepare("SELECT * FROM delivery_line WHERE id = ?").get(lineId) as any;
  if (!line) return { error: "Brak pozycji" };
  const locAction = opts.locAction ?? "replace";

  const code = location.trim().toUpperCase();
  const locErr = validateDeliveryLocation(code);
  if (locErr) return { error: locErr };

  const putQty = opts.qty ?? Math.max(line.ilosc_dok - line.ilosc_odlozona, 0);
  if (!Number.isFinite(putQty) || putQty <= 0) return { error: "Ilość musi być większa od zera" };

  const doneQty = line.ilosc_odlozona + putQty;
  const status = doneQty >= line.ilosc_dok ? "done" : "partial";
  /* Rozjazd liczymy względem adresu, KTÓRY MAGAZYNIER MIAŁ NA EKRANIE, czyli
     żywego dla pozycji nietkniętej. Porównanie z zamrożonym snapshotem pytało
     ZAMIEŃ/DODAJ przy odłożeniu pod adresem AKTUALNYM i zaśmiecało raport
     przepełnionych gniazd fałszywym `location_mismatch`. */
  const oczekiwany = adresLinii(line);
  const mismatch = !!oczekiwany && oczekiwany !== code;

  // zapis lokalizacji do SGT — tylko gdy faktycznie się zmienia
  const t = subiekt.getProductById(line.tw_id);
  const current = parseLocs(t?.lokalizacja);
  let queueId: number | undefined;
  if (current[0] !== code) {
    const newLocs =
      locAction === "add"
        ? Array.from(new Set([code, ...current]))
        : // 'replace' — towar przeniesiony: nowa lokalizacja zastępuje pickingową
          Array.from(new Set([code, ...current.slice(1)]));
    queueId = enqueueSetLocation(line.tw_id, newLocs.join(" ").slice(0, config.locFieldLimit), {
      createdBy: user,
      twId: line.tw_id,
      label: "Lokalizacja · " + (t?.symbol ?? line.tw_id),
      detail: `${code} (dostawa)`,
    }, { locsPrzed: t?.lokalizacja ?? "", zrodlo: "dostawa" });
  }

  // skan półki jest zarazem potwierdzeniem POLICZONEJ ilości: w tej firmie
  // rozkładanie JEST sprawdzaniem faktury i liczy się każdą pozycję. Rozbieżność
  // zgłasza się osobno („INNA ILOŚĆ" → wyjątek ilościowy), więc dojście tutaj
  // znaczy „policzyłem, zgadza się".
  db()
    .prepare(
      `UPDATE delivery_line
       SET ilosc_odlozona=?, lok_faktyczna=?, status=?, done_at=?, done_by=?,
           locked_by=NULL, locked_at=NULL
       WHERE id=?`
    )
    .run(doneQty, code, status, nowIso(), user, lineId);

  /* Kod wpisany z ręki = sygnał zniszczonej etykiety regału. Ten sam kształt
     zdarzenia co przy ręcznym skanie (`manual_entry` w routes/products.ts),
     więc raport etykiet do przedruku widzi tę drogę bez żadnych zmian. */
  if (opts.recznie) {
    logEvent("manual_entry", user, line.tw_id, { code, kind: "LOC", zrodlo: "dostawa" });
  }
  logEvent("putaway_line_done", user, line.tw_id, {
    lineId,
    // ile linia miała odłożone PRZED tym zapisem — patrz `confirmItem`
    qtyPrzed: line.ilosc_odlozona ?? 0,
    qtyPo: doneQty,
    qty: putQty,
    location: code,
    expected: oczekiwany,
    status,
  });
  if (mismatch) {
    // częstotliwość per lokalizacja = raport o przepełnionych gniazdach
    logEvent("location_mismatch", user, line.tw_id, {
      lineId,
      expected: oczekiwany,
      actual: code,
    });
  }

  closeIfComplete(line.delivery_id, user);
  return { ok: true, queueId, mismatch, status };
}

/**
 * Dostawa zamyka się sama, gdy nie ma już czego rozkładać. Linia z wyjątkiem
 * liczy się jako domknięta — wypadła z rutyny alejkowej i żyje dalej na liście
 * wyjątków, więc trzymanie przez nią całej dostawy karałoby zgłaszającego (D8).
 */
export function closeIfComplete(deliveryId: number, user: string): void {
  /* Notatka biura bez odpowiedzi trzyma dostawę OTWARTĄ, choćby wszystkie
     pozycje były rozstrzygnięte. Bramka stoi tutaj, a nie tylko przy
     przycisku: samo domknięcie po ostatniej pozycji jest najczęstszą ścieżką
     w całej aplikacji, więc regułę pilnowaną wyłącznie przy przycisku
     obchodziłoby się przez zwykłe odłożenie towaru — czyli nie pilnowałoby jej
     nic. Dostawa czeka; ekran rozkładania pokazuje pytanie i pole odpowiedzi. */
  const dok = db()
    .prepare("SELECT sgt_dok_id AS dokId FROM delivery WHERE id = ?")
    .get(deliveryId) as { dokId: number } | undefined;
  if (dok && czekaNaOdpowiedz(dok.dokId)) return;

  const left = (
    db()
      .prepare(
        "SELECT COUNT(*) AS n FROM delivery_line WHERE delivery_id=? AND status NOT IN ('done','skipped','problem')"
      )
      .get(deliveryId) as { n: number }
  ).n;
  if (left > 0) return;
  db()
    .prepare("UPDATE delivery SET status='done', closed_at=? WHERE id=? AND status='open'")
    .run(nowIso(), deliveryId);
  logEvent("delivery_done", user, null, { deliveryId });
}

/* ── „Rozłożone poza WERTIS" ─────────────────────────────────────────────────
   Dostawa rozłożona starą aplikacją (albo z ręki, w pośpiechu) nie ma w WERTIS
   ANI JEDNEGO śladu — a postęp liczy się z `delivery_line`, więc odjęcie idzie
   od zera i cała ilość wygląda na zaległą. Dokument stoi na liście rozkładania
   jako nietknięty, a karta towaru mówi „w dostawie, nierozłożone" o towarze,
   który leży w regale.

   Do 0.40.0 nie było z tego wyjścia. Dokument RAZ OTWARTY w WERTIS zostaje na
   liście niezależnie od wieku (celowy wyjątek w imporcie: skrócenie okna nie ma
   kasować niedokończonej pracy), a domyka się dopiero, gdy każda linia jest
   `done`/`skipped`/`problem`. Towar już leży na półkach, więc nikt tych linii
   nie zeskanuje. Jedyną drogą było zgłoszenie WYJĄTKU na każdej pozycji, czyli
   wpisanie fikcyjnych niezgodności do protokołów rozbieżności — dokumentu
   księgowego. Narzędzie do sprzątania nie ma prawa fałszować dowodów.

   Dlatego osobny status i osobna operacja. Zamknięcie NIE UDAJE odłożenia:
   nie dopisuje ani jednej linii, nie zapisuje żadnego adresu, nie rusza
   Subiekta. Mówi tylko tyle, że tej pracy nie ma po co wystawiać na ekran —
   i mówi to podpisem oraz powodem.                                            */

/** Jedna dostawa zdjęta z listy pracy jako rozłożona poza WERTIS. */
export interface ZamknietaPozaWertis {
  dokId: number;
  nrPelny: string;
  dostawca: string;
  dataWyst: string;
  zamknietaAt: string;
  zamknietaBy: string;
  powod: string;
  /** Ile linii zdążył zapisać WERTIS, zanim dostawę zamknięto. */
  linie: number;
}

/** Wiersz `delivery` po numerze dokumentu w Subiekcie. */
function dostawaPoDokId(dokId: number) {
  return db().prepare("SELECT * FROM delivery WHERE sgt_dok_id = ?").get(dokId) as
    | {
        id: number;
        status: string;
        sgt_dok_numer: string;
        dostawca: string | null;
        data_dok: string | null;
      }
    | undefined;
}

function liczLinie(deliveryId: number): number {
  return (
    db()
      .prepare("SELECT COUNT(*) AS n FROM delivery_line WHERE delivery_id = ?")
      .get(deliveryId) as { n: number }
  ).n;
}

/**
 * Oznacz dostawę jako rozłożoną poza WERTIS.
 *
 * Działa w dwóch sytuacjach i to jest cały zakres:
 *
 *  - dokumentu NIKT w WERTIS nie otwierał — powstaje wiersz `delivery` BEZ
 *    linii. Brak linii jest tu treścią, nie brakiem danych: nikt tego nie
 *    rozkładał w tej aplikacji i snapshot pozycji udawałby, że było inaczej;
 *  - dostawa jest otwarta i porzucona — zostaje ze swoimi liniami dokładnie
 *    takimi, jakie są. Odłożone zostają odłożone, zaległe zaległe. Status
 *    dokumentu mówi „to się skończyło poza aplikacją", a nie „to się stało".
 *
 * Dostawa domknięta normalnie (`done`) nie przechodzi: nie ma czego zdejmować
 * z listy, a nadpisanie statusu skasowałoby fakt, że praca została wykonana
 * TUTAJ i ma pokrycie w skanach.
 */
export function zamknijPozaWertis(
  dokId: number,
  user: string,
  powodRaw: string
): { deliveryId: number; linie: number } {
  const powod = powodRaw.trim();
  if (!powod) throw new Error("Podaj powód — bez niego zamknięcie nie zostawia śladu");

  const istnieje = dostawaPoDokId(dokId);
  const at = nowIso();

  if (!istnieje) {
    const doc = subiekt.getDocument(dokId);
    if (!doc) throw new Error("Nie znaleziono dokumentu");
    const id = Number(
      db()
        .prepare(
          `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, source_mag_id,
                                status, opened_at, closed_at, closed_by, powod_zamkniecia)
           VALUES (?,?,?,?,?, 'external', ?,?,?,?)`
        )
        .run(doc.dok_id, doc.nr_pelny, doc.dostawca ?? "", doc.data_wyst, doc.mag_id, at, at, user, powod)
        .lastInsertRowid
    );
    logEvent("delivery_external", user, null, { deliveryId: id, dokId, powod, linie: 0 });
    return { deliveryId: id, linie: 0 };
  }

  if (istnieje.status === "external") {
    throw new Error("Ta dostawa jest już oznaczona jako rozłożona poza WERTIS");
  }
  if (istnieje.status === "done") {
    throw new Error("Dostawa została rozłożona w WERTIS — nie ma czego zdejmować z listy");
  }

  const linie = liczLinie(istnieje.id);
  db()
    .prepare(
      `UPDATE delivery SET status='external', closed_at=?, closed_by=?, powod_zamkniecia=?
       WHERE id=?`
    )
    .run(at, user, powod, istnieje.id);
  logEvent("delivery_external", user, null, {
    deliveryId: istnieje.id,
    dokId,
    powod,
    linie,
    // status sprzed zamknięcia: `open` to porzucona praca, którą właśnie
    // przykryliśmy — w audycie to jest inna sytuacja niż dokument nietknięty
    poprzedni: istnieje.status,
  });
  return { deliveryId: istnieje.id, linie };
}

/**
 * Cofnij zamknięcie — dostawa wraca na listę pracy.
 *
 * Bez tego pomyłkowe kliknięcie chowa prawdziwą dostawę na zawsze, a operacja
 * jest dostępna z przeglądarki, gdzie sąsiedni przycisk leży o centymetr dalej.
 *
 * Dostawa, której WERTIS nie zdążył nadać ani jednej linii, wraca do stanu
 * NIETKNIĘTEJ — wiersz znika. Zostawienie pustej dostawy w stanie `open`
 * pokazałoby na kolektorze dokument otwarty i bez pozycji, czyli pracę,
 * której nie da się wykonać ani zamknąć.
 */
export function cofnijZamkniecie(dokId: number, user: string): { przywrocona: "nowa" | "otwarta" } {
  const d = dostawaPoDokId(dokId);
  if (!d) throw new Error("Nie znaleziono dostawy");
  if (d.status !== "external") {
    throw new Error("Ta dostawa nie jest oznaczona jako rozłożona poza WERTIS");
  }

  const linie = liczLinie(d.id);
  /* Wyjątki zgłoszone przed zamknięciem trzymają wiersz przy życiu nawet bez
     linii: `problem.delivery_id` na niego wskazuje, a kasowanie zostawiłoby
     w protokołach rozbieżności sierotę. */
  const wyjatki = (
    db().prepare("SELECT COUNT(*) AS n FROM problem WHERE delivery_id = ?").get(d.id) as {
      n: number;
    }
  ).n;

  if (linie === 0 && wyjatki === 0) {
    db().prepare("DELETE FROM delivery WHERE id = ?").run(d.id);
    logEvent("delivery_external_undo", user, null, { deliveryId: d.id, dokId, przywrocona: "nowa" });
    return { przywrocona: "nowa" };
  }

  db()
    .prepare(
      "UPDATE delivery SET status='open', closed_at=NULL, closed_by=NULL, powod_zamkniecia=NULL WHERE id=?"
    )
    .run(d.id);
  logEvent("delivery_external_undo", user, null, {
    deliveryId: d.id,
    dokId,
    przywrocona: "otwarta",
    linie,
  });
  return { przywrocona: "otwarta" };
}

/**
 * Dostawy zdjęte z listy pracy — do przeglądu i cofnięcia w biurze.
 *
 * Ta lista MUSI istnieć: zamknięty dokument znika z `/api/delivery/documents`,
 * więc bez niej pomyłkowe zamknięcie nie miałoby gdzie zostać zauważone ani
 * jak zostać cofnięte. Kolejność od ostatnio zamkniętych, bo pomyłkę
 * zauważa się tego samego dnia.
 */
export function listaZamknietychPozaWertis(): ZamknietaPozaWertis[] {
  return (
    db()
      .prepare(
        `SELECT d.sgt_dok_id AS dokId, d.sgt_dok_numer AS nrPelny,
                COALESCE(d.dostawca,'') AS dostawca, COALESCE(d.data_dok,'') AS dataWyst,
                COALESCE(d.closed_at,'') AS zamknietaAt,
                COALESCE(d.closed_by,'') AS zamknietaBy,
                COALESCE(d.powod_zamkniecia,'') AS powod,
                (SELECT COUNT(*) FROM delivery_line l WHERE l.delivery_id = d.id) AS linie
         FROM delivery d
         WHERE d.status = 'external'
         ORDER BY d.closed_at DESC, d.id DESC`
      )
      .all() as unknown as ZamknietaPozaWertis[]
  );
}

/** `sgt_dok_id` dostaw zdjętych z listy pracy — filtr dla listy i karty towaru. */
export function dokumentyPozaWertis(): Set<number> {
  return new Set(
    (
      db().prepare("SELECT sgt_dok_id FROM delivery WHERE status = 'external'").all() as Array<{
        sgt_dok_id: number;
      }>
    ).map((r) => Math.trunc(r.sgt_dok_id))
  );
}

/* ── Zakończenie dostawy ────────────────────────────────────────────────────
   Do 0.42.0 dostawa nie miała momentu zamknięcia: `closeIfComplete` domykał ją
   sam, gdy OSTATNIA pozycja stała się terminalna. Praca, której nikt nie
   dokończył, zostawała więc otwarta w nieskończoność, a braki ilościowe —
   pozycje z odłożoną częścią — nie zamieniały się w nic. Magazynier, który
   znalazł 7 sztuk z 10, musiał pamiętać, żeby OSOBNO zgłosić wyjątek; jeśli
   nie pamiętał, różnica ginęła między dokumentem a półką bez śladu.

   Ta funkcja jest tym brakującym momentem i robi DWIE rzeczy, świadomie różne:

     - pozycja Z CZĘŚCIOWYM ODŁOŻENIEM (0 < odłożone < dokument) staje się
       wyjątkiem „zła ilość". Towar policzono i było go mniej — to jest fakt
       o DOSTAWIE i należy do protokołu rozbieżności;
     - pozycja NIETKNIĘTA (zero odłożone) staje się `skipped`, bez zgłoszenia.
       Brak pracy to nie brak towaru: nikt tego kartonu nie otworzył, więc
       twierdzenie wobec dostawcy nie ma pokrycia. Karta towaru pokazuje ją
       dalej jako „w dostawie", bo w regale jej nie ma.

   Rozróżnienie jest całą wartością tej operacji. Jedna reguła na obie sytuacje
   znaczyłaby albo reklamacje bez pokrycia, albo ciche gubienie braków.       */

/** Co powstało przy zamknięciu — kolektor pokazuje to człowiekowi PRZED zapisem. */
export interface PodsumowanieZakonczenia {
  /** Pozycje z niepełnym odłożeniem → wyjątki „zła ilość". */
  braki: Array<{ lineId: number; sym: string; nazwa: string; qtyDoc: number; qtyDone: number }>;
  /** Pozycje, których nikt nie tknął → `skipped`, bez zgłoszenia. */
  nietkniete: Array<{ lineId: number; sym: string; nazwa: string; qtyDoc: number }>;
}

interface WierszDoZamkniecia {
  id: number;
  tw_symbol: string;
  tw_nazwa: string;
  ilosc_dok: number;
  ilosc_odlozona: number | null;
}

/** Otwarte pozycje dostawy — te, które zamknięcie ma czym rozstrzygnąć. */
function otwarteLinie(deliveryId: number): WierszDoZamkniecia[] {
  return db()
    .prepare(
      `SELECT id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona
       FROM delivery_line
       WHERE delivery_id = ? AND status NOT IN ('done','skipped','problem')
       ORDER BY id`
    )
    .all(deliveryId) as unknown as WierszDoZamkniecia[];
}

/**
 * Co się stanie po zakończeniu. CZYTA, niczego nie zapisuje.
 *
 * Osobna funkcja, bo kolektor pokazuje to PRZED zapisem — a zgłoszenie do
 * dostawcy nie ma prawa powstać z przycisku, którego skutku nikt nie widział.
 */
export function podgladZakonczenia(deliveryId: number): PodsumowanieZakonczenia {
  const braki: PodsumowanieZakonczenia["braki"] = [];
  const nietkniete: PodsumowanieZakonczenia["nietkniete"] = [];
  for (const l of otwarteLinie(deliveryId)) {
    const done = l.ilosc_odlozona ?? 0;
    if (done > 0 && done < l.ilosc_dok) {
      braki.push({
        lineId: l.id,
        sym: l.tw_symbol,
        nazwa: l.tw_nazwa,
        qtyDoc: l.ilosc_dok,
        qtyDone: done,
      });
    } else if (done <= 0) {
      nietkniete.push({ lineId: l.id, sym: l.tw_symbol, nazwa: l.tw_nazwa, qtyDoc: l.ilosc_dok });
    }
  }
  return { braki, nietkniete };
}

/**
 * Zakończ dostawę: braki ilościowe → wyjątki, nietknięte → pominięte.
 *
 * Zwraca to samo podsumowanie co podgląd, więc kolektor pokazuje po zapisie
 * dokładnie to, co obiecał przed nim.
 */
export function zakonczDostawe(
  deliveryId: number,
  user: string
): PodsumowanieZakonczenia | { error: string } {
  const d = db()
    .prepare("SELECT status, sgt_dok_id AS dokId FROM delivery WHERE id = ?")
    .get(deliveryId) as { status: string; dokId: number } | undefined;
  if (!d) return { error: "Nie znaleziono dostawy" };
  if (d.status !== "open") return { error: "Ta dostawa jest już zamknięta" };

  /* Odmowa NAZYWA powód i cytuje pytanie. „Nie można zamknąć" bez treści
     notatki kazałoby szukać jej gdzie indziej — a szuka się jej wtedy,
     gdy człowiek stoi przy palecie i chce skończyć. */
  const czekaja = bezOdpowiedzi(d.dokId);
  if (czekaja.length > 0) {
    return {
      error:
        `Najpierw odpowiedz na notatkę biura: „${czekaja[0].tresc}"` +
        (czekaja.length > 1 ? ` (i ${czekaja.length - 1} kolejne)` : ""),
    };
  }

  const podsumowanie = podgladZakonczenia(deliveryId);

  /* Wyjątki idą przez `raiseProblem`, a nie przez własny INSERT: to on zna
     snapshot ilości z dokumentu, ustawia linii status `problem` i pisze do
     `events`. Drugi zapis obok byłby drugą definicją tego, czym jest wyjątek. */
  for (const b of podsumowanie.braki) {
    raiseProblem(
      {
        deliveryId,
        lineId: b.lineId,
        typ: "qty_mismatch",
        qty: b.qtyDone,
        opis: `Zakończenie dostawy: odłożono ${b.qtyDone} z ${b.qtyDoc}`,
      },
      user
    );
  }

  const pomin = db().prepare("UPDATE delivery_line SET status='skipped' WHERE id=?");
  transaction(db(), () => {
    for (const n of podsumowanie.nietkniete) pomin.run(n.lineId);
  })();

  logEvent("delivery_finished", user, null, {
    deliveryId,
    braki: podsumowanie.braki.length,
    nietkniete: podsumowanie.nietkniete.length,
  });
  /* Domknięcie liczy się TU, po wszystkich zmianach statusów — `raiseProblem`
     woła je po drodze, ale wtedy pozycje nietknięte są jeszcze otwarte. */
  closeIfComplete(deliveryId, user);
  return podsumowanie;
}

/* ── Korekta ilości odłożonej ────────────────────────────────────────────────
   Rozkładający pomyli się w liczeniu i chce poprawić, ZANIM zamknie fakturę.
   Do 0.45.0 nie było na to drogi: skan półki wyłącznie DODAJE sztuki, a jedynym
   sposobem na cofnięcie było zgłoszenie wyjątku — czyli wpis do protokołu
   rozbieżności, dokumentu idącego do dostawcy. Pomyłka w liczeniu zamieniała
   się w reklamację.

   Korekta NIE RUSZA SUBIEKTA i to jest jej cała lekkość: adres został zapisany
   przy odkładaniu i zostaje zapisany. `ilosc_odlozona` jest wyłącznie licznikiem
   postępu po stronie WERTIS, więc poprawka jest lokalna — kolejka Sfery nawet
   o niej nie wie.

   `lok_faktyczna` ZOSTAJE nawet przy korekcie do zera. Adres naprawdę
   pojechał do Subiekta i skasowanie go tutaj byłoby zacieraniem tego, co się
   wydarzyło. Zero znaczy „nic z tego nie leży na półce", a nie „nigdy nie było
   tu skanu".                                                                  */

/**
 * Ustaw ilość odłożoną na pozycji.
 *
 * Wartość BEZWZGLĘDNA, nie różnica: człowiek przy palecie wie, ile naprawdę
 * odłożył, a nie o ile się pomylił. Status przelicza się z liczby, więc
 * korekta w dół otwiera pozycję z powrotem do dokończenia, a w górę potrafi ją
 * domknąć — razem z całą dostawą, jeśli była ostatnia.
 *
 * Pozycja ze ZGŁOSZONYM WYJĄTKIEM nie przechodzi. Wyjątek jest twierdzeniem
 * wobec dostawcy i żyje własnym trybem (lista nierozwiązanych, protokół);
 * ciche przestawienie pod nim liczby zmieniałoby dokument, którego ta funkcja
 * nie widzi. Drogą jest rozwiązanie wyjątku, nie obejście go.
 */
export function korygujIlosc(
  lineId: number,
  qty: number,
  user: string
): { ok: true; status: string } | { error: string } {
  if (!Number.isFinite(qty) || qty < 0) return { error: "Ilość nie może być ujemna" };

  const l = db()
    .prepare(
      `SELECT l.id, l.delivery_id, l.tw_id, l.ilosc_dok, l.ilosc_odlozona, l.status,
              d.status AS stanDostawy, d.sgt_dok_id AS dokId
       FROM delivery_line l JOIN delivery d ON d.id = l.delivery_id
       WHERE l.id = ?`
    )
    .get(lineId) as
    | {
        id: number;
        delivery_id: number;
        tw_id: number;
        ilosc_dok: number;
        ilosc_odlozona: number | null;
        status: string;
        stanDostawy: string;
        dokId: number;
      }
    | undefined;
  if (!l) return { error: "Brak pozycji" };

  // „przed zakończeniem faktury" jest częścią zgłoszenia, nie ostrożnością:
  // po zamknięciu dostawa bywa już policzona w protokole rozbieżności
  if (l.stanDostawy !== "open") return { error: "Dostawa jest już zamknięta" };
  if (l.status === "problem") {
    return { error: "Pozycja ma zgłoszony wyjątek — najpierw rozwiąż go w wyjątkach" };
  }
  if (qty > l.ilosc_dok) {
    return { error: `Na dokumencie jest ${l.ilosc_dok} — więcej nie da się odłożyć` };
  }

  const przed = l.ilosc_odlozona ?? 0;
  const status = qty >= l.ilosc_dok ? "done" : qty > 0 ? "partial" : "todo";
  db()
    .prepare("UPDATE delivery_line SET ilosc_odlozona=?, status=? WHERE id=?")
    .run(qty, status, lineId);

  logEvent("putaway_qty_fixed", user, l.tw_id, {
    lineId,
    qtyPrzed: przed,
    qtyPo: qty,
    qtyDok: l.ilosc_dok,
    status,
  });

  // korekta w GÓRĘ potrafi być ostatnią brakującą sztuką całej dostawy
  closeIfComplete(l.delivery_id, user);
  return { ok: true, status };
}
