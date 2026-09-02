import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka } from "./Kolejka";
import type { Rozmowa } from "../api/typy";

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 4821, klient: "Kupujący 44300444",
  ostatniaWiadomosc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "new", odlozoneDo: null, poTerminie: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, nowychOdOdpowiedzi: 0, zadanieWToku: false, ...n,
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

  it("podgląd naszej wiadomości jest podpisany, podgląd klienta — nie", () => {
    /* Kolejka pokazuje słowa KLIENTA (0.166.0). Gdy klient nic nie napisał,
       stoi nasze zdanie z podpisem „Biuro" — bez niego autoodpowiedź konta
       Allegro czytała się jak pytanie. */
    const { rerender } = render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText(/Biuro:/)).not.toBeInTheDocument();
    rerender(<Kolejka rozmowy={[rozmowa({ ostatniaOdKlienta: false,
      ostatniaWiadomosc: "Przesyłka wyszła dziś." })]} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/Biuro:/)).toBeInTheDocument();
    expect(screen.getByText(/Przesyłka wyszła dziś/)).toBeInTheDocument();
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

  /* Kubełki z §10.1. Filtr sprawdzamy PO WIERSZACH, nie po liczniku: licznik
     zgodny z pustą listą byłby błędem, którego test po samym liczniku nie
     zobaczy. */
  const KOMPLET = [
    rozmowa({ id: 1, klient: "Nieprzypisana", status: "open" }),
    rozmowa({ id: 2, klient: "Moja", status: "open", wlascicielId: 7, wlasciciel: "Ja" }),
    rozmowa({ id: 3, klient: "Czeka", status: "waiting_for_customer", wlascicielId: 7, wlasciciel: "Ja" }),
    rozmowa({ id: 4, klient: "Zapomniana", status: "open", poTerminie: true,
      odlozoneDo: "2026-08-30T06:00:00.000Z" }),
    rozmowa({ id: 5, klient: "Sprawa z archiwum", status: "closed" }),
  ];

  const kubelek = async (etykieta: RegExp) => {
    render(<Kolejka rozmowy={KOMPLET} stan={STAN} wybranaId={null} mojeId={7} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: etykieta }));
  };

  it("kubełek MOJE pokazuje wyłącznie rozmowy zalogowanego agenta", async () => {
    await kubelek(/^Moje/);
    expect(screen.getByText("Moja")).toBeInTheDocument();
    expect(screen.getByText("Czeka")).toBeInTheDocument();
    expect(screen.queryByText("Nieprzypisana")).not.toBeInTheDocument();
  });

  it("kubełek PO TERMINIE wyławia rozmowę, o której zapomniano", async () => {
    await kubelek(/^Po terminie/);
    expect(screen.getByText("Zapomniana")).toBeInTheDocument();
    expect(screen.queryByText("Moja")).not.toBeInTheDocument();
  });

  it("zamknięta rozmowa schodzi z kolejki roboczej, ale zostaje we WSZYSTKICH", async () => {
    /* Ukrycie jej wszędzie znaczyłoby, że pomyłkowego zamknięcia nie da się
       cofnąć — nikt nie szuka sprawy, której nie widać na żadnej liście. */
    await kubelek(/^Nieprzypisane/);
    expect(screen.queryByText("Sprawa z archiwum")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Wszystkie/ }));
    expect(screen.getByText("Sprawa z archiwum")).toBeInTheDocument();
  });

  it("pusty kubełek nie udaje pustej skrzynki", async () => {
    /* „Nic nie czeka na mnie" i „nic nie przyszło" to dwa różne zdania.
       Jedno z nich kazałoby agentowi sprawdzać synchronizację. */
    render(<Kolejka rozmowy={[rozmowa({ status: "open" })]} stan={STAN} wybranaId={null}
      mojeId={7} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    expect(screen.getByText(/Ten kubełek jest pusty/)).toBeInTheDocument();
    expect(screen.queryByText(/Brak rozmów w zsynchronizowanej skrzynce/)).not.toBeInTheDocument();
  });

  it("wiersz niesie status po polsku i znacznik minionego terminu", () => {
    render(<Kolejka rozmowy={[rozmowa({ status: "open", poTerminie: true })]} stan={STAN}
      wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("Otwarta")).toBeInTheDocument();
    expect(screen.getByText(/po terminie/)).toBeInTheDocument();
  });

  it("wiersz mówi, kto siedzi przy rozmowie — ale nie o mnie samym", () => {
    /* Uchwyt widać ZANIM padnie pierwsze słowo odpowiedzi. Dowiadywanie się
       o koledze dopiero przy wysyłce znaczy dwie napisane odpowiedzi. */
    const { rerender } = render(<Kolejka
      rozmowy={[rozmowa({ oglada: { userId: 9, name: "M. Wójcik" } })]} stan={STAN}
      wybranaId={null} laduje={false} mojeId={7} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("M. Wójcik")).toBeInTheDocument();

    rerender(<Kolejka rozmowy={[rozmowa({ oglada: { userId: 7, name: "Ja" } })]} stan={STAN}
      wybranaId={null} laduje={false} mojeId={7} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText("Ja")).not.toBeInTheDocument();
  });
});

/* ── Wiersz z §10.2 (0.181.0) ────────────────────────────────────────────── */

const pokaz = (rozmowy: Rozmowa[]) =>
  render(<Kolejka rozmowy={rozmowy} stan={STAN} wybranaId={null} laduje={false}
    onWybierz={() => {}} onOdswiez={() => {}} />);

describe("wiersz kolejki niesie to, co §10.2 wymienia", () => {
  it("czas oczekiwania czyta się bez liczenia w głowie", () => {
    pokaz([rozmowa({ czekaOdMs: 2 * 3600_000 + 14 * 60_000 })]);
    expect(screen.getByText(/czeka 2 g 14 min/)).toBeInTheDocument();
  });

  it("rozmowa bez pytania klienta nie pokazuje zegara", () => {
    pokaz([rozmowa({ czekaOdMs: null })]);
    expect(screen.queryByText(/czeka/)).not.toBeInTheDocument();
  });

  it("PILNE widać w wierszu", () => {
    pokaz([rozmowa({ priorytet: "pilny" })]);
    expect(screen.getByText("PILNE")).toBeInTheDocument();
  });

  /* Nazwa mówi, co ta liczba MIERZY. „Nieprzeczytanych przez agenta" nie
     policzymy — Allegro daje samą flagę wątku — więc ekran tak ich nie nazywa. */
  it("licznik dopisków podpisuje się tym, co liczy", () => {
    pokaz([rozmowa({ nowychOdOdpowiedzi: 3 })]);
    expect(screen.getByText("3 dopiski klienta")).toBeInTheDocument();
  });

  it("pojedynczy dopisek nie zaśmieca wiersza licznikiem", () => {
    pokaz([rozmowa({ nowychOdOdpowiedzi: 1 })]);
    expect(screen.queryByText(/dopiski/)).not.toBeInTheDocument();
  });

  it("oczekujące zadanie terenowe widać przy rozmowie", () => {
    pokaz([rozmowa({ zadanieWToku: true })]);
    expect(screen.getByText(/zadanie w toku/)).toBeInTheDocument();
  });
});
