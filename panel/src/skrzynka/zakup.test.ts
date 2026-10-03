import { describe, expect, it } from "vitest";
import type { OsRozmowy, StanPrzesylki, WpisOsi, Zamowienie } from "../api/typy";
import { scalOs, stanZakupu, zdarzeniaZakupu } from "./zakup";

/* ── CO WIEMY O ZAKUPIE ─────────────────────────────────────────────────────
   Pasek statusu na karcie i linie zakupu w osi czytają te same fakty. Testy
   pilnują, że nie wymyślamy tego, czego Allegro nie podaje: „nadane" bez daty,
   „nieznane" gdy przesyłki nie sprawdzano i brak linii bez daty. */

const zam = (n: Partial<Zamowienie> = {}): Zamowienie => ({
  externalId: "17147703077", status: "READY_FOR_PROCESSING", kupujacyLogin: "k",
  dostawaGrosze: null, dostawaMetoda: null, platnoscTyp: "ONLINE",
  platnoscAt: "2026-10-02T14:12:00.000Z", fakturaZadana: null, sumaGrosze: 8999, waluta: "PLN",
  kupionoAt: "2026-10-02T14:10:00.000Z", link: null, pozycje: [], ...n,
} as unknown as Zamowienie);

const przes = (n: Partial<StanPrzesylki> = {}): StanPrzesylki => ({
  waybill: null, przewoznik: null, status: null, dostarczonoAt: null,
  sprawdzonoAt: "2026-10-03T08:00:00.000Z", ...n,
});

const krok = (s: ReturnType<typeof stanZakupu>, k: string) => s.kroki.find((x) => x.klucz === k)!;

describe("stanZakupu", () => {
  it("złożone i opłacone mają daty z zamówienia", () => {
    const s = stanZakupu(zam(), null);
    expect(krok(s, "zlozone")).toMatchObject({ stan: "tak", at: "2026-10-02T14:10:00.000Z" });
    expect(krok(s, "oplacone")).toMatchObject({ stan: "tak", at: "2026-10-02T14:12:00.000Z" });
  });

  it("opłacone bez daty też jest opłacone, gdy Allegro mówi READY_FOR_PROCESSING", () => {
    expect(krok(stanZakupu(zam({ platnoscAt: null }), null), "oplacone")).toMatchObject({ stan: "tak", at: null });
  });

  it("zamówienie jeszcze nie opłacone nie udaje opłaconego", () => {
    const s = stanZakupu(zam({ platnoscAt: null, status: "FILLED_IN" }), null);
    expect(krok(s, "oplacone").stan).toBe("nie");
  });

  it("za pobraniem nie ma daty wpłaty i nie jest ani opłacone, ani nieopłacone", () => {
    const k = krok(stanZakupu(zam({ platnoscTyp: "CASH_ON_DELIVERY", platnoscAt: null }), null), "oplacone");
    expect(k).toMatchObject({ etykieta: "Za pobraniem", stan: "nieznane" });
  });

  it("bez sprawdzenia przesyłki „nadane” i „dostarczone” są NIEZNANE, nie „nie”", () => {
    /* „Nie sprawdzano" i „sprawdzono, nic nie ma" to dwa różne następne ruchy agenta. */
    for (const p of [null, przes({ sprawdzonoAt: null })]) {
      const s = stanZakupu(zam(), p);
      expect(krok(s, "nadane").stan).toBe("nieznane");
      expect(krok(s, "dostarczone").stan).toBe("nieznane");
      expect(s.przesylkaNieSprawdzona).toBe(true);
    }
  });

  it("sprawdzono i nie ma numeru: nadane NIE, dostarczone NIE", () => {
    const s = stanZakupu(zam(), przes());
    expect(krok(s, "nadane").stan).toBe("nie");
    expect(krok(s, "dostarczone").stan).toBe("nie");
    expect(s.przesylkaNieSprawdzona).toBe(false);
  });

  it("numer przesyłki znaczy nadane, ale bez daty, której Allegro nie podaje", () => {
    const k = krok(stanZakupu(zam(), przes({ waybill: "JJD0001", przewoznik: "dpd" })), "nadane");
    expect(k).toMatchObject({ stan: "tak", at: null });
    expect(k.uwaga).toMatch(/nie podaje daty/);
  });

  it("dostarczone ma datę z trackingu", () => {
    const s = stanZakupu(zam(), przes({ waybill: "JJD0001", dostarczonoAt: "2026-10-04T09:00:00.000Z" }));
    expect(krok(s, "dostarczone")).toMatchObject({ stan: "tak", at: "2026-10-04T09:00:00.000Z" });
  });

  it("anulowane zamówienie jest oznaczone", () => {
    expect(stanZakupu(zam({ status: "CANCELLED" }), null).anulowane).toBe(true);
    expect(stanZakupu(zam(), null).anulowane).toBe(false);
  });
});

const osRozmowy = (n: Partial<OsRozmowy> = {}): OsRozmowy => ({
  rozmowa: { id: 10 }, os: [], droga: [],
  zamowienie: { externalId: "17147703077", link: null, pobrane: zam(), przesylka: null },
  ...n,
} as unknown as OsRozmowy);

describe("zdarzeniaZakupu", () => {
  it("składa złożone i opłacone jako wpisy zakupu z numerem zamówienia", () => {
    const w = zdarzeniaZakupu(osRozmowy());
    expect(w.map((x) => x.tresc)).toEqual(["Zamówienie 17147703077 złożone", "Zamówienie opłacone"]);
    expect(w.every((x) => x.rodzaj === "zakup" && !x.odKlienta)).toBe(true);
  });

  it("dostarczone dochodzi tylko z datą z trackingu", () => {
    const z = osRozmowy({ zamowienie: { externalId: "1", link: null, pobrane: zam(),
      przesylka: przes({ dostarczonoAt: "2026-10-04T09:00:00.000Z" }) } as never });
    expect(zdarzeniaZakupu(z).map((x) => x.tresc)).toContain("Paczka dostarczona");
    expect(zdarzeniaZakupu(osRozmowy()).map((x) => x.tresc)).not.toContain("Paczka dostarczona");
  });

  it("za pobraniem nie ma linii „opłacone”", () => {
    const z = osRozmowy({ zamowienie: { externalId: "1", link: null, pobrane:
      zam({ platnoscTyp: "CASH_ON_DELIVERY", platnoscAt: "2026-10-02T14:12:00.000Z" }), przesylka: null } as never });
    expect(zdarzeniaZakupu(z).map((x) => x.tresc)).not.toContain("Zamówienie opłacone");
  });

  it("zwrot, reklamacja i dyskusja tego zakupu dostają datę, opis i link do swojego ekranu", () => {
    const w = zdarzeniaZakupu(osRozmowy({ droga: [
      { rodzaj: "zwrot", id: 5, at: "2026-10-05T10:00:00.000Z", opis: "uszkodzony" },
      { rodzaj: "reklamacja", id: 6, at: "2026-10-06T10:00:00.000Z", opis: null },
      { rodzaj: "dyskusja", id: 7, at: "2026-10-07T10:00:00.000Z", opis: null },
    ] } as never));
    const zwrot = w.find((x) => x.id === "zakup:zwrot-5")!;
    expect(zwrot.tresc).toBe("Zwrot zgłoszony: uszkodzony");
    expect(zwrot.adres).toBe("/obsluga/zwroty/5");
    expect(w.find((x) => x.id === "zakup:reklamacja-6")!.adres).toBe("/obsluga/reklamacje/6");
    expect(w.find((x) => x.id === "zakup:dyskusja-7")!.adres).toBe("/obsluga/dyskusje/7");
  });

  it("własna rozmowa nie jest zdarzeniem własnej osi, inna rozmowa o zakupie tak", () => {
    const w = zdarzeniaZakupu(osRozmowy({ droga: [
      { rodzaj: "rozmowa", id: 10, at: "2026-10-02T14:20:00.000Z", opis: null },
      { rodzaj: "rozmowa", id: 11, at: "2026-10-02T14:30:00.000Z", opis: null },
    ] } as never));
    expect(w.map((x) => x.id)).not.toContain("zakup:rozmowa-10");
    expect(w.map((x) => x.id)).toContain("zakup:rozmowa-11");
  });

  it("wpis bez ważnej daty znika, zamiast stać w losowym miejscu osi", () => {
    const w = zdarzeniaZakupu(osRozmowy({
      zamowienie: { externalId: "1", link: null, pobrane: zam({ kupionoAt: null, platnoscAt: "nie-data" }), przesylka: null } as never,
      droga: [{ rodzaj: "zwrot", id: 5, at: "", opis: null }] as never }));
    expect(w).toEqual([]);
  });

  it("starsza odpowiedź bez drogi zakupu i bez zamówienia daje pustą listę, nie wyjątek", () => {
    expect(zdarzeniaZakupu({ rozmowa: { id: 1 }, zamowienie: null } as never)).toEqual([]);
  });
});

const wpis = (id: string, at: string, n: Partial<WpisOsi> = {}): WpisOsi => ({
  id, rodzaj: "wiadomosc", autor: "k", odKlienta: true, tresc: id, at, ofertaId: null, ...n,
});

describe("scalOs", () => {
  const z = (id: string, at: string) => wpis(`zakup:${id}`, at, { rodzaj: "zakup", odKlienta: false });

  it("wsuwa zdarzenie przed pierwszy nowszy wpis, zostawiając kolejność wpisów", () => {
    const os = [wpis("m1", "2026-10-03T10:00:00Z"), wpis("m2", "2026-10-03T11:00:00Z")];
    const w = scalOs(os, [z("a", "2026-10-02T14:00:00Z"), z("b", "2026-10-03T10:30:00Z")]);
    expect(w.map((x) => x.id)).toEqual(["zakup:a", "m1", "zakup:b", "m2"]);
  });

  it("zdarzenie nowsze od wszystkiego ląduje na końcu", () => {
    const w = scalOs([wpis("m1", "2026-10-03T10:00:00Z")], [z("a", "2026-10-09T10:00:00Z")]);
    expect(w.map((x) => x.id)).toEqual(["m1", "zakup:a"]);
  });

  it("dwa zdarzenia z tej samej chwili zostają w kolejności przyjścia", () => {
    const w = scalOs([], [z("a", "2026-10-02T10:00:00Z"), z("b", "2026-10-02T10:00:00Z")]);
    expect(w.map((x) => x.id)).toEqual(["zakup:a", "zakup:b"]);
  });

  it("bez zdarzeń oddaje ten sam obiekt", () => {
    const os = [wpis("m1", "2026-10-03T10:00:00Z")];
    expect(scalOs(os, [])).toBe(os);
  });
});
