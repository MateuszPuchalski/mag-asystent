import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pozycje } from "./Pozycje";
import type { PozycjaZwrotu, Zwrot } from "../api/typy";

/* ── Produkty ze zwrotu (0.167.0) ────────────────────────────────────────────
   Do 0.165.0 pozycje stały w prawej kolumnie, a kubełki DO OCENY i DO ZWROTU
   wypisywały te same nazwy drugi raz, jako gołe kontrolki. Operator oceniał
   towar, patrząc na listę, która towaru nie pokazywała. Te testy pilnują, że
   akcja i produkt są w JEDNYM wierszu. */

const POZYCJA = (n: Partial<PozycjaZwrotu> = {}): PozycjaZwrotu => ({
  id: 11, offerId: "of-1", nazwa: "Szarpak", ilosc: 1, cenaGrosze: 4999,
  waluta: "PLN", powod: null, powodKomentarz: null, ocena: null, url: null,
  twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
  rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
    prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null },
  ...n,
});

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "z-1", numer: "REF-1", orderId: "ord-1",
  utworzono: "2026-09-01T08:00:00Z", paczkaAt: null, kubelek: "decyzja",
  sygnaly: [], terminAt: "2026-09-15T08:00:00Z", dniDoTerminu: 14,
  sumaPozycjiGrosze: 9998, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, werdykt: null, kwotaGrosze: null, kwotaWariant: null,
  zrodlo: "allegro", notatka: null, kupujacyLogin: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  korektaNumer: null, rejectionCode: null, wersja: 3,
  zamowienie: { externalId: "ord-1", status: null, kupujacyLogin: null,
    dostawaGrosze: 1500, dostawaMetoda: "InPost", platnoscTyp: null, platnoscAt: null, fakturaZadana: null, sumaGrosze: 11498,
    waluta: "PLN", kupionoAt: null, link: null, pozycje: [] },
  pozycje: [POZYCJA(), POZYCJA({ id: 12, offerId: "of-2", nazwa: "Filtr" })],
  ...n,
});

const lista = (z: Zwrot, h: Partial<Parameters<typeof Pozycje>[0]> = {}) => {
  const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { klient, ...render(<QueryClientProvider client={klient}>
    <Pozycje zwrot={z} trwa={false} blad="" onOcena={vi.fn()} onKwota={vi.fn()} {...h} />
  </QueryClientProvider>) };
};

describe("Produkty ze zwrotu", () => {
  it("wiersz niesie towar, powód i drogę do oferty", () => {
    lista(zwrot({ sumaPozycjiGrosze: 12345, pozycje: [POZYCJA({ powod: "DAMAGED", ilosc: 2,
      url: "https://allegro.pl/oferta/szarpak-1" })] }));
    expect(screen.getByText("Szarpak")).toBeInTheDocument();
    /* Powód po polsku, nie kodem Allegro — wiersz ma się czytać w biegu. */
    expect(screen.getByText(/towar uszkodzony/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zobacz ofertę/ }))
      .toHaveAttribute("href", "https://allegro.pl/oferta/szarpak-1");
    /* Cena razy ilość, bo tyle wraca — nie cena jednostkowa. */
    expect(screen.getByText("99,98 PLN")).toBeInTheDocument();
  });

  it("brak adresu oferty mówi o sobie, zamiast milczeć", () => {
    /* Milczenie wygląda na usterkę panelu, a jest brakiem danych z Allegro. */
    lista(zwrot({ pozycje: [POZYCJA()] }));
    expect(screen.getByText(/Allegro nie podało adresu oferty/)).toBeInTheDocument();
  });

  it("ocena stoi PRZY towarze, nie obok listy nazw", async () => {
    const onOcena = vi.fn();
    lista(zwrot({ kubelek: "ocena", pozycje: [POZYCJA()] }), { onOcena });
    await userEvent.click(screen.getByRole("button", { name: /Na przecenę/ }));
    expect(onOcena).toHaveBeenCalledWith(11, "przecena");
  });

  it("oceniona pozycja pokazuje ocenę zamiast pytać drugi raz", () => {
    lista(zwrot({ kubelek: "ocena", pozycje: [POZYCJA({ ocena: "stan" })] }));
    expect(screen.getByText(/Ocena: Na stan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Utylizacja/ })).toBeNull();
  });

  it("ocena jest faktem o pozycji, więc widać ją w każdym kubełku", () => {
    lista(zwrot({ kubelek: "korekta", pozycje: [POZYCJA({ ocena: "utylizacja" })] }));
    expect(screen.getByText(/Ocena: Utylizacja/)).toBeInTheDocument();
  });

  it("kwota: zaznaczone pozycje i dostawa SUMUJĄ SIĘ na podglądzie", async () => {
    const onKwota = vi.fn();
    lista(zwrot({ kubelek: "zwrot" }), { onKwota });

    /* Pozycje startują zaznaczone — to one wracają. Dostawa nie, bo o niej
       decyduje człowiek. */
    expect(screen.getByTestId("suma")).toHaveTextContent("99,98");

    await userEvent.click(screen.getByLabelText(/Koszt dostawy/));
    expect(screen.getByTestId("suma")).toHaveTextContent("114,98");

    await userEvent.click(screen.getByLabelText("Oddaj: Filtr"));
    expect(screen.getByTestId("suma")).toHaveTextContent("64,99");

    await userEvent.click(screen.getByRole("button", { name: /Zapisz kwotę/ }));
    expect(onKwota).toHaveBeenCalledWith([11], true);
  });

  it("podgląd sumy nie jest tym, co się zapisuje — panel wysyła ZAZNACZENIE", async () => {
    /* §25a.3: liczy serwer. Gdyby panel wysyłał liczbę, dałoby się zapisać
       dowolną kwotę z pominięciem ekranu. */
    const onKwota = vi.fn();
    lista(zwrot({ kubelek: "zwrot" }), { onKwota });
    await userEvent.click(screen.getByRole("button", { name: /Zapisz kwotę/ }));

    const [pozycje, dostawa] = onKwota.mock.calls[0];
    expect(pozycje).toEqual([11, 12]);
    expect(dostawa).toBe(false);
    expect(onKwota.mock.calls[0]).toHaveLength(2);
  });

  it("bez zamówienia nie ma czego oddać za dostawę", () => {
    lista(zwrot({ kubelek: "zwrot", zamowienie: null }));
    expect(screen.queryByLabelText(/Koszt dostawy/)).toBeNull();
  });

  it("poza wyceną nie ma czego odhaczać", () => {
    /* Pole zaznaczenia w kubełku DO DECYZJI obiecywałoby wybór, którego
       na tym etapie nikt nie zapisuje. */
    lista(zwrot());
    expect(screen.queryByLabelText(/^Oddaj:/)).toBeNull();
    expect(screen.getByText("Suma pozycji")).toBeInTheDocument();
  });

  it("kwoty pełnej bez zamówienia ekran nie zgaduje", () => {
    lista(zwrot());
    expect(screen.getByText(/Kwoty pełnej nie znamy bez zamówienia/)).toBeInTheDocument();
  });

  it("przy wycenie nie ma dwóch liczb o pieniądzach naraz", () => {
    /* „Suma pozycji" nad „Do oddania" czyta się jak jedna liczba, a myli się
       tę, która idzie do klienta. */
    lista(zwrot({ kubelek: "zwrot" }));
    expect(screen.queryByText("Suma pozycji")).toBeNull();
    expect(screen.getByText("Do oddania")).toBeInTheDocument();
  });

  it("komentarz klienta zostaje w cudzysłowie, powód po polsku", () => {
    lista(zwrot({ pozycje: [POZYCJA({ powod: "DONT_LIKE_IT",
      powodKomentarz: "za ciężki" })] }));
    expect(screen.getByText(/nie spodobał się/)).toBeInTheDocument();
    expect(screen.getByText(/za ciężki/)).toBeInTheDocument();
  });

  it("kartoteka zawsze niesie źródło: zatwierdzona, proponowana albo żadna", () => {
    /* §11.3 żąda widocznego źródła i pewności, a §4.3 nie pozwala, żeby wybór
       automatu udawał fakt z Allegro. */
    const { rerender, klient } = lista(zwrot({ pozycje: [POZYCJA()] }));
    expect(screen.getByText(/Bez kartoteki/)).toBeInTheDocument();

    const znowu = (z: Zwrot) => rerender(<QueryClientProvider client={klient}>
      <Pozycje zwrot={z} trwa={false} blad="" onOcena={vi.fn()} onKwota={vi.fn()} />
    </QueryClientProvider>);

    znowu(zwrot({ pozycje: [POZYCJA({ propozycja: { pewnosc: "sku", twId: 10,
      symbol: "SEK-46", zrodlo: 'SKU oferty „SEK-46"', powod: null,
      poKolumnie: "offer_id" } })] }));
    /* Propozycja czeka na JEDNO kliknięcie i mówi, skąd się wzięła. */
    expect(screen.getByRole("button", { name: /Zatwierdź/ })).toBeInTheDocument();
    expect(screen.getByText("SEK-46")).toBeInTheDocument();
    expect(screen.getByText(/SKU oferty/)).toBeInTheDocument();

    znowu(zwrot({ pozycje: [POZYCJA({ twId: 10, twSymbol: "SEK-46", twZrodlo: "reczne" })] }));
    expect(screen.getByText(/wskazana ręcznie/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zatwierdź/ })).not.toBeInTheDocument();
  });

  it("propozycja z pamięci wskazań też czeka na JEDNO kliknięcie", () => {
    /* Warunek przycisku stoi na `twId`, nie na jednej wartości pewności.
       Propozycja z pamięci jest tą najpewniejszą — stoi za nią człowiek —
       a do 0.153.1 jako jedyna nie dostawała przycisku. */
    lista(zwrot({ pozycje: [POZYCJA({ propozycja: { pewnosc: "pamiec", twId: 10,
      symbol: "SEK-46", zrodlo: "Wskazane wcześniej przez: Ala", powod: null,
      poKolumnie: null } })] }));
    expect(screen.getByRole("button", { name: /Zatwierdź/ })).toBeInTheDocument();
    expect(screen.getByText(/Wskazane wcześniej przez/)).toBeInTheDocument();
  });

  it("brak kartoteki niesie POWÓD, a nie samo »Bez kartoteki«", () => {
    /* Sześć różnych zerwań łańcucha wyglądało do 0.153.1 identycznie
       i operator nie miał jak odróżnić braku danych od usterki kodu. */
    lista(zwrot({ pozycje: [POZYCJA({ propozycja: { pewnosc: "brak", twId: null,
      symbol: null, zrodlo: "Oferta bez SKU w Allegro (pole „sygnatura”)",
      powod: "oferta_bez_sku", poKolumnie: null } })] }));
    expect(screen.getByText(/Oferta bez SKU w Allegro/)).toBeInTheDocument();
  });

  it("kody towaru: EAN z kartoteki, SKU sprzedawcy", () => {
    /* Pracownik szuka po nich towaru na półce i w Subiekcie. Allegro EAN-u
       przy zwrocie nie podaje wcale — kod wisi przy kartotece. */
    lista(zwrot({ pozycje: [POZYCJA({ ean: "5901234123457", sku: "SEK-46" })] }));
    expect(screen.getByText("5901234123457")).toBeInTheDocument();
    expect(screen.getByText("SEK-46")).toBeInTheDocument();
  });

  it("bez kodów wiersz nie pokazuje pustych etykiet", () => {
    lista(zwrot({ pozycje: [POZYCJA()] }));
    expect(screen.queryByText("EAN")).toBeNull();
    expect(screen.queryByText("SKU")).toBeNull();
  });

  it("powód spoza jedenastu zaobserwowanych też ma polską nazwę", () => {
    /* Schemat Allegro wymienia siedemnaście wartości, sonda zaobserwowała
       jedenaście — do 0.167.0 pozostałe sześć szło na ekran surowym kodem. */
    lista(zwrot({ pozycje: [POZYCJA({ powod: "ORDERED_FOR_COMPARISON" })] }));
    expect(screen.getByText(/zamówiony na przymiarkę/)).toBeInTheDocument();
  });

  it("kod, którego nie znamy, pokazuje się surowy zamiast znikać", () => {
    /* `reason.type` nie ma w specyfikacji enuma, więc lista nigdy nie będzie
       zamknięta — a cicho gubiony powód jest gorszy od brzydkiego. */
    lista(zwrot({ pozycje: [POZYCJA({ powod: "COS_NOWEGO" })] }));
    expect(screen.getByText(/COS_NOWEGO/)).toBeInTheDocument();
  });

  it("potrącenie obniża podgląd sumy tak samo, jak obniży go serwer", async () => {
    /* Inaczej operator widziałby jedną liczbę, a klient dostawał inną. */
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ potracenieGrosze: 2000, potraceniePowod: "ślady użycia" }),
      POZYCJA({ id: 12, nazwa: "Filtr" })] }), { onPotracenie: vi.fn() });
    /* Dwie pozycje po 49,99 to 99,98; minus dwadzieścia złotych potrącenia. */
    expect(screen.getByTestId("suma")).toHaveTextContent("79,98");
  });

  it("propozycja potrącenia stoi przy WYCENIE, bo tam zapada decyzja o pieniądzach", () => {
    const onPotracenie = vi.fn();
    const { rerender, klient } = lista(zwrot({ pozycje: [POZYCJA()] }), { onPotracenie });
    expect(screen.queryByRole("button", { name: /oddaj mniej/ })).toBeNull();

    rerender(<QueryClientProvider client={klient}>
      <Pozycje zwrot={zwrot({ kubelek: "zwrot", pozycje: [POZYCJA()] })} trwa={false} blad=""
        onOcena={vi.fn()} onKwota={vi.fn()} onPotracenie={onPotracenie} />
    </QueryClientProvider>);
    expect(screen.getByRole("button", { name: /oddaj mniej/ })).toBeInTheDocument();
  });

  it("zapisane potrącenie widać w KAŻDYM kubełku, bo to fakt o pozycji", () => {
    /* Tak samo jak ocenę hali — po zamknięciu zwrotu trzeba umieć powiedzieć,
       czemu klient dostał mniej. */
    lista(zwrot({ kubelek: "korekta", pozycje: [
      POZYCJA({ potracenieGrosze: 1500, potraceniePowod: "brak opakowania" })] }),
      { onPotracenie: vi.fn() });
    expect(screen.getByText(/Potrącenie −15,00/)).toBeInTheDocument();
    expect(screen.getByText(/brak opakowania/)).toBeInTheDocument();
  });

  it("zwrot bez pozycji mówi to wprost", () => {
    lista(zwrot({ pozycje: [] }));
    expect(screen.getByText(/Zwrot bez pozycji/)).toBeInTheDocument();
  });

  it("odmowa serwera ląduje przy przyciskach, które ją wywołały", () => {
    lista(zwrot({ kubelek: "zwrot" }), { blad: "Zwrot zmienił się w innej karcie" });
    expect(screen.getByText(/zmienił się w innej karcie/)).toBeInTheDocument();
  });
});
