import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Decyzje } from "./Decyzje";
import type { Zwrot } from "../api/typy";

/* ── Pasek decyzji (0.156.0) ─────────────────────────────────────────────────
   Do tego wydania kolejka bramek była DEKORACJĄ: klawisze stały jako podpisy,
   a kolumny, po których routuje `kubelekZwrotu`, nie miały ani jednego
   zapisu. Każdy zwrot stał w DO DECYZJI na zawsze. */

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
  pozycje: [
    { id: 11, zrodlo: "allegro", offerId: "of-1", ofertaZamowienia: null, ofertaZdjecie: "nieznane" as const, nazwa: "Szarpak", ilosc: 1, cenaGrosze: 4999,
      waluta: "PLN", powod: null, powodKomentarz: null, ocena: "stan", wKoszyku: false, iloscZwrocona: null, url: null,
      twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null } },
    { id: 12, zrodlo: "allegro", offerId: "of-2", ofertaZamowienia: null, ofertaZdjecie: "nieznane" as const, nazwa: "Filtr", ilosc: 1, cenaGrosze: 4999,
      waluta: "PLN", powod: null, powodKomentarz: null, ocena: "stan", wKoszyku: false, iloscZwrocona: null, url: null,
      twId: null, twSymbol: null, twZrodlo: null, sku: null, ean: null, potracenieGrosze: null, potraceniePowod: null, propozycja: null,
      rabat: { stan: "brak", lineItemId: "li-1", ilosc: 1, wniosekId: null,
      prowizjaGrosze: null, waluta: null, typ: null, powod: null, zrodlo: null } },
  ],
  ...n,
});

const pasek = (z: Zwrot, h: Partial<Parameters<typeof Decyzje>[0]> = {}) =>
  render(<Decyzje zwrot={z} onWerdykt={vi.fn()}
    onKorekta={vi.fn()} onCofnijKorekte={vi.fn()} onCofnijKwote={vi.fn()}
    onCofnijWerdykt={vi.fn()} trwa={false} blad="" {...h} />);

describe("Decyzje zwrotu", () => {
  it("przyjęcie idzie jednym kliknięciem, bez pytania o nic", () => {
    const onWerdykt = vi.fn();
    pasek(zwrot(), { onWerdykt });
    screen.getByRole("button", { name: /Przyjmij/ }).click();
    expect(onWerdykt).toHaveBeenCalledWith("przyjety", null);
  });

  it("odmowa NIE wychodzi bez powodu — jest nieodwracalna", async () => {
    /* §25a.5: potwierdzenie dostają dwie rzeczy nieodwracalne, a odmowa jest
       jedną z nich. Zwrot odrzucony bez uzasadnienia nie da się obronić
       przed klientem. */
    const onWerdykt = vi.fn();
    pasek(zwrot(), { onWerdykt });
    await userEvent.click(screen.getByRole("button", { name: /Odrzuć/ }));

    const potwierdz = screen.getByRole("button", { name: /Potwierdź odmowę/ });
    expect(potwierdz).toBeDisabled();
    expect(onWerdykt).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Powód/), "Towar użyty");
    await userEvent.click(potwierdz);
    expect(onWerdykt).toHaveBeenCalledWith("odrzucony", "Towar użyty");
  });

  it("Enter w polu powodu potwierdza odmowę, a pusty powód dalej nie", async () => {
    /* Audyt zwrotów, 15 września 2026: wpisany powód JEST potwierdzeniem
       z §25a.5 — sięganie po mysz po nim nie dodaje namysłu. */
    const onWerdykt = vi.fn();
    pasek(zwrot(), { onWerdykt });
    await userEvent.click(screen.getByRole("button", { name: /Odrzuć/ }));
    await userEvent.type(screen.getByLabelText(/Powód/), "{Enter}");
    expect(onWerdykt).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Powód/), "Towar użyty{Enter}");
    expect(onWerdykt).toHaveBeenCalledWith("odrzucony", "Towar użyty");
  });

  it("stan końcowy nie proponuje decyzji", () => {
    pasek(zwrot({ kubelek: "zamkniety" }));
    expect(screen.queryByRole("button", { name: /Przyjmij|Zapisz kwotę/ })).toBeNull();
  });

  it("ocena i wycena nie mają paska — ich pytanie zadaje wiersz produktu", () => {
    /* Od 0.167.0 pasek dotyczy CAŁEGO zwrotu. Gdyby został przy pozycjach,
       te same nazwy stałyby na ekranie dwa razy: raz jako kontrolka, raz
       jako produkt ze zdjęciem. */
    const { container } = pasek(zwrot({ kubelek: "ocena" }));
    expect(container).toBeEmptyDOMElement();
    const drugi = pasek(zwrot({ kubelek: "zwrot" }));
    expect(drugi.container).toBeEmptyDOMElement();
  });
});

describe("Odmowa zwrotu (0.210.0)", () => {
  it("etykieta NIE obiecuje, że powód zobaczy klient", async () => {
    /* Jedyna nieprawda, jaka stała na tym ekranie. Allegro nie zna pojęcia
       „odrzuć zwrot" — końcówka `rejection` odmawia WYPŁATY. Nasz werdykt
       nigdzie nie wychodzi, więc klient nie dowie się nic sam. */
    pasek(zwrot());
    await userEvent.click(screen.getByRole("button", { name: /Odrzuć/ }));
    expect(screen.getByText(/Powód odmowy — zostaje u nas/)).toBeInTheDocument();
    expect(screen.queryByText(/zobaczy go klient/)).toBeNull();
    expect(screen.getByText(/Klientowi trzeba powiedzieć osobno/)).toBeInTheDocument();
  });

  it("na zwrocie odrzuconym POWÓD JEST WIDOCZNY, z klawiszem kopiowania", () => {
    /* Zapisywał się do bazy i nikt go nie czytał — ani panel, ani nic innego.
       Operator, który ma napisać klientowi, musiał pamiętać własne zdanie
       sprzed tygodnia. */
    pasek(zwrot({ kubelek: "odrzucony", werdykt: "odrzucony",
      werdyktPowod: "towar nosi ślady użycia" }));
    expect(screen.getByText("towar nosi ślady użycia")).toBeInTheDocument();
    expect(screen.getByTitle("Kopiuj powód odmowy")).toBeInTheDocument();
    expect(screen.queryByText(/nie ma tu decyzji do podjęcia/)).toBeNull();
  });

  it("stan końcowy BEZ powodu mówi po staremu — nie ma czego pokazać", () => {
    pasek(zwrot({ kubelek: "zamkniety", werdykt: "przyjety" }));
    expect(screen.getByText(/nie ma tu decyzji do podjęcia/)).toBeInTheDocument();
  });
});

describe("Cofnięcie przyjęcia (0.204.0)", () => {
  /* Przyjęcie idzie jednym kliknięciem, bez pytania o nic — i tak ma zostać.
     Kliknięcie bez pytania musi jednak mieć drogę powrotną. */
  /* Pozycje BEZ oceny — fabryka `zwrot()` daje je ocenione, a tu chodzi
     dokładnie o chwilę tuż po kliknięciu „Przyjmij". */
  const doOceny = (n: Partial<Zwrot> = {}) => {
    const z = zwrot({ kubelek: "ocena", werdykt: "przyjety", ...n });
    z.pozycje = z.pozycje.map((p) => ({ ...p, ocena: null }));
    return z;
  };

  it("świeżo przyjęty zwrot daje się cofnąć jednym zdaniem, nie ramką", async () => {
    const onCofnijWerdykt = vi.fn();
    pasek(doOceny(), { onCofnijWerdykt });
    expect(screen.getByText(/Zwrot przyjęty/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /cofnij przyjęcie/i }));
    expect(onCofnijWerdykt).toHaveBeenCalled();
  });

  it("po pierwszej ocenie klawisz znika — schodzi się po JEDNYM szczeblu", () => {
    /* Serwer odmówiłby („najpierw cofnij oceny"), a przycisk, po którym zawsze
       przychodzi błąd, uczy ignorować komunikaty. */
    const z = doOceny();
    z.pozycje = [{ ...z.pozycje[0], ocena: "stan" }, ...z.pozycje.slice(1)];
    pasek(z);
    expect(screen.queryByRole("button", { name: /cofnij przyjęcie/i })).toBeNull();
  });

  it("w kubełku DO ZWROTU paska nie ma wcale", () => {
    /* Wszystko ocenione, więc cofnięcie werdyktu i tak by odpadło; pytanie
       tego ekranu zadaje wiersz produktu. */
    const { container } = pasek(zwrot({ kubelek: "zwrot", werdykt: "przyjety" }));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Korekta zwrotu (0.162.0)", () => {
  const doKorekty = (n: Partial<Zwrot> = {}) => zwrot({
    kubelek: "korekta", werdykt: "przyjety", kwotaGrosze: 9998, kwotaWariant: "pelna", ...n });

  it("mówi wprost, że korekty nie wystawia panel, tylko człowiek w Subiekcie", () => {
    /* Przycisk bez tego zdania obiecywałby, że coś wychodzi do Subiekta —
       a stamtąd wraca tylko numer, przepisany ręką. */
    pasek(doKorekty());
    expect(screen.getByText(/wystawiasz w Subiekcie/i)).toBeInTheDocument();
  });

  it("NIE odsyła po pieniądze do panelu Allegro — przycisk jest niżej", () => {
    /* Audyt zwrotów, 15 września 2026. Zdanie „oddajesz w panelu Allegro" stało
       tu od 0.162.0 i po 0.190.0 było już nieprawdą. Na nagraniu z pracy
       operator oddawał pieniądze w Sales Center, obok gotowego przycisku. */
    pasek(doKorekty());
    expect(screen.queryByText(/w panelu Allegro/i)).toBeNull();
    expect(screen.getByText(/ODDAJ PIENIĄDZE/)).toBeInTheDocument();
  });

  it("kwota ma tu DROGĘ WYJŚCIA — to ostatni ekran przed korektą", async () => {
    /* §25a.5 obiecuje cofnięcie wszędzie poza oddaniem pieniędzy i odmową.
       Do 0.202.0 kwota była z tej obietnicy wyjęta: pasek wyceny znika razem
       z kubełkiem DO ZWROTU, więc pomyłka w zaznaczeniu zostawała na zawsze. */
    const onCofnijKwote = vi.fn();
    pasek(doKorekty(), { onCofnijKwote });
    expect(screen.getByText("99,98 PLN")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /popraw kwotę/i }));
    expect(onCofnijKwote).toHaveBeenCalled();
  });

  it("pusty numer nie domyka zwrotu", async () => {
    const onKorekta = vi.fn();
    pasek(doKorekty(), { onKorekta });
    expect(screen.getByRole("button", { name: /Zapisz korektę/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Numer korekty/), "KFS 12/2026");
    await userEvent.click(screen.getByRole("button", { name: /Zapisz korektę/ }));
    expect(onKorekta).toHaveBeenCalledWith("KFS 12/2026");
  });

  it("Enter w polu zapisuje — klawisz z §25a.2, nie sama myszka", async () => {
    const onKorekta = vi.fn();
    pasek(doKorekty(), { onKorekta });
    await userEvent.type(screen.getByLabelText(/Numer korekty/), "KFS 13/2026{Enter}");
    expect(onKorekta).toHaveBeenCalledWith("KFS 13/2026");
  });

  it("zamknięty zwrot pokazuje numer i daje go cofnąć", async () => {
    /* §25a.5: cofnięcie zamiast potwierdzenia. Numer przepisany z Subiekta
       bywa literówką i to jest normalne zdarzenie, nie awaria. */
    const onCofnijKorekte = vi.fn();
    pasek(zwrot({ kubelek: "zamkniety", korektaNumer: "KFS 12/2026" }), { onCofnijKorekte });
    expect(screen.getByText("KFS 12/2026")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Cofnij korektę/ }));
    expect(onCofnijKorekte).toHaveBeenCalled();
  });

  it("zwrot odrzucony nie ma czego cofać — to stan końcowy bez korekty", () => {
    pasek(zwrot({ kubelek: "odrzucony", werdykt: "odrzucony" }));
    expect(screen.getByText(/Stan końcowy/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cofnij korektę/ })).toBeNull();
  });

  it("mówi, czy numer korekty znalazł automat, czy przepisał człowiek", () => {
    /* Ta sama zasada co przy dokumencie sprzedaży (§4.3): fakt z danych nie
       ma udawać czyjejś decyzji, a decyzja nie ma udawać faktu. */
    pasek(zwrot({ kubelek: "zamkniety", korektaNumer: "KFS 12/2026",
      korektaZrodlo: "subiekt" }), { onCofnijKorekte: vi.fn() });
    expect(screen.getByText(/Znaleziona w Subiekcie/)).toBeInTheDocument();
  });

  it("cofnięcie korekty znalezionej przez automat jest tak samo dostępne", () => {
    /* Cofnięcie cudzej pomyłki nie ma być trudniejsze niż własnej. */
    pasek(zwrot({ kubelek: "zamkniety", korektaNumer: "KFS 12/2026",
      korektaZrodlo: "subiekt" }), { onCofnijKorekte: vi.fn() });
    expect(screen.getByRole("button", { name: /Cofnij korektę/ })).toBeEnabled();
  });

  it("zlecony automat mówi, że numer przyjdzie sam — bez zachęty do ręcznego ZW", () => {
    /* 0.349.0. „Wystawiasz w Subiekcie" przy czekającym automacie kończyłoby się
       drugim dokumentem obok tego, który właśnie powstaje. */
    pasek(doKorekty({ zw: { status: "pending", numer: null, blad: null } }));
    expect(screen.getByText(/Automat wystawia ZW/)).toBeInTheDocument();
    expect(screen.queryByText(/wystawiasz w Subiekcie/i)).toBeNull();
  });

  it("błąd automatu odsyła do ręcznego ZW i mówi dlaczego", () => {
    pasek(doKorekty({ zw: { status: "error", numer: null,
      blad: "Wartość ZW 10,00 zł nie zgadza się z pełną wartością zwrotu 12,00 zł." } }));
    expect(screen.getByText(/Automat nie wystawił ZW/)).toHaveTextContent(/Wartość ZW 10,00 zł/);
  });

  it("numer z automatu podpisuje się jako wystawiony automatycznie", () => {
    pasek(zwrot({ kubelek: "zamkniety", korektaNumer: "ZW 9/MAG/09/2026",
      korektaZrodlo: "sfera" }), { onCofnijKorekte: vi.fn() });
    expect(screen.getByText(/Wystawiona automatycznie/)).toBeInTheDocument();
  });
});