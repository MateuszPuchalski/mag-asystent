import type { DatabaseSync } from "node:sqlite";
import { logEvent } from "./events.js";
import type { Kategoria } from "./klasyfikacja-slownik.js";

/* ── Znacznik reklamacyjny po rozpoznaniu (8 października 2026) ─────────────
   Decyzja właściciela: rozmowa rozpoznana jako `COMPLAINT` dostaje znacznik
   „reklamacyjna" sama. Ten sam znacznik, który agent stawia ręcznie z menu
   rozmowy (`ustawReklamacyjna`), bo daje już plakietkę, sito i licznik
   w kolejce. Drugi, równoległy znak dla tej samej sprawy rozjechałby się
   z pierwszym przy pierwszej ręcznej poprawce.

   CZŁOWIEK MA OSTATNIE SŁOWO. Automat stawia znacznik wyłącznie w rozmowie,
   w której nikt go jeszcze nie ruszał. Agent, który zdjął znacznik, bo to
   jednak pytanie o dobór, nie zobaczy go z powrotem przy następnej wiadomości
   klienta. Zdjęcie jest więc trwałe, a postawienie odwracalne jednym
   kliknięciem — ta sama zasada co przy fladze „pilne" w przepływie kategorii.

   AUTOMAT ZNACZNIKA NIE ZDEJMUJE. Podziękowanie po reklamacji dostaje
   kategorię OTHER, a sprawa dalej jest reklamacją. Poprawka kategorii
   z reklamacji na inną też go nie zdejmuje: agent zdejmuje go sam, jednym
   kliknięciem w menu rozmowy, bo tylko on wie, czy sprawa przestała nią być.

   Moduł osobno, a nie w `conversations.ts`, bo tamten importuje
   `copilot-klasyfikacja.ts`, a ta woła ten plik. Osobny moduł nie robi
   cyklu importów między nimi.                                              */

/** Kategorie, które stawiają znacznik. Jedna, ale nazwana, nie wpisana w warunek. */
export const KATEGORIE_REKLAMACYJNE: readonly Kategoria[] = ["COMPLAINT"];

/**
 * Stawia znacznik, gdy kategoria jest reklamacyjna, a znacznika nikt nie
 * ruszał. Zwraca `true`, gdy coś zmieniła. Bez własnej transakcji: woła ją
 * zapis decyzji ze swojej, żeby znacznik i decyzja weszły razem albo wcale.
 */
export function oznaczReklamacyjnaPoRozpoznaniu(
  database: DatabaseSync, conversationId: number, kategoria: string,
  autor: { id: number | null; name: string },
): boolean {
  if (!(KATEGORIE_REKLAMACYJNE as readonly string[]).includes(kategoria)) return false;
  const r = database.prepare("SELECT reklamacyjna FROM conversation WHERE id=?")
    .get(conversationId) as { reklamacyjna: number } | undefined;
  if (!r || Number(r.reklamacyjna) === 1) return false;
  /* Każda zmiana znacznika, ręczna i nasza, zostawia wiersz na osi. Wiersz
     znaczy, że ktoś już o znaczniku zdecydował. */
  const ruszany = database.prepare(`SELECT 1 FROM conversation_event
    WHERE conversation_id=? AND event_type='reklamacyjna_changed' LIMIT 1`).get(conversationId);
  if (ruszany) return false;
  database.prepare("UPDATE conversation SET reklamacyjna=1 WHERE id=?").run(conversationId);
  database.prepare(`INSERT INTO conversation_event(conversation_id, message_id, event_type, payload)
    VALUES (?, NULL, 'reklamacyjna_changed', json_object('na', 1, 'autor', ?))`)
    .run(conversationId, autor.name);
  /* Konto jawnie, jak przy samej decyzji. Bez niego dziennik wziąłby konto
     z sesji, a rozpoznanie automatu bywa wołane w żądaniu agenta. */
  logEvent("rozmowa_reklamacyjna", autor.name, null,
    { conversationId, na: true, zrodlo: "klasyfikacja", kategoria }, autor.id, database);
  return true;
}
