import type { DatabaseSync } from "node:sqlite";
import { config, type Config } from "../config.js";
import { dataLokalna, lokalnyNaUtc } from "../czas.js";
import { transaction } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Brak z kompletacji po godzinie granicznej ───────────────────────────────
   Magazyn nie znalazł towaru na półce i zamówienie stoi w Sellasist w statusie
   braku (`SELLASIST_STATUSY_BRAK`, u tej firmy 12). Towar czasem się znajduje,
   czasem nie. Reguła właściciela: kto o godzinie granicznej dalej czeka na
   towar, nie zdąży na kuriera, więc biuro pisze do klienta. Do wyboru jest
   anulowanie, pytanie o wysyłkę niepełnej paczki albo wysyłka bez towaru,
   który klientowi nie przeszkodzi, ze zwrotem pieniędzy za niego. Wybiera
   człowiek, bo o tym, co jest nieistotne, mówi cel zakupu klienta.

   GODZINA ZALEŻY OD PRZEWOŹNIKA, bo InPost odbiera paczki później. Przewoźnika
   mówi metoda dostawy, a bez niej etykieta. Nieznany dostaje wcześniejszą
   godzinę: spóźniony list do klienta kosztuje więcej niż wczesny wiersz.

   WEJŚCIE PO GODZINIE GRANICZNEJ STAJE OD RAZU, decyzją właściciela. Kurier
   już pojechał, więc nie ma na co czekać.

   WIERSZ GAŚNIE na dwa sposoby: zamówienie wyjdzie ze statusu braku albo ktoś
   kliknie „Klient powiadomiony”. Biuro zostawia zamówienie w braku, gdy czeka
   na odpowiedź klienta, więc sam status nie wystarcza. Kliknięcie trzyma
   wejście w status, więc ponowny brak tego samego zamówienia wraca.

   TYLKO ZAMÓWIENIA Z ALLEGRO. Tam agent pisze do kupującego, a WERTIS zna
   klienta po loginie. Kopie zamówień odpadają, jak w „czy wyjdzie dziś”. */

type Wiersz = Record<string, unknown>;
type Autor = { id: number; name: string };
type UstawieniaBraku = Pick<Config["sellasist"], "statusyBrak" | "brakGodzina" | "brakGodzinaInpost">;

export interface BrakKompletacji {
  /** Numer zamówienia w Sellasist. */
  zamowienieId: number;
  /** Numer formularza zakupu Allegro. */
  externalId: string;
  login: string;
  /** Wejście w status braku, ISO UTC — klucz „Klient powiadomiony”. */
  statusAt: string;
  /** Od kiedy wiersz stoi, ISO UTC: godzina graniczna albo późniejsze wejście. */
  terminAt: string;
  inpost: boolean;
  braki: Array<{ nazwa: string; potrzeba: number; jest: number }>;
  /** Reszta zamówienia, `nazwa ×ilość` — kontekst do decyzji, co jest nieistotne. */
  reszta: string[];
}

/** Odmowa przycisku z kodem HTTP: 404 nie ma zamówienia, 409 zmieniło status. */
export class BladBraku extends Error {
  constructor(message: string, readonly kod: 404 | 409) { super(message); this.name = "BladBraku"; }
}

/** InPost po nazwie metody dostawy albo po etykiecie przewoźnika. */
const INPOST = /inpost|paczkomat/i;

/** Godzina graniczna wejścia w brak, ISO UTC. Późniejsze wejście staje od razu. */
export function terminBraku(statusAt: string, inpost: boolean, u: UstawieniaBraku): string {
  const godzina = inpost ? u.brakGodzinaInpost : u.brakGodzina;
  const graniczna = lokalnyNaUtc(`${dataLokalna(statusAt)} ${String(godzina).padStart(2, "0")}:00:00`)!;
  return Date.parse(statusAt) > Date.parse(graniczna) ? new Date(statusAt).toISOString() : graniczna;
}

/** Zamówienia z brakiem po godzinie granicznej, najstarsze pierwsze — CZYSTY ODCZYT lustra. */
export function brakiPoTerminie(
  database: DatabaseSync, teraz = new Date(), u: UstawieniaBraku = config.sellasist,
): BrakKompletacji[] {
  if (u.statusyBrak.length === 0) return [];
  const wiersze = database.prepare(`SELECT z.id, z.external_id, z.kupujacy_login, z.status_at, z.dostawa,
      EXISTS (SELECT 1 FROM sellasist_przesylka p WHERE p.zamowienie_id = z.id AND p.przewoznik = 'INPOST')
        AS etykieta_inpost
    FROM sellasist_zamowienie z
    WHERE z.status_id IN (SELECT value FROM json_each(?))
      AND z.skopiowane_z IS NULL AND lower(ifnull(z.zrodlo, '')) LIKE 'allegro%'
      AND z.external_id IS NOT NULL AND z.kupujacy_login IS NOT NULL AND z.status_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sellasist_brak_powiadomiony b
                       WHERE b.zamowienie_id = z.id AND b.status_at = z.status_at)
    ORDER BY z.status_at, z.id`).all(JSON.stringify(u.statusyBrak)) as Wiersz[];
  const pozycje = database.prepare(`SELECT nazwa, symbol, ilosc, brakuje FROM sellasist_pozycja
      WHERE zamowienie_id = ? ORDER BY koszyk_id`);
  return wiersze.flatMap((w): BrakKompletacji[] => {
    const statusAt = String(w.status_at);
    const inpost = INPOST.test(String(w.dostawa ?? "")) || Number(w.etykieta_inpost) === 1;
    const terminAt = terminBraku(statusAt, inpost, u);
    if (Date.parse(terminAt) > teraz.getTime()) return [];
    const poz = (pozycje.all(Number(w.id)) as Wiersz[]).map((p) => ({
      nazwa: String(p.nazwa ?? p.symbol ?? "pozycja"), ilosc: Number(p.ilosc), brakuje: Number(p.brakuje),
    }));
    return [{
      zamowienieId: Number(w.id), externalId: String(w.external_id), login: String(w.kupujacy_login),
      statusAt, terminAt, inpost,
      braki: poz.filter((p) => p.brakuje > 0)
        .map((p) => ({ nazwa: p.nazwa, potrzeba: p.ilosc, jest: Math.max(0, p.ilosc - p.brakuje) })),
      reszta: poz.filter((p) => p.brakuje <= 0 && p.ilosc > 0).map((p) => `${p.nazwa} ×${p.ilosc}`),
    }];
  });
}

/**
 * „Klient powiadomiony” — zapis wywołany kliknięciem, nie otwarciem ekranu.
 *
 * Panel podaje wejście w status, które widział. Inne wejście albo inny status
 * to 409: ekran pokazywał stan, którego już nie ma, a kliknięcie dotyczyło
 * tamtego braku. Drugie kliknięcie tego samego wejścia niczego nie zmienia.
 */
export function oznaczPowiadomiony(
  database: DatabaseSync, zamowienieId: number, statusAt: unknown, autor: Autor, teraz = new Date(),
  statusyBrak: readonly number[] = config.sellasist.statusyBrak,
): void {
  const z = database.prepare("SELECT status_id, status_at FROM sellasist_zamowienie WHERE id = ?")
    .get(zamowienieId) as Wiersz | undefined;
  if (!z) throw new BladBraku("Nie ma takiego zamówienia w lustrze Sellasist", 404);
  if (z.status_id == null || !statusyBrak.includes(Number(z.status_id)) || z.status_at !== statusAt) {
    throw new BladBraku("Zamówienie zmieniło status w Sellasist — lista pokaże stan bieżący", 409);
  }
  transaction(database, () => {
    const r = database.prepare(`INSERT OR IGNORE INTO sellasist_brak_powiadomiony(zamowienie_id, status_at, at)
        VALUES (?,?,?)`).run(zamowienieId, String(z.status_at), teraz.toISOString());
    if (Number(r.changes) > 0) {
      logEvent("sellasist_brak_powiadomiony", autor.name, null, { zamowienieSellasist: zamowienieId }, autor.id,
        database);
    }
  })();
}
