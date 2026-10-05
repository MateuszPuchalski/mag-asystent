import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, StanPrzesylki, SzczegolReklamacji, Zamowienie } from "../api/typy";
import { FaktySprawy } from "./Fakty";
import { kartotekaKolumny } from "./Glowica";
/* Fakty stoją w głowicy jako pas komórek. Test patrzy na sam pas, w ramie
   routera, bo „Ten zakup u nas" niesie odnośniki do kolejek. */
const Fakty = ({ szczegol, onSprawdzPrzesylke, sprawdzaPrzesylke, bladPrzesylki }: {
  szczegol: SzczegolReklamacji; onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean; bladPrzesylki?: string;
}) => <MemoryRouter><FaktySprawy szczegol={szczegol} towar={kartotekaKolumny(szczegol)}
  onSprawdzPrzesylke={onSprawdzPrzesylke} sprawdzaPrzesylke={sprawdzaPrzesylke}
  bladPrzesylki={bladPrzesylki} /></MemoryRouter>;


/* Kolumna dowodów pyta od 0.411.0 o cennik kartoteki (`useKartaTowaru`), a ten
   plik nie stawia klienta TanStacka — pilnuje UKŁADU kolumny, nie cen. Własne
   testy cennik ma w `skrzynka/TowarRozmowy.test.tsx`. */
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: () => ({ data: undefined, isLoading: false, error: null }),
}));


/* ── Ceny i paczka w pasie faktów (0.393.0) ──────────────────────────────
   Zgłoszenie właściciela: „dodaj status przesyłki i ceny produktów". Testujemy
   to, co przy reklamacji rozstrzyga rozmowę, a nie to, co ładnie wygląda.

   1. KWOTY. Kolumna miała nazwę towaru i SKU, ale ani jednej liczby — a przy
      żądaniu zwrotu pieniędzy to pierwsza rzecz, której agent szuka. Dostawa
      stoi OSOBNO od sumy, bo klient pyta czasem właśnie o nią.
   2. TRZY STANY PACZKI, każdy mówi co innego i każdy każe co innego zrobić:
      „nie pytaliśmy", „Allegro nie ma numeru", „jest numer i status". Sklejenie
      któregokolwiek z pozostałymi kazałoby agentowi zgadywać, czy brak wiedzy
      jest nasz, czy Allegro.
   3. PYTANIE NA KLIKNIĘCIE. Otwarcie sprawy nie wysyła do Allegro ani jednego
      żądania — zasada „zero zapisu przy patrzeniu" obowiązuje też koszt
      u dostawcy.

   Stan paczki stoi w komórce „Paczka do klienta" w pasie faktów głowicy —
   zdaniem, nie kodem przewoźnika — więc odpowiedź widać bez klikania.
   Pytanie od nowa stoi w tej samej komórce.                                    */

const rek = (): Reklamacja => ({
  id: 7, externalId: "i-7", numer: "7/2026", orderId: "zam-7", offerId: null,
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "NOT_DELIVERED",
  powodOpis: "Paczka nie dotarła", temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 0, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", prowadzi: null, prowadziAt: null,
  notatka: null, wersja: 1, kubelek: "decyzja", sygnaly: [], tagi: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: null, ofertaZdjecie: "nieznane", twId: null, twSymbol: null,
} as unknown as Reklamacja);

const ZAMOWIENIE = {
  externalId: "zam-7", status: "READY_FOR_PROCESSING", kupujacyLogin: "kupujacy1",
  dostawaGrosze: 1990, dostawaMetoda: "Kurier DPD", platnoscTyp: "ONLINE",
  platnoscAt: null, fakturaZadana: null, sumaGrosze: 12980, waluta: "PLN",
  kupionoAt: "2026-09-01T08:00:00.000Z", link: null,
  pozycje: [
    { offerId: "of-1", sku: "SEK-1", nazwa: "Sekator ogrodowy", ilosc: 2,
      cenaGrosze: 4995, waluta: "PLN" },
    { offerId: "of-2", sku: null, nazwa: "Rękawice", ilosc: 1,
      cenaGrosze: 995, waluta: "PLN" },
  ],
} as unknown as Zamowienie;

const szczegol = (n: Partial<SzczegolReklamacji> = {}): SzczegolReklamacji => ({
  reklamacja: rek(), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [], droga: [],
  kartoteka: null, karta: null, zamowienie: null, przesylka: null, ...n,
} as unknown as SzczegolReklamacji);

const props = (n: Partial<SzczegolReklamacji> = {}, extra = {}) => ({
  szczegol: szczegol(n), trwa: false, bladZapisu: "",
  onProwadze: vi.fn(), onNotatka: vi.fn(), ...extra,
});

const stan = (n: Partial<StanPrzesylki> = {}): StanPrzesylki => ({
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null, ...n,
});

describe("Ceny zamówienia w pasie faktów", () => {
  /* Pas stoi w głowicy bez zwijek, więc wszystko poniżej widać bez kliknięcia. */
  const zamowienie = () => screen.getByText("Zamówienie").parentElement!;

  it("pokazuje kwotę KAŻDEJ pozycji razem z ilością", () => {
    render(<Fakty {...props({ zamowienie: ZAMOWIENIE })} />);
    expect(screen.getByText("Sekator ogrodowy")).toBeVisible();
    expect(screen.getByText("2 × 49,95 PLN")).toBeInTheDocument();
    expect(screen.getByText("1 × 9,95 PLN")).toBeInTheDocument();
  });

  it("DOSTAWĘ trzyma osobno od sumy, bo o nią klient pyta osobno", () => {
    render(<Fakty {...props({ zamowienie: ZAMOWIENIE })} />);
    expect(zamowienie().textContent).toContain("2 pozycje");
    expect(screen.getByText("dostawa 19,90 PLN, Kurier DPD · razem 129,80 PLN")).toBeVisible();
    /* Suma ma jeden dom. */
    expect(screen.getAllByText(/129,80 PLN/)).toHaveLength(1);
  });

  it("bez pobranego zamówienia mówi to wprost i NIE pokazuje pustych kwot", () => {
    render(<Fakty {...props()} />);
    expect(zamowienie().textContent).toContain("nie pobraliśmy");
    expect(screen.queryByText(/dostawa/)).not.toBeInTheDocument();
  });
});

describe("Stan przesyłki do klienta", () => {
  const paczka = () => screen.getByText("Paczka do klienta").parentElement!;

  it("mówi wprost, że jeszcze NIE PYTALIŚMY — to brak wiedzy nasz, nie Allegro", () => {
    render(<Fakty {...props({ przesylka: stan() })} />);
    expect(paczka().textContent).toContain("nie wiemy");
    expect(paczka().textContent).toContain("nie pytaliśmy jeszcze Allegro");
  });

  it("odróżnia BRAK NUMERU u Allegro od braku pytania", () => {
    render(<Fakty {...props({ przesylka: stan({ sprawdzonoAt: "2026-09-18T07:00:00.000Z" }) })} />);
    expect(screen.getByText(/Allegro nie ma numeru/)).toBeInTheDocument();
    expect(screen.queryByText("nie pytaliśmy jeszcze Allegro")).not.toBeInTheDocument();
  });

  it("DORĘCZENIE pokazuje z datą, bo ono zamyka spór o niedostarczenie", () => {
    render(<Fakty {...props({
      przesylka: stan({
        waybill: "1234567890", przewoznik: "DPD", status: "DELIVERED",
        dostarczonoAt: "2026-09-10T12:00:00.000Z", sprawdzonoAt: "2026-09-18T07:00:00.000Z",
      }),
    })} />);
    /* Doręczenie widać bez kliknięcia — to ono zamyka spór. */
    expect(paczka().textContent).toContain("doręczona");
    expect(paczka().textContent).toContain("10 września 2026");
    expect(screen.getByText("1234567890")).toBeVisible();
    expect(paczka().textContent).toContain("DPD");
  });

  it("w drodze mówi SŁOWEM, nie kodem przewoźnika i nie zmyśloną datą doręczenia", () => {
    const { unmount } = render(<Fakty {...props({
      przesylka: stan({
        waybill: "999", przewoznik: "INPOST", status: "IN_TRANSIT",
        sprawdzonoAt: "2026-09-18T07:00:00.000Z",
      }),
    })} />);
    expect(paczka().textContent).toContain("w drodze do klienta");
    expect(paczka().textContent).not.toContain("IN_TRANSIT");
    expect(screen.queryByText(/doręczona/)).not.toBeInTheDocument();
    /* Przewoźnik też słowem, ze słownika zwrotów. */
    expect(paczka().textContent).toContain("InPost");
    unmount();
    /* Kod spoza słownika nie znika: mówi, skąd jest, żeby dało się go dopisać. */
    render(<Fakty {...props({
      przesylka: stan({ waybill: "999", status: "OUT_FOR_DELIVERY", sprawdzonoAt: "2026-09-18T07:00:00.000Z" }),
    })} />);
    expect(paczka().textContent).toContain("przewoźnik podał: OUT_FOR_DELIVERY");
  });

  it("pyta Allegro TYLKO na kliknięcie — samo otwarcie ekranu nie pyta", async () => {
    const onSprawdzPrzesylke = vi.fn();
    render(<Fakty {...props({ przesylka: stan() }, { onSprawdzPrzesylke })} />);
    expect(onSprawdzPrzesylke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "sprawdź" }));
    expect(onSprawdzPrzesylke).toHaveBeenCalledTimes(1);
  });

  it("po pytaniu mówi krótko, kiedy pytaliśmy, i daje „sprawdź jeszcze raz”", () => {
    render(<Fakty {...props({ przesylka: stan({ sprawdzonoAt: "2026-09-18T07:00:00.000Z" }) },
      { onSprawdzPrzesylke: vi.fn() })} />);
    /* Pełna chwila stoi w podpowiedzi, na widoku — krótka data. */
    expect(screen.getByTitle(/^Pytaliśmy Allegro /)).toHaveTextContent(/^sprawdzone /);
    expect(screen.getByRole("button", { name: "sprawdź jeszcze raz" })).toBeInTheDocument();
  });

  it("bez procedury pytania NIE rysuje martwego przycisku", () => {
    render(<Fakty {...props({ przesylka: stan() })} />);
    expect(screen.queryByRole("button", { name: "sprawdź" })).not.toBeInTheDocument();
  });

  it("bez danych o przesyłce komórki Paczka nie ma — nie ma o co pytać", () => {
    render(<Fakty {...props()} />);
    expect(screen.queryByText("Paczka do klienta")).not.toBeInTheDocument();
  });
});
