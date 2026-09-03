import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import {
  LIMIT_ZALACZNIKA, TYPY_ZALACZNIKA, wgrajZalacznikDoAllegro, type WgrajZalacznik,
} from "./allegro-wysylka.js";

/* ── Załączniki do odpowiedzi (0.195.0) ──────────────────────────────────────
   Odczyt załączników klienta działa od 0.155.0; wysyłka nie istniała wcale.
   Przy pytaniach o części zdjęcie bywa CAŁĄ odpowiedzią — „ten gwint, nie
   tamten" pokazuje się szybciej, niż opisuje — a agent musiał po to iść do
   panelu Allegro, czyli dokładnie tam, skąd panel miał go zabrać (§25:
   „agent obsłuży typowe pytanie bez otwierania panelu Allegro").

   PLIK IDZIE DO ALLEGRO OD RAZU, nie przy wysyłce wiadomości. Dwa powody.
   Pierwszy: odmowę typu albo rozmiaru widać wtedy przy dodawaniu, gdy jeszcze
   da się wybrać inny plik — a nie przy WYŚLIJ, po napisaniu odpowiedzi.
   Drugi: bajtów nie trzymamy u siebie ani chwili dłużej, niż trzeba.

   Cena tej decyzji jest jawna: plik dodany i nigdy niewysłany zostaje
   w Allegro jako deklaracja bez wiadomości. To śmieć po ICH stronie, nie
   nasz, i nie ma końcówki, którą dałoby się go sprzątnąć.                    */

export interface ZalacznikDoWyslania {
  id: number;
  allegroId: string;
  nazwa: string;
  typ: string;
  rozmiar: number;
  dodal: string | null;
}

/**
 * Nasz limit jest MNIEJSZY niż limit Allegro i to jest świadome.
 *
 * Allegro bierze 5 MiB (`NewAttachmentDeclaration.size`, `maximum: 5242880`).
 * Plik jedzie do nas base64 w JSON, czyli rośnie o jedną trzecią, a `bodyLimit`
 * całego API stoi na 6 MiB. Podniesienie tamtego progu dla jednej funkcji
 * otworzyłoby KAŻDĄ trasę na sześciomegabajtowe ciała, więc próg jest tutaj.
 *
 * 4 MiB po zakodowaniu to ~5,6 MB, czyli mieści się z zapasem.
 */
export const LIMIT_NASZ = 4 * 1024 * 1024;

/** Rozszerzenie z typu — tylko do zdania w komunikacie, nie do walidacji. */
const PO_LUDZKU: Record<string, string> = {
  "image/png": "PNG", "image/gif": "GIF", "image/bmp": "BMP",
  "image/tiff": "TIFF", "image/jpeg": "JPEG", "application/pdf": "PDF",
};

export const DOZWOLONE_PO_LUDZKU = TYPY_ZALACZNIKA.map((t) => PO_LUDZKU[t]).join(", ");

export function zalacznikiRozmowy(
  database: DatabaseSync, conversationId: number,
): ZalacznikDoWyslania[] {
  return (database.prepare(`SELECT z.id, z.allegro_id, z.nazwa, z.typ, z.rozmiar, u.name AS dodal
    FROM wysylka_zalacznik z LEFT JOIN app_user u ON u.user_id = z.dodal_user_id
    WHERE z.conversation_id = ? ORDER BY z.id`).all(conversationId) as Array<Record<string, unknown>>)
    .map((w) => ({
      id: Number(w.id),
      allegroId: String(w.allegro_id),
      nazwa: String(w.nazwa),
      typ: String(w.typ),
      rozmiar: Number(w.rozmiar),
      dodal: w.dodal == null ? null : String(w.dodal),
    }));
}

/** Ile załączników wolno powiesić przy jednej odpowiedzi. */
export const MAKS_ZALACZNIKOW = 5;

export interface ZadanieZalacznika {
  conversationId: number;
  nazwa: string;
  typ: string;
  dane: Uint8Array;
  autor: { id: number; name: string };
  database?: DatabaseSync;
  wgraj?: WgrajZalacznik;
}

/**
 * Dodanie załącznika do szkicu: walidacja, wgranie do Allegro, zapis wiersza.
 *
 * Sieć stoi POZA zapisem i PO walidacji — ten sam układ co przy wysyłce
 * odpowiedzi. Wiersz powstaje wyłącznie po udanym wgraniu, bo wiersz bez
 * pliku po tamtej stronie obiecywałby załącznik, którego wysyłka nie znajdzie.
 */
export async function dodajZalacznik(z: ZadanieZalacznika): Promise<ZalacznikDoWyslania> {
  const database = z.database ?? db();
  const wgraj = z.wgraj ?? wgrajZalacznikDoAllegro;

  const nazwa = z.nazwa.trim();
  if (!nazwa) throw new Error("Załącznik bez nazwy pliku");
  if (!(TYPY_ZALACZNIKA as readonly string[]).includes(z.typ)) {
    throw new Error(
      `Allegro przyjmuje przy wiadomości tylko ${DOZWOLONE_PO_LUDZKU} — ten plik jest typu ${z.typ}`);
  }
  if (z.dane.byteLength === 0) throw new Error("Pusty plik nie idzie do klienta");
  if (z.dane.byteLength > LIMIT_NASZ) {
    /* Zdanie mówi OBIE liczby, bo różnica między naszym progiem a progiem
       Allegro jest nasza, nie ich — agent ma wiedzieć, że plik 4,5 MB nie
       odpadł przez Allegro. */
    throw new Error(
      `Plik ma ${(z.dane.byteLength / 1024 / 1024).toFixed(1)} MB, a przyjmujemy ` +
      `${LIMIT_NASZ / 1024 / 1024} MB (Allegro bierze ${LIMIT_ZALACZNIKA / 1024 / 1024} MB, ` +
      "różnica to koszt kodowania w naszym API)");
  }

  const ile = database.prepare("SELECT count(*) n FROM wysylka_zalacznik WHERE conversation_id=?")
    .get(z.conversationId) as { n: number };
  if (Number(ile.n) >= MAKS_ZALACZNIKOW) {
    throw new Error(`Do jednej odpowiedzi wolno dołączyć najwyżej ${MAKS_ZALACZNIKOW} plików`);
  }

  const { id: allegroId } = await wgraj(nazwa, z.typ, z.dane);

  const id = Number(database.prepare(`INSERT INTO wysylka_zalacznik
    (conversation_id, allegro_id, nazwa, typ, rozmiar, dodal_user_id)
    VALUES (?,?,?,?,?,?)`)
    .run(z.conversationId, allegroId, nazwa, z.typ, z.dane.byteLength, z.autor.id).lastInsertRowid);

  logEvent("rozmowa_zalacznik_dodany", z.autor.name, null,
    { conversationId: z.conversationId, allegroId, nazwa, typ: z.typ, rozmiar: z.dane.byteLength },
    z.autor.id, database);

  return { id, allegroId, nazwa, typ: z.typ, rozmiar: z.dane.byteLength, dodal: z.autor.name };
}

/**
 * Zdjęcie załącznika ze szkicu.
 *
 * Kasuje WYŁĄCZNIE nasz wiersz. Deklaracji po stronie Allegro nie da się
 * cofnąć — nie ma takiej końcówki — więc plik zostaje tam nieużyty i wygasa
 * sam. Ekran nie ma prawa obiecywać, że „usunięto go z Allegro".
 */
export function usunZalacznik(
  database: DatabaseSync, conversationId: number, id: number, autor: { id: number; name: string },
): boolean {
  const w = database.prepare(
    "SELECT allegro_id, nazwa FROM wysylka_zalacznik WHERE id=? AND conversation_id=?")
    .get(id, conversationId) as { allegro_id: string; nazwa: string } | undefined;
  if (!w) return false;
  database.prepare("DELETE FROM wysylka_zalacznik WHERE id=?").run(id);
  logEvent("rozmowa_zalacznik_zdjety", autor.name, null,
    { conversationId, allegroId: w.allegro_id, nazwa: w.nazwa }, autor.id, database);
  return true;
}
