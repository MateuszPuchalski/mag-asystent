import type { OdpowiedzPomylek, Pomylka, ZlapanePomylki } from "../api/pomylki";

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
  osobyReczne: [],
  podsumowanie: {
    miesiac: "2026-10", razem: pomylki.length, osoby,
    stany: {
      do_uzupelnienia: pomylki.filter((p) => p.stan === "do_uzupelnienia").length,
      w_toku: pomylki.filter((p) => p.stan === "w_toku").length,
      zakonczona: pomylki.filter((p) => p.stan === "zakonczona").length,
    },
    zrodla: {
      odmowa: pomylki.filter((p) => p.zrodlo === "odmowa").length,
      dosylka: pomylki.filter((p) => p.zrodlo === "dosylka").length,
      recznie: pomylki.filter((p) => p.zrodlo === "recznie").length,
    },
    bezWinnego: 0,
    trend: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
      .map((m) => ({ miesiac: m, razem: m === "2026-10" ? pomylki.length : 0 })),
    towary: [],
  },
});

/** Złapane przy pakowaniu: domyślnie trzy doby z Sellasist, w tym jedna czysta, i jedna pomyłka do klienta. */
export const zlapane = (n: Partial<ZlapanePomylki> = {}): ZlapanePomylki => {
  const dni = n.dni ?? [
    { data: "2026-10-17", zlapanych: 2 }, { data: "2026-10-18", zlapanych: 0 }, { data: "2026-10-19", zlapanych: 3 },
  ];
  const puste = dni.length === 0;
  return { wlaczone: true, dni, razem: puste ? null : dni.reduce((s, d) => s + d.zlapanych, 0),
    doKlienta: puste ? null : 1, osoby: [], bezOsoby: null, ...n };
};

/** Odczyty ekranu pomyłek dla `atrapaZapisow`; nieznany adres → `undefined`. */
export const odczytPomylek = (pomylki: Pomylka[], zlapanePakowania: ZlapanePomylki = zlapane()) => (url: string): unknown => {
  if (url.startsWith("/api/pomylki?")) return lista(pomylki);
  if (url === "/api/pomylki/zlapane") return zlapanePakowania;
  if (url === "/api/users") return { users: MAGAZYNIERZY };
  const poz = url.match(/^\/api\/pomylki\/(\d+)\/pozycje$/);
  if (poz) return { pozycje: [{ nazwa: "Lampa LED 12V", ilosc: 1, sku: "LMP-12" },
    { nazwa: "Lampa LED 24V", ilosc: 2, sku: "LMP-24" }], podpowiedz: "lampa 24V" };
  return undefined;
};
