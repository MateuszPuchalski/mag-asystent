import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { Reklamacja } from "../api/typy";
import { Werdykt, naGrosze } from "./Werdykt";

/* ── Pasek werdyktu ──────────────────────────────────────────────────────────
   Pilnujemy tego, co rozstrzyga o bezpieczeństwie kupującego, a czego nie widać
   w serwisie: dwa przyciski przed listą (prawo Hicka), lista zależna od gałęzi,
   kwota tylko przy częściowym, przycisk MARTWY bez wiadomości i bez zgody,
   ładunek w groszach, blok po wysłaniu z kopiowaniem i stanem, krok o towarze
   tylko po naszym uznaniu, ponowienie wyłącznie po `send_failed`.           */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "123/2026", orderId: "ord-1", offerId: "of-1",
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE",
  powodOpis: "Pękła obudowa", temat: null, opis: null,
  oczekiwanie: "PARTIAL_REFUND", oczekiwanaKwotaGrosze: 5000, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: "2026-09-20T10:00:00.000Z",
  dniDoTerminu: 13, poTerminie: false, zwrotWymagany: null, czatAktywny: true, czatUrwany: false,
  wiadomosciIle: 1, ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", kupionoAt: null, kupionoZrodlo: null, dniOdZakupu: null,
  prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null, notatka: null,
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: "Kosiarka", ofertaZdjecie: "brak", twId: null, twSymbol: null, twZParagonu: false,
  ...n,
});

function pokaz(n: Partial<Reklamacja> = {}, p: Partial<React.ComponentProps<typeof Werdykt>> = {}) {
  const onWerdykt = vi.fn();
  const onTowar = vi.fn();
  const wynik = render(<Werdykt reklamacja={rek(n)} trwa={false} blad="" trwaTowar={false} bladTowaru=""
    onWerdykt={onWerdykt} onTowar={onTowar} {...p} />);
  return { onWerdykt, onTowar, ...wynik };
}

const przycisk = (nazwa: RegExp) => screen.getByRole("button", { name: nazwa });

describe("Werdykt", () => {
  it("najpierw DWA przyciski, lista dopiero po wyborze gałęzi — cztery uznania albo siedem odmów", async () => {
    pokaz();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.click(przycisk(/Uznaję/));
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: "Uznana — częściowy zwrot pieniędzy" })).toBeInTheDocument();
    await userEvent.click(przycisk(/Anuluj/));
    await userEvent.click(przycisk(/Odrzucam/));
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(screen.getByRole("option", { name: "Odrzucona — towar zgodny z umową" })).toBeInTheDocument();
  });

  it("kwota pojawia się WYŁĄCZNIE przy częściowym zwrocie, z podpowiedzią, o co prosił klient", async () => {
    pokaz();
    await userEvent.click(przycisk(/Uznaję/));
    expect(screen.queryByLabelText("Kwota zwrotu")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"), "ACCEPTED_PARTIAL_REFUND");
    expect(screen.getByLabelText("Kwota zwrotu")).toBeInTheDocument();
    expect(screen.getByText(/Klient prosi o 50,00 PLN/)).toBeInTheDocument();
  });

  it("przycisk stoi martwy bez wiadomości, bez zgody i bez kwoty przy częściowym; ładunek idzie w groszach", async () => {
    const { onWerdykt } = pokaz();
    await userEvent.click(przycisk(/Uznaję/));
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"), "ACCEPTED_PARTIAL_REFUND");
    const wyslij = () => przycisk(/Wyślij werdykt/);
    expect(wyslij()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Zwracamy 40 zł.");
    expect(wyslij()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "40,00");
    expect(wyslij()).toBeDisabled();
    /* ZGODA JEST OSTATNIA, i od 0.424.0 inaczej być nie może: wpisanie kwoty
       zdejmuje ptaszek, bo „na 40 zł" potwierdzone, a wysłane „na 400 zł"
       byłoby tą samą pomyłką, przed którą ta zgoda stoi. Do 0.424.0 ten test
       klikał ją przed kwotą i przechodził — potwierdzał wtedy liczbę, której
       jeszcze nie było na ekranie. */
    await userEvent.click(screen.getByRole("checkbox"));
    expect(wyslij()).toBeEnabled();
    await userEvent.click(wyslij());
    expect(onWerdykt).toHaveBeenCalledWith({
      werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "Zwracamy 40 zł.", kwotaGrosze: 4000,
    });
  });

  it("kwota: przecinek i kropka, śmieci dają null, nie zero", () => {
    expect(naGrosze("40,00")).toBe(4000);
    expect(naGrosze("12.5")).toBe(1250);
    expect(naGrosze("abc")).toBeNull();
    expect(naGrosze("")).toBeNull();
    expect(naGrosze("1,234")).toBeNull();
  });

  it("po wysłaniu: blok tylko do odczytu ze stanem, kwotą, autorem i kopiowaniem — bez przycisków werdyktu", () => {
    pokaz({
      werdykt: "ACCEPTED_PARTIAL_REFUND", werdyktNazwa: "Uznana — częściowy zwrot pieniędzy",
      werdyktStatus: "sent", werdyktWiadomosc: "Zwracamy 40 zł.", werdyktKwotaGrosze: 4000,
      werdyktPrzez: "Ala", werdyktAt: "2026-09-09T10:00:00.000Z", kubelek: "zamknieta",
    });
    expect(screen.getByText("Uznana — częściowy zwrot pieniędzy")).toBeInTheDocument();
    expect(screen.getByText(/40,00 PLN/)).toBeInTheDocument();
    expect(screen.getByText(/Wysłany — Allegro jeszcze nie potwierdziło/)).toBeInTheDocument();
    expect(screen.getByText(/^Ala/)).toBeInTheDocument();
    expect(screen.getByTitle("Kopiuj wiadomość werdyktu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Uznaję|Odrzucam|Spróbuj/ })).not.toBeInTheDocument();
  });

  it("potwierdzenie z Allegro zieleni stan; niepewny los mówi, czego NIE robić", () => {
    const { unmount } = pokaz({ werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód",
      werdyktStatus: "sent", statusAllegro: "CLAIM_REJECTED", kubelek: "zamknieta" });
    expect(screen.getByText(/Potwierdzony przez Allegro/)).toBeInTheDocument();
    unmount();
    pokaz({ werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód",
      werdyktStatus: "send_uncertain", kubelek: "zamknieta" });
    expect(screen.getByText(/nie wysyłaj drugi raz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Spróbuj/ })).not.toBeInTheDocument();
  });

  it("ponowienie WYŁĄCZNIE po `send_failed` — z poprzednim werdyktem i wiadomością w formularzu", async () => {
    const { onWerdykt } = pokaz({ werdykt: "REJECTED_MINOR_DEFECT", werdyktNazwa: "Odrzucona — wada nieistotna",
      werdyktStatus: "send_failed", werdyktBlad: "Allegro odpowiedziało 400", werdyktWiadomosc: "Wada nieistotna." });
    expect(screen.getByText(/Nieudany: Allegro odpowiedziało 400/)).toBeInTheDocument();
    await userEvent.click(przycisk(/Spróbuj jeszcze raz/));
    expect(screen.getByLabelText("Wartość werdyktu")).toHaveValue("REJECTED_MINOR_DEFECT");
    expect(screen.getByLabelText("Wiadomość do kupującego")).toHaveValue("Wada nieistotna.");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(przycisk(/Wyślij werdykt/));
    expect(onWerdykt).toHaveBeenCalledWith({ werdykt: "REJECTED_MINOR_DEFECT", wiadomosc: "Wada nieistotna.", kwotaGrosze: null });
  });

  it("werdykt z Centrum Sprzedaży nie udaje naszego", () => {
    pokaz({ statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" });
    expect(screen.getByText(/Rozstrzygnięta poza panelem/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("krok „towar do odesłania?” tylko po NASZYM uznaniu; zdanie startowe do edycji; po decyzji potwierdzenie z Allegro", async () => {
    const { onTowar, unmount } = pokaz({ werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy",
      werdyktStatus: "sent", kubelek: "zamknieta" });
    await userEvent.click(przycisk(/Towar do odesłania/));
    const pole = screen.getByLabelText("Wiadomość o towarze");
    expect((pole as HTMLTextAreaElement).value).toMatch(/odesłanie reklamowanego towaru/);
    await userEvent.clear(pole);
    await userEvent.type(pole, "Odeślij na Ogrodową 1.");
    await userEvent.click(przycisk(/Wyślij stanowisko/));
    expect(onTowar).toHaveBeenCalledWith("wymagany", "Odeślij na Ogrodową 1.");
    unmount();

    /* Odrzucona: kroku nie ma wcale. */
    const drugi = pokaz({ werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód",
      werdyktStatus: "sent", kubelek: "zamknieta" });
    expect(screen.queryByText(/Towar do odesłania/)).not.toBeInTheDocument();
    drugi.unmount();

    /* Po decyzji: zdanie i potwierdzenie ze `zwrotWymagany`. */
    pokaz({ werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy", werdyktStatus: "sent",
      zwrotTowaru: "niewymagany", zwrotWymagany: false, kubelek: "zamknieta" });
    expect(screen.getByText(/zostaje u klienta/)).toBeInTheDocument();
    expect(screen.getByText(/Allegro potwierdza: bez zwrotu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ODESŁANIA/ })).not.toBeInTheDocument();
  });
});

/* ── ROZDZIELENIE OD PRZYCISKU WYSYŁKI (0.421.0) ─────────────────────────────
   Zgłoszenie właściciela: „werdykt jest za blisko guzika wyślij wiadomość".
   Pas werdyktu i pas odpowiedzi stoją w jednej stopce i tak zostaje — ekran
   ma prowadzić od dowodów do decyzji. Nie wolno natomiast, żeby gałąź
   werdyktu była przestrzeleniem przycisku wysyłki: ta sama krawędź, ta sama
   barwa, dwa tuziny pikseli przerwy.

   Bramka pilnuje DWÓCH z trzech rozdzieleń — tych, które widać w łańcuchu
   klas. Trzeciego, czyli odległości, nie mierzy, bo wysokość liczy się
   w przeglądarce, nie w jsdomie.                                           */
/* ── ZGODA TRACI WAŻNOŚĆ RAZEM Z DECYZJĄ (0.424.0) ───────────────────────────
   0.424.0 kazało zdaniu zgody nazywać werdykt, ale ptaszek zostawał zaznaczony
   po zmianie listy. Agent, który potwierdził jedną decyzję i zmienił zdanie,
   miał żywy przycisk pod decyzją, której nigdy nie potwierdził — a zdanie nad
   przyciskiem mówiło już co innego.                                          */
describe("Zgoda dotyczy KONKRETNEGO werdyktu", () => {
  const wyslij = () => przycisk(/Wyślij werdykt/);
  const ptaszek = () => screen.getByRole("checkbox");

  const doZgody = async () => {
    await userEvent.click(przycisk(/Uznaję/));
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Naprawimy.");
    await userEvent.click(ptaszek());
  };

  it("zmiana listy zdejmuje ptaszek i unieruchamia przycisk", async () => {
    pokaz();
    await doZgody();
    expect(wyslij()).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"), "ACCEPTED_EXCHANGE");
    expect(ptaszek()).not.toBeChecked();
    expect(wyslij()).toBeDisabled();
  });

  it("zmiana KWOTY też ją zdejmuje — „na 40” i „na 400” to dwie decyzje", async () => {
    pokaz();
    await userEvent.click(przycisk(/Uznaję/));
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"),
      "ACCEPTED_PARTIAL_REFUND");
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Oddajemy część.");
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "40,00");
    await userEvent.click(ptaszek());
    expect(wyslij()).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "0");
    expect(ptaszek()).not.toBeChecked();
    expect(wyslij()).toBeDisabled();
  });

  it("pisanie WIADOMOŚCI zgody nie zdejmuje — treść to nie decyzja", async () => {
    /* Gdyby zdejmowało, agent odklikiwałby ptaszek po każdej poprawce literówki
       i nauczyłby się klikać go bez czytania. Zgoda ma zostać sygnałem. */
    pokaz();
    await doZgody();
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), " Dziękujemy.");
    expect(ptaszek()).toBeChecked();
    expect(wyslij()).toBeEnabled();
  });
});

/* ── ZGODA NAZYWA WERDYKT (0.424.0) ──────────────────────────────────────────
   Samo „werdykt jest nieodwracalny" jest prawdziwe przy każdej z jedenastu
   wartości listy, więc potwierdzało niby konkretną decyzję, nie mówiąc której.
   Agent, który pomylił pozycję w liście, nie miał na całej ścieżce ani jednego
   miejsca, gdzie pomyłka byłaby widoczna.                                    */
describe("Zgoda mówi, CO poleci, nie tylko że nie wróci", () => {
  const zgoda = () => screen.getByRole("checkbox").closest("label")?.textContent ?? "";

  it("nazywa wybrany werdykt po imieniu", async () => {
    pokaz();
    await userEvent.click(przycisk(/Uznaję/));
    /* Gałąź „uznaję" otwiera się na PIERWSZEJ pozycji listy uznań, czyli
       naprawie — nie na zwrocie pieniędzy. Test bierze to, co widzi agent. */
    expect(zgoda()).toContain("Uznana — naprawa");
    expect(zgoda()).toContain("nieodwracalnie");
  });

  it("przepisuje się NATYCHMIAST po zmianie listy", async () => {
    /* Bez tego zdanie opisywałoby decyzję, której agent już nie wybrał. */
    pokaz();
    await userEvent.click(przycisk(/Uznaję/));
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"),
      "ACCEPTED_PARTIAL_REFUND");
    expect(zgoda()).toContain("Uznana — częściowy zwrot pieniędzy");
    expect(zgoda()).not.toContain("Uznana — naprawa");
  });

  it("dokłada KWOTĘ przy częściowym zwrocie, dopiero gdy jest prawidłowa", async () => {
    pokaz();
    await userEvent.click(przycisk(/Uznaję/));
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"),
      "ACCEPTED_PARTIAL_REFUND");
    expect(zgoda()).not.toContain("zł");
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "40,00");
    expect(zgoda()).toContain("40,00");
  });

  it("przy odmowie nie obiecuje żadnej kwoty", async () => {
    pokaz();
    await userEvent.click(przycisk(/Odrzucam/));
    expect(zgoda()).toContain("Odrzucona");
    expect(zgoda()).not.toContain("zł");
  });
});

describe("Gałąź werdyktu nie jest przestrzeleniem przycisku wysyłki", () => {
  it("nie nosi bursztynu — ten w stopce znaczy „to idzie teraz do klienta”", () => {
    pokaz();
    for (const n of [/Uznaję/, /Odrzucam/])
      expect(przycisk(n).className).not.toContain("btn-primary");
  });

  it("nie stoi przy prawej krawędzi — tam jest WYŚLIJ ODPOWIEDŹ", () => {
    /* `ml-auto` dosuwa przycisk do prawej krawędzi pasa. Dopóki obie stopki
       mają wspólną szerokość, to jedna kolumna i jeden cel przestrzelenia. */
    pokaz();
    for (const n of [/Uznaję/, /Odrzucam/])
      expect(przycisk(n).className).not.toContain("ml-auto");
  });

  it("ponowienie po nieudanej próbie też schodzi z prawej krawędzi", () => {
    pokaz({ werdykt: "REJECTED_OTHER", werdyktStatus: "send_failed", werdyktBlad: "409" });
    expect(przycisk(/Spróbuj jeszcze raz/).className).not.toContain("ml-auto");
  });

  it("bursztyn wraca dopiero na WYŚLIJ WERDYKT — za polem zgody", async () => {
    pokaz();
    await userEvent.click(przycisk(/Uznaję/));
    expect(przycisk(/Wyślij werdykt/).className).toContain("btn-primary");
  });
});

describe("Werdykt bez nadmiaru (@wydanie)", () => {
  const wyslany = (werdyktWiadomosc: string): Partial<Reklamacja> => ({
    werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód",
    werdyktStatus: "sent", werdyktWiadomosc, kubelek: "zamknieta",
  });
  const dluga = "Po oględzinach stwierdzamy uszkodzenie mechaniczne. ".repeat(10);
  const wpis = (autorRola: string) => ({
    id: 9, externalId: "w-9", autorLogin: "ktos", autorRola,
    tresc: dluga, utworzonoAt: "2026-09-09T10:00:00.000Z", zalaczniki: [],
  });

  it("długa wiadomość werdyktu zwija się do czterech linii z „Pokaż całą”", async () => {
    pokaz(wyslany(dluga));
    const tekst = screen.getByText(/Po oględzinach/);
    expect(tekst.className).toContain("line-clamp-4");
    await userEvent.click(przycisk(/Pokaż całą/));
    expect(tekst.className).not.toContain("line-clamp-4");
  });

  it("wiadomości, którą Allegro oddało w rozmowie jako naszą, tu już nie ma", () => {
    pokaz(wyslany(dluga), { czat: [wpis("SELLER")] });
    expect(screen.queryByText(/Po oględzinach/)).not.toBeInTheDocument();
    /* Stan werdyktu zostaje — znika tylko powtórzone zdanie. */
    expect(screen.getByText("Odrzucona — inny powód")).toBeInTheDocument();
  });

  it("to samo zdanie od KLIENTA nie jest dublem — blok zostaje", () => {
    pokaz(wyslany(dluga), { czat: [wpis("BUYER")] });
    expect(screen.getByText(/Po oględzinach/)).toBeInTheDocument();
  });

  it("licznik znaków milczy daleko od sufitu", async () => {
    pokaz();
    await userEvent.click(przycisk(/Odrzucam/));
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Krótko");
    expect(screen.queryByText(/znaków|\/ 20000/)).not.toBeInTheDocument();
  });
});
