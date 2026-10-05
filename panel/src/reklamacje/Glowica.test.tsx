import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, SzczegolReklamacji, WiadomoscReklamacji, Zamowienie } from "../api/typy";
import { Dowody } from "./Dowody";
import { Glowica, twIdSprawy } from "./Glowica";

/* Kolumna faktów pyta o cennik kartoteki (`useKartaTowaru`), a ten plik nie
   stawia klienta TanStacka — pilnuje UKŁADU głowicy i zwijek, nie cen. Własne
   testy cennik ma w `skrzynka/TowarRozmowy.test.tsx`. */
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: () => ({ data: undefined, isLoading: false, error: null }),
}));

/* ── Głowica sprawy ──────────────────────────────────────────────────────────
   Pas na całą szerokość obszaru sprawy, nad rozmową, dowodami i faktami.
   Te testy pilnują reguł, które przeszły tu z prawej kolumny razem z treścią:

   1. TO, CO ROZSTRZYGA, STOI NA WIERZCHU. Czego klient chce i za ile, do kiedy
      decydować — bez otwierania czegokolwiek. Termin mówi „za ile", nie
      „którego", bo odejmowanie dat w głowie to praca, którą ekran ma zdjąć.
   2. TERMIN TYLKO PRZED WERDYKTEM. Po nim liczba dni nie rozstrzyga niczego.
   3. SYGNATURA MÓWI, SKĄD JEST — z paragonu albo z dzisiejszego mapowania
      oferty. To dwie różne rzeczy i ekran je rozróżnia.
   4. ZWIJKI MÓWIĄ, CO W ŚRODKU — te testy zostają przy kolumnie faktów.   */

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

const glowica = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {},
  inne: Partial<React.ComponentProps<typeof Glowica>> = {}) =>
  render(<Glowica szczegol={szczegol(n, r)} trwa={false} onProwadze={vi.fn()} {...inne} />);

const props = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  szczegol: szczegol(n, r), trwa: false, bladZapisu: "", onNotatka: vi.fn(),
});

describe("Głowica sprawy niesie to, co rozstrzyga", () => {
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

  it("numer, login i powód stoją w pierwszej linii, a numer da się skopiować", () => {
    glowica();
    expect(screen.getByText("2743634/2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Client:43897233/ })).toBeInTheDocument();
    expect(screen.getByText("usterka przy używaniu")).toBeInTheDocument();
    /* Przycisk kopiowania nie niesie numeru w nazwie — kolejka szuka wierszy
       po numerze i drugi przycisk z nim w nazwie byłby drugim wierszem. */
    expect(screen.getByRole("button", { name: "Kopiuj" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /2743634/ })).not.toBeInTheDocument();
  });

  it("nazwa towaru jest tytułem sprawy", () => {
    glowica();
    expect(screen.getByRole("heading", { name: "GAŹNIK DO STIHL MS181" })).toBeInTheDocument();
  });

  it("termin mówi ZA ILE, a datę zostawia obok", () => {
    glowica();
    expect(screen.getByText("za 6 dni")).toBeInTheDocument();
    expect(screen.getByText(/24\.09\.2026/)).toBeInTheDocument();
  });

  it("PO TERMINIE mówi o sobie wprost — to nie jest „za −1 dzień”", () => {
    glowica({}, { poTerminie: true, dniDoTerminu: -1 });
    expect(screen.getByText("po terminie")).toBeInTheDocument();
  });

  it("po NASZYM werdykcie termin znika, a staje jego nazwa", () => {
    glowica({}, { werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy",
      werdyktStatus: "sent", poTerminie: true, dniDoTerminu: -3 });
    expect(screen.getByText("Uznana — zwrot pieniędzy")).toBeInTheDocument();
    expect(screen.queryByText(/Decyzja do/)).not.toBeInTheDocument();
    expect(screen.queryByText("po terminie")).not.toBeInTheDocument();
  });

  it("nieudany werdykt werdyktem nie jest — termin zostaje", () => {
    glowica({}, { werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy",
      werdyktStatus: "send_failed" });
    expect(screen.queryByText("Uznana — zwrot pieniędzy")).not.toBeInTheDocument();
    expect(screen.getByText("za 6 dni")).toBeInTheDocument();
  });

  it("werdykt z Centrum Sprzedaży mówi, skąd jest — i też zdejmuje termin", () => {
    glowica({}, { statusAllegro: "CLAIM_ACCEPTED" });
    expect(screen.getByText("uznana")).toBeInTheDocument();
    expect(screen.getByText(/w Centrum Sprzedaży/)).toBeInTheDocument();
    expect(screen.queryByText(/Decyzja do/)).not.toBeInTheDocument();
  });

  it("STATUS DOMYŚLNY nie stoi w głowicy — ma go cały kubełek DO DECYZJI", () => {
    glowica();
    expect(screen.queryByText("CLAIM_SUBMITTED")).not.toBeInTheDocument();
  });

  it("status, którego nic nie tłumaczy, stoi surowy zamiast zniknąć", () => {
    glowica({}, { statusAllegro: "CLAIM_COS_NOWEGO" });
    expect(screen.getByText("CLAIM_COS_NOWEGO")).toBeInTheDocument();
  });

  it("ostatnie słowo mówi, czyj jest ruch — automat Allegro go nie przejmuje", () => {
    glowica({ czat: [
      wiad({ id: 1, autorRola: "SELLER", autorLogin: "sklep" }),
      wiad({ id: 2, autorRola: "BUYER" }),
      wiad({ id: 3, autorRola: "SYSTEM", autorLogin: null }),
    ] });
    expect(screen.getByText(/Ostatnie słowo: klient/)).toBeInTheDocument();
  });

  it("po naszej odpowiedzi ostatnie słowo jest NASZE", () => {
    glowica({ czat: [wiad({ id: 1 }), wiad({ id: 2, autorRola: "SELLER", autorLogin: "sklep" })] });
    expect(screen.getByText(/Ostatnie słowo: my/)).toBeInTheDocument();
  });
});

describe("Wiersz towaru mówi, skąd jest sygnatura", () => {
  it("sygnatura Z PARAGONU jest tak podpisana (0.400.0)", () => {
    glowica();
    expect(screen.getByText("W09-0804")).toBeInTheDocument();
    expect(screen.getByText("z paragonu")).toBeInTheDocument();
  });

  it("sygnatura z dzisiejszego mapowania NIE udaje paragonu", () => {
    glowica({}, { twZParagonu: false });
    expect(screen.getByText("z mapowania oferty")).toBeInTheDocument();
    expect(screen.queryByText("z paragonu")).not.toBeInTheDocument();
  });

  it("bez kartoteki mówi, czemu jej nie ma, zamiast pustego miejsca", () => {
    glowica({ kartoteka: { pewnosc: "brak", twId: null, symbol: null, zrodlo: null,
      powod: "oferta bez SKU" } }, { twId: null, twSymbol: null });
    expect(screen.getByText("oferta bez SKU")).toBeInTheDocument();
  });

});

describe("Kartoteka efektywna", () => {
  /* Symbol z sugestii po SKU, a stan z samego `twId` sprawy, to dwa różne
     towary na jednym ekranie. Paragon i mapowanie wygrywają; bez nich liczy
     się wyłącznie kartoteka wywiedziona pewnie — ta sama reguła co na serwerze. */
  const k = (pewnosc: string, twId: number | null) =>
    ({ pewnosc, twId, symbol: "X", zrodlo: null, powod: null });

  it("paragon albo mapowanie wygrywa z każdą kartoteką wywiedzioną", () => {
    expect(twIdSprawy({ reklamacja: rek({ twId: 11 }), kartoteka: k("sku", 99) })).toBe(11);
  });

  it("bez nich bierze kartotekę PEWNĄ — z pamięci wskazań albo jedynego trafienia po SKU", () => {
    expect(twIdSprawy({ reklamacja: rek({ twId: null }), kartoteka: k("sku", 99) })).toBe(99);
    expect(twIdSprawy({ reklamacja: rek({ twId: null }), kartoteka: k("pamiec", 98) })).toBe(98);
  });

  it("propozycja niejednoznaczna nie wchodzi — zgadywanie to nie kartoteka", () => {
    expect(twIdSprawy({ reklamacja: rek({ twId: null }), kartoteka: k("propozycja", 97) })).toBeNull();
    expect(twIdSprawy({ reklamacja: rek({ twId: null }), kartoteka: null })).toBeNull();
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

  it("tytuł prawny stoi w zwijce Sprawa słowem, nie kodem Allegro", async () => {
    render(<Dowody {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /Sprawa/ }));
    expect(screen.getByText("rękojmia")).toBeInTheDocument();
    expect(screen.queryByText("COMPLAINT")).not.toBeInTheDocument();
  });
});

describe("Zwijki mówią, co w środku", () => {
  it("ilość i cenę bierze z POZYCJI tej oferty, nie z sumy zamówienia", () => {
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE })} />);
    expect(screen.getAllByText("1 × 68,25 PLN").length).toBeGreaterThan(0);
  });

  it("podpis ZAKUPU nie niesie kwoty — suma ma JEDEN dom, w środku (0.414.0)", () => {
    /* Do 0.413.0 suma stała dwa razy: w podpisie i w wierszu „Razem" w środku.
       Podpis zostaje widoczny także przy otwartym bloku, więc te dwa napisy
       potrafiły stać jeden nad drugim. */
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE })} />);
    expect(screen.getAllByText(/78,74 PLN/)).toHaveLength(1);
  });

  it("podpis SPRAWY niesie numer, kupującego i długość rozmowy", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByRole("button",
      { name: /Sprawa.*2743634\/2026.*Client:43897233.*11 wiadomości/ })).toBeInTheDocument();
  });

  it("SPRAWA jest zwinięta domyślnie — głowica powiedziała już to, co pilne", () => {
    render(<Dowody {...props()} />);
    expect(screen.getByRole("button", { name: /Sprawa/ }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("ZAKUP jest ZAMKNIĘTY domyślnie — jego kwoty stoją już w kostkach (0.414.0)", () => {
    render(<Dowody {...props({ zamowienie: ZAMOWIENIE })} />);
    expect(screen.getByRole("button", { name: /Zakup/ }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("otwarta SPRAWA pokazuje identyfikatory, po które się ją otwiera", async () => {
    render(<Dowody {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /Sprawa/ }));
    expect(screen.getByText("Kupujący")).toBeInTheDocument();
    expect(screen.getByText("Zgłoszono")).toBeInTheDocument();
  });
});
