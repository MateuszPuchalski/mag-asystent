import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Reklamacja, WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";

/* ── Oś rozmowy reklamacyjnej ────────────────────────────────────────────────
   Trzy rzeczy warte testu:

   1. ZDJĘCIE WIDAĆ, NIE KLIKA SIĘ W NIE (0.223.0). W sklepie z częściami
      zdjęcie pękniętego elementu bywa całym zgłoszeniem, a nazwa pliku nie
      mówi o nim nic. To ta sama lekcja, którą skrzynka kupiła w 0.218.0.
   2. SPADEK NA PRZYCISK JEST CZĘŚCIĄ PROJEKTU. `podglad` to podpowiedź
      z nazwy pliku, więc bywa nieprawdziwa — a ekran nie ma prawa pokazać
      zepsutej ikony obrazu.
   3. ROLA AUTORA JEST PODPISEM. Rozmowa bywa trójstronna i doradcy Allegro
      nie odpowiada się tak, jak klientowi.                                  */

const scena = vi.hoisted(() => ({ obrazy: {} as Record<number, string | null | undefined> }));

/* Hak oddaje OBIEKT (wydanie „wspólny załącznik"): adres, zdanie porażki
   i ponowienie — ten sam kształt, co w skrzynce. `null` w identyfikatorze
   znaczy „nie pytaj" (plik bez podglądu). */
vi.mock("../towar/useZdjecie", () => ({
  useZdjecieZalacznikaReklamacji: (_r: number, id: number | null) =>
    ({ url: id == null ? undefined : scena.obrazy[id], blad: null, ponow: () => {} }),
}));
const pobrania = vi.hoisted(() => ({ lista: [] as string[] }));
vi.mock("../api/reklamacje", () => ({
  pobierzZalacznik: (_r: number, _z: number, nazwa: string) => {
    pobrania.lista.push(nazwa); return Promise.resolve();
  },
}));

const { Czat } = await import("./Czat");

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "123/2026", orderId: null, offerId: null,
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE",
  powodOpis: "Pękła obudowa po tygodniu", temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 1,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", prowadzi: null, prowadziAt: null,
  notatka: null, wersja: 1, kubelek: "decyzja", sygnaly: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: null, ofertaZdjecie: "nieznane", twId: null, twSymbol: null,
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1,
  ...n,
});

const zal = (id: number, nazwa: string, podglad: boolean): ZalacznikReklamacji =>
  ({ id, wiadomoscId: 1, nazwa, podglad });

const wiad = (n: Partial<WiadomoscReklamacji> = {}): WiadomoscReklamacji => ({
  id: 1, externalId: "w-1", autorLogin: "kupujacy1", autorRola: "BUYER",
  tresc: "Kosiarka przestała ciąć", utworzonoAt: "2026-09-06T10:01:00.000Z",
  zalaczniki: [], ...n,
});

describe("Oś rozmowy reklamacyjnej", () => {
  it("zdjęcie klienta rysuje się WPROST, bez zapisywania pliku na dysk", () => {
    scena.obrazy = { 9: "blob:obraz" };
    render(<Czat reklamacja={rek()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    const obraz = screen.getByRole("img", { name: "usterka.jpg" });
    expect(obraz).toHaveAttribute("src", "blob:obraz");
  });

  it("plik, którego trasa nie narysuje, spada na przycisk pobrania", async () => {
    /* `null` z haka znaczy „415 albo brak" — nazwa obiecywała obraz, bajty nie
       potwierdziły. Ekran ma wtedy dać drogę do pliku, nie zepsutą ikonę. */
    scena.obrazy = { 9: null };
    pobrania.lista = [];
    render(<Czat reklamacja={rek()} zalaczniki={[]}
      czat={[wiad({ zalaczniki: [zal(9, "usterka.jpg", true)] })]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /usterka\.jpg/ }));
    expect(pobrania.lista).toEqual(["usterka.jpg"]);
  });

  it("PDF nie udaje zdjęcia — dostaje przycisk od razu, bez pytania serwera", () => {
    /* `podglad: false` znaczy, że nawet nie próbujemy: jedno żądanie mniej
       przy każdym otwarciu sprawy z paragonem. */
    scena.obrazy = {};
    render(<Czat reklamacja={rek()} czat={[]}
      zalaczniki={[{ id: 5, wiadomoscId: null, nazwa: "paragon.pdf", podglad: false }]} />);
    expect(screen.getByRole("button", { name: /paragon\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("załącznik SAMEJ sprawy stoi przy zgłoszeniu, nie w rozmowie", () => {
    scena.obrazy = { 5: "blob:paragon" };
    render(<Czat reklamacja={rek()} czat={[]}
      zalaczniki={[zal(5, "dowod.png", true)]} />);
    expect(screen.getByRole("img", { name: "dowod.png" })).toBeInTheDocument();
  });

  it("rola autora jest PODPISEM — doradca Allegro to nie klient", () => {
    scena.obrazy = {};
    render(<Czat reklamacja={rek()} zalaczniki={[]} czat={[
      wiad(),
      wiad({ id: 2, externalId: "w-2", autorRola: "ADMIN", autorLogin: null,
        tresc: "Proszę o zdjęcie noża" }),
      wiad({ id: 3, externalId: "w-3", autorRola: "SELLER", autorLogin: "sprzedawca",
        tresc: "Załączam" }),
    ]} />);
    expect(screen.getByText("Klient")).toBeInTheDocument();
    expect(screen.getByText("Doradca Allegro")).toBeInTheDocument();
    expect(screen.getByText("My")).toBeInTheDocument();
  });

  it("niepełna rozmowa MÓWI o sobie, zamiast udawać całą", () => {
    scena.obrazy = {};
    render(<Czat reklamacja={rek({ wiadomosciIle: 5 })} zalaczniki={[]} czat={[wiad()]} />);
    expect(screen.getByText(/Ta rozmowa jest niepełna/)).toBeInTheDocument();
  });

  it("edytor jest WSTRZYKIWANY i stoi POD rozmową, a nie nad nią", () => {
    /* Do 0.223.0 stało tu zdanie „odpowiedź wysyła się w Centrum Sprzedaży".
       Przestało być prawdą razem z przyrostem drugim, więc zniknęło — a oś
       rozmowy sama nadal nic nie wysyła: mutacje mieszkają w ekranie.
       Kolejność ma znaczenie: pole do pisania pod ostatnią wiadomością to
       jedyny układ, w którym czyta się przed pisaniem. */
    scena.obrazy = {};
    render(<Czat reklamacja={rek()} zalaczniki={[]} czat={[wiad()]}
      edytor={<button type="button">WYŚLIJ ODPOWIEDŹ</button>} />);
    const edytor = screen.getByRole("button", { name: "WYŚLIJ ODPOWIEDŹ" });
    const ostatnia = screen.getByText("Kosiarka przestała ciąć");
    expect(ostatnia.compareDocumentPosition(edytor))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("bez wstrzykniętego edytora oś rozmowy nie dokłada niczego od siebie", () => {
    scena.obrazy = {};
    render(<Czat reklamacja={rek({ czatAktywny: false })} zalaczniki={[]} czat={[wiad()]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
