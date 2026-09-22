import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("automat Allegro odsyła do formularza — jednym kliknięciem, nie kopiowaniem", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "SYSTEM", autorLogin: null,
        tresc: `konieczne jest wypełnienie formularza pod linkiem: ${LINK}` })]} />);
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
      wiad({ id: 3, autorRola: "SYSTEM", autorLogin: null, tresc: "od automatu" }),
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
      wiad({ id: 3, autorRola: "SYSTEM", autorLogin: null, tresc: "od automatu" }),
    ]} />);
    expect(karta("od klienta").className).toContain("border-l-wertis-amber");
    expect(karta("od nas").className).toContain("border-r-4");
    expect(karta("od nas").className).not.toContain("border-l-4");
    /* Automat nie jest człowiekiem i ma tak wyglądać. */
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

describe("Rozmowa przewija się, czynności stoją (0.418.0)", () => {
  /* Zgłoszenie właściciela ze zrzutem: „werdykt nie jest przyklejony" — pasek
     leżał w połowie cudzej wiadomości, bo cała kolumna była JEDNYM obszarem
     przewijania. Teraz przewija się wyłącznie oś; pole odpowiedzi i werdykt
     zostają na dole. */
  it("pas przewijania obejmuje OŚ, a pole odpowiedzi zostaje poza nim", () => {
    const { container } = render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ tresc: "wiadomość" })]}
      edytor={<div data-testid="edytor">pole</div>} />);
    const przewijany = container.querySelector(".overflow-y-auto")!;
    expect(przewijany.contains(screen.getByText("wiadomość"))).toBe(true);
    expect(przewijany.contains(screen.getByTestId("edytor"))).toBe(false);
  });
});
