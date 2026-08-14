import { db } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Notatki biura do dostawy ────────────────────────────────────────────────
   Dostawca dosyła czasem brak, którego NIE MA na fakturze. Biuro wie o tym
   z rozmowy albo z maila; rozkładający przy palecie nie ma tego skąd wiedzieć
   i musi sprawdzić, czy rzeczywiście dosłali. Do 0.43.0 jedyną drogą było
   „powiedz Krzyśkowi, jak przyjdzie" — kanał, który gubi się przy zmianie
   i nie zostawia po sobie ani śladu, ani odpowiedzi.

   DWIE rzeczy odróżniają notatkę od zwykłego komunikatu na ekranie:

     - wisi na DOKUMENCIE (`sgt_dok_id`), nie na lokalnym wierszu dostawy.
       Biuro pisze ją, zanim ktokolwiek otworzy rozkładanie, więc `delivery`
       zwykle jeszcze nie istnieje. Przy okazji notatka przeżywa zamknięcie
       „poza WERTIS" i jego cofnięcie;
     - ODPOWIEDŹ JEST OBOWIĄZKOWA. Dopóki jej nie ma, dostawa się nie domyka —
       ani przyciskiem, ani sama po ostatniej pozycji. Bez tego wymuszenia
       notatka byłaby kolejnym komunikatem, który się przewija: ktoś przeczyta
       i pójdzie dalej, a biuro dalej nie wie, czy dosłali.                    */

export interface Notatka {
  id: number;
  dokId: number;
  tresc: string;
  createdAt: string;
  createdBy: string;
  /** `null` = czeka na odpowiedź; to ta wartość trzyma dostawę otwartą. */
  odpowiedz: string | null;
  odpAt: string | null;
  odpBy: string | null;
}

const nowIso = () => new Date().toISOString();

const SELECT = `
  SELECT id, sgt_dok_id AS dokId, tresc, created_at AS createdAt, created_by AS createdBy,
         odpowiedz, odp_at AS odpAt, odp_by AS odpBy
  FROM delivery_note`;

/** Wszystkie notatki dokumentu, od najstarszej — kolejność jest rozmową. */
export function notatkiDokumentu(dokId: number): Notatka[] {
  return db()
    .prepare(`${SELECT} WHERE sgt_dok_id = ? ORDER BY id`)
    .all(dokId) as unknown as Notatka[];
}

/** Notatki bez odpowiedzi — to one blokują domknięcie dostawy. */
export function bezOdpowiedzi(dokId: number): Notatka[] {
  return db()
    .prepare(`${SELECT} WHERE sgt_dok_id = ? AND odpowiedz IS NULL ORDER BY id`)
    .all(dokId) as unknown as Notatka[];
}

/**
 * Czy dokument ma pytanie bez odpowiedzi.
 *
 * Wydzielone, bo pytają o to DWA miejsca domykające dostawę — `closeIfComplete`
 * (samo domknięcie po ostatniej pozycji) i `zakonczDostawe` (przycisk). Gdyby
 * pilnowało tego tylko drugie, regułę obchodziłoby się przez zwykłe odłożenie
 * wszystkich pozycji, czyli najczęstszą ścieżką w całej aplikacji.
 */
export function czekaNaOdpowiedz(dokId: number): boolean {
  const r = db()
    .prepare("SELECT 1 FROM delivery_note WHERE sgt_dok_id = ? AND odpowiedz IS NULL LIMIT 1")
    .get(dokId);
  return r !== undefined;
}

/** Notatka biura. Pusta treść nie przechodzi — pytanie bez pytania nic nie wnosi. */
export function dodajNotatke(
  dokId: number,
  tresc: string,
  user: string
): { id: number } | { error: string } {
  const t = tresc.trim();
  if (!t) return { error: "Notatka nie może być pusta" };
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery_note(sgt_dok_id, tresc, created_at, created_by)
         VALUES (?,?,?,?)`
      )
      .run(dokId, t, nowIso(), user).lastInsertRowid
  );
  logEvent("delivery_note_added", user, null, { noteId: id, dokId });
  return { id };
}

/**
 * Odpowiedź magazyniera. Jedna i ostateczna.
 *
 * Nadpisania nie ma świadomie: odpowiedź jest tym, co zdjęło blokadę
 * z dokumentu, więc podmieniona po fakcie zmieniałaby powód decyzji, która już
 * zapadła. Nowe ustalenie to nowa notatka — rozmowa rośnie, a nie jest
 * przepisywana.
 */
export function odpowiedzNaNotatke(
  noteId: number,
  odpowiedz: string,
  user: string
): { ok: true } | { error: string } {
  const o = odpowiedz.trim();
  if (!o) return { error: "Podaj odpowiedź — bez niej dostawy nie da się zamknąć" };
  const n = db()
    .prepare("SELECT sgt_dok_id AS dokId, odpowiedz FROM delivery_note WHERE id = ?")
    .get(noteId) as { dokId: number; odpowiedz: string | null } | undefined;
  if (!n) return { error: "Nie znaleziono notatki" };
  if (n.odpowiedz !== null) return { error: "Na tę notatkę już odpowiedziano" };

  db()
    .prepare("UPDATE delivery_note SET odpowiedz=?, odp_at=?, odp_by=? WHERE id=?")
    .run(o, nowIso(), user, noteId);
  logEvent("delivery_note_answered", user, null, { noteId, dokId: n.dokId });
  return { ok: true };
}
