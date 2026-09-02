import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka, dniSlowo } from "./Kolejka";
import { Dowody } from "./Dowody";
import type { PozycjaZwrotu, Zamowienie, Zwrot } from "../api/typy";

/* Wiersz kolejki ma się czytać W BIEGU. Te testy pilnują trzech rzeczy,
   od których to zależy: pilność widać bez klikania, sygnał zapala się
   tylko wtedy, gdy naprawdę każe przeczytać, a ekran mówi wprost o tym,
   czego NIE wie i czego nie pobiera. */

const POZYCJA: PozycjaZwrotu = {
  id: 1, offerId: "111", nazwa: "Sekator NAC", ilosc: 1, cenaGrosze: 4999,
  waluta: "PLN", powod: "DONT_LIKE_IT", powodKomentarz: "za ciężki", ocena: null,
  url: null, twId: null, twSymbol: null, twZrodlo: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null },
};

const ZAMOWIENIE: Zamowienie = {
  externalId: "ord-1", status: "READY_FOR_PROCESSING", kupujacyLogin: null,
  dostawaGrosze: 1499, dostawaMetoda: "Kurier InPost", sumaGrosze: 9997,
  waluta: "PLN", kupionoAt: "2026-08-20T11:00:00.000Z",
  link: "https://allegro.pl/moje-allegro/zam/ord-1",
  pozycje: [
    { offerId: "111", nazwa: "Sekator NAC", sku: "SEK-46", ilosc: 1, cenaGrosze: 4999, waluta: "PLN", zwracana: true },
    { offerId: "222", nazwa: "Zraszacz obrotowy", sku: null, ilosc: 1, cenaGrosze: 3490, waluta: "PLN", zwracana: false },
  ],
};

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "zw-1", numer: "REF-1", orderId: "ord-1",
  utworzono: "2026-08-25T09:00:00.000Z", paczkaAt: "2026-08-28T09:00:00.000Z",
  kubelek: "decyzja", sygnaly: [], terminAt: "2026-09-08T09:00:00.000Z",
  dniDoTerminu: 7, sumaPozycjiGrosze: 4999, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, zamowienie: null,
  werdykt: null, kwotaGrosze: null, kwotaWariant: null, korektaNumer: null,
  rejectionCode: null, wersja: 1,
  pozycje: [{ id: 1, offerId: "111", nazwa: "Sekator NAC", ilosc: 1, cenaGrosze: 4999,
    waluta: "PLN", powod: "DONT_LIKE_IT", powodKomentarz: "za ciężki", ocena: null,
    url: null, twId: null, twSymbol: null, twZrodlo: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null } }],
  ...n,
});


/* `Dowody` woła mutację potwierdzenia kartoteki, więc render potrzebuje
   klienta zapytań — inaczej hook wywala się, zanim cokolwiek się narysuje. */
const zKlientem = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
};

describe("Kolejka zwrotów", () => {
  it("pusty kubełek mówi o sobie zamiast pokazywać pustą listę", () => {
    render(<Kolejka zwroty={[]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText(/Ten kubełek jest pusty/)).toBeInTheDocument();
  });

  it("kursor gonimy widokiem, bo kolejka siedzi we własnym scrollerze", () => {
    /* Od 0.165.0 lista przewija się u siebie, a `j`/`k` przesuwają zaznaczenie
       bez fokusu. Bez tego wywołania operator po trzech naciśnięciach steruje
       czymś, czego nie widzi. jsdom nie liczy układu — atrapa stoi w
       `src/test/setup.ts` — więc sprawdzamy sam fakt dogonienia. */
    const gonienie = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    gonienie.mockClear();
    const { rerender } = render(
      <Kolejka zwroty={[zwrot(), zwrot({ id: 2, numer: "REF-2" })]} wybrany={1}
        onWybierz={() => {}} />);
    gonienie.mockClear();

    rerender(<Kolejka zwroty={[zwrot(), zwrot({ id: 2, numer: "REF-2" })]} wybrany={2}
      onWybierz={() => {}} />);
    expect(gonienie).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("przy szukaniu wiersz mówi, z którego kubełka jest", () => {
    /* Wynik z kubełka ZAMKNIĘTE bez etykiety wyglądałby jak praca do zrobienia. */
    const { rerender } = render(
      <Kolejka zwroty={[zwrot({ kubelek: "zamkniety" })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.queryByText("Zamknięte")).toBeNull();

    rerender(<Kolejka zwroty={[zwrot({ kubelek: "zamkniety" })]} wybrany={null}
      zKubelkiem onWybierz={() => {}} />);
    expect(screen.getByText("Zamknięte")).toBeInTheDocument();
  });

  it("brak wyników szukania mówi co innego niż pusty kubełek", () => {
    /* „Ten kubełek jest pusty" przy włączonym filtrze byłoby nieprawdą:
       kubełek bywa pełen, tylko nic w nim nie pasuje. */
    render(<Kolejka zwroty={[]} wybrany={null} zKubelkiem onWybierz={() => {}} />);
    expect(screen.getByText(/Żaden zwrot nie pasuje/)).toBeInTheDocument();
  });

  it("wiersz niesie numer, towar, sztuki i kwotę — i ani jednej rzeczy więcej", () => {
    render(<Kolejka zwroty={[zwrot()]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("REF-1")).toBeInTheDocument();
    expect(screen.getByText(/Sekator NAC/)).toBeInTheDocument();
    expect(screen.getByText(/1 szt\./)).toBeInTheDocument();
    expect(screen.getByText("49,99 PLN")).toBeInTheDocument();
  });

  it("termin czyta się jako pilność, a po terminie liczy się dalej", () => {
    const { rerender } = render(
      <Kolejka zwroty={[zwrot({ dniDoTerminu: 7 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("7 dni")).toBeInTheDocument();
    rerender(<Kolejka zwroty={[zwrot({ dniDoTerminu: 0 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("dziś")).toBeInTheDocument();
    rerender(<Kolejka zwroty={[zwrot({ dniDoTerminu: -2 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("2 dni po")).toBeInTheDocument();
  });

  it("jeden dzień to dzień, a nie forma mnoga", () => {
    /* Ekran ma się czytać w biegu; zła forma zatrzymuje oko na pół sekundy. */
    expect(dniSlowo(1)).toBe("1 dzień");
    expect(dniSlowo(2)).toBe("2 dni");
    expect(dniSlowo(12)).toBe("12 dni");
    render(<Kolejka zwroty={[zwrot({ dniDoTerminu: 1 })]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("1 dzień")).toBeInTheDocument();
  });

  it("zwrot bez sygnałów nie żąda uwagi", () => {
    /* Kolor, który zapala się zawsze, uczy operatora go ignorować. */
    render(<Kolejka zwroty={[zwrot()]} wybrany={null} onWybierz={() => {}} />);
    expect(screen.queryByText("termin")).not.toBeInTheDocument();
    expect(screen.queryByText("bez paczki")).not.toBeInTheDocument();
  });

  it("sygnały mają podpis, nie tylko barwę", () => {
    render(<Kolejka zwroty={[zwrot({ sygnaly: ["termin", "brak_dowodu"] })]}
      wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("termin")).toBeInTheDocument();
    expect(screen.getByText("bez paczki")).toBeInTheDocument();
  });

  it("wybrany wiersz jest wybrany także dla czytnika ekranu", () => {
    render(<Kolejka zwroty={[zwrot()]} wybrany={1} onWybierz={() => {}} />);
    expect(screen.getByRole("button", { current: true })).toBeInTheDocument();
  });

  it("kliknięcie oddaje identyfikator zwrotu", async () => {
    const wybierz = vi.fn();
    render(<Kolejka zwroty={[zwrot()]} wybrany={null} onWybierz={wybierz} />);
    await userEvent.click(screen.getByRole("button"));
    expect(wybierz).toHaveBeenCalledWith(1);
  });
});

describe("Dowody", () => {
  it("mówi wprost, czego nie wie i czego nie pobiera", () => {
    /* Dwa zdania, które muszą być na ekranie, a nie tylko w kodzie: bez
       zamówienia nie znamy kwoty pełnej, a danych nadawcy nie pobieramy. */
    render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText(/Kwoty pełnej nie znamy bez zamówienia/)).toBeInTheDocument();
    expect(screen.getByText(/Danych nadawcy i konta bankowego nie pobieramy/)).toBeInTheDocument();
  });

  it("brak paczki jest zdaniem, nie pustym polem", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ paczkaAt: null })} />));
    expect(screen.getByText(/Towar jeszcze nie wrócił/)).toBeInTheDocument();
  });

  it("powód zwrotu tłumaczy się na polski, a komentarz klienta zostaje w cudzysłowie", () => {
    render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText(/nie spodobał się/)).toBeInTheDocument();
    expect(screen.getByText(/za ciężki/)).toBeInTheDocument();
  });

  it("zwrot bez pozycji mówi, że nie ma czego wycenić", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ pozycje: [], sumaPozycjiGrosze: 0 })} />));
    expect(screen.getByText(/nie ma czego wycenić/)).toBeInTheDocument();
  });

  it("z zamówieniem pokazuje kwotę pełną zamiast zdania o jej braku", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE, kwotaPelnaGrosze: 6498 })} />));
    expect(screen.queryByText(/Kwoty pełnej nie znamy/)).not.toBeInTheDocument();
    expect(screen.getByText("64,98 PLN")).toBeInTheDocument();
    expect(screen.getByText(/Kurier InPost/)).toBeInTheDocument();
  });

  it("pokazuje CAŁE zamówienie i zaznacza, co wraca", () => {
    /* „Kupił trzy, oddaje jedną" jest kontekstem decyzji, nie ciekawostką. */
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE })} />));
    /* Sekator jest dwa razy: raz na liście zamówienia, raz wśród zwracanych
       pozycji — i to jest właśnie ten kontekst, o który chodzi. Zraszacz
       tylko raz, bo nie wraca. */
    expect(screen.getAllByText("Sekator NAC")).toHaveLength(2);
    expect(screen.getByText("Zraszacz obrotowy")).toBeInTheDocument();
    expect(screen.getAllByText("wraca")).toHaveLength(1);
  });

  it("bez pobranego zamówienia pokazuje identyfikator i mówi, że treść dojdzie", () => {
    render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText("ord-1")).toBeInTheDocument();
    expect(screen.getByText(/dociągnie ją najbliższa synchronizacja/)).toBeInTheDocument();
  });

  it("odnośniki wychodzą w nowej karcie i nie wynoszą naszego adresu", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE, linkZwrotu: "https://allegro.pl/zwroty/1" })} />));
    const zwrotLink = screen.getByRole("link", { name: /REF-1/ });
    expect(zwrotLink).toHaveAttribute("href", "https://allegro.pl/zwroty/1");
    expect(zwrotLink).toHaveAttribute("target", "_blank");
    expect(zwrotLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /Otwórz w Allegro/ }))
      .toHaveAttribute("href", "https://allegro.pl/moje-allegro/zam/ord-1");
  });

  it("bez adresu zostaje sam tekst — link donikąd jest gorszy od jego braku", () => {
    render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.queryByRole("link", { name: /REF-1/ })).not.toBeInTheDocument();
    expect(screen.getByText("REF-1")).toBeInTheDocument();
  });

  it("kartoteka zawsze niesie źródło: zatwierdzona, proponowana albo żadna", () => {
    /* §11.3 żąda widocznego źródła i pewności, a §4.3 nie pozwala, żeby wybór
       automatu udawał fakt z Allegro. */
    const { rerender } = render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText(/Bez kartoteki/)).toBeInTheDocument();

    rerender(zKlientem(<Dowody zwrot={zwrot({ pozycje: [{ ...POZYCJA,
      propozycja: { pewnosc: "sku", twId: 10, symbol: "SEK-46", zrodlo: 'SKU oferty „SEK-46"',
        powod: null, poKolumnie: "offer_id" } }] })} />));
    /* Propozycja czeka na JEDNO kliknięcie i mówi, skąd się wzięła. */
    expect(screen.getByRole("button", { name: /Zatwierdź/ })).toBeInTheDocument();
    expect(screen.getByText("SEK-46")).toBeInTheDocument();
    expect(screen.getByText(/SKU oferty/)).toBeInTheDocument();

    rerender(zKlientem(<Dowody zwrot={zwrot({ pozycje: [{ ...POZYCJA,
      twId: 10, twSymbol: "SEK-46", twZrodlo: "reczne" }] })} />));
    expect(screen.getByText(/wskazana ręcznie/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zatwierdź/ })).not.toBeInTheDocument();
  });

  it("propozycja z pamięci wskazań też czeka na JEDNO kliknięcie", () => {
    /* Warunek przycisku stoi na `twId`, nie na jednej wartości pewności.
       Propozycja z pamięci jest tą najpewniejszą — stoi za nią człowiek —
       a do 0.153.1 jako jedyna nie dostawała przycisku i kazała wskazywać
       kartotekę po raz drugi. */
    render(zKlientem(<Dowody zwrot={zwrot({ pozycje: [{ ...POZYCJA, propozycja: {
      pewnosc: "pamiec", twId: 10, symbol: "SEK-46",
      zrodlo: "Wskazane wcześniej przez: Ala", powod: null, poKolumnie: null } }] })} />));
    expect(screen.getByRole("button", { name: /Zatwierdź/ })).toBeInTheDocument();
    expect(screen.getByText(/Wskazane wcześniej przez/)).toBeInTheDocument();
  });

  it("brak kartoteki niesie POWÓD, a nie samo »Bez kartoteki«", () => {
    /* Sześć różnych zerwań łańcucha wyglądało do 0.153.1 identycznie
       i operator nie miał jak odróżnić braku danych od usterki kodu. */
    render(zKlientem(<Dowody zwrot={zwrot({ pozycje: [{ ...POZYCJA, propozycja: {
      pewnosc: "brak", twId: null, symbol: null,
      zrodlo: "Oferta bez SKU w Allegro (pole „sygnatura”)",
      powod: "oferta_bez_sku", poKolumnie: null } }] })} />));
    expect(screen.getByText(/Oferta bez SKU w Allegro/)).toBeInTheDocument();
  });

  it("odnośnik do oferty jest podpisany, a jego brak — powiedziany wprost", () => {
    /* Podkreślona nazwa towaru BYŁA odnośnikiem od 0.153.0 i nikt jej tak nie
       czytał: podkreślenie nie mówi, dokąd prowadzi. Milczenie przy pustym
       adresie wygląda z kolei na usterkę panelu, a jest brakiem danych
       po stronie Allegro. */
    const { rerender } = render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText(/Allegro nie podało adresu oferty/)).toBeInTheDocument();

    rerender(zKlientem(<Dowody zwrot={zwrot({ pozycje: [{ ...POZYCJA,
      url: "https://allegro.pl/oferta/sekator-111" }] })} />));
    const link = screen.getByRole("link", { name: /Zobacz ofertę/ });
    expect(link).toHaveAttribute("href", "https://allegro.pl/oferta/sekator-111");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("bez pobranego zamówienia ekran daje drogę wyjścia, nie samo czekanie", () => {
    /* Diagnoza „czemu ta pozycja nie ma kartoteki" wymagała wcześniej
       czekania dziesięciu minut na najrzadszy z trzech tickerów. */
    const { rerender } = render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByRole("button", { name: /Dociągnij teraz/ })).toBeInTheDocument();

    /* Bez numeru zamówienia nie ma czego dociągnąć — przycisk, który niczego
       nie zmieni, obiecywałby, że zmieni. */
    rerender(zKlientem(<Dowody zwrot={zwrot({ orderId: null })} />));
    expect(screen.queryByRole("button", { name: /Dociągnij teraz/ })).not.toBeInTheDocument();
    expect(screen.getByText(/nie podało przy tym zwrocie numeru zamówienia/)).toBeInTheDocument();
  });
});
