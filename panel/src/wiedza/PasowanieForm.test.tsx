import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── Formularz pasowania część↔część (0.230.0) ──────────────────────────────
   Pilnujemy GRANIC, nie wyglądu: bez dowodu nic nie wychodzi (serwer i tak
   odbije, ale to przycisk ma to mówić); negatyw idzie z powodem z listy
   §11.4; kierunek z radia trafia do ciała jako para (twId, doTwId), bo
   relacja „X pasuje do Y" nie jest symetryczna.                             */

vi.mock("../wyszukiwarka", () => ({
  Wyszukiwarka: ({ onWybierz, etykieta }: { onWybierz: (t: unknown) => void; etykieta: string }) =>
    <button type="button" onClick={() => onWybierz({ id: 502, sym: "W09-0211", name: "Gaźnik GX160", locs: [] })}>{etykieta}</button>,
}));

const { PasowanieForm } = await import("./PasowanieForm");

const USZCZELKA = { twId: 811, symbol: "LC170430140-0001", nazwa: "Uszczelka gaźnika GX160" };
const GAZNIK = { twId: 502, symbol: "W09-0211", nazwa: "Gaźnik GX160" };

describe("PasowanieForm", () => {
  it("para stała: bez dowodu przycisk stoi, z dowodem wysyła kierunek i rolę", async () => {
    const onWyslij = vi.fn();
    render(<PasowanieForm para={{ czesc: USZCZELKA, doCzego: GAZNIK }} trwa={false} onWyslij={onWyslij} />);
    expect(screen.getByRole("button", { name: /Zaproponuj pasowanie/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Pozycja"), "od strony filtra");
    await userEvent.type(screen.getByLabelText("Dowód"), "katalog dostawcy, str. 12");
    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj pasowanie/ }));
    expect(onWyslij).toHaveBeenCalledWith({
      twId: 811, doTwId: 502, rola: "uszczelka", pozycja: "od strony filtra", polaryzacja: "pasuje",
      powodNegatywny: null, rodzajDowodu: "katalog_dostawcy", dowodTresc: "katalog dostawcy, str. 12",
      dowodLink: null, conversationId: null,
    });
  });

  it("negatyw niesie powód z listy — pole pojawia się dopiero przy „nie pasuje”", async () => {
    const onWyslij = vi.fn();
    render(<PasowanieForm para={{ czesc: USZCZELKA, doCzego: GAZNIK }} trwa={false} onWyslij={onWyslij} />);
    expect(screen.queryByLabelText("Powód negatywny")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "nie pasuje" }));
    await userEvent.selectOptions(screen.getByLabelText("Powód negatywny"), "srednica_ok_inne_mocowanie");
    await userEvent.type(screen.getByLabelText("Dowód"), "pomiar: inne mocowanie");
    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj pasowanie/ }));
    expect(onWyslij).toHaveBeenCalledWith(expect.objectContaining({
      polaryzacja: "nie_pasuje", powodNegatywny: "srednica_ok_inne_mocowanie",
    }));
  });

  it("z wyszukiwarką radio kierunku odwraca parę, a rozmowa daje dowód „rozmowa”", async () => {
    const onWyslij = vi.fn();
    render(<PasowanieForm kartoteka={GAZNIK} conversationId={4821} trwa={false} onWyslij={onWyslij} />);
    /* Drugi koniec nie wskazany — nie ma czego wysłać, choć dowód już stoi. */
    expect(screen.getByLabelText("Dowód")).toHaveValue("dobór w rozmowie #4821");
    expect(screen.getByRole("button", { name: /Zaproponuj pasowanie/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /pasuje do tej części/ }));
    await userEvent.click(screen.getByRole("button", { name: "Co pasuje" }));
    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj pasowanie/ }));
    /* Wskazana kartoteka (502) pasuje DO tej kartoteki — tu obie mają ten sam
       symbol z atrapy, więc liczy się wyłącznie kolejność identyfikatorów. */
    expect(onWyslij).toHaveBeenCalledWith(expect.objectContaining({
      twId: 502, doTwId: 502, rodzajDowodu: "rozmowa", conversationId: 4821,
    }));
  });

  it("domyślny kierunek z wyszukiwarką: ta część pasuje do wskazanej", async () => {
    const onWyslij = vi.fn();
    render(<PasowanieForm kartoteka={USZCZELKA} trwa={false} onWyslij={onWyslij} />);
    await userEvent.click(screen.getByRole("button", { name: "Do czego pasuje" }));
    await userEvent.type(screen.getByLabelText("Dowód"), "katalog");
    await userEvent.click(screen.getByRole("button", { name: /Zaproponuj pasowanie/ }));
    expect(onWyslij).toHaveBeenCalledWith(expect.objectContaining({ twId: 811, doTwId: 502 }));
  });
});
