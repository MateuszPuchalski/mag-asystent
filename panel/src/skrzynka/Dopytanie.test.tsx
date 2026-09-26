import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dopytanie } from "./Dopytanie";
import type { WymianaCopilota } from "../api/typy";

/* ── Dopytanie Copilota (0.332.0) ────────────────────────────────────────────
   Jedna granica jest tu ważniejsza od wszystkich razem: ODPOWIEDŹ IDZIE DO
   AGENTA. Gdyby ekran dał przycisk „wstaw do szkicu", jedno kliknięcie
   omijałoby wszystkie sita, którymi szkic jest sprawdzany przed wysłaniem
   do klienta — a te sita są jedynym powodem, dla którego tamtemu tekstowi
   da się ufać. Dlatego pierwszy test pilnuje CZEGOŚ, CZEGO NIE MA.          */

const w = (n: Partial<WymianaCopilota> = {}): WymianaCopilota => ({
  id: 1, pytanie: "Czy ten nóż pasuje do 46 cm?",
  odpowiedz: "Fakty tego nie rozstrzygają. Rozstrzygnie zdjęcie tabliczki.",
  twierdzenia: [], model: "atrapa", at: "2026-09-14T10:00:00.000Z",
  przez: "A. Lewandowska", ...n,
});

const props = (n: Partial<Parameters<typeof Dopytanie>[0]> = {}) => ({
  wymiany: [] as WymianaCopilota[], wylaczony: false, blad: null,
  pracuje: false, onPytaj: vi.fn(), limitZnakow: 600, ...n,
});

/**
 * Renderuje i ROZWIJA blok (0.342.0).
 *
 * Od tego wydania dopytanie jest zwinięte, dopóki nie ma o co pytać: pole
 * i przycisk zajmowały wysokość w każdej rozmowie, także tej, w której agent
 * niczego nie kwestionuje. `getByRole` pomija elementy ukryte, więc test
 * badający pole MUSI je wpierw otworzyć — inaczej sprawdzałby pustkę.
 */
function otworz(p: Parameters<typeof Dopytanie>[0]) {
  render(<Dopytanie {...p} />);
  fireEvent.click(screen.getByRole("button", { name: /Dopytaj Copilota/ }));
}

describe("dopytanie Copilota", () => {
  test("odpowiedź NIE MA przycisku wstawiania — to jest granica, nie brak", () => {
    /* Blok z odbytą wymianą otwiera się sam, więc nie ma tu czego rozwijać —
       i właśnie dlatego brak przycisku jest tu sprawdzalny, a nie pozorny. */
    render(<Dopytanie {...props({ wymiany: [w()] })} />);
    for (const slowo of [/wstaw/i, /zastąp/i]) {
      expect(screen.queryByRole("button", { name: slowo })).toBeNull();
    }
  });

  test("pod odpowiedzią stoi, co Copilot sprawdził w bazie — i nic, gdy nie sięgał", () => {
    render(<Dopytanie {...props({ wymiany: [
      w({ id: 1, narzedzia: [
        { nazwa: "szukaj_towaru", argument: "1123 120 0650", znakow: 120 },
        { nazwa: "pasowanie_towaru", argument: "GAZ-MS250", znakow: 300 },
      ] }),
      w({ id: 2, narzedzia: [] }),
    ] })} />);
    expect(screen.getByText(/Sprawdził w bazie: szukanie w kartotece „1123 120 0650”, pasowanie „GAZ-MS250”/))
      .toBeTruthy();
    expect(screen.getAllByText(/Sprawdził w bazie/)).toHaveLength(1);
  });

  test("ekran mówi wprost, kto czyta odpowiedź", () => {
    render(<Dopytanie {...props()} />);
    /* Krótko od 0.517.0: „tylko dla Ciebie" zamiast pięciu słów o tym samym. */
    expect(screen.getByText(/tylko dla Ciebie/i)).toBeTruthy();
  });

  test("puste pytanie nie da się wysłać", () => {
    const p = props();
    otworz(p);
    const przycisk = screen.getByRole("button", { name: /zapytaj/i });
    expect((przycisk as HTMLButtonElement).disabled).toBe(true);
  });

  test("pytanie leci po kliknięciu, a pole się czyści", () => {
    const p = props();
    otworz(p);
    const pole = screen.getByLabelText(/pytanie do copilota/i);
    fireEvent.change(pole, { target: { value: "  Skąd to wiesz?  " } });
    fireEvent.click(screen.getByRole("button", { name: /zapytaj/i }));

    expect(p.onPytaj).toHaveBeenCalledWith("Skąd to wiesz?");
    expect((pole as HTMLTextAreaElement).value).toBe("");
  });

  test("pytanie dłuższe od limitu blokuje przycisk, zanim żądanie poleci", () => {
    const p = props({ limitZnakow: 10 });
    otworz(p);
    fireEvent.change(screen.getByLabelText(/pytanie do copilota/i),
      { target: { value: "a".repeat(11) } });

    expect((screen.getByRole("button", { name: /zapytaj/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("11 / 10")).toBeTruthy();
  });

  test("licznik znaków milczy, dopóki daleko do limitu", () => {
    otworz(props({ limitZnakow: 600 }));
    fireEvent.change(screen.getByLabelText(/pytanie do copilota/i), { target: { value: "krótko" } });
    /* Licznik stale widoczny uczy pisać krótko zamiast pisać jasno. */
    expect(screen.queryByText(/\/ 600/)).toBeNull();
  });

  test("wymiany stoją naprzemiennie, z podpisem pytającego", () => {
    render(<Dopytanie {...props({ wymiany: [w(), w({ id: 2, pytanie: "A wersja z rozrusznikiem?" })] })} />);
    expect(screen.getByText(/A\. Lewandowska: Czy ten nóż pasuje do 46 cm\?/)).toBeTruthy();
    expect(screen.getByText(/A\. Lewandowska: A wersja z rozrusznikiem\?/)).toBeTruthy();
  });

  test("cudza rozmowa gasi i pole, i przycisk", () => {
    otworz(props({ wylaczony: true }));
    expect((screen.getByLabelText(/pytanie do copilota/i) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /zapytaj/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("błąd z serwera stoi przy przycisku, nie w konsoli", () => {
    otworz(props({ blad: "Ta rozmowa ma już 20 dopytań." }));
    expect(screen.getByText(/ma już 20 dopytań/)).toBeTruthy();
  });
});

describe("zwijanie dopytania (0.342.0)", () => {
  test("bez wymian blok jest ZWINIĘTY — wątpliwość rodzi się po przeczytaniu szkicu", () => {
    render(<Dopytanie {...props()} />);
    expect(screen.queryByRole("button", { name: /zapytaj/i })).toBeNull();
    expect(screen.getByText("Dopytaj Copilota")).toBeVisible();
  });

  test("odbyta wymiana otwiera blok sama — jest tam treść, nie sama możliwość", () => {
    render(<Dopytanie {...props({ wymiany: [w()] })} />);
    expect(screen.getByRole("button", { name: /zapytaj/i })).toBeVisible();
    expect(screen.getByText(/1 wymiana/)).toBeVisible();
  });

  test("liczebnik jest odmieniony — „3 wymian”, nie „3 wymiana”", () => {
    render(<Dopytanie {...props({ wymiany: [w(), w({ id: 2 }), w({ id: 3 })] })} />);
    expect(screen.getByText(/3 wymian/)).toBeVisible();
  });
});

/* ── Znalezione w sieci (@wydanie) ───────────────────────────────────────────
   Pasowanie z przeczytanej strony idzie jednym kliknięciem do Kolejki Wiedzy,
   nie do klienta. Zapisane nie ma już przycisku — mówi, gdzie czeka. */
describe("znalezione w sieci", () => {
  const pas = (n: Partial<NonNullable<WymianaCopilota["pasowania"]>[number]> = {}) => ({
    twId: 7, symbol: "W30-754", rodzaj: "maszyna" as const, marka: "Cub Cadet", model: "LT1050", wariant: null,
    url: "https://www.partstree.com/x", cytat: "Fits Cub Cadet LT1050", zrodloStrony: "katalog_dostawcy" as const,
    warunek: "strona: „Will not fit manual gearbox models.”", zapis: null, ...n,
  });

  test("pasowanie ze strony ma cytat, źródło, warunek i „Zapisz jako propozycję”", () => {
    const onZapiszPasowanie = vi.fn();
    render(<Dopytanie {...props({ wymiany: [w({ id: 4, pasowania: [pas()] })], onZapiszPasowanie })} />);
    const blok = screen.getByLabelText("Znalezione w sieci");
    expect(blok).toHaveTextContent("W30-754 → Cub Cadet LT1050");
    expect(blok).toHaveTextContent("Will not fit manual");
    expect(screen.getByRole("link", { name: /źródło/ })).toHaveAttribute("href", "https://www.partstree.com/x");
    fireEvent.click(screen.getByRole("button", { name: /Zapisz jako propozycję/ }));
    expect(onZapiszPasowanie).toHaveBeenCalledWith(4, 0);
  });

  test("zapisane mówi, gdzie czeka, i nie daje drugiego kliknięcia", () => {
    render(<Dopytanie {...props({ wymiany: [w({ pasowania: [pas({ zapis: "nowa" })] })], onZapiszPasowanie: vi.fn() })} />);
    expect(screen.getByLabelText("Znalezione w sieci")).toHaveTextContent("W Kolejce Wiedzy");
    expect(screen.queryByRole("button", { name: /Zapisz jako propozycję/ })).toBeNull();
  });
});
