import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka, SYGNALY, kwotaWiersza, wGrupach, wspolneSygnaly } from "./Kolejka";
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
  it("wiersz zaczyna się od KLIENTA, potem towar, potem czego klient chce", () => {
    /* Uwaga właściciela: „Client powinien być bardziej widoczny". Login stoi
       pierwszy, mono i pogrubiony — ta sama notacja co w wierszu skrzynki. */
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    const login = screen.getByText("kupujacy1");
    expect(login.className).toMatch(/font-mono/);
    expect(login.className).toMatch(/font-bold/);
    const towar = screen.getByText("Kosiarka spalinowa NAC LS 46-450");
    expect(login.compareDocumentPosition(towar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* Towar schodzi o stopień, żeby prowadził klient. */
    expect(towar.className).not.toMatch(/font-semibold|font-bold/);
    /* Kod Allegro po polsku — słownik jest po naszej stronie, bo wiersz czyta
       człowiek przy biurku, a nie integrator. */
    expect(screen.getByText(/usterka przy używaniu/)).toBeInTheDocument();
    expect(screen.getByText("zwrot pieniędzy")).toBeInTheDocument();
  });

  it("numeru nie ma na widoku, ale wiersz nazywa się nim dla czytnika ekranu", () => {
    /* Ekran szuka wierszy po numerze, a czytnik ogłasza go przy wyborze. */
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByRole("button", { name: /reklamacja 123\/2026/ })).toBeInTheDocument();
    expect(screen.getByText(/reklamacja 123\/2026/).className).toContain("sr-only");
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

  it("kwota stoi OSOBNO z prawej, a nie w środku zdania o oczekiwaniu", () => {
    /* Kwota czyta się jak kolumna: oko porównuje ją z wierszem wyżej i niżej.
       Wklejona w zdanie „zwrot pieniędzy · 129,99" musiałaby być wyszukana. */
    render(<Kolejka reklamacje={[rek()]} wybrana={null} onWybierz={() => {}} />);
    const kwota = screen.getByText("129,99 PLN");
    expect(kwota).not.toHaveTextContent("zwrot pieniędzy");
    expect(screen.getByText("zwrot pieniędzy")).not.toHaveTextContent("129,99");
  });

  it("bez żądanej kwoty wiersz bierze cenę z PARAGONU i mówi, skąd ją ma", () => {
    render(<Kolejka reklamacje={[rek({ oczekiwanie: "EXCHANGE", oczekiwanaKwotaGrosze: null,
      kwotaGrosze: 4990, kwotaZrodlo: "paragon" })]} wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("49,90 PLN")).toHaveAttribute("title", "Cena z paragonu za reklamowane sztuki");
  });

  it("kwota nieznana to BRAK kwoty, nie zero złotych", () => {
    render(<Kolejka reklamacje={[rek({ oczekiwanaKwotaGrosze: null, kwotaGrosze: null })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.queryByText(/PLN/)).not.toBeInTheDocument();
  });

  it("kwota wiersza: pole serwera wygrywa, a bez niego zostaje żądany zwrot", () => {
    /* `undefined` to starszy serwer, który pola nie zna; `null` to serwer,
       który wie, że kwoty nie ma. To dwie różne odpowiedzi. */
    expect(kwotaWiersza(rek({ kwotaGrosze: 4990 }))).toBe(4990);
    expect(kwotaWiersza(rek())).toBe(12999);
    expect(kwotaWiersza(rek({ kwotaGrosze: null }))).toBeNull();
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
    /* Numer staje w linii towaru — wiersz ma dalej mówić, o jaką sprawę chodzi. */
    expect(screen.getByText(/123\/2026/)).toBeVisible();
    expect(screen.getByText(/123\/2026/).className).not.toContain("sr-only");
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

  it("termin przekroczony liczy się w dniach, nie na minusie — „po” mówi nagłówek grupy", () => {
    /* W grupie „Po terminie decyzji" słowo „po" na każdym wierszu byłoby tą
       samą czerwoną pigułką jedenaście razy; wiersz mówi już tylko „ile". */
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: -2, poTerminie: true })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByRole("heading", { name: "Po terminie decyzji" })).toBeInTheDocument();
    expect(screen.getByTitle("Termin decyzji: przekroczony")).toHaveTextContent(/^2 dni$/);
  });

  it("poza grupą przekroczony termin mówi „po” sam", () => {
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: -2, poTerminie: false })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.getByText("2 dni po")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("sprawy po terminie stoją PIERWSZE pod swoim nagłówkiem, reszta pod drugim", () => {
    const lista = wGrupach([
      rek({ id: 1, numer: "1/2026", ofertaNazwa: "Pierwsza" }),
      rek({ id: 2, numer: "2/2026", ofertaNazwa: "Druga", poTerminie: true, dniDoTerminu: -5 }),
      rek({ id: 3, numer: "3/2026", ofertaNazwa: "Trzecia" }),
      rek({ id: 4, numer: "4/2026", ofertaNazwa: "Czwarta", poTerminie: true, dniDoTerminu: -1 }),
    ]);
    /* Kolejność w grupie zostaje ta, którą dał porządek — grupa jej nie tasuje. */
    expect(lista.map((r) => r.id)).toEqual([2, 4, 1, 3]);
    render(<Kolejka reklamacje={lista} wybrana={null} onWybierz={() => {}} />);
    const naglowki = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(naglowki).toEqual(["Po terminie decyzji", "Pozostałe"]);
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
    /* Mapa zamiast łańcucha `?:` (poprawka z 0.209.0 przy zwrotach): łańcuch
       podpisywałby każdy nowy sygnał ostatnią gałęzią, czyli kłamał.
       „termin" jest w mapie, ale na wierszu go nie ma — mówi to plakietka. */
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
    /* Czip „termin" odpalał przy tym samym progu (≤ 3 dni), przy którym plakietka
       robi się czerwona — dwa znaki jednej rzeczy na jednym wierszu. */
    render(<Kolejka reklamacje={[rek({ dniDoTerminu: 2, sygnaly: ["termin"] })]}
      wybrana={null} onWybierz={() => {}} />);
    expect(screen.queryByText("termin")).not.toBeInTheDocument();
    expect(screen.getByTitle("Termin decyzji: za 2 dni")).toHaveTextContent("2 dni");
  });

  it("kto prowadzi sprawę, widać z kolejki — w pierwszej linii, za loginem", () => {
    render(<Kolejka reklamacje={[rek({ prowadzi: "A. Lewandowska" })]}
      wybrana={null} onWybierz={() => {}} />);
    const kto = screen.getByText("A. Lewandowska");
    expect(screen.getByText("kupujacy1").compareDocumentPosition(kto)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kto.parentElement).toBe(screen.getByText("kupujacy1").parentElement);
  });

  it("własna sprawa mówi „prowadzisz” — rozstrzyga numer konta, nie imię", () => {
    render(<Kolejka reklamacje={[rek({ prowadzi: "A. Lewandowska", prowadziId: 7 })]}
      wybrana={null} mojeId={7} onWybierz={() => {}} />);
    expect(screen.getByTitle("Prowadzisz tę sprawę (A. Lewandowska)")).toHaveTextContent("prowadzisz");
  });

  it("sygnał wspólny dla kubełka znika z wiersza, a pozostałe zostają", () => {
    /* Kolejka sama wspólnych nie liczy — lista z jednym wierszem miałaby
       wtedy wspólne wszystko. Mówi jej o nich ekran. */
    render(<Kolejka reklamacje={[rek({ sygnaly: ["klient_czeka", "doradca"] })]}
      wybrana={null} ukryjSygnaly={["klient_czeka"]} onWybierz={() => {}} />);
    expect(screen.queryByText("klient czeka")).not.toBeInTheDocument();
    expect(screen.getByTitle(SYGNALY.doradca.tytul)).toBeInTheDocument();
  });

  it("wspólne są sygnały KAŻDEJ sprawy, i to dopiero przy dwóch; termin nigdy", () => {
    const a = rek({ id: 1, sygnaly: ["termin", "klient_czeka", "doradca"] });
    const b = rek({ id: 2, sygnaly: ["termin", "klient_czeka"] });
    expect(wspolneSygnaly([a, b])).toEqual(["klient_czeka"]);
    /* Jedna sprawa nie ma z czym się porównać. */
    expect(wspolneSygnaly([a])).toEqual([]);
    expect(wspolneSygnaly([])).toEqual([]);
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
  it("wiersz niesie znacznik kolejki: Enter na wybranym idzie do pola odpowiedzi (0.549.0)", () => {
    /* Edytor skrzynki rozpoznaje wiersz po `data-wiersz-kolejki`. Bez znacznika
       Enter na wybranej sprawie nie prowadziłby do pisania. */
    render(<Kolejka reklamacje={[rek()]} wybrana={1} onWybierz={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-wiersz-kolejki");
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });
});
