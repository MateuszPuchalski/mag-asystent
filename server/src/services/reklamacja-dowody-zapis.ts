import { transaction, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { BladReklamacji, doZapisu, ReklamacjaConflict } from "./reklamacje.js";
import {
  dowodyReklamacji, LIMIT_DOSTAWCY, LIMIT_DOWODU, LIMIT_NR_U_DOSTAWCY, uDostawcyReklamacji,
  WYNIKI_U_DOSTAWCY, type DowodReklamacji, type ReklamacjaUDostawcy, type WynikUDostawcy,
} from "./reklamacja-dowody.js";

/* ── Dowody biura i reklamacja u dostawcy — ZAPIS ────────────────────────────
   Oba zapisy zostają WYŁĄCZNIE u nas: do Allegro nie idzie żadne pole, więc
   żaden nie stoi za `autoryzuj()`. Wpis `privileged` przy zwykłym zdaniu biura
   wyglądałby w dzienniku jak werdykt.

   ŻADEN NIE PODBIJA WERSJI SPRAWY. Odpowiedź i werdykt wysyłają wersję
   z ekranu, więc kolega dopisujący dowód zrobiłby 409 komuś, kto właśnie
   pisze do kupującego. Dowody są kolekcją jak tagi: bez wersji, kasowane po
   numerze. Reklamacja u dostawcy to jeden rekord edytowany przez kilka osób,
   więc ma WŁASNĄ wersję.

   Do dziennika idą numery i długości, nigdy treść: `events` nie ma retencji,
   a dowód bywa zdaniem o tym, co klient zrobił z towarem.                  */

type Autor = { id: number; name: string };

/** Treść dowodu po przycięciu albo zdanie, czemu jej nie przyjmujemy. */
function trescDowodu(tresc: unknown): string {
  if (typeof tresc !== "string") throw new BladReklamacji("Dowód to tekst — napisz, co widać albo co ustaliliście");
  const t = tresc.trim();
  if (!t) throw new BladReklamacji("Pusty dowód nic nie mówi — napisz, co widać albo co ustaliliście");
  if (t.length > LIMIT_DOWODU) {
    throw new BladReklamacji(`Dowód ma najwyżej ${LIMIT_DOWODU} znaków, a ten ma ${t.length}. Dłuższe ustalenia idą do notatki.`);
  }
  return t;
}

/**
 * Dopisanie dowodu. Zdjęcie musi należeć do TEJ sprawy: numer załącznika
 * z cudzej reklamacji związałby dowód ze zdjęciem, którego ekran tej sprawy
 * nie pokaże, a to jest 400, bo pomylił się wołający, nie stan sprawy.
 */
export function dodajDowod(
  database: Db, reklamacjaId: number,
  z: { tresc: unknown; zalacznikId?: unknown }, autor: Autor,
): DowodReklamacji[] {
  const tresc = trescDowodu(z.tresc);
  const zal = z.zalacznikId;
  if (zal != null && !(typeof zal === "number" && Number.isInteger(zal) && zal > 0)) {
    throw new BladReklamacji("Zdjęcie dowodu wskazuje się numerem załącznika albo wcale");
  }
  const zalacznikId = zal == null ? null : zal;
  return transaction(database, () => {
    doZapisu(database, reklamacjaId, undefined);
    if (zalacznikId !== null && !database.prepare(
      "SELECT 1 FROM reklamacja_zalacznik WHERE id=? AND reklamacja_id=?").get(zalacznikId, reklamacjaId)) {
      throw new BladReklamacji("To zdjęcie nie należy do tej reklamacji");
    }
    const dowodId = Number(database.prepare(
      `INSERT INTO reklamacja_dowod(reklamacja_id,tresc,zalacznik_id,autor_user_id,autor)
       VALUES (?,?,?,?,?)`).run(reklamacjaId, tresc, zalacznikId, autor.id, autor.name).lastInsertRowid);
    logEvent("reklamacja_dowod", autor.name, null,
      { reklamacjaId, dowodId, dlugosc: tresc.length, zalacznikId }, autor.id, database);
    return dowodyReklamacji(database, reklamacjaId);
  })();
}

/**
 * Usunięcie dowodu. Bez drogi powrotnej w panelu, bo dowód jest jednym
 * zdaniem, które biuro przepisze szybciej, niż znajdzie przycisk „cofnij".
 */
export function usunDowod(
  database: Db, reklamacjaId: number, dowodId: number, autor: Autor,
): DowodReklamacji[] {
  return transaction(database, () => {
    doZapisu(database, reklamacjaId, undefined);
    const w = database.prepare(
      "SELECT tresc FROM reklamacja_dowod WHERE id=? AND reklamacja_id=?").get(dowodId, reklamacjaId) as
      { tresc: string } | undefined;
    if (!w) throw new BladReklamacji("Nie ma takiego dowodu przy tej reklamacji", 404);
    database.prepare("DELETE FROM reklamacja_dowod WHERE id=? AND reklamacja_id=?").run(dowodId, reklamacjaId);
    logEvent("reklamacja_dowod_usuniety", autor.name, null,
      { reklamacjaId, dowodId, dlugosc: String(w.tresc ?? "").length }, autor.id, database);
    return dowodyReklamacji(database, reklamacjaId);
  })();
}

export interface ZadanieUDostawcy {
  dostawca: unknown;
  /** `undefined` zostawia, co było; `null` albo pusty tekst czyści. */
  nrUDostawcy?: unknown;
  /** `undefined` zostawia, co było; `null` cofa wynik do „czekamy". */
  wynik?: unknown;
  /** Wersja rekordu z ekranu; 0 znaczy „zakładam nowe zgłoszenie". */
  wersja: unknown;
}

/**
 * Zgłoszenie reklamacji u dostawcy i jej wynik — jeden rekord na sprawę.
 *
 * WERSJA 0 TO ZAŁOŻENIE. Dwie osoby klikające „Zgłoś u dostawcy" naraz dałyby
 * inaczej dwa zgłoszenia albo ciche nadpisanie, a druga ma się dowiedzieć,
 * że ktoś był szybszy. Każda inna wersja musi zgadzać się z zapisaną.
 *
 * Zmiana wyniku stempluje `wynik_at`, bo „kiedy dostawca uznał" jest
 * faktem do rozliczenia z nim, a nie szczegółem dziennika. Autor zostaje ten,
 * kto zgłosił; kto zmienił wynik, mówi dziennik.
 */
export function zapiszUDostawcy(
  database: Db, reklamacjaId: number, z: ZadanieUDostawcy, autor: Autor,
): ReklamacjaUDostawcy {
  if (typeof z.dostawca !== "string" || !z.dostawca.trim()) {
    throw new BladReklamacji("Wpisz dostawcę — symbol kontrahenta, u którego zgłaszasz reklamację");
  }
  const dostawca = z.dostawca.trim();
  if (dostawca.length > LIMIT_DOSTAWCY) {
    throw new BladReklamacji(`Dostawca ma najwyżej ${LIMIT_DOSTAWCY} znaków`);
  }
  let nr: string | null | undefined;
  if (z.nrUDostawcy === undefined) nr = undefined;
  else if (z.nrUDostawcy === null) nr = null;
  else if (typeof z.nrUDostawcy === "string") nr = z.nrUDostawcy.trim() || null;
  else throw new BladReklamacji("Numer u dostawcy to tekst albo nic");
  if (nr && nr.length > LIMIT_NR_U_DOSTAWCY) {
    throw new BladReklamacji(`Numer u dostawcy ma najwyżej ${LIMIT_NR_U_DOSTAWCY} znaków`);
  }
  if (z.wynik !== undefined && z.wynik !== null
    && !(WYNIKI_U_DOSTAWCY as readonly unknown[]).includes(z.wynik)) {
    throw new BladReklamacji("Wynik u dostawcy to „uznal”, „odrzucil” albo nic");
  }
  const wynik = z.wynik as WynikUDostawcy | null | undefined;
  const wersja = Number(z.wersja);
  if (z.wersja === null || z.wersja === undefined || !Number.isInteger(wersja) || wersja < 0) {
    throw new BladReklamacji("Zapis zgłoszenia u dostawcy wymaga wersji z ekranu");
  }

  return transaction(database, () => {
    doZapisu(database, reklamacjaId, undefined);
    const obecny = uDostawcyReklamacji(database, reklamacjaId);
    const teraz = new Date().toISOString();
    if (wersja === 0) {
      if (obecny) {
        throw new ReklamacjaConflict({ uDostawcy: obecny },
          "Ktoś już zgłosił tę reklamację u dostawcy — odśwież i popraw jego zgłoszenie");
      }
      database.prepare(`INSERT INTO reklamacja_u_dostawcy
          (reklamacja_id,dostawca,nr_u_dostawcy,zgloszono_at,wynik,wynik_at,autor_user_id,autor,wersja)
        VALUES (?,?,?,?,?,?,?,?,1)`).run(reklamacjaId, dostawca, nr ?? null, teraz,
        wynik ?? null, wynik ? teraz : null, autor.id, autor.name);
    } else {
      if (!obecny || obecny.wersja !== wersja) {
        throw new ReklamacjaConflict({ uDostawcy: obecny },
          "Zgłoszenie u dostawcy zmienił ktoś inny — odśwież i spróbuj jeszcze raz");
      }
      const nowyWynik = wynik === undefined ? obecny.wynik : wynik;
      const wynikAt = nowyWynik === obecny.wynik ? obecny.wynikAt : (nowyWynik ? teraz : null);
      database.prepare(`UPDATE reklamacja_u_dostawcy
          SET dostawca=?, nr_u_dostawcy=?, wynik=?, wynik_at=?, wersja=wersja+1
        WHERE reklamacja_id=?`).run(dostawca, nr === undefined ? obecny.nrUDostawcy : nr,
        nowyWynik, wynikAt, reklamacjaId);
    }
    const zapisany = uDostawcyReklamacji(database, reklamacjaId)!;
    /* Numer u dostawcy nie idzie do dziennika: sam fakt, że jest. */
    logEvent("reklamacja_u_dostawcy", autor.name, null,
      { reklamacjaId, wersja: zapisany.wersja, wynik: zapisany.wynik, maNr: zapisany.nrUDostawcy !== null },
      autor.id, database);
    return zapisany;
  })();
}
