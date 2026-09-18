import { urlPrzesylekZamowienia, urlTrackingu, zapytajAllegro } from "../adapters/allegro.http.js";
import { config } from "../config.js";
import { db as defaultDb, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { stanZHistorii } from "./allegro-tracking.js";

/* ── Gdzie jest paczka do klienta (0.393.0) ──────────────────────────────────
   Zgłoszenie właściciela: „dodaj status przesyłki". Przy reklamacji to jest
   pytanie pierwsze — „czy on to w ogóle dostał" — a panel nie umiał na nie
   odpowiedzieć wcale.

   POTRZEBNE SĄ DWA ŻĄDANIA I TO WYNIKA ZE SPECYFIKACJI, nie z wygody:

     1. `GET /order/checkout-forms/{id}/shipments` — numery przesyłek
        przypisanych do zamówienia. Ładunek samego zamówienia ich NIE MA:
        `CheckoutFormDeliveryReference` niesie adres, metodę, koszt i okno
        dostawy, ale ani numeru, ani statusu.
     2. `GET /order/carriers/{carrierId}/tracking?waybill=…` — historia
        statusów. Tę końcówkę zwroty odpytują od 0.187.0 i parser
        (`stanZHistorii`) jest ten sam. Druga kopia rozjechałaby się przy
        pierwszej poprawce jednej z nich.

   NA JAWNE KLIKNIĘCIE, nie taktem. Dwa żądania na zamówienie to koszt
   u Allegro i droga w limit 429; ticker robiłby to dla całego archiwum, żeby
   biuro przeczytało jedną sprawę. `CLAUDE.md` mówi zresztą wprost: tickery
   wyłącznie w `main()`, a dziś nie ma tam żadnego.

   ZAPISUJEMY WYNIK, NIE HISTORIĘ. Tak samo jak przy zwrocie: moment
   doręczenia i kod ostatniego statusu. Historia żyje u przewoźnika.

   `sprawdzono_at` odróżnia „jeszcze nie pytaliśmy" od „pytaliśmy i Allegro nic
   nie ma". To dwa różne zdania na ekranie i dwa różne następne ruchy agenta. */

/** Jedna przesyłka ze schematu `CheckoutFormAddWaybillCreated`. */
type Przesylka = { waybill?: string; carrierId?: string };
type OdpowiedzPrzesylek = { shipments?: Przesylka[] };

export interface StanPrzesylkiZamowienia {
  waybill: string | null;
  przewoznik: string | null;
  status: string | null;
  dostarczonoAt: string | null;
  sprawdzonoAt: string | null;
}

export interface PrzesylkaDeps {
  query?: (url: string) => Promise<unknown | null>;
  apiUrl?: string;
  teraz?: () => string;
}

const PUSTA: StanPrzesylkiZamowienia = {
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null,
};

/** Co wiemy o przesyłce tego zamówienia — CZYSTY ODCZYT z naszej bazy. */
export function przesylkaZamowienia(
  database: Db = defaultDb(), zamowienieId: number,
): StanPrzesylkiZamowienia {
  const w = database.prepare(`SELECT przesylka_waybill, przesylka_przewoznik,
    przesylka_status, przesylka_dostarczono_at, przesylka_sprawdzono_at
    FROM zamowienie_klienta WHERE id=?`).get(zamowienieId) as Record<string, unknown> | undefined;
  if (!w) return PUSTA;
  const tekst = (v: unknown) => (v == null || String(v) === "" ? null : String(v));
  return {
    waybill: tekst(w.przesylka_waybill),
    przewoznik: tekst(w.przesylka_przewoznik),
    status: tekst(w.przesylka_status),
    dostarczonoAt: tekst(w.przesylka_dostarczono_at),
    sprawdzonoAt: tekst(w.przesylka_sprawdzono_at),
  };
}

/**
 * Pyta Allegro o przesyłkę tego zamówienia i zapisuje wynik.
 *
 * DEGRADUJE, nie przerywa — ta sama zasada co przy trackingu zwrotów. Brak
 * numeru nie jest awarią: paczka bywa jeszcze nienadana, a sprzedawca bywa
 * nadaje poza Allegro. Wtedy zapisujemy sam `sprawdzono_at`, żeby ekran umiał
 * powiedzieć „pytaliśmy, Allegro nic nie ma".
 *
 * BIERZEMY PIERWSZY NUMER. Zamówienie bywa w kilku paczkach, ale pytanie biura
 * przy reklamacji brzmi „czy doszło", a nie „którą paczką". Gdy któraś paczka
 * ma już doręczenie, bierzemy tę — bo to ona odpowiada na tamto pytanie.
 */
export async function sprawdzPrzesylke(
  database: Db, zamowienieId: number, deps: PrzesylkaDeps = {},
): Promise<StanPrzesylkiZamowienia> {
  const w = database.prepare("SELECT external_id FROM zamowienie_klienta WHERE id=?")
    .get(zamowienieId) as { external_id: string } | undefined;
  if (!w) throw new Error("Nie znaleziono zamówienia");

  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;
  const teraz = (deps.teraz ?? (() => new Date().toISOString()))();
  /* Domyślnie prawdziwy adapter; testy wstrzykują własny — ta sama droga
     co w `allegro-tracking.ts`. */
  const query = deps.query ?? zapytajAllegro;

  let waybill: string | null = null;
  let przewoznik: string | null = null;
  let status: string | null = null;
  let dostarczonoAt: string | null = null;

  const lista = await query(urlPrzesylekZamowienia(apiUrl, w.external_id))
    .catch(() => null) as OdpowiedzPrzesylek | null;
  const paczki = (lista?.shipments ?? [])
    .filter((p): p is { waybill: string; carrierId: string } =>
      typeof p?.waybill === "string" && p.waybill !== ""
      && typeof p?.carrierId === "string" && p.carrierId !== "");

  for (const p of paczki) {
    const historia = await query(urlTrackingu(apiUrl, p.carrierId, [p.waybill]))
      .catch(() => null) as { waybills?: Array<{ waybill?: string }> } | null;
    const stan = stanZHistorii(historia?.waybills?.[0] as never);
    /* Pierwsza paczka ustawia odpowiedź; DORĘCZONA ją przebija i kończy
       pytanie — patrz preambuła funkcji. */
    if (waybill === null || stan.dostarczonoAt) {
      waybill = p.waybill;
      przewoznik = p.carrierId;
      status = stan.status;
      dostarczonoAt = stan.dostarczonoAt;
    }
    if (dostarczonoAt) break;
  }

  database.prepare(`UPDATE zamowienie_klienta SET przesylka_waybill=?,
    przesylka_przewoznik=?, przesylka_status=?, przesylka_dostarczono_at=?,
    przesylka_sprawdzono_at=? WHERE id=?`)
    .run(waybill, przewoznik, status, dostarczonoAt, teraz, zamowienieId);

  /* Mutacja, więc ślad w dzienniku — numeru przesyłki do niego NIE dopisujemy:
     `events` nie ma retencji, a waybill prowadzi do adresu odbiorcy. */
  logEvent("zamowienie_przesylka", "automat", null,
    { zamowienieId, znaleziono: waybill !== null, status }, undefined, database);

  return { waybill, przewoznik, status, dostarczonoAt, sprawdzonoAt: teraz };
}
