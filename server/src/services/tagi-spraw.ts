import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Tagi spraw posprzedażowych (0.279.0) ────────────────────────────────────
   Właściciel poprosił o tagi w jednym celu: „abym łatwiej mógł znaleźć
   reklamacje, którymi się zajmuję". Tag jest więc SITEM, a nie ozdobą, i cała
   reszta decyzji z tego wynika.

   CZEGO TAG NIE ROBI, i to jest linia, której bronię: nie przestawia kolejki.
   §14.5 rozstrzygnął to samo przy kategoriach Copilota. Kolejność liczy termin
   i czas czekania — FAKTY o sprawie. Tag jest zdaniem biura i jedna pomyłka
   zakopałaby sprawę z zegarem na dole listy tak, że nikt by tego nie zauważył.

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

/** Tag przypięty do sprawy — tyle, ile niesie czip. */
export interface TagSprawy {
  id: number;
  nazwa: string;
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
 * DUPLIKAT NIE JEST BŁĘDEM DO POKAZANIA, tylko trafieniem. Agent, który wpisuje
 * „czeka na część" przy sprawie, chce ten tag PRZYPIĄĆ — nie dowiedzieć się,
 * że już istnieje. Oddajemy więc istniejący wiersz i wołający przypina go tak
 * samo jak nowy. Wyłączony przy okazji wraca do użytku: skoro ktoś wpisał tę
 * nazwę z palca, to jest mu potrzebna.
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

/** Czy sprawa o tym numerze w ogóle istnieje — numer tagu nie jest przepustką. */
function sprawaIstnieje(database: DatabaseSync, reklamacjaId: number): boolean {
  return database.prepare("SELECT 1 FROM reklamacja_klienta WHERE id=?")
    .get(reklamacjaId) !== undefined;
}

/**
 * Przypięcie tagu do sprawy.
 *
 * Drugie kliknięcie w ten sam tag NIE JEST błędem: klucz z dwóch kolumn
 * odrzuca duplikat, a my oddajemy `false` i nie zostawiamy drugiego śladu.
 * Dziennik ma mówić, co się zmieniło, a nie ile razy ktoś kliknął.
 */
export function przypnijTag(
  database: DatabaseSync, reklamacjaId: number, tagId: number,
  autor: { id: number; name: string },
): boolean {
  if (!sprawaIstnieje(database, reklamacjaId)) {
    throw new BladTagu(`Sprawa ${reklamacjaId} nie istnieje`, 404);
  }
  const tag = database.prepare("SELECT id, nazwa, aktywny FROM reklamacja_tag WHERE id=?")
    .get(tagId) as Record<string, unknown> | undefined;
  if (!tag) throw new BladTagu(`Tag ${tagId} nie istnieje`, 404);
  if (Number(tag.aktywny ?? 1) !== 1) {
    /* Wyłączonego nie przypinamy NOWYM sprawom, choć na starych zostaje.
       Inaczej „wyłączony" nie znaczyłoby nic. */
    throw new BladTagu(`Tag „${String(tag.nazwa)}” jest wyłączony z użycia`, 409);
  }

  const zmiana = database.prepare(`INSERT OR IGNORE INTO reklamacja_tag_sprawy
    (reklamacja_id, tag_id, dodal_user_id) VALUES (?,?,?)`)
    .run(reklamacjaId, tagId, autor.id);
  if (Number(zmiana.changes) === 0) return false;
  logEvent("sprawa_tag_przypiety", autor.name, null,
    { id: reklamacjaId, tagId, nazwa: String(tag.nazwa) }, autor.id, database);
  return true;
}

/**
 * Zdjęcie tagu ze sprawy.
 *
 * TO JEST CAŁE COFNIĘCIE, jakiego tag potrzebuje. Przypięcie i zdjęcie to
 * jedno kliknięcie w każdą stronę, więc osobna końcówka `/cofnij` nie miałaby
 * czego cofać — §25a.5 mówi o cofnięciu zamiast potwierdzenia, a nie
 * o cofnięciu obok istniejącej drogi powrotnej.
 */
export function odepnijTag(
  database: DatabaseSync, reklamacjaId: number, tagId: number,
  autor: { id: number; name: string },
): boolean {
  const tag = database.prepare("SELECT nazwa FROM reklamacja_tag WHERE id=?")
    .get(tagId) as { nazwa: string } | undefined;
  const zmiana = database.prepare(
    "DELETE FROM reklamacja_tag_sprawy WHERE reklamacja_id=? AND tag_id=?")
    .run(reklamacjaId, tagId);
  if (Number(zmiana.changes) === 0) return false;
  logEvent("sprawa_tag_zdjety", autor.name, null,
    { id: reklamacjaId, tagId, nazwa: tag?.nazwa ?? null }, autor.id, database);
  return true;
}

/** Tagi JEDNEJ sprawy, alfabetycznie — czipy w wierszu mają stać w miejscu. */
export function tagiSprawy(database: DatabaseSync, reklamacjaId: number): TagSprawy[] {
  return (database.prepare(`SELECT t.id, t.nazwa FROM reklamacja_tag_sprawy s
    JOIN reklamacja_tag t ON t.id = s.tag_id
    WHERE s.reklamacja_id = ? ORDER BY t.nazwa COLLATE NOCASE`)
    .all(reklamacjaId) as Array<Record<string, unknown>>)
    .map((w) => ({ id: Number(w.id), nazwa: String(w.nazwa) }));
}

/**
 * Tagi WSZYSTKICH spraw naraz, do doklejenia na liście.
 *
 * JEDNO ZAPYTANIE NA KOLEJKĘ, nie jedno na wiersz. Kolejka woła to raz i
 * rozdziela w pamięci; zapytanie per sprawa dałoby przy pięćdziesięciu
 * sprawach pięćdziesiąt jeden zapytań na każde odświeżenie ekranu.
 */
export function tagiWszystkichSpraw(database: DatabaseSync): Map<number, TagSprawy[]> {
  const mapa = new Map<number, TagSprawy[]>();
  for (const w of database.prepare(`SELECT s.reklamacja_id, t.id, t.nazwa
    FROM reklamacja_tag_sprawy s JOIN reklamacja_tag t ON t.id = s.tag_id
    ORDER BY t.nazwa COLLATE NOCASE`).all() as Array<Record<string, unknown>>) {
    const klucz = Number(w.reklamacja_id);
    const lista = mapa.get(klucz) ?? [];
    lista.push({ id: Number(w.id), nazwa: String(w.nazwa) });
    mapa.set(klucz, lista);
  }
  return mapa;
}
