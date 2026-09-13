import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Naglowek } from "./Naglowek";
import type { Zwrot } from "../api/typy";

/* ── Tożsamość zwrotu w nagłówku (0.207.0) ───────────────────────────────────
   Numer i login przeprowadziły się tu z prawej kolumny, więc razem z nimi
   przeprowadziły się testy, które ich pilnowały. Intencja każdego zostaje ta
   sama: link nigdy nie prowadzi donikąd, a puste pole mówi, że to Allegro
   czegoś nie podało — nie milczy.                                          */

const zwrot = (n: Partial<Zwrot> = {}): Zwrot => ({
  id: 1, externalId: "zw-1", numer: "N4QZ/2026", orderId: "ord-1",
  utworzono: "2026-08-20T07:28:12.000Z", paczkaAt: null, dostarczonoAt: null,
  przesylkaStatus: null, kubelek: "decyzja", sygnaly: [],
  terminAt: "2026-09-03T07:28:12.000Z", dniDoTerminu: 7,
  sumaPozycjiGrosze: 3798, kwotaPelnaGrosze: null, waluta: "PLN",
  linkZwrotu: null, zamowienie: null,
  werdykt: null, werdyktPowod: null, kwotaGrosze: null, kwotaWariant: null, korektaNumer: null, korektaZrodlo: null,
  zrodlo: "allegro", notatka: null, notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, kupujacyLogin: null, przewoznik: null, rozmowy: [],
  faktura: { dokId: null, numer: null, typ: null, zrodlo: null, at: null, przez: null },
  rejectionCode: null, wersja: 1, pozycje: [],
  ...n,
});

const CENTRUM = "https://salescenter.allegro.com/returns?page=1&limit=25" +
  "&from=2026-08-20T00%3A00%3A00.000Z&search=N4QZ%2F2026";

describe("Nagłówek zwrotu", () => {
  it("numer prowadzi do Centrum Sprzedaży, w nowej karcie i bez naszego adresu", () => {
    render(<Naglowek zwrot={zwrot({ linkZwrotu: CENTRUM })} />);
    const link = screen.getByRole("link", { name: /N4QZ\/2026/ });
    expect(link).toHaveAttribute("href", CENTRUM);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("bez adresu zostaje sam tekst — link donikąd jest gorszy od jego braku", () => {
    render(<Naglowek zwrot={zwrot()} />);
    expect(screen.queryByRole("link", { name: /N4QZ\/2026/ })).not.toBeInTheDocument();
    expect(screen.getByText("N4QZ/2026")).toBeInTheDocument();
  });

  it("login kupującego stoi przy numerze i KOPIUJE SIĘ KLIKNIĘCIEM", () => {
    /* Jedyna dana osobowa dopuszczona wprost przez politykę danych zwrotów.
       Przepisuje się go do panelu Allegro, więc kopiowanie jest tu pracą,
       nie ozdobą.

       Od 0.228.0 klika się SAM LOGIN, a nie ikonę obok: osobna ikona była
       drugim celem dotyku dla tej samej czynności, i to mniejszym. */
    render(<Naglowek zwrot={zwrot({ kupujacyLogin: "michael20177" })} />);
    const login = screen.getByRole("button", { name: /Kopiuj login/ });
    expect(login).toHaveTextContent("michael20177");
    expect(screen.queryByTitle("Kopiuj login kupującego")).toBeNull();
  });

  it("pusty login mówi, że nie podało go Allegro — nie znika", () => {
    /* Zgłoszenie właściciela z 0.177.0: „nie widzę nigdzie loginu klienta".
       Milczenie wygląda jak usterka panelu, nie jak brak danych. */
    render(<Naglowek zwrot={zwrot({ kupujacyLogin: null })} />);
    expect(screen.getByText(/kupujący: Allegro nie podało/)).toBeInTheDocument();
  });

  it("paczka nieodebrana nie linkuje donikąd i mówi, czym jest", () => {
    /* Allegro takiego bytu nie zna, więc nie ma czego otwierać — serwer oddaje
       wtedy `linkZwrotu = null`, a przedrostek techniczny nie ma prawa
       pokazać się operatorowi. */
    render(<Naglowek zwrot={zwrot({
      zrodlo: "nieodebrana", externalId: "nieodebrana:ABC-1", numer: null,
      notatka: "kurier zwrócił po 14 dniach" })} />);
    expect(screen.getByText("ABC-1")).toBeInTheDocument();
    expect(screen.getByText("nieodebrana paczka")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    /* NOTATKI TU JUŻ NIE MA (0.313.0): ma własną sekcję w kolumnie dowodów,
       z autorem, godziną i cofnięciem. Cytat w nagłówku byłby tym samym
       zdaniem po raz drugi na jednym ekranie. */
    expect(screen.queryByText(/kurier zwrócił po 14 dniach/)).toBeNull();
  });

  /* Do 0.213.0 ten test pilnował, że nagłówek NIESIE pytanie kubełka. Decyzją
     właściciela pytanie z nagłówka zeszło (0.214.0): stało nad przyciskami,
     które pytają o to samo i od razu odpowiadają. Strażnik zostaje, tylko
     odwrócony — żeby kopia nie wróciła tam przy następnej zmianie. */
  it("nagłówek NIE powtarza pytania kubełka — odpowiadają na nie przyciski pod nim", () => {
    render(<Naglowek zwrot={zwrot({ kubelek: "korekta" })} />);
    expect(screen.queryByText(/korekt/i)).toBeNull();
    render(<Naglowek zwrot={zwrot({ kubelek: "decyzja" })} />);
    expect(screen.queryByText(/Przyjąć czy odrzucić/i)).toBeNull();
  });

  it("tożsamość zwrotu w nagłówku zostaje: numer i login kupującego", () => {
    /* To jest jedyny powód istnienia tego paska — i to, co się z niego
       przepisuje. Zdjęcie pytania nie miało prawa tego ruszyć. */
    render(<Naglowek zwrot={zwrot({ numer: "70X0/2026", kupujacyLogin: "Fenix-Warszawa" })} />);
    expect(screen.getByText("70X0/2026")).toBeInTheDocument();
    expect(screen.getByText("Fenix-Warszawa")).toBeInTheDocument();
  });
});
