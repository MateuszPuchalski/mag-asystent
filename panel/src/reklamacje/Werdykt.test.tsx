import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { Reklamacja } from "../api/typy";
import { Werdykt, naGrosze } from "./Werdykt";

/* ── Karta „Decyzja” ─────────────────────────────────────────────────────────
   Pilnujemy tego, co rozstrzyga o bezpieczeństwie kupującego, a czego nie widać
   w serwisie: dwa przyciski przed formularzem, jedna grupa jedenastu wartości,
   kwota tylko przy częściowym, przycisk MARTWY bez wiadomości i bez zgody,
   ładunek w groszach, zgoda nazywająca werdykt i tracąca ważność razem z nim,
   towar wybierany jawnie, bez domyślnego, i ponowienie wyłącznie po
   `send_failed`. Stany po werdykcie idą za makietą „Stany”.               */

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
  const wynik = render(<Werdykt reklamacja={rek(n)} trwa={false} blad="" onWerdykt={onWerdykt} {...p} />);
  return { onWerdykt, ...wynik };
}

const przycisk = (nazwa: RegExp | string) => screen.getByRole("button", { name: nazwa });
const radio = (nazwa: RegExp | string) => screen.getByRole("radio", { name: nazwa });
const zgoda = () => screen.getByRole("checkbox", { name: /Allegro dostanie/ });
const wyslij = () => przycisk(/wyślij do Allegro/i);

describe("Zwinięta karta: dwa duże przyciski", () => {
  it("najpierw dwa przyciski, formularz dopiero po kliknięciu", async () => {
    pokaz();
    expect(screen.getByRole("heading", { name: "Decyzja" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(screen.getByRole("form", { name: "Werdykt" })).toBeInTheDocument();
  });

  /* Gałęzie werdyktu niosą pełne barwy rangi, zieleń i czerwień, bo makieta
     właściciela tak rozróżnia uznanie od odmowy. Bursztynu nie noszą, bo
     należy do wysyłki odpowiedzi. */
  it("pełne barwy gałęzi z makiety, bez bursztynu wysyłki i bez prawej krawędzi", () => {
    pokaz();
    expect(przycisk("Uznaj reklamację…").className).toContain("bg-ranga-ok");
    expect(przycisk("Odrzuć reklamację…").className).toContain("bg-ranga-zle");
    for (const n of ["Uznaj reklamację…", "Odrzuć reklamację…"]) {
      expect(przycisk(n).className).not.toContain("btn-primary");
      expect(przycisk(n).className).not.toContain("ml-auto");
    }
  });

  it("Anuluj zwija formularz i oddaje fokus przyciskowi, z którego agent przyszedł", async () => {
    pokaz();
    await userEvent.click(przycisk("Odrzuć reklamację…"));
    await userEvent.click(przycisk("Anuluj"));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(przycisk("Odrzuć reklamację…")).toHaveFocus();
  });
});

describe("Formularz: jedna grupa jedenastu wartości", () => {
  it("„Uznaję” ma cztery, „Odrzucam, bo” siedem — w jednej grupie radiowej", async () => {
    pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    const uznaje = screen.getByRole("group", { name: "Uznaję" });
    const odrzucam = screen.getByRole("group", { name: "Odrzucam, bo" });
    expect(within(uznaje).getAllByRole("radio")).toHaveLength(4);
    expect(within(odrzucam).getAllByRole("radio")).toHaveLength(7);
    const nazwy = new Set(screen.getAllByRole("radio").slice(0, 11).map((r) => r.getAttribute("name")));
    expect(nazwy.size).toBe(1);
  });

  it("uznanie startuje na życzeniu klienta, odmowa bez wyboru — powodu nie zgadujemy", async () => {
    pokaz({ oczekiwanie: "EXCHANGE" });
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(radio("Wymiana na nowy")).toBeChecked();
    expect(radio("Wymiana na nowy")).toHaveFocus();
    await userEvent.click(przycisk("Anuluj"));
    await userEvent.click(przycisk("Odrzuć reklamację…"));
    expect(screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0);
    expect(zgoda()).toBeDisabled();
    expect(wyslij()).toBeDisabled();
    expect(wyslij()).toHaveTextContent("Wyślij do Allegro");
  });

  it("kwota tylko przy częściowym zwrocie, z tym, co klient zapłacił i o co prosi", async () => {
    pokaz({ oczekiwanie: "REFUND", cenaParagonuGrosze: 8950, ilosc: 2 });
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(screen.queryByLabelText("Kwota zwrotu")).not.toBeInTheDocument();
    await userEvent.click(radio("Częściowy zwrot pieniędzy"));
    expect(screen.getByLabelText("Kwota zwrotu")).toBeInTheDocument();
    expect(screen.getByText(/Klient zapłacił 179,00/)).toBeInTheDocument();
  });

  it("przycisk martwy bez wiadomości, kwoty, towaru i zgody; ładunek idzie w groszach", async () => {
    const { onWerdykt } = pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(radio("Częściowy zwrot pieniędzy")).toBeChecked();
    expect(screen.getByText(/Klient prosi o 50,00/)).toBeInTheDocument();
    expect(wyslij()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Zwracamy 40 zł.");
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "40,00");
    await userEvent.click(zgoda());
    /* Bez wyboru towaru przycisk stoi martwy nawet przy zgodzie. */
    expect(wyslij()).toBeDisabled();
    await userEvent.click(radio(/Towar zostaje u klienta/));
    /* Wybór towaru zdjął zgodę — ona dotyczy obu decyzji naraz. */
    expect(zgoda()).not.toBeChecked();
    await userEvent.click(zgoda());
    expect(wyslij()).toBeEnabled();
    expect(wyslij()).toHaveTextContent("Uznaj i wyślij do Allegro");
    await userEvent.click(wyslij());
    expect(onWerdykt).toHaveBeenCalledWith({
      werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "Zwracamy 40 zł.", kwotaGrosze: 4000,
      towar: {
        decyzja: "niewymagany",
        tresc: "Towaru nie trzeba odsyłać. Uznaną reklamację zrealizujemy bez zwrotu przesyłki.",
      },
    });
  });

  it("odmowa: czerwony przycisk, bez towaru i bez kwoty; pod spodem zdanie o nieodwracalności", async () => {
    const { onWerdykt } = pokaz();
    await userEvent.click(przycisk("Odrzuć reklamację…"));
    await userEvent.click(radio("Wada nieistotna"));
    expect(screen.queryByRole("radio", { name: /Towar do odesłania/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Wada nieistotna.");
    await userEvent.click(zgoda());
    expect(wyslij()).toHaveTextContent("Odrzuć i wyślij do Allegro");
    expect(wyslij().className).toContain("bg-ranga-zle");
    expect(screen.getByText("Werdyktu nie da się cofnąć w Allegro.")).toBeInTheDocument();
    await userEvent.click(wyslij());
    expect(onWerdykt).toHaveBeenCalledWith({
      werdykt: "REJECTED_MINOR_DEFECT", wiadomosc: "Wada nieistotna.", kwotaGrosze: null });
  });

  it("kwota: przecinek i kropka, śmieci dają null, nie zero", () => {
    expect(naGrosze("40,00")).toBe(4000);
    expect(naGrosze("12.5")).toBe(1250);
    expect(naGrosze("abc")).toBeNull();
    expect(naGrosze("")).toBeNull();
    expect(naGrosze("1,234")).toBeNull();
  });

  it("licznik znaków milczy daleko od sufitu", async () => {
    pokaz();
    await userEvent.click(przycisk("Odrzuć reklamację…"));
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Krótko");
    expect(screen.queryByText(/\/ 20000/)).not.toBeInTheDocument();
  });

  it("zmiana sprawy czyści formularz — werdykt nie wyjedzie do drugiej reklamacji", async () => {
    const onWerdykt = vi.fn();
    const { rerender } = render(<Werdykt reklamacja={rek()} trwa={false} blad="" onWerdykt={onWerdykt} />);
    await userEvent.click(przycisk("Odrzuć reklamację…"));
    rerender(<Werdykt reklamacja={rek({ id: 2 })} trwa={false} blad="" onWerdykt={onWerdykt} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});

/* ── ZGODA DOTYCZY KONKRETNEGO WERDYKTU ──────────────────────────────────────
   Zgoda to kliknięcie w zdanie „Allegro dostanie: …”. Agent, który potwierdził
   jedną decyzję i zmienił zdanie, nie może mieć żywego przycisku pod decyzją,
   której nigdy nie potwierdził.                                              */
describe("Zgoda nazywa werdykt i traci ważność razem z nim", () => {
  const doZgody = async () => {
    await userEvent.click(przycisk("Uznaj reklamację…"));
    await userEvent.click(radio("Naprawa"));
    await userEvent.click(radio(/Towar do odesłania/));
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Naprawimy.");
    await userEvent.click(zgoda());
  };

  it("nazywa wybrany werdykt po imieniu i przepisuje się natychmiast", async () => {
    pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(zgoda()).toHaveAccessibleName(/Uznana — częściowy zwrot pieniędzy/);
    await userEvent.click(radio("Naprawa"));
    expect(zgoda()).toHaveAccessibleName(/Uznana — naprawa/);
    expect(zgoda()).not.toHaveAccessibleName(/częściowy/);
  });

  it("dokłada KWOTĘ przy częściowym zwrocie, dopiero gdy jest prawidłowa", async () => {
    pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(zgoda()).not.toHaveAccessibleName(/zł/);
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "40,00");
    expect(zgoda()).toHaveAccessibleName(/40,00/);
  });

  it("przy odmowie nie obiecuje żadnej kwoty", async () => {
    pokaz();
    await userEvent.click(przycisk("Odrzuć reklamację…"));
    await userEvent.click(radio("Inny powód"));
    expect(zgoda()).toHaveAccessibleName(/Odrzucona — inny powód/);
    expect(zgoda()).not.toHaveAccessibleName(/zł/);
  });

  it("zmiana wartości zdejmuje ptaszek i unieruchamia przycisk", async () => {
    pokaz();
    await doZgody();
    expect(wyslij()).toBeEnabled();
    await userEvent.click(radio("Wymiana na nowy"));
    expect(zgoda()).not.toBeChecked();
    expect(wyslij()).toBeDisabled();
  });

  it("zmiana KWOTY też ją zdejmuje — „na 40” i „na 400” to dwie decyzje", async () => {
    pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Oddajemy część.");
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "40,00");
    await userEvent.click(radio(/Towar zostaje u klienta/));
    await userEvent.click(zgoda());
    expect(wyslij()).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "0");
    expect(zgoda()).not.toBeChecked();
    expect(wyslij()).toBeDisabled();
  });

  it("pisanie WIADOMOŚCI zgody nie zdejmuje — treść to nie decyzja", async () => {
    /* Gdyby zdejmowało, agent odklikiwałby ptaszek po każdej literówce
       i nauczyłby się klikać go bez czytania. */
    pokaz();
    await doZgody();
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), " Dziękujemy.");
    expect(zgoda()).toBeChecked();
    expect(wyslij()).toBeEnabled();
  });
});

/* ── TOWAR: JAWNY WYBÓR, BEZ DOMYŚLNEGO ──────────────────────────────────────
   Makieta rysuje jedno pole wyboru „Towar do odesłania”. Zostaje dzisiejsza
   semantyka: dwa wybory, żaden zaznaczony na starcie. Pole wyboru ma dwa
   stany, więc „nie odhaczone” czytałoby się jak „zostaje u klienta”, choć
   agent o towarze nie pomyślał, a obie odpowiedzi kosztują.                */
describe("Towar wybiera się przy uznaniu", () => {
  it("dwa wybory, żaden zaznaczony — i nie ma ich przy odmowie", async () => {
    pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(radio(/Towar do odesłania/)).not.toBeChecked();
    expect(radio(/Towar zostaje u klienta/)).not.toBeChecked();
    expect(screen.queryByLabelText(/Wiadomość o towarze/)).not.toBeInTheDocument();
    await userEvent.click(radio("Inny powód"));
    expect(screen.queryByRole("radio", { name: /Towar do odesłania/ })).not.toBeInTheDocument();
  });

  it("wybór daje zdanie startowe do poprawki, a podsumowanie nazywa OBA wybory", async () => {
    const { onWerdykt } = pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    await userEvent.click(radio("Naprawa"));
    await userEvent.click(radio(/Towar do odesłania/));
    const pole = screen.getByLabelText(/Wiadomość o towarze/);
    expect((pole as HTMLTextAreaElement).value).toMatch(/odesłanie reklamowanego towaru/);
    await userEvent.clear(pole);
    await userEvent.type(pole, "Odeślij na Ogrodową 1.");
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Naprawimy.");
    expect(zgoda()).toHaveAccessibleName(/Uznana — naprawa, towar do odesłania/);
    await userEvent.click(zgoda());
    await userEvent.click(wyslij());
    expect(onWerdykt).toHaveBeenCalledWith({
      werdykt: "ACCEPTED_REPAIR", wiadomosc: "Naprawimy.", kwotaGrosze: null,
      towar: { decyzja: "wymagany", tresc: "Odeślij na Ogrodową 1." },
    });
  });

  it("klik w wybór, który już jest zaznaczony, nie kasuje poprawionej wiadomości ani zgody", async () => {
    pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    await userEvent.click(radio("Naprawa"));
    await userEvent.click(radio(/Towar do odesłania/));
    const pole = screen.getByLabelText(/Wiadomość o towarze/);
    await userEvent.clear(pole);
    await userEvent.type(pole, "Odeślij na Ogrodową 1.");
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Naprawimy.");
    await userEvent.click(zgoda());
    await userEvent.click(radio(/Towar do odesłania/));
    expect(pole).toHaveValue("Odeślij na Ogrodową 1.");
    expect(zgoda()).toBeChecked();
  });

  it("pusta wiadomość o towarze trzyma przycisk martwy", async () => {
    pokaz();
    await userEvent.click(przycisk("Uznaj reklamację…"));
    await userEvent.click(radio("Naprawa"));
    await userEvent.click(radio(/Towar zostaje u klienta/));
    await userEvent.clear(screen.getByLabelText(/Wiadomość o towarze/));
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Naprawimy.");
    await userEvent.click(zgoda());
    expect(wyslij()).toBeDisabled();
  });

  it("rozmowa zamknięta przez Allegro: zamiast wyboru zdanie, a werdykt idzie bez towaru", async () => {
    const { onWerdykt } = pokaz({ czatAktywny: false, oczekiwanie: "REPAIR" });
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(screen.queryByRole("radio", { name: /Towar do odesłania/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Allegro zamknęło rozmowę/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Wiadomość do klienta (wymagana)"), "Naprawimy, proszę odesłać.");
    await userEvent.click(zgoda());
    await userEvent.click(wyslij());
    expect(onWerdykt).toHaveBeenCalledWith({
      werdykt: "ACCEPTED_REPAIR", wiadomosc: "Naprawimy, proszę odesłać.", kwotaGrosze: null });
  });

  it("gdy los towaru ZAPADŁ w Centrum Sprzedaży, formularz o niego nie pyta", async () => {
    pokaz({ zwrotWymagany: true, oczekiwanie: "REPAIR" });
    await userEvent.click(przycisk("Uznaj reklamację…"));
    expect(screen.queryByRole("radio", { name: /Towar do odesłania/ })).not.toBeInTheDocument();
  });
});

const WYSLANY: Partial<Reklamacja> = {
  werdykt: "ACCEPTED_PARTIAL_REFUND", werdyktNazwa: "Uznana — częściowy zwrot pieniędzy",
  werdyktStatus: "sent", werdyktWiadomosc: "Zwracamy 40 zł.", werdyktKwotaGrosze: 4000,
  werdyktPrzez: "Ala", werdyktAt: "2026-09-09T10:00:00.000Z", zwrotTowaru: "niewymagany", kubelek: "zamknieta",
};

describe("Po werdykcie (makieta „Stany”)", () => {
  it("wysłany: nazwa z kwotą i towarem, kto i kiedy, wiadomość do skopiowania, bez przycisków decyzji", () => {
    pokaz(WYSLANY);
    expect(screen.getByText("Werdykt wysłany do Allegro")).toBeInTheDocument();
    expect(screen.getByText("Uznana — częściowy zwrot pieniędzy 40,00 PLN, towar zostaje u klienta"))
      .toBeInTheDocument();
    expect(screen.getByText(/^wysłano .* · Ala$/)).toBeInTheDocument();
    expect(screen.getByText(/Czekamy, aż Allegro potwierdzi/)).toBeInTheDocument();
    expect(screen.getByTitle("Kopiuj wiadomość werdyktu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Uznaj|Odrzuć|Spróbuj/ })).not.toBeInTheDocument();
  });

  it("potwierdzony przez Allegro mówi to wprost i nie każe czekać", () => {
    pokaz({ ...WYSLANY, statusAllegro: "CLAIM_ACCEPTED" });
    expect(screen.getByText("Allegro przyjęło werdykt")).toBeInTheDocument();
    expect(screen.queryByText(/Czekamy/)).not.toBeInTheDocument();
  });

  it("niepewny los: ostrzeżenie, bez ponowienia; „Sprawdź w Allegro” tylko z obsługą", async () => {
    const { unmount } = pokaz({ ...WYSLANY, werdyktStatus: "send_uncertain" });
    expect(screen.getByText("Nie wiemy, czy Allegro przyjęło werdykt")).toBeInTheDocument();
    expect(screen.getByText(/Nie wysyłaj werdyktu drugi raz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Spróbuj|Sprawdź/ })).not.toBeInTheDocument();
    unmount();
    const onSprawdz = vi.fn();
    pokaz({ ...WYSLANY, werdyktStatus: "send_uncertain" }, { onSprawdz });
    await userEvent.click(przycisk("Sprawdź w Allegro teraz"));
    expect(onSprawdz).toHaveBeenCalledTimes(1);
  });

  it("ponowienie WYŁĄCZNIE po `send_failed` — z poprzednim werdyktem i wiadomością w formularzu", async () => {
    const { onWerdykt } = pokaz({ werdykt: "REJECTED_MINOR_DEFECT", werdyktNazwa: "Odrzucona — wada nieistotna",
      werdyktStatus: "send_failed", werdyktBlad: "Allegro odpowiedziało 400", werdyktWiadomosc: "Wada nieistotna." });
    expect(screen.getByText("Werdykt nie przeszedł")).toBeInTheDocument();
    expect(screen.getByText(/Allegro odpowiedziało 400/)).toBeInTheDocument();
    await userEvent.click(przycisk("Spróbuj jeszcze raz"));
    expect(radio("Wada nieistotna")).toBeChecked();
    expect(screen.getByLabelText("Wiadomość do klienta (wymagana)")).toHaveValue("Wada nieistotna.");
    await userEvent.click(zgoda());
    await userEvent.click(wyslij());
    expect(onWerdykt).toHaveBeenCalledWith({ werdykt: "REJECTED_MINOR_DEFECT", wiadomosc: "Wada nieistotna.", kwotaGrosze: null });
  });

  it("werdykt z Centrum Sprzedaży nie udaje naszego — bez „kto i kiedy” i bez przycisków", () => {
    pokaz({ statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" });
    expect(screen.getByText("Uznana w Centrum Sprzedaży, poza panelem")).toBeInTheDocument();
    expect(screen.queryByText(/wysłano/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("kroku „towar do odesłania?” po werdykcie już nie ma; błąd stanowiska mówi zdaniem", () => {
    pokaz({ ...WYSLANY, zwrotTowaru: null }, { bladTowaru: "Allegro nie przyjęło wiadomości o towarze" });
    expect(screen.queryByRole("button", { name: /Towar do odesłania|Bez odsyłania|Wyślij stanowisko/ }))
      .not.toBeInTheDocument();
    expect(screen.getByText(/Allegro nie przyjęło wiadomości o towarze\. Napisz klientowi w czacie/))
      .toBeInTheDocument();
  });

  it("długa wiadomość werdyktu zwija się do czterech linii; dubel z rozmowy znika", async () => {
    const dluga = "Po oględzinach stwierdzamy uszkodzenie mechaniczne. ".repeat(10);
    const wpis = (autorRola: string) => ({ id: 9, externalId: "w-9", autorLogin: "ktos", autorRola,
      tresc: dluga, utworzonoAt: "2026-09-09T10:00:00.000Z", zalaczniki: [] });
    const { unmount } = pokaz({ ...WYSLANY, werdyktWiadomosc: dluga });
    const tekst = screen.getByText(/Po oględzinach/);
    expect(tekst.className).toContain("line-clamp-4");
    await userEvent.click(przycisk(/Pokaż całą/));
    expect(tekst.className).not.toContain("line-clamp-4");
    unmount();
    const drugi = pokaz({ ...WYSLANY, werdyktWiadomosc: dluga }, { czat: [wpis("SELLER")] });
    expect(screen.queryByText(/Po oględzinach/)).not.toBeInTheDocument();
    drugi.unmount();
    /* To samo zdanie od KLIENTA nie jest dublem. */
    pokaz({ ...WYSLANY, werdyktWiadomosc: dluga }, { czat: [wpis("BUYER")] });
    expect(screen.getByText(/Po oględzinach/)).toBeInTheDocument();
  });
});

describe("Po terminie decyzji", () => {
  it("rękojmia: czerwona rama, zdanie o czternastu dniach i jedno uznanie na życzeniu klienta", async () => {
    pokaz({ poTerminie: true, dniDoTerminu: -1, oczekiwanie: "REFUND" });
    const karta = screen.getByRole("region", { name: "Decyzja" });
    expect(karta.className).toContain("border-ranga-zle");
    expect(within(karta).getByText(/^Termin minął /)).toBeInTheDocument();
    expect(within(karta).getByText(/Bez odpowiedzi w 14 dni/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Odrzuć/ })).not.toBeInTheDocument();
    await userEvent.click(przycisk("Uznaj — zwrot pieniędzy"));
    expect(radio("Zwrot pieniędzy")).toBeChecked();
  });

  it("gwarancja: termin minął, ale skutku rękojmi nie obiecujemy — zostają oba przyciski", () => {
    pokaz({ poTerminie: true, prawo: "WARRANTY" });
    expect(screen.getByText(/^Termin minął /)).toBeInTheDocument();
    expect(screen.queryByText(/Bez odpowiedzi w 14 dni/)).not.toBeInTheDocument();
    expect(przycisk("Uznaj reklamację…")).toBeInTheDocument();
    expect(przycisk("Odrzuć reklamację…")).toBeInTheDocument();
  });
});
