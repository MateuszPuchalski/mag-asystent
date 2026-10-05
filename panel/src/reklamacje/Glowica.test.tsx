import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type {
  DopasowanieKartoteki, Reklamacja, SzczegolReklamacji, WiadomoscReklamacji, Zamowienie,
} from "../api/typy";
import { Dowody } from "./Dowody";
import { Glowica, kartotekaKolumny } from "./Glowica";

/* Kolumna faktów pyta o cennik kartoteki (`useKartaTowaru`), a ten plik nie
   stawia klienta TanStacka — pilnuje UKŁADU głowicy i zwijek, nie cen. Własne
   testy cennik ma w `skrzynka/TowarRozmowy.test.tsx`. */
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: () => ({ data: undefined, isLoading: false, error: null }),
}));

/* ── Głowica sprawy ──────────────────────────────────────────────────────────
   Pas na całą szerokość obszaru sprawy, nad rozmową, dowodami i faktami.
   Te testy pilnują reguł głowicy. Gałęzie zdań A i B sprawdza tabela
   w `etap.test.ts`; tu sprawdzamy, że głowica je pokazuje.

   1. KLIENT NA CZELE. Uwaga właściciela: „Client powinien być bardziej
      widoczny". Login jest nagłówkiem sprawy, a obok stoją profil, historia
      i liczba jego innych reklamacji.
   2. TO, CO ROZSTRZYGA, STOI NA WIERZCHU. Czego klient chce i za ile, do kiedy
      decydować — bez otwierania czegokolwiek. Termin mówi „za ile", nie
      „którego", bo odejmowanie dat w głowie to praca, którą ekran ma zdjąć.
   3. TERMIN TYLKO PRZED WERDYKTEM. Po nim liczba dni nie rozstrzyga niczego.
   4. SŁOWA, NIE KODY. Surowy status Allegro stoi w podpowiedzi zdania.
   5. SYGNATURA MÓWI, SKĄD JEST — z paragonu albo z dzisiejszego mapowania
      oferty. To dwie różne rzeczy i ekran je rozróżnia.
   6. KOLUMNA FAKTÓW NIE POWTARZA GŁOWICY — jeden dom na fakt.            */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, externalId: "i-5", numer: "2743634/2026", orderId: "ord-5", offerId: "of-1",
  kupujacyLogin: "Client:43897233", prawo: "COMPLAINT",
  powodTyp: "DEFECT_FOUND_DURING_USE", powodOpis: null, temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 6825, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: "2026-09-24T21:59:00.000Z",
  dniDoTerminu: 6, poTerminie: false, zwrotWymagany: true,
  czatAktywny: true, wiadomosciIle: 11, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-10T06:03:00.000Z", kupionoAt: null, kupionoZrodlo: null,
  prowadzi: null, prowadziId: null, prowadziAt: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, notatka: null,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null,
  linkOferty: null, ofertaNazwa: "GAŹNIK DO STIHL MS181", ofertaZdjecie: "brak",
  twId: 11, twSymbol: "W09-0804", twZParagonu: true, ...n,
} as unknown as Reklamacja);

const ZAMOWIENIE = {
  externalId: "ord-5", dostawaGrosze: 0, dostawaMetoda: "Allegro Paczkomaty InPost",
  sumaGrosze: 7874, waluta: "PLN", kupionoAt: "2026-09-03T05:57:00.000Z",
  pozycje: [
    { offerId: "of-9", sku: null, nazwa: "FILTR PALIWA", ilosc: 1, cenaGrosze: 1049, waluta: "PLN" },
    { offerId: "of-1", sku: "W09-0804", nazwa: "GAŹNIK DO STIHL MS181", ilosc: 1,
      cenaGrosze: 6825, waluta: "PLN" },
  ],
} as unknown as Zamowienie;

const wiad = (n: Partial<WiadomoscReklamacji>): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "Client:43897233", autorRola: "BUYER",
  tresc: "Gaźnik nie trzyma obrotów", utworzonoAt: "2026-09-12T08:15:00.000Z", zalaczniki: [], ...n,
});

const szczegol = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  reklamacja: rek(r), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [],
  droga: [], kartoteka: null, karta: null, zamowienie: null, przesylka: null, ...n,
} as unknown as SzczegolReklamacji);

/* Router, bo głowica prowadzi łączem na profil klienta. */
const glowica = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {},
  inne: Partial<React.ComponentProps<typeof Glowica>> = {}) =>
  render(<MemoryRouter><Glowica szczegol={szczegol(n, r)} trwa={false} onProwadze={vi.fn()} {...inne} /></MemoryRouter>);

/** Zdanie A głowicy — rozpoznajemy je po podpowiedzi ze statusem Allegro. */
const zdanieA = () => screen.getByTitle(/^Status w Allegro|^Allegro nie podało statusu/);

const props = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  szczegol: szczegol(n, r), trwa: false, bladZapisu: "", onNotatka: vi.fn(),
});

describe("Klient na czele głowicy", () => {
  it("login jest nagłówkiem sprawy i da się go skopiować kliknięciem", () => {
    glowica();
    expect(screen.getByRole("heading", { name: /Client:43897233/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Client:43897233/ }))
      .toHaveAttribute("title", "Kopiuj login: Client:43897233");
  });

  it("obok loginu stoją profil i historia — osobne cele, nie klik w login", () => {
    glowica();
    expect(screen.getByRole("link", { name: "profil" }))
      .toHaveAttribute("href", "/obsluga/klient/Client%3A43897233");
    expect(screen.getByRole("button", { name: "Historia" })).toBeInTheDocument();
  });

  it("liczba innych reklamacji klienta stoi tylko wtedy, gdy serwer ją podał", () => {
    const { unmount } = glowica({ historia: { towar: null, klient: { ile: 2, uznanych: 1, odrzuconych: 1 } } });
    expect(screen.getByText("jeszcze 2 reklamacje u nas (1 uznana, 1 odrzucona)")).toBeInTheDocument();
    unmount();
    /* `null` miesza zero z „nie wiemy", więc nic nie dochodzi — nigdy „pierwsza". */
    glowica({ historia: { towar: null, klient: null } });
    expect(screen.queryByText(/u nas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pierwsza/)).not.toBeInTheDocument();
  });

  it("bez loginu mówi, że Allegro go nie podało — bez profilu, historii i liczby", () => {
    glowica({ historia: { towar: null, klient: { ile: 2, uznanych: 0, odrzuconych: 0 } } },
      { kupujacyLogin: null });
    expect(screen.getByRole("heading", { name: "kupujący: Allegro nie podało loginu" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "profil" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Historia" })).not.toBeInTheDocument();
    expect(screen.queryByText(/u nas/)).not.toBeInTheDocument();
  });

  it("otwarta inna sprawa tego zakupu stoi przy kliencie i prowadzi do listy", async () => {
    const onPokazZakup = vi.fn();
    const sprawy = [
      { id: 8, typ: "DISPUTE", numer: null, temat: "inna", statusAllegro: null, decyzjaDo: null,
        otwartoAt: "2026-09-12T08:15:00.000Z", prowadzi: null, otwarta: true },
      { id: 9, typ: "CLAIM", numer: "9/2026", temat: "stara", statusAllegro: null, decyzjaDo: null,
        otwartoAt: "2026-09-01T08:15:00.000Z", prowadzi: null, otwarta: false },
    ];
    glowica({ sprawy } as Partial<SzczegolReklamacji>, {}, { onPokazZakup });
    await userEvent.click(screen.getByRole("button", { name: /jeszcze 1 otwarta sprawa tego zakupu/ }));
    expect(onPokazZakup).toHaveBeenCalledTimes(1);
  });

  it("zamknięta inna sprawa nie zapala wskaźnika — to nie jest klient, który czeka", () => {
    glowica({ sprawy: [{ id: 9, typ: "CLAIM", numer: "9/2026", temat: "stara", statusAllegro: null,
      decyzjaDo: null, otwartoAt: "2026-09-01T08:15:00.000Z", prowadzi: null, otwarta: false }] });
    expect(screen.queryByText(/otwart.* tego zakupu/)).not.toBeInTheDocument();
  });
});

describe("Głowica niesie to, co rozstrzyga", () => {
  it("czego klient chce i ZA ILE stoi na wierzchu, bez otwierania czegokolwiek", () => {
    glowica();
    expect(screen.getByText("zwrot pieniędzy")).toBeInTheDocument();
    expect(screen.getByText("68,25 PLN")).toBeInTheDocument();
  });

  it("bez kwoty zostaje SŁOWO oczekiwania, a nie puste miejsce po liczbie", () => {
    glowica({}, { oczekiwanaKwotaGrosze: null });
    expect(screen.getByText("zwrot pieniędzy")).toBeInTheDocument();
    expect(screen.queryByText(/PLN/)).not.toBeInTheDocument();
  });

  it("linia „Chce:” niesie powód i tytuł prawny słowem, nie kodem Allegro", () => {
    const { unmount } = glowica();
    const chce = screen.getByText("Chce:").parentElement!;
    expect(chce).toHaveTextContent("usterka przy używaniu");
    expect(chce).toHaveTextContent("rękojmia");
    expect(screen.queryByText("COMPLAINT")).not.toBeInTheDocument();
    unmount();
    glowica({}, { prawo: "WARRANTY" });
    expect(screen.getByText("gwarancja")).toBeInTheDocument();
  });

  it("nazwa towaru stoi pod kreską jako zdanie, nie jako nagłówek — nagłówkiem jest klient", () => {
    glowica();
    expect(screen.getByText("GAŹNIK DO STIHL MS181")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "GAŹNIK DO STIHL MS181" })).not.toBeInTheDocument();
  });

  it("numer i data zgłoszenia stoją pod „Prowadzi”, a numer da się skopiować", () => {
    glowica({}, { link: "https://allegro.pl/reklamacja/5" });
    expect(screen.getByText("2743634/2026")).toBeInTheDocument();
    expect(screen.getByText(/^zgłoszona /)).toBeInTheDocument();
    /* Przycisk kopiowania nie niesie numeru w nazwie — kolejka szuka wierszy
       po numerze i drugi przycisk z nim w nazwie byłby drugim wierszem. */
    expect(screen.getByTitle("Kopiuj numer reklamacji")).toHaveAccessibleName("Kopiuj");
    expect(screen.queryByRole("button", { name: /2743634/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reklamacja w Allegro" }))
      .toHaveAttribute("href", "https://allegro.pl/reklamacja/5");
  });

  it("bez adresu w Allegro nie ma martwego łącza", () => {
    glowica();
    expect(screen.queryByRole("link", { name: "Reklamacja w Allegro" })).not.toBeInTheDocument();
  });

  it("termin mówi ZA ILE, a datę zostawia obok", () => {
    glowica();
    expect(zdanieA()).toHaveTextContent(/^Czeka na naszą decyzję — termin za 6 dni \(24\.09\.2026, /);
    expect(screen.getByText("za 6 dni")).toBeInTheDocument();
  });

  it("PO TERMINIE mówi o sobie wprost — to nie jest „za −1 dzień”", () => {
    glowica({}, { poTerminie: true, dniDoTerminu: -1 });
    expect(screen.getByText("minął").className).toContain("text-ranga-zle");
  });

  it("po NASZYM werdykcie termin znika, a etap mówi jego nazwą", () => {
    glowica({}, { werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy",
      werdyktStatus: "sent", poTerminie: true, dniDoTerminu: -3 });
    expect(zdanieA()).toHaveTextContent(
      "Werdykt „Uznana — zwrot pieniędzy” wysłany — czekamy, aż Allegro potwierdzi.");
    expect(zdanieA()).not.toHaveTextContent(/termin/);
  });

  it("nieudany werdykt werdyktem nie jest — termin zostaje", () => {
    glowica({}, { werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy",
      werdyktStatus: "send_failed" });
    expect(zdanieA()).toHaveTextContent(/^Werdykt nie przeszedł/);
    expect(screen.getByText("za 6 dni")).toBeInTheDocument();
  });

  it("werdykt z Centrum Sprzedaży mówi, skąd jest — i też zdejmuje termin", () => {
    glowica({}, { statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" });
    expect(zdanieA()).toHaveTextContent("Uznana w Centrum Sprzedaży, poza panelem.");
    expect(zdanieA()).not.toHaveTextContent(/termin/);
  });

  it("status Allegro stoi słowem, a dokładna wartość zostaje pod kursorem", () => {
    glowica();
    expect(screen.queryByText(/CLAIM_SUBMITTED/)).not.toBeInTheDocument();
    expect(zdanieA()).toHaveAttribute("title", "Status w Allegro: CLAIM_SUBMITTED");
  });

  it("status, którego nic nie tłumaczy, stoi jawnie zamiast zniknąć", () => {
    glowica({}, { statusAllegro: "CLAIM_COS_NOWEGO" });
    expect(zdanieA()).toHaveTextContent("Allegro podało status, którego nie znamy: CLAIM_COS_NOWEGO");
  });

  it("ostatnie słowo mówi, czyj jest ruch — automat Allegro go nie przejmuje", () => {
    glowica({ czat: [
      wiad({ id: 1, autorRola: "SELLER", autorLogin: "sklep" }),
      wiad({ id: 2, autorRola: "BUYER" }),
      wiad({ id: 3, autorRola: "SYSTEM", autorLogin: null }),
    ] });
    expect(screen.getByText(/^Ostatnia wiadomość od klienta: /)).toBeInTheDocument();
  });

  it("po naszej odpowiedzi ostatnie słowo jest NASZE", () => {
    glowica({ czat: [wiad({ id: 1 }), wiad({ id: 2, autorRola: "SELLER", autorLogin: "sklep" })] });
    expect(screen.getByText(/^Ostatnia wiadomość nasza: /)).toBeInTheDocument();
  });

  it("klient czekający na nas dostaje bursztyn i kropkę — ten sam sygnał co czip kolejki", () => {
    glowica({ czat: [wiad({ id: 1 })] }, { sygnaly: ["klient_czeka"] });
    const zdanie = screen.getByText(/czeka na naszą odpowiedź/);
    expect(zdanie.className).toContain("text-ranga-uwaga");
    expect(zdanie.querySelector(".rounded-full")).not.toBeNull();
  });

  it("los towaru wg Allegro stoi zdaniem przed werdyktem", () => {
    glowica();
    expect(screen.getByText(/Towar ma wrócić do nas \(tak podaje Allegro\)\./)).toBeInTheDocument();
  });
});

describe("Wiersz towaru mówi, skąd jest sygnatura", () => {
  it("sygnatura Z PARAGONU jest tak podpisana", () => {
    glowica();
    expect(screen.getByText("W09-0804")).toBeInTheDocument();
    expect(screen.getByText("z paragonu")).toBeInTheDocument();
  });

  it("sygnatura z dzisiejszego mapowania NIE udaje paragonu", () => {
    glowica({}, { twZParagonu: false });
    expect(screen.getByText("z mapowania oferty")).toBeInTheDocument();
    expect(screen.queryByText("z paragonu")).not.toBeInTheDocument();
  });

  it("bez kartoteki mówi ZDANIEM serwera, czemu jej nie ma — nie kodem powodu", () => {
    glowica({ kartoteka: { pewnosc: "brak", twId: null, symbol: null,
      zrodlo: "oferta nie ma SKU", powod: "brak_sku" } }, { twId: null, twSymbol: null });
    expect(screen.getByText("oferta nie ma SKU")).toBeInTheDocument();
    expect(screen.queryByText("brak_sku")).not.toBeInTheDocument();
  });

  it("sygnatura z SKU oferty mówi, że stoi za nią SKU, a nie paragon ani człowiek", () => {
    glowica({ kartoteka: { pewnosc: "sku", twId: 42, symbol: "14-25001",
      zrodlo: "SKU oferty", powod: null } }, { twId: null, twSymbol: null });
    expect(screen.getByText("14-25001")).toBeInTheDocument();
    expect(screen.getByText("z SKU oferty")).toBeInTheDocument();
  });

  it("bez oferty mówi to wprost, zamiast pustej linii", () => {
    glowica({}, { ofertaNazwa: null });
    expect(screen.getByText("Oferty nie pobrano")).toBeInTheDocument();
  });
});

describe("Kartoteka efektywna", () => {
  /* Symbol z sugestii po SKU, a stan z samego `twId` sprawy, to dwa różne
     towary na jednym ekranie. Paragon i mapowanie wygrywają; bez nich liczy
     się wyłącznie kartoteka wywiedziona pewnie — ta sama reguła co na serwerze. */
  const k = (pewnosc: DopasowanieKartoteki["pewnosc"], twId: number | null): DopasowanieKartoteki =>
    ({ pewnosc, twId, symbol: "X", zrodlo: "zdanie serwera", powod: null });
  const sprawa = (twId: number | null, kartoteka: DopasowanieKartoteki | null) =>
    ({ reklamacja: rek({ twId, twSymbol: twId === null ? null : "W09-0804" }), kartoteka });

  it("paragon albo mapowanie wygrywa z każdą kartoteką wywiedzioną", () => {
    expect(kartotekaKolumny(sprawa(11, k("sku", 99))))
      .toEqual({ twId: 11, symbol: "W09-0804", zrodlo: "paragon" });
  });

  it("bez nich bierze kartotekę PEWNĄ — z pamięci wskazań albo jedynego trafienia po SKU", () => {
    expect(kartotekaKolumny(sprawa(null, k("sku", 99)))).toEqual({ twId: 99, symbol: "X", zrodlo: "sku" });
    expect(kartotekaKolumny(sprawa(null, k("pamiec", 98))))
      .toEqual({ twId: 98, symbol: "X", zrodlo: "mapowanie" });
  });

  it("trafienie niepewne nie wchodzi — zgadywanie to nie kartoteka", () => {
    const brak = { twId: null, symbol: null, zrodlo: null };
    expect(kartotekaKolumny(sprawa(null, k("jedyna_pozycja", 97)))).toEqual(brak);
    expect(kartotekaKolumny(sprawa(null, k("nazwa_w_zamowieniu", 96)))).toEqual(brak);
    expect(kartotekaKolumny(sprawa(null, k("niejednoznaczne", null)))).toEqual(brak);
    expect(kartotekaKolumny(sprawa(null, null))).toEqual(brak);
  });
});

describe("Kto prowadzi — czynność stoi w głowicy", () => {
  it("niczyja sprawa daje „Prowadzę tę sprawę”, a klik idzie do ekranu", async () => {
    const onProwadze = vi.fn();
    glowica({}, {}, { onProwadze });
    await userEvent.click(screen.getByRole("button", { name: "Prowadzę tę sprawę" }));
    expect(onProwadze).toHaveBeenCalledTimes(1);
  });

  it("własną sprawę da się odłożyć, a cudzej — nie odebrać jednym kliknięciem", () => {
    const { unmount } = glowica({}, { prowadzi: "A. Lewandowska", prowadziId: 7 }, { mojeId: 7 });
    expect(screen.getByText("Ty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odłóż sprawę" })).toBeInTheDocument();
    unmount();
    glowica({}, { prowadzi: "A. Lewandowska", prowadziId: 9 }, { mojeId: 7 });
    expect(screen.getByText("A. Lewandowska")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Odłóż|Prowadzę/ })).not.toBeInTheDocument();
  });
});

describe("Kolumna faktów nie powtarza głowicy", () => {
  it("kwoty żądania i terminu w kolumnie faktów nie ma — mówi je głowica", () => {
    render(<Dowody {...props()} />);
    expect(screen.queryByText("za 6 dni")).not.toBeInTheDocument();
    expect(screen.queryByText("68,25 PLN")).not.toBeInTheDocument();
  });

  it("zwijki „Sprawa” nie ma — numer, login, zgłoszenie, tytuł i status mają dom w głowicy", () => {
    render(<Dowody {...props()} />);
    expect(screen.queryByRole("button", { name: /^Sprawa/ })).not.toBeInTheDocument();
    for (const fakt of ["2743634/2026", "Client:43897233", "rękojmia", "CLAIM_SUBMITTED"]) {
      expect(screen.queryByText(new RegExp(fakt))).not.toBeInTheDocument();
    }
  });
});

describe("Zwijki mówią zdaniem, co w środku", () => {
  it("cenę spornej pozycji niesie kostka, a zamówienie pokazuje tylko resztę", async () => {
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE }, { oczekiwanie: "EXCHANGE" })} />);
    expect(screen.getByText("Klient zapłacił").parentElement!).toHaveTextContent("68,25 PLN");
    await userEvent.click(screen.getByRole("button", { name: /^Zamówienie/ }));
    expect(screen.getByText("Poza reklamowanym towarem:")).toBeInTheDocument();
    expect(screen.getByText("1 × 10,49 PLN")).toBeInTheDocument();
    expect(screen.queryByText("1 × 68,25 PLN")).not.toBeInTheDocument();
  });

  it("podpis zamówienia liczy inne pozycje, a suma ma w nim JEDEN dom", async () => {
    /* Podpis widać także przy otwartej zwijce, więc „Razem" w środku stałoby
       zaraz pod tą samą liczbą. */
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE }, { oczekiwanie: "EXCHANGE" })} />);
    const zwijka = screen.getByRole("button", { name: /^Zamówienie/ });
    expect(zwijka).toHaveTextContent("+1 inna pozycja · razem 78,74 PLN");
    await userEvent.click(zwijka);
    expect(screen.getAllByText(/78,74 PLN/)).toHaveLength(1);
  });

  it("przy jednej pozycji podpis mówi „tylko ten towar”, a suma z dostawą stoi w środku", async () => {
    const jedna = { ...ZAMOWIENIE, pozycje: [ZAMOWIENIE.pozycje[1]], sumaGrosze: 6825 } as unknown as Zamowienie;
    render(<Dowody {...props({ zamowienie: jedna }, { oczekiwanie: "EXCHANGE" })} />);
    const zwijka = screen.getByRole("button", { name: /^Zamówienie/ });
    expect(zwijka).toHaveTextContent("tylko ten towar");
    expect(zwijka).not.toHaveTextContent("68,25");
    await userEvent.click(zwijka);
    expect(screen.getByText(/Dostawa 0,00 PLN \(Allegro Paczkomaty InPost\)\./)).toBeInTheDocument();
  });

  it("zamówienie startuje zwinięte przy wymianie, a przy żądaniu pieniędzy otwiera się samo", () => {
    const { unmount } = render(<Dowody {...props({ zamowienie: ZAMOWIENIE }, { oczekiwanie: "EXCHANGE" })} />);
    expect(screen.getByRole("button", { name: /^Zamówienie/ })).toHaveAttribute("aria-expanded", "false");
    unmount();
    /* Koszt dostawy i suma kształtują kwotę zwrotu — przed werdyktem. */
    const drugi = render(<Dowody {...props({ zamowienie: ZAMOWIENIE })} />);
    expect(screen.getByRole("button", { name: /^Zamówienie/ })).toHaveAttribute("aria-expanded", "true");
    drugi.unmount();
    /* Po werdykcie kwota jest już rozstrzygnięta. */
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE }, { statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" })} />);
    expect(screen.getByRole("button", { name: /^Zamówienie/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("identyfikatory zamówienia i oferty stoją w łączach i w schowku, nie jako tekst", async () => {
    render(<Dowody {...props({}, { oczekiwanie: "EXCHANGE", linkZamowienia: "https://allegro.pl/z/ord-5",
      linkOferty: "https://allegro.pl/oferta/of-1" })} />);
    await userEvent.click(screen.getByRole("button", { name: /^Zamówienie/ }));
    expect(screen.getByRole("link", { name: "zamówienie w Allegro" })).toHaveAttribute("title", "Zamówienie ord-5");
    expect(screen.getByRole("link", { name: "oferta w Allegro" })).toHaveAttribute("title", "Oferta of-1");
    expect(screen.getByTitle("Kopiuj numer zamówienia")).toBeInTheDocument();
    expect(screen.queryByText("ord-5")).not.toBeInTheDocument();
  });

  it("praca biura podpisuje się treścią, a pusta mówi „nic nie zapisano”", () => {
    const { unmount } = render(<Dowody {...props()} />);
    expect(screen.getByRole("button", { name: /^Praca biura/ })).toHaveTextContent("nic nie zapisano");
    unmount();
    render(<Dowody {...props({}, {
      tagi: [{ id: 1, nazwa: "czeka na część" }, { id: 2, nazwa: "do decyzji właściciela" }],
      notatka: "Klient dzwonił, prosi o szybką wymianę przed sezonem koszenia trawy",
    } as Partial<Reklamacja>)} />);
    const praca = screen.getByRole("button", { name: /^Praca biura/ });
    expect(praca).toHaveTextContent(
      "czeka na część · do decyzji właściciela · notatka: „Klient dzwonił, prosi o szybką wymianę…”");
    /* Zwinięta, bo podpis już czyta treść. */
    expect(praca).toHaveAttribute("aria-expanded", "false");
    expect(within(praca).queryByText(/tag/)).not.toBeInTheDocument();
  });
});
