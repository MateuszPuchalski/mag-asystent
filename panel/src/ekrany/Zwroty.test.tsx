import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Kubelek, Zwrot } from "../api/typy";

/* Ten plik istnieje przez usterkę znalezioną OKIEM, nie testem: przełączenie
   kubełka zmieniało listę, ale zostawiało kursor na zwrocie z poprzedniego
   kubełka. Środkowa kolumna pokazywała wtedy pytanie nowego kubełka nad
   klawiszami starego, a operator musiał dokliknąć wiersz — czyli zrobić
   dokładnie to jedno kliknięcie, którego ten ekran ma nie mieć. */

const zwrot = (id: number, kubelek: Kubelek, numer: string): Zwrot => ({
  id, externalId: `zw-${id}`, numer, orderId: `ord-${id}`,
  utworzono: "2026-08-25T09:00:00.000Z", paczkaAt: "2026-08-28T09:00:00.000Z", dostarczonoAt: null, przesylkaStatus: null, statusAllegro: null, rozliczonyAllegroAt: null, waybill: null,
  kubelek, sygnaly: [], terminAt: "2026-09-08T09:00:00.000Z", dniDoTerminu: 7,
  sumaPozycjiGrosze: 4999, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, zamowienie: null, werdykt: null, werdyktPowod: null, kwotaGrosze: null,
  kwotaWariant: null, korektaNumer: null, korektaZrodlo: null, rejectionCode: null, wersja: 1,
  zrodlo: "allegro", prowadzi: null, prowadziUserId: null, prowadziAt: null, tagi: [],
  notatka: null, notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, kupujacyLogin: null, odbiorcaNazwa: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  pozycje: [{ id, zrodlo: "allegro", offerId: "1", ofertaZamowienia: null, ofertaZdjecie: "nieznane" as const, nazwa: "Sekator", ilosc: 1, cenaGrosze: 4999,
    waluta: "PLN", powod: null, powodKomentarz: null, ocena: kubelek === "zwrot" ? "stan" : null,
    wKoszyku: false, iloscZwrocona: null, url: null, twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null } }],
});

const ZWROTY = [
  { ...zwrot(1, "decyzja", "ZW-1"), przewoznik: "INPOST", paczkaAt: "2026-08-28T09:00:00.000Z" },
  { ...zwrot(2, "zwrot", "ZW-2"), przewoznik: "DPD", paczkaAt: "2026-08-20T09:00:00.000Z",
    dniDoTerminu: 9 },
];

/* Bilans i stan synchronizacji są ZMIENNE, bo pasek mówi co innego przy
   działającej synchronizacji, a co innego przy stojącej. `vi.hoisted`, bo
   fabryka `vi.mock` jedzie przed resztą pliku. */
const scena = vi.hoisted(() => ({
  kartoteki: { bez: 3, wszystkie: 8, powody: { oferta_bez_sku: 2, jakis_nowy_kod: 1 } } as
    { bez: number; wszystkie: number; powody: Record<string, number> },
  stan: {} as Record<string, unknown>,
  /* Ręczna synchronizacja jedzie do Allegro, więc w teście stoi atrapa:
     inaczej kliknięcie strzelałoby `fetch`-em w nieistniejący serwer. */
  synchronizuj: { wolano: 0, blad: "" as string },
  /* Lista wymienna, bo klawisze kubełka DO OCENY potrzebują zwrotu
     dwupozycyjnego, a dokładanie go do stałej listy przestawiłoby liczniki
     w testach szukania („2 pasujących zwrotów"). */
  zwroty: null as unknown[] | null,
  /* Rozjazdy rekoncyliacji (0.313.0). Domyślnie PUSTE, bo pasek ma milczeć
     przy zerze — a większość testów tego pliku sprawdza co innego. */
  rozjazdy: [] as Array<{ rodzaj: string; klucz: string; opis: string; odKiedy: string | null }>,
  /* Decyzje z klawiatury MUSZĄ mieć atrapę: prawdziwa mutacja strzela
     `fetch`-em, a test sprawdza właśnie to, czy klawisz ją woła. */
  wolano: [] as Array<{ co: string; dane: Record<string, unknown> }>,
  /* Szczegół zwrotu — stąd bierze się STAN PIENIĘDZY, a od niego zależy, czy
     zapis korekty wolno przewinąć na następny zwrot. `undefined` znaczy „nie
     pobrano" i tak zachowuje się ekran bez serwera — czyli tak, jak we
     wszystkich pozostałych testach tego pliku. */
  szczegol: undefined as { pieniadze?: Record<string, unknown> } | undefined,
}));

vi.mock("../api/zwroty", async () => {
  const rzeczywisty = await vi.importActual<typeof import("../api/zwroty")>("../api/zwroty");
  return {
    ...rzeczywisty,
    useSynchronizujZwroty: () => ({
      isPending: false,
      mutate: (_v: unknown, opcje?: { onError?: (e: Error) => void }) => {
        scena.synchronizuj.wolano++;
        if (scena.synchronizuj.blad) opcje?.onError?.(new Error(scena.synchronizuj.blad));
      },
    }),
    useZwroty: () => ({
      data: { zwroty: scena.zwroty ?? ZWROTY,
        liczniki: { decyzja: 1, ocena: 0, zwrot: 1, korekta: 0,
          zamkniety: 0, odrzucony: 0 },
        kartoteki: scena.kartoteki, stan: scena.stan },
      isLoading: false, error: null,
    }),
    useRozjazdyZwrotow: () => ({ data: { rozjazdy: scena.rozjazdy } }),
    useWerdykt: () => atrapa("werdykt"),
    useOcena: () => atrapa("ocena"),
    useKorekta: () => atrapa("korekta"),
    useKwota: () => atrapa("kwota"),
    useCofnijKorekte: () => atrapa("cofnijKorekte"),
    useZwrot: () => ({ data: scena.szczegol, isLoading: false, error: null }),
    useZwrocPieniadze: () => atrapa("zwrocPieniadze"),
  };
});

/**
 * Atrapa mutacji: zapisuje wołanie i oddaje wersję o jeden wyższą.
 *
 * Wersja rośnie, bo ocena hurtem chodzi PO KOLEI i podaje następnemu żądaniu
 * wersję oddaną przez poprzednie — atrapa zwracająca ciągle tę samą przepuściłaby
 * kod, który na serwerze odbiłby się od blokady optymistycznej.
 */
function atrapa(co: string) {
  const zapisz = (dane: Record<string, unknown>) => {
    scena.wolano.push({ co, dane });
    return { wersja: Number(dane.wersja ?? 1) + 1, koszyk: null };
  };
  return {
    isPending: false, error: null,
    mutate: (dane: Record<string, unknown>, opcje?: { onSuccess?: (w: unknown) => void }) => {
      const w = zapisz(dane);
      opcje?.onSuccess?.(w);
    },
    mutateAsync: async (dane: Record<string, unknown>) => zapisz(dane),
  };
}

const { Zwroty } = await import("./Zwroty");

const pokaz = (adres = "/obsluga/zwroty") =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[adres]}>
    <Routes>
      <Route path="/obsluga/zwroty" element={<Zwroty />} />
      <Route path="/obsluga/zwroty/:id" element={<Zwroty />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);

const szukajka = () => screen.getByPlaceholderText(/Zeskanuj etykietę/);

describe("Ekran zwrotów", () => {
  it("kubełek niesie pytanie, a nie samą etykietę", () => {
    pokaz();
    expect(screen.getByText("Przyjąć czy odrzucić?")).toBeInTheDocument();
  });

  /* ── BUDŻET PASM NAD LISTĄ (audyt, 15 września 2026) ──────────────────
     Pomiar na żywym ekranie: siedem pasm zabierało 344 px z 803 px kolumny,
     czyli 43%, i było ich stałe — przy oknie 800 px kolejka pokazywała DWA
     zwroty. Pasma nie powstały naraz: dokładało je po jednym siedem wydań,
     a każde z osobna kosztowało „tylko trzydzieści pikseli".

     Ten test nie mierzy pikseli — jsdom ich nie ma. Liczy PASMA, bo to one
     narastają, i zmusza ósme do rozmowy z właścicielem zamiast do cichego
     wejścia. Podniesienie progu jest wolne; ma tylko zostawić zdanie.       */
  it("nad listą stoi najwyżej pięć pasm — ósme wydałoby się samo", async () => {
    scena.zwroty = null;
    pokaz();
    const karta = document.querySelector(".card")!;
    /* Ostatnie dziecko to sama lista, reszta to chrom. */
    expect(karta.children.length - 1).toBeLessThanOrEqual(5);
  });

  it("przełączenie kubełka przestawia też kursor na pierwszy zwrot", async () => {
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Do zwrotu/ }));
    /* Nagłówek środkowej kolumny i klawisze mają opisywać TEN SAM zwrot. */
    expect(screen.getByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
    /* Etykieta zmieniła się w 0.156.0 razem z modelem: zamiast wyboru
       wariantu jest zaznaczanie pozycji i jeden zapis. */
    expect(screen.getByRole("button", { name: /Zapisz kwotę/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Przyjmij/ })).not.toBeInTheDocument();
  });

  it("wejście z paska adresu na zwrot z innego kubełka przestawia kubełek", async () => {
    /* Adres jest źródłem prawdy: link do sprawy wklejony koledze ma pokazać
       tę sprawę, a nie pustą listę pod inną zakładką. */
    pokaz("/obsluga/zwroty/2");
    expect(await screen.findByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
    expect(screen.getAllByText("Ile oddać?").length).toBeGreaterThan(0);
  });

  it("bez wybranego zwrotu ekran prosi o wybór, zamiast pokazywać pustkę", () => {
    pokaz();
    expect(screen.getByText(/Wybierz zwrot z kolejki/)).toBeInTheDocument();
  });

  it("pasek decyzji DZIAŁA — zdanie o czytaniu zeszło razem z 0.156.0", () => {
    /* Do 0.155.0 stało tu „To wydanie tylko czyta", bo przycisk wyglądający
       na działający i niedziałający jest gorszy od jego braku. Teraz działa,
       więc to zdanie byłoby kłamstwem w drugą stronę. */
    pokaz("/obsluga/zwroty/1");
    expect(screen.queryByText(/To wydanie tylko czyta/)).toBeNull();
    expect(screen.getByRole("button", { name: /Przyjmij/ })).toBeEnabled();
  });

  it("fragment kodu zawęża kolejkę i sięga POZA wybrany kubełek", async () => {
    /* Bez przebicia kubełka operator wpisuje numer, widzi „ten kubełek jest
       pusty" i nie ma jak się dowiedzieć, że zwrot stoi gdzie indziej. */
    pokaz();
    await userEvent.type(szukajka(), "ZW-");
    /* Oba zwroty pasują, choć kursor stoi w kubełku, w którym leży jeden. */
    expect(screen.getByText(/2 zwroty pasują — szukam po wszystkich kubełkach/))
      .toBeInTheDocument();
  });

  it("fragment pokazuje zwrot z CUDZEGO kubełka razem z jego etykietą", async () => {
    pokaz();
    /* Kursor stoi w kubełku DO DECYZJI, a `ZW-2` leży w DO ZWROTU. */
    await userEvent.type(szukajka(), "ZW-2");
    expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    expect(screen.getAllByText("Do zwrotu").length).toBeGreaterThan(0);
  });

  it("szuka po LOGINIE kupującego, bo to jedyny uchwyt w rozmowie (0.337.0)", async () => {
    /* Zgłoszenie właściciela. Numery odpowiadają na pytanie „gdzie jest TA
       paczka"; login na inne — „co jeszcze mam od TEGO klienta". Pada przy
       każdej rozmowie, w której klient mówi o dwóch przesyłkach naraz. */
    scena.zwroty = [
      { ...zwrot(1, "decyzja", "ZW-1"), kupujacyLogin: "ogrodnik_77" },
      { ...zwrot(2, "zwrot", "ZW-2"), kupujacyLogin: "inny_klient" },
    ];
    try {
      pokaz();
      await userEvent.type(szukajka(), "ogrodnik");
      expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    } finally {
      scena.zwroty = null;
    }
  });

  it("wpisanie „nieodebrana” wyciąga WSZYSTKIE takie paczki (0.338.0)", async () => {
    /* Nie potrzeba osobnego sita: identyfikator takiej paczki to nasz
       `nieodebrana:<numer listu>`, a filtr frazy porównuje właśnie
       identyfikatory. To jest odpowiedź na prośbę „chcę je widzieć w zakładce
       zwroty" — i ma nią zostać, więc pilnuje jej test. */
    scena.zwroty = [
      { ...zwrot(1, "decyzja", "ZW-1"), zrodlo: "nieodebrana",
        externalId: "nieodebrana:PACZ-1", numer: null },
      { ...zwrot(2, "zwrot", "ZW-2") },
    ];
    try {
      pokaz();
      await userEvent.type(szukajka(), "nieodebrana");
      expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    } finally {
      scena.zwroty = null;
    }
  });

  it("filtr widzi NUMER LISTU bez pytania serwera (0.344.0)", async () => {
    /* Do 0.343.0 numer żył wyłącznie w kopii odpowiedzi Allegro, więc filtr go
       nie widział i szukanie po naklejce wymagało Entera. Decyzja właściciela
       zdjęła politykę 0.163.0: „zapisuj numery paczek". */
    scena.zwroty = [
      { ...zwrot(1, "decyzja", "ZW-1"), waybill: "600000367616070023174201" },
      { ...zwrot(2, "zwrot", "ZW-2") },
    ];
    try {
      pokaz();
      await userEvent.type(szukajka(), "6000003676");
      expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    } finally {
      scena.zwroty = null;
    }
  });

  it("DWA CZŁONY zawężają, choć trafiają w różne pola (0.367.0)", async () => {
    /* Zgłoszenie właściciela: „szukanie nieodebranych paczek odbywa się głównie
       za pomocą loginu użytkownika i innych informacji na przesyłce". Do
       0.366.0 fraza szła do porównania w całości, więc „kowalski inpost" nie
       znajdowało nic — nie dlatego, że tych danych nie ma, tylko dlatego, że
       nie stoją obok siebie w jednym polu. */
    scena.zwroty = [
      { ...zwrot(1, "decyzja", "ZW-1"), odbiorcaNazwa: "Jan Kowalski", przewoznik: "INPOST" },
      { ...zwrot(2, "zwrot", "ZW-2"), odbiorcaNazwa: "Jan Kowalski", przewoznik: "DPD" },
    ];
    try {
      pokaz();
      await userEvent.type(szukajka(), "kowalski");
      expect(screen.getByText(/2 zwroty pasują/)).toBeInTheDocument();
      await userEvent.type(szukajka(), " inpost");
      expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    } finally {
      scena.zwroty = null;
    }
  });

  it("przewoźnika wolno nazwać tak, jak stoi na naklejce (0.367.0)", async () => {
    /* Na pudle stoi „Paczkomat", a w danych `INPOST`. Bez aliasu człon
       przepisany z naklejki wyglądałby na brak danych, a nie na inną nazwę
       tej samej firmy. */
    scena.zwroty = [
      { ...zwrot(1, "decyzja", "ZW-1"), przewoznik: "INPOST" },
      { ...zwrot(2, "zwrot", "ZW-2"), przewoznik: "DPD" },
    ];
    try {
      pokaz();
      await userEvent.type(szukajka(), "paczkomat");
      expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    } finally {
      scena.zwroty = null;
    }
  });

  it("fraza WIELOCZŁONOWA nigdy nie otwiera zwrotu sama (0.367.0)", async () => {
    /* Dopasowanie po fragmentach jest z natury przybliżone, a to jest ekran,
       z którego wychodzi się z czyimś zwrotem i czyimiś pieniędzmi. Jeden
       człon i dokładnie — tak jak dotąd; więcej członów tylko zawęża. */
    pokaz();
    /* Kolejność członów jest tu ISTOTNA: „ZW-2 dpd" przechodziłoby przez stan
       jednoczłonowy „ZW-2" w połowie pisania i otwarcie byłoby wtedy zgodne
       z regułą 0.165.0 („otwarcie w pół pisania nie jest wpadką"). Pytanie
       brzmi inaczej: czy otwiera FRAZA WIELOCZŁONOWA jako taka. Kursor stoi
       na ZW-1 z kubełka domyślnego, więc rozstrzyga nagłówek ZW-2. */
    await userEvent.type(szukajka(), "dpd ZW-2");
    expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ZW-2" })).toBeNull();

    /* Sam numer, bez drugiego członu, dalej otwiera — reguła z 0.165.0 stoi. */
    await userEvent.clear(szukajka());
    await userEvent.type(szukajka(), "ZW-2");
    expect(await screen.findByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
  });

  it("przewoźnik ZAWĘŻA, ale nigdy nie otwiera zwrotu (0.367.0)", async () => {
    /* Uchwyt opisowy nie jest identyfikatorem: przewoźnik opisuje setki paczek
       naraz, a otwarcie stawia na ekranie cudze pieniądze. W bazie testowej
       DPD ma dokładnie jeden zwrot — i to właśnie ten przypadek otwierał go
       jak podany numer, dopóki jedna lista robiła oba zadania. */
    pokaz();
    await userEvent.type(szukajka(), "dpd");
    expect(screen.getByText(/1 zwrot pasuje/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ZW-2" })).toBeNull();
  });

  it("CAŁY numer otwiera zwrot, sam fragment nigdy", async () => {
    /* Ekran sam otwiera przy jednym wyniku, więc dopasowanie przybliżone
       prowadziłoby do cudzej sprawy — cudzego klienta i cudzych pieniędzy. */
    pokaz();
    await userEvent.type(szukajka(), "ZW-");
    expect(screen.queryByRole("heading", { name: "ZW-2" })).toBeNull();
    await userEvent.type(szukajka(), "2");
    expect(await screen.findByRole("heading", { name: "ZW-2" })).toBeInTheDocument();
  });

  it("kliknięcie w kubełek zdejmuje filtr, bo jest prośbą o TEN kubełek", async () => {
    pokaz();
    await userEvent.type(szukajka(), "ZW-2");
    await userEvent.click(screen.getByRole("button", { name: /Do decyzji/ }));
    expect(screen.queryByText(/szukam po wszystkich kubełkach/)).toBeNull();
    expect(screen.getAllByText("Przyjąć czy odrzucić?").length).toBeGreaterThan(0);
  });

  it("zakładka WSZYSTKIE pokazuje oba kubełki naraz, z plakietką przy wierszu", async () => {
    /* To zakładka do SZUKANIA, nie siódmy kubełek: kubełki zostają silnikiem
       pracy, bo rejestr mieszający jedno z drugim skasowaliśmy w 0.140.0. */
    pokaz();
    expect(screen.queryByText("ZW-2")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Wszystkie/ }));
    expect(screen.getAllByText("ZW-2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Do zwrotu").length).toBeGreaterThan(0);
    /* Pytanie nad LISTĄ milczy — nie ma czyje zadać. Od 0.214.0 nie ma go też
       w nagłówku środkowej kolumny: stało tam nad przyciskami PRZYJMIJ
       i ODRZUĆ, czyli pytało o to, na co odpowiedź była pod spodem. */
    expect(screen.queryByText("Przyjąć czy odrzucić?")).toBeNull();
  });

  it("filtr przewoźnika zna tylko firmy, które naprawdę przyjechały", () => {
    /* Allegro nie publikuje zamkniętej listy przewoźników, a sonda złapała
       `UNKNOWN`. Filtr ze słownika uczyłby klikać na próżno. */
    pokaz();
    const wybor = screen.getByLabelText("Przewoźnik");
    expect(wybor).toHaveTextContent("Każdy przewoźnik");
    expect(wybor).toHaveTextContent("INPOST");
    expect(wybor).not.toHaveTextContent("DHL");
  });

  it("„Paczka u nas” zawęża do zwrotów z doręczoną paczką i niczego nie przestawia", async () => {
    /* Audyt zwrotów, 15 września 2026: biuro przy stosie kartonów pyta, które
       zwroty może dziś zrobić. Kolejność dalej liczy termin (0.315.0). */
    scena.zwroty = [
      { ...zwrot(31, "decyzja", "ZU-31"), dostarczonoAt: "2026-09-01T09:00:00.000Z" },
      zwrot(32, "decyzja", "ZU-32"),
    ];
    try {
      pokaz();
      expect(screen.getAllByText("ZU-32").length).toBeGreaterThan(0);
      await userEvent.click(screen.getByLabelText(/Paczka u nas/));
      expect(screen.queryByText("ZU-32")).toBeNull();
      expect(screen.getAllByText("ZU-31").length).toBeGreaterThan(0);
    } finally { scena.zwroty = null; }
  });

  it("przewoźnik zawęża kolejkę, a domyślnie nie zawęża niczego", async () => {
    pokaz();
    expect(screen.getAllByText("ZW-1").length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText("Przewoźnik"), "DPD");
    expect(screen.queryByText("ZW-1")).toBeNull();
  });

  it("kolejność domyślna zostaje po terminie ustawowym", async () => {
    /* Blizna 0.121.0: termin steruje kolejnością pracy. Data nadania jest
       PRZEŁĄCZNIKIEM, bo odpowiada na inne pytanie. */
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wszystkie/ }));
    const przed = screen.getAllByRole("button").map((b) => b.textContent ?? "")
      .filter((t) => t.includes("ZW-"));
    expect(przed[0]).toContain("ZW-1");

    await userEvent.click(screen.getByLabelText(/Od daty nadania/));
    const po = screen.getAllByRole("button").map((b) => b.textContent ?? "")
      .filter((t) => t.includes("ZW-"));
    expect(po[0]).toContain("ZW-2");
  });

  it("licznik kartotek mówi ILE i DLACZEGO, a nieznanego powodu nie gubi", async () => {
    /* Bez liczb nie da się powiedzieć, czy problem jest w kodzie, czy
       w danych Allegro: jedna pozycja bez SKU to sprzedawca, czterdzieści
       z tym samym powodem to usterka. Kod, którego panel nie zna, pokazuje
       się surowy — licznik, który cicho gubi część liczb, jest gorszy od
       jego braku. */
    pokaz();
    /* Od 15 września 2026 pasy są zwinięte w jeden wiersz („schowaj to gdzieś"):
       liczba stoi na wierzchu, zdania są o kliknięcie dalej. */
    expect(screen.queryByText(/oferta bez SKU/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /pokaż szczegóły/ }));
    expect(screen.getByText(/Bez kartoteki: 3 z 8 pozycji w pracy/)).toBeInTheDocument();
    expect(screen.getByText(/oferta bez SKU/)).toBeInTheDocument();
    expect(screen.getByText(/jakis_nowy_kod/)).toBeInTheDocument();
  });

  it("czekanie na automat nazywa się inaczej niż czekanie na człowieka", async () => {
    /* Pozycja z pewnością `sku` wiąże się sama. Gdy stoi w liczniku, to jest
       usterka, a nie praca do zrobienia — jedna liczba na oba przypadki
       kazała szukać winy nie tam, gdzie trzeba. */
    scena.kartoteki = { bez: 5, wszystkie: 9,
      powody: { do_zwiazania: 4, do_zatwierdzenia: 1 } };
    /* Synchronizacja DZIAŁA, więc wiersz jest zwinięty. Stan bez statusu to
       synchronizacja, która stoi — a wtedy wiersz otwiera się sam (test niżej). */
    scena.stan = { status: "current", kodOstatniegoBledu: null, pozostaloDoPobrania: null };
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /pokaż szczegóły/ }));
    expect(screen.getByText(/czeka na automat/)).toBeInTheDocument();
    expect(screen.getByText(/czeka na zatwierdzenie/)).toBeInTheDocument();
  });

  it("stojąca synchronizacja mówi o sobie przy pozycjach czekających na automat", () => {
    /* Wiązanie jedzie taktem synchronizacji. Gdy takt stoi, ekran ma to
       powiedzieć — inaczej operator klika „Zatwierdź" siedemset razy zamiast
       naprawić jedną rzecz. */
    scena.kartoteki = { bez: 4, wszystkie: 9, powody: { do_zwiazania: 4 } };
    scena.stan = { status: "authentication_error", kodOstatniegoBledu: 401,
      pozostaloDoPobrania: null };
    pokaz();
    expect(screen.getByText(/odmowa logowania do Allegro/)).toBeInTheDocument();
    expect(screen.getByText(/kod 401/)).toBeInTheDocument();
  });

  it("przycisk synchronizacji woła Allegro i pokazuje jego odmowę", async () => {
    /* Takt zwrotów chodzi rzadko, bo zwrot ma termin w dniach. Biuro, które
       właśnie przyjęło paczkę, wie o zwrocie wcześniej niż panel — i do
       0.231.0 nie miało jak go poprosić o pobranie.

       Odmowa Allegro jedzie na ekran CAŁYM zdaniem: mówi, co naprawić,
       a sam kod HTTP nie mówi nic. */
    scena.synchronizuj.wolano = 0;
    scena.synchronizuj.blad = "Allegro prosi o przerwę — synchronizacja czeka";
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Synchronizuj/ }));
    expect(scena.synchronizuj.wolano).toBe(1);
    expect(screen.getByText(/prosi o przerwę/)).toBeInTheDocument();
    scena.synchronizuj.blad = "";
  });

  it("działająca synchronizacja NIE dopisuje zdania o sobie", () => {
    /* Zdanie wypisywane zawsze przestaje być czytane po tygodniu. */
    scena.kartoteki = { bez: 4, wszystkie: 9, powody: { do_zwiazania: 4 } };
    scena.stan = { status: "current", kodOstatniegoBledu: null, pozostaloDoPobrania: null };
    pokaz();
    expect(screen.queryByText(/Wiązanie idzie taktem/)).not.toBeInTheDocument();
  });
});

/* ── Klawisze kubełka (0.284.0) ──────────────────────────────────────────────
   Do 0.283.0 ekran rysował te litery przy przyciskach jako `<kbd>`, a żadna
   z nich nic nie robiła: nasłuch znał wyłącznie `j`/`k` i cyfry kubełków.
   Doktryna §25a.2 wypisywała je w tabeli, a §25a.3 obiecywał, że „typowy zwrot
   to jeden klawisz" — więc obietnicę składał ekran i dokument naraz, a
   dotrzymywała jej mysz.                                                     */
describe("Klawisze kubełka", () => {
  const dwiePozycje = (id: number) => {
    const z = zwrot(id, "ocena", `ZO-${id}`);
    return { ...z, pozycje: [
      { ...z.pozycje[0], id: id * 10 + 1, ocena: null },
      { ...z.pozycje[0], id: id * 10 + 2, ocena: null },
    ] };
  };

  it("`P` w DO DECYZJI przyjmuje zwrot", async () => {
    scena.wolano = [];
    pokaz("/obsluga/zwroty/1");
    await userEvent.keyboard("p");
    /* `waitFor`, bo pierwszy znak serii czeka 40 ms na drugi: nasłuch nie wie
       w chwili naciśnięcia, czy to skrót, czy początek kodu z czytnika. */
    await waitFor(() => expect(scena.wolano).toEqual([{ co: "werdykt",
      dane: { id: 1, decyzja: "przyjety", powod: null, wersja: 1 } }]));
  });

  it("`O` OTWIERA POWÓD, a nie zapisuje odmowy", async () => {
    /* Odmowa jest nieodwracalna, więc §25a.5 daje jej potwierdzenie. Klawisz
       ma skracać drogę do pytania, nie omijać samo pytanie. */
    scena.wolano = [];
    pokaz("/obsluga/zwroty/1");
    await userEvent.keyboard("o");
    expect(await screen.findByLabelText(/Powód odmowy/)).toBeInTheDocument();
    expect(scena.wolano).toEqual([]);
  });

  it("`S` ocenia PIERWSZĄ nieocenioną pozycję, nie cały zwrot", async () => {
    scena.wolano = [];
    scena.zwroty = [dwiePozycje(3)];
    try {
      pokaz("/obsluga/zwroty/3");
      await userEvent.keyboard("s");
      await waitFor(() => expect(scena.wolano).toEqual([{ co: "ocena",
        dane: { pozycjaId: 31, ocena: "stan", wersja: 1 } }]));
    } finally { scena.zwroty = null; }
  });

  it("`Shift+S` ocenia wszystkie nieocenione, każdą z nową wersją", async () => {
    /* Równoległe żądania z tą samą wersją odbiłyby się od blokady
       optymistycznej i zostawiły zwrot oceniony w połowie. */
    scena.wolano = [];
    scena.zwroty = [dwiePozycje(4)];
    try {
      pokaz("/obsluga/zwroty/4");
      await userEvent.keyboard("{Shift>}S{/Shift}");
      await waitFor(() => expect(scena.wolano.map((w) => w.dane)).toEqual([
        { pozycjaId: 41, ocena: "stan", wersja: 1 },
        { pozycjaId: 42, ocena: "stan", wersja: 2 },
      ]));
    } finally { scena.zwroty = null; }
  });

  it("przycisk „wszystkie na stan” stoi dopiero przy drugiej nieocenionej pozycji", async () => {
    scena.zwroty = [dwiePozycje(5)];
    try {
      pokaz("/obsluga/zwroty/5");
      expect(await screen.findByRole("button", { name: /Wszystkie na stan \(2\)/ }))
        .toBeInTheDocument();
    } finally { scena.zwroty = null; }
  });

  it("`Enter` w DO ZWROTU zapisuje kwotę z zaznaczenia", async () => {
    /* Zaznaczenie mieszka w `Pozycje.tsx` i ma tam zostać (0.216.0), więc
       klawisz sięga po nie rejestrem z `zwroty/klawisze.ts`. */
    scena.wolano = [];
    pokaz("/obsluga/zwroty/2");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(scena.wolano).toEqual([{ co: "kwota",
      dane: { id: 2, pozycjeIds: [2], dostawa: false, wersja: 1 } }]));
  });

  it("klawisz w polu tekstowym nie jest skrótem", async () => {
    /* Numer listu wpisywany ręcznie ma iść do pola, a nie przyjmować zwrot. */
    scena.wolano = [];
    pokaz("/obsluga/zwroty/1");
    await userEvent.type(szukajka(), "po");
    expect(scena.wolano).toEqual([]);
  });

  it("pasek pokazuje klawisze OGLĄDANEGO kubełka", async () => {
    pokaz("/obsluga/zwroty/1");
    expect(screen.getByText("przyjmij")).toBeInTheDocument();
    expect(screen.queryByText("zapisz kwotę")).toBeNull();
    /* SITA DOSZŁY W 0.315.0. Do 0.313.0 stała tu odwrotna asercja i była
       prawdziwa: zwrot nie nosił prowadzącego, więc pasek nie miał prawa
       obiecywać `n`. Decyzja właściciela z 13 września to odwróciła. */
    expect(screen.getByText("niczyje")).toBeInTheDocument();
  });

  it("`Enter` w DO KOREKTY stawia kursor w polu numeru, niczego nie zapisując", async () => {
    /* Audyt zwrotów, 15 września 2026: pasek obiecywał tu Enter, a klawisz
       milczał. Numer wpisuje człowiek, więc pierwszy Enter nie ma czego zapisać. */
    scena.wolano = [];
    scena.zwroty = [{ ...zwrot(6, "korekta", "ZK-6"), werdykt: "przyjety", kwotaGrosze: 4999 }];
    try {
      pokaz("/obsluga/zwroty/6");
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(screen.getByLabelText("Numer korekty")).toHaveFocus());
      expect(scena.wolano).toEqual([]);
    } finally { scena.zwroty = null; }
  });

  /* ── Korekta a pieniądze (audyt, 15 września 2026) ──────────────────────
     Ekran przeczył sam sobie: `Decyzje.tsx` pisało „pieniądze oddajesz
     przyciskiem niżej — także po zapisaniu korekty", a zapis numeru zabierał
     ten zwrot z oczu. Biuro wystawia korektę zwykle PRZED wypłatą.          */
  const kursor = () => document.querySelector("[aria-current]")?.textContent ?? "";

  const dwieKorekty = () => [
    { ...zwrot(6, "korekta", "ZK-6"), werdykt: "przyjety" as const, kwotaGrosze: 4999 },
    { ...zwrot(7, "korekta", "ZK-7"), werdykt: "przyjety" as const, kwotaGrosze: 1500 },
  ];

  const pieniadze = (n: Record<string, unknown>) => ({
    pieniadze: {
      moznaZwrocic: false, moznaOdmowic: true, powod: null, kwotaGrosze: 4999,
      waluta: "PLN", oddane: null, odmowa: null, przelew: null,
      moznaZapisacPrzelew: false, powodPrzelewu: null, ...n,
    },
  });

  const zapiszKorekte = async () => {
    await userEvent.type(screen.getByLabelText("Numer korekty"), "ZW 413/MAG/09/2026");
    await userEvent.click(screen.getByRole("button", { name: /Zapisz korektę/ }));
  };

  it("zapis korekty NIE zabiera z oczu zwrotu, który czeka na wypłatę", async () => {
    scena.wolano = [];
    scena.zwroty = dwieKorekty();
    scena.szczegol = pieniadze({ moznaZwrocic: true });
    try {
      pokaz("/obsluga/zwroty/6");
      await zapiszKorekte();
      expect(scena.wolano.map((w) => w.co)).toEqual(["korekta"]);
      await waitFor(() => expect(kursor()).toContain("ZK-6"));
    } finally { scena.zwroty = null; scena.szczegol = undefined; }
  });

  it("czeka także na PRZELEW poza Allegro — przy pobraniu to jedyna droga", async () => {
    scena.wolano = [];
    scena.zwroty = dwieKorekty();
    scena.szczegol = pieniadze({ moznaZwrocic: false, moznaZapisacPrzelew: true });
    try {
      pokaz("/obsluga/zwroty/6");
      await zapiszKorekte();
      await waitFor(() => expect(kursor()).toContain("ZK-6"));
    } finally { scena.zwroty = null; scena.szczegol = undefined; }
  });

  it("gdy pieniądze są załatwione, korekta przewija na następny zwrot", async () => {
    /* Druga połowa umowy: zwrot bez otwartego pytania ma zejść z ekranu sam,
       bo odklikiwanie się z gotowej sprawy to ta sama praca co szukanie jej. */
    scena.wolano = [];
    scena.zwroty = dwieKorekty();
    scena.szczegol = pieniadze({
      oddane: { id: "ref-1", status: "SUCCEEDED", kiedy: null, potwierdzone: true },
    });
    try {
      pokaz("/obsluga/zwroty/6");
      await zapiszKorekte();
      await waitFor(() => expect(kursor()).toContain("ZK-7"));
    } finally { scena.zwroty = null; scena.szczegol = undefined; }
  });

  it("klawisz `Z` oddaje pieniądze także na zwrocie w DO KOREKTY", async () => {
    /* Należność nie siedzi w jednym kubełku, więc klawisz stoi PRZED gałęziami
       kubełków. Ten zwrot jest ZAMKNIĘTY korektą, a pieniądze wiszą — do tego
       audytu żaden klawisz nie robił tu nic. */
    scena.wolano = [];
    scena.zwroty = dwieKorekty();
    scena.szczegol = pieniadze({ moznaZwrocic: true });
    try {
      pokaz("/obsluga/zwroty/6");
      /* Pasek skrótów obiecuje klawisz dokładnie tam, gdzie on działa. */
      expect(screen.getByText("oddaj pieniądze")).toBeInTheDocument();
      await userEvent.keyboard("z");
      await waitFor(() => expect(scena.wolano.map((w) => w.co)).toEqual(["zwrocPieniadze"]));
      expect(scena.wolano[0].dane).toMatchObject({ id: 6 });
    } finally { scena.zwroty = null; scena.szczegol = undefined; }
  });

  it("pasek nie obiecuje `Z`, gdy nie ma czego oddać", async () => {
    /* Martwy klawisz w pasku to błąd, przeciw któremu powstał `SkrotyKlawiszy`. */
    scena.wolano = [];
    scena.zwroty = dwieKorekty();
    scena.szczegol = pieniadze({
      oddane: { id: "ref-1", status: "SUCCEEDED", kiedy: null, potwierdzone: true },
    });
    try {
      pokaz("/obsluga/zwroty/6");
      expect(screen.queryByText("oddaj pieniądze")).toBeNull();
      await userEvent.keyboard("z");
      expect(scena.wolano).toEqual([]);
    } finally { scena.zwroty = null; scena.szczegol = undefined; }
  });

  it("`j` po przyjęciu zwrotu idzie do NASTĘPNEGO, a nie przez niego przeskakuje", async () => {
    /* Przyjęty zwrot znika z listy DO DECYZJI, a kursor zostaje na nim. Do
       audytu z 15 września 2026 `j` liczyło wtedy od zera i gubiło co drugi
       zwrot — praca kubełkiem z klawiatury omijała połowę kolejki. */
    scena.zwroty = [zwrot(21, "decyzja", "ZD-21"), zwrot(22, "decyzja", "ZD-22"),
      zwrot(23, "decyzja", "ZD-23")];
    const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    /* Świeży element przy każdym rysowaniu: ten sam obiekt React by pominął,
       a atrapa kolejki czyta scenę dopiero przy rysowaniu. */
    const drzewo = () => <QueryClientProvider client={klient}>
      <MemoryRouter initialEntries={["/obsluga/zwroty/21"]}><Routes>
        <Route path="/obsluga/zwroty" element={<Zwroty />} />
        <Route path="/obsluga/zwroty/:id" element={<Zwroty />} />
      </Routes></MemoryRouter></QueryClientProvider>;
    try {
      const { rerender } = render(drzewo());
      expect(await screen.findByRole("heading", { name: "ZD-21" })).toBeInTheDocument();

      scena.zwroty = [zwrot(21, "ocena", "ZD-21"), zwrot(22, "decyzja", "ZD-22"),
        zwrot(23, "decyzja", "ZD-23")];
      rerender(drzewo());
      await userEvent.keyboard("j");
      expect(await screen.findByRole("heading", { name: "ZD-22" })).toBeInTheDocument();
    } finally { scena.zwroty = null; }
  });
});

/* ── Rozjazdy nad kolejką (0.313.0) ──────────────────────────────────────────
   Cztery kontrole rekoncyliacji dotyczące zwrotów liczyły się od dawna
   i rysowały wyłącznie w `/biuro`. Obsługa pracuje na tym ekranie, więc raport
   chroniący jej pracę wisiał tam, gdzie ona nie zagląda.                    */
describe("Pasek rozjazdów", () => {
  it("milczy, gdy nie ma czego zgłosić", () => {
    /* Pas z napisem „wszystko w porządku" uczy przewijać wzrokiem to miejsce
       — a wtedy nie widać go w dniu, w którym naprawdę coś mówi. */
    pokaz();
    expect(screen.queryByLabelText("Rozjazdy zwrotów")).toBeNull();
  });

  it("liczy RODZAJAMI, a numery pokazuje dopiero po kliknięciu", async () => {
    /* NAPRAWA Z 0.319.0. Pierwsza wersja rysowała każdy wiersz z osobna;
       na żywej bazie wyszło ich czterysta trzydzieści trzy i pasek zjadł cały
       ekran — kolejki nie było widać wcale. Czterysta razy to samo zdanie to
       nie informacja, tylko szum: rozstrzyga LICZBA i RODZAJ. */
    scena.rozjazdy = [
      { rodzaj: "zwrot_po_terminie", klucz: "ZW-1",
        opis: "Zwrot ZW-1 po terminie ustawowym", odKiedy: "2026-09-01T09:00:00Z" },
      { rodzaj: "zwrot_po_terminie", klucz: "ZW-2",
        opis: "Zwrot ZW-2 po terminie ustawowym", odKiedy: "2026-09-01T09:00:00Z" },
      { rodzaj: "kosz_bez_powrotu", klucz: "Z-7",
        opis: "Kosz Z-7 rozłożono ponad dobę temu", odKiedy: "2026-09-02T09:00:00Z" },
    ];
    try {
      pokaz();
      /* Zwinięty wiersz mówi samą liczbę; pasek rodzajów jest pod kliknięciem
         (15 września 2026, „schowaj to gdzieś"). */
      expect(screen.queryByLabelText("Rozjazdy zwrotów")).toBeNull();
      expect(screen.getByRole("button", { name: /Do sprawdzenia 3/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /pokaż szczegóły/ }));
      const pasek = screen.getByLabelText("Rozjazdy zwrotów");
      expect(pasek).toHaveTextContent("Do sprawdzenia (3)");
      expect(pasek).toHaveTextContent("2 po terminie ustawowym");
      expect(pasek).toHaveTextContent("1 kosz bez powrotu z regału");
      expect(pasek).not.toHaveTextContent("ZW-1");

      await userEvent.click(screen.getByRole("button", { name: /pokaż numery/ }));
      expect(screen.getByLabelText("Rozjazdy zwrotów")).toHaveTextContent("ZW-1");
    } finally { scena.rozjazdy = []; }
  });
});

/* ── Sito i tagi (0.315.0) ───────────────────────────────────────────────────
   Reklamacje i dyskusje mają je od 0.278.0 i 0.279.0. Zwroty dostały je
   decyzją właściciela z 13 września — razem z prowadzącym, którego ta sama
   rozmowa najpierw odrzuciła, a potem przywróciła.                          */
describe("Sito i tagi w kolejce zwrotów", () => {
  const zTagiem = (id: number, nazwa: string, kubelek: Kubelek = "decyzja") => ({
    ...zwrot(id, kubelek, `ZT-${id}`),
    tagi: [{ id: nazwa.length, nazwa }],
  });

  it("tag ZAWĘŻA listę, nie przestawia kolejności", async () => {
    /* Kolejność liczy termin ustawowy i to się nie zmienia: jedna pomyłka
       w tagu nie ma prawa zakopać zwrotu z zegarem na dole listy. */
    scena.zwroty = [zTagiem(11, "gwarancja"), zTagiem(12, "sporny")];
    try {
      pokaz();
      expect(screen.getAllByRole("listitem").length).toBe(2);
      /* Pigułka filtra i czip na wierszu noszą tę samą nazwę — bierzemy
         PIERWSZY przycisk, bo pasek stoi nad listą. */
      await userEvent.click(screen.getAllByRole("button", { name: /gwarancja/ })[0]);
      const po = screen.getAllByRole("listitem");
      expect(po.length).toBe(1);
      expect(po[0].textContent).toContain("ZT-11");
    } finally { scena.zwroty = null; }
  });

  it("pigułka tagu, którego w kubełku nie ma, się nie pokazuje", () => {
    /* Filtr obiecujący zawężenie do pustki uczy klikać na próżno. */
    scena.zwroty = [zwrot(13, "decyzja", "ZT-13")];
    try {
      pokaz();
      expect(screen.queryByRole("button", { name: /gwarancja/ })).toBeNull();
    } finally { scena.zwroty = null; }
  });
});
