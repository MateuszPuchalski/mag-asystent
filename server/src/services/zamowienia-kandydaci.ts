import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
/* `imieAutora` jest WSPÓLNE z `conversations.ts`, a nie przepisane: imię do
   dziennika ma pochodzić z konta, nie z nagłówka, i druga kopia tej reguły
   rozjechałaby się przy pierwszej poprawce. */
import { imieAutora } from "./conversations.js";
import { linkZamowienia } from "./allegro-linki.js";
import { publishConversationEvent } from "./conversation-realtime.js";

/* ── KTÓRE ZAMÓWIENIE DOTYCZY TEJ ROZMOWY (0.397.0) ──────────────────────────
   Zgłoszenie właściciela ze zrzutem: klient napisał pod OFERTĄ „dzisiaj
   otrzymałem paczkę, ale nie było w zestawie świecy" — i nigdzie nie było
   powiązania tej rozmowy z jego zamówieniem.

   POWÓD JEST W ALLEGRO, nie u nas. Wątek z Centrum Wiadomości niesie JEDEN
   obiekt powiązany: `related.type` to `OFFER` albo `ORDER`. Pytanie zadane
   pod ofertą niesie numer OFERTY i nic więcej — numeru zamówienia w tym
   ładunku nie ma i nie będzie. Do 0.396.0 zamówienie rozmowy brało się
   WYŁĄCZNIE z wiadomości, która je niosła, więc cała reklamacja braku
   w paczce zostawała bez zakupu: bez pozycji, bez kwot, bez przesyłki,
   bez drogi zakupu.

   MOSTKIEM JEST LOGIN KUPUJĄCEGO. Trzyma go lądowisko wątku
   (`allegro_inbox_thread.interlocutor_login`) i ta sama kolumna stoi przy
   zamówieniu (`zamowienie_klienta.kupujacy_login`) — oba wprost z Allegro,
   żadne nie jest naszym wnioskiem. Tym samym mostkiem chodzi zakładka
   „Klient" od S2 spoiwa, więc nie zakładamy drugiej prawdy o tym samym.

   KANDYDACI, NIE ROZSTRZYGNIĘCIE. Klient miewa u nas kilka zakupów, a „ten
   sam login" nie znaczy „ta paczka". Automat, który wybrałby za człowieka,
   pomyliłby się cicho — i to przy sprawie o brak w zestawie, czyli tam, gdzie
   pomyłka kosztuje pieniądze. Dlatego serwis UKŁADA listę i mówi, co ją
   ułożyło, a wiąże dopiero kliknięcie agenta.                               */

export interface KandydatZamowienia {
  externalId: string;
  link: string | null;
  status: string | null;
  kupionoAt: string | null;
  sumaGrosze: number | null;
  waluta: string;
  /** Nazwy pozycji, po przecinku — po nich agent poznaje „to ta paczka". */
  pozycje: string;
  /**
   * Czy to zamówienie zawiera OFERTĘ, pod którą klient napisał.
   *
   * Najmocniejsza przesłanka, jaką mamy, i dlatego jedyna, która przestawia
   * kolejność. Reszta to sam czas zakupu.
   */
  maTeOferte: boolean;
}

/** Ręcznie wskazane zamówienie — wybór człowieka, nie fakt z Allegro. */
export interface ZamowienieWskazane { externalId: string; autor: string }

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Zamówienia kupującego z tej rozmowy — kandydaci do powiązania.
 *
 * Kolejność: najpierw te, które NIOSĄ ofertę z rozmowy, potem reszta, w obu
 * grupach od najnowszego. Zakup sprzed dwóch lat rzadko bywa tematem pytania
 * o dzisiejszą paczkę, ale zostaje na liście: „rzadko" to nie „nigdy", a lista
 * jest do czytania, nie do zgadywania.
 *
 * ODCZYT, NIC NIE ZAPISUJE. Otwarcie rozmowy ma prawo to policzyć („zero
 * zapisu przy patrzeniu"), a powiązanie powstaje osobnym kliknięciem.
 */
export function kandydaciZamowien(
  conversationId: number, database: DatabaseSync = db(),
): KandydatZamowienia[] {
  const rozmowa = database.prepare(
    "SELECT channel_account_id AS konto, external_conversation_id AS watek FROM conversation WHERE id=?",
  ).get(conversationId) as { konto: number; watek: string } | undefined;
  if (!rozmowa) return [];

  const login = tekst((database.prepare(
    "SELECT interlocutor_login FROM allegro_inbox_thread WHERE id=?",
  ).get(String(rozmowa.watek)) as { interlocutor_login?: unknown } | undefined)?.interlocutor_login);
  if (!login) return [];

  /* Oferta rozmowy — z najnowszej wiadomości KLIENTA, która ją niesie. Ta sama
     reguła, którą `szczegolRozmowy` wybiera jedną ofertę na wątek; gdyby stały
     tu dwie różne, ekran i ta lista mówiłyby o innym towarze. */
  const oferta = tekst((database.prepare(`SELECT related_object_id AS oferta
      FROM message
     WHERE conversation_id = ? AND related_object_type = 'OFFER'
       AND related_object_id IS NOT NULL AND direction = 'incoming'
     ORDER BY id DESC LIMIT 1`).get(conversationId) as { oferta?: unknown } | undefined)?.oferta);

  /* `COLLATE NOCASE` na loginie i to NIE jest ostrożność na wszelki wypadek:
     Allegro oddaje ten sam login raz małymi, raz wielkimi literami — w tej
     samej rozmowie nagłówek wątku mówi „chips20", a podpis wiadomości
     „CHIPS20". Porównanie z rozróżnianiem wielkości gubiłoby co drugi zakup
     i wyglądałoby jak „klient kupił u nas pierwszy raz". */
  const wiersze = database.prepare(`
    SELECT k.external_id, k.status, k.kupiono_at, k.suma_grosze, k.waluta,
           (SELECT group_concat(p.nazwa, ', ') FROM zamowienie_klienta_pozycja p
             WHERE p.zamowienie_id = k.id) AS pozycje,
           EXISTS (SELECT 1 FROM zamowienie_klienta_pozycja p
                    WHERE p.zamowienie_id = k.id AND p.offer_id = ?) AS ma_oferte
      FROM zamowienie_klienta k
     WHERE k.channel_account_id = ? AND k.kupujacy_login = ? COLLATE NOCASE
     ORDER BY ma_oferte DESC, k.kupiono_at DESC`)
    .all(oferta, rozmowa.konto, login) as Array<Record<string, unknown>>;

  return wiersze.map((w) => ({
    externalId: String(w.external_id),
    link: linkZamowienia(String(w.external_id)),
    status: tekst(w.status),
    kupionoAt: tekst(w.kupiono_at),
    sumaGrosze: w.suma_grosze == null ? null : Number(w.suma_grosze),
    waluta: String(w.waluta ?? "PLN"),
    pozycje: tekst(w.pozycje) ?? "Zamówienie bez pozycji",
    maTeOferte: Number(w.ma_oferte) === 1,
  }));
}

/**
 * Zamówienie wskazane ręcznie przy tej rozmowie.
 *
 * Czytane z `conversation_event`, dokładnie tak jak ręczne wskazanie oferty
 * od 0.179.0 — jedna mechanika na oba wskazania, bo to ta sama czynność
 * człowieka. Ostatni wpis wygrywa: pomyłkę poprawia się wskazaniem innego
 * zamówienia, a historia zostaje w zdarzeniach.
 */
export function zamowienieWskazane(
  conversationId: number, database: DatabaseSync = db(),
): ZamowienieWskazane | null {
  const w = database.prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='order_linked_manually'
    ORDER BY id DESC LIMIT 1`).get(conversationId) as { payload: string | null } | undefined;
  if (!w?.payload) return null;
  const p = JSON.parse(w.payload) as { externalId?: string; autor?: string };
  return p.externalId ? { externalId: p.externalId, autor: p.autor ?? "agent" } : null;
}

/**
 * Numer zamówienia, którego dotyczy rozmowa — JEDNA reguła dla ekranu i szkicu.
 *
 * Numer z najnowszej wiadomości KLIENTA, która go niesie; gdy klient go nie
 * podał — z najnowszej naszej; gdy nie ma żadnej — wskazanie człowieka.
 * Wiadomość bije wskazanie, bo numer z Allegro jest faktem, a wskazanie
 * wnioskiem (0.397.0). Reguła mieszkała w `osRozmowy` i trafiła tutaj, gdy
 * szkic Copilota zaczął pytać o przesyłkę tego samego zamówienia: druga kopia
 * rozjechałaby się przy pierwszej poprawce i szkic mówiłby o innej paczce,
 * niż pokazuje ekran.
 */
export function numerZamowieniaRozmowy(
  conversationId: number, database: DatabaseSync = db(),
): { konto: number; externalId: string } | null {
  const w = database.prepare(`SELECT related_order_id AS numer, channel_account_id AS konto
      FROM message WHERE conversation_id=? AND related_order_id IS NOT NULL
     ORDER BY direction='incoming' DESC, id DESC LIMIT 1`)
    .get(conversationId) as { numer: string; konto: number } | undefined;
  if (w) return { konto: Number(w.konto), externalId: String(w.numer) };
  const wskazane = zamowienieWskazane(conversationId, database);
  if (!wskazane) return null;
  const r = database.prepare("SELECT channel_account_id AS konto FROM conversation WHERE id=?")
    .get(conversationId) as { konto: number } | undefined;
  return r ? { konto: Number(r.konto), externalId: wskazane.externalId } : null;
}

/**
 * Ręczne wskazanie zamówienia dla rozmowy (0.397.0).
 *
 * WOLNO WSKAZAĆ WYŁĄCZNIE ZAKUP TEGO KUPUJĄCEGO. Nie jest to formalność:
 * powiązanie otwiera w tej rozmowie pozycje, kwoty, adres przesyłki i drogę
 * zakupu, więc numer spoza listy kandydatów pokazałby agentowi cudzy zakup
 * — a stamtąd wiedzie prosta droga do odpowiedzi wysłanej niewłaściwej osobie.
 * Serwer sprawdza to po swojemu, bo panel wysyła sam numer.
 */
export function wskazZamowienie(
  conversationId: number, externalId: string, autorId: number,
  database: DatabaseSync = db(),
) {
  const numer = (externalId ?? "").trim();
  if (numer === "") throw new Error("Wskazanie wymaga numeru zamówienia");
  const autor = imieAutora(database, autorId);

  const wynik = transaction(database, () => {
    const jest = database.prepare("SELECT id FROM conversation WHERE id=?").get(conversationId);
    if (!jest) throw new Error("Nie znaleziono rozmowy");
    const wolno = kandydaciZamowien(conversationId, database)
      .some((k) => k.externalId === numer);
    if (!wolno) {
      throw new Error("To zamówienie nie należy do kupującego z tej rozmowy");
    }
    database.prepare(`INSERT INTO conversation_event(conversation_id, message_id, event_type, payload)
      VALUES (?, NULL, 'order_linked_manually', json_object('externalId', ?, 'autor', ?))`)
      .run(conversationId, numer, autor);
    logEvent("rozmowa_zamowienie_wskazane", autor, null, { conversationId, externalId: numer },
      undefined, database);
    return { conversationId, externalId: numer, autor };
  })();

  publishConversationEvent("assignment.changed", conversationId, { externalId: numer });
  return wynik;
}
