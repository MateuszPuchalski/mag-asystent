import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { ofertaRozmowy } from "./kandydaci.js";
import { numerZamowieniaRozmowy } from "./zamowienia-kandydaci.js";
import { zamowienieRozmowy } from "./zamowienia.js";
import { cofnijStartAutomatu } from "./dobor.js";

/* ── TOWAR ZNANY Z ZAMÓWIENIA (0.499.0) ─────────────────────────────────────
   Zgłoszenie właściciela: nagłówek rozmowy o ZWROT mówił „Szukamy". Klient
   oddawał nóż 14-25001 kupiony w tym zamówieniu, a automat szkicu Copilota
   (0.341.0) wpisał „nóż, 16 mm" do danych doboru i przy pierwszym zapisie
   podniósł status do `searching`. Nagłówek i plakietka kolejki mówiły potem
   „Szukamy" o towarze, którego nikt nie szukał.

   Kolumna kontekstu chowa ten dobór za bramką od 0.499.0 (`skrzynka/kokpit.ts`).
   To jest ta sama reguła po stronie serwera: towar jest znany, gdy oferta
   rozmowy jest pozycją jej zamówienia. Dwie kopie jednej reguły to ryzyko
   rozjazdu, ale panel nie ma serwera w testach, a serwer nie ma panelu —
   obie strony mają więc test na te same przypadki.

   DANE AUTOMAT DALEJ WPISUJE, zdejmujemy tylko start. Marka i model maszyny
   przydają się przy pytaniu „czy pasuje do mojej", a to pytanie pada też pod
   zamówieniem. Szukania innego towaru nikt tu nie zaczął, więc status nie
   ma prawa tego twierdzić. Człowiek zaczyna dobór jak zawsze — ręcznie. */

/**
 * Czy oferta rozmowy jest pozycją jej zamówienia.
 *
 * Bez oferty z wiadomości ani wskazania rozstrzyga JEDYNA pozycja — ta sama
 * trzecia droga, którą `osRozmowy` wywodzi ofertę od 0.215.0. Zamówienie
 * jeszcze niepobrane to „nie wiemy", więc `false`: bramka ma się mylić
 * w stronę dawnego zachowania, nie w stronę chowania.
 */
export function towarZnanyZZamowienia(conversationId: number, database: DatabaseSync = db()): boolean {
  const numer = numerZamowieniaRozmowy(conversationId, database);
  if (!numer) return false;
  const pozycje = zamowienieRozmowy(numer.konto, numer.externalId, database)?.pozycje ?? [];
  if (pozycje.length === 0) return false;
  const oferta = ofertaRozmowy(database, conversationId);
  if (!oferta) return pozycje.length === 1 && pozycje[0].offerId !== null;
  return pozycje.some((p) => p.offerId !== null && String(p.offerId) === oferta.ofertaId);
}

/** Podpis porządku wstecznego — automat, więc bramka człowieka go nie zasłania. */
export const PORZADEK_DOBORU = { automat: "porządek znanych towarów" } as const;

/**
 * Jednorazowy porządek po wydaniach 0.341.0 – przed 0.499.0: zdejmuje
 * „Szukamy", które automat nadał rozmowom o towar znany z zamówienia.
 *
 * Biegnie przy każdym starcie i jest bezpieczny do powtórzeń. Po cofnięciu
 * ostatnia zmiana statusu to `searching → not_started`, więc drugi bieg nie
 * ma czego ruszyć. Zmiany człowieka nie dotyka nigdy — pilnuje tego
 * `cofnijStartAutomatu`. Zwraca liczbę cofniętych rozmów.
 */
export function uporzadkujStartyAutomatu(database: DatabaseSync = db()): number {
  const rozmowy = database.prepare(`SELECT conversation_id AS id FROM dobor_rozmowy
      WHERE status='searching' AND wybrany_tw_id IS NULL AND updated_by LIKE 'automat%'`)
    .all() as Array<{ id: number }>;
  let ile = 0;
  for (const { id } of rozmowy) {
    if (towarZnanyZZamowienia(Number(id), database)
      && cofnijStartAutomatu(Number(id), PORZADEK_DOBORU, database)) ile++;
  }
  return ile;
}
