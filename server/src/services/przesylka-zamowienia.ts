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

/** Wiersz zamówienia po numerze z Allegro; `null`, gdy ticker go jeszcze nie dociągnął. */
export function idZamowienia(database: Db, konto: number, externalId: string): number | null {
  const w = database.prepare("SELECT id FROM zamowienie_klienta WHERE channel_account_id=? AND external_id=?")
    .get(konto, externalId) as { id: number } | undefined;
  return w ? Number(w.id) : null;
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

/* ── PRZESYŁKA W SZKICU COPILOTA (23 września 2026) ──────────────────────────
   Zgłoszenie właściciela: „informacje o statusie przesyłki powinny zostać
   dodane, jeśli klient zadaje pytanie pod zamówieniem". Klient pytający pod
   zamówieniem pyta najczęściej „gdzie paczka", a szkic nie wiedział o niej
   nic — agent szedł do panelu Allegro i przepisywał status ręcznie.

   NUMERU PRZESYŁKI MODEL NIE DOSTAJE. Prowadzi do adresu odbiorcy, a ten
   nie wychodzi do dostawcy modelu (`CLAUDE.md`, prywatność). Klient ma numer
   przy zamówieniu w Allegro i fakt mówi to wprost, żeby szkic odesłał go
   tam, zamiast zmyślać numer albo przepraszać, że go nie zna.

   Kody statusu tłumaczymy na zdanie Z PERSPEKTYWY KLIENTA. Słownik zwrotów
   (`zwroty/Dowody.tsx`) mówi „w drodze do nas" — tu paczka jedzie do niego,
   więc wspólny słownik dałby szkicowi zdanie odwrotne. */
const STATUS_DLA_KLIENTA: Record<string, string> = {
  PENDING: "przygotowana, czeka na nadanie",
  IN_TRANSIT: "w drodze do klienta",
  RELEASED_FOR_DELIVERY: "wydana kurierowi do doręczenia",
  AVAILABLE_FOR_PICKUP: "czeka na klienta w punkcie odbioru",
  NOTICE_LEFT: "po nieudanej próbie doręczenia, zostawiono awizo",
  ISSUE: "przewoźnik zgłosił problem z przesyłką",
  RETURNED: "wraca albo wróciła do nadawcy",
};

/** Zdanie faktu o paczce; `null`, gdy nigdy nie pytaliśmy — milczenie zamiast zgadywania. */
export function zdaniePrzesylki(s: StanPrzesylkiZamowienia): string | null {
  if (s.sprawdzonoAt === null) return null;
  const kiedy = `(stan z ${s.sprawdzonoAt.slice(0, 16).replace("T", " ")} UTC)`;
  if (s.waybill === null) {
    return `Przesyłka zamówienia: Allegro nie ma numeru przesyłki — paczka jeszcze nienadana`
      + ` albo nadana poza Allegro ${kiedy}`;
  }
  const stan = s.dostarczonoAt
    ? `doręczona ${s.dostarczonoAt.slice(0, 10)}`
    : s.status ? (STATUS_DLA_KLIENTA[s.status] ?? `ostatni status przewoźnika ${s.status}`)
      : "przewoźnik nie podał jeszcze statusu";
  return `Przesyłka zamówienia: ${stan}; przewoźnik ${s.przewoznik ?? "nieznany"}; numer przesyłki`
    + ` klient widzi w Allegro przy zamówieniu ${kiedy}`;
}

/**
 * Stan paczki kilkoma słowami, dla ekranu (profil klienta, 24 września 2026).
 * Ten sam słownik co zdanie dla szkicu — dwa słowniki rozjechałyby się przy
 * pierwszym nowym statusie przewoźnika. `null`: nie wiemy nic.
 */
export function stanPrzesylkiKrotko(s: StanPrzesylkiZamowienia): string | null {
  if (s.dostarczonoAt) return `doręczona ${s.dostarczonoAt.slice(0, 10)}`;
  if (s.status) return STATUS_DLA_KLIENTA[s.status] ?? s.status;
  if (s.waybill) return "nadana";
  return null;
}

/** Stan starszy niż tyle wymaga ponownego pytania przed szkicem. */
export const SWIEZOSC_PRZESYLKI_MS = 30 * 60_000;

/**
 * Czy przed szkicem warto zapytać Allegro jeszcze raz. Doręczona już się nie
 * zmieni, więc pytanie o nią kosztowałoby dwa żądania za nic; świeży stan
 * sprzed pół godziny wystarcza, bo automat układa szkic co kilka minut, a
 * każde przejście przez limit 429 zatrzymuje także synchronizację skrzynki.
 */
export function przesylkaDoOdswiezenia(s: StanPrzesylkiZamowienia, teraz: number): boolean {
  if (s.sprawdzonoAt === null) return true;
  if (s.dostarczonoAt) return false;
  return teraz - Date.parse(s.sprawdzonoAt) >= SWIEZOSC_PRZESYLKI_MS;
}
