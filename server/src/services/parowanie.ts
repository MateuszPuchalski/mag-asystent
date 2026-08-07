import os from "node:os";
import { config } from "../config.js";

/* ── Parowanie kolektora z serwerem ─────────────────────────────────────────
   Adres serwera był jedynym ustawieniem, które magazynier musiał WPISAĆ —
   na urządzeniu bez klawiatury, w rękawicach, z pamięci. Fabryczna wartość
   (`10.0.2.2`, alias hosta w emulatorze) nie wskazuje na kolektorze na nic,
   więc świeży sprzęt zawsze startował od tego kroku.

   Ten plik dostarcza jedną rzecz: ADRES, POD KTÓRYM TEN SERWER JEST WIDOCZNY
   Z HALI. Reszta — kod QR (`qr.ts`), odpowiadanie na rozgłoszenia
   (`odkrywanie.ts`), strona parowania (`routes/parowanie.ts`) — tylko go
   roznosi.                                                                   */

/**
 * Schemat kodu parowania.
 *
 * ŚWIADOMIE NIE `http://`. Kolektor klasyfikuje każdy skan (`core/scan`), więc
 * kod parowania musi być rozpoznawalny bez zgadywania — a `http://…` bywa
 * naklejone na sprzęcie, w instrukcji i na plakacie dostawcy. Własny schemat
 * znaczy: „to jest adres serwera WERTIS i nic innego".
 */
export const SCHEMAT_PAROWANIA = "wertis://";

const PRYWATNE = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** Czy adres należy do puli prywatnej (RFC 1918). */
const prywatny = (ip: string): boolean => PRYWATNE.some((re) => re.test(ip));

/**
 * Adresy IPv4 tej maszyny widoczne z sieci.
 *
 * Prywatne idą PIERWSZE i to jest istotne, a nie kosmetyczne: maszyna
 * z Subiektem bywa podpięta także do sieci operatora albo ma wirtualną kartę
 * Hyper-V/VirtualBox. Kolektor stoi w LAN magazynu, więc adres z puli
 * prywatnej jest tym, pod którym ma szansę cokolwiek zobaczyć.
 *
 * Adresy pętli zwrotnej odpadają: `127.0.0.1` w kodzie QR to kod, który działa
 * wyłącznie na maszynie, która go wyświetla.
 */
export function adresyLan(): string[] {
  const wszystkie: string[] = [];
  for (const karty of Object.values(os.networkInterfaces())) {
    for (const k of karty ?? []) {
      if (k.family !== "IPv4" || k.internal) continue;
      wszystkie.push(k.address);
    }
  }
  return [...wszystkie.filter(prywatny), ...wszystkie.filter((a) => !prywatny(a))];
}

/**
 * Adres, pod którym serwer ogłasza się kolektorom.
 *
 * `HOST` z `wertis.env` ma pierwszeństwo, bo administrator, który go ustawił,
 * wie o sieci więcej niż ta funkcja — a przy dwóch kartach sieciowych zgadnie
 * lepiej. Wieloznaczne wartości (`0.0.0.0`, `::`) są nasłuchem na wszystkim,
 * czyli NIE SĄ adresem: pod `0.0.0.0` nikt się nie połączy.
 */
export function hostOgloszeniowy(): string | null {
  const h = config.host;
  if (h && h !== "0.0.0.0" && h !== "::" && h !== "localhost" && h !== "127.0.0.1") return h;
  return adresyLan()[0] ?? null;
}

/** `http://<ip>:<port>` — to samo, co kolektor wpisuje dziś ręcznie. */
export function adresBazowy(): string | null {
  const h = hostOgloszeniowy();
  return h ? `http://${h}:${config.port}` : null;
}

/** Treść kodu QR: `wertis://<ip>:<port>`. */
export function kodParowania(): string | null {
  const h = hostOgloszeniowy();
  return h ? `${SCHEMAT_PAROWANIA}${h}:${config.port}` : null;
}

/**
 * Kod parowania → adres HTTP; `null`, gdy to nie jest kod parowania.
 *
 * LUSTRO `Parowanie.kt` PO STRONIE KOLEKTORA. Obie implementacje muszą
 * przyjmować dokładnie to samo — dlatego reguła jest tu wypisana wprost,
 * a nie „cokolwiek zwróci parser URL-i": parsery różnią się między
 * platformami akurat na wejściu, które chcemy odrzucić.
 */
export function parsujKodParowania(kod: string): string | null {
  const t = kod.trim();
  if (!t.toLowerCase().startsWith(SCHEMAT_PAROWANIA)) return null;
  const reszta = t.slice(SCHEMAT_PAROWANIA.length);

  // host[:port] — bez ścieżki, bez znaku zapytania, bez danych logowania
  const m = /^([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(reszta);
  if (!m) return null;

  const host = m[1];
  const port = m[2] ? Number(m[2]) : 3001;
  if (port < 1 || port > 65535) return null;
  if (host.length > 253 || host.endsWith(".")) return null;

  return `http://${host}:${port}`;
}
