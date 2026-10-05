import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  DowodReklamacji, Reklamacja, SzczegolReklamacji, WiadomoscReklamacji, ZalacznikReklamacji,
} from "../api/typy";

/* Obrazy idą zwykłym `fetch` z sesją, a ten plik pilnuje UKŁADU kolumny —
   numerów, grup i wpisów — więc haki obrazów odpowiadają od razu adresem. */
vi.mock("../towar/useZdjecie", async () => {
  const prawdziwy = await vi.importActual<typeof import("../towar/useZdjecie")>("../towar/useZdjecie");
  return {
    ...prawdziwy,
    useZdjecie: () => undefined,
    useZdjecieOferty: () => undefined,
    useZdjecieZalacznikaReklamacji: (_r: number, id: number | null) =>
      ({ url: id === null ? undefined : `blob:${id}`, blad: null, ponow: () => {} }),
  };
});

const { KolumnaDowodow, zdjeciaSprawy, LIMIT_DOWODU } = await import("./KolumnaDowodow");
const { OKNO_COFNIECIA_CZYNNOSCI_MS } = await import("../skrzynka/Cofniecie");

afterEach(() => vi.useRealTimers());

/* ── Kolumna dowodów i zdjęć ─────────────────────────────────────────────────
   Decyzja właściciela: dowody są SWOBODNYMI wpisami biura i stoją na górze
   kolumny zdjęć, obok rozmowy. Testy pilnują trzech rzeczy:

   1. NUMERY ZDJĘĆ SĄ STAŁE — `Z1`… liczą się po numerze załącznika, więc wpis
      z „Z2" wskazuje to samo zdjęcie także po dociągnięciu rozmowy.
   2. WPIS ODSYŁA DO ZDJĘCIA jednym kliknięciem, a powiązanie wybiera się
      z listy, nie ptaszkiem — zdjęć bywa kilka, a wpis wskazuje jedno.
   3. ZAPIS IDZIE PRZEZ EKRAN: kolumna nie woła serwera sama, a pole czyści
      się dopiero po udanym zapisie.                                         */

const zal = (id: number, nazwa: string, podglad = true, wiadomoscId: number | null = null):
  ZalacznikReklamacji => ({ id, wiadomoscId, nazwa, podglad });

const wiad = (n: Partial<WiadomoscReklamacji>): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "kupujacy1", autorRola: "BUYER",
  tresc: "Szczotka bije", utworzonoAt: "2026-08-20T13:17:00.000Z", zalaczniki: [], ...n,
});

const dowod = (n: Partial<DowodReklamacji> = {}): DowodReklamacji => ({
  id: 3, tresc: "Szczotka od czoła, druty widać. Bok na płasko by się przydał.",
  zalacznikId: 9, autor: "A. Lewandowska", utworzonoAt: "2026-08-21T09:00:00.000Z", ...n,
});

const szczegol = (n: Partial<SzczegolReklamacji> = {}, r: Partial<Reklamacja> = {}) => ({
  reklamacja: {
    id: 5, numer: "2152154/2026", offerId: "of-1", ofertaNazwa: "SZCZOTKA DO KOSY",
    ofertaZdjecie: "brak", otwartoAt: "2026-07-24T12:41:00.000Z", twId: null, twSymbol: null, ...r,
  },
  czat: [
    wiad({ id: 1, zalaczniki: [zal(9, "szczotka.jpg", true, 1), zal(4, "film.mp4", false, 1)] }),
    wiad({ id: 2, autorRola: "SELLER", autorLogin: "sklep", tresc: "Dziękujemy", zalaczniki: [] }),
  ],
  zalaczniki: [zal(12, "zgloszenie.jpg"), zal(5, "tabliczka.jpg")],
  zwroty: [], rozmowy: [], sprawy: [], droga: [], kartoteka: null, karta: null,
  zamowienie: null, przesylka: null, dowody: [dowod()], ...n,
} as unknown as SzczegolReklamacji);

const pokaz = (s: SzczegolReklamacji, n: Partial<React.ComponentProps<typeof KolumnaDowodow>> = {}) =>
  render(<KolumnaDowodow szczegol={s} trwa={false} blad="" idZdjecia={(z) => `zdj-${z}`}
    onPokaz={vi.fn()} onDodaj={vi.fn()} onUsun={vi.fn()} {...n} />);

describe("Numery zdjęć", () => {
  it("liczą się po numerze załącznika, nie po miejscu w rozmowie", () => {
    const { znaki } = zdjeciaSprawy(szczegol());
    /* 5 i 12 wiszą na zgłoszeniu, 9 na wiadomości — numer idzie po id. */
    expect([...znaki.entries()]).toEqual([[5, "Z1"], [9, "Z2"], [12, "Z3"]]);
  });

  it("plik bez podglądu numeru nie dostaje — nie ma czego oglądać", () => {
    expect(zdjeciaSprawy(szczegol()).znaki.has(4)).toBe(false);
  });

  it("grupy idą jak w rozmowie i każde zdjęcie niesie swój numer", () => {
    pokaz(szczegol());
    const zgloszenie = screen.getByRole("region", { name: /^Zdjęcia: Zgłoszenie · / });
    expect(within(zgloszenie).getByText("Z1")).toBeInTheDocument();
    expect(within(zgloszenie).getByText("Z3")).toBeInTheDocument();
    const klient = screen.getByRole("region", { name: /^Zdjęcia: Klient · / });
    expect(within(klient).getByText("Z2")).toBeInTheDocument();
    expect(within(klient).getByRole("img", { name: "szczotka.jpg" })).toBeInTheDocument();
  });

  it("zdjęcie ma miejsce, do którego prowadzą odnośnik z wątku i numer z wpisu", () => {
    pokaz(szczegol());
    expect(document.getElementById("zdj-9")).toContainElement(screen.getByRole("img", { name: "szczotka.jpg" }));
  });
});

describe("Wpisy dowodów", () => {
  it("nagłówek mówi, ile jest zdjęć i wpisów — poprawną formą liczby", () => {
    pokaz(szczegol());
    expect(screen.getByText("3 zdjęcia · 1 wpis")).toBeInTheDocument();
  });

  it("wpis niesie treść, autora i numer zdjęcia, który do niego prowadzi", async () => {
    const onPokaz = vi.fn();
    pokaz(szczegol(), { onPokaz });
    expect(screen.getByText(/Szczotka od czoła/)).toBeInTheDocument();
    expect(screen.getByText(/A\. Lewandowska/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pokaż zdjęcie Z2" }));
    expect(onPokaz).toHaveBeenCalledWith(9);
  });

  it("wpis bez zdjęcia nie ma numeru — nie udaje powiązania", () => {
    pokaz(szczegol({ dowody: [dowod({ zalacznikId: null })] }));
    expect(screen.queryByRole("button", { name: /Pokaż zdjęcie/ })).not.toBeInTheDocument();
  });

  it("dodanie oddaje ekranowi treść i WYBRANE zdjęcie; pole czyści się po zapisie", async () => {
    const onDodaj = vi.fn();
    pokaz(szczegol(), { onDodaj });
    const pole = screen.getByLabelText("Nowy dowód");
    await userEvent.type(pole, "Bok krzywy, widać na Z1");
    /* Lista, nie ptaszek: zdjęć bywa kilka, a wpis wskazuje jedno. */
    const lista = screen.getByRole("combobox", { name: "Powiąż ze zdjęciem" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(lista).getAllByRole("option").map((o) => o.textContent?.slice(0, 2)))
      .toEqual(["be", "Z1", "Z2", "Z3"]);
    await userEvent.selectOptions(lista, "5");
    await userEvent.click(screen.getByRole("button", { name: "Dodaj" }));
    expect(onDodaj).toHaveBeenCalledWith("Bok krzywy, widać na Z1", 5, expect.any(Function));
    /* Pole stoi, dopóki ekran nie powie „zapisane" — porażka nie kasuje tekstu. */
    expect(pole).toHaveValue("Bok krzywy, widać na Z1");
    React.act(() => onDodaj.mock.calls[0][2]());
    expect(pole).toHaveValue("");
    expect(lista).toHaveValue("");
  });

  it("bez zdjęcia wybór oddaje `null`, nie zero", async () => {
    const onDodaj = vi.fn();
    pokaz(szczegol(), { onDodaj });
    await userEvent.type(screen.getByLabelText("Nowy dowód"), "Brak tabliczki");
    await userEvent.click(screen.getByRole("button", { name: "Dodaj" }));
    expect(onDodaj).toHaveBeenCalledWith("Brak tabliczki", null, expect.any(Function));
  });

  it("pusty albo za długi wpis nie wychodzi", async () => {
    pokaz(szczegol());
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeDisabled();
    const pole = screen.getByLabelText("Nowy dowód");
    await userEvent.type(pole, "   ");
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeDisabled();
    await userEvent.clear(pole);
    await userEvent.click(pole);
    await userEvent.paste("x".repeat(LIMIT_DOWODU + 1));
    expect(screen.getByRole("button", { name: "Dodaj" })).toBeDisabled();
    expect(screen.getByText(/o 1 za dużo/)).toBeInTheDocument();
  });

  it("usunięcie ma przycisk Z NAZWĄ wpisu, chowa wpis od razu i oddaje numer ekranowi po zamknięciu paska", async () => {
    const onUsun = vi.fn();
    pokaz(szczegol(), { onUsun });
    await userEvent.click(screen.getByRole("button", { name: /^Usuń dowód: Szczotka od czoła/ }));
    expect(screen.queryByText(/Szczotka od czoła/)).not.toBeInTheDocument();
    expect(screen.getByText("3 zdjęcia · 0 wpisów")).toBeInTheDocument();
    const pasek = screen.getByRole("status");
    expect(pasek).toHaveTextContent("Wpis usunięty.");
    expect(onUsun).not.toHaveBeenCalled();
    await userEvent.click(within(pasek).getByRole("button", { name: "Zamknij" }));
    expect(onUsun).toHaveBeenCalledWith(3, expect.any(Function));
    expect(screen.queryByText(/Szczotka od czoła/)).not.toBeInTheDocument();
  });

  it("„Cofnij” oddaje wpis bez żądania — cudzego akapitu nikt nie przepisze z pamięci", async () => {
    const onUsun = vi.fn();
    pokaz(szczegol(), { onUsun });
    await userEvent.click(screen.getByRole("button", { name: /^Usuń dowód: Szczotka od czoła/ }));
    await userEvent.click(screen.getByRole("button", { name: /Cofnij/ }));
    expect(screen.getByText(/Szczotka od czoła/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onUsun).not.toHaveBeenCalled();
  });

  it("bez „Cofnij” usunięcie wychodzi samo po oknie paska", () => {
    vi.useFakeTimers();
    const onUsun = vi.fn();
    pokaz(szczegol(), { onUsun });
    fireEvent.click(screen.getByRole("button", { name: /^Usuń dowód: Szczotka od czoła/ }));
    act(() => { vi.advanceTimersByTime(OKNO_COFNIECIA_CZYNNOSCI_MS - 1); });
    expect(onUsun).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onUsun).toHaveBeenCalledWith(3, expect.any(Function));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("następne usunięcie wysyła poprzednie, a wyjście ze sprawy — odłożone", async () => {
    const onUsun = vi.fn();
    const { unmount } = pokaz(szczegol({ dowody: [dowod(), dowod({ id: 4, tresc: "Tabliczka nieczytelna" })] }),
      { onUsun });
    await userEvent.click(screen.getByRole("button", { name: /^Usuń dowód: Szczotka od czoła/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Usuń dowód: Tabliczka/ }));
    expect(onUsun.mock.calls.map((c) => c[0])).toEqual([3]);
    unmount();
    expect(onUsun.mock.calls.map((c) => c[0])).toEqual([3, 4]);
  });

  it("odmowa serwera oddaje wpis na listę", async () => {
    const onUsun = vi.fn();
    pokaz(szczegol(), { onUsun });
    await userEvent.click(screen.getByRole("button", { name: /^Usuń dowód: Szczotka od czoła/ }));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Zamknij" }));
    act(() => { (onUsun.mock.calls[0]![1] as () => void)(); });
    expect(screen.getByText(/Szczotka od czoła/)).toBeInTheDocument();
  });

  it("błąd zapisu stoi pod polem zdaniem z serwera", () => {
    pokaz(szczegol(), { blad: "Załącznik spoza tej sprawy" });
    expect(screen.getByText("Załącznik spoza tej sprawy")).toBeInTheDocument();
  });
});

describe("Kolumna bez danych", () => {
  it("starszy serwer bez pola dowodów nie wywraca kolumny", () => {
    const s = szczegol();
    delete (s as Partial<SzczegolReklamacji>).dowody;
    pokaz(s);
    expect(screen.getByText("3 zdjęcia · 0 wpisów")).toBeInTheDocument();
  });

  it("bez zdjęć w sprawie nie ma czego wiązać — listy wyboru nie ma", () => {
    pokaz(szczegol({ czat: [], zalaczniki: [], dowody: [] }));
    expect(screen.getByText("0 zdjęć · 0 wpisów")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("„Wysłaliśmy” pokazuje ofertę zawsze, a kartotekę tylko wtedy, gdy wiemy, która to", () => {
    const { unmount } = pokaz(szczegol());
    const wyslane = screen.getByRole("region", { name: "Wysłaliśmy" });
    expect(within(wyslane).getByText("oferta")).toBeInTheDocument();
    expect(within(wyslane).queryByText("kartoteka")).not.toBeInTheDocument();
    unmount();
    pokaz(szczegol({}, { twId: 11 }));
    expect(within(screen.getByRole("region", { name: "Wysłaliśmy" })).getByText("kartoteka"))
      .toBeInTheDocument();
  });
});
