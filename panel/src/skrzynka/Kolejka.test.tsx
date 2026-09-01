import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka } from "./Kolejka";
import type { Rozmowa } from "../api/typy";

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 4821, klient: "Kupujący 44300444",
  ostatniaWiadomosc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z",
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "new", statusZapisany: "new", snoozeDo: null, wrocilaPoZamknieciu: false,
  oglada: null, ...n,
});

const STAN = { ostatniaSynchronizacja: "2026-09-01T07:05:00.000Z", bledy: 0 };

describe("Kolejka", () => {
  it("pusta lista mówi o sobie, ale data synchronizacji zostaje", () => {
    /* Pusta kolejka o 9:41 znaczy co innego, gdy synchronizator stanął o 7:05.
       Ekran nie ma prawa milczeć o tej różnicy. */
    render(<Kolejka rozmowy={[]} stan={STAN} wybranaId={null} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/Brak rozmów/)).toBeInTheDocument();
    expect(screen.getByText(/Ostatnia synchronizacja/)).toBeInTheDocument();
  });

  it("liczba błędów synchronizacji jest widoczna, gdy jest niezerowa", () => {
    const { rerender } = render(<Kolejka rozmowy={[]} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText(/błędów/)).not.toBeInTheDocument();
    rerender(<Kolejka rozmowy={[]} stan={{ ...STAN, bledy: 3 }} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/błędów: 3/)).toBeInTheDocument();
  });

  it("wiersz niesie klienta, fragment, właściciela i znacznik nowej wiadomości", () => {
    render(<Kolejka rozmowy={[rozmowa({ nieprzeczytana: true, wlasciciel: "M. Wójcik" })]}
      stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("Kupujący 44300444")).toBeInTheDocument();
    expect(screen.getByText(/szarpak pasuje/)).toBeInTheDocument();
    expect(screen.getByText("M. Wójcik")).toBeInTheDocument();
    expect(screen.getByText("NOWE")).toBeInTheDocument();
  });

  it("kliknięcie wiersza oddaje identyfikator rozmowy", async () => {
    const wybierz = vi.fn();
    render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={null} laduje={false}
      onWybierz={wybierz} onOdswiez={() => {}} />);
    await userEvent.click(screen.getByText("Kupujący 44300444"));
    expect(wybierz).toHaveBeenCalledWith(4821);
  });

  it("nieświeża kolejka mówi, z kiedy jest stan i czego może brakować", () => {
    /* Pusta kolejka przy stojącym synchronizatorze to nie „brak pytań",
       tylko „nie wiem" — i ekran ma to powiedzieć. */
    render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={null} laduje={false}
      nieswieza onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/STAN Z/)).toBeInTheDocument();
    expect(screen.getByText(/nie zostały jeszcze pobrane/)).toBeInTheDocument();
  });

  it("świeża kolejka nie straszy plakietką", () => {
    render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={null} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText(/STAN Z/)).not.toBeInTheDocument();
  });

  it("wybrany wiersz jest oznaczony dla czytnika ekranu, nie tylko kolorem", () => {
    render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={4821} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByRole("button", { current: true })).toBeInTheDocument();
  });

  it("wiersz niesie NASZ status obok flagi z Allegro", () => {
    /* „NOWE" mówi, że sprzedawca nie odpisał w Allegro; plakietka mówi, co
       z tym zrobiło biuro. Jedna kolumna dla obu kłamałaby przy rozmowie
       załatwionej telefonicznie. */
    render(<Kolejka rozmowy={[rozmowa({ nieprzeczytana: true, status: "waiting_for_customer" })]}
      stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("NOWE")).toBeInTheDocument();
    expect(screen.getByText("czeka na klienta")).toBeInTheDocument();
  });

  it("odłożona pokazuje datę powrotu, a wracająca po zamknięciu — znacznik", () => {
    const { rerender } = render(<Kolejka rozmowy={[rozmowa({
      status: "snoozed", statusZapisany: "snoozed", snoozeDo: "2026-09-05T06:00:00.000Z",
    })]} stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/wraca/)).toBeInTheDocument();

    rerender(<Kolejka rozmowy={[rozmowa({ wrocilaPoZamknieciu: true })]} stan={STAN}
      wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("WRÓCIŁA")).toBeInTheDocument();
  });

  it("wiersz mówi, kto siedzi przy rozmowie — ale nie o mnie samym", () => {
    const { rerender } = render(<Kolejka
      rozmowy={[rozmowa({ oglada: { userId: 9, name: "M. Wójcik" } })]} stan={STAN}
      wybranaId={null} laduje={false} mojeId={7} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("M. Wójcik")).toBeInTheDocument();

    rerender(<Kolejka rozmowy={[rozmowa({ oglada: { userId: 7, name: "Ja" } })]} stan={STAN}
      wybranaId={null} laduje={false} mojeId={7} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText("Ja")).not.toBeInTheDocument();
  });
});
