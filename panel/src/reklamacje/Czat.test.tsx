import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";

/* ── Czat sprawy Allegro ─────────────────────────────────────────────────────
   Cztery rzeczy warte testu:

   1. ZDJĘCIE WIDAĆ W DYMKU. W sklepie z częściami zdjęcie pękniętego elementu
      bywa całym zgłoszeniem, a nazwa pliku nie mówi o nim nic.
   2. SPADEK NA PRZYCISK JEST CZĘŚCIĄ PROJEKTU. `podglad` to podpowiedź
      z nazwy pliku, więc bywa nieprawdziwa — a ekran nie ma prawa pokazać
      zepsutej ikony obrazu.
   3. KTO MÓWI, MÓWI STRONA I PODPIS. Rozmowa bywa trójstronna i doradcy
      Allegro nie odpowiada się tak, jak klientowi.
   4. ZGŁOSZENIE JEST PIERWSZYM DYMKIEM KLIENTA, nie kartą nad rozmową.     */

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

/* Czat czyta ze sprawy kształt strukturalny — ten sam komponent rysuje
   dyskusję, która nie ma ani powodu, ani oferty, ani terminu. */
const sprawa = (n: Partial<React.ComponentProps<typeof Czat>["sprawa"]> = {}) => ({
  id: 1, opisZgloszenia: "Pękła obudowa po tygodniu" as string | null, czatAktywny: true,
  wiadomosciIle: 1, ...n,
});

const zal = (id: number, nazwa: string, podglad: boolean): ZalacznikReklamacji =>
  ({ id, wiadomoscId: 1, nazwa, podglad });

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "kupujacy1", autorRola: "BUYER",
  tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z",
  zalaczniki: [], ...n,
});

/** Dymek wiadomości: `li` po stronie autora i jego tło pod podpisem. */
const dymek = (tresc: string) => {
  const li = screen.getByText(tresc).closest("li")!;
  return { li, tlo: screen.getByText(tresc).parentElement! };
};

describe("Zgłoszenie to pierwszy dymek klienta", () => {
  /* Allegro przy części spraw wpisuje ten sam tekst w opis zgłoszenia i w
     pierwszą wiadomość kupującego. Dymkiem zgłoszenia jest wtedy ta
     wiadomość: ma autora, godzinę i miejsce w wątku. */
  it("dubel: zdanie stoi raz, a pierwsza wiadomość klienta jest zgłoszeniem", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa po tygodniu" })}
      zalaczniki={[]} czat={[wiad({ tresc: "Pękła obudowa po tygodniu" })]} />);
    expect(screen.getAllByText("Pękła obudowa po tygodniu")).toHaveLength(1);
    expect(dymek("Pękła obudowa po tygodniu").li).toHaveTextContent(/kupujacy1 · \d{2}\.\d{2}, \d{2}:\d{2} · zgłoszenie/);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("dublem jest też tekst inaczej złamany — porównujemy treść, nie oddech", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa\n po tygodniu" })}
      zalaczniki={[]} czat={[wiad({ tresc: "Pękła obudowa po tygodniu" })]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("ZAŁĄCZNIKI SPRAWY stają kaflami w dymku zgłoszenia — wiszą na sprawie", () => {
    scena.obrazy = {};
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa po tygodniu" })}
      zalaczniki={[zal(4, "paragon.pdf", false)]}
      czat={[wiad({ tresc: "Pękła obudowa po tygodniu" })]} />);
    expect(within(dymek("Pękła obudowa po tygodniu").li)
      .getByRole("button", { name: "paragon.pdf" })).toBeInTheDocument();
  });

  it("RÓŻNY opis staje osobnym dymkiem zgłoszenia na górze osi", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Niezgodny z opisem: 56 cm zamiast 46",
      login: "jan_kowal_88", zgloszonoAt: "2026-09-05T08:00:00.000Z" })}
      zalaczniki={[]} czat={[wiad({ tresc: "Kosiarka przestała ciąć" })]} />);
    const [pierwszy, drugi] = screen.getAllByRole("listitem");
    expect(pierwszy).toHaveTextContent("Niezgodny z opisem: 56 cm zamiast 46");
    expect(pierwszy).toHaveTextContent(/^jan_kowal_88 · \d{2}\.\d{2}, \d{2}:\d{2} · zgłoszenie/);
    expect(drugi).toHaveTextContent("Kosiarka przestała ciąć");
    expect(drugi).not.toHaveTextContent("zgłoszenie");
  });

  it("bez pobranej rozmowy zgłoszenie zostaje — nie ma z czym go porównać", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: "Pękła obudowa po tygodniu" })}
      zalaczniki={[]} czat={[]} />);
    expect(dymek("Pękła obudowa po tygodniu").li).toHaveTextContent("zgłoszenie");
    expect(screen.getByText("Rozmowy jeszcze nie pobrano.")).toBeInTheDocument();
  });

  it("bez opisu zgłoszeniem jest pierwsza wiadomość klienta", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]} czat={[
      wiad({ id: 1, tresc: "pierwsza" }), wiad({ id: 2, tresc: "druga" })]} />);
    expect(dymek("pierwsza").li).toHaveTextContent("zgłoszenie");
    expect(dymek("druga").li).not.toHaveTextContent("zgłoszenie");
  });

  it("linia „Powód: … · chce …” stoi w dymku nad zdaniem klienta", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null, powod: "Powód: usterka przy używaniu · chce wymiany" })}
      zalaczniki={[]} czat={[wiad({ tresc: "Wycieka paliwo" })]} />);
    const powod = screen.getByText("Powód: usterka przy używaniu · chce wymiany");
    const zdanie = screen.getByText("Wycieka paliwo");
    expect(powod.parentElement).toBe(zdanie.parentElement);
    expect(powod.compareDocumentPosition(zdanie)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("Nagłówek czatu", () => {
  it("mówi, czym jest pas, ile ma wiadomości i czy Allegro je przyjmie", () => {
    const { rerender } = render(<Czat tytul="Czat reklamacji" sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ id: 1 }), wiad({ id: 2, autorRola: "SELLER", tresc: "Odpowiedź" })]} />);
    expect(screen.getByRole("heading", { name: "Czat reklamacji" })).toBeInTheDocument();
    expect(screen.getByText("2 wiadomości · czat otwarty")).toBeInTheDocument();
    rerender(<Czat tytul="Czat dyskusji" sprawa={sprawa({ czatAktywny: false })} zalaczniki={[]}
      czat={[wiad()]} />);
    expect(screen.getByRole("heading", { name: "Czat dyskusji" })).toBeInTheDocument();
    expect(screen.getByText("1 wiadomość · czat zamknięty")).toBeInTheDocument();
  });

  it("niepobrana rozmowa nie mówi „0 wiadomości” — sam stan czatu", () => {
    /* Zero agent czyta jak ciszę klienta, a serwer zna trzy wiadomości. */
    render(<Czat sprawa={sprawa({ wiadomosciIle: 3 })} zalaczniki={[]} czat={[]} />);
    expect(screen.queryByText(/0 wiadomości/)).not.toBeInTheDocument();
    expect(screen.getByText("czat otwarty")).toBeInTheDocument();
  });

  it("niedociągnięta rozmowa mówi „N z M wiadomości”, pełna — samo N", () => {
    const dwie = [wiad({ id: 1 }), wiad({ id: 2, autorRola: "SELLER", tresc: "Odpowiedź" })];
    const { rerender } = render(<Czat sprawa={sprawa({ wiadomosciIle: 5 })} zalaczniki={[]} czat={dwie} />);
    expect(screen.getByText("2 z 5 wiadomości · czat otwarty")).toBeInTheDocument();
    /* Serwer liczy taktem, więc bywa w tyle za pobraną rozmową. */
    rerender(<Czat sprawa={sprawa({ wiadomosciIle: 1 })} zalaczniki={[]} czat={dwie} />);
    expect(screen.getByText("2 wiadomości · czat otwarty")).toBeInTheDocument();
  });

  it("wiadomości stoją listą z nazwą dla czytnika", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[wiad()]} />);
    expect(screen.getByRole("list", { name: "Wiadomości" })).toBeInTheDocument();
  });
});

describe("Zdjęcia stoją w dymku", () => {
  it("zdjęcie klienta rysuje się kaflem w dymku jego wiadomości", () => {
    scena.obrazy = { 9: "blob:obraz" };
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    const obraz = screen.getByRole("img", { name: "usterka.jpg" });
    expect(obraz).toHaveAttribute("src", "blob:obraz");
    expect(dymek("Kosiarka przestała ciąć").tlo).toContainElement(obraz);
    /* Kafel 112×84 z makiety, nie zdjęcie do 256 px wysokości. */
    expect(obraz.closest(".h-\\[84px\\]")).toHaveClass("w-28");
  });

  it("kolumny zdjęć obok rozmowy nie ma", () => {
    scena.obrazy = { 9: "blob:obraz" };
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
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

  it("zdjęcie się powiększa, a pasek z nazwą dalej pobiera plik", async () => {
    scena.obrazy = { 9: "blob:obraz" };
    pobrania.lista = [];
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    await userEvent.click(screen.getByRole("button", { name: "usterka.jpg" }));
    expect(pobrania.lista).toEqual(["usterka.jpg"]);
    expect(screen.getByRole("button", { name: "Powiększ: usterka.jpg" })).toBeInTheDocument();
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

  it("film stoi ciemnym kaflem z nazwą, bez prośby o podgląd", () => {
    scena.obrazy = {};
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(7, "wyciek.mp4", false)] })]} />);
    const kafel = screen.getByRole("button", { name: "wyciek.mp4" }).parentElement!;
    expect(kafel).toHaveClass("bg-slate-700");
  });
});

describe("Kto mówi: strona, tło i podpis", () => {
  it("klient po lewej na szarym tle, sklep po prawej na błękicie", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]} czat={[
      wiad({ id: 1, autorRola: "BUYER", tresc: "od klienta" }),
      wiad({ id: 2, autorRola: "SELLER", autorLogin: "sklep", tresc: "od nas" }),
    ]} />);
    const klient = dymek("od klienta");
    const my = dymek("od nas");
    expect(klient.li).toHaveClass("self-start");
    expect(klient.tlo).toHaveClass("bg-slate-100");
    expect(my.li).toHaveClass("self-end");
    expect(my.tlo).toHaveClass("bg-blue-50");
  });

  it("podpis mówi login klienta i „Sklep”, bez ikon i słów ról", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]} czat={[
      wiad({ id: 1, tresc: "od klienta" }),
      wiad({ id: 2, autorRola: "SELLER", autorLogin: "sklep", tresc: "od nas" }),
    ]} />);
    expect(dymek("od klienta").li).toHaveTextContent(/^kupujacy1 · /);
    expect(dymek("od nas").li).toHaveTextContent(/^Sklep · /);
    expect(screen.queryByText("Klient")).not.toBeInTheDocument();
    expect(screen.queryByText("My")).not.toBeInTheDocument();
    expect(document.querySelector("li svg")).toBeNull();
  });

  it("nasz dymek z panelu mówi, kto z biura pisał; spoza panelu zostaje „Sklep”", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]} czat={[
      wiad({ id: 2, autorRola: "SELLER", autorLogin: "sklep", tresc: "z panelu", wyslalNazwa: "Tomasz Nowak" }),
      wiad({ id: 3, autorRola: "SELLER", autorLogin: "sklep", tresc: "spoza panelu", wyslalNazwa: null }),
      wiad({ id: 4, autorRola: "BUYER", tresc: "klient", wyslalNazwa: "Ktoś" }),
    ]} />);
    expect(dymek("z panelu").li).toHaveTextContent(/^Sklep · Tomasz Nowak · /);
    expect(dymek("spoza panelu").li).toHaveTextContent(/^Sklep · /);
    expect(dymek("spoza panelu").li).not.toHaveTextContent("Tomasz");
    expect(dymek("klient").li).not.toHaveTextContent("Ktoś");
  });

  it("doradca Allegro zostaje dymkiem po lewej, z bielą i ramką", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "ADMIN", autorLogin: null, tresc: "od doradcy" })]} />);
    const d = dymek("od doradcy");
    expect(d.li).toHaveClass("self-start");
    expect(d.li).toHaveTextContent(/^Doradca Allegro · \d{2}\.\d{2}, \d{2}:\d{2}/);
    expect(d.tlo).toHaveClass("bg-white", "border");
  });

  it("magazyn Allegro to maszyna: przerywana ramka i własny podpis", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "FULFILLMENT", autorLogin: null, tresc: "od magazynu" })]} />);
    expect(dymek("od magazynu").tlo).toHaveClass("border-dashed");
    expect(dymek("od magazynu").li).toHaveTextContent(/^Magazyn Allegro/);
  });

  it("rola spoza zbioru mówi „nie wiem, kto to”, zamiast udawać klienta", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ autorRola: "COURIER", autorLogin: null, tresc: "nowa rola" })]} />);
    expect(dymek("nowa rola").li).toHaveTextContent(/^COURIER/);
    expect(dymek("nowa rola").tlo).toHaveClass("border-dotted");
  });

  it("ostatnia wiadomość klienta nie dostaje bursztynu — wszystkie mają to samo tło", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]} czat={[
      wiad({ id: 1, tresc: "pierwsza klienta" }),
      wiad({ id: 2, tresc: "ostatnia klienta" }),
    ]} />);
    expect(dymek("pierwsza klienta").tlo.className).not.toMatch(/amber/);
    expect(dymek("ostatnia klienta").tlo.className).not.toMatch(/amber/);
  });

  it("długiej wypowiedzi nie zwija — ani naszej, ani klienta", () => {
    const dluga = "Dzień dobry, " + "sprawdziliśmy zgłoszenie dokładnie. ".repeat(12);
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ autorRola: "SELLER", autorLogin: "sklep", tresc: dluga })]} />);
    expect(screen.getByText(/Dzień dobry/).className).not.toContain("line-clamp-4");
    expect(screen.queryByRole("button", { name: "Pokaż całą wiadomość" })).not.toBeInTheDocument();
  });

  it("starszych wiadomości nie chowa i nie mówi o rozmowie niepełnej", () => {
    const czat = Array.from({ length: 8 }, (_, i) => wiad({ id: i + 1, tresc: `wiadomość ${i + 1}` }));
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={czat} />);
    expect(screen.getByText("wiadomość 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wcześniejsz/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/niepełna/)).not.toBeInTheDocument();
  });
});

describe("Edytor na końcu rozmowy", () => {
  it("edytor jest WSTRZYKIWANY i stoi POD rozmową, a nie nad nią", () => {
    /* Oś rozmowy sama nic nie wysyła: mutacje mieszkają w ekranie. Pole do
       pisania pod ostatnią wiadomością to jedyny układ, w którym czyta się
       przed pisaniem. */
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

  it("pole odpowiedzi stoi w pasie przewijania, za ostatnią wiadomością", () => {
    const { container } = render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ tresc: "wiadomość" })]}
      edytor={<div data-testid="edytor">pole</div>} />);
    const przewijany = container.querySelector(".overflow-y-auto")!;
    const pole = screen.getByTestId("edytor");
    expect(przewijany.contains(screen.getByText("wiadomość"))).toBe(true);
    expect(przewijany.contains(pole)).toBe(true);
    expect(przewijany.contains(screen.getByRole("heading"))).toBe(false);
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

/* ── Formularz Allegro w dymku zgłoszenia ────────────────────────────────────
   Allegro wkłada zdanie klienta w swój formularz. Powód i oczekiwanie mówi
   linia nad zdaniem, więc z formularza stoi samo zdanie klienta.          */

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

describe("Formularz Allegro w dymku zgłoszenia", () => {
  it("pokazuje samo ZDANIE KLIENTA, bez przełącznika „pokaż całość”", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ tresc: FORMULARZ_ZE_ZRZUTU })]} />);
    expect(screen.getByText(OPIS_ZE_ZRZUTU)).toBeInTheDocument();
    expect(screen.queryByText(/Oczekiwane rozwiązanie/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pokaż całość/ })).not.toBeInTheDocument();
  });

  it("ZWYKŁEJ wiadomości nie rusza — nie ma czego składać", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: null })} zalaczniki={[]}
      czat={[wiad({ tresc: "Kosiarka przestała ciąć" })]} />);
    expect(screen.getByText("Kosiarka przestała ciąć")).toBeInTheDocument();
  });

  it("opis siedzący w formularzu to dubel — zdanie stoi raz", () => {
    render(<Czat sprawa={sprawa({ opisZgloszenia: OPIS_ZE_ZRZUTU })} zalaczniki={[]}
      czat={[wiad({ tresc: FORMULARZ_ZE_ZRZUTU })]} />);
    expect(screen.getAllByText(OPIS_ZE_ZRZUTU)).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
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
  /* Rozmowa czyta się od KOŃCA. Ostrożność całego ruchu siedzi w drugim
     teście: wejście w sprawę odświeża ją z Allegro, więc oś przerysowuje się
     sekundę po otwarciu — przewijanie przy każdej zmianie wyrywałoby
     agentowi miejsce czytania spod oka. */
  it("otwarcie sprawy pokazuje ostatnią wiadomość, nie pierwszą", () => {
    const skok = vi.fn();
    Element.prototype.scrollIntoView = skok;
    render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ id: 1, tresc: "pierwsza" }), wiad({ id: 2, tresc: "ostatnia" })]} />);
    expect(skok).toHaveBeenCalledTimes(1);
  });

  it("odświeżenie TEJ SAMEJ sprawy nie przewija drugi raz", () => {
    const skok = vi.fn();
    Element.prototype.scrollIntoView = skok;
    const { rerender } = render(<Czat sprawa={sprawa()} zalaczniki={[]}
      czat={[wiad({ id: 1, tresc: "pierwsza" })]} />);
    expect(skok).toHaveBeenCalledTimes(1);
    rerender(<Czat sprawa={sprawa()} zalaczniki={[]}
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

/* ── AUTOMAT ALLEGRO TO WIERSZ ZDARZENIA (makieta właściciela) ───────────────
   Automat nie jest rozmówcą, więc nie dostaje dymka. Stoi cienkim wierszem:
   ikona w kółku, krótka nazwa z faktem i czas po prawej. Kolejne automaty
   pod rząd składają się w jeden wiersz, a pełna treść stoi pod rozwinięciem. */
const automat = (id: number, tresc: string, utworzonoAt: string) =>
  wiad({ id, autorRola: "SYSTEM", autorLogin: null, tresc, utworzonoAt });

describe("Automat Allegro jako wiersz zdarzenia", () => {
  it("nie rysuje dymka: wiersz z nazwą i czasem, pełna treść pod rozwinięciem", async () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      automat(1, "Kupujący wygenerował etykietę zwrotną.", "2026-09-30T11:39:00.000Z")]} />);
    const wiersz = screen.getByRole("button", { name: /Etykieta wygenerowana/ });
    expect(wiersz).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Kupujący wygenerował etykietę zwrotną.")).not.toBeInTheDocument();
    expect(screen.queryByText("Allegro (automat)")).not.toBeInTheDocument();
    await userEvent.click(wiersz);
    expect(wiersz).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Kupujący wygenerował etykietę zwrotną.")).toBeInTheDocument();
  });

  it("kolejne automaty pod rząd składają się w JEDEN wiersz, z rozwinięciem na każdy", async () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
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

  it("przypomnienie o terminie stoi statycznie, w barwie uwagi, z liczbą dni", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      automat(1, "Przypominamy: na decyzję w sprawie reklamacji zostało 7 dni.", "2026-10-05T07:00:00.000Z")]} />);
    const wiersz = screen.getByText("Przypomnienie Allegro").closest("li")!;
    expect(wiersz).toHaveTextContent("do decyzji zostało 7 dni");
    expect(wiersz.querySelector(".text-ranga-uwaga")).not.toBeNull();
    /* Bez rozwinięcia: liczba dni mówi całą treść przypomnienia. */
    expect(within(wiersz).queryByRole("button")).toBeNull();
  });

  it("przypomnienie nie skleja się z sąsiednim automatem — zgubiłoby barwę uwagi", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[
      automat(1, "Wygenerowano etykietę zwrotną.", "2026-09-30T11:39:00.000Z"),
      automat(2, "Na decyzję zostały 2 dni.", "2026-10-10T07:00:00.000Z"),
    ]} />);
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(1);
    expect(screen.getByText("Przypomnienie Allegro").closest("li"))
      .toHaveTextContent("do decyzji zostały 2 dni");
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
  const os = () => [...screen.getByRole("list", { name: "Wiadomości" }).children] as HTMLElement[];
  const bezOpisu = sprawa({ opisZgloszenia: null });

  it("przesyłka staje między wiadomościami według chwili, a bez chwili na końcu", () => {
    render(<Czat sprawa={bezOpisu} zalaczniki={[]} zdarzenia={[odNas, odKlienta]} czat={[
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
    render(<Czat sprawa={bezOpisu} zalaczniki={[]} zdarzenia={[odKlienta, odNas]}
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
    render(<Czat sprawa={bezOpisu} zalaczniki={[]} zdarzenia={[odKlienta, odNas]}
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

  /* Makieta: automaty tej samej paczki i jej wiersz to JEDEN wiersz.
     Wiążemy po numerze listu, bo tylko on jest wspólny. */
  it("automaty z numerem znanej przesyłki scalają się z nią w jeden wiersz", async () => {
    render(<Czat sprawa={bezOpisu} zalaczniki={[]} zdarzenia={[odKlienta]} czat={[
      wiad({ id: 1, tresc: "pierwsza", utworzonoAt: "2026-09-28T12:32:00.000Z" }),
      automat(2, "Wygenerowano etykietę zwrotną nr 600000727616070019994306.", "2026-09-30T11:39:00.000Z"),
      automat(3, "Paczka została nadana. Numer: 600000727616070019994306", "2026-09-30T12:16:00.000Z"),
      wiad({ id: 4, tresc: "Wysłałem", utworzonoAt: "2026-10-04T16:40:00.000Z" }),
    ]} />);
    const wiersze = screen.getAllByRole("listitem", { name: "Przesyłka od klienta do nas" });
    expect(wiersze).toHaveLength(1);
    const [wiersz] = wiersze;
    /* Stoi w miejscu automatów, nie w chwili doręczenia. */
    expect(os()[1]).toBe(wiersz);
    const przycisk = within(wiersz).getByRole("button", { expanded: false });
    expect(przycisk).toHaveTextContent("Od klienta · zwrot · etykieta → nadana · InPost");
    expect(within(przycisk).getByText(/^Doręczona do nas /)).toBeInTheDocument();
    expect(przycisk).toHaveTextContent(/30\.09, \d{2}:\d{2}–\d{2}:\d{2}/);
    expect(within(wiersz).getByRole("button", { name: /Kopiuj numer przesyłki 6000/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Etykieta wygenerowana/ })).not.toBeInTheDocument();
    await userEvent.click(przycisk);
    expect(screen.getByText(/Paczka została nadana/)).toBeInTheDocument();
    expect(screen.getByText(/Wygenerowano etykietę zwrotną/)).toBeInTheDocument();
  });

  it("automat z innym numerem zostaje wierszem automatu obok wiersza przesyłki", () => {
    render(<Czat sprawa={bezOpisu} zalaczniki={[]} zdarzenia={[odKlienta]} czat={[
      wiad({ id: 1, tresc: "pierwsza", utworzonoAt: "2026-09-28T12:32:00.000Z" }),
      automat(2, "Paczka została nadana. Numer: 999999999999999", "2026-09-30T12:16:00.000Z"),
    ]} />);
    expect(screen.getByRole("button", { name: /Paczka nadana/ })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Przesyłka od klienta do nas" })).toBeInTheDocument();
  });

  it("bez przesyłek oś jest taka jak dotąd (dyskusje)", () => {
    render(<Czat sprawa={sprawa()} zalaczniki={[]} czat={[wiad({ tresc: "pierwsza" })]} />);
    expect(screen.queryByRole("listitem", { name: /Przesyłka/ })).not.toBeInTheDocument();
  });
});
