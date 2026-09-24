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
  kwotaWariant: null, korektaNumer: null, korektaZrodlo: null, rejectionCode: null, wersja: 1, zrodlo: "allegro",
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
  szczegol: undefined as { pieniadze?: Record<string, unknown>; zwrot?: { id: number };
    kandydaciFaktury?: unknown[] } | undefined,
  /* Kartoteka dla skanu EAN-u (0.468.0): kod → towar. Pusta = kartoteka kodu
     nie zna, więc skan wraca do szukania zwrotu. */
  kartoteka: {} as Record<string, { twId: number; symbol: string }>,
  /* Odmowa zapisu kwoty dla szybkiej ścieżki (0.481.0); pusta = zapis przechodzi. */
  odmowaKwoty: "",
  /* Pudło, do którego serwer dołożył ocenioną pozycję. `null` znaczy „nie
     dołożył” — szybka ścieżka musi się wtedy zatrzymać przed kwotą. */
  koszykOceny: null as number | null,
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
    useKwota: () => {
      /* Odmowa zapisu kwoty — szybka ścieżka musi wtedy zamknąć kartę Allegro. */
      const a = atrapa("kwota");
      return { ...a, mutateAsync: async (dane: Record<string, unknown>) => {
        if (scena.odmowaKwoty) throw new Error(scena.odmowaKwoty);
        return a.mutateAsync(dane);
      } };
    },
    useCofnijKorekte: () => atrapa("cofnijKorekte"),
    useFaktura: () => atrapa("faktura"),
    usePotwierdzKartoteke: () => atrapa("kartoteka"),
    useZwrot: () => ({ data: scena.szczegol, isLoading: false, error: null }),
    useZwrocPieniadze: () => atrapa("zwrocPieniadze"),
    /* Skan i dołożenie towaru jako atrapy: test sprawdza, KTÓRĄ drogą poszedł
       kod, a prawdziwe mutacje strzelałyby `fetch`-em w nieistniejący serwer. */
    useSkanZwrotu: () => atrapa("skan"),
    useDolozTowar: () => ({
      isPending: false,
      mutate: (dane: Record<string, unknown>, opcje?: { onSuccess?: (w: unknown) => void }) => {
        scena.wolano.push({ co: "dolozTowar", dane });
        opcje?.onSuccess?.({ kod: "K-7", ilosc: 2 });
      },
    }),
    szukajTowaruDoKosza: async (q: string) => {
      const t = scena.kartoteka[q];
      return t
        ? { towary: [{ ...t, nazwa: "", ean: q, stanMag: null }], dokladne: true, przyblizone: false }
        : { towary: [], dokladne: false, przyblizone: false };
    },
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
    return { wersja: Number(dane.wersja ?? 1) + 1,
      koszyk: co === "ocena" ? scena.koszykOceny : null };
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
     narastają, i zmusza kolejne do rozmowy z właścicielem zamiast do cichego
     wejścia. Podniesienie progu jest wolne; ma tylko zostawić zdanie.

     PRÓG SCHODZI Z PIĘCIU DO CZTERECH (0.370.0) i to jest pierwszy raz, kiedy
     idzie w dół. Zgłoszenie właściciela: „uprość panel zwrotów do wymaganego
     minimum". Zeszły dwa pasma: filtrów (przewoźnik, daty, CSV — Synchronizuj
     wszedł do rzędu pola szukania) i sita z tagami. Zostają cztery: kubełki,
     szukanie, pytanie kubełka i pasek klawiszy.

     PASEK KLAWISZY ZOSTAJE, bo właściciel go nie wskazał, a dekalog p. 2 mówi
     wprost, że rozpoznanie jest tańsze od pamiętania. Traci tylko `m` i `n`,
     które prowadziły do zdjętego sita.

     Audyt z 15 września zbijał chrom, ale jego kryterium brzmiało „żadna
     zmiana nie kasuje funkcji" — to wydanie kryterium ZMIENIA, na wyraźną
     prośbę. Dlatego próg jest niższy, a nie tylko dotrzymany.               */
  it("nad listą stoją najwyżej cztery pasma — piąte wydałoby się samo", async () => {
    scena.zwroty = null;
    pokaz();
    const karta = document.querySelector(".card")!;
    /* Ostatnie dziecko to sama lista, reszta to chrom. */
    expect(karta.children.length - 1).toBeLessThanOrEqual(4);
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

  it("szuka po TREŚCI NOTATKI — numer sprawy Allegro nie ma innego pola (0.394.0)", async () => {
    /* Zgłoszenie nieodebranej paczki wraca z numerem, dla którego nie mamy
       własnej kolumny. Biuro pisze go w notatce i potem po nim szuka. */
    scena.zwroty = [
      { ...zwrot(1, "decyzja", "ZW-1"), notatka: "zgłoszone do Allegro, sprawa ALG-98765" },
      { ...zwrot(2, "zwrot", "ZW-2"), notatka: "awizo dwa razy" },
    ];
    try {
      pokaz();
      await userEvent.type(szukajka(), "ALG-98765");
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

  it("kolejność liczy ZEGAR USTAWOWY i nie ma jak jej przestawić", async () => {
    /* Blizna 0.121.0: termin steruje kolejnością pracy. Przełącznik „od daty
       nadania" zszedł w 0.370.0 razem z pasmem filtrów — odpowiadał na inne
       pytanie („co przyszło najdawniej") niż to, które prowadzi tę pracę. */
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wszystkie/ }));
    const kolejnosc = screen.getAllByRole("button").map((b) => b.textContent ?? "")
      .filter((t) => t.includes("ZW-"));
    expect(kolejnosc[0]).toContain("ZW-1");
    expect(screen.queryByLabelText(/Od daty nadania/)).toBeNull();
    expect(screen.queryByLabelText(/Przewoźnik/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Pobierz CSV/ })).toBeNull();
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

  it("`S` w DO DECYZJI przyjmuje i ocenia pierwszą pozycję — jednym klawiszem", async () => {
    /* Przegląd zwrotów z 23 września: kto ocenia towar na stan, ten zwrot
       przyjął. Ocena idzie z wersją ODDANĄ przez przyjęcie. */
    scena.wolano = [];
    pokaz("/obsluga/zwroty/1");
    await userEvent.keyboard("s");
    await waitFor(() => expect(scena.wolano.map((w) => w.co)).toEqual(["werdykt", "ocena"]));
    expect(scena.wolano[0].dane).toEqual({ id: 1, decyzja: "przyjety", powod: null, wersja: 1 });
    expect(scena.wolano[1].dane).toMatchObject({ ocena: "stan", wersja: 2 });
  });

  describe("Szybka ścieżka — `W` (0.481.0)", () => {
    /* Zwrot „wszystko w porządku": dwie pozycje, jedna z pewną propozycją
       kartoteki, druga już powiązana; wraca całe zamówienie z dostawą. */
    const pewny = (): Zwrot => {
      const z = zwrot(8, "decyzja", "ZW-8");
      return { ...z, linkZwrotu: "https://salescenter.allegro.com/returns?q=ZW-8",
        zamowienie: { externalId: "ord-8", status: null, kupujacyLogin: null,
          dostawaGrosze: 1500, dostawaMetoda: "InPost", platnoscTyp: null, platnoscAt: null,
          fakturaZadana: null, sumaGrosze: 6499, waluta: "PLN", kupionoAt: null, link: null,
          pozycje: [{ offerId: "1", nazwa: "Sekator", sku: null, ilosc: 1, cenaGrosze: 4999,
            waluta: "PLN", zwracana: true, wracaIlosc: 1 }] } as unknown as Zwrot["zamowienie"],
        pozycje: [
          { ...z.pozycje[0], id: 81, propozycja: { pewnosc: "sku", twId: 10, symbol: "SEK",
            zrodlo: "x", powod: null, poKolumnie: null } },
          { ...z.pozycje[0], id: 82, twId: 11, twSymbol: "FIL" },
        ] };
    };

    it("jeden klawisz: przyjęcie, kartoteka, ocena wszystkiego, kwota — potem Allegro", async () => {
      scena.wolano = [];
      scena.zwroty = [pewny()];
      scena.koszykOceny = 7;
      /* Karta otwiera się PUSTA w chwili klawisza, adres dostaje po kwocie. */
      const karta = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
      const otworz = vi.spyOn(window, "open").mockReturnValue(karta as unknown as Window);
      try {
        pokaz("/obsluga/zwroty/8");
        expect(screen.getByRole("button", { name: /Wszystko OK/ })).toHaveTextContent("114,98");
        await userEvent.keyboard("w");
        await waitFor(() => expect(karta.location.href).toContain("salescenter"));
        expect(otworz).toHaveBeenCalledTimes(1);
        expect(karta.opener).toBeNull();
        expect(scena.wolano.map((w) => w.co))
          .toEqual(["werdykt", "kartoteka", "ocena", "ocena", "kwota"]);
        /* Każdy zapis z wersją ODDANĄ przez poprzedni — blokada optymistyczna. */
        expect(scena.wolano[2].dane).toMatchObject({ pozycjaId: 81, ocena: "stan", wersja: 2 });
        expect(scena.wolano[3].dane).toMatchObject({ pozycjaId: 82, wersja: 3 });
        expect(scena.wolano[4].dane).toEqual({ id: 8, pozycjeIds: [81, 82], dostawa: true, wersja: 4 });
      } finally { scena.zwroty = null; scena.koszykOceny = null; otworz.mockRestore(); }
    });

    it("odmowa w połowie zamyka kartę Allegro — wypłata nie wyprzedza zapisu", async () => {
      scena.wolano = [];
      scena.zwroty = [pewny()];
      scena.koszykOceny = 7;
      scena.odmowaKwoty = "Zwrot zmienił się w międzyczasie";
      const karta = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
      const otworz = vi.spyOn(window, "open").mockReturnValue(karta as unknown as Window);
      try {
        pokaz("/obsluga/zwroty/8");
        await userEvent.keyboard("w");
        expect(await screen.findByText(/Zatrzymałem się: Zwrot zmienił się/)).toBeInTheDocument();
        expect(karta.close).toHaveBeenCalled();
        expect(karta.location.href).toBe("");
      } finally { scena.zwroty = null; scena.odmowaKwoty = ""; scena.koszykOceny = null; otworz.mockRestore(); }
    });

    it("pozycja poza pudłem zatrzymuje ciąg PRZED kwotą i zamyka kartę (0.484.2)", async () => {
      /* Serwer zapisał ocenę, ale do pudła nie dołożył (`koszyk: null`) —
         komplet bez składu, składnik poza magazynem. Pieniądze za towar,
         którego nie ma na MM, to dokładnie ten błąd, którego ciąg ma unikać. */
      scena.wolano = [];
      scena.zwroty = [pewny()];
      scena.koszykOceny = null;
      const karta = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
      const otworz = vi.spyOn(window, "open").mockReturnValue(karta as unknown as Window);
      try {
        pokaz("/obsluga/zwroty/8");
        await userEvent.keyboard("w");
        expect(await screen.findByText(/Sekator” nie weszła do pudła/)).toBeInTheDocument();
        expect(scena.wolano.map((w) => w.co)).toEqual(["werdykt", "kartoteka", "ocena"]);
        expect(karta.close).toHaveBeenCalled();
        expect(karta.location.href).toBe("");
      } finally { scena.zwroty = null; otworz.mockRestore(); }
    });

    it("przeszkoda zatrzymuje PRZED pierwszym zapisem i mówi dlaczego", async () => {
      scena.wolano = [];
      const z = pewny();
      scena.zwroty = [{ ...z, pozycje: [{ ...z.pozycje[1], potracenieGrosze: 500 }] }];
      const otworz = vi.spyOn(window, "open");
      try {
        pokaz("/obsluga/zwroty/8");
        expect(screen.getByRole("button", { name: /Wszystko OK/ })).toBeDisabled();
        expect(screen.getByText(/potrącenie albo brak sztuk/)).toBeInTheDocument();
        await userEvent.keyboard("w");
        expect(scena.wolano).toEqual([]);
        expect(otworz).not.toHaveBeenCalled();
      } finally { scena.zwroty = null; otworz.mockRestore(); }
    });
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

  it("pomoc pokazuje klawisze OGLĄDANEGO kubełka", async () => {
    pokaz("/obsluga/zwroty/1");
    /* Skróty siedzą pod „?" od 0.402.0 — reguła została ta sama: pokazane
       klawisze mają być TYMI, które naprawdę działają. */
    await userEvent.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));
    expect(screen.getByText("przyjmij")).toBeInTheDocument();
    expect(screen.queryByText("zapisz kwotę")).toBeNull();
    /* SITA ZESZŁY W 0.370.0 razem z klawiszami `m` i `n` (komentarz przy
       `useSkaner` w `Zwroty.tsx`). Pomoc obiecywała `n` jeszcze do 0.476.0,
       a klawisz nie robił nic — przegląd zwrotów z 23 września. Asercja wraca
       więc do postaci sprzed 0.315.0: pomoc nie ma prawa obiecywać `n`. */
    expect(screen.queryByText(/niczyje/)).toBeNull();
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
      /* Pomoc obiecuje klawisz dokładnie tam, gdzie on działa. */
      await userEvent.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));
      expect(screen.getByText("oddaj pieniądze")).toBeInTheDocument();
      await userEvent.keyboard("z");
      await waitFor(() => expect(scena.wolano.map((w) => w.co)).toEqual(["zwrocPieniadze"]));
      expect(scena.wolano[0].dane).toMatchObject({ id: 6 });
    } finally { scena.zwroty = null; scena.szczegol = undefined; }
  });

  it("Enter w DO KOREKTY najpierw przyjmuje podsunięty dokument sprzedaży (0.479.0)", async () => {
    /* Automat ZW bez dokumentu nie ruszy, więc brak dokumentu jest w tym
       kubełku pierwszą rzeczą do zrobienia. Pasek mówi to wprost. */
    scena.wolano = [];
    scena.zwroty = dwieKorekty();
    scena.szczegol = { ...pieniadze({}), zwrot: { id: 6 }, kandydaciFaktury: [
      { dokId: 500, numer: "PA 88/2026", typ: "PA", data: "2026-08-20",
        powody: ["numer zamówienia stoi w uwagach dokumentu"], pewny: true }] };
    try {
      pokaz("/obsluga/zwroty/6");
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(scena.wolano.map((w) => w.co)).toEqual(["faktura"]));
      expect(scena.wolano[0].dane).toEqual({ id: 6, dokId: 500 });
      await userEvent.click(screen.getByRole("button", { name: /Skróty klawiszowe/ }));
      expect(screen.getByText("przyjmij dokument sprzedaży")).toBeInTheDocument();
      expect(screen.queryByText("wpisz numer korekty")).toBeNull();
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
describe("Czego w kolejce zwrotów JUŻ NIE MA (0.370.0)", () => {
  /* Zgłoszenie właściciela: „uprość panel zwrotów do wymaganego minimum",
     a po pytaniu o szczegóły wskazanie wprost: sito Moje/Niczyje, tagi
     spraw, filtry przewoźnika i dat, Pobierz CSV — i „usunąć zupełnie".

     Ten test stoi w miejscu trzech, które pilnowały sita i tagów. Pilnuje
     rzeczy odwrotnej i jest tu potrzebny z tego samego powodu, dla którego
     one były: sito przy zwrotach wracało już raz tego samego dnia, w którym
     zeszło (0.315.0). Bez tej asercji trzeci powrót przeszedłby po cichu. */
  it("sita, tagów i filtrów nie ma na ekranie", async () => {
    scena.zwroty = [{ ...zwrot(11, "decyzja", "ZT-11"), przewoznik: "DPD" }];
    try {
      pokaz();
      for (const czego of [/Moje/, /Niczyje/, /gwarancja/, /Pobierz CSV/]) {
        expect(screen.queryByRole("button", { name: czego })).toBeNull();
      }
      expect(screen.queryByLabelText(/Przewoźnik/)).toBeNull();
      expect(screen.queryByLabelText(/Paczka u nas/)).toBeNull();
      /* Sam wiersz zostaje nietknięty — zeszły sita, nie kolejka. */
      expect(screen.getAllByRole("listitem").length).toBe(1);
    } finally { scena.zwroty = null; }
  });

  /* ── ETYKIETA CZY TOWAR (0.468.0) ──────────────────────────────────────
     Zgłoszenie właściciela: „zakładka zwrotów powinna cały czas nasłuchiwać
     skanu etykiety zwrotowej oraz odróżniać ją od skanu EAN-u produktu".
     Decyzja: EAN znany kartotece idzie do koszyka. */

  /** Czytnik poza polem: seria znaków bez przerwy, na końcu Enter. */
  const czytnik = (kod: string) => {
    for (const znak of kod) window.dispatchEvent(new KeyboardEvent("keydown", { key: znak }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  };

  it("EAN towaru z kartoteki idzie do koszyka, nie do szukania zwrotu", async () => {
    scena.wolano.length = 0;
    scena.kartoteka = { "5901234123457": { twId: 504, symbol: "FT0114" } };
    pokaz();
    czytnik("5901234123457");
    expect(await screen.findByText("FT0114 → koszyk K-7: 2 szt.")).toBeInTheDocument();
    expect(scena.wolano).toEqual([{ co: "dolozTowar", dane: { twId: 504, ilosc: 1, rodzaj: "zwroty" } }]);
    scena.kartoteka = {};
  });

  it("etykieta zwrotu idzie do szukania, nie do koszyka", async () => {
    scena.wolano.length = 0;
    pokaz();
    czytnik("600000367616070023174201");
    await waitFor(() => expect(scena.wolano.map((w) => w.co)).toEqual(["skan"]));
  });

  it("kod w kształcie EAN-u, którego kartoteka nie zna, wraca do szukania zwrotu", async () => {
    /* Cyfrowa etykieta przewoźnika bywa przypadkiem zgodna z cyfrą kontrolną. */
    scena.wolano.length = 0;
    scena.kartoteka = {};
    pokaz();
    czytnik("5901234123457");
    await waitFor(() => expect(scena.wolano.map((w) => w.co)).toEqual(["skan"]));
  });

  it("etykieta zeskanowana przy kursorze w polu loginu nie zostaje w polu", async () => {
    /* „Cały czas nasłuchiwać" — także wtedy, gdy kursor stoi w innym polu. */
    scena.wolano.length = 0;
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: "Paczki klienta" }));
    const login = screen.getByLabelText("Login, nazwisko albo telefon");
    await userEvent.type(login, "jan");
    /* `userEvent` pisze szybciej niż czytnik. Człowiek robi pauzę, zanim
       sięgnie po czytnik — bez niej „jan" byłby początkiem serii skanu. */
    await new Promise((r) => setTimeout(r, 80));
    for (const znak of "600000367616070023174201") {
      login.dispatchEvent(new KeyboardEvent("keydown", { key: znak, bubbles: true, cancelable: true }));
    }
    login.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await waitFor(() => expect(scena.wolano).toEqual(
      [{ co: "skan", dane: "600000367616070023174201" }]));
    expect(login).toHaveValue("jan");
  });
});
