import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { PrzystanekDrogi, Reklamacja, StanPrzesylki, SzczegolReklamacji } from "../api/typy";
import { dataCyfrowa, dzienMiesiac } from "../ui";
import { DrogaSprawy, drogaZPrzystankami, krokiDrogi, type PytanieOPaczke } from "./DrogaSprawy";

/* ── Droga sprawy ────────────────────────────────────────────────────────────
   Pilnujemy kolejności sześciu kroków, stanu każdego z nich i tego, że brak
   danych zostaje brakiem: krok bez daty nie dostaje daty zgadniętej z innej.
   Dalej fakty zamówienia przy krokach i przystanki innych spraw zakupu. */

const rek = (n: Partial<Reklamacja> = {}): Reklamacja => ({
  id: 5, orderId: "ord-5", linkZamowienia: "https://allegro.pl/z/5",
  kupionoAt: "2026-09-18T10:00:00.000Z", otwartoAt: "2026-09-28T12:32:00.000Z", zgloszonoPoDniach: 10,
  wiadomosciIle: 5, ostatniaWiadomoscAt: "2026-10-08T09:05:00.000Z",
  decyzjaDo: "2026-10-12T10:00:00.000Z", dniDoTerminu: 3, poTerminie: false,
  oczekiwanie: "EXCHANGE", statusAllegro: "CLAIM_SUBMITTED",
  werdykt: null, werdyktNazwa: null, werdyktStatus: null, werdyktAt: null, ...n,
}) as Reklamacja;

const szczegol = (r: Partial<Reklamacja> = {}, reszta: Partial<SzczegolReklamacji> = {}) => ({
  reklamacja: rek(r),
  zamowienie: { kupionoAt: "2026-09-18T10:00:00.000Z", platnoscAt: "2026-09-18T10:02:00.000Z",
    platnoscTyp: "ONLINE", sumaGrosze: 4990, waluta: "PLN" },
  droga: [], sprawy: [],
  przesylka: { waybill: null, przewoznik: "InPost", status: "DELIVERED",
    dostarczonoAt: "2026-09-20T09:00:00.000Z", sprawdzonoAt: "2026-09-20T10:00:00.000Z" },
  ...reszta,
}) as unknown as SzczegolReklamacji;

const krok = (s: SzczegolReklamacji, klucz: string) => krokiDrogi(s).find((k) => k.klucz === klucz)!;

const pokaz = (s: SzczegolReklamacji, pytanie: PytanieOPaczke = {}) =>
  render(<MemoryRouter><DrogaSprawy szczegol={s} {...pytanie} /></MemoryRouter>);

const przesylka = (n: Partial<StanPrzesylki> = {}): StanPrzesylki => ({
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null, ...n,
});

const krokLi = (etykieta: RegExp) => screen.getAllByRole("listitem").find((li) => etykieta.test(li.textContent ?? ""))!;

describe("Droga sprawy", () => {
  it("sześć kroków w kolejności makiety, jako lista z nazwą", () => {
    pokaz(szczegol());
    const lista = screen.getByRole("list", { name: "Droga sprawy" });
    const nazwy = within(lista).getAllByRole("listitem").map((li) => li.textContent ?? "");
    ["Zakup", "Doręczono", "Zgłoszenie", "Rozmowa", "Decyzja", "Rozliczenie"]
      .forEach((n, i) => expect(nazwy[i]).toContain(n));
    /* Wąski ekran przewija rząd, zamiast go łamać. */
    expect(lista.className).toContain("overflow-x-auto");
  });

  it("przed werdyktem bieżąca jest decyzja, z terminem i liczbą dni", () => {
    pokaz(szczegol());
    const biezacy = screen.getAllByRole("listitem").filter((li) => li.getAttribute("aria-current") === "step");
    expect(biezacy).toHaveLength(1);
    expect(biezacy[0]).toHaveTextContent("Decyzja");
    expect(biezacy[0]).toHaveTextContent(`do ${dzienMiesiac("2026-10-12T10:00:00.000Z")} · 3 dni`);
    expect(krok(szczegol(), "zakup").stan).toBe("zrobiony");
    expect(krok(szczegol(), "rozliczenie").stan).toBe("przyszly");
  });

  it("podpisy mówią fakty: forma płatności, przewoźnik, po ilu dniach, ile wiadomości", () => {
    const s = szczegol();
    expect(krok(s, "zakup").podpis).toBe(`${dzienMiesiac("2026-09-18T10:00:00.000Z")} · online`);
    expect(krok(s, "doreczono").podpis).toBe(`${dzienMiesiac("2026-09-20T09:00:00.000Z")} · InPost`);
    expect(krok(s, "zgloszenie").podpis).toContain("po 10 dniach");
    expect(krok(s, "rozmowa").podpis).toContain("5 wiadomości");
    expect(krok(szczegol({ zgloszonoPoDniach: 1 }), "zgloszenie").podpis).toContain("po 1 dniu");
  });

  it("brak danych to krok bez daty, nie data zgadnięta z innego kroku", () => {
    const s = szczegol({}, {
      przesylka: { waybill: null, przewoznik: null, status: null, dostarczonoAt: null, sprawdzonoAt: null },
    });
    /* Nie pytaliśmy — i podpis mówi właśnie to, bez dnia. */
    expect(krok(s, "doreczono").podpis).toBe("nie sprawdzono");
    expect(krok(szczegol({}, { przesylka: null }), "doreczono").podpis).toBe("");
    /* Zielone koło obiecuje doręczenie: bez daty od przewoźnika krok zostaje szary. */
    expect(krok(s, "doreczono").stan).toBe("przyszly");
    const wDrodze = szczegol({}, {
      przesylka: { waybill: "X1", przewoznik: "InPost", status: "IN_TRANSIT", dostarczonoAt: null, sprawdzonoAt: "2026-09-19T10:00:00.000Z" },
    });
    expect(krok(wDrodze, "doreczono").stan).toBe("przyszly");
    const bezTerminu = szczegol({ decyzjaDo: null, dniDoTerminu: null });
    expect(krok(bezTerminu, "decyzja").podpis).toBe("");
  });

  it("rozmowa bez wiadomości nie udaje, że się odbyła", () => {
    const k = krok(szczegol({ wiadomosciIle: 0, ostatniaWiadomoscAt: null }), "rozmowa");
    expect(k.stan).toBe("przyszly");
    expect(k.podpis).toBe("bez wiadomości");
  });

  it("po naszym uznaniu decyzja jest za nami, a bieżące jest rozliczenie", () => {
    const s = szczegol({ werdykt: "ACCEPTED_EXCHANGE", werdyktNazwa: "Uznana — wymiana",
      werdyktStatus: "sent", werdyktAt: "2026-10-09T11:42:00.000Z" });
    expect(krok(s, "decyzja")).toMatchObject({ stan: "zrobiony",
      podpis: `${dzienMiesiac("2026-10-09T11:42:00.000Z")} · Uznana — wymiana` });
    expect(krok(s, "rozliczenie")).toMatchObject({ stan: "biezacy", podpis: "wymiana" });
  });

  it("nieudany werdykt nie zamyka decyzji — dalej czeka", () => {
    const s = szczegol({ werdykt: "ACCEPTED_EXCHANGE", werdyktStatus: "send_failed" });
    expect(krok(s, "decyzja").stan).toBe("biezacy");
  });

  it("po odrzuceniu nic nie jest bieżące, a rozliczenia nie ma", () => {
    const s = szczegol({ statusAllegro: "CLAIM_REJECTED" });
    expect(krok(s, "decyzja")).toMatchObject({ stan: "zrobiony", podpis: "odrzucona poza panelem" });
    expect(krok(s, "rozliczenie")).toMatchObject({ stan: "przyszly", podpis: "bez rozliczenia" });
    pokaz(s);
    expect(screen.getAllByRole("listitem").some((li) => li.hasAttribute("aria-current"))).toBe(false);
  });

  it("po terminie decyzja mówi, kiedy termin minął", () => {
    const k = krok(szczegol({ poTerminie: true, dniDoTerminu: -1 }), "decyzja");
    expect(k.podpis).toBe(`termin minął ${dzienMiesiac("2026-10-12T10:00:00.000Z")}`);
  });

  it("stan kroku słyszy też czytnik i widać go w atrybucie, nie w klasie ikony", () => {
    pokaz(szczegol({ wiadomosciIle: 0, ostatniaWiadomoscAt: null }));
    const li = screen.getAllByRole("listitem");
    expect(li[4]).toHaveTextContent("Decyzja, teraz");
    expect(li.map((x) => x.getAttribute("data-stan")))
      .toEqual(["zrobiony", "zrobiony", "zrobiony", "przyszly", "biezacy", "przyszly"]);
    expect(li[3]).toHaveTextContent("Rozmowa, przed nami");
  });
});

describe("Zakup: kwota, płatność i numer zamówienia", () => {
  it("opłacony zakup stoi kwotą zamiast koła, a czytnik słyszy „Zakup opłacony”", () => {
    pokaz(szczegol());
    const zakup = screen.getAllByRole("listitem")[0];
    expect(zakup).toHaveTextContent("Zakup opłacony: 49,90 PLN, zrobione");
    /* Kwota nie powtarza się w podpisie — stoi raz, w pigułce. */
    expect(krok(szczegol(), "zakup")).toMatchObject({ kwota: "49,90 PLN" });
    expect(krok(szczegol(), "zakup").podpis).not.toContain("49,90");
  });

  it("bez daty płatności nie ma kwoty ani „opłacony” — brak daty nie dowodzi zapłaty", () => {
    const s = szczegol({}, { zamowienie: { kupionoAt: "2026-09-18T10:00:00.000Z", platnoscAt: null,
      platnoscTyp: "CASH_ON_DELIVERY", sumaGrosze: 4990, waluta: "PLN" } as SzczegolReklamacji["zamowienie"] });
    expect(krok(s, "zakup").kwota).toBeUndefined();
    expect(krok(s, "zakup").podpis).toBe(`${dzienMiesiac("2026-09-18T10:00:00.000Z")} · za pobraniem`);
    pokaz(s);
    expect(screen.getAllByRole("listitem")[0]).not.toHaveTextContent(/opłacon|49,90/);
  });

  it("numer zamówienia jest łączem do Allegro z kopiowaniem, długi skrócony w środku", () => {
    pokaz(szczegol({ orderId: "29a5e4f0-1b2c-11ef-9c3d-0123456789ab" }));
    const link = screen.getByRole("link", { name: /29a5e4f0-1b2c-11ef-9c3d-0123456789ab/ });
    expect(link).toHaveAttribute("href", "https://allegro.pl/z/5");
    expect(link).toHaveTextContent("29a5…89ab");
    expect(screen.getByTitle("Kopiuj numer zamówienia")).toBeInTheDocument();
  });
});

describe("Doręczono: przesyłka do klienta", () => {
  it("nie pytaliśmy — „nie sprawdzono · sprawdź”, a Allegro pyta TYLKO kliknięcie", async () => {
    const onSprawdz = vi.fn();
    pokaz(szczegol({}, { przesylka: przesylka() }), { onSprawdzPrzesylke: onSprawdz });
    expect(krokLi(/Doręczono/)).toHaveTextContent("nie sprawdzono · sprawdź");
    expect(onSprawdz).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "sprawdź" }));
    expect(onSprawdz).toHaveBeenCalledTimes(1);
  });

  it("odróżnia BRAK NUMERU u Allegro od braku pytania", () => {
    pokaz(szczegol({}, { przesylka: przesylka({ sprawdzonoAt: "2026-09-29T10:00:00.000Z" }) }));
    expect(krokLi(/Doręczono/)).toHaveTextContent("Allegro nie ma numeru");
  });

  it("doręczenie stoi z datą i przewoźnikiem, numer listu da się skopiować", () => {
    pokaz(szczegol({}, { przesylka: przesylka({ waybill: "600000727616", przewoznik: "INPOST",
      status: "DELIVERED", dostarczonoAt: "2026-09-20T10:00:00.000Z", sprawdzonoAt: "2026-09-29T10:00:00.000Z" }) }));
    const li = krokLi(/Doręczono/);
    expect(li).toHaveTextContent(`${dzienMiesiac("2026-09-20T10:00:00.000Z")} · InPost`);
    expect(within(li).getByTitle("600000727616")).toHaveTextContent("6000…7616");
    expect(within(li).getByTitle("Kopiuj numer przesyłki")).toBeInTheDocument();
  });

  it("w drodze mówi SŁOWEM, nie kodem przewoźnika", () => {
    pokaz(szczegol({}, { przesylka: przesylka({ waybill: "6000", przewoznik: "DPD", status: "IN_TRANSIT",
      sprawdzonoAt: "2026-09-29T10:00:00.000Z" }) }));
    expect(krokLi(/Doręczono/)).toHaveTextContent("w drodze do klienta · DPD");
    expect(screen.queryByText(/IN_TRANSIT/)).not.toBeInTheDocument();
  });

  it("bez procedury pytania nie ma martwego przycisku", () => {
    pokaz(szczegol({}, { przesylka: przesylka() }));
    expect(screen.queryByRole("button", { name: /sprawdź/ })).not.toBeInTheDocument();
  });

  it("błąd pytania o paczkę stoi przy kroku, z ponowieniem obok", () => {
    pokaz(szczegol({}, { przesylka: przesylka() }),
      { onSprawdzPrzesylke: vi.fn(), bladPrzesylki: "Allegro nie odpowiedziało" });
    const li = krokLi(/Doręczono/);
    expect(within(li).getByText("Allegro nie odpowiedziało")).toBeInTheDocument();
    expect(within(li).getAllByRole("button", { name: "sprawdź" })).toHaveLength(1);
  });
});

describe("Inne sprawy tego zakupu stoją na drodze", () => {
  const przystanek = (rodzaj: PrzystanekDrogi["rodzaj"], id: number, at = "2026-09-25T10:00:00.000Z") =>
    ({ rodzaj, id, at, opis: null });

  it("pytanie z 25.09 staje między Doręczono a Zgłoszeniem i prowadzi do rozmowy", () => {
    pokaz(szczegol({}, { droga: [przystanek("rozmowa", 3), przystanek("reklamacja", 5, "2026-09-28T12:32:00.000Z")] }));
    const lista = screen.getAllByRole("listitem");
    expect(lista).toHaveLength(7);
    expect(lista[1]).toHaveTextContent("Doręczono");
    expect(lista[2]).toHaveAttribute("data-przystanek", "rozmowa");
    expect(lista[3]).toHaveTextContent("Zgłoszenie");
    const link = within(lista[2]).getByRole("link",
      { name: `Pytanie z ${dataCyfrowa("2026-09-25T10:00:00.000Z")} — otwórz rozmowę` });
    expect(link).toHaveAttribute("href", "/obsluga/skrzynka/3");
    expect(link).toHaveTextContent(`Pytanie${dzienMiesiac("2026-09-25T10:00:00.000Z")}`);
    /* Przystanek nie jest krokiem: bez stanu i bez „teraz”. */
    expect(lista[2]).not.toHaveAttribute("data-stan");
    expect(lista[2]).not.toHaveAttribute("aria-current");
  });

  it("zwrot i rozmowa linkują do swojej kolejki, ta reklamacja nie linkuje do siebie", () => {
    pokaz(szczegol({}, { droga: [przystanek("rozmowa", 3), przystanek("reklamacja", 5), przystanek("zwrot", 7)] }));
    expect(screen.getByRole("link", { name: /^Zwrot z .* — otwórz zwrot$/ })).toHaveAttribute("href", "/obsluga/zwroty/7");
    expect(screen.getByRole("link", { name: /^Pytanie z/ })).toHaveAttribute("href", "/obsluga/skrzynka/3");
    expect(screen.queryByRole("link", { name: /^Reklamacja/ })).not.toBeInTheDocument();
  });

  it("dyskusja z rodzeństwa i z drogi staje raz", () => {
    const dyskusja = { id: 8, typ: "DISPUTE", numer: null, temat: null, statusAllegro: null,
      decyzjaDo: null, otwartoAt: "2026-09-21T10:00:00.000Z", prowadzi: null, otwarta: true };
    pokaz(szczegol({}, { droga: [przystanek("dyskusja", 8, "2026-09-21T10:00:00.000Z"), przystanek("reklamacja", 5)],
      sprawy: [dyskusja] }));
    expect(screen.getAllByRole("link", { name: /^Dyskusja/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /^Dyskusja/ })).toHaveAttribute("href", "/obsluga/dyskusje/8");
  });

  it("bez innych spraw droga jest jak była — sześć kroków, żadnego przystanku", () => {
    pokaz(szczegol({}, { droga: [przystanek("reklamacja", 5)], sprawy: [] }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryAllByRole("link", { name: /otwórz/ })).toHaveLength(0);
    expect(document.querySelector("[data-przystanek]")).toBeNull();
  });

  it("krok bez daty zatrzymuje przystanek przed sobą — kolejność bez zgadywania", () => {
    const kroki = krokiDrogi(szczegol({ wiadomosciIle: 0, ostatniaWiadomoscAt: null }));
    const zwrot = { rodzaj: "zwrot" as const, id: 7, at: "2026-10-10T10:00:00.000Z" };
    const ulozone = drogaZPrzystankami(kroki, [zwrot])
      .map((p) => (p.typ === "krok" ? p.krok.klucz : p.sprawa.rodzaj));
    expect(ulozone).toEqual(["zakup", "doreczono", "zgloszenie", "zwrot", "rozmowa", "decyzja", "rozliczenie"]);
  });
});
