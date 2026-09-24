import os from "node:os";

/* ── Adresy serwera w sieci magazynu (@wydanie) ───────────────────────────────
   Karta „Nowy kolektor" w panelu pokazuje kod do pobrania APK i adres do
   wpisania. Adresu z paska przeglądarki wziąć nie można: panel otwarty na
   samym serwerze to `localhost`, a z kolektora `localhost` jest kolektorem.
   Serwer zna swoje adresy — podaje prywatne IPv4, bo tylko te widzi hala.

   Kolejność: 192.168.x najpierw, potem 10.x i 172.16–31.x. Tak zwykle
   wyglądają sieci biurowe, a pierwszy adres na liście staje w kodzie. */

type Interfejsy = ReturnType<typeof os.networkInterfaces>;

const PRIORYTET: Array<[RegExp, number]> = [
  [/^192\.168\./, 0],
  [/^10\./, 1],
  [/^172\.(1[6-9]|2\d|3[01])\./, 2],
];

export function adresySieci(interfejsy: Interfejsy = os.networkInterfaces()): string[] {
  const wynik: Array<{ adres: string; p: number }> = [];
  for (const lista of Object.values(interfejsy)) {
    for (const a of lista ?? []) {
      if (a.internal || a.family !== "IPv4") continue;
      const p = PRIORYTET.find(([wz]) => wz.test(a.address))?.[1];
      if (p !== undefined && !wynik.some((w) => w.adres === a.address)) wynik.push({ adres: a.address, p });
    }
  }
  return wynik.sort((x, y) => x.p - y.p).map((w) => w.adres);
}
