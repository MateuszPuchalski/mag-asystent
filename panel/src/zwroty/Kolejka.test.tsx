import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka, dniSlowo } from "./Kolejka";
import { Dowody } from "./Dowody";
import type { PozycjaZwrotu, Zamowienie, Zwrot } from "../api/typy";

/* Wiersz kolejki ma się czytać W BIEGU. Te testy pilnują trzech rzeczy,
   od których to zależy: pilność widać bez klikania, sygnał zapala się
   tylko wtedy, gdy naprawdę każe przeczytać, a ekran mówi wprost o tym,
   czego NIE wie i czego nie pobiera. */

const POZYCJA: PozycjaZwrotu = {
  id: 1, zrodlo: "allegro", offerId: "111", nazwa: "Sekator NAC", ilosc: 1, cenaGrosze: 4999,
  waluta: "PLN", powod: "DONT_LIKE_IT", powodKomentarz: "za ciężki", ocena: null,
  wKoszyku: false, url: null, twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null },
};

const ZAMOWIENIE: Zamowienie = {
  externalId: "ord-1", status: "READY_FOR_PROCESSING", kupujacyLogin: null,
  dostawaGrosze: 1499, dostawaMetoda: "Kurier InPost", platnoscTyp: null, platnoscAt: null, fakturaZadana: null, sumaGrosze: 9997,
  waluta: "PLN", kupionoAt: "2026-08-20T11:00:00.000Z",
  link: "https://allegro.pl/moje-allegro/zam/ord-1",
  pozycje: [
    { offerId: "111", nazwa: "Sekator NAC", sku: "SEK-46", ilosc: 1, cenaGrosze: 4999, waluta: "PLN", zwracana: true, wracaIlosc: 1 },
    { offerId: "222", nazwa: "Zraszacz obrotowy", sku: null, ilosc: 1, cenaGrosze: 3490, waluta: "PLN", zwracana: false, wracaIlosc: 0 },
  ],
};

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "zw-1", numer: "REF-1", orderId: "ord-1",
  utworzono: "2026-08-25T09:00:00.000Z", paczkaAt: "2026-08-28T09:00:00.000Z", dostarczonoAt: null, przesylkaStatus: null,
  kubelek: "decyzja", sygnaly: [], terminAt: "2026-09-08T09:00:00.000Z",
  dniDoTerminu: 7, sumaPozycjiGrosze: 4999, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, zamowienie: null,
  werdykt: null, werdyktPowod: null, kwotaGrosze: null, kwotaWariant: null, korektaNumer: null, korektaZrodlo: null,
  zrodlo: "allegro", notatka: null, kupujacyLogin: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  rejectionCode: null, wersja: 1,
  pozycje: [{ id: 1, zrodlo: "allegro", offerId: "111", nazwa: "Sekator NAC", ilosc: 1, cenaGrosze: 4999,
    waluta: "PLN", powod: "DONT_LIKE_IT", powodKomentarz: "za ciężki", ocena: null,
    wKoszyku: false, url: null, twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null } }],
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

  it("paczka nieodebrana mówi o sobie i pokazuje numer listu", () => {
    /* Bez plakietki wyglądałaby na zwrot zgłoszony przez klienta, a to inna
       sprawa: klient niczego nie zgłaszał, przesyłka wróciła sama. */
    render(<Kolejka wybrany={null} onWybierz={() => {}} zwroty={[zwrot({
      zrodlo: "nieodebrana", numer: null, externalId: "nieodebrana:AD00R28X72" })]} />);
    expect(screen.getByText("nieodebrana")).toBeInTheDocument();
    expect(screen.getByText("AD00R28X72")).toBeInTheDocument();
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
    expect(screen.queryByText("nie nadana")).not.toBeInTheDocument();
  });

  it("sygnały mają podpis, nie tylko barwę", () => {
    render(<Kolejka zwroty={[zwrot({ sygnaly: ["termin", "brak_dowodu"] })]}
      wybrany={null} onWybierz={() => {}} />);
    expect(screen.getByText("termin")).toBeInTheDocument();
    expect(screen.getByText("nie nadana")).toBeInTheDocument();
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
  it("mówi wprost, czego nie pobiera", () => {
    /* Zdanie, które musi być na ekranie, a nie tylko w kodzie. Bliźniacze —
       o nieznanej kwocie pełnej — przeniosło się w 0.167.0 razem z pozycjami
       do środkowej kolumny (`Pozycje.test.tsx`). */
    render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText(/Danych nadawcy i konta bankowego nie pobieramy/)).toBeInTheDocument();
  });

  it("brak paczki jest zdaniem, nie pustym polem", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ paczkaAt: null })} />));
    /* Od 0.169.0 zdanie mówi PRAWDĘ: Allegro podaje datę nadania paczki przez
       klienta, a nie datę jej doręczenia do nas. Wcześniejsze „towar jeszcze
       nie wrócił" twierdziło coś, czego nie wiemy. */
    expect(screen.getByText(/Klient nie nadał jeszcze paczki/)).toBeInTheDocument();
  });

  it("zamówienie niesie metodę dostawy, bo to ona kosztuje", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE, kwotaPelnaGrosze: 6498 })} />));
    expect(screen.getByText(/Kurier InPost/)).toBeInTheDocument();
  });

  it("pokazuje CAŁE zamówienie i zaznacza, co wraca", () => {
    /* „Kupił trzy, oddaje jedną" jest kontekstem decyzji, nie ciekawostką. */
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE })} />));
    /* Od 0.167.0 zwracane pozycje stoją w środkowej kolumnie, więc TUTAJ
       Sekator jest raz — na liście zamówienia. Kontekst „kupił trzy, oddaje
       jedną" niesie znacznik „wraca" przy jego wierszu. */
    expect(screen.getAllByText("Sekator NAC")).toHaveLength(1);
    expect(screen.getByText("Zraszacz obrotowy")).toBeInTheDocument();
    expect(screen.getAllByText("wraca 1")).toHaveLength(1);
  });

  /* ZGŁOSZENIE WŁAŚCICIELA (0.176.0): „wraca dwie sztuki jest mylące, bo w tym
     zamówieniu wracała jedna". Plakietka stała obok liczby KUPIONYCH sztuk,
     więc „2 × 18,99 wraca" czytało się jako liczbę wracających. */
  it("przy zwrocie części zakupu plakietka mówi ile z ilu", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: { ...ZAMOWIENIE, pozycje: [
      { offerId: "111", nazwa: "Uchwyt do kosy", sku: "50-025", ilosc: 2,
        cenaGrosze: 1899, waluta: "PLN", zwracana: true, wracaIlosc: 1 },
    ] } })} />));
    expect(screen.getByText("wraca 1 z 2")).toBeInTheDocument();
    /* Liczba kupionych sztuk NIE znika — to ona mówi, ile klient ma u siebie. */
    expect(screen.getByText("2 × 18,99 PLN")).toBeInTheDocument();
  });

  /* ZGŁOSZENIE WŁAŚCICIELA (0.176.0): „dokument sprzedaży powinien być
     w zamówieniu". Stał osobną sekcją na DNIE kolumny, pod wiadomościami. */
  it("numer dokumentu sprzedaży stoi w sekcji zamówienia", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE, faktura: {
      dokId: 7, numer: "PA 11945/MAG/08/2026", typ: "PA", zrodlo: "numer",
      at: "2026-09-01T10:00:00Z", przez: null } })} onFaktura={vi.fn()} />));
    const sekcja = screen.getByRole("heading", { name: /Zamówienie/i })
      .closest("section")!;
    expect(within(sekcja).getByText("PA 11945/MAG/08/2026")).toBeInTheDocument();
  });

  it("przy zwrocie całości plakietka nie dopisuje »z ilu«", () => {
    /* „wraca 2 z 2" byłoby szumem: nic u klienta nie zostaje. */
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: { ...ZAMOWIENIE, pozycje: [
      { offerId: "111", nazwa: "Uchwyt do kosy", sku: "50-025", ilosc: 2,
        cenaGrosze: 1899, waluta: "PLN", zwracana: true, wracaIlosc: 2 },
    ] } })} />));
    expect(screen.getByText("wraca 2")).toBeInTheDocument();
  });

  it("bez pobranego zamówienia pokazuje identyfikator i mówi, że treść dojdzie", () => {
    render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText("ord-1")).toBeInTheDocument();
    expect(screen.getByText(/dociągnie ją najbliższa synchronizacja/)).toBeInTheDocument();
  });

  it("odnośnik zamówienia wychodzi w nowej karcie i nie wynosi naszego adresu", () => {
    /* Numer zwrotu i login kupującego przeprowadziły się w 0.207.0 do
       nagłówka sprawy — pilnuje ich `Naglowek.test.tsx`. Tutaj zostaje to,
       co dalej należy do prawej kolumny. */
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE })} />));
    const link = screen.getByRole("link", { name: /Otwórz w Allegro/ });
    expect(link).toHaveAttribute("href", "https://allegro.pl/moje-allegro/zam/ord-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("przewoźnik stoi przy PACZCE, nie przy zwrocie jako sprawie", () => {
    /* Mówi o tym, czym paczka jedzie — a nie o zwrocie. Do 0.206.0 stał
       w sekcji „Zwrot" razem z numerem i loginem, które już tam nie stoją. */
    render(zKlientem(<Dowody zwrot={zwrot({ przewoznik: "INPOST" })} />));
    expect(screen.getByText(/Przewoźnik: InPost/)).toBeInTheDocument();
  });

  it("nieznany przewoźnik pokazuje się surowy, bo Allegro nie zamyka listy", () => {
    /* Sonda złapała `UNKNOWN`, którego nie ma w żadnej specyfikacji. */
    render(zKlientem(<Dowody zwrot={zwrot({ przewoznik: "JAKAS_FIRMA" })} />));
    expect(screen.getByText(/JAKAS_FIRMA/)).toBeInTheDocument();
  });

  it("płatność i rodzaj dokumentu stoją przy zamówieniu", () => {
    /* Przy pobraniu nie ma karty, na którą oddać pieniądze — to nie jest
       ciekawostka, tylko warunek zwrotu. */
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: { ...ZAMOWIENIE,
      platnoscTyp: "CASH_ON_DELIVERY", fakturaZadana: true } })} />));
    expect(screen.getByText("za pobraniem")).toBeInTheDocument();
    /* „Klient chciał faktury", nie „Dokument: faktura" — to samo słowo
       tytułowało niżej numer paragonu z Subiekta i wiersze się myliły. */
    expect(screen.getByText("Klient chciał")).toBeInTheDocument();
    expect(screen.getByText("faktury")).toBeInTheDocument();
  });

  it("brak informacji o fakturze mówi »nie wiadomo«, a nie »paragon«", () => {
    /* Paragon wpisany na ślepo kazałby wystawić niewłaściwą korektę. */
    render(zKlientem(<Dowody zwrot={zwrot({ zamowienie: ZAMOWIENIE })} />));
    expect(screen.getByText("nie wiadomo")).toBeInTheDocument();
  });

  it("data paczki to data NADANIA, a doręczenie ma własną datę", () => {
    /* Dwie nieprawdy po kolei. Do 0.167.0 ekran pisał przy dacie nadania
       „Wróciła". Do 0.186.0 pisał „Allegro nie podaje daty doręczenia do nas"
       — a podaje, w `/order/carriers/{id}/tracking`. */
    render(zKlientem(<Dowody zwrot={zwrot({
      dostarczonoAt: "2026-08-24T10:41:00Z", przesylkaStatus: "DELIVERED" })} />));
    expect(screen.getByText(/Nadana przez klienta/)).toBeInTheDocument();
    expect(screen.getByText(/Doręczona do nas/)).toBeInTheDocument();
    expect(screen.queryByText(/nie podaje daty doręczenia/)).toBeNull();
    expect(screen.queryByText(/Wróciła/)).toBeNull();
  });

  it("paczka w drodze mówi o sobie kodem przewoźnika po polsku", () => {
    /* „Jeszcze nie dotarła" to inna informacja niż „awizo": pierwsza mówi
       czekaj, druga — że klient ma problem z doręczeniem. */
    const { rerender } = render(zKlientem(<Dowody zwrot={zwrot({
      przesylkaStatus: "IN_TRANSIT" })} />));
    expect(screen.getByText(/W drodze do nas/)).toBeInTheDocument();

    rerender(zKlientem(<Dowody zwrot={zwrot({ przesylkaStatus: "NOTICE_LEFT" })} />));
    expect(screen.getByText(/Awizo/)).toBeInTheDocument();
  });

  it("nieznany kod przewoźnika pokazuje się SUROWY, nie znika", () => {
    /* Ta sama zasada co przy `carrierId`: lista nie jest zamknięta, a sonda
       złapała już wartość spoza specyfikacji. */
    render(zKlientem(<Dowody zwrot={zwrot({ przesylkaStatus: "COS_NOWEGO" })} />));
    expect(screen.getByText(/COS_NOWEGO/)).toBeInTheDocument();
  });

  it("brak wiedzy o przesyłce mówi o sobie, zamiast orzekać, że nie dotarła", () => {
    /* TRZECIA NIEPRAWDA W TEJ SEKCJI (0.188.0). Stało tu „Jeszcze do nas nie
       dotarła" — zdanie twierdzące stawiane wtedy, gdy przewoźnik nie
       powiedział NIC. Ekran ma przyznać, że nie wie, a nie zgadywać: paczka
       leżąca w magazynie od trzech dni wyglądała tak samo jak zaginiona. */
    render(zKlientem(<Dowody zwrot={zwrot({
      dostarczonoAt: null, przesylkaStatus: null })} />));
    expect(screen.getByText(/Nie wiadomo, czy dotarła/)).toBeInTheDocument();
    expect(screen.queryByText(/Jeszcze do nas nie dotarła/)).toBeNull();
  });

  it("paczka nieodebrana nie była NADANA PRZEZ KLIENTA — wróciła sama", () => {
    /* Klient jej właśnie nie odebrał, więc niczego nie nadawał (0.172.0),
       a `paczkaAt` jest przy niej chwilą, w której biuro wpisało karton do
       kolejki. Ta paczka jest u nas na pewno — i tak ma się pokazywać. */
    render(zKlientem(<Dowody zwrot={zwrot({
      zrodlo: "nieodebrana", paczkaAt: "2026-08-28T09:00:00.000Z",
      dostarczonoAt: "2026-08-28T09:00:00.000Z" })} />));
    expect(screen.getByText(/Wróciła nieodebrana/)).toBeInTheDocument();
    expect(screen.queryByText(/Nadana przez klienta/)).toBeNull();
    expect(screen.getByText(/Doręczona do nas/)).toBeInTheDocument();
  });

  it("wiadomości o zakupie prowadzą do skrzynki, a ich brak mówi o sobie", () => {
    /* Puste znaczy „Allegro nic nie powiązało", nie „klient nie pisał":
       Allegro oznacza zamówieniem tylko część wiadomości. */
    const { rerender } = render(zKlientem(<Dowody zwrot={zwrot()} />));
    expect(screen.getByText(/nie powiązało z tym zamówieniem żadnej wiadomości/))
      .toBeInTheDocument();

    rerender(zKlientem(<Dowody zwrot={zwrot({ rozmowy: [
      { id: 7, temat: "Kiedy zwrot pieniędzy?", status: "open",
        ostatniaAt: "2026-09-01T10:00:00.000Z" }] })} />));
    const link = screen.getByRole("link", { name: /Kiedy zwrot pieniędzy/ });
    expect(link).toHaveAttribute("href", "/obsluga/skrzynka/7");
  });

  it("rozmowa bez tematu dostaje nazwę, a nie pusty odnośnik", () => {
    render(zKlientem(<Dowody zwrot={zwrot({ rozmowy: [
      { id: 8, temat: "  ", status: "new", ostatniaAt: null }] })} />));
    expect(screen.getByRole("link", { name: /Rozmowa bez tematu/ })).toBeInTheDocument();
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
