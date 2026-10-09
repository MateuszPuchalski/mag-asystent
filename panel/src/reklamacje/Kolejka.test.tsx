import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka, SYGNALY, inicjaly, kwotaWiersza, wGrupach } from "./Kolejka";
import type { Reklamacja } from "../api/typy";

/* ── Wiersz kolejki reklamacji ───────────────────────────────────────────────
   Wiersz czyta się W BIEGU, więc te testy pilnują tego, co na nim MUSI stać,
   i tego, czego stać nie może. Na wierszu stoją: klient, prowadzący, termin,
   towar, numer z datą zgłoszenia i czipy. Żądania i kwoty nie ma — mają dom
   w prawej kolumnie sprawy. Brak terminu mówi o sobie, bo puste miejsce
   czyta się jako „zdąży się”.                                               */

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
  kupionoAt: null, kupionoZrodlo: null, dniOdZakupu: null,
  prowadzi: null, prowadziId: null, tagi: [],
  notatkaAt: null, notatkaPrzez: null, maPoprzedniaNotatke: false, prowadziAt: null, notatka: null, wersja: 1,
  kubelek: "decyzja", sygnaly: [], link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: "Kosiarka spalinowa NAC LS 46-450", ofertaZdjecie: "brak",
  twId: null, twSymbol: null, twZParagonu: false,
    werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktWiadomosc: null,
  werdyktKwotaGrosze: null, werdyktAt: null, werdyktPrzez: null, werdyktBlad: null,
  zwrotTowaru: null, zwrotTowaruAt: null, ilosc: 1,
  ...n,
});

describe("Kolejka reklamacji", () => {
  it("wiersz zaczyna się od KLIENTA, potem towar, potem numer z datą zgłoszenia", () => {
    /* Login stoi pierwszy, mono i pogrubiony — ta sama notacja co w skrzynce. */
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    const login = screen.getByText("kupujacy1");
    expect(login.className).toMatch(/font-mono/);
    expect(login.className).toMatch(/font-bold/);
    const towar = screen.getByText("Kosiarka spalinowa NAC LS 46-450");
    expect(login.compareDocumentPosition(towar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* Nazwa w dwóch liniach: koniec nazwy części rozróżnia sprawy najczęściej. */
    expect(towar.className).toMatch(/line-clamp-2/);
    const numer = screen.getByText("123/2026");
    expect(numer.className).toMatch(/font-semibold/);
    expect(towar.compareDocumentPosition(numer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/^zgłoszono \d{2}\.\d{2}\.2026$/)).toBeInTheDocument();
  });

  it("na wierszu NIE MA żądania ani kwoty — mają dom w otwartej sprawie", () => {
    render(<Kolejka reklamacje={[rek({ kwotaGrosze: 4990, kwotaZrodlo: "paragon" })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.queryByText(/PLN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/zwrot pieniędzy/)).not.toBeInTheDocument();
    expect(screen.queryByText(/usterka przy używaniu/)).not.toBeInTheDocument();
  });

  it("numer stoi NA WIDOKU, więc wiersz nazywa się nim także dla czytnika", () => {
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByRole("button", { name: /123\/2026/ })).toBeInTheDocument();
    expect(screen.getByText("123/2026").className).not.toContain("sr-only");
  });

  it("login jest zwykłym tekstem — w przycisku wiersza nie ma drugiego przycisku", () => {
    /* Przycisków się nie zagnieżdża. Kopiuje głowica sprawy. */
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    expect(within(screen.getByRole("button")).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("kupujacy1").tagName).toBe("SPAN");
  });

  it("bez loginu mówi to wprost, zwykłym pismem, zamiast pustej linii", () => {
    render(<Kolejka reklamacje={[rek({ kupujacyLogin: null })]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("bez loginu").className).not.toMatch(/font-mono/);
  });

  it("kwota wiersza do porządku: pole serwera wygrywa, a bez niego zostaje żądany zwrot", () => {
    /* `undefined` to starszy serwer, który pola nie zna; `null` to serwer,
       który wie, że kwoty nie ma. To dwie różne odpowiedzi. */
    expect(kwotaWiersza(rek({ kwotaGrosze: 4990 }))).toBe(4990);
    expect(kwotaWiersza(rek())).toBe(12999);
    expect(kwotaWiersza(rek({ kwotaGrosze: null }))).toBeNull();
  });

  it("wiersz niesie ZDJĘCIE oferty 88 px — to tożsamość sprawy", () => {
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    /* Kafel mówi, w którym z TRZECH stanów jest: tu Allegro zdjęcia nie ma. */
    const kafel = screen.getByTitle("Allegro nie podało zdjęcia tej oferty");
    expect(kafel).toHaveStyle({ width: "88px", height: "88px" });
  });

  it("bez snapshotu oferty wiersz nie udaje, że zna towar", () => {
    render(<Kolejka reklamacje={[rek({ ofertaNazwa: null, ofertaZdjecie: "nieznane" })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("Oferty nie pobrano")).toBeInTheDocument();
    expect(screen.getByTitle(/jeszcze nie pobrano/)).toBeInTheDocument();
    expect(screen.getByText("123/2026")).toBeVisible();
  });

  it("brak terminu MÓWI o sobie — puste miejsce czytałoby się jako „zdąży się”", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: null, decyzjaDo: null })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("bez terminu")).toBeInTheDocument();
  });

  it("termin przekroczony liczy się w dniach, nie na minusie — „po” mówi nagłówek grupy", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: -2, poTerminie: true })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByRole("heading", { name: "Po terminie" })).toBeInTheDocument();
    expect(screen.getByTitle("Termin decyzji: przekroczony")).toHaveTextContent(/^2 dni$/);
  });

  it("poza grupą przekroczony termin mówi „po” sam", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: -2, poTerminie: false })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("2 dni po")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Po terminie" })).not.toBeInTheDocument();
  });

  it("plakietka terminu ma barwę pilności: czerwień od dnia terminu, bursztyn do trzech dni", () => {
    const { rerender } = render(<Kolejka reklamacje={[rek({ dniDoTerminu: 0 })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("dziś").className).toMatch(/text-ranga-zle/);
    rerender(<Kolejka reklamacje={[rek({ dniDoTerminu: 3 })]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("3 dni").className).toMatch(/text-ranga-uwaga/);
    rerender(<Kolejka reklamacje={[rek({ dniDoTerminu: 9 })]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("9 dni").className).toMatch(/text-ranga-nic/);
  });

  it("grupy: „Po terminie” pierwsza, potem grupa z nazwą bieżącego kubełka", () => {
    const lista = wGrupach([
      rek({ id: 1, numer: "1/2026", ofertaNazwa: "Pierwsza" }),
      rek({ id: 2, numer: "2/2026", ofertaNazwa: "Druga", poTerminie: true, dniDoTerminu: -5 }),
      rek({ id: 3, numer: "3/2026", ofertaNazwa: "Trzecia" }),
      rek({ id: 4, numer: "4/2026", ofertaNazwa: "Czwarta", poTerminie: true, dniDoTerminu: -1 }),
    ]);
    /* Kolejność w grupie zostaje ta, którą dał porządek — grupa jej nie tasuje. */
    expect(lista.map((r) => r.id)).toEqual([2, 4, 1, 3]);
    render(<Kolejka reklamacje={lista} wybrana={null} nazwaGrupy="Do decyzji" onWybierz={() => {}} />);
    const naglowki = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(naglowki).toEqual(["Po terminie", "Do decyzji"]);
    /* Wiersze w DOM idą tą samą kolejnością, po której ekran chodzi strzałkami. */
    expect(screen.getAllByRole("button").map((b) => b.textContent?.match(/\d\/2026/)?.[0]))
      .toEqual(["2/2026", "4/2026", "1/2026", "3/2026"]);
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
    /* Mapa zamiast łańcucha `?:`: łańcuch podpisywałby każdy nowy sygnał
       ostatnią gałęzią, czyli kłamał. „termin” niesie plakietka, nie czip. */
    render(<Kolejka reklamacje={[rek({
      sygnaly: ["klient_czeka", "doradca", "czat_zamkniety",
        "zwrot_wymagany", "status_nieznany", "werdykt_niepotwierdzony",
        "werdykt_nieudany", "towar_do_decyzji"],
    })]} wybrana={null} onWybierz={() => {}} />);
    for (const t of ["klient czeka", "doradca", "czat zamknięty",
      "zwrot towaru", "status?", "werdykt czeka", "werdykt nieudany", "towar?"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("termin mówi jedna plakietka z dniami, nie plakietka i czip naraz", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: 2, sygnaly: ["termin"] })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.queryByText("termin")).not.toBeInTheDocument();
    expect(screen.getByTitle("Termin decyzji: za 2 dni")).toHaveTextContent("2 dni");
  });

  it("prowadzący stoi INICJAŁAMI za loginem, a niczyja sprawa mówi „niczyja”", () => {
    const { rerender } = render(<Kolejka reklamacje={[rek({ prowadzi: "A. Lewandowska" })]}
      wybrana={null} onWybierz={() => {}} />);
    const kto = screen.getByTitle("Prowadzi: A. Lewandowska");
    expect(kto).toHaveTextContent(/^AL/);
    expect(screen.getByText("kupujacy1").compareDocumentPosition(kto)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("niczyja")).toBeInTheDocument();
  });

  it("własna sprawa mówi „prowadzisz” — rozstrzyga numer konta, nie imię", () => {
    render(<Kolejka reklamacje={[rek({ prowadzi: "A. Lewandowska", prowadziId: 7 })]}
      wybrana={null} mojeId={7} onWybierz={() => {}} />);
    const kto = screen.getByTitle("Prowadzisz tę sprawę (A. Lewandowska)");
    expect(kto).toHaveTextContent("prowadzisz");
    expect(kto.className).toMatch(/emerald/);
  });

  it("inicjały biorą dwa pierwsze człony imienia", () => {
    expect(inicjaly("A. Lewandowska")).toBe("AL");
    expect(inicjaly("Tomasz Nowak")).toBe("TN");
    expect(inicjaly("ala")).toBe("A");
  });

  it("zaznaczenie jest szare, bez bursztynu, a belka stoi przy każdym wierszu", () => {
    render(<Kolejka reklamacje={[rek({ id: 1 }), rek({ id: 2, numer: "2/2026" })]} wybrana={1}
      onWybierz={() => {}} />);
    const [wybrany, inny] = screen.getAllByRole("button");
    expect(wybrany.className).toContain("wiersz-wybrany");
    expect(wybrany.className).toContain("bg-slate-200");
    expect(wybrany.className).not.toMatch(/amber/);
    expect(inny.className).toContain("border-l-[3px]");
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
    /* Bez tej etykiety sprawa ROZSTRZYGNIĘTA wyglądałaby jak praca. */
    render(<Kolejka reklamacje={[rek({ kubelek: "zamknieta" })]} wybrana={null}
      zKubelkiem onWybierz={() => {}} />);
    expect(screen.getByText("Rozstrzygnięte")).toBeInTheDocument();
  });

  it("werdykt z PANELU stoi na wierszu zdaniem serwera; werdykt z Centrum Sprzedaży czipa nie ma", () => {
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

  it("sygnał na wierszu ma tytuł, który mówi, co znaczy", () => {
    render(<Kolejka reklamacje={[rek({ sygnaly: ["doradca"] })]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByTitle(SYGNALY.doradca.tytul)).toHaveTextContent("doradca");
  });

  it("wiersz niesie znacznik kolejki: Enter na wybranym idzie do pola odpowiedzi", () => {
    /* Edytor rozpoznaje wiersz po `data-wiersz-kolejki`. */
    render(<Kolejka reklamacje={[rek()]} wybrana={1} onWybierz={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-wiersz-kolejki");
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });
});
