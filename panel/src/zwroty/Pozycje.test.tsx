import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pozycje } from "./Pozycje";
import type { PozycjaZwrotu, Zwrot } from "../api/typy";

/* Ptaszek przy składniku woła serwer (0.335.0). Podstawiamy sam hook, a nie
   `fetch`: test pilnuje, CO panel wysyła, a nie jak wygląda żądanie — od tego
   jest `api/klient.test.ts`. */
const zaznacz = vi.fn();
const wskaz = vi.fn();
const potwierdz = vi.fn(async (_v: { pozycjaId: number; twId: number | null; zrodlo: string }) => ({}));
/* Otwarte pudła — przy kilku ocena pyta, do którego (0.379.0). Stan jest
   zmienny, bo każdy test ustawia swoją liczbę kartonów przy biurku. */
const pudla: { kosze: Array<{ id: number; kod: string; rodzaj: "zwroty" | "odpad" }> } = {
  kosze: [],
};
vi.mock("../api/zwroty", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useZaznaczSkladnik: () => ({ mutate: zaznacz, isPending: false, error: null }),
  useWskazSklad: () => ({ mutate: wskaz, isPending: false, error: null }),
  useKosz: () => ({ data: pudla }),
  usePotwierdzKartoteke: () => ({ mutate: vi.fn(), mutateAsync: potwierdz, isPending: false, error: null }),
}));

/* ── Produkty ze zwrotu (0.167.0) ────────────────────────────────────────────
   Do 0.165.0 pozycje stały w prawej kolumnie, a kubełki DO OCENY i DO ZWROTU
   wypisywały te same nazwy drugi raz, jako gołe kontrolki. Operator oceniał
   towar, patrząc na listę, która towaru nie pokazywała. Te testy pilnują, że
   akcja i produkt są w JEDNYM wierszu. */

const POZYCJA = (n: Partial<PozycjaZwrotu> = {}): PozycjaZwrotu => ({
  id: 11, zrodlo: "allegro", offerId: "of-1", ofertaZamowienia: null, ofertaZdjecie: "nieznane" as const, nazwa: "Szarpak", ilosc: 1, cenaGrosze: 4999,
  waluta: "PLN", powod: null, powodKomentarz: null, ocena: null, wKoszyku: false, iloscZwrocona: null, url: null,
  twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
  rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
    prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null },
  ...n,
});

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "z-1", numer: "REF-1", orderId: "ord-1",
  utworzono: "2026-09-01T08:00:00Z", paczkaAt: null, dostarczonoAt: null, przesylkaStatus: null, statusAllegro: null, rozliczonyAllegroAt: null, waybill: null, kubelek: "decyzja",
  sygnaly: [], terminAt: "2026-09-15T08:00:00Z", dniDoTerminu: 14,
  sumaPozycjiGrosze: 9998, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, werdykt: null, werdyktPowod: null, kwotaGrosze: null, kwotaWariant: null, zrodlo: "allegro",
  notatka: null, notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, kupujacyLogin: null, odbiorcaNazwa: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  korektaNumer: null, korektaZrodlo: null, rejectionCode: null, wersja: 3,
  zamowienie: { externalId: "ord-1", status: null, kupujacyLogin: null,
    dostawaGrosze: 1500, dostawaMetoda: "InPost", platnoscTyp: null, platnoscAt: null, fakturaZadana: null, sumaGrosze: 11498,
    waluta: "PLN", kupionoAt: null, link: null, pozycje: [] },
  pozycje: [POZYCJA(), POZYCJA({ id: 12, zrodlo: "allegro", offerId: "of-2", nazwa: "Filtr" })],
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
    /* Od 0.455.0 krótko na ekranie, całe zdanie w podpowiedzi — ale dalej
       słowem, nie ciszą. */
    expect(screen.getByText("bez adresu oferty"))
      .toHaveAttribute("title", "Allegro nie podało adresu oferty");
  });

  it("ocena stoi PRZY towarze, nie obok listy nazw", async () => {
    const onOcena = vi.fn();
    lista(zwrot({ kubelek: "ocena", pozycje: [POZYCJA()] }), { onOcena });
    await userEvent.click(screen.getByRole("button", { name: /Utylizacja/ }));
    expect(onOcena).toHaveBeenCalledWith(11, "utylizacja");
  });

  it("oceny są DWIE — przecena zeszła razem z martwą ścieżką", () => {
    /* 0.209.0: „Na przecenę" zapisywała się i na tym się kończyła. Przycisk,
       który wygląda jak decyzja, a nie jest żadną, kosztuje namysł przy każdej
       pozycji — a to jest najczęściej naciskane miejsce tego ekranu. */
    lista(zwrot({ kubelek: "ocena", pozycje: [POZYCJA()] }));
    expect(screen.getByRole("button", { name: /Na stan/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Utylizacja/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /przecen/i })).toBeNull();
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

  it("PRZEŁĄCZENIE ZWROTU nie zabiera zaznaczenia ze starego", async () => {
    /* Zgłoszenie z 4 września: zwrot 1MGJ/2026 pokazywał poprawne 36,00 PLN,
       a serwer odbijał zapis („Pozycje 3742 nie należą do tego zwrotu").
       Panel szedł z identyfikatorami POPRZEDNIO oglądanego zwrotu: podgląd
       sumy filtruje po `zwrot.pozycje`, więc rozjazdu nie było na ekranie
       widać. Ten test przełącza zwrot BEZ odmontowania listy — dokładnie tak,
       jak robi to kliknięcie w kolejce. */
    const onKwota = vi.fn();
    const { klient, rerender } = lista(zwrot({ kubelek: "zwrot" }), { onKwota });

    const drugi = zwrot({ id: 2, kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 3742, nazwa: "Pistolet", cenaGrosze: 3600 }),
    ] });
    rerender(<QueryClientProvider client={klient}>
      <Pozycje zwrot={drugi} trwa={false} blad="" onOcena={vi.fn()} onKwota={onKwota} />
    </QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: /Zapisz kwotę/ }));
    expect(onKwota).toHaveBeenCalledWith([3742], false);
  });

  it("pozycja ZDJĘTA ze zwrotu znika z zaznaczenia sama", async () => {
    /* Ta sama wada przy JEDNYM zwrocie: „zdejmij ze zwrotu" i takt
       synchronizacji skracają listę pod komponentem. Martwy identyfikator
       w zaznaczeniu odbiłby zapis tak samo. */
    const onKwota = vi.fn();
    const { klient, rerender } = lista(zwrot({ kubelek: "zwrot" }), { onKwota });

    const krotszy = zwrot({ kubelek: "zwrot", pozycje: [POZYCJA({ id: 11 })] });
    rerender(<QueryClientProvider client={klient}>
      <Pozycje zwrot={krotszy} trwa={false} blad="" onOcena={vi.fn()} onKwota={onKwota} />
    </QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: /Zapisz kwotę/ }));
    expect(onKwota).toHaveBeenCalledWith([11], false);
  });

  it("pozycja DOPISANA przez biuro wchodzi ZAZNACZONA, nie wypada z kwoty", async () => {
    /* Cichsza połowa tej samej wady. Serwer odrzuca nadmiar identyfikatorów,
       ale NIGDY braku — dopisana pozycja niezaznaczona kosztowałaby klienta
       pieniądze bez jednego komunikatu na ekranie. */
    const onKwota = vi.fn();
    const { klient, rerender } = lista(zwrot({ kubelek: "zwrot" }), { onKwota });

    const dluzszy = zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 11 }), POZYCJA({ id: 12, nazwa: "Filtr" }),
      POZYCJA({ id: 13, nazwa: "Wąż" }),
    ] });
    rerender(<QueryClientProvider client={klient}>
      <Pozycje zwrot={dluzszy} trwa={false} blad="" onOcena={vi.fn()} onKwota={onKwota} />
    </QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: /Zapisz kwotę/ }));
    expect(onKwota).toHaveBeenCalledWith([11, 12, 13], false);
  });

  it("ocenę DA SIĘ COFNĄĆ — inaczej pomyłka zostaje na wierszu na zawsze", async () => {
    /* §25a.5. Do 0.202.0 przyciski oceny znikały po pierwszym kliknięciu
       (`ocenianie && !p.ocena`), a serwer cofnięcie przyjmował od 0.192.0 —
       brakowało wyłącznie klawisza. */
    const onOcena = vi.fn();
    lista(zwrot({ kubelek: "ocena", pozycje: [POZYCJA({ id: 11, ocena: "utylizacja" })] }),
      { onOcena });

    await userEvent.click(screen.getByRole("button", { name: /cofnij ocenę/i }));
    expect(onOcena).toHaveBeenCalledWith(11, null);
  });

  it("na zwrocie ZAMKNIĘTYM cofnięcia oceny nie ma — serwer i tak odmówi", () => {
    /* Przycisk, po którym zawsze przychodzi błąd, jest gorszy niż jego brak:
       uczy ignorować komunikaty. */
    lista(zwrot({ kubelek: "zamkniety", pozycje: [POZYCJA({ id: 11, ocena: "stan" })] }));
    expect(screen.getByText(/Ocena: Na stan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cofnij ocenę/i })).toBeNull();
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

  it("pewne kartoteki zatwierdza JEDEN ruch, zgadywane zostają przy pozycji (0.479.0)", async () => {
    /* `sku` i `pamiec` idą hurtem; `jedyna_pozycja` to zgadywanie, a pomyłka
       kartoteki wraca towarem na złej półce — ta zostaje pod okiem. */
    potwierdz.mockClear();
    const prop = (pewnosc: "sku" | "pamiec" | "jedyna_pozycja", twId: number) =>
      ({ pewnosc, twId, symbol: `S-${twId}`, zrodlo: "x", powod: null, poKolumnie: null });
    lista(zwrot({ pozycje: [
      POZYCJA({ id: 1, propozycja: prop("sku", 10) }),
      POZYCJA({ id: 2, propozycja: prop("pamiec", 20) }),
      POZYCJA({ id: 3, propozycja: prop("jedyna_pozycja", 30) }),
    ] }));
    await userEvent.click(screen.getByRole("button", { name: /Zatwierdź pewne kartoteki \(2\)/ }));
    expect(potwierdz.mock.calls.map(([v]) => v)).toEqual([
      { pozycjaId: 1, twId: 10, zrodlo: "sku" },
      { pozycjaId: 2, twId: 20, zrodlo: "sku" },
    ]);
  });

  it("jedna pewna propozycja nie dostaje drugiego przycisku o tym samym znaczeniu", () => {
    lista(zwrot({ pozycje: [POZYCJA({ propozycja: { pewnosc: "sku", twId: 10,
      symbol: "SEK-46", zrodlo: "x", powod: null, poKolumnie: null } })] }));
    expect(screen.queryByRole("button", { name: /Zatwierdź pewne/ })).toBeNull();
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
    /* Od 0.455.0 etykietę zastępuje ikona, ale nazwa kodu nie ginie:
       stoi w podpowiedzi i w tekście dla czytnika ekranu. */
    expect(screen.getByTitle("EAN")).toHaveTextContent("EAN 5901234123457");
    expect(screen.getByTitle("SKU oferty")).toHaveTextContent("SKU SEK-46");
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

describe("Zwrot z korektą jest tylko do odczytu (0.484.6)", () => {
  it("nie ma cofania oceny, zdejmowania ani dopisywania — serwer by odmówił", () => {
    /* Zapis korekty stawia `zamkniety_at`, a `podKlucz` odmawia każdej zmiany
       — także w DO ZWROTU, gdzie zwrot z korektą czeka na pieniądze. */
    lista(zwrot({ kubelek: "zwrot", kwotaGrosze: 4999, korektaNumer: "ZW 1/2026",
      pozycje: [POZYCJA({ ocena: "stan", zrodlo: "biuro" })] }),
      { onZdejmij: vi.fn(), onDopisz: vi.fn(),
        doDopisania: [{ zamPozycjaId: 1, offerId: "9", ofertaZdjecie: "nieznane", nazwa: "Grabie",
          ilosc: 1, cenaGrosze: 100, waluta: "PLN" }] });
    expect(screen.queryByRole("button", { name: /cofnij ocenę/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /zdejmij ze zwrotu/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /przysłał więcej/ })).toBeNull();
  });

  it("bez korekty te same przyciski stoją", () => {
    lista(zwrot({ kubelek: "ocena", pozycje: [POZYCJA({ ocena: "stan", zrodlo: "biuro" })] }),
      { onZdejmij: vi.fn() });
    expect(screen.getByRole("button", { name: /cofnij ocenę/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zdejmij ze zwrotu/ })).toBeInTheDocument();
  });

  it("pusty zwrot podaje listę do dopisania, o której mówi (0.484.6)", () => {
    lista(zwrot({ kubelek: "ocena", pozycje: [] }), { onDopisz: vi.fn(),
      doDopisania: [{ zamPozycjaId: 1, offerId: "9", ofertaZdjecie: "nieznane", nazwa: "Grabie",
        ilosc: 1, cenaGrosze: 100, waluta: "PLN" }] });
    expect(screen.getByRole("button", { name: /przysłał więcej/ })).toBeInTheDocument();
  });
});

describe("Pozycja dopisana przez biuro", () => {
  it("niesie plakietkę i daje się zdjąć; pozycja klienta NIE", async () => {
    /* Zapis człowieka nie udaje faktu z Allegro (§4.3). Przycisk zdjęcia stoi
       wyłącznie przy pozycji biura: zgłoszona przez klienta wróciłaby przy
       najbliższym takcie, więc obiecywałby skutek, którego nie ma. */
    const onZdejmij = vi.fn();
    lista(zwrot({ pozycje: [
      POZYCJA({ id: 11, nazwa: "Sekator" }),
      POZYCJA({ id: 12, nazwa: "Łopata", zrodlo: "biuro" }),
    ] }), { onZdejmij });

    expect(screen.getByText("dopisane przez biuro")).toBeInTheDocument();
    const zdejmij = screen.getAllByRole("button", { name: /zdejmij ze zwrotu/ });
    expect(zdejmij).toHaveLength(1);

    await userEvent.click(zdejmij[0]);
    expect(onZdejmij).toHaveBeenCalledWith(12);
  });
});

  it("pozycja „na stan\" BEZ KARTOTEKI mówi, że nie weszła do koszyka", () => {
    /* Cicha strata jest tu najgorszym wyjściem (0.192.0). Ocena „na stan"
       dokłada pozycję na dokument MM, ale MM przesuwa stany KARTOTEK — bez
       kartoteki nie ma czego wpisać. Bez tego zdania karton pojechałby na halę
       z towarem, którego nie ma na żadnym papierze. */
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: false, iloscZwrocona: null, twId: null }),
    ] }));
    expect(screen.getByText(/Nie weszła do koszyka/)).toBeInTheDocument();
  });

  it("komplet PRZED koszykiem pokazuje, co do niego wejdzie", () => {
    /* Oferta jest jedna, a na magazynie leżą trzy kartoteki (0.328.0).
       Bez tego wiersza biuro nie ma skąd wiedzieć, że MM poniesie trzy
       pozycje zamiast jednej — dowiedziałoby się przy rozkładaniu.

       BEZ PTASZKÓW, dopóki pozycja nie leży w koszyku (0.335.0): skład jest
       wtedy planem, a ptaszek obiecywałby wiersz, którego nie ma czego zdjąć. */
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: false, twId: null }),
    ] }), { sklady: { 1: { zrodlo: "paragon", powod: null, skladniki: [
      { twId: 21, symbol: "SEK-01", nazwa: "Sekator", ilosc: 1, wKoszyku: false },
      { twId: 23, symbol: "REK-02", nazwa: "Rękawice", ilosc: 2, wKoszyku: false },
    ] } } });
    expect(screen.getByText(/SEK-01 × 1, REK-02 × 2/)).toBeInTheDocument();
    /* Po nazwie, nie po liczbie: w wierszu stoją też pola wyboru pozycji
       do kwoty i nie o nie tu chodzi. */
    expect(screen.queryByRole("checkbox", { name: /SEK-01/ })).toBeNull();
  });

  it("komplet W KOSZYKU dostaje ptaszki, wszystkie zaznaczone", async () => {
    /* Zgłoszenie właściciela (0.335.0): „powinno rozbijać na komponenty do
       zaznaczania, które idą do MM". Z kompletu wracają nieraz same części.

       ZAZNACZONE Z GÓRY: typowy zwrot kompletu jest kompletny, a ekran ma
       pytać wyłącznie o wyjątek. */
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: true, twId: null }),
    ] }), { sklady: { 1: { zrodlo: "paragon", powod: null, skladniki: [
      { twId: 21, symbol: "SEK-01", nazwa: "Sekator", ilosc: 1, wKoszyku: true },
      { twId: 23, symbol: "REK-02", nazwa: "Rękawice", ilosc: 2, wKoszyku: true },
    ] } } });
    const sekator = screen.getByRole("checkbox", { name: /SEK-01/ }) as HTMLInputElement;
    const rekawice = screen.getByRole("checkbox", { name: /REK-02/ }) as HTMLInputElement;
    expect([sekator.checked, rekawice.checked]).toEqual([true, true]);

    await userEvent.click(rekawice);
    expect(zaznacz).toHaveBeenCalledWith(
      { pozycjaId: 1, twId: 23, wKoszyku: false, zwrotId: 1 });
  });

  it("odznaczony składnik ZOSTAJE na ekranie — inaczej nie da się go cofnąć", () => {
    /* Zniknięcie wiersza po odznaczeniu byłoby drogą w jedną stronę, a §25a.5
       każe każdemu kliknięciu bez pytania zostawić drogę powrotną. */
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: true, twId: null }),
    ] }), { sklady: { 1: { zrodlo: "paragon", powod: null, skladniki: [
      { twId: 21, symbol: "SEK-01", nazwa: "Sekator", ilosc: 1, wKoszyku: true },
      { twId: 23, symbol: "REK-02", nazwa: "Rękawice", ilosc: 2, wKoszyku: false },
    ] } } });
    expect(screen.getByText("REK-02")).toBeInTheDocument();
    expect((screen.getByRole("checkbox", { name: /SEK-01/ }) as HTMLInputElement).checked)
      .toBe(true);
    expect((screen.getByRole("checkbox", { name: /REK-02/ }) as HTMLInputElement).checked)
      .toBe(false);
  });

  it("zwykły towar NIE powtarza swojej nazwy jako składu", () => {
    /* Jedna kartoteka to ta sama nazwa, która stoi linijkę wyżej. */
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: true, twId: 55, twSymbol: "SEK-01" }),
    ] }), { sklady: { 1: { zrodlo: "paragon", powod: null, skladniki: [
      { twId: 55, symbol: "SEK-01", nazwa: "Sekator", ilosc: 1, wKoszyku: true },
    ] } } });
    expect(screen.queryByText(/Do koszyka z paragonu/)).toBeNull();
  });

  it("powód niewejścia do koszyka PISZE SERWER, panel go nie układa", () => {
    /* Przyczyny są trzy i prowadzą w różne miejsca: brak kartoteki, brak
       dokumentu, dwie oferty bez kartoteki na jednym paragonie. Jedno zdanie
       na wszystkie wysyłałoby biuro do poprawiania nie tej rzeczy. */
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: false, twId: null }),
    ] }), { sklady: { 1: { zrodlo: null, skladniki: [],
      powod: "W zamówieniu są 2 oferty bez kartoteki na tym dokumencie" } } });
    expect(screen.getByText(/2 oferty bez kartoteki/)).toBeInTheDocument();
  });

  it("pozycja, która do koszyka weszła, mówi o tym przy ocenie", () => {
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: true, twId: 55, twSymbol: "SEK-01" }),
    ] }));
    expect(screen.getByText(/w koszyku zwrotów/)).toBeInTheDocument();
    expect(screen.queryByText(/Nie weszła do koszyka/)).toBeNull();
  });


describe("Ręczne wskazanie składu (0.336.0)", () => {
  /* Zgłoszenie właściciela: „rozwiąż «nie weszła do koszyka» — nie wiem, gdzie
     to wskazać". Automat odsyłał do ręcznej drogi zdaniem „wskaż skład
     ręcznie", a drogi nie było. */
  const WIERSZE = [
    { twId: 21, symbol: "SEK-01", nazwa: "Sekator", naDokumencie: 1 },
    { twId: 23, symbol: "REK-02", nazwa: "Rękawice", naDokumencie: 4 },
  ];
  const bezSkladu = (h: Partial<Parameters<typeof Pozycje>[0]> = {}) =>
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: false, twId: null, offerId: "of-KPL" }),
    ] }), { sklady: { 1: { zrodlo: null, skladniki: [],
      powod: "Ofert bez kartoteki na tym dokumencie: 3 — wskaż skład ręcznie" } },
      wierszeDokumentu: WIERSZE, ...h });

  it("powód niewejścia niesie DROGĘ WYJŚCIA, a nie samo zdanie o kłopocie", async () => {
    bezSkladu();
    /* Po roli, nie po tekście: to samo zdanie pisze SERWER w powodzie, a tu
       chodzi o przycisk, czyli o drogę, a nie o opis kłopotu. */
    await userEvent.click(screen.getByRole("button", { name: /wskaż skład ręcznie/ }));
    expect(screen.getByText(/Zaznacz wiersze paragonu/)).toBeInTheDocument();
    /* Materiałem są WIERSZE PARAGONU, nie wyszukiwarka kartotek. */
    expect(screen.getByRole("checkbox", { name: /SEK-01/ })).toBeInTheDocument();
  });

  it("sztuki podpowiadają się z paragonu i lecą jako ILOŚĆ NA KOMPLET", async () => {
    bezSkladu();
    await userEvent.click(screen.getByRole("button", { name: /wskaż skład ręcznie/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /REK-02/ }));
    const ile = screen.getByRole("textbox", { name: /Sztuk na komplet — REK-02/ });
    expect(ile).toHaveValue("4");
    await userEvent.clear(ile);
    await userEvent.type(ile, "2");
    await userEvent.click(screen.getByRole("button", { name: /Zapisz skład/ }));
    expect(wskaz).toHaveBeenCalledWith(
      { pozycjaId: 1, zwrotId: 1, skladniki: [{ twId: 23, naKomplet: 2 }] },
      expect.anything());
  });

  it("pusty skład nie ma czego zapisać, więc przycisk MILCZY", async () => {
    bezSkladu();
    await userEvent.click(screen.getByRole("button", { name: /wskaż skład ręcznie/ }));
    expect(screen.getByRole("button", { name: /Zapisz skład/ })).toBeDisabled();
  });

  it("bez dokumentu sprzedaży mówi, czego brakuje, zamiast pokazywać pustą listę", async () => {
    /* To INNA usterka, ze swoją drogą: wskazanie paragonu w kolumnie dowodów.
       Pusta lista wyglądałaby na zepsuty ekran. */
    bezSkladu({ wierszeDokumentu: [] });
    await userEvent.click(screen.getByRole("button", { name: /wskaż skład ręcznie/ }));
    expect(screen.getByText(/nie ma wskazanego dokumentu sprzedaży/)).toBeInTheDocument();
  });

  it("pozycja, która WESZŁA do koszyka, nie pyta o skład", () => {
    lista(zwrot({ kubelek: "zwrot", pozycje: [
      POZYCJA({ id: 1, ocena: "stan", wKoszyku: true, twId: 55, twSymbol: "SEK-01" }),
    ] }), { sklady: { 1: { zrodlo: "paragon", powod: null, skladniki: [
      { twId: 55, symbol: "SEK-01", nazwa: "Sekator", ilosc: 1, wKoszyku: true },
    ] } }, wierszeDokumentu: WIERSZE });
    expect(screen.queryByRole("button", { name: /wskaż skład ręcznie/ })).toBeNull();
  });
});

describe("Wybór pudła przy ocenie (0.379.0)", () => {
  /* Decyzja właściciela razem z odwróceniem zasady „jeden koszyk na
     operatora": przy kilku otwartych pudłach ocena PYTA, do którego. */

  it("jedno pudło nie pyta o nic", () => {
    pudla.kosze = [{ id: 17, kod: "Z-17", rodzaj: "zwroty" }];
    const onOcena = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>
      <Pozycje zwrot={zwrot({ kubelek: "ocena", pozycje: [POZYCJA()] })}
        trwa={false} blad="" onOcena={onOcena} onKwota={vi.fn()} />
    </QueryClientProvider>);

    expect(screen.getByRole("button", { name: /Na stan/ })).toBeInTheDocument();
    expect(screen.queryByText(/Z-17/)).toBeNull();
  });

  it("dwa pudła rozwijają ocenę na przyciski Z KODEM, jeden klik każdy", () => {
    /* Osobne okienko „do którego?" po naciśnięciu byłoby pytaniem PO
       czynności — tego zabrania dekalog. Stąd tyle przycisków, ile pudeł. */
    pudla.kosze = [
      { id: 17, kod: "Z-17", rodzaj: "zwroty" },
      { id: 18, kod: "Z-18", rodzaj: "zwroty" },
    ];
    const onOcena = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>
      <Pozycje zwrot={zwrot({ kubelek: "ocena", pozycje: [POZYCJA()] })}
        trwa={false} blad="" onOcena={onOcena} onKwota={vi.fn()} />
    </QueryClientProvider>);

    expect(screen.getByRole("button", { name: /Na stan → Z-17/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Na stan → Z-18/ })).toBeInTheDocument();
    /* Utylizacja jedzie do pudła odpadu, więc nie rozwija się wraz ze zwrotami. */
    expect(screen.getByRole("button", { name: /Utylizacja/ })).toBeInTheDocument();
  });

  it("kliknięcie niesie WSKAZANY koszyk, a nie domysł", async () => {
    pudla.kosze = [
      { id: 17, kod: "Z-17", rodzaj: "zwroty" },
      { id: 18, kod: "Z-18", rodzaj: "zwroty" },
    ];
    const onOcena = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>
      <Pozycje zwrot={zwrot({ kubelek: "ocena", pozycje: [POZYCJA()] })}
        trwa={false} blad="" onOcena={onOcena} onKwota={vi.fn()} />
    </QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: /Na stan → Z-18/ }));

    expect(onOcena).toHaveBeenCalledWith(11, "stan", 18);
  });
});
