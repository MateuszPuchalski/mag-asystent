import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { linkZamowienia } from "./allegro-linki.js";

/* ── Historia klienta u nas (§10.1, zakładka KLIENT) ─────────────────────────
   Zakładka wróciła z makiety decyzją właściciela. §10.1 skreślił ją w 0.198.0
   zdaniem „nie ma bytu" — i to zdanie było prawdziwe o TABELI, nie o danych.
   Kupujący ma u nas login, po którym wiąże się jego zamówienia, jego rozmowy
   i maszyny ustalone w tych rozmowach. Wszystkie trzy rzeczy już leżą w bazie.

   DLATEGO TU NIE MA ANI JEDNEJ NOWEJ TABELI. Osobny rejestr maszyn klienta
   trzeba by utrzymywać przy każdej zmianie doboru, a rozjechałby się przy
   pierwszej poprawce — to jest dokładnie ten kształt, który w 0.128.0
   kosztował cztery tabele nakładki spraw. Historia jest ODCZYTEM.

   TOŻSAMOŚĆ KLIENTA TO LOGIN ALLEGRO i nic więcej. Polityka danych skrzynki
   dopuszcza go wprost (`zamowienie_klienta.kupujacy_login`), a adresy dostawy
   nie przechodzą przez mapowanie i nie mają tu czego szukać. Bez loginu
   ekran mówi, że nie wie — zgadywanie klienta z treści rozmowy byłoby
   pokazaniem cudzych zakupów pod nazwiskiem, którego nikt nie potwierdził. */

export interface MaszynaKlienta {
  marka: string;
  nazwa: string;
  wariant: string | null;
  rocznik: string | null;
  silnik: string | null;
  /** Rozmowa, w której ustalono maszynę — makieta pisze „ustalone w rozmowie #N". */
  rozmowaId: number;
  at: string;
}

export interface WpisHistorii {
  /* ── Trzy rodzaje doszły w S2 spoiwa (`docs/obsluga-klienta-calosc.md`) ────
     Zakładka obiecywała HISTORIĘ KLIENTA, a pokazywała jej połowę: zakupy
     i rozmowy. Zwrot, reklamacja i dyskusja tego samego kupującego leżały
     w bazie i nie docierały tu wcale, więc agent czytał „nic się nie działo"
     o kliencie, który miesiąc temu odesłał towar.

     Wiązanie idzie po LOGINIE, bo to oś tej zakładki — i wolno tak wyłącznie
     dlatego, że zwrot i sprawa niosą `kupujacy_login` wprost z Allegro. Przy
     rozmowach ten sam ruch byłby błędem: `conversation` loginu nie trzyma,
     a rozmówca bywa zamaskowany (blizna 0.56.6). */
  rodzaj: "zakup" | "rozmowa" | "zwrot" | "reklamacja" | "dyskusja";
  at: string;
  /** Zdanie na oś: „Zakup szarpaka SZR-148/82" albo temat rozmowy. */
  tresc: string;
  /** Numer zamówienia u Allegro; przy rozmowie `null`. */
  zamowienieId: string | null;
  link: string | null;
  /** Rozmowa, do której wpis prowadzi; przy zakupie `null`. */
  rozmowaId: number | null;
  /**
   * Identyfikator sprawy albo zwrotu u NAS — po nim panel buduje odnośnik
   * do właściwej kolejki. `null` przy zakupie i rozmowie.
   */
  sprawaId: number | null;
}

export interface HistoriaKlienta {
  login: string | null;
  maszyny: MaszynaKlienta[];
  wpisy: WpisHistorii[];
}

const PUSTA: HistoriaKlienta = { login: null, maszyny: [], wpisy: [] };

/** Klucz maszyny — ten sam zwijacz co w `wiedza.ts`, żeby „NAC" i „nac" były jedną. */
const kluczMaszyny = (m: { marka: string; nazwa: string; wariant: string | null }) =>
  [m.marka, m.nazwa, m.wariant ?? ""].join("|").toLowerCase().replace(/\s+/g, " ").trim();

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Historia kupującego z tej rozmowy: maszyny, zakupy i wcześniejsze rozmowy.
 *
 * MASZYNY BIORĄ SIĘ Z DOBORÓW ZAMKNIĘTYCH (`confirmed`), nie z każdego, który
 * ma wpisaną markę. Dobór w trakcie niesie notatki robocze — agent wpisuje
 * markę, zanim cokolwiek ustali. „Ustalone w rozmowie" znaczy, że ktoś tę
 * rozmowę domknął doborem, i tylko to wolno pokazać jako wiedzę o kliencie.
 * Cena tej reguły jest widoczna: klient bez ani jednego domkniętego doboru
 * nie ma tu maszyn, choć rozmowa o nich była.
 *
 * Ta sama maszyna wpisana w kilku rozmowach zostaje JEDNA, z rozmową
 * NAJSTARSZĄ — pytanie brzmi „od kiedy to wiemy", nie „gdzie ostatnio padło".
 */
export function historiaKlienta(
  conversationId: number, database: DatabaseSync = db(),
): HistoriaKlienta {
  const rozmowa = database.prepare(
    "SELECT channel_account_id, external_conversation_id FROM conversation WHERE id=?",
  ).get(conversationId) as Record<string, unknown> | undefined;
  if (!rozmowa) throw new Error("Nie ma takiej rozmowy");

  /* Login rozmówcy trzyma lądowisko wątku, bo to pole Allegro, a nie nasz
     wniosek. `conversation.external_conversation_id` JEST identyfikatorem
     wątku — złączenie po nim, nie po temacie. */
  const konto = Number(rozmowa.channel_account_id);
  const login = tekst((database.prepare(
    "SELECT interlocutor_login FROM allegro_inbox_thread WHERE id=?",
  ).get(String(rozmowa.external_conversation_id)) as Record<string, unknown> | undefined)
    ?.interlocutor_login);
  if (!login) return PUSTA;

  /* Rozmowy TEGO SAMEGO loginu na TYM SAMYM koncie. Konto jest w warunku,
     bo login jest unikalny w obrębie konta sprzedawcy, nie globalnie. */
  const rozmowyKlienta = database.prepare(`
    SELECT c.id, c.subject, c.updated_at
      FROM conversation c
      JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE c.channel_account_id = ? AND t.interlocutor_login = ?
     ORDER BY c.updated_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

  const zakupy = database.prepare(`
    SELECT k.external_id, k.kupiono_at,
           (SELECT group_concat(p.nazwa, ', ') FROM zamowienie_klienta_pozycja p
             WHERE p.zamowienie_id = k.id) AS pozycje
      FROM zamowienie_klienta k
     WHERE k.channel_account_id = ? AND k.kupujacy_login = ?
     ORDER BY k.kupiono_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

  /* Zwroty i sprawy posprzedażowe tego kupującego (S2 spoiwa). Oba niosą
     `kupujacy_login` z Allegro, więc konto plus login wystarczają — tak samo
     jak przy zakupach wyżej. Zamówienia w warunku NIE MA celowo: klient bywa
     u nas z kilkoma zakupami, a zakładka odpowiada na pytanie „czy ten klient
     już u nas był", nie „co z tą paczką". */
  const zwroty = database.prepare(`
    SELECT id, reference_number, order_id, created_at FROM zwrot_klienta
     WHERE channel_account_id = ? AND kupujacy_login = ?
     ORDER BY created_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

  const sprawy = database.prepare(`
    SELECT id, typ, reference_number, temat, order_id, otwarto_at
      FROM reklamacja_klienta
     WHERE channel_account_id = ? AND kupujacy_login = ?
     ORDER BY otwarto_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

  /* Maszyny: dobory domknięte w rozmowach tego klienta. `marka` I `model`
     muszą stać oba — sama marka nie nazywa maszyny. */
  const idRozmow = rozmowyKlienta.map((r) => Number(r.id));
  const dobory = idRozmow.length === 0 ? [] : database.prepare(`
    SELECT conversation_id, marka, model, wariant, rocznik, silnik, updated_at
      FROM dobor_rozmowy
     WHERE status = 'confirmed' AND marka IS NOT NULL AND model IS NOT NULL
       AND conversation_id IN (${idRozmow.map(() => "?").join(",")})
     ORDER BY updated_at`).all(...idRozmow) as Array<Record<string, unknown>>;

  const maszyny = new Map<string, MaszynaKlienta>();
  for (const d of dobory) {
    const m: MaszynaKlienta = {
      marka: String(d.marka), nazwa: String(d.model), wariant: tekst(d.wariant),
      rocznik: tekst(d.rocznik), silnik: tekst(d.silnik),
      rozmowaId: Number(d.conversation_id), at: String(d.updated_at),
    };
    // `ORDER BY updated_at` wyżej + `has` tutaj = zostaje pierwsze ustalenie.
    if (!maszyny.has(kluczMaszyny(m))) maszyny.set(kluczMaszyny(m), m);
  }

  const wpisy: WpisHistorii[] = [
    ...zakupy.map((z) => ({
      rodzaj: "zakup" as const,
      at: String(z.kupiono_at ?? ""),
      tresc: tekst(z.pozycje) ?? "Zamówienie bez pozycji",
      zamowienieId: String(z.external_id),
      link: linkZamowienia(String(z.external_id)),
      rozmowaId: null,
      sprawaId: null,
    })),
    /* Bieżąca rozmowa NIE wchodzi na oś: stoi otwarta obok, a wiersz „jesteś
       tutaj" zabierałby miejsce historii, po którą agent tu przyszedł. */
    ...rozmowyKlienta.filter((r) => Number(r.id) !== conversationId).map((r) => ({
      rodzaj: "rozmowa" as const,
      at: String(r.updated_at),
      tresc: tekst(r.subject) ?? "Rozmowa bez tematu",
      zamowienieId: null,
      link: null,
      rozmowaId: Number(r.id),
      sprawaId: null,
    })),
    ...zwroty.map((z) => ({
      rodzaj: "zwrot" as const,
      at: String(z.created_at),
      tresc: tekst(z.reference_number) ?? "Zwrot bez numeru",
      zamowienieId: tekst(z.order_id),
      link: null,
      rozmowaId: null,
      sprawaId: Number(z.id),
    })),
    ...sprawy.map((r) => ({
      rodzaj: String(r.typ) === "DISPUTE" ? ("dyskusja" as const) : ("reklamacja" as const),
      at: String(r.otwarto_at),
      tresc: tekst(r.temat) ?? tekst(r.reference_number) ?? "Sprawa bez tematu",
      zamowienieId: tekst(r.order_id),
      link: null,
      rozmowaId: null,
      sprawaId: Number(r.id),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return { login, maszyny: [...maszyny.values()], wpisy };
}
