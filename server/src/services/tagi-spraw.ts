import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Słownik tagów spraw posprzedażowych ─────────────────────────────────────
   ZOSTAŁ SAM SŁOWNIK. Przypinania tagów do reklamacji nie ma już na żadnym
   ekranie, więc zeszło razem z kodem wiązań. Ekran Ustawień dalej prowadzi
   słownik, a zapisane przypięcia leżą w `reklamacja_tag_sprawy` nietknięte.

   SŁOWNIK JEST OTWARTY, ale nie dowolny. Właściciel wybrał „dodatkowo
   edytowalne", więc nazwy dopisuje biuro, a nie wydanie. Cena tej swobody jest
   znana z góry: pasek z czterdziestoma pigułkami przestaje być filtrem. Płacą
   ją trzy ograniczenia — jednoznaczność po małych literach, sufit aktywnych
   i wyłączanie zamiast kasowania.                                            */

/** Sufit AKTYWNYCH tagów. Prawo Hicka jest w Dekalogu punktem 5. */
export const MAKS_AKTYWNYCH = 20;

/** Nazwa ma się zmieścić na czipie w wierszu kolejki, nie w akapicie. */
export const MAKS_ZNAKOW_NAZWY = 30;

export interface Tag {
  id: number;
  nazwa: string;
  aktywny: boolean;
}

export class BladTagu extends Error {
  constructor(message: string, readonly kod = 400) { super(message); }
}

const zWiersza = (w: Record<string, unknown>): Tag => ({
  id: Number(w.id), nazwa: String(w.nazwa), aktywny: Number(w.aktywny ?? 1) === 1,
});

/**
 * Cały słownik, wyłączone na końcu.
 *
 * Wyłączone WRACAJĄ w odpowiedzi, a nie znikają: ekran ustawień musi je
 * pokazać, żeby dało się je włączyć z powrotem. Pilnowanie, których nie
 * podpowiadać przy sprawie, należy do ekranu — tu oddajemy prawdę o słowniku.
 */
export function slownikTagow(database: DatabaseSync = defaultDb()): Tag[] {
  return (database.prepare(
    "SELECT id, nazwa, aktywny FROM reklamacja_tag ORDER BY aktywny DESC, nazwa COLLATE NOCASE")
    .all() as Array<Record<string, unknown>>).map(zWiersza);
}

/** Nazwa po obcięciu białych znaków, z odmową zamiast cichego przycięcia. */
function sprawdzNazwe(nazwa: string): string {
  const n = nazwa.trim().replace(/\s+/g, " ");
  if (!n) throw new BladTagu("Tag bez nazwy nie powie nikomu niczego");
  if (n.length > MAKS_ZNAKOW_NAZWY) {
    /* Zdanie mówi OBIE liczby, bo próg jest nasz, nie techniczny: czip ma się
       zmieścić w wierszu kolejki obok numeru, terminu i sygnałów. */
    throw new BladTagu(
      `Nazwa tagu ma ${n.length} znaków, a na czipie mieści się ${MAKS_ZNAKOW_NAZWY}`);
  }
  return n;
}

function tagPoNazwie(
  database: DatabaseSync, nazwa: string, pomin?: number,
): Tag | null {
  const w = database.prepare(
    "SELECT id, nazwa, aktywny FROM reklamacja_tag WHERE lower(nazwa)=lower(?) AND id IS NOT ?")
    .get(nazwa, pomin ?? null) as Record<string, unknown> | undefined;
  return w ? zWiersza(w) : null;
}

/**
 * Nowy tag w słowniku.
 *
 * DUPLIKAT NIE JEST BŁĘDEM DO POKAZANIA, tylko trafieniem. Kto wpisuje nazwę,
 * która już jest, chce tego tagu, a nie zdania, że istnieje. Oddajemy więc
 * istniejący wiersz. Wyłączony przy okazji wraca do użytku: skoro ktoś wpisał
 * tę nazwę z palca, to jest mu potrzebna.
 */
export function utworzTag(
  database: DatabaseSync, nazwa: string, autor: { id: number; name: string },
): Tag {
  const n = sprawdzNazwe(nazwa);
  const istnieje = tagPoNazwie(database, n);
  if (istnieje) {
    if (!istnieje.aktywny) return przelaczTag(database, istnieje.id, true, autor);
    return istnieje;
  }

  const ile = database.prepare("SELECT count(*) n FROM reklamacja_tag WHERE aktywny=1")
    .get() as { n: number };
  if (Number(ile.n) >= MAKS_AKTYWNYCH) {
    /* Zdanie mówi liczbę i DROGĘ WYJŚCIA. Sufit bez wskazania, co zrobić, jest
       ścianą — Dekalog p. 6 każe powiedzieć trzy rzeczy, nie jedną. */
    throw new BladTagu(
      `Aktywnych tagów jest już ${MAKS_AKTYWNYCH}, a pasek filtra przestaje wtedy ` +
      "filtrować — wyłącz nieużywany w Ustawieniach, zanim dołożysz kolejny");
  }

  const id = Number(database.prepare(
    "INSERT INTO reklamacja_tag(nazwa, utworzyl_user_id) VALUES (?,?)")
    .run(n, autor.id).lastInsertRowid);
  logEvent("sprawa_tag_utworzony", autor.name, null, { id, nazwa: n }, autor.id, database);
  return { id, nazwa: n, aktywny: true };
}

/** Zmiana nazwy. Przypięcia zostają — to ten sam tag, inaczej nazwany. */
export function zmienNazweTagu(
  database: DatabaseSync, id: number, nazwa: string, autor: { id: number; name: string },
): Tag {
  const n = sprawdzNazwe(nazwa);
  const w = database.prepare("SELECT id, nazwa, aktywny FROM reklamacja_tag WHERE id=?")
    .get(id) as Record<string, unknown> | undefined;
  if (!w) throw new BladTagu(`Tag ${id} nie istnieje`, 404);
  if (tagPoNazwie(database, n, id)) {
    throw new BladTagu(`Tag o nazwie „${n}” już jest w słowniku`, 409);
  }
  database.prepare("UPDATE reklamacja_tag SET nazwa=? WHERE id=?").run(n, id);
  logEvent("sprawa_tag_nazwa", autor.name, null,
    { id, bylo: String(w.nazwa), jest: n }, autor.id, database);
  return { ...zWiersza(w), nazwa: n };
}

/**
 * Włączenie i wyłączenie tagu.
 *
 * KASOWANIA NIE MA I NIE BĘDZIE. Skasowany tag zniknąłby po cichu ze spraw
 * historycznych, a wtedy pytanie „dlaczego ta sprawa stała trzy tygodnie"
 * traci odpowiedź. Wyłączony nie podpowiada się przy nowej sprawie i tyle.
 */
export function przelaczTag(
  database: DatabaseSync, id: number, aktywny: boolean, autor: { id: number; name: string },
): Tag {
  const w = database.prepare("SELECT id, nazwa, aktywny FROM reklamacja_tag WHERE id=?")
    .get(id) as Record<string, unknown> | undefined;
  if (!w) throw new BladTagu(`Tag ${id} nie istnieje`, 404);
  if (aktywny) {
    const ile = database.prepare("SELECT count(*) n FROM reklamacja_tag WHERE aktywny=1")
      .get() as { n: number };
    if (Number(w.aktywny ?? 1) !== 1 && Number(ile.n) >= MAKS_AKTYWNYCH) {
      throw new BladTagu(
        `Aktywnych tagów jest już ${MAKS_AKTYWNYCH} — wyłącz inny, zanim włączysz ten`);
    }
  }
  database.prepare("UPDATE reklamacja_tag SET aktywny=? WHERE id=?").run(aktywny ? 1 : 0, id);
  logEvent(aktywny ? "sprawa_tag_wlaczony" : "sprawa_tag_wylaczony", autor.name, null,
    { id, nazwa: String(w.nazwa) }, autor.id, database);
  return { ...zWiersza(w), aktywny };
}
