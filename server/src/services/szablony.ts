import { db, nowIso } from "../db/db.js";
import { logEvent } from "./events.js";
import { orderIdSprawy, type RodzajZrodla } from "./sprawa.js";

/* ── Szablony odpowiedzi (0.133.0) ───────────────────────────────────────────
   Etap E2 z docs/architektura-spraw.md. Agent pisze te same trzy zdania po
   raz setny; szablon jest TEKSTEM DO POPRAWIENIA, nie wysyłką — wkleja się do
   pola odpowiedzi, a wysyła człowiek (zasada 6: automat nigdy nie mówi do
   klienta sam).

   Podstawianie danych dzieje się PO STRONIE SERWERA, bo tylko on wie, co
   naprawdę stoi w sprawie: login kupującego, numer zamówienia, numer zwrotu.
   Przeglądarka dostaje gotowy tekst i wstawia go w miejsce kursora.         */

export const KANALY_SZABLONU = ["dowolny", "pytanie", "dyskusja"] as const;
export type KanalSzablonu = (typeof KANALY_SZABLONU)[number];

/** Awaria pracy z szablonem; `kod` niesie status HTTP dla trasy. */
export class BladSzablonu extends Error {
  constructor(
    message: string,
    readonly kod = 400
  ) {
    super(message);
    this.name = "BladSzablonu";
  }
}

export interface Szablon {
  id: number;
  nazwa: string;
  kanal: KanalSzablonu;
  tresc: string;
  autor: string;
  utworzonoAt: string;
  aktualizowanoAt: string;
}

const wiersz = (w: Record<string, unknown>): Szablon => ({
  id: w.id as number,
  nazwa: w.nazwa as string,
  kanal: w.kanal as KanalSzablonu,
  tresc: w.tresc as string,
  autor: w.autor as string,
  utworzonoAt: w.utworzono_at as string,
  aktualizowanoAt: w.aktualizowano_at as string,
});

/**
 * Znane pola do podstawienia. Zamknięta lista, nie dowolne wyrażenie: szablon
 * jedzie do KLIENTA, więc miejsce na własną składnię jest miejscem na własny
 * błąd. Nazwy po polsku, bo pisze je człowiek w polu tekstowym.
 */
export const POLA_SZABLONU = ["klient", "zamowienie", "zwrot", "oferta", "ja"] as const;
export type PoleSzablonu = (typeof POLA_SZABLONU)[number];

/**
 * Podstawia dane sprawy w miejsce `{{pole}}`.
 *
 * Pole, którego sprawa nie zna, ZOSTAJE w tekście jako `{{zamowienie}}` —
 * i to jest decyzja, nie niedoróbka. Pusty łańcuch dałby zdanie „Twoje
 * zamówienie  zostało przyjęte", które poszłoby do klienta niezauważone;
 * widoczny nawias klamrowy zatrzymuje wzrok agenta na dokładnie tym słowie,
 * które trzeba uzupełnić ręką.
 */
export function wypelnijSzablon(tresc: string, dane: Partial<Record<PoleSzablonu, string | null>>): string {
  return tresc.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (calosc, pole: string) => {
    const wartosc = dane[pole.toLowerCase() as PoleSzablonu];
    return wartosc ? wartosc : calosc;
  });
}

export function listaSzablonow(kanal?: KanalSzablonu): Szablon[] {
  const d = db();
  /* Kanał `dowolny` pasuje wszędzie, więc filtr NIGDY go nie odsiewa —
     inaczej najbardziej uniwersalne szablony znikałyby z listy. Na górze
     stoją te pisane POD TEN kanał: są celniejsze, a powitanie i tak zna się
     na pamięć. */
  const wiersze = (
    kanal
      ? d
          .prepare(
            "SELECT * FROM szablon WHERE kanal IN ('dowolny', ?) ORDER BY kanal = 'dowolny', nazwa"
          )
          .all(kanal)
      : d.prepare("SELECT * FROM szablon ORDER BY kanal, nazwa").all()
  ) as Array<Record<string, unknown>>;
  return wiersze.map(wiersz);
}

export function szablon(id: number): Szablon {
  const w = db().prepare("SELECT * FROM szablon WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!w) throw new BladSzablonu("Nie ma takiego szablonu", 404);
  return wiersz(w);
}

function sprawdz(nazwa: string, kanal: string, tresc: string): void {
  if (nazwa.trim() === "") throw new BladSzablonu("Szablon bez nazwy nie da się znaleźć na liście");
  if (tresc.trim() === "") throw new BladSzablonu("Pusty szablon nie ma czego wstawić");
  if (!(KANALY_SZABLONU as readonly string[]).includes(kanal)) {
    throw new BladSzablonu(`Nieznany kanał „${kanal}” — dozwolone: ${KANALY_SZABLONU.join(", ")}`);
  }
}

export function dodajSzablon(
  nazwa: string,
  kanal: string,
  tresc: string,
  autor: string
): Szablon {
  sprawdz(nazwa, kanal, tresc);
  const teraz = nowIso();
  const wynik = db()
    .prepare(
      `INSERT INTO szablon (nazwa, kanal, tresc, autor, utworzono_at, aktualizowano_at)
       VALUES (?,?,?,?,?,?)`
    )
    .run(nazwa.trim(), kanal, tresc.trim(), autor, teraz, teraz);
  const id = Number(wynik.lastInsertRowid);
  logEvent("szablon_dodany", autor, null, { id, nazwa: nazwa.trim(), kanal });
  return szablon(id);
}

export function zapiszSzablon(
  id: number,
  nazwa: string,
  kanal: string,
  tresc: string,
  autor: string
): Szablon {
  sprawdz(nazwa, kanal, tresc);
  szablon(id); // 404, zanim cokolwiek zapiszemy
  db()
    .prepare(
      "UPDATE szablon SET nazwa = ?, kanal = ?, tresc = ?, aktualizowano_at = ? WHERE id = ?"
    )
    .run(nazwa.trim(), kanal, tresc.trim(), nowIso(), id);
  logEvent("szablon_zapisany", autor, null, { id, nazwa: nazwa.trim(), kanal });
  return szablon(id);
}

export function skasujSzablon(id: number, autor: string): void {
  const s = szablon(id);
  db().prepare("DELETE FROM szablon WHERE id = ?").run(id);
  logEvent("szablon_skasowany", autor, null, { id, nazwa: s.nazwa });
}

/* ── Szablon wypełniony danymi sprawy ────────────────────────────────────────
   SQL inline zamiast importów z rejestrów: pytania i zwroty importują sprawę,
   a ten moduł ma zostać liściem, do którego wolno wejść z każdej trasy.     */

/** Co wiemy o sprawie na potrzeby podstawień; puste pola zostają w klamrach. */
export function daneSprawy(
  rodzaj: RodzajZrodla,
  lokalnyId: number,
  autor: string
): Record<PoleSzablonu, string | null> {
  const d = db();
  const dane: Record<PoleSzablonu, string | null> = {
    klient: null,
    zamowienie: orderIdSprawy(rodzaj, lokalnyId),
    zwrot: null,
    oferta: null,
    ja: autor,
  };
  if (rodzaj === "pytanie") {
    const w = d
      .prepare("SELECT kupujacy_login, oferta_tytul FROM pytanie WHERE id = ?")
      .get(lokalnyId) as Record<string, unknown> | undefined;
    /* Maska `client:NNN` NIE jest imieniem — wstawiona w „Dzień dobry {{klient}}"
       wyglądałaby jak usterka po stronie klienta. Lepiej zostawić klamrę. */
    const login = (w?.kupujacy_login as string | null) ?? null;
    dane.klient = login && !login.includes(":") ? login : null;
    dane.oferta = (w?.oferta_tytul as string | null) ?? null;
  } else if (rodzaj === "dyskusja") {
    const w = d.prepare("SELECT kupujacy_login, temat FROM dyskusja WHERE id = ?").get(lokalnyId) as
      | Record<string, unknown>
      | undefined;
    dane.klient = (w?.kupujacy_login as string | null) ?? null;
    dane.oferta = (w?.temat as string | null) ?? null;
  } else {
    /* Zwrot i reklamacja (pozycja zwrotu) czytają ten sam wiersz zwrotu. */
    const w = (
      rodzaj === "zwrot"
        ? d.prepare("SELECT kupujacy_login, referencja, waybill FROM zwrot WHERE id = ?")
        : d.prepare(
            `SELECT z.kupujacy_login AS kupujacy_login, z.referencja AS referencja,
                    z.waybill AS waybill
               FROM zwrot_pozycja p JOIN zwrot z ON z.id = p.zwrot_id WHERE p.id = ?`
          )
    ).get(lokalnyId) as Record<string, unknown> | undefined;
    dane.klient = (w?.kupujacy_login as string | null) ?? null;
    dane.zwrot = ((w?.referencja as string | null) ?? (w?.waybill as string | null)) ?? null;
  }
  return dane;
}

/** Gotowy tekst do wklejenia w pole odpowiedzi. Czysty ODCZYT. */
export function szablonDlaSprawy(
  id: number,
  rodzaj: RodzajZrodla,
  lokalnyId: number,
  autor: string
): { szablon: Szablon; tresc: string; brakujace: PoleSzablonu[] } {
  const s = szablon(id);
  const dane = daneSprawy(rodzaj, lokalnyId, autor);
  const tresc = wypelnijSzablon(s.tresc, dane);
  /* Panel mówi wprost, czego nie dało się podstawić — inaczej klamra w środku
     akapitu bywa przeoczona i idzie do klienta. */
  const brakujace = POLA_SZABLONU.filter(
    (pole) => !dane[pole] && new RegExp(`\\{\\{\\s*${pole}\\s*\\}\\}`, "i").test(s.tresc)
  );
  return { szablon: s, tresc, brakujace };
}
