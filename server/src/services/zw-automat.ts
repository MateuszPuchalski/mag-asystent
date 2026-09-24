import { config } from "../config.js";
import { type Db, transaction } from "../db/db.js";
import type { MmItem } from "../adapters/sfera.js";
import { logEvent } from "./events.js";
import { iloscLiczona } from "./ilosc-zwrotu.js";
import { skladPozycji } from "./komplety.js";
import { wypuscGotoweKoszyki } from "./kosze-zwrotow.js";
import { enqueueZw } from "./queue.js";

/* ── Automatyczny ZW do paragonu (0.349.0) ──────────────────────────────────
   Na nagraniu pracy biura ręczny ZW był najdłuższym krokiem zwrotu: paragon,
   „Wypisz zwrot", zera w pozycjach, które nie wróciły, rodzaj i płatność.
   Decyzje właściciela z 15 września 2026:
   • ZW powstaje SAM po zapisaniu kwoty — bez przycisku;
   • ZW niesie PEŁNĄ wartość zwróconego towaru, a potrącenie za uszkodzenie
     albo użycie idzie wyłącznie przez zwrot pieniędzy w Allegro;
   • wiersz przesyłki idzie za polem „Koszt dostawy";
   • korekty faktur (FS → KFS) zostają ręczne.

   Ten moduł ZLECA i ODBIERA. Dokument wystawia worker Sfery (C#), bo tylko
   on ma COM. Jak — zmierzyła sonda, stoi to w docs/sfera-com.md §2m.

   NIE IMPORTUJE `zwroty.ts`. To `zwroty.ts` woła tutaj, a import w drugą
   stronę zamknąłby cykl modułów — stąd surowy SQL tam, gdzie tamten plik ma
   własnego pomocnika.                                                         */

/** Kto podpisuje numer w osi zwrotu. Nie człowiek — on zapisał tylko kwotę. */
export const AUTOMAT_ZW = "automat (ZW przez Sferę)";

export interface OpcjeZw {
  wlaczony: boolean;
  /** `TW_ID_PRZESYLKA` — wiersz przesyłki na paragonie. */
  twIdPrzesylki: number;
}

/* Parametrem, nie odczytem w środku: `config` zamarza przy imporcie, więc test
   bez tego nie włączyłby automatu, nie przestawiając całego procesu. */
const zKonfiguracji = (): OpcjeZw =>
  ({ wlaczony: config.sferaZw, twIdPrzesylki: config.twIdPrzesylka });

/** Zadanie ZW przy zwrocie — to samo, co pokazuje panel. */
export interface ZadanieZw {
  id: number;
  status: string;
  numer: string | null;
  blad: string | null;
}

export function zadanieZw(database: Db, zwrotId: number): ZadanieZw | null {
  const q = database.prepare(
    `SELECT q.id, q.status, q.sgt_doc_number AS numer, q.error_msg AS blad
       FROM zwrot_klienta z JOIN sfera_queue q ON q.id = z.korekta_queue_id
      WHERE z.id=? AND q.type='zw'`).get(zwrotId) as
    { id: number; status: string; numer: string | null; blad: string | null } | undefined;
  return q
    ? { id: Number(q.id), status: String(q.status), numer: q.numer ?? null, blad: q.blad ?? null }
    : null;
}

export type WynikZleceniaZw = { queueId: number } | { pominiety: string } | null;

type Kto = { id: number | null; name: string };

/**
 * Zwrot, przy którym automat NIE zlecił ZW, dostaje zdanie w osi.
 *
 * Bez niego biuro widziałoby zwrot w DO KOREKTY i czekało na numer, który nie
 * przyjdzie. Zdanie mówi, co zatrzymało automat, więc wiadomo, co poprawić.
 */
function pomin(
  database: Db, zwrotId: number, powod: string, kto: Kto, teraz: Date, cicho = false,
): WynikZleceniaZw {
  if (cicho) return { pominiety: powod };
  database.prepare(`INSERT INTO zwrot_zdarzenie(zwrot_id, rodzaj, tresc, dane_json, kiedy_at, kto, kto_user_id)
    VALUES (?,'zw_pominiety',?,?,?,?,?)`)
    .run(zwrotId, `ZW wystawia biuro: ${powod}`, JSON.stringify({ powod }),
      teraz.toISOString(), kto.name, kto.id);
  return { pominiety: powod };
}

/**
 * Zleca ZW po zapisaniu kwoty. Woła to `zapiszKwote` PO swojej transakcji.
 *
 * Milczy (oddaje `null`) tam, gdzie ZW nie jest sprawą automatu: wyłączony
 * przełącznik, faktura zamiast paragonu, zwrot bez kwoty albo z numerem
 * korekty, zadanie już w drodze. Zdanie w osi (`pominiety`) dostaje wyłącznie
 * zwrot do PARAGONU, którego automat nie umie wystawić — tam biuro czeka.
 *
 * WYKONANE ZADANIE NIE WRACA. Jeśli ZW już powstał, a ktoś cofnął korektę
 * i kwotę, drugie zlecenie dałoby drugi dokument. Z błędu albo anulowania
 * zlecenie wraca, bo dokumentu tam nie ma — a gdyby jednak był (przerwany
 * zapis), szkic dostanie wyłącznie pozycje jeszcze niezwrócone i worker
 * odmówi na rozjeździe wartości.
 */
export function zakolejkujZw(
  database: Db, zwrotId: number, kto: Kto, teraz = new Date(), opcje: OpcjeZw = zKonfiguracji(),
  { cicho = false }: { cicho?: boolean } = {},
): WynikZleceniaZw {
  if (!opcje.wlaczony) return null;

  const z = database.prepare(
    `SELECT id, reference_number, external_id, werdykt, kwota_grosze, kwota_dostawa_grosze,
            korekta_numer, zamkniety_at, faktura_dok_id, faktura_numer, faktura_typ
       FROM zwrot_klienta WHERE id=?`).get(zwrotId) as {
      id: number; reference_number: string | null; external_id: string; werdykt: string | null;
      kwota_grosze: number | null; kwota_dostawa_grosze: number | null;
      korekta_numer: string | null; zamkniety_at: string | null;
      faktura_dok_id: number | null; faktura_numer: string | null; faktura_typ: string | null;
    } | undefined;
  if (!z || z.werdykt !== "przyjety" || z.kwota_grosze === null) return null;
  if (z.korekta_numer !== null || z.zamkniety_at !== null) return null;
  /* Faktury zostają ręczne (właściciel) — i bez zdania w osi, bo tam nikt nie
     czeka na automat. Symbol, nie kod: `faktura_typ` to snapshot symbolu. */
  if (z.faktura_typ !== "PA" || z.faktura_dok_id === null) return null;

  const juz = zadanieZw(database, zwrotId);
  if (juz && juz.status !== "error" && juz.status !== "cancelled") return null;

  const wybrane = database.prepare(
    `SELECT id, nazwa, cena_grosze, ilosc, ilosc_zwrocona FROM zwrot_klienta_pozycja
      WHERE zwrot_id=? AND w_zwrocie=1 ORDER BY id`).all(zwrotId) as Array<{
      id: number; nazwa: string; cena_grosze: number; ilosc: number; ilosc_zwrocona: number | null }>;
  if (!wybrane.length) {
    return pomin(database, zwrotId, "zwrot samej dostawy — ZW bez towaru", kto, teraz, cicho);
  }

  const dostawa = Number(z.kwota_dostawa_grosze ?? 0);
  if (dostawa > 0 && opcje.twIdPrzesylki <= 0) {
    return pomin(database, zwrotId, "brak TW_ID_PRZESYLKA, a zwrot oddaje koszt dostawy", kto, teraz, cicho);
  }

  /* KARTOTEKI TĄ SAMĄ DROGĄ CO KOSZYK. Komplet sprzedany jako jedna oferta
     stoi na paragonie osobnymi wierszami — `skladPozycji` rozbija go dla MM,
     więc ZW musi rozbić go identycznie. Dwie reguły dałyby ZW i MM na różne
     kartoteki. */
  const naTowar = new Map<number, number>();
  for (const p of wybrane) {
    const sklad = skladPozycji(database, Number(p.id));
    if (!sklad.skladniki.length) {
      return pomin(database, zwrotId,
        `„${p.nazwa}" nie ma ustalonej kartoteki (${sklad.powod ?? "brak składu"})`, kto, teraz, cicho);
    }
    for (const s of sklad.skladniki) {
      naTowar.set(s.twId, (naTowar.get(s.twId) ?? 0) + Number(s.ilosc));
    }
  }
  if (opcje.twIdPrzesylki > 0 && naTowar.has(opcje.twIdPrzesylki)) {
    return pomin(database, zwrotId, "pozycja zwrotu wskazuje kartotekę przesyłki", kto, teraz, cicho);
  }

  /* PEŁNA WARTOŚĆ, bez `potracenie_grosze` — decyzja właściciela. Ta sama
     suma cen co w `zapiszKwote`, tylko bez odejmowania. */
  const wartoscGrosze = wybrane.reduce(
    (s, p) => s + Math.round(Number(p.cena_grosze) * iloscLiczona(p)), 0) + dostawa;
  const pozycje: MmItem[] = [...naTowar]
    .map(([twId, qty]) => ({ twId, qty: Math.round(qty * 10000) / 10000 }))
    .sort((a, b) => a.twId - b.twId);
  const numerZwrotu = z.reference_number ?? z.external_id;
  const paragon = z.faktura_numer ?? `dok. ${z.faktura_dok_id}`;

  const queueId = transaction(database, () => {
    const id = enqueueZw({
      zwrotId, dokId: Number(z.faktura_dok_id), paragon, pozycje,
      przesylkaTwId: opcje.twIdPrzesylki, przesylkaZostaw: dostawa > 0, wartoscGrosze,
    }, {
      createdBy: kto.name, createdByRef: kto.id,
      label: `ZW · zwrot ${numerZwrotu}`,
      detail: `do ${paragon} · ${(wartoscGrosze / 100).toFixed(2)} zł`,
    }, database);
    database.prepare("UPDATE zwrot_klienta SET korekta_queue_id=? WHERE id=?").run(id, zwrotId);
    database.prepare(`INSERT INTO zwrot_zdarzenie(zwrot_id, rodzaj, tresc, dane_json, kiedy_at, kto, kto_user_id)
      VALUES (?,'zw_zlecony',?,?,?,?,?)`)
      .run(zwrotId, `ZW do ${paragon} zlecony automatowi`,
        JSON.stringify({ queueId: id, wartoscGrosze }), teraz.toISOString(), kto.name, kto.id);
    logEvent("zwrot_zw_zlecony", kto.name, null,
      { zwrotId, queueId: id, dokId: Number(z.faktura_dok_id), wartoscGrosze, pozycje }, kto.id, database);
    return id;
  })();
  return { queueId };
}

/**
 * ZW dla zwrotów, przy których zapis kwoty trafił na brak paragonu (0.476.0).
 *
 * Przegląd zwrotów z 23 września: `zakolejkujZw` woła wyłącznie zapis kwoty.
 * Paragon wiąże się z opóźnieniem — takt Allegro co pięć minut, import
 * Subiekta co minutę — więc zwrot zapisany o chwilę za wcześnie nie dostawał
 * ZW nigdy. Nikt nie wiedział, że czeka: automat milczy przy braku paragonu,
 * bo do tej chwili był to zwykle zwrot do faktury.
 *
 * Woła to `powiazZaleglosci` po każdym takcie, zaraz po wiązaniu dokumentów.
 *
 * TRZY BRAMKI PRZECIW DRUGIEMU DOKUMENTOWI, bo ZW to dokument fiskalny:
 * • zwrot bez żadnego zadania ZW przy sobie — błąd i czekanie ma już swoją
 *   drogę w kolejce;
 * • żadne zadanie ZW tego zwrotu nie żyje ani nie powstało — po cofniętej
 *   korekcie dokument stoi w Subiekcie, choć zwrot nie ma już do niego linku;
 * • zwrot bez zdania „ZW wystawia biuro". Biuro mogło je przeczytać
 *   i wystawiać ZW ręką — automat obok niego dałby dubel.
 *
 * Tryb cichy, bo przebieg idzie co kilka minut, a zdanie w osi przy każdym
 * zapisałoby oś tym samym powodem kilkaset razy.
 */
export function dokolejkujZalegleZw(
  database: Db, teraz = new Date(), opcje: OpcjeZw = zKonfiguracji(),
): number {
  if (!opcje.wlaczony) return 0;
  const kandydaci = database.prepare(
    `SELECT z.id FROM zwrot_klienta z
      WHERE z.werdykt='przyjety' AND z.kwota_grosze IS NOT NULL
        AND z.korekta_numer IS NULL AND z.zamkniety_at IS NULL
        AND z.faktura_typ='PA' AND z.faktura_dok_id IS NOT NULL
        AND z.korekta_queue_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM sfera_queue q WHERE q.type='zw'
              AND json_extract(q.payload,'$.zwrotId') = z.id
              AND q.status IN ('pending','waiting_for_doc','processing','done'))
        AND NOT EXISTS (SELECT 1 FROM zwrot_zdarzenie e
              WHERE e.zwrot_id = z.id AND e.rodzaj='zw_pominiety')`)
    .all() as Array<{ id: number }>;
  let zlecone = 0;
  for (const k of kandydaci) {
    const w = zakolejkujZw(database, Number(k.id), { id: null, name: AUTOMAT_ZW }, teraz, opcje,
      { cicho: true });
    if (w && "queueId" in w) zlecone++;
  }
  return zlecone;
}

/**
 * Człowiek wyprzedza automat: wpisuje numer albo poprawia kwotę.
 *
 * Woła to transakcja wołającego, więc tu nie ma własnej. Czekające zadanie
 * ANULUJEMY — inaczej powstałby drugi ZW obok ręcznego. Zadanie w trakcie
 * albo wykonane zatrzymuje operację zdaniem, bo dokument już jest albo zaraz
 * będzie w Subiekcie, a tego z panelu nie da się cofnąć.
 */
export function odsunZwPrzedRecznym(
  database: Db, zwrotId: number, co: "korekta" | "kwota", teraz = new Date(),
): void {
  const q = zadanieZw(database, zwrotId);
  if (!q) return;
  if (q.status === "processing") {
    throw new Error("Automat właśnie wystawia ZW w Subiekcie — poczekaj minutę i odśwież zwrot.");
  }
  if (q.status === "done") {
    throw new Error(co === "korekta"
      ? `Automat wystawił już ${q.numer ?? "ZW"} — numer wpisze się sam w ciągu minuty.`
      /* Usunięcie ZW w Subiekcie nie zmienia statusu zadania, więc stare
         zdanie odsyłało do ruchu bez skutku (0.484.6). Działa kolejność:
         numer wpisuje się sam, potem cofnięcie korekty, potem kwota. */
      : `${q.numer ?? "ZW"} już stoi w Subiekcie — numer wpisze się tu sam w ciągu minuty. ` +
        "Potem cofnij korektę i popraw kwotę; dokument w Subiekcie skoryguj ręcznie.");
  }
  if (q.status === "pending" || q.status === "waiting_for_doc") {
    /* Warunek na statusie w samym UPDATE: worker mógł wziąć zadanie między
       odczytem a zapisem, a wtedy anulowanie nie ma prawa przejść po cichu. */
    const anulowane = database.prepare(
      `UPDATE sfera_queue SET status='cancelled', processed_at=?
        WHERE id=? AND status IN ('pending','waiting_for_doc')`)
      .run(teraz.toISOString(), q.id);
    if (Number(anulowane.changes) === 0) {
      throw new Error("Automat właśnie wystawia ZW w Subiekcie — poczekaj minutę i odśwież zwrot.");
    }
    database.prepare("UPDATE zwrot_klienta SET korekta_queue_id=NULL WHERE id=?").run(zwrotId);
  }
}

/**
 * Numery ZW wystawionych przez worker Sfery trafiają do zwrotów.
 *
 * Woła to worker Node co minutę (`powrotyPoDokumentachSfery`): status `done`
 * pisze proces C#, więc ten proces nie ma zdarzenia, na którym mógłby zawisnąć.
 * Robi DOKŁADNIE to, co przycisk: numer, zamknięcie, podniesiona wersja — i po
 * wszystkim wypuszcza koszyki czekające na ten numer.
 *
 * Idempotentne: rusza wyłącznie zwroty bez numeru. Gdy import Subiekta zdążył
 * pierwszy (`zwiazKorekte`), zwrot ma już numer i zostaje nietknięty.
 */
export function wpiszNumeryZw(database: Db, teraz = new Date()): number {
  const gotowe = database.prepare(
    `SELECT z.id, q.id AS queue_id, q.sgt_doc_number AS numer
       FROM zwrot_klienta z JOIN sfera_queue q ON q.id = z.korekta_queue_id
      WHERE q.type='zw' AND q.status='done' AND q.sgt_doc_number IS NOT NULL
        AND z.korekta_numer IS NULL AND z.zamkniety_at IS NULL`)
    .all() as Array<{ id: number; queue_id: number; numer: string }>;

  let wpisane = 0;
  for (const g of gotowe) {
    try {
      const kiedy = teraz.toISOString();
      const zapisane = transaction(database, () => {
        const r = database.prepare(`UPDATE zwrot_klienta
          SET korekta_numer=?, korekta_zrodlo='sfera', zamkniety_at=?, wersja=wersja+1
          WHERE id=? AND korekta_numer IS NULL AND zamkniety_at IS NULL`)
          .run(g.numer, kiedy, g.id);
        if (Number(r.changes) === 0) return false;
        database.prepare(`INSERT INTO zwrot_zdarzenie(zwrot_id, rodzaj, tresc, dane_json, kiedy_at, kto)
          VALUES (?,'korekta',?,?,?,?)`)
          .run(g.id, `Korekta ${g.numer}`,
            JSON.stringify({ numer: g.numer, zrodlo: "sfera", queueId: Number(g.queue_id) }),
            kiedy, AUTOMAT_ZW);
        logEvent("zwrot_korekta", AUTOMAT_ZW, null,
          { zwrotId: Number(g.id), numer: g.numer, zrodlo: "sfera", queueId: Number(g.queue_id) },
          null, database);
        return true;
      })();
      if (zapisane) wpisane++;
    } catch (e) {
      console.warn("[zw] numer nie wszedł do zwrotu:", g.id, e instanceof Error ? e.message : e);
    }
  }
  /* PO transakcjach, jak w `zapiszKorekte`: `BEGIN IMMEDIATE` się nie
     zagnieżdża, a wypuszczenie ma własną atomowość na koszyk. */
  if (wpisane > 0) wypuscGotoweKoszyki(database, teraz);
  return wpisane;
}
