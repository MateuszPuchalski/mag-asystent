import { allegroAdapter } from "../adapters/allegro.js";
import type {
  PrzesylkaZamowienia,
  ZamowienieAllegro,
  ZamowienieKupujacego,
  ZdarzenieSledzenia,
} from "../adapters/allegro.js";

/* ── Przesyłki ostatnich zamówień klienta (0.105.0) ──────────────────────────
   „Kiedy dojdzie moja paczka?" to jedno z najczęstszych pytań klientów —
   a odpowiedź wymagała dotąd wejścia do panelu Allegro. Ten moduł składa
   dane do odpowiedzi w JEDNYM miejscu, z twardym sufitem liczby zapytań:
   lista zamówień (1–2 strzały), paczki trzech najnowszych, śledzenie TYLKO
   paczek najnowszego (max 2). Najgorzej ~7 strzałów po 10 s timeoutu.

   Nic nie jest zapisywane — status przesyłki starzeje się w godziny, więc
   kopia u nas kłamałaby od pierwszego odświeżenia. Czyta się na żądanie:
   z szuflady kontekstu pytania i z bramkowanego bloku kontekstu szkicu.     */

/**
 * Kody fulfillment.status po polsku. Kod spoza słownika pokazujemy SUROWO
 * (wzorzec powodów zwrotu): ukrycie nieznanego stanu byłoby kłamstwem,
 * a Allegro dopisuje wartości bez zapowiedzi ([WERYFIKUJ] pełny zbiór).
 */
export const STATUSY_WYSYLKI: Record<string, string> = {
  NEW: "Nowe — jeszcze nieprzetwarzane",
  PROCESSING: "W przygotowaniu",
  READY_FOR_SHIPMENT: "Spakowane, czeka na nadanie",
  READY_FOR_PICKUP: "Gotowe do odbioru",
  SENT: "Wysłane",
  PICKED_UP: "Doręczone / odebrane",
  CANCELLED: "Anulowane",
  SUSPENDED: "Wstrzymane",
  RETURNED: "Wróciło do nadawcy",
};

export interface PrzesylkaWidok extends PrzesylkaZamowienia {
  ostatnieZdarzenie: ZdarzenieSledzenia | null;
}

export interface ZamowienieZWysylka extends ZamowienieKupujacego {
  /** Polska etykieta statusu wysyłki; kod spoza słownika idzie surowo. */
  wysylkaOpis: string | null;
  przesylki: PrzesylkaWidok[];
}

export interface PrzesylkiKlienta {
  login: string | null;
  zamowienia: ZamowienieZWysylka[];
}

/** Ile najnowszych zamówień oglądamy i ilu paczkom dociągamy śledzenie. */
const ZAMOWIEN = 3;
const SLEDZONYCH_PACZEK = 2;

/**
 * Czy pytanie brzmi jak pytanie o wysyłkę. Jeden wzorzec, eksportowany do
 * testów (jak SLOWA_KATEGORII w ai.ts). Świadomie BEZ gołego `nada`
 * (fałszywka na „nadal") i bez `zamówien`/`otrzym` solo (każde pytanie
 * o dobór części je niesie).
 */
export const WZORZEC_WYSYLKI =
  /przesyłk|przesylk|paczk|dostaw|dostarcz|doręcz|dorecz|wysył|wysyl|wysła|wysla|wyśle|wysle|kurier|śledz|sledz|track|nadan|nadacie|dojdzie|dotrze|dotarł|dotarl|doszł|doszl|paczkomat|inpost|dpd|pocztex|list przewozowy|gdzie jest|status zamówienia|status zamowienia|kiedy będzie|kiedy bedzie|kiedy otrzymam/i;

export function czyPytaOWysylke(tresc: string): boolean {
  return WZORZEC_WYSYLKI.test(tresc);
}

/**
 * Przesyłki ostatnich zamówień kupującego. `login` bywa maską `client:NNN`
 * z listy wątków — rozstrzyga to adapter. Błędy lecą wyżej: trasa mapuje je
 * na 502, a kontekst szkicu łapie i degraduje do uczciwego zdania.
 */
export async function przesylkiKupujacego(login: string | null): Promise<PrzesylkiKlienta> {
  if (!login) return { login: null, zamowienia: [] };
  const adapter = allegroAdapter();
  const zamowienia = await adapter.zamowieniaKupujacego({ login, id: null }, ZAMOWIEN);

  const wynik: ZamowienieZWysylka[] = [];
  for (const [i, z] of zamowienia.entries()) {
    const paczki = await adapter.przesylkiZamowienia(z.id);
    const przesylki: PrzesylkaWidok[] = [];
    for (const [j, p] of paczki.entries()) {
      /* Śledzenie tylko dla NAJNOWSZEGO zamówienia i najwyżej dwóch paczek —
         to o nie pyta klient, a każde zdarzenie to osobny strzał HTTP. */
      const sledz =
        i === 0 && j < SLEDZONYCH_PACZEK && p.przewoznikId && p.waybill
          ? await adapter.sledzeniePrzesylki(p.przewoznikId, p.waybill)
          : [];
      przesylki.push({ ...p, ostatnieZdarzenie: sledz.at(-1) ?? null });
    }
    wynik.push({
      ...z,
      wysylkaOpis: z.wysylka ? (STATUSY_WYSYLKI[z.wysylka] ?? z.wysylka) : null,
      przesylki,
    });
  }
  return { login, zamowienia: wynik };
}

const dataKrotka = (iso: string | null): string => (iso ? iso.slice(0, 10) : "?");

/** Jedna linia opisu zamówienia — wspólna dla kontekstu modelu i ekranu. */
export function liniaZamowienia(z: ZamowienieZWysylka): string {
  const pierwsza = z.pozycje[0]?.nazwa ?? "(bez pozycji)";
  const wiecej = z.pozycje.length > 1 ? ` (+${z.pozycje.length - 1} poz.)` : "";
  const przesylka = z.przesylki[0];
  const kurier = przesylka
    ? ` | ${przesylka.przewoznik ?? przesylka.przewoznikId ?? "przewoźnik nieznany"}, nr ${przesylka.waybill ?? "?"}`
    : "";
  const zdarzenie = przesylka?.ostatnieZdarzenie
    ? ` | ostatnio: ${przesylka.ostatnieZdarzenie.opis ?? przesylka.ostatnieZdarzenie.kod ?? "?"} (${dataKrotka(przesylka.ostatnieZdarzenie.at)})`
    : "";
  const okno =
    z.dostawaOd || z.dostawaDo
      ? ` | obiecane doręczenie: ${dataKrotka(z.dostawaOd)}–${dataKrotka(z.dostawaDo)}`
      : "";
  return `- Zamówienie z ${dataKrotka(z.kupionoAt)}: ${pierwsza}${wiecej} | wysyłka: ${z.wysylkaOpis ?? "status nieznany"}${kurier}${zdarzenie}${okno}`;
}

/** Blok kontekstu dla modelu — linie gotowe do sklejenia w `kontekstPytania`. */
export function blokPrzesylek(dane: PrzesylkiKlienta): string[] {
  if (dane.zamowienia.length === 0) {
    return [
      "\nPRZESYŁKI: ten kupujący nie ma zamówień z ostatnich tygodni — " +
        "NIE zgaduj statusu, dopytaj o numer zamówienia.",
    ];
  }
  const linie = ["\nPRZESYŁKI OSTATNICH ZAMÓWIEŃ KLIENTA (dane z Allegro — wolno cytować status i daty):"];
  for (const z of dane.zamowienia) linie.push(liniaZamowienia(z));
  linie.push(
    "ZASADY: statusy i daty podawaj dokładnie jak wyżej. NIE obiecuj terminu " +
      "doręczenia, którego tu nie ma. Gdy danych brak — napisz, że sprawdzimy " +
      "i wrócimy z informacją."
  );
  return linie;
}

/* ── Kontekst JEDNEGO zamówienia sprawy (0.132.0) ────────────────────────────
   Etap E z docs/architektura-spraw.md. Powyżej: zamówienia KUPUJĄCEGO, gdy
   znamy tylko login (pytania). Tutaj: zamówienie, którego numer sprawa już
   ma w bazie — przy dyskusji i zwrocie `order_id` leżał nietknięty od
   0.103.0, a agent i tak szedł po te dane do panelu Allegro.

   Sufit ten sam co wyżej i z tego samego powodu: śledzenie najwyżej dwóch
   paczek, bo każde zdarzenie to osobny strzał HTTP. Nic nie zapisujemy —
   status przesyłki i płatności starzeje się w godziny.                       */

export interface KontekstZamowienia {
  orderId: string | null;
  zamowienie: ZamowienieAllegro | null;
  /** Polska etykieta `fulfillment.status`; kod spoza słownika idzie surowo. */
  wysylkaOpis: string | null;
  przesylki: PrzesylkaWidok[];
}

export async function kontekstZamowienia(orderId: string | null): Promise<KontekstZamowienia> {
  if (!orderId) return { orderId: null, zamowienie: null, wysylkaOpis: null, przesylki: [] };
  const adapter = allegroAdapter();
  const zamowienie = await adapter.zamowienie(orderId);
  /* Zamówienia nie ma (skasowane, cudze, literówka w order_id) — paczek nie
     ma po co pytać. Uczciwe „nie znaleziono" zamiast pustego szkieletu. */
  if (!zamowienie) return { orderId, zamowienie: null, wysylkaOpis: null, przesylki: [] };

  const paczki = await adapter.przesylkiZamowienia(orderId);
  const przesylki: PrzesylkaWidok[] = [];
  for (const [i, p] of paczki.entries()) {
    const sledz =
      i < SLEDZONYCH_PACZEK && p.przewoznikId && p.waybill
        ? await adapter.sledzeniePrzesylki(p.przewoznikId, p.waybill)
        : [];
    przesylki.push({ ...p, ostatnieZdarzenie: sledz.at(-1) ?? null });
  }
  return {
    orderId,
    zamowienie,
    wysylkaOpis: zamowienie.wysylka
      ? (STATUSY_WYSYLKI[zamowienie.wysylka] ?? zamowienie.wysylka)
      : null,
    przesylki,
  };
}
