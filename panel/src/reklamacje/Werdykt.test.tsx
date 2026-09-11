import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { Reklamacja } from "../api/typy";
import { Werdykt, naGrosze } from "./Werdykt";

/* ── Pasek werdyktu ──────────────────────────────────────────────────────────
   Pilnujemy tego, co rozstrzyga o bezpieczeństwie kupującego, a czego nie widać
   w serwisie: dwa przyciski przed listą (prawo Hicka), lista zależna od gałęzi,
   kwota tylko przy częściowym, przycisk MARTWY bez wiadomości i bez zgody,
   ładunek w groszach, blok po wysłaniu z kopiowaniem i stanem, krok o towarze
   tylko po naszym uznaniu, ponowienie wyłącznie po `send_failed`.           */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "123/2026", orderId: "ord-1", offerId: "of-1",
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE",
  powodOpis: "Pękła obudowa", temat: null, opis: null,
  oczekiwanie: "PARTIAL_REFUND", oczekiwanaKwotaGrosze: 5000, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: "2026-09-20T10:00:00.000Z",
  dniDoTerminu: 13, poTerminie: false, zwrotWymagany: null, czatAktywny: true, czatUrwany: false,
  wiadomosciIle: 1, ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", kupionoAt: null, kupionoZrodlo: null,
  prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null, notatka: null,
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1,
  wersja: 1, kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: "Kosiarka", ofertaZdjecie: "brak", twId: null, twSymbol: null,
  ...n,
});

function pokaz(n: Partial<Reklamacja> = {}, p: Partial<React.ComponentProps<typeof Werdykt>> = {}) {
  const onWerdykt = vi.fn();
  const onTowar = vi.fn();
  const wynik = render(<Werdykt reklamacja={rek(n)} trwa={false} blad="" trwaTowar={false} bladTowaru=""
    onWerdykt={onWerdykt} onTowar={onTowar} {...p} />);
  return { onWerdykt, onTowar, ...wynik };
}

const przycisk = (nazwa: RegExp) => screen.getByRole("button", { name: nazwa });

describe("Werdykt", () => {
  it("najpierw DWA przyciski, lista dopiero po wyborze gałęzi — cztery uznania albo siedem odmów", async () => {
    pokaz();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.click(przycisk(/UZNAJĘ/));
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: "Uznana — częściowy zwrot pieniędzy" })).toBeInTheDocument();
    await userEvent.click(przycisk(/Anuluj/));
    await userEvent.click(przycisk(/ODRZUCAM/));
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(screen.getByRole("option", { name: "Odrzucona — towar zgodny z umową" })).toBeInTheDocument();
  });

  it("kwota pojawia się WYŁĄCZNIE przy częściowym zwrocie, z podpowiedzią, o co prosił klient", async () => {
    pokaz();
    await userEvent.click(przycisk(/UZNAJĘ/));
    expect(screen.queryByLabelText("Kwota zwrotu")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"), "ACCEPTED_PARTIAL_REFUND");
    expect(screen.getByLabelText("Kwota zwrotu")).toBeInTheDocument();
    expect(screen.getByText(/Klient prosi o 50,00 PLN/)).toBeInTheDocument();
  });

  it("przycisk stoi martwy bez wiadomości, bez zgody i bez kwoty przy częściowym; ładunek idzie w groszach", async () => {
    const { onWerdykt } = pokaz();
    await userEvent.click(przycisk(/UZNAJĘ/));
    await userEvent.selectOptions(screen.getByLabelText("Wartość werdyktu"), "ACCEPTED_PARTIAL_REFUND");
    const wyslij = () => przycisk(/WYŚLIJ WERDYKT/);
    expect(wyslij()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Wiadomość do kupującego"), "Zwracamy 40 zł.");
    expect(wyslij()).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(wyslij()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Kwota zwrotu"), "40,00");
    expect(wyslij()).toBeEnabled();
    await userEvent.click(wyslij());
    expect(onWerdykt).toHaveBeenCalledWith({
      werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "Zwracamy 40 zł.", kwotaGrosze: 4000,
    });
  });

  it("kwota: przecinek i kropka, śmieci dają null, nie zero", () => {
    expect(naGrosze("40,00")).toBe(4000);
    expect(naGrosze("12.5")).toBe(1250);
    expect(naGrosze("abc")).toBeNull();
    expect(naGrosze("")).toBeNull();
    expect(naGrosze("1,234")).toBeNull();
  });

  it("po wysłaniu: blok tylko do odczytu ze stanem, kwotą, autorem i kopiowaniem — bez przycisków werdyktu", () => {
    pokaz({
      werdykt: "ACCEPTED_PARTIAL_REFUND", werdyktNazwa: "Uznana — częściowy zwrot pieniędzy",
      werdyktStatus: "sent", werdyktWiadomosc: "Zwracamy 40 zł.", werdyktKwotaGrosze: 4000,
      werdyktPrzez: "Ala", werdyktAt: "2026-09-09T10:00:00.000Z", kubelek: "zamknieta",
    });
    expect(screen.getByText("Uznana — częściowy zwrot pieniędzy")).toBeInTheDocument();
    expect(screen.getByText(/40,00 PLN/)).toBeInTheDocument();
    expect(screen.getByText(/Wysłany — Allegro jeszcze nie potwierdziło/)).toBeInTheDocument();
    expect(screen.getByText(/^Ala/)).toBeInTheDocument();
    expect(screen.getByTitle("Kopiuj wiadomość werdyktu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /UZNAJĘ|ODRZUCAM|SPRÓBUJ/ })).not.toBeInTheDocument();
  });

  it("potwierdzenie z Allegro zieleni stan; niepewny los mówi, czego NIE robić", () => {
    const { unmount } = pokaz({ werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód",
      werdyktStatus: "sent", statusAllegro: "CLAIM_REJECTED", kubelek: "zamknieta" });
    expect(screen.getByText(/Potwierdzony przez Allegro/)).toBeInTheDocument();
    unmount();
    pokaz({ werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód",
      werdyktStatus: "send_uncertain", kubelek: "zamknieta" });
    expect(screen.getByText(/nie wysyłaj drugi raz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SPRÓBUJ/ })).not.toBeInTheDocument();
  });

  it("ponowienie WYŁĄCZNIE po `send_failed` — z poprzednim werdyktem i wiadomością w formularzu", async () => {
    const { onWerdykt } = pokaz({ werdykt: "REJECTED_MINOR_DEFECT", werdyktNazwa: "Odrzucona — wada nieistotna",
      werdyktStatus: "send_failed", werdyktBlad: "Allegro odpowiedziało 400", werdyktWiadomosc: "Wada nieistotna." });
    expect(screen.getByText(/Nieudany: Allegro odpowiedziało 400/)).toBeInTheDocument();
    await userEvent.click(przycisk(/SPRÓBUJ JESZCZE RAZ/));
    expect(screen.getByLabelText("Wartość werdyktu")).toHaveValue("REJECTED_MINOR_DEFECT");
    expect(screen.getByLabelText("Wiadomość do kupującego")).toHaveValue("Wada nieistotna.");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(przycisk(/WYŚLIJ WERDYKT/));
    expect(onWerdykt).toHaveBeenCalledWith({ werdykt: "REJECTED_MINOR_DEFECT", wiadomosc: "Wada nieistotna.", kwotaGrosze: null });
  });

  it("werdykt z Centrum Sprzedaży nie udaje naszego", () => {
    pokaz({ statusAllegro: "CLAIM_ACCEPTED", kubelek: "zamknieta" });
    expect(screen.getByText(/Rozstrzygnięta poza panelem/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("krok „towar do odesłania?” tylko po NASZYM uznaniu; zdanie startowe do edycji; po decyzji potwierdzenie z Allegro", async () => {
    const { onTowar, unmount } = pokaz({ werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy",
      werdyktStatus: "sent", kubelek: "zamknieta" });
    await userEvent.click(przycisk(/TOWAR DO ODESŁANIA/));
    const pole = screen.getByLabelText("Wiadomość o towarze");
    expect((pole as HTMLTextAreaElement).value).toMatch(/odesłanie reklamowanego towaru/);
    await userEvent.clear(pole);
    await userEvent.type(pole, "Odeślij na Ogrodową 1.");
    await userEvent.click(przycisk(/WYŚLIJ STANOWISKO/));
    expect(onTowar).toHaveBeenCalledWith("wymagany", "Odeślij na Ogrodową 1.");
    unmount();

    /* Odrzucona: kroku nie ma wcale. */
    const drugi = pokaz({ werdykt: "REJECTED_OTHER", werdyktNazwa: "Odrzucona — inny powód",
      werdyktStatus: "sent", kubelek: "zamknieta" });
    expect(screen.queryByText(/Towar do odesłania/)).not.toBeInTheDocument();
    drugi.unmount();

    /* Po decyzji: zdanie i potwierdzenie ze `zwrotWymagany`. */
    pokaz({ werdykt: "ACCEPTED_REFUND", werdyktNazwa: "Uznana — zwrot pieniędzy", werdyktStatus: "sent",
      zwrotTowaru: "niewymagany", zwrotWymagany: false, kubelek: "zamknieta" });
    expect(screen.getByText(/zostaje u klienta/)).toBeInTheDocument();
    expect(screen.getByText(/Allegro potwierdza: bez zwrotu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ODESŁANIA/ })).not.toBeInTheDocument();
  });
});
