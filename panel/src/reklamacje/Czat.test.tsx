import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";

/* ── Oś rozmowy reklamacyjnej ────────────────────────────────────────────────
   Trzy rzeczy warte testu:

   1. ZDJĘCIE WIDAĆ, NIE KLIKA SIĘ W NIE (0.223.0). W sklepie z częściami
      zdjęcie pękniętego elementu bywa całym zgłoszeniem, a nazwa pliku nie
      mówi o nim nic. To ta sama lekcja, którą skrzynka kupiła w 0.218.0.
   2. SPADEK NA PRZYCISK JEST CZĘŚCIĄ PROJEKTU. `podglad` to podpowiedź
      z nazwy pliku, więc bywa nieprawdziwa — a ekran nie ma prawa pokazać
      zepsutej ikony obrazu.
   3. ROLA AUTORA JEST PODPISEM. Rozmowa bywa trójstronna i doradcy Allegro
      nie odpowiada się tak, jak klientowi.                                  */

const scena = vi.hoisted(() => ({ obrazy: {} as Record<number, string | null | undefined> }));

/* Hak oddaje OBIEKT (wydanie „wspólny załącznik"): adres, zdanie porażki
   i ponowienie — ten sam kształt, co w skrzynce. `null` w identyfikatorze
   znaczy „nie pytaj" (plik bez podglądu). */
vi.mock("../towar/useZdjecie", () => ({
  useZdjecieZalacznikaReklamacji: (_r: number, id: number | null) =>
    ({ url: id == null ? undefined : scena.obrazy[id], blad: null, ponow: () => {} }),
}));
const pobrania = vi.hoisted(() => ({ lista: [] as string[] }));
vi.mock("../api/reklamacje", () => ({
  pobierzZalacznik: (_r: number, _z: number, nazwa: string) => {
    pobrania.lista.push(nazwa); return Promise.resolve();
  },
}));

const { Czat } = await import("./Czat");

/* Czat czyta ze sprawy TRZY pola i tyle bierze — od 0.245.0 ten sam komponent
   rysuje dyskusję, która nie ma ani powodu, ani oferty, ani terminu. */
const sprawa = (n: Partial<React.ComponentProps<typeof Czat>["sprawa"]> = {}) => ({
  id: 1, opisZgloszenia: "Pękła obudowa po tygodniu", wiadomosciIle: 1, czatUrwany: false, ...n,
});

const zal = (id: number, nazwa: string, podglad: boolean): ZalacznikReklamacji =>
  ({ id, wiadomoscId: 1, nazwa, podglad });

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "kupujacy1", autorRola: "BUYER",
  tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z",
  zalaczniki: [], ...n,
});

describe("Zgłoszenie a pierwsza wiadomość", () => {
  /* ── DUBEL (0.412.0) ──────────────────────────────────────────────────────
     Allegro przy części spraw wpisuje ten sam tekst w dwa miejsca ładunku:
     opis zgłoszenia i pierwszą wiadomość kupującego. Ekran pokazywał oba, więc
     agent czytał to samo zdanie dwa razy, zanim doszedł do czegokolwiek, co je
     rozstrzyga. Zostaje ROZMOWA: ma autora, godzinę i miejsce w wątku. */
  it("nie powtarza zgłoszenia, gdy jest dosłownie pierwszą wiadomością klienta", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa po tygodniu" })}
      zalaczniki={[]} czat={[wiad({ tresc: "Pękła obudowa po tygodniu" })]} />);
    expect(screen.getAllByText("Pękła obudowa po tygodniu")).toHaveLength(1);
    expect(screen.queryByText("Zgłoszenie")).not.toBeInTheDocument();
  });

  it("dublem jest też tekst inaczej złamany — porównujemy treść, nie oddech", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa\n po tygodniu" })}
      zalaczniki={[]} czat={[wiad({ tresc: "Pękła obudowa po tygodniu" })]} />);
    expect(screen.queryByText("Zgłoszenie")).not.toBeInTheDocument();
  });

  it("ZAŁĄCZNIKI SPRAWY zostają nawet przy dublu — wiszą na sprawie, nie na wiadomości", () => {
    scena.obrazy = {};
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa po tygodniu" })}
      zalaczniki={[zal(4, "paragon.pdf", false)]}
      czat={[wiad({ tresc: "Pękła obudowa po tygodniu" })]} />);
    expect(screen.getByText("Załączniki zgłoszenia")).toBeInTheDocument();
    expect(screen.getByText("paragon.pdf")).toBeInTheDocument();
  });

  it("RÓŻNY opis zostaje na ekranie — to nie jest dubel, tylko druga treść", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Niezgodny z opisem: 56 cm zamiast 46" })}
      zalaczniki={[]} czat={[wiad({ tresc: "Kosiarka przestała ciąć" })]} />);
    expect(screen.getByText("Zgłoszenie")).toBeInTheDocument();
    expect(screen.getByText("Niezgodny z opisem: 56 cm zamiast 46")).toBeInTheDocument();
  });

  it("bez pobranej rozmowy zgłoszenie zostaje — nie ma z czym go porównać", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa po tygodniu" })}
      zalaczniki={[]} czat={[]} />);
    expect(screen.getByText("Zgłoszenie")).toBeInTheDocument();
  });
});

describe("Oś rozmowy reklamacyjnej", () => {
  it("zdjęcie klienta rysuje się WPROST, bez zapisywania pliku na dysk", () => {
    scena.obrazy = { 9: "blob:obraz" };
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    const obraz = screen.getByRole("img", { name: "usterka.jpg" });
    expect(obraz).toHaveAttribute("src", "blob:obraz");
  });

  it("plik, którego trasa nie narysuje, spada na przycisk pobrania", async () => {
    /* `null` z haka znaczy „415 albo brak" — nazwa obiecywała obraz, bajty nie
       potwierdziły. Ekran ma wtedy dać drogę do pliku, nie zepsutą ikonę. */
    scena.obrazy = { 9: null };
    pobrania.lista = [];
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /usterka\.jpg/ }));
    expect(pobrania.lista).toEqual(["usterka.jpg"]);
  });

  it("PDF nie udaje zdjęcia — dostaje przycisk od razu, bez pytania serwera", () => {
    /* `podglad: false` znaczy, że nawet nie próbujemy: jedno żądanie mniej
       przy każdym otwarciu sprawy z paragonem. */
    scena.obrazy = {};
    render(<Czat sprawa={sprawa()} czat={[]}
      zalaczniki={[{ id: 5, wiadomoscId: null, nazwa: "paragon.pdf", podglad: false }]} />);
    expect(screen.getByRole("button", { name: /paragon\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("załącznik SAMEJ sprawy stoi przy zgłoszeniu, nie w rozmowie", () => {
    scena.obrazy = { 5: "blob:paragon" };
    render(<Czat sprawa={sprawa()} czat={[]}
      zalaczniki={[zal(5, "dowod.png", true)]} />);
    expect(screen.getByRole("img", { name: "dowod.png" })).toBeInTheDocument();
  });

  it("rola autora jest PODPISEM — doradca Allegro to nie klient", () => {
    scena.obrazy = {};
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      wiad(),
      wiad({ id: 2, externalId: "w-2", autorRola: "ADMIN", autorLogin: null,
        tresc: "Proszę o zdjęcie noża" }),
      wiad({ id: 3, externalId: "w-3", autorRola: "SELLER", autorLogin: "sprzedawca",
        tresc: "Załączam" }),
    ]} />);
    expect(screen.getByText("Klient")).toBeInTheDocument();
    expect(screen.getByText("Doradca Allegro")).toBeInTheDocument();
    expect(screen.getByText("My")).toBeInTheDocument();
  });

  it("niepełna rozmowa MÓWI o sobie, zamiast udawać całą", () => {
    scena.obrazy = {};
    render(<Czat sprawa={sprawa({ wiadomosciIle: 5 })} zalaczniki={[]} czat={[wiad()]} />);
    expect(screen.getByText(/Ta rozmowa jest niepełna/)).toBeInTheDocument();
  });

  it("urwana rozmowa NIE obiecuje, że reszta dojdzie sama (0.273.0)", () => {
    /* Dwa powody niepełnej rozmowy i dwa różne zdania. Do 0.272.0 stało tu
       jedno — „Reszta dojdzie następną synchronizacją" — i przy rozmowie
       urwanej naszym bezpiecznikiem stron było nieprawdą: po drugą stronę
       rozmowy nikt nie szedł, więc nie dochodziła nigdy. */
    scena.obrazy = {};
    const { rerender } = render(
      <Czat sprawa={sprawa({ wiadomosciIle: 900 })} zalaczniki={[]} czat={[wiad()]} />);
    expect(screen.getByText(/Reszta dojdzie następną synchronizacją/)).toBeInTheDocument();

    rerender(
      <Czat sprawa={sprawa({ wiadomosciIle: 900, czatUrwany: true })}
        zalaczniki={[]} czat={[wiad()]} />);
    expect(screen.queryByText(/Reszta dojdzie następną synchronizacją/)).not.toBeInTheDocument();
    expect(screen.getByText(/przeczytasz w Centrum Sprzedaży/)).toBeInTheDocument();
  });

  it("edytor jest WSTRZYKIWANY i stoi POD rozmową, a nie nad nią", () => {
    /* Do 0.223.0 stało tu zdanie „odpowiedź wysyła się w Centrum Sprzedaży".
       Przestało być prawdą razem z przyrostem drugim, więc zniknęło — a oś
       rozmowy sama nadal nic nie wysyła: mutacje mieszkają w ekranie.
       Kolejność ma znaczenie: pole do pisania pod ostatnią wiadomością to
       jedyny układ, w którym czyta się przed pisaniem. */
    scena.obrazy = {};
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[wiad()]}
      edytor={<button type="button">WYŚLIJ ODPOWIEDŹ</button>} />);
    const edytor = screen.getByRole("button", { name: "WYŚLIJ ODPOWIEDŹ" });
    const ostatnia = screen.getByText("Kosiarka przestała ciąć");
    expect(ostatnia.compareDocumentPosition(edytor))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("bez wstrzykniętego edytora oś rozmowy nie dokłada niczego od siebie", () => {
    scena.obrazy = {};
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[wiad()]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

/* ── Rozmowa po 0.415.0 ──────────────────────────────────────────────────────
   Trzy zmiany na osi, każda sprawdzana na treści ze zrzutu właściciela:
   formularz Allegro składa się pod zdanie klienta, adresy są odnośnikami,
   a ramka „Zgłoszenie” znika także wtedy, gdy opis siedzi w formularzu.    */

const OPIS_ZE_ZRZUTU = "Po kilku użyciach szarpak przestał wciągać sznurek do środka .";
const FORMULARZ_ZE_ZRZUTU = [
  "Problem: wada wykryta podczas używania",
  "",
  `Opis: ${OPIS_ZE_ZRZUTU}`,
  "",
  "Oczekiwane rozwiązanie: wymiana",
  "",
  "Warunki reklamacji: reklamacja ustawowa Adres kupującego:",
  "Krzysztof Mołczan",
  "Starowiejska 10",
].join("\n");

describe("Formularz Allegro na osi rozmowy", () => {
  it("pokazuje ZDANIE KLIENTA, a formularz chowa pod przyciskiem", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ tresc: FORMULARZ_ZE_ZRZUTU })]} />);
    expect(screen.getByText(OPIS_ZE_ZRZUTU)).toBeInTheDocument();
    expect(screen.queryByText(/Oczekiwane rozwiązanie/)).not.toBeInTheDocument();
  });

  it("„pokaż całość” oddaje formularz SŁOWO W SŁOWO, z adresem do zwrotu", async () => {
    /* Chowamy powtórzenie, nigdy treść — adres do zwrotu bywa jedyną rzeczą,
       po którą agent w tę wiadomość wchodzi. */
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ tresc: FORMULARZ_ZE_ZRZUTU })]} />);
    await userEvent.click(screen.getByRole("button", { name: /pokaż całość/ }));
    expect(screen.getByText(/Starowiejska 10/)).toBeInTheDocument();
    expect(screen.getByText(/Warunki reklamacji/)).toBeInTheDocument();
  });

  it("ZWYKŁEJ wiadomości nie rusza — nie ma czego składać", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ tresc: "Kosiarka przestała ciąć" })]} />);
    expect(screen.getByText("Kosiarka przestała ciąć")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pokaż całość/ })).not.toBeInTheDocument();
  });

  it("ramka ZGŁOSZENIE znika, gdy opis siedzi w formularzu (blizna 0.412.0)", () => {
    /* To jest przypadek, który 0.412.0 przepuszczało: teksty nie są równe,
       a dublem są. Test tamtego wydania karmiono wymyśloną parą. */
    render(<Czat sprawa={sprawa({ opisZgloszenia: OPIS_ZE_ZRZUTU })} zalaczniki={[]}
      czat={[wiad({ tresc: FORMULARZ_ZE_ZRZUTU })]} />);
    expect(screen.queryByText("Zgłoszenie")).not.toBeInTheDocument();
    expect(screen.getAllByText(OPIS_ZE_ZRZUTU)).toHaveLength(1);
  });
});

describe("Adresy w treści są odnośnikami", () => {
  const LINK = "https://allegro.pl/moje-allegro/reklamacje/produkt/wysylka/a695a1ac-b22e";

  it("automat Allegro odsyła do formularza — jednym kliknięciem, nie kopiowaniem", async () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "SYSTEM", autorLogin: null,
        tresc: `konieczne jest wypełnienie formularza pod linkiem: ${LINK}` })]} />);
    /* Automat stoi cienkim wierszem; pełna treść z odnośnikiem jest pod
       rozwinięciem, czyli jedno kliknięcie dalej. */
    await userEvent.click(screen.getByRole("button", { name: /Automat Allegro/ }));
    const a = screen.getByRole("link", { name: LINK });
    expect(a).toHaveAttribute("href", LINK);
    expect(a).toHaveAttribute("target", "_blank");
    /* To jest CUDZY odnośnik: bez przekazywania odsyłacza i bez dostępu do
       naszego okna. */
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("kropka kończąca zdanie NIE wchodzi do adresu", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ tresc: `formularz: ${LINK}.` })]} />);
    expect(screen.getByRole("link", { name: LINK })).toHaveAttribute("href", LINK);
  });

  it("wiadomość bez adresu zostaje zwykłym tekstem", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ tresc: "Proszę odesłać towar." })]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("Kotwica przy najnowszej wiadomości", () => {
  /* Rozmowa reklamacyjna czyta się od KOŃCA: pierwsze pytanie agenta brzmi
     „co on napisał ostatnio". Ostrożność całego ruchu siedzi w drugim teście:
     od 0.410.0 wejście w sprawę odświeża ją z Allegro, więc oś przerysowuje
     się sekundę po otwarciu — przewijanie przy każdej zmianie wyrywałoby
     agentowi miejsce czytania spod oka. */
  it("otwarcie sprawy pokazuje ostatnią wiadomość, nie pierwszą", () => {
    const skok = vi.fn();
    Element.prototype.scrollIntoView = skok;
    render(<Czat sprawa={sprawa({ wiadomosciIle: 2 })} zalaczniki={[]}
      czat={[wiad({ id: 1, tresc: "pierwsza" }), wiad({ id: 2, tresc: "ostatnia" })]} />);
    expect(skok).toHaveBeenCalledTimes(1);
  });

  it("odświeżenie TEJ SAMEJ sprawy nie przewija drugi raz", () => {
    const skok = vi.fn();
    Element.prototype.scrollIntoView = skok;
    const { rerender } = render(<Czat sprawa={sprawa({ wiadomosciIle: 2 })} zalaczniki={[]}
      czat={[wiad({ id: 1, tresc: "pierwsza" })]} />);
    expect(skok).toHaveBeenCalledTimes(1);
    rerender(<Czat sprawa={sprawa({ wiadomosciIle: 2 })} zalaczniki={[]}
      czat={[wiad({ id: 1, tresc: "pierwsza" }), wiad({ id: 2, tresc: "dociągnięta" })]} />);
    expect(skok).toHaveBeenCalledTimes(1);
  });

  it("przejście do INNEJ sprawy kotwiczy na nowo", () => {
    const skok = vi.fn();
    Element.prototype.scrollIntoView = skok;
    const { rerender } = render(<Czat sprawa={sprawa({ id: 1 })} zalaczniki={[]}
      czat={[wiad({ id: 1, tresc: "sprawa pierwsza" })]} />);
    rerender(<Czat sprawa={sprawa({ id: 2 })} zalaczniki={[]}
      czat={[wiad({ id: 9, tresc: "sprawa druga" })]} />);
    expect(skok).toHaveBeenCalledTimes(2);
  });
});

describe("Kto mówi, widać bez czytania (0.416.0, barwy z 0.418.0)", () => {
  /* Dwa zgłoszenia właściciela ze zrzutami. Podstawa doboru jest z badań, nie
     z gustu: cecha POJEDYNCZA — barwa — jest kodowana równolegle na całym polu
     widzenia (teoria integracji cech, Treisman i Gelade 1980), więc czas
     znalezienia „ostatniej wiadomości klienta" nie rośnie z długością wątku.
     Barwa nie może jednak zostać sama (WCAG 1.4.1, około jeden mężczyzna na
     dwunastu z zaburzeniem widzenia barw), więc kodujemy TRZY razy: tłem,
     stroną karty i ikoną. */
  const karta = (tresc: string) => screen.getByText(tresc).closest("li")!;

  it("każda rola ma INNE TŁO — to jest cecha, którą oko łapie równolegle", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 4 })} zalaczniki={[]} czat={[
      wiad({ id: 1, autorRola: "BUYER", tresc: "od klienta" }),
      wiad({ id: 2, autorRola: "SELLER", autorLogin: null, tresc: "od nas" }),
      wiad({ id: 3, autorRola: "FULFILLMENT", autorLogin: null, tresc: "od automatu" }),
      wiad({ id: 4, autorRola: "ADMIN", autorLogin: null, tresc: "od doradcy" }),
    ]} />);
    const tla = ["od klienta", "od nas", "od automatu", "od doradcy"]
      .map((t) => karta(t).className.match(/bg-[a-z0-9-]+/)![0]);
    expect(new Set(tla).size).toBe(4);
  });

  it("nasza listwa stoi po DRUGIEJ stronie niż cudza", () => {
    /* Odsunięcie w prawo plus listwa przy prawej krawędzi to układ znany
       z każdego komunikatora — „to moje" nie wymaga uczenia się niczego. */
    render(<Czat sprawa={sprawa({ wiadomosciIle: 3 })} zalaczniki={[]} czat={[
      wiad({ id: 1, autorRola: "BUYER", tresc: "od klienta" }),
      wiad({ id: 2, autorRola: "SELLER", autorLogin: null, tresc: "od nas" }),
      wiad({ id: 3, autorRola: "FULFILLMENT", autorLogin: null, tresc: "od automatu" }),
    ]} />);
    expect(karta("od klienta").className).toContain("border-l-wertis-amber");
    expect(karta("od nas").className).toContain("border-r-4");
    expect(karta("od nas").className).not.toContain("border-l-4");
    /* Magazyn Allegro nie jest człowiekiem i ma tak wyglądać. Automat
       `SYSTEM` nie ma karty wcale — stoi wierszem zdarzenia (niżej). */
    expect(karta("od automatu").className).toContain("border-dashed");
  });

  it("strona karty mówi, czyja to wypowiedź — nasza odsunięta, cudza nie", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 2 })} zalaczniki={[]} czat={[
      wiad({ id: 1, autorRola: "BUYER", tresc: "od klienta" }),
      wiad({ id: 2, autorRola: "SELLER", autorLogin: null, tresc: "od nas" }),
    ]} />);
    expect(karta("od nas").className).toContain("ml-8");
    expect(karta("od klienta").className).toContain("mr-8");
  });

  it("doradca Allegro to CZŁOWIEK, ale nie nasz klient — własny błękit", () => {
    /* Odpowiada mu się inaczej niż kupującemu, więc nie ma prawa wyglądać
       jak on ani jak automat. */
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "ADMIN", autorLogin: null, tresc: "od doradcy" })]} />);
    expect(karta("od doradcy").className).toContain("border-l-sky-500");
    expect(screen.getByText("Doradca Allegro")).toBeInTheDocument();
  });

  it("rola spoza zbioru mówi „nie wiem, kto to”, zamiast udawać klienta", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "COURIER", autorLogin: null, tresc: "nowa rola" })]} />);
    expect(screen.getByText("COURIER")).toBeInTheDocument();
    expect(karta("nowa rola").className).toContain("border-dotted");
  });
});

describe("Odpowiedź jest ostatnią wypowiedzią wątku (0.549.0)", () => {
  /* Decyzja właściciela z 28 września: ten sam układ co w skrzynce. Pole
     stoi W pasie przewijania, za ostatnią wiadomością, a pod ręką trzyma je
     przyklejenie do krawędzi. Werdykt zostaje poza pasem, w ekranie. */
  it("pole odpowiedzi stoi w pasie przewijania, za ostatnią wiadomością", () => {
    const { container } = render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ tresc: "wiadomość" })]}
      edytor={<div data-testid="edytor">pole</div>} />);
    const przewijany = container.querySelector(".overflow-y-auto")!;
    const pole = screen.getByTestId("edytor");
    expect(przewijany.contains(screen.getByText("wiadomość"))).toBe(true);
    expect(przewijany.contains(pole)).toBe(true);
    expect(screen.getByText("wiadomość").compareDocumentPosition(pole))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("kotwica stoi ZA edytorem — przyklejony rząd nie zakrywa ostatniej wiadomości", () => {
    const cele: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { cele.push(this); };
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ tresc: "wiadomość" })]}
      edytor={<div data-testid="edytor">pole</div>} />);
    expect(cele).toHaveLength(1);
    expect(screen.getByTestId("edytor").compareDocumentPosition(cele[0]))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("Nasza długa wypowiedź zwija się do czterech linii (0.511.0)", () => {
  /* Wzorzec skrzynki z 0.506.0: własną odpowiedź agent zna, a długa zajmowała
     całą oś. Cudzej nie zwijamy — po nią agent przyszedł. */
  const dluga = "Dzień dobry, " + "sprawdziliśmy zgłoszenie dokładnie. ".repeat(12);

  it("nasza długa: cztery linie i „Pokaż całą wiadomość”", async () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ autorRola: "SELLER", autorLogin: "sklep", tresc: dluga })]} />);
    const tekst = screen.getByText(/Dzień dobry/);
    expect(tekst.className).toContain("line-clamp-4");
    await userEvent.click(screen.getByRole("button", { name: "Pokaż całą wiadomość" }));
    expect(tekst.className).not.toContain("line-clamp-4");
    expect(screen.getByRole("button", { name: "Zwiń" })).toHaveAttribute("aria-expanded", "true");
  });

  it("puste wiersze ponad jeden ściska na ekranie; krótkiej nie zwija", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ autorRola: "SELLER", tresc: "Wysłane.\n\n\n\nPozdrawiamy" })]} />);
    expect(screen.getByText(/Wysłane\./).textContent).toBe("Wysłane.\n\nPozdrawiamy");
    expect(screen.queryByRole("button", { name: "Pokaż całą wiadomość" })).not.toBeInTheDocument();
  });

  it("długiej wiadomości klienta NIE zwija", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ autorRola: "BUYER", tresc: dluga })]} />);
    expect(screen.getByText(/Dzień dobry/).className).not.toContain("line-clamp-4");
    expect(screen.queryByRole("button", { name: "Pokaż całą wiadomość" })).not.toBeInTheDocument();
  });
});

describe("Kolumna zdjęć obok rozmowy (dyskusje)", () => {
  /* Zgłoszenie właściciela: zdjęcia zajmowały dużą część czatu. Ekran
     dyskusji nie ma obok czego postawić, więc kolumnę rysuje sama rozmowa:
     zdjęcie stoi w kolumnie, a w wątku zostaje odnośnik w miejscu wiadomości. */
  const zZdjeciami = () => render(<Czat sprawa={sprawa()} kolumnaZdjec
    zalaczniki={[zal(5, "dowod.png", true), zal(6, "paragon.pdf", false)]}
    czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);

  it("zdjęcia stoją w kolumnie, w wątku zostaje sam odnośnik", () => {
    scena.obrazy = { 5: "blob:dowod", 9: "blob:usterka" };
    zZdjeciami();
    const kolumna = screen.getByRole("complementary", { name: "Zdjęcia w sprawie" });
    expect(within(kolumna).getByRole("img", { name: "usterka.jpg" })).toBeInTheDocument();
    expect(within(kolumna).getByRole("img", { name: "dowod.png" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Pokaż zdjęcie w kolumnie: usterka.jpg" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pokaż zdjęcie w kolumnie: dowod.png" }))
      .toBeInTheDocument();
  });

  it("plik bez podglądu zostaje w wątku, nie w kolumnie", () => {
    scena.obrazy = { 5: "blob:dowod", 9: "blob:usterka" };
    zZdjeciami();
    const kolumna = screen.getByRole("complementary", { name: "Zdjęcia w sprawie" });
    expect(within(kolumna).queryByText("paragon.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "paragon.pdf" })).toBeInTheDocument();
  });

  it("kolumna podpisuje zdjęcie autorem wiadomości", () => {
    scena.obrazy = { 5: "blob:dowod", 9: "blob:usterka" };
    zZdjeciami();
    expect(screen.getByRole("region", { name: /^Zdjęcia: Klient · / })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Zdjęcia: Zgłoszenie" })).toBeInTheDocument();
  });

  it("odnośnik przenosi fokus na swoje zdjęcie w kolumnie", async () => {
    scena.obrazy = { 5: "blob:dowod", 9: "blob:usterka" };
    zZdjeciami();
    await userEvent.click(screen.getByRole("button", { name: "Pokaż zdjęcie w kolumnie: usterka.jpg" }));
    expect(document.activeElement).toContainElement(screen.getByRole("img", { name: "usterka.jpg" }));
  });

  it("bez zdjęć kolumny nie ma — rozmowa nie traci ćwiartki na pustkę", () => {
    scena.obrazy = {};
    render(<Czat sprawa={sprawa()} kolumnaZdjec zalaczniki={[zal(6, "paragon.pdf", false)]}
      czat={[wiad()]} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("bez włączenia kolumny zdjęcie stoi w wątku jak dotąd", () => {
    scena.obrazy = { 9: "blob:usterka" };
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "usterka.jpg" })).toBeInTheDocument();
  });

  it("obie drogi naraz typ odrzuca, a ekran z własną kolumną wygrywa — bez dwóch kolumn", () => {
    scena.obrazy = { 9: "blob:usterka" };
    const pokaz = vi.fn();
    render(
      // @ts-expect-error kolumna rozmowy i kolumna ekranu wykluczają się
      <Czat sprawa={sprawa()} zalaczniki={[]} kolumnaZdjec zdjeciaObok={{ pokaz }}
        czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("Zdjęcia w kolumnie ekranu, w wątku odnośnik", () => {
  /* Zgłoszenie właściciela: zdjęcia zajmowały dużą część czatu. Kolumnę
     zdjęć rysuje teraz EKRAN reklamacji, obok dowodów biura — rozmowa
     zostawia w miejscu wiadomości odnośnik z tym samym numerem `Z`. */
  const zZdjeciami = (pokaz = vi.fn()) => render(<Czat sprawa={sprawa()}
    zdjeciaObok={{ pokaz, znak: (id) => ({ 5: "Z1", 9: "Z2" } as Record<number, string>)[id] ?? null }}
    zalaczniki={[zal(5, "dowod.png", true), zal(6, "paragon.pdf", false)]}
    czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);

  it("zdjęcia nie stoją w wątku — zostaje odnośnik z numerem zdjęcia", () => {
    scena.obrazy = { 5: "blob:dowod", 9: "blob:usterka" };
    zZdjeciami();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Z2 usterka.jpg — pokaż zdjęcie w kolumnie" }))
      .toHaveTextContent("Z2");
    expect(screen.getByRole("button", { name: "Z1 dowod.png — pokaż zdjęcie w kolumnie" }))
      .toHaveTextContent("Z1");
  });

  it("nazwa odnośnika ZACZYNA SIĘ od widocznego tekstu — „kliknij Z2” trafia (WCAG 2.5.3)", () => {
    scena.obrazy = { 5: "blob:dowod", 9: "blob:usterka" };
    zZdjeciami();
    for (const przycisk of screen.getAllByRole("button", { name: /pokaż zdjęcie w kolumnie$/ })) {
      const widac = (przycisk.textContent ?? "").replace("→", "").trim();
      expect(przycisk.getAttribute("aria-label")?.startsWith(widac)).toBe(true);
    }
  });

  it("plik bez podglądu zostaje w wątku — odnośnik do niego byłby tej samej wysokości", () => {
    scena.obrazy = {};
    zZdjeciami();
    expect(screen.getByRole("button", { name: "paragon.pdf" })).toBeInTheDocument();
  });

  it("odnośnik oddaje ekranowi numer załącznika, a ekran pokazuje zdjęcie", async () => {
    scena.obrazy = {};
    const pokaz = vi.fn();
    zZdjeciami(pokaz);
    await userEvent.click(screen.getByRole("button", { name: "Z2 usterka.jpg — pokaż zdjęcie w kolumnie" }));
    expect(pokaz).toHaveBeenCalledWith(9);
  });

  it("rozmowa nie rysuje własnej kolumny zdjęć — ta stoi w ekranie", () => {
    scena.obrazy = { 5: "blob:dowod", 9: "blob:usterka" };
    zZdjeciami();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("bez włączenia zdjęcie stoi w wątku jak dotąd (dyskusje)", () => {
    scena.obrazy = { 9: "blob:usterka" };
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    expect(screen.queryByRole("button", { name: /okaż zdjęcie w kolumnie/ })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "usterka.jpg" })).toBeInTheDocument();
  });
});

/* ── Trzy zachowania na życzenie ekranu reklamacji ──────────────────────────
   Ten sam komponent rysuje dyskusje i tam nic się nie zmienia, więc każde
   z nich jest DOMYŚLNIE WYŁĄCZONE — i to pierwsze pilnujemy w każdej grupie. */
const dluga = (n: number) => Array.from({ length: n }, (_, i) => wiad({
  id: i + 1, externalId: `w-${i + 1}`, autorRola: i % 2 ? "SELLER" : "BUYER",
  autorLogin: i % 2 ? "sklep" : "kupujacy1", tresc: `wiadomość ${i + 1}`,
}));

describe("Przypięte zgłoszenie", () => {
  const przewijany = (c: HTMLElement) => c.querySelector(".overflow-y-auto")!;

  it("domyślnie zgłoszenie przewija się razem z rozmową (dyskusje)", () => {
    const { container } = render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={dluga(3)} />);
    expect(przewijany(container).contains(screen.getByText("Pękła obudowa po tygodniu"))).toBe(true);
  });

  it("przypięte stoi NAD rozmową, poza przewijaniem — objaw zawsze w zasięgu oka", () => {
    const { container } = render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={dluga(3)}
      przypnijZgloszenie />);
    const zgloszenie = screen.getByText("Pękła obudowa po tygodniu");
    expect(przewijany(container).contains(zgloszenie)).toBe(false);
    expect(zgloszenie.compareDocumentPosition(screen.getByText("wiadomość 1"))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Starsze wiadomości zwinięte", () => {
  it("domyślnie widać całą rozmowę i nie ma przycisku (dyskusje)", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 8 })} zalaczniki={[]} czat={dluga(8)} />);
    expect(screen.getByText("wiadomość 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wcześniejsz/ })).not.toBeInTheDocument();
  });

  it("widać OSTATNIE wiadomości, a starsze chowa jeden przycisk z liczbą", async () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 8 })} zalaczniki={[]} czat={dluga(8)} zwinStarsze={5} />);
    expect(screen.queryByText("wiadomość 3")).not.toBeInTheDocument();
    expect(screen.getByText("wiadomość 4")).toBeInTheDocument();
    expect(screen.getByText("wiadomość 8")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "3 wcześniejsze wiadomości" }));
    expect(screen.getByText("wiadomość 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wcześniejsz/ })).not.toBeInTheDocument();
  });

  it("liczba mówi poprawną formą: pięć wcześniejszych, nie pięć wcześniejsze", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 10 })} zalaczniki={[]} czat={dluga(10)} zwinStarsze={5} />);
    expect(screen.getByRole("button", { name: "5 wcześniejszych wiadomości" })).toBeInTheDocument();
  });

  it("JEDNEJ wiadomości nie chowa — przycisk zająłby jej miejsce", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 6 })} zalaczniki={[]} czat={dluga(6)} zwinStarsze={5} />);
    expect(screen.getByText("wiadomość 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wcześniejsz/ })).not.toBeInTheDocument();
  });

  it("zgłoszenie WRACA, gdy jego dubel schował się pod przyciskiem", () => {
    /* Zgłoszenie raz, nie dwa — ale gdy pierwsza wiadomość klienta jest
       zwinięta, zgłoszenie to jedyne miejsce, gdzie objaw stoi na ekranie. */
    const czat = dluga(8);
    czat[0] = { ...czat[0], tresc: "Pękła obudowa po tygodniu" };
    const { rerender } = render(<Czat sprawa={sprawa({ wiadomosciIle: 8 })} zalaczniki={[]} czat={czat}
      zwinStarsze={5} przypnijZgloszenie />);
    expect(screen.getByText("Zgłoszenie")).toBeInTheDocument();
    rerender(<Czat sprawa={sprawa({ wiadomosciIle: 8 })} zalaczniki={[]} czat={czat} przypnijZgloszenie />);
    expect(screen.queryByText("Zgłoszenie")).not.toBeInTheDocument();
    expect(screen.getAllByText("Pękła obudowa po tygodniu")).toHaveLength(1);
  });
});

describe("Bursztyn tylko na ostatniej wiadomości klienta", () => {
  const karta = (tresc: string) => screen.getByText(tresc).closest("li")!;
  const rozmowa = [
    wiad({ id: 1, tresc: "pierwsza klienta" }),
    wiad({ id: 2, autorRola: "SELLER", autorLogin: "sklep", tresc: "nasza" }),
    wiad({ id: 3, tresc: "ostatnia klienta" }),
  ];

  it("domyślnie każda wiadomość klienta jest bursztynowa (dyskusje)", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 3 })} zalaczniki={[]} czat={rozmowa} />);
    expect(karta("pierwsza klienta").className).toContain("bg-amber-50");
    expect(karta("ostatnia klienta").className).toContain("bg-amber-50");
  });

  it("starsza cichnie do neutralnego tła, a strona, ikona i podpis zostają", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 3 })} zalaczniki={[]} czat={rozmowa}
      bursztynTylkoOstatniej />);
    expect(karta("ostatnia klienta").className).toContain("bg-amber-50");
    const starsza = karta("pierwsza klienta");
    expect(starsza.className).not.toMatch(/amber/);
    /* Barwa nigdy nie była jedynym znakiem autora (WCAG 1.4.1). */
    expect(starsza.className).toContain("mr-8");
    expect(starsza.className).toContain("border-l-4");
    expect(within(starsza).getByText("Klient")).toBeInTheDocument();
  });
});

/* ── AUTOMAT ALLEGRO TO WIERSZ ZDARZENIA (makieta właściciela) ───────────────
   Automat nie jest rozmówcą, więc nie dostaje dymka. Stoi cienkim wierszem:
   ikona w kółku, krótka nazwa z faktem i czas po prawej. Kolejne automaty
   pod rząd składają się w jeden wiersz, a pełna treść stoi pod rozwinięciem. */
describe("Automat Allegro jako wiersz zdarzenia", () => {
  const automat = (id: number, tresc: string, utworzonoAt: string) =>
    wiad({ id, autorRola: "SYSTEM", autorLogin: null, tresc, utworzonoAt });

  it("nie rysuje dymka: wiersz z nazwą i czasem, pełna treść pod rozwinięciem", async () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      automat(1, "Kupujący wygenerował etykietę zwrotną.", "2026-09-30T11:39:00.000Z")]} />);
    const wiersz = screen.getByRole("button", { name: /Etykieta wygenerowana/ });
    expect(wiersz).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Kupujący wygenerował etykietę zwrotną.")).not.toBeInTheDocument();
    /* Bez dymka znaczy bez podpisu roli, który mają karty rozmówców. */
    expect(screen.queryByText("Allegro (automat)")).not.toBeInTheDocument();
    await userEvent.click(wiersz);
    expect(wiersz).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Kupujący wygenerował etykietę zwrotną.")).toBeInTheDocument();
  });

  it("kolejne automaty pod rząd składają się w JEDEN wiersz, z rozwinięciem na każdy", async () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 3 })} zalaczniki={[]} czat={[
      automat(1, "Wygenerowano etykietę zwrotną.", "2026-09-30T11:39:00.000Z"),
      automat(2, "Paczka została nadana. Numer przesyłki: 600000727616070019994306", "2026-09-30T12:16:00.000Z"),
      wiad({ id: 3, tresc: "Wysłałem", utworzonoAt: "2026-09-30T16:40:00.000Z" }),
    ]} />);
    const wiersze = screen.getAllByRole("button", { expanded: false });
    expect(wiersze).toHaveLength(1);
    expect(wiersze[0]).toHaveTextContent("Etykieta wygenerowana → paczka nadana");
    await userEvent.click(wiersze[0]);
    expect(screen.getByText(/Paczka została nadana/)).toBeInTheDocument();
    expect(screen.getByText("Wygenerowano etykietę zwrotną.")).toBeInTheDocument();
  });

  it("numer przesyłki z treści staje chipem, skrócony w środku i kopiowany przez pomocnika", async () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      automat(1, "Paczka została nadana. Numer: 600000727616070019994306.", "2026-09-30T12:16:00.000Z")]} />);
    const chip = screen.getByRole("button", { name: "Kopiuj numer przesyłki 600000727616070019994306" });
    expect(chip).toHaveTextContent("6000007276…994306");
    expect(chip.className).toContain("font-mono");
    /* jsdom nie ma ani schowka, ani `execCommand`, więc pomocnik oddaje
       porażkę — i chip ma ją powiedzieć, zamiast mrugać „skopiowano”. */
    await userEvent.click(chip);
    expect(await screen.findByText("Nie udało się skopiować numeru")).toBeInTheDocument();
  });

  it("krótki ciąg cyfr nie jest numerem przesyłki — to bywa kwota albo kod", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      automat(1, "Paczka nadana z punktu 12345.", "2026-09-30T12:16:00.000Z")]} />);
    expect(screen.queryByRole("button", { name: /Kopiuj numer przesyłki/ })).not.toBeInTheDocument();
  });

  it("przypomnienie o terminie stoi w barwie uwagi, z wyciągniętą liczbą dni", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      automat(1, "Przypominamy: na decyzję w sprawie reklamacji zostało 7 dni.", "2026-10-05T07:00:00.000Z")]} />);
    const wiersz = screen.getByRole("button", { name: /Przypomnienie Allegro/ });
    expect(wiersz).toHaveTextContent("do decyzji zostało 7 dni");
    expect(wiersz.querySelector(".text-ranga-uwaga")).not.toBeNull();
  });

  it("przypomnienie nie skleja się z sąsiednim automatem — zgubiłoby barwę uwagi", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 2 })} zalaczniki={[]} czat={[
      automat(1, "Wygenerowano etykietę zwrotną.", "2026-09-30T11:39:00.000Z"),
      automat(2, "Na decyzję zostały 2 dni.", "2026-10-10T07:00:00.000Z"),
    ]} />);
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Przypomnienie Allegro/ }))
      .toHaveTextContent("do decyzji zostały 2 dni");
  });

  it("doradca Allegro zostaje dymkiem — to człowiek, nie automat", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "ADMIN", autorLogin: null, tresc: "Proszę o zdjęcia" })]} />);
    expect(screen.getByText("Proszę o zdjęcia")).toBeInTheDocument();
    expect(screen.getByText("Doradca Allegro")).toBeInTheDocument();
  });
});

describe("Przesyłki na osi rozmowy", () => {
  const odKlienta = {
    klucz: "zwrot-1", kierunek: "od_klienta" as const, moment: "2026-10-03T08:12:00.000Z",
    plakietka: "doreczona" as const, stanAt: "2026-10-03T08:12:00.000Z", nadanoAt: "2026-09-30T12:16:00.000Z",
    waybill: "600000727616070019994306", przewoznik: "InPost", opis: "zwrot", uwaga: null,
  };
  const odNas = {
    klucz: "dosylka", kierunek: "od_nas" as const, moment: null, plakietka: "w_drodze" as const,
    stanAt: null, nadanoAt: null, waybill: null, przewoznik: null, opis: "dosyłka", uwaga: "bez numeru przesyłki",
  };
  const os = () => [...screen.getByText("pierwsza").closest("ol")!.children] as HTMLElement[];

  it("przesyłka staje między wiadomościami według chwili, a bez chwili na końcu", () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 2 })} zalaczniki={[]} zdarzenia={[odNas, odKlienta]} czat={[
      wiad({ id: 1, tresc: "pierwsza", utworzonoAt: "2026-09-28T12:32:00.000Z" }),
      wiad({ id: 2, autorRola: "SELLER", tresc: "druga", utworzonoAt: "2026-10-05T09:05:00.000Z" }),
    ]} />);
    const etykiety = os().map((li) => li.getAttribute("aria-label") ?? li.textContent ?? "");
    expect(etykiety[0]).toMatch(/pierwsza/);
    expect(etykiety[1]).toBe("Przesyłka od klienta do nas");
    expect(etykiety[2]).toMatch(/druga/);
    expect(etykiety[3]).toBe("Przesyłka od nas do klienta");
  });

  it("od klienta po lewej, od nas po prawej — strona, kształt i słowo, nie sama barwa", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} zdarzenia={[odKlienta, odNas]}
      czat={[wiad({ tresc: "pierwsza", utworzonoAt: "2026-09-28T12:32:00.000Z" })]} />);
    const klient = screen.getByRole("listitem", { name: "Przesyłka od klienta do nas" });
    const my = screen.getByRole("listitem", { name: "Przesyłka od nas do klienta" });
    expect(klient.className).toContain("self-start");
    expect(my.className).toContain("self-end");
    expect(klient).toHaveTextContent("Od klienta · zwrot · InPost");
    expect(my).toHaveTextContent("Od nas · dosyłka");
    expect(my.querySelector(".bg-blue-700")).not.toBeNull();
    expect(klient.querySelector(".border-slate-400")).not.toBeNull();
  });

  it("plakietka mówi stan z czasem, numer jest chipem, a brak numeru dopiskiem", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} zdarzenia={[odKlienta, odNas]}
      czat={[wiad({ tresc: "pierwsza", utworzonoAt: "2026-09-28T12:32:00.000Z" })]} />);
    const klient = screen.getByRole("listitem", { name: "Przesyłka od klienta do nas" });
    expect(within(klient).getByText(/^Doręczona do nas \d{2}\.\d{2}, \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(klient).getByRole("button", { name: /Kopiuj numer przesyłki 6000/ })).toBeInTheDocument();
    expect(klient).toHaveTextContent(/nadana \d{2}\.\d{2}, \d{2}:\d{2}/);
    const my = screen.getByRole("listitem", { name: "Przesyłka od nas do klienta" });
    /* Bez chwili stanu plakietka nie dostaje godziny z innego stanu. */
    expect(within(my).getByText("W drodze")).toBeInTheDocument();
    expect(my).toHaveTextContent("bez numeru przesyłki");
  });

  it("przesyłka starsza od widocznych wiadomości chowa się razem ze zwiniętymi", async () => {
    render(<Czat sprawa={sprawa({ wiadomosciIle: 4 })} zalaczniki={[]} zwinStarsze={1}
      zdarzenia={[{ ...odKlienta, moment: "2026-09-29T08:00:00.000Z" }]} czat={[
        wiad({ id: 1, tresc: "a", utworzonoAt: "2026-09-28T12:32:00.000Z" }),
        wiad({ id: 2, tresc: "b", utworzonoAt: "2026-09-30T12:32:00.000Z" }),
        wiad({ id: 3, tresc: "c", utworzonoAt: "2026-10-01T12:32:00.000Z" }),
        wiad({ id: 4, tresc: "ostatnia", utworzonoAt: "2026-10-02T12:32:00.000Z" }),
      ]} />);
    expect(screen.queryByRole("listitem", { name: "Przesyłka od klienta do nas" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /wcześniejsze wiadomości/ }));
    expect(screen.getByRole("listitem", { name: "Przesyłka od klienta do nas" })).toBeInTheDocument();
  });

  it("bez przesyłek oś jest taka jak dotąd (dyskusje)", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[wiad({ tresc: "pierwsza" })]} />);
    expect(screen.queryByRole("listitem", { name: /Przesyłka/ })).not.toBeInTheDocument();
  });
});
