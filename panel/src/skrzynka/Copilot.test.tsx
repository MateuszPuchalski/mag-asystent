import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EtykietaKategorii, PasekCopilota, ZnakCopilota, doRozpoznania } from "./Copilot";
import type { Kopilot, Rozmowa, StanCopilota } from "../api/typy";

/* Trzy rzeczy, po których poznaje się, że pasek nadaje się do hali biurowej:
   przycisk MÓWI LICZBĘ, stan wyłączony nie daje kliknąć i tłumaczy dlaczego,
   a etykieta dotycząca starszej wiadomości jest przygaszona. Czwarta —
   potwierdzenie nazywa koszt — bo bez niej agent klika w ciemno.            */

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 1, klient: "Kupujący 44300444", ostatniaWiadomosc: "Czy pasuje?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "new", odlozoneDo: null, poTerminie: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, reklamacyjna: false, nowychOdOdpowiedzi: 0,
  zadanieWToku: false, dobor: "not_started", kopilot: null, ...n,
});

const kopilot = (n: Partial<Kopilot> = {}): Kopilot => ({
  kategoria: "PRODUCT_AVAILABILITY", dodatkowe: [], akcja: "CHECK_STOCK", akcjaModelu: null,
  wymagaCzlowieka: false, brakDanychZamowienia: false, brakDanychProduktu: false,
  pewnosc: "wysoka", zrodlo: "MODEL", status: "SUCCESS", kody: [], uzasadnienie: null,
  nieaktualna: false, kategoriaCzlowieka: null, kategoriaModelu: "PRODUCT_AVAILABILITY", ...n,
});

const WLACZONY: StanCopilota = {
  wlaczony: true, powod: null, model: "claude-opus-5", modelKlasyfikacji: "claude-opus-5", maxPartia: 20,
};

describe("pasek Copilota nad kolejką", () => {
  it("do partii idą nierozpoznane, z etykietą po dopisku klienta i nieudane", () => {
    const lista = [
      rozmowa({ id: 1 }),
      rozmowa({ id: 2, kopilot: kopilot() }),
      rozmowa({ id: 3, kopilot: kopilot({ nieaktualna: true }) }),
      /* „Inne" do przejrzenia NIE wraca do partii: decyzja istnieje, więc
         drugie kliknięcie byłoby drugą zapłatą za tę samą odpowiedź. */
      rozmowa({ id: 4, kopilot: kopilot({ kategoria: "OTHER", status: "NEEDS_REVIEW" }) }),
      /* FAILED wraca — takt go nie ponawia, więc ponawia człowiek. */
      rozmowa({ id: 5, kopilot: kopilot({ kategoria: "OTHER", status: "FAILED", zrodlo: "FALLBACK" }) }),
    ];
    expect(doRozpoznania(lista).map((r) => r.id)).toEqual([1, 3, 5]);
  });

  it("przycisk niesie LICZBĘ, a potwierdzenie mówi, że to kosztuje", async () => {
    const onRozpoznaj = vi.fn();
    render(<PasekCopilota stan={WLACZONY} onRozpoznaj={onRozpoznaj}
      kandydaci={[rozmowa({ id: 7 }), rozmowa({ id: 9 })]} />);

    await userEvent.click(screen.getByRole("button", { name: /Rozpoznaj 2 rozmowy/ }));
    /* „Rozpoznam N" bez zdania o koszcie byłoby zaproszeniem bez ceny. */
    expect(screen.getByText(/to kosztuje/)).toBeTruthy();
    expect(onRozpoznaj).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Rozpoznaj" }));
    expect(onRozpoznaj).toHaveBeenCalledWith([7, 9]);
  });

  /* ── STAN SPOCZYNKU NIE DOSTAJE PASMA (0.251.0) ────────────────────────────
     Do 0.249.1 oba stany „nic się nie dzieje" — Copilot wyłączony i kubełek
     rozpoznany — zajmowały pełne pasmo nad listą pytań. Przycisku bez mocy nie
     ma dalej i to zostaje; zmienia się miejsce, w którym stoi POWÓD.        */

  it("wyłączony Copilot nie zajmuje pasma nad kolejką", () => {
    const onRozpoznaj = vi.fn();
    const { container } = render(<PasekCopilota onRozpoznaj={onRozpoznaj} kandydaci={[rozmowa()]}
      stan={{ ...WLACZONY, wlaczony: false, powod: "Copilot nie ma klucza." }} />);
    /* Przycisk, który nie może zadziałać, uczy nie klikać — a ta nauka
       zostaje także wtedy, gdy zacznie działać. */
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("powód wyłączenia NIE GINIE — niesie go znak w nagłówku", () => {
    /* §4.3: fakt wolno wyciszyć, nie wolno schować. Zdanie zeszło z pasma do
       podpowiedzi, ale dalej stoi na ekranie i dalej mówi PRZYCZYNĘ. */
    render(<ZnakCopilota kandydaci={[rozmowa()]}
      stan={{ ...WLACZONY, wlaczony: false, powod: "Copilot nie ma klucza." }} />);
    expect(screen.getByLabelText("Copilot nie ma klucza.")).toBeTruthy();
  });

  it("nie ma czego rozpoznawać — pasmo milczy, a znak mówi to wprost", () => {
    const { container } = render(
      <PasekCopilota stan={WLACZONY} kandydaci={[]} onRozpoznaj={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    render(<ZnakCopilota stan={WLACZONY} kandydaci={[]} />);
    expect(screen.getByLabelText(/Wszystkie rozmowy w tym kubełku/)).toBeTruthy();
  });

  it("znak milczy, gdy JEST co rozpoznawać — wtedy mówi pasmo", () => {
    /* Dwa głosy o jednej rzeczy to ten sam błąd, który ten przyrost naprawia
       w wierszu kolejki. Liczba i przycisk stoją w paśmie; znak ustępuje. */
    const { container } = render(<ZnakCopilota stan={WLACZONY} kandydaci={[rozmowa()]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("limit partii nie zjada reszty kubełka po cichu", () => {
    const kandydaci = Array.from({ length: 5 }, (_, i) => rozmowa({ id: i + 1 }));
    render(<PasekCopilota stan={{ ...WLACZONY, maxPartia: 2 }} kandydaci={kandydaci}
      onRozpoznaj={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Rozpoznaj 2 rozmowy/ })).toBeTruthy();
    expect(screen.getByText(/pozostanie 3/)).toBeTruthy();
  });

  it("partia przerwana pokazuje OBIE połowy: przerwę i to, co już zapłacone", () => {
    render(<PasekCopilota stan={WLACZONY} kandydaci={[]} onRozpoznaj={vi.fn()}
      wynik={{
        sklasyfikowane: 8, pominiete: [], bledy: [], przerwane: "Dostawca poprosił o przerwę.",
        zuzycie: { wej: 1, wyj: 1, cacheZapis: 0, cacheOdczyt: 0, kosztUsd: 0 },
      }} />);
    expect(screen.getByText("Dostawca poprosił o przerwę.")).toBeTruthy();
    /* Do 0.191.0 zdanie o przerwie wypierało podsumowanie. Człowiek, który nie
       wie, że osiem jest już rozpoznanych, kliknie ponownie i zapłaci drugi
       raz — a właśnie po to trasa oddaje 200, a nie błąd. */
    expect(screen.getByText(/Rozpoznano 8/)).toBeTruthy();
  });

  it("przeciążenie dostawcy nazywa dostawcę, a nie sąd modelu", () => {
    render(<PasekCopilota stan={WLACZONY} kandydaci={[]} onRozpoznaj={vi.fn()}
      wynik={{
        sklasyfikowane: 0, pominiete: [],
        bledy: [{ rozmowaId: 4977, powod: "przeciążone" }],
        przerwane: "Anthropic jest chwilowo przeciążone (529). "
          + "Nic nie zostało policzone ani opłacone — spróbuj za chwilę.",
        zuzycie: { wej: 0, wyj: 0, cacheZapis: 0, cacheOdczyt: 0, kosztUsd: 0 },
      }} />);
    /* Żywe trafienie na 0.191.0: 529 lądowało w `bledy` bez `przerwane`, więc
       jedyne, co ekran mówił, to „1 bez rozstrzygnięcia" — zdanie o modelu,
       który się nie zdecydował. Model nie został nawet zapytany. */
    expect(screen.getByText(/przeciążone/)).toBeTruthy();
    expect(screen.getByText(/spróbuj za chwilę/)).toBeTruthy();
  });
});

describe("plakietka i etykieta człowieka", () => {
  it("etykieta ze starszej wiadomości jest PRZYGASZONA, mówi dlaczego i nie daje się poprawiać", () => {
    const { container } = render(<EtykietaKategorii onPopraw={vi.fn()}
      kopilot={kopilot({ nieaktualna: true })} />);
    const plakietka = container.querySelector("[title]") as HTMLElement;
    expect(plakietka.getAttribute("title")).toMatch(/starszą wiadomość/);
    /* slate-600 od 0.255.0: na `bg-slate-100` nawet slate-500 daje 4.34:1
       przy progu 4.5. Świeża etykieta jest fioletowa — pilnuje test niżej. */
    expect(plakietka.className).toContain("text-slate-600");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("świeża etykieta jest wyraźna i niesie następny krok", () => {
    const { container } = render(<EtykietaKategorii kopilot={kopilot()} onPopraw={vi.fn()} />);
    expect((container.querySelector("[title]") as HTMLElement).className).toContain("text-violet-800");
    expect(screen.getByText(/sprawdź stan/)).toBeTruthy();
  });

  it("potwierdzenie to jedno kliknięcie i wysyła kategorię modelu", async () => {
    const onPopraw = vi.fn();
    render(<EtykietaKategorii kopilot={kopilot()} onPopraw={onPopraw} />);
    await userEvent.click(screen.getByRole("button", { name: "Potwierdź kategorię" }));
    expect(onPopraw).toHaveBeenCalledWith("PRODUCT_AVAILABILITY");
  });

  it("poprawka to jeden wybór z listy i mówi, JAK powinno być", async () => {
    const onPopraw = vi.fn();
    render(<EtykietaKategorii kopilot={kopilot()} onPopraw={onPopraw} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Popraw kategorię" }), "WRONG_PRODUCT");
    expect(onPopraw).toHaveBeenCalledWith("WRONG_PRODUCT");
  });

  it("po poprawce widać, co powiedział Copilot, a potwierdzenia już nie ma", () => {
    render(<EtykietaKategorii onPopraw={vi.fn()} kopilot={kopilot({
      kategoria: "WRONG_PRODUCT", kategoriaCzlowieka: "WRONG_PRODUCT" })} />);
    expect(screen.queryByRole("button", { name: "Potwierdź kategorię" })).toBeNull();
    expect(screen.getByText(/poprawione \(Copilot: Dostępność\)/)).toBeTruthy();
  });

  it("wymaga człowieka: ludzik przy plakietce, powód w dymku", () => {
    const { container } = render(<EtykietaKategorii onPopraw={vi.fn()} kopilot={kopilot({
      wymagaCzlowieka: true, kody: ["PROSBA_O_CZLOWIEKA"], akcja: "HUMAN_REVIEW" })} />);
    expect(screen.getByLabelText("wymaga człowieka")).toBeTruthy();
    expect((container.querySelector("[title]") as HTMLElement).getAttribute("title"))
      .toMatch(/klient prosi o człowieka/);
  });

  it("decyzji bez modelu nie da się „potwierdzić” — wolno tylko wskazać kategorię", () => {
    render(<EtykietaKategorii onPopraw={vi.fn()} kopilot={kopilot({
      kategoria: "OTHER", kategoriaModelu: null, zrodlo: "FALLBACK", status: "FAILED",
      pewnosc: null, kody: ["BLAD_MODELU"] })} />);
    expect(screen.queryByRole("button", { name: "Potwierdź kategorię" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Popraw kategorię" })).toBeTruthy();
  });

  it("decyzję ze struktury Allegro da się potwierdzić, a dymek mówi, skąd jest", async () => {
    const onPopraw = vi.fn();
    const { container } = render(<EtykietaKategorii onPopraw={onPopraw} kopilot={kopilot({
      kategoria: "MISSING_PRODUCT", kategoriaModelu: null, zrodlo: "ALLEGRO_MAPPING", pewnosc: null })} />);
    expect((container.querySelector("[title]") as HTMLElement).getAttribute("title"))
      .toMatch(/struktury wątku Allegro/);
    await userEvent.click(screen.getByRole("button", { name: "Potwierdź kategorię" }));
    expect(onPopraw).toHaveBeenCalledWith("MISSING_PRODUCT");
  });

  it("braki danych stoją obok plakietki — od nich agent zaczyna", () => {
    render(<EtykietaKategorii onPopraw={vi.fn()} kopilot={kopilot({
      brakDanychZamowienia: true, brakDanychProduktu: true })} />);
    expect(screen.getByText("brak zamówienia")).toBeTruthy();
    expect(screen.getByText("brak danych towaru")).toBeTruthy();
  });
});
