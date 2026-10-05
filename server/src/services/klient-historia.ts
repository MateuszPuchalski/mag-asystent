import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { linkZamowienia } from "./allegro-linki.js";
import { ROZMOWA_ZAMOWIENIA } from "./droga-klienta.js";

/* ── Historia klienta u nas (§10.1, zakładka KLIENT) ─────────────────────────
   Zakładka wróciła z makiety decyzją właściciela. §10.1 skreślił ją w 0.198.0
   zdaniem „nie ma bytu" — i to zdanie było prawdziwe o TABELI, nie o danych.
   Kupujący ma u nas login, po którym wiążą się jego zamówienia, rozmowy
   i sprawy. Wszystko to już leży w bazie.

   DLATEGO TU NIE MA ANI JEDNEJ NOWEJ TABELI. Osobny rejestr klienta
   rozjechałby się z kolejkami przy pierwszej poprawce — to jest dokładnie
   ten kształt, który w 0.128.0 kosztował cztery tabele nakładki spraw.
   Historia jest ODCZYTEM.

   TOŻSAMOŚĆ KLIENTA TO LOGIN ALLEGRO i nic więcej. Polityka danych skrzynki
   dopuszcza go wprost (`zamowienie_klienta.kupujacy_login`). Adres dostawy
   przechodzi przez mapowanie od 0.422.0, ale ta zakładka po nim nie wiąże
   i zmiana tego wymaga uzasadnienia w `docs/obsluga-klienta.md`. Bez loginu
   ekran mówi, że nie wie — zgadywanie klienta z treści rozmowy byłoby
   pokazaniem cudzych zakupów pod nazwiskiem, którego nikt nie potwierdził.

   LOGIN ROZMÓWCY TO LOGIN KUPUJĄCEGO — zweryfikował to właściciel
   24 września 2026 (`docs/allegro-ksztalt.md`). `client:44300444` z blizny
   0.56.6 to login kupującego bez konta, nie maska.

   PORÓWNANIE ZAWSZE BEZ WIELKOŚCI LITER (`COLLATE NOCASE`). Wątek i zamówienie
   potrafią podać ten sam login różnie zapisany („Chips20" i „chips20").
   Dokładne porównanie dawało wtedy pustą historię klientowi, który u nas
   kupował, a zakładka stała tak do 24 września 2026. */

export interface WpisHistorii {
  /* ── Trzy rodzaje doszły w S2 spoiwa (`docs/obsluga-klienta-calosc.md`) ────
     Zakładka obiecywała HISTORIĘ KLIENTA, a pokazywała jej połowę: zakupy
     i rozmowy. Zwrot, reklamacja i dyskusja tego samego kupującego leżały
     w bazie i nie docierały tu wcale, więc agent czytał „nic się nie działo"
     o kliencie, który miesiąc temu odesłał towar.

     Wiązanie idzie po LOGINIE, bo to oś tej zakładki. Zwrot i sprawa niosą
     `kupujacy_login` wprost z Allegro, a rozmowy — login z wątku
     (`interlocutor_login`). To jedno i to samo pole kupującego. */
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
  wpisy: WpisHistorii[];
}

const PUSTA: HistoriaKlienta = { login: null, wpisy: [] };

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Historia kupującego z tej rozmowy: zakupy, wcześniejsze rozmowy i sprawy.
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
     WHERE c.channel_account_id = ? AND t.interlocutor_login = ? COLLATE NOCASE
     ORDER BY c.updated_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

  return zbierz(database, konto, login, rozmowyKlienta, { rodzaj: "rozmowa", id: conversationId });
}

/**
 * Historia kupującego ZE ZWROTU albo ze SPRAWY posprzedażowej (23 września 2026).
 *
 * Z rozmowy do historii klienta był jeden klik od S2 spoiwa; ze zwrotu,
 * reklamacji i dyskusji — żaden. Agent przy zwrocie nie wiedział, że ten sam
 * kupujący pisał tydzień temu o tej samej części.
 *
 * LOGIN BIERZE SIĘ Z SAMEJ SPRAWY, nie z wątku. `kupujacy_login` zwrotu
 * i sprawy przychodzi z Allegro wprost. ROZMOWY dochodzą DWIEMA drogami:
 * numerem zamówienia (z zakupów tego loginu i z samej sprawy) oraz loginem
 * rozmówcy z wątku. Druga doszła 24 września 2026, gdy właściciel potwierdził,
 * że to login kupującego. Bez niej pytanie sprzed zakupu, które nie niesie
 * numeru zamówienia, nie trafiało do historii ze zwrotu.
 */
export function historiaSprawy(
  rodzaj: "zwrot" | "sprawa", id: number, database: DatabaseSync = db(),
): HistoriaKlienta {
  const w = database.prepare(rodzaj === "zwrot"
    ? "SELECT channel_account_id, kupujacy_login, order_id FROM zwrot_klienta WHERE id=?"
    : "SELECT channel_account_id, kupujacy_login, order_id, typ FROM reklamacja_klienta WHERE id=?",
  ).get(id) as Record<string, unknown> | undefined;
  if (!w) throw new Error(rodzaj === "zwrot" ? "Nie ma takiego zwrotu" : "Nie ma takiej sprawy");
  const konto = Number(w.channel_account_id);
  const login = tekst(w.kupujacy_login);
  if (!login) return PUSTA;

  const numery = new Set((database.prepare(
    "SELECT external_id FROM zamowienie_klienta WHERE channel_account_id = ? AND kupujacy_login = ? COLLATE NOCASE",
  ).all(konto, login) as Array<Record<string, unknown>>).map((z) => String(z.external_id)));
  const wlasny = tekst(w.order_id);
  if (wlasny) numery.add(wlasny);
  const lista = [...numery];
  /* `IN ()` z pustą listą to błąd składni SQLite, więc przy braku numerów
     warunek na zamówienie dostaje wartość, której nie ma żaden wiersz. */
  const numeryWarunek = lista.length ? lista : [""];
  const rozmowy = database.prepare(`
    SELECT c.id, c.subject, c.updated_at
      FROM conversation c
      LEFT JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE c.channel_account_id = ?
       AND (t.interlocutor_login = ? COLLATE NOCASE
            OR EXISTS (SELECT 1 FROM ${ROZMOWA_ZAMOWIENIA} rz WHERE rz.conversation_id = c.id
                        AND rz.numer IN (${numeryWarunek.map(() => "?").join(",")})))
     ORDER BY c.updated_at DESC`).all(konto, login, ...numeryWarunek) as Array<Record<string, unknown>>;

  const pomin = rodzaj === "zwrot"
    ? { rodzaj: "zwrot" as const, id }
    : { rodzaj: String(w.typ) === "DISPUTE" ? ("dyskusja" as const) : ("reklamacja" as const), id };
  return zbierz(database, konto, login, rozmowy, pomin);
}

/**
 * Konta, na których ten login coś ma, z loginem TAK, JAK ZAPISAŁO GO ALLEGRO.
 *
 * Cztery źródła naraz: zamówienia, zwroty, sprawy i wątki skrzynki. Zwykle
 * jedno konto, ale login jest unikalny w obrębie konta sprzedawcy, nie
 * globalnie — historia składa się per konto. Pusta lista znaczy „nie znamy”.
 *
 * Stała w profilu klienta; tu jest od 0.535.0, bo sprawa klienta pyta
 * o dokładnie to samo. Dwie kopie tego złączenia rozjechałyby się przy
 * pierwszym piątym źródle, a sprawa budziłaby się z innych rozmów, niż
 * profil pokazuje.
 */
export function kontaLoginu(
  database: DatabaseSync, login: string,
): Array<{ konto: number; login: string }> {
  return (database.prepare(`
    SELECT channel_account_id AS k, kupujacy_login AS l FROM zamowienie_klienta WHERE kupujacy_login = ?1 COLLATE NOCASE
    UNION SELECT channel_account_id, kupujacy_login FROM zwrot_klienta WHERE kupujacy_login = ?1 COLLATE NOCASE
    UNION SELECT channel_account_id, kupujacy_login FROM reklamacja_klienta WHERE kupujacy_login = ?1 COLLATE NOCASE
    UNION SELECT c.channel_account_id, t.interlocutor_login FROM conversation c
      JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE t.interlocutor_login = ?1 COLLATE NOCASE`).all(login) as Array<Record<string, unknown>>)
    .map((w) => ({ konto: Number(w.k), login: String(w.l) }));
}

/**
 * Rozmowy loginu na jednym koncie — dwiema drogami: login rozmówcy z wątku
 * i numery zamówień tego loginu (także wskazane ręcznie, przez
 * `ROZMOWA_ZAMOWIENIA`). Od najświeższej.
 *
 * JEDNA definicja dla osi profilu i dla sprawy klienta (0.535.0). Sprawa
 * budzi się z wiadomości w tych rozmowach, więc ręczna kopia zapytania
 * dawałaby obudzenie z rozmowy, której profil nie pokazuje — albo odwrotnie.
 */
export function rozmowyPoLoginie(
  database: DatabaseSync, konto: number, login: string,
): Array<{ id: number; subject: string | null; updated_at: string }> {
  const numery = (database.prepare(
    "SELECT external_id FROM zamowienie_klienta WHERE channel_account_id = ? AND kupujacy_login = ? COLLATE NOCASE",
  ).all(konto, login) as Array<Record<string, unknown>>).map((z) => String(z.external_id));
  const warunek = numery.length ? numery : [""];
  /* KANDYDACI NAJPIERW, konto potem. Warunek „login ALBO numer” na każdej
     rozmowie konta kazał SQLite przejrzeć wszystkie rozmowy — przy „Moje”
     liczone raz na każdą prowadzoną sprawę, co 30 sekund. Tu obie drogi idą
     po indeksach (login bez wielkości liter, wątek, numer zamówienia,
     wskazanie ręczne), a konto sprawdza się na kilku trafieniach. Plus przed
     `c.channel_account_id` to wskazówka dla planisty: bez niego wybiera indeks
     konta i wraca do przeglądania wszystkich rozmów. */
  return (database.prepare(`
    SELECT c.id, c.subject, c.updated_at
      FROM conversation c
     WHERE c.id IN (
             SELECT k.id FROM allegro_inbox_thread t
               JOIN conversation k ON k.external_conversation_id = t.id
              WHERE t.interlocutor_login = ? COLLATE NOCASE
             UNION
             SELECT rz.conversation_id FROM ${ROZMOWA_ZAMOWIENIA} rz
              WHERE rz.numer IN (${warunek.map(() => "?").join(",")}))
       AND +c.channel_account_id = ?
     ORDER BY julianday(c.updated_at) DESC, c.id DESC`).all(login, ...warunek, konto) as Array<Record<string, unknown>>)
    .map((r) => ({ id: Number(r.id), subject: tekst(r.subject), updated_at: String(r.updated_at) }));
}

/**
 * Login, którego SPRAWA KLIENTA dotyczy tej rozmowy (0.535.0), albo `null`.
 *
 * Najpierw rozmówca z wątku. Gdy wątek go nie niesie (schemat Allegro
 * dopuszcza `interlocutor: null`), login kupującego z zamówienia tej rozmowy,
 * na tym samym koncie, przez `ROZMOWA_ZAMOWIENIA` — tą samą drogą, którą
 * `rozmowyPoLoginie` dowiązuje rozmowę do klienta. Sprawa budzi się z takiej
 * rozmowy i prowadzi do niej odnośnikiem, więc rozmowa musi pokazać tę
 * sprawę: wiązanie jednostronne to wiązanie, którego nie ma.
 *
 * Dwóch różnych kupujących to `null`, a nie wybór jednego. Numer zamówienia
 * to fakt z Allegro; wybór między dwoma byłby zgadywaniem klienta — tego
 * samego, którego ta zakładka nie robi z treści rozmowy.
 */
export function loginSprawyRozmowy(database: DatabaseSync, conversationId: number): string | null {
  const r = database.prepare(`SELECT c.channel_account_id AS konto, t.interlocutor_login AS login
      FROM conversation c LEFT JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE c.id = ?`).get(conversationId) as Record<string, unknown> | undefined;
  if (!r) return null;
  const zWatku = tekst(r.login);
  if (zWatku) return zWatku;
  /* Bez wielkości liter: „Chips20” i „chips20” z dwóch zamówień to jeden klient. */
  const kupujacy = new Map<string, string>();
  for (const w of database.prepare(`SELECT DISTINCT z.kupujacy_login AS l
      FROM ${ROZMOWA_ZAMOWIENIA} rz
      JOIN zamowienie_klienta z ON z.external_id = rz.numer AND z.channel_account_id = ?
     WHERE rz.conversation_id = ?`).all(Number(r.konto), conversationId) as Array<Record<string, unknown>>) {
    const l = tekst(w.l);
    if (l) kupujacy.set(l.toLowerCase(), l);
  }
  return kupujacy.size === 1 ? [...kupujacy.values()][0] : null;
}

/**
 * Historia po SAMYM loginie, bez sprawy, z której się przyszło — dla profilu
 * klienta (24 września 2026). Rozmowy te same dwiema drogami co przy zwrocie:
 * login rozmówcy i numery zamówień tego loginu. Nic nie jest pomijane, bo
 * profil nie stoi obok żadnej otwartej sprawy.
 */
export function historiaPoLoginie(
  konto: number, login: string, database: DatabaseSync = db(),
): HistoriaKlienta {
  return zbierz(database, konto, login, rozmowyPoLoginie(database, konto, login), { rodzaj: "zakup", id: -1 });
}

/**
 * Wspólna reszta obu wejść: zakupy, zwroty i sprawy po loginie kupującego
 * oraz podane rozmowy. `pomin` wycina sprawę, z której ekran
 * pyta — stoi otwarta obok, a wiersz „jesteś tutaj" zabierałby miejsce.
 */
function zbierz(
  database: DatabaseSync, konto: number, login: string,
  rozmowyKlienta: Array<Record<string, unknown>>,
  pomin: { rodzaj: WpisHistorii["rodzaj"]; id: number },
): HistoriaKlienta {
  const zakupy = database.prepare(`
    SELECT k.external_id, k.kupiono_at,
           (SELECT group_concat(p.nazwa, ', ') FROM zamowienie_klienta_pozycja p
             WHERE p.zamowienie_id = k.id) AS pozycje
      FROM zamowienie_klienta k
     WHERE k.channel_account_id = ? AND k.kupujacy_login = ? COLLATE NOCASE
     ORDER BY k.kupiono_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

  /* Zwroty i sprawy posprzedażowe tego kupującego (S2 spoiwa). Oba niosą
     `kupujacy_login` z Allegro, więc konto plus login wystarczają — tak samo
     jak przy zakupach wyżej. Zamówienia w warunku NIE MA celowo: klient bywa
     u nas z kilkoma zakupami, a zakładka odpowiada na pytanie „czy ten klient
     już u nas był", nie „co z tą paczką". */
  const zwroty = database.prepare(`
    SELECT id, reference_number, order_id, created_at FROM zwrot_klienta
     WHERE channel_account_id = ? AND kupujacy_login = ? COLLATE NOCASE
     ORDER BY created_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

  const sprawy = database.prepare(`
    SELECT id, typ, reference_number, temat, order_id, otwarto_at
      FROM reklamacja_klienta
     WHERE channel_account_id = ? AND kupujacy_login = ? COLLATE NOCASE
     ORDER BY otwarto_at DESC`).all(konto, login) as Array<Record<string, unknown>>;

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
    ...rozmowyKlienta.map((r) => ({
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
  ].filter((w) => !(w.rodzaj === pomin.rodzaj && (w.rozmowaId ?? w.sprawaId) === pomin.id))
    .sort((a, b) => b.at.localeCompare(a.at));

  return { login, wpisy };
}
