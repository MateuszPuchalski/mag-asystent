import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Prowadzi } from "./Prowadzi";

/* ── Wspólny pasek „kto prowadzi" (0.392.0, przepisany w 0.395.0) ────────────
   Jeden kształt dla trzech ekranów, ale NIE jedno zachowanie. Testy pilnują
   trzech rzeczy, bo to one są tu decyzją:

   1. CUDZEJ SPRAWY NIE ODBIERA SIĘ STĄD. Przy sprawie wziętej przez kogoś
      innego przycisku nie ma wcale — idzie to osobną drogą, z powodem.
   2. BEZ PROCEDURY NIE MA PRZYCISKU. Skrzynka bierze od 0.395.0 sam znacznik,
      bo przejęcie dzieje się tam samo przy odpowiedzi; martwy przycisk uczy,
      że klikanie nic nie daje.
   3. SŁOWO „NIKT" DA SIĘ ZASTĄPIĆ zdaniem o tym, co stanie się samo — i to
      jest cena zdjęcia przycisku, nie ozdoba.                                */

describe("pasek prowadzącego", () => {
  it("bez prowadzącego mówi o nikim i proponuje wzięcie", async () => {
    const onKlik = vi.fn();
    render(<Prowadzi prowadzi={null} trwa={false} onProwadze={onKlik} />);

    expect(screen.getByText("nikt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Prowadzę tę sprawę" }));
    expect(onKlik).toHaveBeenCalled();
  });

  it("sprawa WZIĘTA PRZEZ KOGOŚ INNEGO nie ma przycisku — odbiera się osobną drogą", () => {
    render(<Prowadzi prowadzi="A. Lewandowska" trwa={false} onProwadze={vi.fn()} />);

    expect(screen.getByText("A. Lewandowska")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("własną sprawę da się odłożyć", async () => {
    const onKlik = vi.fn();
    render(<Prowadzi prowadzi="Ja" jaProwadze trwa={false} onProwadze={onKlik} />);

    expect(screen.getByText("Ty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Odłóż sprawę" }));
    expect(onKlik).toHaveBeenCalled();
  });

  it("BEZ PROCEDURY nie rysuje przycisku — tak bierze go skrzynka (0.395.0)", () => {
    /* Skrzynka nie ma czego wołać: przypisanie robi wysyłka odpowiedzi.
       Przycisk bez procedury byłby martwy. */
    render(<Prowadzi prowadzi={null} trwa={false} />);

    expect(screen.getByText("nikt")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("słowo „nikt” ustępuje zdaniu o tym, co stanie się SAMO", () => {
    /* Po zdjęciu przycisku agent nie ma skąd wiedzieć, kiedy rozmowa stanie
       się jego — i to zdanie jest jedynym miejscem, które mu to mówi. */
    render(<Prowadzi prowadzi={null} trwa={false}
      gdyNikt="nikt — przypisze pierwsza odpowiedź" />);

    expect(screen.getByText("nikt — przypisze pierwsza odpowiedź")).toBeInTheDocument();
  });
});
