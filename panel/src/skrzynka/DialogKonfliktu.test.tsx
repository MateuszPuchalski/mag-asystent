import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogKonfliktu } from "./DialogKonfliktu";

const props = {
  szczegoly: {
    lastMessageId: 88903,
    nowaWiadomosc: { id: 88903, tresc: "Dopisuję: kosiarka jest z 2019.", at: "2026-09-01T09:38:00.000Z" },
    kluczIdempotencji: "snd-4821-88903-a7f2",
  },
  szkic: "Do kosiarki NAC LS 46-450 pasuje szarpak SZR-148/82.",
  wysyla: false,
  blad: "",
  onWyslijMimoTo: () => {},
  onPopraw: () => {},
};

describe("DialogKonfliktu", () => {
  it("mówi, że nic nie poszło i że szkic został", () => {
    render(<DialogKonfliktu {...props} />);
    expect(screen.getByText(/Nic nie poszło do Allegro/)).toBeInTheDocument();
    expect(screen.getByText(/SZR-148\/82/)).toBeInTheDocument();
  });

  it("stawia szkic obok dopisku klienta", () => {
    render(<DialogKonfliktu {...props} />);
    expect(screen.getByText(/kosiarka jest z 2019/)).toBeInTheDocument();
    expect(screen.getByText(/wiadomość #88903/)).toBeInTheDocument();
  });

  it("„wyślij mimo to\" jest martwy bez jawnej zgody", async () => {
    /* Blizna 0.110.0: odpowiedź szła na starą wersję pytania po cichu.
       Zgoda musi być kliknięciem, a nie domysłem. */
    const wyslij = vi.fn();
    render(<DialogKonfliktu {...props} onWyslijMimoTo={wyslij} />);
    const przycisk = screen.getByRole("button", { name: "WYŚLIJ MIMO TO" });
    expect(przycisk).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(przycisk).toBeEnabled();
    await userEvent.click(przycisk);
    expect(wyslij).toHaveBeenCalledOnce();
  });

  it("pokazuje klucz idempotencji i obiecuje, co on daje", () => {
    render(<DialogKonfliktu {...props} />);
    expect(screen.getByText(/snd-4821-88903-a7f2/)).toBeInTheDocument();
    expect(screen.getByText(/nie utworzy drugiej odpowiedzi/)).toBeInTheDocument();
  });

  it("poprawa szkicu jest wyjściem głównym", async () => {
    const popraw = vi.fn();
    render(<DialogKonfliktu {...props} onPopraw={popraw} />);
    await userEvent.click(screen.getByRole("button", { name: "POPRAW SZKIC" }));
    expect(popraw).toHaveBeenCalledOnce();
  });
});
