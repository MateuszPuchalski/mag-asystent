import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Edytor } from "./Edytor";
import type { PropsSzkicuCopilota } from "./SzkicCopilota";
import type { SzkicCopilota } from "../api/typy";

/* ── Szkic z Copilota w edytorze (§14.6, 0.231.0) ────────────────────────────
   Pilnujemy granic, nie wyglądu: propozycja NIE wchodzi do pola sama;
   „Wstaw" dopisuje, „Zastąp" istnieje tylko, gdy jest co nadpisać; wyłączony
   Copilot daje zdanie zamiast martwego przycisku; w trybie komentarza nic
   z tego nie ma w drzewie; nieświeżość jest nazwana.                        */

const szkic = (n: Partial<SzkicCopilota> = {}): SzkicCopilota => ({
  tresc: "Dzień dobry, do gaźnika W09-0211 pasuje uszczelka LC170430140-0001 (F3).",
  zastrzezenia: [], uzyteFakty: ["F3"], twierdzenia: [], odczytZeZdjec: [], lukiKartoteki: { symbol: null, numery: [], modele: [], wpisane: [], czeka: 0 }, messageId: 41, model: "claude-opus-5",
  at: "2026-09-07T10:00:00Z", przez: "A. Lewandowska", ocena: null,
  daneDoboru: null, daneOcena: null, doborWersja: 1, pasowanie: null, pasowanieOcena: null, ...n,
});

const copilot = (n: Partial<PropsSzkicuCopilota> = {}): PropsSzkicuCopilota => ({
  stan: { wlaczony: true, powod: null, model: "claude-opus-5", modelKlasyfikacji: "claude-opus-5", maxPartia: 20,
    autoKlasyfikacja: false, autoSzkic: false },
  szkic: null, nieswiezy: false, doborWersja: 1, nowePolaDoboru: [], paraPasowania: null,
  uklada: false, blad: "", maSzkicAgenta: false, wylaczony: false,
  onUloz: vi.fn(), onPopraw: vi.fn(), onOdrzuc: vi.fn(), ...n,
});

const props = {
  szkic: "", cudza: false, wlasciciel: null as string | null, zapisuje: false, wysyla: false,
  onZmiana: vi.fn(), onZapisz: vi.fn(), onWyslij: vi.fn(),
  komentarz: "", onKomentarz: vi.fn(), onDodajKomentarz: vi.fn(),
  komentuje: false, agenci: [] as Array<{ userId: number; name: string }>, wzmianki: [] as number[],
  onWzmianki: vi.fn(),
  zalaczniki: [] as import("../api/rozmowy").ZalacznikSzkicu[],
  dodajeZalacznik: false, bladZalacznika: "",
  onDodajZalacznik: vi.fn(), onUsunZalacznik: vi.fn(),
};
const edytor = (c: PropsSzkicuCopilota, n: Partial<typeof props> = {}) =>
  render(<Edytor {...props} {...n} copilot={c} />);

describe("Szkic Copilota w edytorze", () => {
  it("przycisk woła ułożenie; wyłączony Copilot daje zdanie zamiast przycisku", async () => {
    const c = copilot();
    const { unmount } = edytor(c);
    await userEvent.click(screen.getByRole("button", { name: /Ułóż odpowiedź/ }));
    expect(c.onUloz).toHaveBeenCalledTimes(1);
    unmount();

    edytor(copilot({ stan: { wlaczony: false, powod: "Copilot jest wyłączony. Włącz go w wertis.env (COPILOT_MODE=anthropic).",
      model: "claude-opus-5", modelKlasyfikacji: "claude-opus-5", maxPartia: 20,
    autoKlasyfikacja: false, autoSzkic: false } }));
    expect(screen.queryByRole("button", { name: /Ułóż odpowiedź/ })).toBeNull();
    expect(screen.getByText(/COPILOT_MODE=anthropic/)).toBeInTheDocument();
  });

  it("w trakcie układania przycisk jest nieaktywny i mówi, co robi", () => {
    edytor(copilot({ uklada: true }));
    expect(screen.getByRole("button", { name: /Układam szkic z faktów/ })).toBeDisabled();
  });

  /* ── SZKIC W POLU, NIE W KARCIE POD NIM (@wydanie) ───────────────────────
     Decyzja właściciela z kanwy („A + B"). Treść modelu stoi w pustym polu
     jako podpowiedź, ale WARTOŚĆ pola zostaje pusta: wysyłka nie ma czego
     wysłać, dopóki agent nie przyjmie. To jest ta sama granica, co od 0.231.0,
     tylko narysowana w innym miejscu. */
  it("propozycja NIE wchodzi do pola sama — stoi w nim jako podpowiedź, Tab ją przyjmuje", async () => {
    const c = copilot({ szkic: szkic() });
    edytor(c);
    const pole = screen.getByLabelText("Szkic odpowiedzi");
    expect(pole).toHaveValue("");
    expect(screen.getByTestId("szkic-w-polu")).toHaveTextContent("LC170430140-0001");
    /* Podpowiedź opisuje pole dla czytnika ekranu, a placeholder nie nachodzi na nią. */
    expect(pole).toHaveAccessibleDescription(/LC170430140-0001/);
    expect(pole).not.toHaveAttribute("placeholder");
    /* Wysyłka martwa: wartość jest pusta, choć tekst widać. */
    expect(screen.getByRole("button", { name: /Wyślij do klienta/ })).toBeDisabled();

    pole.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(c.onPopraw).not.toHaveBeenCalled();
    pole.focus();
    await userEvent.keyboard("{Tab}");
    expect(c.onPopraw).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /Przyjmij szkic/ }));
    expect(c.onPopraw).toHaveBeenCalledTimes(2);
    /* Dwóch dróg do jednego pola już nie ma (22 września 2026). */
    expect(screen.queryByRole("button", { name: /Wstaw do szkicu/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Zastąp/ })).toBeNull();
    /* Treść stoi raz: w polu, nie drugi raz w karcie pod nim. */
    expect(screen.queryByTestId("szkic-copilota-tresc")).toBeNull();
  });

  it("Tab bez podpowiedzi przenosi fokus, a nie przyjmuje czegokolwiek", async () => {
    const c = copilot({ szkic: szkic(), maSzkicAgenta: true });
    edytor(c, { szkic: "Dzień dobry," });
    screen.getByLabelText("Szkic odpowiedzi").focus();
    await userEvent.keyboard("{Tab}");
    expect(c.onPopraw).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Szkic odpowiedzi")).not.toHaveFocus();
  });

  it("nieświeży szkic, cudza rozmowa i tryb notatki nie stawiają podpowiedzi w polu", async () => {
    const stary = edytor(copilot({ szkic: szkic(), nieswiezy: true }));
    expect(screen.queryByTestId("szkic-w-polu")).toBeNull();
    /* Stary zostaje w karcie, z treścią i nazwaną nieświeżością. */
    expect(screen.getByTestId("szkic-copilota-tresc")).toHaveTextContent("LC170430140-0001");
    stary.unmount();

    const cudzy = edytor(copilot({ szkic: szkic(), wylaczony: true }), { cudza: true, wlasciciel: "M. Wójcik" });
    expect(screen.queryByTestId("szkic-w-polu")).toBeNull();
    cudzy.unmount();

    edytor(copilot({ szkic: szkic() }));
    await userEvent.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));
    expect(screen.queryByTestId("szkic-w-polu")).toBeNull();
  });

  it("pierwsza litera agenta zasłania podpowiedź, a karta zwija treść", () => {
    const c = copilot({ szkic: szkic() });
    const { rerender } = edytor(c);
    const pole = screen.getByLabelText("Szkic odpowiedzi");
    rerender(<Edytor {...props} szkic="D" copilot={{ ...c, maSzkicAgenta: true }} />);
    expect(screen.queryByTestId("szkic-w-polu")).toBeNull();
    /* TO SAMO pole — gdyby podpowiedź zmieniała mu rodzica, kursor by przepadł. */
    expect(screen.getByLabelText("Szkic odpowiedzi")).toBe(pole);
    expect(screen.getByRole("button", { name: "Zastąp mój szkic" })).toBeInTheDocument();
    expect(screen.getByTestId("szkic-copilota-tresc").closest("details")).not.toHaveAttribute("open");
  });

  it("uwagi modelu zostają przy przyjętym tekście i znikają z nim", () => {
    const z = szkic({ ocena: "wstawiony", zastrzezenia: ["brak dowodu na dopasowanie do LS 46-450"] });
    const { rerender } = edytor(copilot({ szkic: z }), { szkic: "Dzień dobry, pasuje." });
    expect(screen.getByLabelText("Czego model nie znalazł w faktach")).toHaveTextContent("LS 46-450");
    rerender(<Edytor {...props} szkic="" copilot={copilot({ szkic: z })} />);
    expect(screen.queryByLabelText("Czego model nie znalazł w faktach")).toBeNull();
  });

  /* ── „Ułóż" tylko przy braku albo starości szkicu (22 września 2026) ─────
     Takt układa szkic sam; przycisk przy świeżej karcie kazałby zapłacić
     drugi raz za to samo. */
  it("świeża karta chowa „Ułóż”, stara i odrzucona przywraca go jako „ponownie”", () => {
    const { unmount } = edytor(copilot({ szkic: szkic() }));
    expect(screen.queryByRole("button", { name: /Ułóż/ })).toBeNull();
    unmount();

    const stary = edytor(copilot({ szkic: szkic(), nieswiezy: true }));
    expect(screen.getByRole("button", { name: "Ułóż ponownie" })).toBeInTheDocument();
    stary.unmount();

    edytor(copilot({ szkic: szkic({ ocena: "odrzucony" }) }));
    expect(screen.getByRole("button", { name: "Ułóż ponownie" })).toBeInTheDocument();
  });

  /* Zrzut właściciela z 8.09.2026: długi szkic rozpychał edytor, oś rozmowy
     zwijała się do jednej linii, a przyciski ginęły pod krawędzią kolumny.
     Z tamtego wydania zostaje POŁOWA, która naprawdę leczyła przyczynę:
     przyciski stoją NAD treścią, więc dół nie zabiera niczego do kliknięcia.

     Druga połowa — własny przewijany pojemnik na tekst — zeszła w 0.342.0
     decyzją właściciela („czytelność szkicu"). Okienko wysokości 224 px
     kazało czytać pięćset znaków przez szparę, w trzecim zagnieżdżonym pasku
     przewijania, a oś chroni `max-h-[60vh]` na edytorze — siatka założona
     dokładnie po to, żeby wewnętrzne nie były potrzebne. */
  /* Od @wydanie karta z treścią zostaje tylko POZA polem — tu nieświeża. */
  it("przyciski stoją PRZED treścią, a treść PŁYNIE bez własnego przewijania", () => {
    edytor(copilot({ szkic: szkic({ tresc: "linia\n".repeat(60) }), nieswiezy: true }));
    const wstaw = screen.getByRole("button", { name: "Popraw w edytorze" });
    const tresc = screen.getByTestId("szkic-copilota-tresc");
    expect(wstaw.compareDocumentPosition(tresc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tresc.className).not.toMatch(/max-h-\d+/);
    expect(tresc.className).not.toMatch(/overflow-y-auto/);
  });

  it("przy niepustym szkicu agenta ten sam przycisk mówi „Zastąp mój szkic”", async () => {
    /* Nadpisanie cudzej pracy ma być świadome — napis mówi, co się stanie,
       ZANIM ktoś kliknie. */
    const c = copilot({ szkic: szkic(), maSzkicAgenta: true });
    edytor(c, { szkic: "Dzień dobry," });
    expect(screen.queryByRole("button", { name: "Popraw w edytorze" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Zastąp mój szkic" }));
    expect(c.onPopraw).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    expect(c.onOdrzuc).toHaveBeenCalledTimes(1);
  });

  it("zastrzeżenia modelu stoją nad treścią, a nieświeżość jest nazwana", () => {
    edytor(copilot({ szkic: szkic({ zastrzezenia: ["brak dowodu na dopasowanie do LS 46-450"] }), nieswiezy: true }));
    expect(screen.getByLabelText("Czego model nie znalazł w faktach")).toHaveTextContent("brak dowodu");
    expect(screen.getByText(/powstał przed nową wiadomością klienta/)).toBeInTheDocument();
  });

  /* Dane doboru z rozmowy (przyrost trzeci): karta w edytorze tylko MÓWI, że
     są — wpisuje je zakładka Dobór. Druga nieświeżość: fakty się zmieniły. */
  it("mówi, co WPISAŁ do doboru, bez drugiego przycisku; zmiana doboru po szkicu jest nazwana", () => {
    /* „Wpisał", nie „rozpoznał" (0.341.0): dane wejściowe wchodzą do doboru
       same, w puste pola. Zdanie „wpisz je w zakładce Dobór" prosiło agenta
       o przepisanie tego, co system już zrobił. */
    edytor(copilot({ szkic: szkic({ doborWersja: 1 }), doborWersja: 2, nowePolaDoboru: ["Marka", "Model", "Silnik"] }));
    /* Od 0.342.0 zdanie stoi w JEDNYM pasku „Przy okazji" razem z pasowaniem
       i pokwitowaniem wiedzy — trzy ramki na jeden komunikat to był ścisk,
       nie porządek. Tekst rozbity na wiele elementów, stąd `textContent`. */
    expect(screen.getByTestId("luki-kartoteki").textContent)
      .toMatch(/Do doboru wpisano:\s*Marka, Model, Silnik/);
    expect(screen.getByTestId("luki-kartoteki").textContent).toMatch(/popraw w zakładce Dobór/i);
    expect(screen.queryByRole("button", { name: /Wpisz do danych/ })).toBeNull();
    expect(screen.getByText(/dane doboru zmieniły się od szkicu/)).toBeInTheDocument();
  });

  it("szkic sprzed migracji (wersja doboru 0) nie udaje nieświeżego, a bez nowych pól nie ma zdania", () => {
    edytor(copilot({ szkic: szkic({ doborWersja: 0 }), doborWersja: 3 }));
    expect(screen.queryByText(/dane doboru zmieniły się/)).toBeNull();
    expect(screen.queryByText(/Do doboru wpisano/)).toBeNull();
  });

  it("oceniony szkic znika z ekranu — wiersz zostaje dla pomiaru", () => {
    edytor(copilot({ szkic: szkic({ ocena: "odrzucony" }) }));
    expect(screen.queryByRole("region", { name: "Szkic Copilota" })).toBeNull();
  });

  it("w trybie komentarza nie ma ani przycisku, ani karty — szkic jest dla klienta", async () => {
    edytor(copilot({ szkic: szkic() }));
    await userEvent.click(screen.getByRole("button", { name: /Notatka wewnętrzna/ }));
    expect(screen.queryByRole("button", { name: /Ułóż odpowiedź/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Szkic Copilota" })).toBeNull();
  });

  it("cudza rozmowa blokuje układanie i wstawianie, tak jak pole szkicu", () => {
    /* Nieświeży, bo przy świeżym „Ułóż" nie stoi wcale — a test ma pokazać
       blokadę obu przycisków naraz. */
    edytor(copilot({ szkic: szkic(), nieswiezy: true, wylaczony: true }),
      { cudza: true, wlasciciel: "M. Wójcik" });
    expect(screen.getByRole("button", { name: "Ułóż ponownie" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Popraw w edytorze" })).toBeDisabled();
  });

  it("błąd układania stoi obok przycisku zdaniem", () => {
    edytor(copilot({ blad: "Model użył numeru XYZ-9999, którego nie ma w faktach — szkic odrzucony." }));
    expect(screen.getByText(/XYZ-9999/)).toBeInTheDocument();
  });
});

describe("pokwitowanie wiedzy z oferty (0.264.0)", () => {
  it("pasek mówi, CO POSZŁO DO BAZY — nie czego brakuje", () => {
    /* Do 0.263.0 wypisywał listę braków i przy następnym szkicu liczył ją od
       zera. Teraz kwituje trzy rzeczy: numery dopisane do kartoteki, pozycje
       zgodności, które weszły do wiedzy OD RAZU (0.341.0), i te, przy których
       marka milczała, więc zostały w kolejce. */
    edytor(copilot({ szkic: szkic({ lukiKartoteki: {
      symbol: "W09-0211", numery: [{ rodzaj: "oem", wartosc: "16100-ZH8-W61" }],
      modele: ["HONDA GX999"], wpisane: ["STIHL FS450"], czeka: 3,
    } }) }));
    const pasek = screen.getByTestId("luki-kartoteki");
    expect(pasek.textContent).toContain("W09-0211");
    expect(pasek.textContent).toContain("16100-ZH8-W61");
    expect(pasek.textContent).toContain("HONDA GX999");
    expect(pasek.textContent).toContain("3");
  });

  it("sam licznik kolejki wystarcza na pasek — drugi szkic już nic nie dopisuje", () => {
    /* Samowygaszanie: przy drugim kliknięciu numery są już zapisane, więc
       pokwitowanie jest puste. Licznik kolejki jest STANEM, nie przyrostem,
       i agent ma go widzieć dalej. */
    edytor(copilot({ szkic: szkic({ lukiKartoteki:
      { symbol: "W09-0211", numery: [], modele: [], wpisane: [], czeka: 2 } }) }));
    expect(screen.getByTestId("luki-kartoteki").textContent).toContain("2");
  });

  it("bez zapisu i bez kolejki nie ma paska — plakietka należy się wyjątkowi, nie normie", () => {
    edytor(copilot({ szkic: szkic() }));
    expect(screen.queryByTestId("luki-kartoteki")).toBeNull();
  });

  it("JEDEN pasek „Przy okazji” niesie wszystko, co Copilot zrobił obok szkicu", () => {
    /* Do 0.341.0 były to trzy osobne ramki: dane doboru, pasowanie
       i pokwitowanie wiedzy. Rozdzielenie miało sens, gdy każda niosła
       PRZYCISK; przycisków nie ma od 0.341.0, więc został sam komunikat. */
    edytor(copilot({
      nowePolaDoboru: ["Marka", "Model"],
      paraPasowania: "W09-0211 → LC170430140-0001",
      szkic: szkic({
        lukiKartoteki: {
          symbol: "W09-0211",
          numery: [{ rodzaj: "oem", wartosc: "16100-ZH8-W61" }],
          modele: ["FS450"], wpisane: ["STIHL MS 170"], czeka: 2,
        },
      }),
    }));

    const pasek = screen.getByTestId("luki-kartoteki");
    for (const fragment of ["Marka, Model", "W09-0211 → LC170430140-0001",
      "16100-ZH8-W61", "STIHL MS 170", "FS450", "czeka tam 2"]) {
      expect(pasek.textContent).toContain(fragment);
    }
    /* JEDEN pasek, nie cztery — o to w tym wydaniu chodzi. */
    expect(screen.getAllByTestId("luki-kartoteki")).toHaveLength(1);
  });

  it("licznik znaków siedzi w nagłówku, a nie w osobnym wierszu pod kartą", () => {
    edytor(copilot({ szkic: szkic({ tresc: "abcde" }) }));
    expect(screen.queryByText(/każde twierdzenie ma podpisane źródło/)).toBeNull();
    expect(screen.getByText(/5 znaków/)).toBeVisible();
  });
});
