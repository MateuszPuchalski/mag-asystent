import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PozycjaZamowienia, WpisOsi, ZamowienieRozmowy as Dane } from "../api/typy";

/* Kafle zdjęć zastępujemy płytkami z ich wejściem: test pilnuje, ŻE oba
   źródła stoją przy pozycji i co dostają, a nie jak wygląda obraz. */
const wskaz = vi.fn();
const sprawdz = vi.fn();
vi.mock("../api/rozmowy", () => ({
  useWskazOferte: () => ({ mutate: wskaz, isPending: false, error: null }),
  useSprawdzPrzesylkeRozmowy: () => ({ mutate: sprawdz, isPending: false, error: null }),
}));
vi.mock("../towar/Kafel", () => ({
  Kafel: ({ twId }: { twId: number | null }) => <div data-testid="kafel-subiekt" data-tw={twId ?? "brak"} />,
  KafelOferty: ({ externalId }: { externalId: string | null }) =>
    <div data-testid="kafel-oferty" data-oferta={externalId ?? "brak"} />,
}));
const { ZamowienieRozmowy } = await import("./ZamowienieRozmowy");
const { brakPowiazania } = await import("./Rozmowa");

/* Blok zamówienia nad osią (0.166.0). Trzy stany i każdy mówi co innego:
   numer z odnośnikiem, treść z pozycjami, albo zdanie, że treść dopiero
   przyjedzie — milczenie w tym miejscu wyglądałoby jak usterka. */
const dane = (n: Partial<Dane> = {}): Dane => ({
  externalId: "2f8c1a3e-9b7d-4c1e-8a2b-000000000001",
  link: "https://salescenter.allegro.com/orders/2f8c1a3e", pobrane: null, przesylka: null, ...n,
});

describe("Zamówienie przy rozmowie", () => {
  it("przed dociągnięciem: numer, odnośnik i zdanie o synchronizacji, bez przycisku zapisu", () => {
    render(<ZamowienieRozmowy zamowienie={dane()} rozmowaId={1} />);
    /* UUID jest SKRÓCONY od 0.249.0: pełne trzydzieści sześć znaków zjadało
       pół wiersza nagłówka, a nikt ich z ekranu nie przepisuje. Całość zostaje
       w podpowiedzi i pod przyciskiem kopiowania — nie znika. */
    expect(screen.getByText("2f8c1a3e…")).toHaveAttribute(
      "title", "2f8c1a3e-9b7d-4c1e-8a2b-000000000001");
    expect(screen.getByRole("link", { name: /Otwórz w Allegro/ }))
      .toHaveAttribute("href", "https://salescenter.allegro.com/orders/2f8c1a3e");
    expect(screen.getByText(/jeszcze nie pobrano/)).toBeInTheDocument();
    /* „Zero zapisu przy patrzeniu": ekran rozmowy nie dociąga niczego sam. */
    expect(screen.queryByRole("button", { name: /Dociągnij/ })).toBeNull();
  });

  const pozycja = (n: Partial<PozycjaZamowienia> = {}): PozycjaZamowienia => ({
    offerId: "17235726715", nazwa: "Szarpak do NAC LS 46-450", sku: "SZR-NAC-46",
    ilosc: 1, cenaGrosze: 4599, waluta: "PLN", zwracana: false, wracaIlosc: 0,
    twId: 501, twSymbol: "SZR-NAC-46", twZrodlo: "SKU oferty „SZR-NAC-46”",
    ofertaZdjecie: "jest", ...n,
  });
  const pobrane = (pozycje: PozycjaZamowienia[]): NonNullable<Dane["pobrane"]> => ({
    externalId: "2f8c1a3e-9b7d-4c1e-8a2b-000000000001", status: "READY_FOR_PROCESSING",
    kupujacyLogin: null, dostawaGrosze: 1499, dostawaMetoda: "Kurier InPost", platnoscTyp: null, platnoscAt: null, fakturaZadana: null,
    sumaGrosze: 6098, waluta: "PLN", kupionoAt: "2026-08-30T11:00:00Z", link: null, pozycje,
  });

  it("po dociągnięciu: pozycje z nazwą, SKU i ceną oraz suma", () => {
    render(<ZamowienieRozmowy zamowienie={dane({ pobrane: pobrane([pozycja()]) })} rozmowaId={1} />);
    expect(screen.getByText("Szarpak do NAC LS 46-450")).toBeInTheDocument();
    /* Selektor niesie barwę, bo SKU ma być drugoplanowe wobec nazwy towaru.
       Od 0.255.0 to slate-500 — slate-400 nie przechodziło progu kontrastu. */
    expect(screen.getByText("SZR-NAC-46", { selector: ".text-slate-500" })).toBeInTheDocument();
    expect(screen.getByText(/1 × 45,99/)).toBeInTheDocument();
    expect(screen.getByText(/zapłacono 60,98/)).toBeInTheDocument();
    expect(screen.queryByText(/jeszcze nie pobrano/)).toBeNull();
  });

  it("pozycja niesie DWA zdjęcia: oferty Allegro i kartoteki Subiekta, każde ze swoim wejściem", () => {
    /* Zrzut od właściciela (0.215.0): „tutaj powinny być zdjęcia i przy
       ofercie, i przy towarze". Oba źródła obok siebie, z podpisem. */
    render(<ZamowienieRozmowy zamowienie={dane({ pobrane: pobrane([
      pozycja(), pozycja({ offerId: "999", nazwa: "Linka", sku: "BRAK", twId: null, twSymbol: null, twZrodlo: null }),
    ]) })} rozmowaId={1} ofertaRozmowy="17235726715" />);
    const oferty = screen.getAllByTestId("kafel-oferty");
    const subiekt = screen.getAllByTestId("kafel-subiekt");
    expect(oferty.map((k) => k.dataset.oferta)).toEqual(["17235726715", "999"]);
    expect(subiekt.map((k) => k.dataset.tw)).toEqual(["501", "brak"]);
    expect(/* §4.3 żąda, żeby przy każdym fakcie było widać źródło. Od 0.249.0 podpis
       mieści się w jednej linii, ale NADAL nazywa oba źródła — bo to one,
       nie długość zdania, są tu wymaganiem. */
    screen.getByText(/oferta Allegro .*kartoteka Subiekta/)).toBeInTheDocument();
    /* Kartoteka podpisana symbolem, brak — słowem; oferta rozmowy oznaczona przy pozycji. */
    expect(screen.getByText("SZR-NAC-46", { selector: ".font-mono" })).toBeInTheDocument();
    expect(screen.getByText("bez kartoteki w Subiekcie")).toBeInTheDocument();
    expect(screen.getByText("oferta rozmowy")).toBeInTheDocument();
    /* Rozmowa MA ofertę, więc „Wskaż" nie stoi przy żadnej pozycji. */
    expect(screen.queryByRole("button", { name: /Wskaż jako ofertę/ })).toBeNull();
  });

  it("zamówienie z kilku pozycji bez oferty rozmowy: „Wskaż” przy pozycji zapisuje wybór agenta", async () => {
    render(<ZamowienieRozmowy zamowienie={dane({ pobrane: pobrane([
      pozycja(), pozycja({ offerId: "999", nazwa: "Linka", sku: null }),
    ]) })} rozmowaId={4821} />);
    const przyciski = screen.getAllByRole("button", { name: /Wskaż jako ofertę/ });
    expect(przyciski).toHaveLength(2);
    await userEvent.click(przyciski[1]);
    expect(wskaz).toHaveBeenCalledWith({ id: 4821, ofertaId: "999" });
  });

  it("zamówienie z JEDNEJ pozycji nie ma „Wskaż” — ofertę wywodzi serwer", () => {
    render(<ZamowienieRozmowy zamowienie={dane({ pobrane: pobrane([pozycja()]) })} rozmowaId={1} />);
    expect(screen.queryByRole("button", { name: /Wskaż jako ofertę/ })).toBeNull();
  });
});

describe("brak powiązania z towarem", () => {
  const w = (n: Partial<WpisOsi>): WpisOsi => ({
    id: "msg-1", rodzaj: "wiadomosc", autor: "k", odKlienta: true, tresc: "?",
    at: "2026-09-01T10:00:00Z", ofertaId: null, ...n,
  });

  it("zamówienie liczy się jak powiązanie — blok „brak oferty” nie stoi", () => {
    /* Zamówienie nazywa towar dokładniej niż oferta. Pokazywanie obok niego
       „brak powiązania z ofertą" byłoby kłamstwem o ekranie. */
    expect(brakPowiazania([w({})])).toBe(true);
    expect(brakPowiazania([w({ zamowienieId: "zam-1" })])).toBe(false);
    expect(brakPowiazania([w({ ofertaId: "1" })])).toBe(false);
    expect(brakPowiazania([w({}), w({ id: "msg-2", odKlienta: false, zamowienieId: "zam-1" })])).toBe(false);
  });

  it("zamówienie znane spoza osi też ucisza blok (0.506.0)", () => {
    /* Runda krytyki: baner „brak powiązania" stał nad prawą kolumną, która
       mówiła „Zamówił 1 × …". Zamówienie wskazane z kandydatów nie ma
       `zamowienieId` na osi, ale ekran je zna — i to rozstrzyga. */
    const zam = { zamowienie: { externalId: "zam-1" }, oferta: null } as never;
    const of = { zamowienie: null, oferta: { externalId: "7" } } as never;
    expect(brakPowiazania([w({})], zam)).toBe(false);
    expect(brakPowiazania([w({})], of)).toBe(false);
    expect(brakPowiazania([w({})], { zamowienie: null, oferta: null })).toBe(true);
  });
});

/* ── Paczka przy zamówieniu (23 września 2026) ───────────────────────────────
   Klient pod zamówieniem pyta najczęściej „gdzie paczka". Pilnujemy, że stan
   mówi po polsku i z perspektywy klienta, a Allegro pytamy wyłącznie
   kliknięciem — otwarcie rozmowy niczego nie woła. */
describe("Paczka przy zamówieniu rozmowy", () => {
  const stan = (n: Partial<NonNullable<Dane["przesylka"]>> = {}): NonNullable<Dane["przesylka"]> => ({
    waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null, ...n,
  });

  it("bez zamówienia w bazie linijki nie ma wcale", () => {
    render(<ZamowienieRozmowy zamowienie={dane()} rozmowaId={1} />);
    expect(screen.queryByLabelText("Przesyłka")).toBeNull();
  });

  it("status słowem z perspektywy klienta, a pytanie Allegro dopiero na kliknięcie", async () => {
    sprawdz.mockClear();
    render(<ZamowienieRozmowy rozmowaId={7} zamowienie={dane({ przesylka: stan({
      waybill: "620012345678", przewoznik: "INPOST", status: "IN_TRANSIT",
      sprawdzonoAt: "2026-09-23T10:00:00Z" }) })} />);
    const p = screen.getByLabelText("Przesyłka");
    expect(p).toHaveTextContent("w drodze do klienta");
    expect(p).toHaveTextContent("INPOST 620012345678");
    expect(sprawdz).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "sprawdź" }));
    expect(sprawdz).toHaveBeenCalledWith({ id: 7 });
  });

  it("„nie pytaliśmy” i „Allegro nie ma numeru” to dwa różne zdania", () => {
    const { rerender } = render(<ZamowienieRozmowy rozmowaId={1} zamowienie={dane({ przesylka: stan() })} />);
    expect(screen.getByLabelText("Przesyłka")).toHaveTextContent("nie pytaliśmy jeszcze Allegro");
    rerender(<ZamowienieRozmowy rozmowaId={1}
      zamowienie={dane({ przesylka: stan({ sprawdzonoAt: "2026-09-23T10:00:00Z" }) })} />);
    expect(screen.getByLabelText("Przesyłka")).toHaveTextContent("Allegro nie ma numeru");
  });

  /* Soczewka paczki (0.531.0) pokazuje paczkę nad kolumną — karta zamówienia
     jej nie powtarza, ale pozycje i numer zamówienia zostają. */
  it("gdy paczkę pokazuje soczewka, linijki paczki nie ma, a reszta karty stoi", () => {
    render(<ZamowienieRozmowy rozmowaId={1} bezPaczki
      zamowienie={dane({ przesylka: stan({ waybill: "X1", przewoznik: "DPD", status: "IN_TRANSIT" }) })} />);
    expect(screen.queryByLabelText("Przesyłka")).toBeNull();
    expect(screen.getByText("2f8c1a3e…")).toBeInTheDocument();
  });
});
