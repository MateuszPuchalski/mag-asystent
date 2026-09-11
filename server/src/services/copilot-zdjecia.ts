import type { DatabaseSync } from "node:sqlite";
import { pobierzZalacznik } from "../adapters/allegro.http.js";
import { rozpoznajMime } from "../adapters/zdjecia.sgt.js";
import { typPodgladu } from "./skrzynka.js";

/* ── Zdjęcia sprawy dla Copilota (0.283.0) ───────────────────────────────────
   Zlecenie właściciela brzmiało wprost: „copilot powinien czytać zdjęcia".
   Karta, którą wkleił, prosiła agenta o zdjęcia, które w sprawie JUŻ BYŁY —
   sama się do nich odwoływała, cytując wiadomość sprzedawcy.

   ── CZEGO TEN MODUŁ NIE OBIECUJE, i to jest najważniejsze zdanie w pliku ──
   `TrescBezpieczna` obiecuje, że łańcuch przeszedł przez `zamaskuj()`.
   PIKSELI ZAMASKOWAĆ SIĘ NIE DA. Zdjęcie bywa paragonem z imieniem i adresem,
   ekranem telefonu z numerem, etykietą przesyłki. To wszystko wychodzi do
   dostawcy modelu w całości i nie ma tu żadnej bramki, która by temu
   zaradziła. Marka `ZdjecieZBramki` nie mówi więc „bezpieczne" — mówi
   dokładnie trzy rzeczy, i tylko je:

     1. bajty przyszły z załącznika TEJ sprawy, nie z dowolnego adresu,
     2. są obrazem w typie, który dostawca przyjmuje — rozstrzygnięte po
        SYGNATURZE, nie po rozszerzeniu w nazwie,
     3. mieszczą się w suficie bajtów.

   Cena jest jawna i zapisana w polityce danych (`docs/obsluga-klienta.md`).
   Marka obiecująca więcej byłaby kłamstwem wbudowanym w typ, a takich w tym
   repo nie stawiamy.

   ── SUFITU SZTUK NIE MA I TO JEST DECYZJA WŁAŚCICIELA ──
   Pytany wprost, wybrał „wszystkie zdjęcia sprawy", znając koszt. Zostaje
   sufit BAJTÓW, bez którego żądanie po prostu nie przejdzie, i zdanie na
   karcie mówiące, ile zdjęć pominięto. Cicha utrata zdjęcia byłaby gorsza
   od braku funkcji.                                                         */

/** Typy, które przyjmuje i nasza bramka podglądu, i dostawca modelu. */
export const TYPY_MODELU = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type TypModelu = (typeof TYPY_MODELU)[number];

/**
 * Sufity bajtów.
 *
 * `NA_SZTUKE` to próg NASZ, dobrany z zapasem pod limit dostawcy na pojedynczy
 * obraz — base64 rozdyma bajty o jedną trzecią, więc 3,5 MB surowych to około
 * 4,7 MB w żądaniu. Dokładny limit dostawcy potwierdzić w jego dokumentacji
 * `vision`, nie w pamięci.
 *
 * `LACZNIE` chroni całe żądanie. Przy sprawie z kilkudziesięcioma zdjęciami
 * idą najnowsze, a karta mówi, ile zostało poza.
 */
export const SUFIT_ZDJEC = { naSztuke: 3_500_000, lacznie: 20_000_000 } as const;

export interface ZdjecieZBramki {
  readonly numer: string;
  readonly typ: TypModelu;
  readonly base64: string;
  readonly zalacznikId: number;
  readonly nazwa: string;
  readonly bajtow: number;
}

export interface WynikZdjec {
  zdjecia: ZdjecieZBramki[];
  /** Załączniki, które nie są obrazem w przyjmowanym typie — z nazwami. */
  nieObrazy: string[];
  /** Ile obrazów nie zmieściło się w suficie bajtów. */
  pominieto: number;
  /** Ile pobrań padło. Rozpoznanie leci dalej — zdjęcie to dodatek. */
  bledow: number;
}

export type Pobieracz = (
  url: string, opcje?: { maksBajtow?: number },
) => Promise<ArrayBuffer>;

interface Kandydat {
  id: number;
  nazwa: string;
  url: string;
  /** Numer wiadomości, przy której wisi załącznik; `null` przy sprawie. */
  przyWiadomosci: string | null;
}

/**
 * Załączniki sprawy i rozmowy, od NAJNOWSZYCH.
 *
 * Kolejność ma znaczenie tylko przy suficie: gdy komplet się nie mieści,
 * zostają te, które klient przysłał ostatnio — a to one zwykle odpowiadają
 * na ostatnie pytanie biura.
 */
export function kandydaci(database: DatabaseSync, reklamacjaId: number): Kandydat[] {
  return (database.prepare(`SELECT z.id, z.nazwa, z.url, w.external_id AS wiadomosc
    FROM reklamacja_zalacznik z
    LEFT JOIN reklamacja_wiadomosc w ON w.id = z.wiadomosc_id
   WHERE z.reklamacja_id = ?
   ORDER BY w.utworzono_at IS NULL DESC, w.utworzono_at DESC, z.id DESC`)
    .all(reklamacjaId) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: Number(r.id),
      nazwa: String(r.nazwa ?? ""),
      url: String(r.url ?? ""),
      przyWiadomosci: r.wiadomosc == null ? null : String(r.wiadomosc),
    }))
    .filter((k) => k.url !== "");
}

/**
 * Pobierz i przepuść przez bramkę.
 *
 * ŻADNE POTKNIĘCIE NIE WYWRACA ROZPOZNANIA. Plik spoza typu jest pomijany
 * i wymieniany z nazwy; pobranie, które padło, jest liczone. Karta bez zdjęć
 * jest gorsza od karty bez rozpoznania tylko o tyle, o ile mniej wie — a brak
 * karty nie mówi agentowi nic.
 *
 * Numery nadajemy PO bramce i chronologicznie od najstarszego, żeby `Z1` na
 * ekranie znaczyło to samo co `Z1` w karcie.
 */
export async function przygotujZdjecia(
  database: DatabaseSync, reklamacjaId: number, pobierz: Pobieracz = pobierzZalacznik,
): Promise<WynikZdjec> {
  const lista = kandydaci(database, reklamacjaId);
  const wynik: WynikZdjec = { zdjecia: [], nieObrazy: [], pominieto: 0, bledow: 0 };
  let bajtow = 0;

  const zebrane: Array<Omit<ZdjecieZBramki, "numer">> = [];
  for (const k of lista) {
    let dane: ArrayBuffer;
    try {
      dane = await pobierz(k.url, { maksBajtow: SUFIT_ZDJEC.naSztuke });
    } catch {
      /* Powodu nie zapisujemy przy zdjęciu: idzie do dziennika jako liczba,
         a treść odmowy Allegro bywa z adresem pliku. */
      wynik.bledow += 1;
      continue;
    }
    /* `Buffer`, nie `Uint8Array`: `rozpoznajMime` czyta sygnaturę z bufora,
       a i tak potrzebujemy go do base64. Jedna kopia zamiast dwóch. */
    const bajty = Buffer.from(dane);
    const typ = typPodgladu(rozpoznajMime(bajty));
    if (!typ || !(TYPY_MODELU as readonly string[]).includes(typ)) {
      wynik.nieObrazy.push(k.nazwa);
      continue;
    }
    if (bajtow + bajty.byteLength > SUFIT_ZDJEC.lacznie) {
      wynik.pominieto += 1;
      continue;
    }
    bajtow += bajty.byteLength;
    zebrane.push({
      typ: typ as TypModelu,
      base64: bajty.toString("base64"),
      zalacznikId: k.id,
      nazwa: k.nazwa,
      bajtow: bajty.byteLength,
    });
  }

  wynik.zdjecia = zebrane.reverse().map((z, i) => ({ ...z, numer: `Z${i + 1}` }));
  return wynik;
}

/**
 * Spis zdjęć doklejany do TEKSTU.
 *
 * Bez spisu model widzi obrazy, ale nie wie, który jest którym `Z` — a bez
 * tego cytat w karcie przestaje być sprawdzalny. Wiersz o plikach pominiętych
 * jest równie potrzebny: to on pozwala modelowi napisać w `brakuje`
 * „czytelne zdjęcie zamiast dokumentu".
 */
export function spisZdjec(w: WynikZdjec): string {
  if (!w.zdjecia.length && !w.nieObrazy.length && !w.pominieto) return "";
  const linie = ["ZDJĘCIA (obrazy stoją PRZED tym tekstem, w tej kolejności):"];
  for (const z of w.zdjecia) linie.push(`[${z.numer}] plik: ${z.nazwa}`);
  if (w.nieObrazy.length) {
    linie.push(`Nie pokazano, bo nie są obrazem: ${w.nieObrazy.join(", ")}`);
  }
  if (w.pominieto) linie.push(`Nie pokazano z braku miejsca: ${w.pominieto}`);
  return linie.join("\n");
}
