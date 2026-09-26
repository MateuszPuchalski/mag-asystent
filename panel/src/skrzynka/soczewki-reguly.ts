import type { Kategoria, KandydatZamowienia, OsRozmowy, StanPrzesylki } from "../api/typy";

/* ── SOCZEWKI: PRAWA KOLUMNA WEDŁUG RODZAJU PYTANIA (0.499.0) ───────────────
   Zgłoszenie właściciela z listą prawdziwych pytań klientów: „faktury nie
   dostaliśmy", „podwójne zamówienie, prosimy anulować jedno", „w paczce są
   inne rzeczy". Każde z nich ma JEDNĄ odpowiedź, której agent szukał po
   całej kolumnie — przy fakturze nawet w Subiekcie. Właściciel: „dobry pomysł
   to pokazywać w prawym panelu informacje na podstawie klasyfikacji pytania".

   Soczewka to blok NA GÓRZE kolumny, dobrany do kategorii rozmowy. Trzy
   pierwsze pokrywają pięć z siedmiu przykładów z listy: anulowanie, inny
   towar i faktura.

   NAJWIĘKSZE RYZYKO TO POMYŁKA KLASYFIKATORA. Soczewka zbudowana na złej
   kategorii wypycha na górę nie to, co trzeba — i robi to pewnie. Dlatego
   trzy reguły, każda z testem:
   1. soczewka DOKŁADA blok na górze, nie chowa niczego pod spodem;
   2. mówi, z czyjej kategorii wyszła, obok etykiety do poprawienia w nagłówku;
   3. przy kategorii awaryjnej (`FALLBACK`) albo nieudanym rozpoznaniu
      nie staje wcale — kolumna zostaje taka, jak bez niej.                 */

export type RodzajSoczewki = "anulowanie" | "inny_towar" | "faktura" | "zwrot" | "paczka";

const SOCZEWKA_KATEGORII: Partial<Record<Kategoria, RodzajSoczewki>> = {
  CANCEL_ORDER: "anulowanie",
  WRONG_PRODUCT: "inny_towar",
  /* „Brak w paczce" pyta o to samo co „inny towar": co MIAŁO przyjść.
     Jedna soczewka na oba, bo odpowiedź zaczyna się od tej samej listy. */
  MISSING_PRODUCT: "inny_towar",
  INVOICE: "faktura",
  /* Zwrot (0.506.0): zrzut z „przytłacza" — klient pisał o odesłaniu części,
     a kolumna mówiła o cenach i EAN. Soczewka mówi to, czego agent szuka:
     czy zwrot jest już w Allegro. Gdy jest, jego karta stoi w „Wymaga
     Ciebie" — wtedy soczewka milczy, żeby nie mówić tego samego dwa razy. */
  RETURN: "zwrot",
  /* ── PACZKA (0.531.0) ────────────────────────────────────────────────────
     „Gdzie moja paczka" to najczęstsze pytanie skrzynki, a odpowiedź leżała
     w zwiniętym wierszu „Zamówienie", pod rozwinięciem i kliknięciem.
     Uszkodzona w transporcie też tu trafia: zgłoszenie szkody u przewoźnika
     zaczyna się od jego nazwy i numeru przesyłki. */
  ORDER_STATUS: "paczka",
  DELIVERY_DELAY: "paczka",
  DELIVERY_LOST: "paczka",
  DELIVERY_DAMAGED: "paczka",
};

/* „Status zamówienia" jest kategorią OGÓLNĄ. Przykład z opisu `soczewka()`
   — „widzę drugą płatność, anulujcie" — bywa statusem z anulowaniem w tle,
   i wtedy odpowiedzią jest soczewka anulowania, nie paczka. Dlatego status
   ustępuje soczewce z dodatkowej kategorii modelu. Kategorie dostawy są
   konkretne i nie ustępują. */
const KATEGORIA_OGOLNA: Kategoria = "ORDER_STATUS";

export interface Soczewka {
  rodzaj: RodzajSoczewki;
  kategoria: Kategoria;
  /** Kategorię potwierdził albo wskazał człowiek — wtedy nie jest domysłem modelu. */
  zCzlowieka: boolean;
  /** Klient dopisał po rozpoznaniu; kategoria może już nie pasować. */
  nieaktualna: boolean;
}

/**
 * Która soczewka dla tej rozmowy; `null` = kolumna bez soczewki.
 *
 * Kategoria człowieka wygrywa zawsze i nie sięga po dodatkowe kategorie
 * modelu: skoro ktoś poprawił rozpoznanie, drugi domysł modelu nie ma prawa
 * wrócić bocznymi drzwiami. Bez niej liczy się główna kategoria modelu,
 * a potem dodatkowe — wiadomość „kupiłem, a widzę drugą płatność, anulujcie"
 * bywa statusem zamówienia z anulowaniem w tle.
 */
export function soczewka(dane: OsRozmowy): Soczewka | null {
  const s = soczewkaKategorii(dane);
  return s?.rodzaj === "zwrot" && dane.zwroty.length > 0 ? null : s;
}

function soczewkaKategorii(dane: OsRozmowy): Soczewka | null {
  const k = dane.rozmowa.kopilot;
  if (!k) return null;
  if (k.kategoriaCzlowieka) {
    const rodzaj = SOCZEWKA_KATEGORII[k.kategoriaCzlowieka];
    return rodzaj ? { rodzaj, kategoria: k.kategoriaCzlowieka, zCzlowieka: true, nieaktualna: false } : null;
  }
  if (k.zrodlo === "FALLBACK" || k.status === "FAILED") return null;
  const trafione = [k.kategoria, ...k.dodatkowe].filter((x) => SOCZEWKA_KATEGORII[x]);
  const konkretna = trafione.find((x) => x !== KATEGORIA_OGOLNA);
  /* Soczewka zwrotu milknie, gdy zwrot już jest (`soczewka()`). Wtedy status
     nie ustępuje soczewce, która i tak nie stanie — inaczej kolumna zostałaby
     bez żadnej, choć główna kategoria pytała o paczkę. */
  const milknie = konkretna !== undefined && SOCZEWKA_KATEGORII[konkretna] === "zwrot" && dane.zwroty.length > 0;
  const kategoria = konkretna && !(milknie && trafione.includes(KATEGORIA_OGOLNA)) ? konkretna : trafione[0];
  return kategoria
    ? { rodzaj: SOCZEWKA_KATEGORII[kategoria]!, kategoria, zCzlowieka: false, nieaktualna: k.nieaktualna }
    : null;
}

/**
 * Czy paczkę zamówienia pokazuje soczewka. Wtedy wiersz „Zamówienie" i
 * „Wymaga Ciebie" jej nie powtarzają — ten sam fakt w dwóch miejscach kazał
 * sprawdzać, czy oba mówią to samo (§26d). Bez zamówienia soczewka paczki
 * nie pokazuje, więc nic niżej nie milknie.
 */
export function paczkaWSoczewce(dane: OsRozmowy): boolean {
  return dane.zamowienie !== null && soczewka(dane)?.rodzaj === "paczka";
}

/* LUSTRO `SWIEZOSC_PRZESYLKI_MS` z `server/src/services/przesylka-zamowienia.ts`.
   Serwer tym progiem rozstrzyga, czy przed szkicem pytać Allegro jeszcze raz.
   Soczewka pyta o to samo, więc dwa progi dałyby dwie różne odpowiedzi. */
export const SWIEZOSC_PACZKI_MS = 30 * 60_000;

/**
 * Czy podsunąć „Sprawdź" — bliźniak `przesylkaDoOdswiezenia` z serwera.
 * Doręczona już się nie zmieni, a świeży stan nie wart dwóch żądań u Allegro.
 * Samo sprawdzenie zostaje JAWNYM kliknięciem: otwarcie rozmowy nie pisze nic.
 */
export function paczkaDoSprawdzenia(p: StanPrzesylki, teraz: number): boolean {
  if (p.sprawdzonoAt === null) return true;
  if (p.dostarczonoAt) return false;
  return teraz - Date.parse(p.sprawdzonoAt) >= SWIEZOSC_PACZKI_MS;
}

/* Status zakupu słowem — ze schematu `CheckoutFormStatus` w
   `docs/allegro/swagger.yaml`, nie z pamięci. `READY_FOR_PROCESSING` znaczy
   tam „payment completed", a `CANCELLED` — anulowanie przez KUPUJĄCEGO. */
export const STATUS_ZAKUPU: Record<string, string> = {
  BOUGHT: "nieopłacone",
  FILLED_IN: "nieopłacone",
  READY_FOR_PROCESSING: "opłacone",
  CANCELLED: "anulowane przez kupującego",
};

/** Okno, w którym dwa zakupy tych samych pozycji wyglądają na pomyłkę, nie na drugą potrzebę. */
export const OKNO_PODWOJNEGO_GODZ = 72;

/**
 * Pary zakupów wyglądające na podwójne: te same pozycje, w oknie 72 godzin,
 * żaden nie anulowany. Mapa `zamówienie → jego bliźniak`.
 *
 * TE SAME POZYCJE, a nie ta sama oferta: w przykładzie właściciela klient
 * kupił noże AL-KO dwa razy, a nie wiemy, czy spod jednej oferty. Nazwy
 * pozycji z formularza zakupu są porównywane po zwinięciu wielkości liter.
 * To wskazówka dla człowieka — panel niczego nie anuluje.
 */
export function podwojneZakupy(
  zakupy: KandydatZamowienia[], oknoGodz = OKNO_PODWOJNEGO_GODZ,
): Map<string, string> {
  const pary = new Map<string, string>();
  const czynne = zakupy.filter((z) => z.status !== "CANCELLED" && z.kupionoAt);
  const klucz = (z: KandydatZamowienia) => z.pozycje.trim().toLowerCase();
  for (let i = 0; i < czynne.length; i++) {
    for (let j = i + 1; j < czynne.length; j++) {
      const a = czynne[i]; const b = czynne[j];
      if (klucz(a) !== klucz(b)) continue;
      const odstep = Math.abs(Date.parse(a.kupionoAt!) - Date.parse(b.kupionoAt!)) / 3_600_000;
      if (odstep > oknoGodz) continue;
      if (!pary.has(a.externalId)) pary.set(a.externalId, b.externalId);
      if (!pary.has(b.externalId)) pary.set(b.externalId, a.externalId);
    }
  }
  return pary;
}

/** Zdanie do szkicu przy „innym towarze" — wstawiane WYŁĄCZNIE kliknięciem agenta. */
export const PROSBA_O_ZDJECIE =
  "Prosimy o zdjęcie otrzymanego towaru razem z etykietą lub opakowaniem — sprawdzimy, co zaszło, i odpiszemy.";
