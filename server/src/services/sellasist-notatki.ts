import type { DatabaseSync } from "node:sqlite";
import {
  BladSellasist, lista, mapujListeZamowien, sciezkaZamowienPoNumerze, SCIEZKA_NOTATEK, sellasistWlaczony,
  zapytajSellasist, dataSellasist, type ZapytanieSellasist,
} from "../adapters/sellasist.http.js";
import { BladLimitu } from "../adapters/limit.js";
import { logEvent } from "./events.js";

/* ── Zamówienie w Sellasist na profilu klienta: wgląd i notatka ──────────────
   Agent prowadzi sprawę w WERTIS, a magazyn pakuje w Sellasist. Notatka do
   zamówienia jest drogą od biura do pakującego („dosłać pasek do tej
   paczki") bez przełączania się do Sellasist w środku rozmowy z klientem.

   WGLĄD TO CZYSTY ODCZYT. Stan zamówienia czytamy z lustra (`sellasist-sync.ts`),
   a notatki z Sellasist na żywo i NIE ZAPISUJEMY ich: piszą je ludzie, więc
   bywa w nich adres albo telefon, a lustro adresów nie trzyma z zasady.
   Otwarcie wglądu nie zmienia niczego ani u nas, ani w Sellasist.

   NOTATKA TO JEDYNY ZAPIS DO SELLASIST w całym serwerze. Status, koszyk
   i etykiety zostają w rękach magazynu; automat ich nie dotyka. Do dziennika
   idzie numer zamówienia Sellasist, nigdy treść notatki. */

/** Najdłuższa notatka; dłuższa wiadomość do magazynu to już nie notatka. */
export const LIMIT_NOTATKI = 1000;

export class BladNotatki extends Error {
  constructor(komunikat: string, public readonly kod: number) {
    super(komunikat);
  }
}

export interface WidokSellasist {
  wlaczony: boolean;
  zamowienie: null | {
    id: number;
    /**
     * Lustro ma to zamówienie. Bez wiersza (zamówienie starsze niż start
     * lustra) stan jest NIEZNANY, a nie zerowy: puste pola znaczyłyby wtedy
     * „jeszcze nie zebrano" o paczce dawno doręczonej.
     */
    wLustrze: boolean;
    status: string | null;
    statusAt: string | null;
    zebranoAt: string | null;
    spakowanoAt: string | null;
    termin: string | null;
    przesylki: Array<{ waybill: string; usluga: string | null; utworzonoAt: string | null }>;
    braki: Array<{ nazwa: string; potrzeba: number; jest: number }>;
    /** Numery kopii zamówienia w Sellasist — zwykle dosyłek. */
    kopie: number[];
  };
  notatki: Array<{ data: string | null; tekst: string }>;
  /** Stałe zdanie, gdy notatek nie udało się przeczytać; stan z lustra zostaje. */
  notatkiBlad: string | null;
}

type Wiersz = Record<string, unknown>;
const tekst = (v: unknown): string | null => (v == null || String(v) === "" ? null : String(v));

/**
 * Numer zamówienia w Sellasist: oryginał z lustra, a gdy lustro go nie zna —
 * pytanie o numer źródła. Najniższy numer to oryginał, bo kopia powstaje
 * później. Pytanie niczego nie zapisuje.
 */
async function idSellasist(database: DatabaseSync, zamowienie: string, query: ZapytanieSellasist): Promise<number | null> {
  const w = database.prepare(`SELECT id FROM sellasist_zamowienie WHERE external_id = ? AND skopiowane_z IS NULL
      ORDER BY id LIMIT 1`).get(zamowienie) as Wiersz | undefined;
  if (w) return Number(w.id);
  const ids = mapujListeZamowien(await query(sciezkaZamowienPoNumerze(zamowienie))).map((z) => z.id);
  return ids.length ? Math.min(...ids) : null;
}

function zLustra(database: DatabaseSync, id: number): WidokSellasist["zamowienie"] {
  const z = database.prepare("SELECT * FROM sellasist_zamowienie WHERE id = ?").get(id) as Wiersz | undefined;
  const przesylki = (database.prepare(`SELECT waybill, usluga, utworzono_at FROM sellasist_przesylka
      WHERE zamowienie_id = ? ORDER BY utworzono_at, waybill`).all(id) as Wiersz[])
    .map((p) => ({ waybill: String(p.waybill), usluga: tekst(p.usluga), utworzonoAt: tekst(p.utworzono_at) }));
  const braki = (database.prepare(`SELECT nazwa, symbol, ilosc, brakuje FROM sellasist_pozycja
      WHERE zamowienie_id = ? AND brakuje > 0 ORDER BY koszyk_id`).all(id) as Wiersz[])
    .map((p) => ({ nazwa: String(p.nazwa ?? p.symbol ?? "pozycja"), potrzeba: Number(p.ilosc),
      jest: Math.max(0, Number(p.ilosc) - Number(p.brakuje)) }));
  const kopie = (database.prepare("SELECT id FROM sellasist_zamowienie WHERE skopiowane_z = ? ORDER BY id")
    .all(id) as Wiersz[]).map((k) => Number(k.id));
  return {
    id, wLustrze: z !== undefined, status: tekst(z?.status_nazwa), statusAt: tekst(z?.status_at), zebranoAt: tekst(z?.zebrano_at),
    spakowanoAt: tekst(z?.spakowano_at), termin: tekst(z?.termin), przesylki, braki, kopie,
  };
}

/** Zdanie dla agenta z błędu Sellasist. Treść odpowiedzi nie przechodzi nigdy. */
const zdanieBledu = (e: unknown): string =>
  e instanceof BladSellasist || e instanceof BladLimitu ? e.message : "Sellasist nie odpowiedział.";

/**
 * Wgląd w zamówienie Sellasist dla numeru zamówienia źródła (Allegro).
 * Bez integracji oddaje `wlaczony: false` i nie pyta nikogo.
 */
export async function widokSellasist(
  database: DatabaseSync, zamowienie: string, query: ZapytanieSellasist = zapytajSellasist,
  wlaczony = sellasistWlaczony(),
): Promise<WidokSellasist> {
  const pusty: WidokSellasist = { wlaczony, zamowienie: null, notatki: [], notatkiBlad: null };
  if (!wlaczony) return pusty;
  let id: number | null;
  try {
    id = await idSellasist(database, zamowienie, query);
  } catch (e) {
    return { ...pusty, notatkiBlad: zdanieBledu(e) };
  }
  if (id === null) return pusty;
  const widok: WidokSellasist = { ...pusty, zamowienie: zLustra(database, id) };
  try {
    widok.notatki = lista(await query(`${SCIEZKA_NOTATEK}/${id}`))
      .flatMap((n) => {
        const t = tekst(n.text);
        return t ? [{ data: dataSellasist(n.date), tekst: t }] : [];
      });
  } catch (e) {
    widok.notatkiBlad = zdanieBledu(e);
  }
  return widok;
}

/**
 * Notatka agenta do zamówienia w Sellasist (`POST /notes`, wymagane
 * `order_id` i `text`). Podpis autora idzie w treści: Sellasist widzi
 * jeden klucz API, więc bez podpisu pakujący nie wie, kogo dopytać.
 */
export async function dodajNotatkeSellasist(
  database: DatabaseSync, zamowienie: string, tresc: string, autor: { id: number; name: string },
  query: ZapytanieSellasist = zapytajSellasist, wlaczony = sellasistWlaczony(),
): Promise<number> {
  if (!wlaczony) throw new BladNotatki("Integracja z Sellasist nie jest włączona.", 409);
  const t = tresc.trim();
  if (t === "") throw new BladNotatki("Notatka jest pusta.", 400);
  if (t.length > LIMIT_NOTATKI) throw new BladNotatki(`Notatka ma najwyżej ${LIMIT_NOTATKI} znaków.`, 400);
  try {
    const id = await idSellasist(database, zamowienie, query);
    if (id === null) throw new BladNotatki("Sellasist nie zna tego zamówienia.", 404);
    const odp = await query(SCIEZKA_NOTATEK, { metoda: "POST", body: { order_id: id, text: `${t}\n(${autor.name}, WERTIS)` } });
    /* Odpowiedź bez numeru notatki (także 404, które adapter oddaje jako
       `null`) to notatka, której nie ma. Agent nie może uznać jej za wysłaną. */
    const nowa = odp !== null && typeof odp === "object" ? (odp as Record<string, unknown>).id : null;
    if (nowa == null || nowa === "") throw new BladNotatki("Sellasist nie przyjął notatki.", 502);
    logEvent("sellasist_notatka", autor.name, null, { zamowienieSellasist: id }, autor.id, database);
    return id;
  } catch (e) {
    if (e instanceof BladNotatki) throw e;
    throw new BladNotatki(zdanieBledu(e), e instanceof BladLimitu ? 429 : 502);
  }
}
