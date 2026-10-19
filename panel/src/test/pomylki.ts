import type { OdpowiedzPomylek, Pomylka } from "../api/pomylki";

/* Wspólne dane testów rejestru pomyłek: ekranu, zera zapisu i wiązań. */

export const pomylka = (n: Partial<Pomylka> = {}): Pomylka => ({
  id: 7, zgloszono: "2026-10-12", login: "jan_kowalski", konto: 1, zamowienie: "a1b2c3d4-0000-4000-8000-000000000001",
  zwrotId: 31, coZamowil: null, coDostal: null, opis: null, uwagi: null, zrodlo: "odmowa",
  zbieral: null, pakowal: null, winaZbierajacego: false, winaPakujacego: false,
  nowyTowar: { wartosc: "tak", zKolejki: true },
  towarWrocil: { wartosc: null, zKolejki: false },
  odmowa: { wartosc: "tak", zKolejki: true, kod: "NEW_ITEM_SENT" },
  stan: "do_uzupelnienia", zakonczonaRecznie: false, wersja: 3, ...n,
});

export const MAGAZYNIERZY = [
  { userId: 11, name: "Marek", role: "magazynier", active: true },
  { userId: 12, name: "Ewa", role: "magazynier", active: true },
  { userId: 2, name: "Anna z biura", role: "biuro", active: true },
];

export const lista = (pomylki: Pomylka[], osoby: OdpowiedzPomylek["podsumowanie"]["osoby"] = []): OdpowiedzPomylek => ({
  pomylki, doUzupelnienia: pomylki.filter((p) => p.stan === "do_uzupelnienia").length,
  podsumowanie: { miesiac: "2026-10", razem: pomylki.length, osoby },
});

/** Odczyty ekranu pomyłek dla `atrapaZapisow`; nieznany adres → `undefined`. */
export const odczytPomylek = (pomylki: Pomylka[]) => (url: string): unknown => {
  if (url.startsWith("/api/pomylki?")) return lista(pomylki);
  if (url === "/api/users") return { users: MAGAZYNIERZY };
  const poz = url.match(/^\/api\/pomylki\/(\d+)\/pozycje$/);
  if (poz) return { pozycje: [{ nazwa: "Lampa LED 12V", ilosc: 1, sku: "LMP-12" },
    { nazwa: "Lampa LED 24V", ilosc: 2, sku: "LMP-24" }], podpowiedz: "lampa 24V" };
  return undefined;
};
