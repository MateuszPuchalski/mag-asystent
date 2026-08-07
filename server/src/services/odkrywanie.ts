import dgram from "node:dgram";
import { config } from "../config.js";
import { WERSJA } from "../wersja.js";
import { kodParowania } from "./parowanie.js";

/* ── Odpowiadanie na rozgłoszenia „gdzie jest serwer WERTIS?" ────────────────
   Kolektor bez ustawionego adresu wysyła rozgłoszenie UDP na cały LAN; ten
   moduł odpowiada mu adresem tego serwera. Nic nie inicjujemy sami — serwer
   MILCZY, dopóki ktoś nie zapyta.

   Świadomie UDP, a nie mDNS. mDNS jest standardem i byłby ładniejszy, ale
   wymaga multicastu, a tani punkt dostępowy w hali odrzuca multicast częściej
   niż rozgłoszenie. Zysk ze standardu jest żaden, gdy pakiet nie dolatuje.

   TO NIE JEST KANAŁ ZAUFANY i ten plik nie udaje, że jest. Odpowiedź mówi
   tylko tyle, ile widać po samym skanie portów: „tu stoi WERTIS pod tym
   adresem". Kolektor NIE wiąże się z tym adresem sam — pokazuje go człowiekowi
   do potwierdzenia, bo bez TLS-a nic nie odróżnia tej odpowiedzi od odpowiedzi
   cudzego urządzenia w tej samej sieci (DEPLOY.md §4).                        */

/** Rozgłoszenie musi zaczynać się od tego napisu — inaczej pakiet ignorujemy. */
export const PYTANIE = "WERTIS-GDZIE-SERWER-1";

/**
 * Najmniejsze rozgłoszenie, na jakie odpowiadamy.
 *
 * To NIE jest kaprys formatu, tylko blokada wzmocnienia. Adres nadawcy
 * w UDP podszywa się jednym polem, więc usługa odpowiadająca 200 bajtami na
 * pytanie 20-bajtowe jest gotowym wzmacniaczem do ataku na kogoś trzeciego.
 * Wymóg, żeby PYTANIE BYŁO NIE MNIEJSZE OD ODPOWIEDZI, odbiera temu sens:
 * napastnik musi wysłać tyle, ile chce uzyskać. Kolektor dopycha pakiet
 * zerami i nic go to nie kosztuje.
 */
export const MIN_PYTANIE = 256;

/**
 * Kto może pytać.
 *
 * Sieci prywatne, pętla zwrotna i link-local — czyli dokładnie te miejsca,
 * z których stoi kolektor. Gdyby port UDP kiedykolwiek wyszedł poza LAN
 * (przekierowanie na routerze, zła reguła zapory), serwer nadal nie odezwie
 * się do nikogo z zewnątrz.
 */
const DOZWOLONE = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^::ffff:127\./,
  /^::ffff:10\./,
  /^::ffff:192\.168\./,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
];

export const zLokalnejSieci = (adres: string): boolean => DOZWOLONE.some((re) => re.test(adres));

/** Treść odpowiedzi; `null`, gdy serwer nie zna własnego adresu w LAN. */
export function odpowiedz(): string | null {
  const adres = kodParowania();
  return adres ? JSON.stringify({ wertis: 1, adres, wersja: WERSJA }) : null;
}

/**
 * Czy na taki pakiet odpowiadamy — i czym.
 *
 * Wydzielone z gniazda, żeby dało się to przetestować bez sieci: reguły
 * (napis, rozmiar, adres nadawcy) są tym, co tu naprawdę warto sprawdzić.
 */
export function odpowiedzNa(pakiet: Buffer, odNadawcy: string): string | null {
  if (!zLokalnejSieci(odNadawcy)) return null;
  if (pakiet.length < MIN_PYTANIE) return null;
  if (!pakiet.subarray(0, PYTANIE.length).toString("latin1").startsWith(PYTANIE)) return null;

  const tresc = odpowiedz();
  // Ostatnia furtka wzmocnienia: gdyby odpowiedź kiedyś urosła ponad pytanie,
  // milczymy zamiast wysyłać więcej, niż dostaliśmy.
  if (!tresc || Buffer.byteLength(tresc) > pakiet.length) return null;
  return tresc;
}

export interface Nasluch {
  readonly port: number;
  zamknij(): Promise<void>;
}

/**
 * Uruchomienie nasłuchu. `null`, gdy wyłączony przez `DISCOVERY_PORT=0`.
 *
 * Błąd gniazda NIE przewraca serwera: odkrywanie jest wygodą przy pierwszym
 * uruchomieniu kolektora, a nie warunkiem pracy magazynu. Zajęty port UDP ma
 * skończyć się linijką w logu, nie usługą, która nie wstaje.
 */
export function uruchomOdkrywanie(port = config.discoveryPort): Promise<Nasluch | null> {
  if (!port) return Promise.resolve(null);

  return new Promise((resolve) => {
    const gniazdo = dgram.createSocket({ type: "udp4", reuseAddr: true });

    gniazdo.on("message", (pakiet, skad) => {
      const tresc = odpowiedzNa(pakiet, skad.address);
      if (!tresc) return;
      gniazdo.send(tresc, skad.port, skad.address, (e) => {
        if (e) console.warn("[odkrywanie] odpowiedź nieudana:", e.message);
      });
    });

    gniazdo.on("error", (e) => {
      console.warn(`[odkrywanie] nasłuch UDP wyłączony: ${e.message}`);
      gniazdo.close();
      resolve(null);
    });

    gniazdo.bind(port, () => {
      const faktyczny = gniazdo.address().port;
      console.log(`[odkrywanie] nasłuch UDP na porcie ${faktyczny}`);
      resolve({
        port: faktyczny,
        zamknij: () => new Promise<void>((z) => gniazdo.close(() => z())),
      });
    });
  });
}
