import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka } from "./Kolejka";
import type { Reklamacja } from "../api/typy";

/* ── Wiersz kolejki reklamacji ───────────────────────────────────────────────
   Wiersz czyta się W BIEGU, więc te testy pilnują tego, co na nim MUSI stać,
   i tego, czego stać nie może. Najważniejszy jest termin: brak terminu ma
   powiedzieć o sobie, a nie zostawić puste miejsce, które czyta się jako
   „zdąży się".                                                             */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "123/2026", orderId: "ord-1", offerId: "of-1",
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT",
  powodTyp: "DEFECT_FOUND_DURING_USE", powodOpis: "Pękła obudowa",
  temat: "DEFECT_FOUND_DURING_USE", opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 12999, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: "2026-09-20T10:00:00.000Z",
  dniDoTerminu: 13, poTerminie: false, zwrotWymagany: null, czatAktywny: true, czatUrwany: false,
  wiadomosciIle: 3, ostatniaWiadomoscStatus: "BUYER_REPLIED",
  ostatniaWiadomoscAt: "2026-09-07T08:00:00.000Z", otwartoAt: "2026-09-06T10:00:00.000Z",
  prowadzi: null, prowadziId: null, prowadziAt: null, notatka: null, wersja: 1,
  kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: "Kosiarka spalinowa NAC LS 46-450", ofertaZdjecie: "brak",
  twId: null, twSymbol: null,
    werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1,
  ...n,
});

describe("Kolejka reklamacji", () => {
  it("wiersz niesie numer, klienta, powód i czego klient chce", () => {
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("123/2026")).toBeInTheDocument();
    expect(screen.getByText(/kupujacy1/)).toBeInTheDocument();
    /* Kod Allegro po polsku — słownik jest po naszej stronie, bo wiersz czyta
       człowiek przy biurku, a nie integrator. */
    expect(screen.getByText(/usterka przy używaniu/)).toBeInTheDocument();
    expect(screen.getByText(/zwrot pieniędzy · 129,99 PLN/)).toBeInTheDocument();
  });

  it("wiersz niesie ZDJĘCIE oferty i jej nazwę — to tożsamość sprawy", () => {
    /* „Pękła obudowa" przy zdjęciu kosiarki czyta się w biegu; przy samym
       numerze wymaga otwarcia sprawy. Kafel ma stały rozmiar także bez
       obrazu — rosnący przesuwałby wiersze pod kursorem. */
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("Kosiarka spalinowa NAC LS 46-450")).toBeInTheDocument();
    /* Kafel mówi, w którym z TRZECH stanów jest (blizna 0.214.0): tu Allegro
       zdjęcia tej oferty nie ma i to się samo nie naprawi. */
    expect(screen.getByTitle("Allegro nie podało zdjęcia tej oferty")).toBeInTheDocument();
  });

  it("bez snapshotu oferty wiersz nie udaje, że zna towar", () => {
    render(<Kolejka reklamacje={[rek({ ofertaNazwa: null, ofertaZdjecie: "nieznane" })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.queryByText("Kosiarka spalinowa NAC LS 46-450")).not.toBeInTheDocument();
    /* „Czekam na Allegro" to inny stan niż „Allegro zdjęcia nie ma" — i kafel
       jest jedynym miejscem, w którym widać, który to. */
    expect(screen.getByTitle(/jeszcze nie pobrano/)).toBeInTheDocument();
    /* Numer i powód zostają — wiersz ma dalej mówić, o jaką sprawę chodzi. */
    expect(screen.getByText("123/2026")).toBeInTheDocument();
  });

  it("nieznany powód zostaje SUROWY, zamiast zniknąć", () => {
    /* Wiersz, który cicho gubi powód, jest gorszy od wiersza z kodem: kod da
       się dopisać do słownika, pustego miejsca nikt nie zauważy. */
    render(<Kolejka reklamacje={[rek({ powodTyp: "COS_NOWEGO" })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText(/COS_NOWEGO/)).toBeInTheDocument();
  });

  it("brak terminu MÓWI o sobie — puste miejsce czytałoby się jako „zdąży się”", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: null, decyzjaDo: null })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("bez terminu")).toBeInTheDocument();
  });

  it("termin przekroczony liczy się w dniach PO, nie na minusie", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: -2, poTerminie: true })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("2 dni po")).toBeInTheDocument();
  });

  it("jeden dzień to „1 dzień”, dwa to „2 dni”", () => {
    const { rerender } = render(<Kolejka reklamacje={[rek({ dniDoTerminu: 1 })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("1 dzień")).toBeInTheDocument();
    rerender(<Kolejka reklamacje={[rek({ dniDoTerminu: 2 })]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("2 dni")).toBeInTheDocument();
  });

  it("dziś to „dziś”, a nie zero dni", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: 0 })]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("dziś")).toBeInTheDocument();
  });

  it("każdy sygnał ma etykietę — także ten dołożony jako ostatni", () => {
    /* Mapa zamiast łańcucha `?:` (poprawka z 0.209.0 przy zwrotach): łańcuch
       podpisywałby każdy nowy sygnał ostatnią gałęzią, czyli kłamał. */
    render(<Kolejka reklamacje={[rek({
      sygnaly: ["termin", "klient_czeka", "doradca", "czat_zamkniety",
        "zwrot_wymagany", "status_nieznany", "werdykt_niepotwierdzony",
        "werdykt_nieudany", "towar_do_decyzji"],
    })]} wybrana={null} onWybierz={() => {}} />);
    for (const t of ["termin", "klient czeka", "doradca", "czat zamknięty",
      "zwrot towaru", "status?", "werdykt czeka", "werdykt nieudany", "towar?"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("kto prowadzi sprawę, widać z kolejki — to znacznik dla reszty biura", () => {
    render(<Kolejka reklamacje={[rek({ prowadzi: "A. Lewandowska" })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("A. Lewandowska")).toBeInTheDocument();
  });

  it("wybrany wiersz jest wybrany także dla czytnika ekranu", () => {
    render(<Kolejka reklamacje={[rek()]} wybrana={1} onWybierz={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });

  it("kliknięcie oddaje identyfikator sprawy", async () => {
    const onWybierz = vi.fn();
    render(<Kolejka reklamacje={[rek({ id: 7 })]} wybrana={null} onWybierz={onWybierz} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onWybierz).toHaveBeenCalledWith(7);
  });

  it("pusty kubełek mówi co innego niż puste szukanie", () => {
    const { rerender } = render(
      <Kolejka reklamacje={[]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText(/Ten kubełek jest pusty/)).toBeInTheDocument();
    rerender(<Kolejka reklamacje={[]} wybrana={null} zKubelkiem onWybierz={() => {}} />);
    expect(screen.getByText(/nie pasuje do tego, czego szukasz/)).toBeInTheDocument();
  });

  it("przy szukaniu wiersz mówi, z którego kubełka pochodzi", () => {
    /* Wynik bywa z kubełka, którego nikt nie ogląda — bez tej etykiety sprawa
       ROZSTRZYGNIĘTA wyglądałaby jak praca. */
    render(<Kolejka reklamacje={[rek({ kubelek: "zamknieta" })]} wybrana={null}
      zKubelkiem onWybierz={() => {}} />);
    expect(screen.getByText("Rozstrzygnięte")).toBeInTheDocument();
  });
  it("werdykt z PANELU stoi na wierszu zdaniem serwera; werdykt z Centrum Sprzedaży czipa nie ma", () => {
    /* „Pochodzenie decyzji jest informacją": `werdykt: null` przy CLAIM_ACCEPTED
       znaczy „rozstrzygnięte poza panelem" i wiersz tego nie udaje. */
    render(<Kolejka reklamacje={[
      rek({ id: 1, numer: "1/2026", statusAllegro: "CLAIM_SUBMITTED", kubelek: "zamknieta",
        werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód", werdyktStatus: "sent",
        werdyktPrzez: "Ala" }),
      rek({ id: 2, numer: "2/2026", statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" }),
      rek({ id: 3, numer: "3/2026", werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy",
        werdyktStatus: "send_failed" }),
    ]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("Odrzucona — inny powód")).toBeInTheDocument();
    expect(screen.getByTitle("Werdykt z panelu: Ala")).toBeInTheDocument();
    /* Nieudany werdykt NIE dostaje czipa „uznana" — nic nie poszło. */
    expect(screen.queryByText("Uznana — zwrot pieniędzy")).not.toBeInTheDocument();
  });
});
