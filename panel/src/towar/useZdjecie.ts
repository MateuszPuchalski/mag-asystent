import { useEffect, useState } from "react";
import { token } from "../api/klient";

/* ── Zdjęcia kartotek w panelu obsługi (0.152.0) ─────────────────────────────
   Pierwszy obraz w tym froncie. Panel magazynu (`biuro.html`) pokazuje je od
   dawna i zapłacił po drodze za trzy rzeczy, których nie ma sensu kupować
   drugi raz — więc ten moduł przenosi je razem z uzasadnieniami.

   1. TRASA STOI ZA SESJĄ. `/api/products/:twId/zdjecie` żąda nagłówka
      `x-session`, więc `<img src>` wprost dostanie 401. Obraz trzeba pobrać
      `fetch`em i podać jako `blob:`.
   2. PAMIĘĆ NEGATYWU. Mapa trzyma też `null` — „ten towar NA PEWNO nie ma
      zdjęcia". Bez tego lista pytałaby serwer o brak przy każdym przerysowaniu,
      a większość kartotek zdjęcia nie ma.
   3. NAJWYŻEJ TRZY POBRANIA NARAZ. Przy pierwszym trafieniu serwer ciągnie
      plik z bazy firmy; czterdzieści równoległych żądań zagłodziłoby
      kolektory stojące przy regale. Ta liczba jest w `biuro.html` od
      0.60.0 i ma tam ten sam komentarz.

   Miniatur KARTOTEK nie ma i nie będzie: serwer nie skaluje obrazów (zero
   modułów natywnych). Kafel dostaje pełny obraz i `object-fit: cover`.

   ── DRUGIE ŹRÓDŁO OBRAZÓW (0.213.0) ───────────────────────────────────────
   Doszły zdjęcia listingowe ofert Allegro. Mechanika jest CO DO JOTY ta sama —
   sesja w nagłówku, pamięć negatywu, trzy pobrania naraz — więc kolejka i mapa
   są wspólne, a klucz zmienił się z `twId` na ŚCIEŻKĘ trasy. Druga kopia tych
   trzech rzeczy rozjechałaby się z pierwszą przy pierwszej poprawce, a objawem
   rozjazdu byłaby lista dobijająca serwer o obrazy, których nie ma.

   Miniatury ofert ISTNIEJĄ i robi je CDN Allegro — zmniejsza serwer, ale nie
   nasz. Panel o tym nie wie i wiedzieć nie musi: dostaje adres własnej trasy,
   a rozmiar dobiera `services/zdjecia-ofert.ts`.                             */

const ROWNOLEGLE = 3;

/** `undefined` = jeszcze nie wiemy, `null` = na pewno brak, string = blob.
    Klucz to ŚCIEŻKA trasy — patrz nagłówek. */
const pamiec = new Map<string, string | null>();
const wToku = new Map<string, Promise<string | null>>();
const kolejka: Array<() => Promise<void>> = [];
let biegnie = 0;

/* Nasłuchy komponentów: jeden obraz bywa w wierszu kolejki i w kolumnie
   dowodów naraz, a oba mają się odświeżyć po jednym pobraniu. */
const nasluchy = new Map<string, Set<() => void>>();

function ogloś(klucz: string) {
  for (const f of nasluchy.get(klucz) ?? []) f();
}

function pchnij() {
  while (biegnie < ROWNOLEGLE && kolejka.length) {
    const zadanie = kolejka.shift()!;
    biegnie++;
    void zadanie().finally(() => { biegnie--; pchnij(); });
  }
}

async function pobierz(sciezka: string): Promise<string | null> {
  const odp = await fetch(sciezka, {
    headers: { "x-session": token() },
  });
  /* 404 znaczy „potwierdzony brak" i jest ODPOWIEDZIĄ, nie awarią — serwer
     nie zapisuje go nawet w audycie. Każdy inny kod też kończy się `null`:
     ekran zwrotu nie ma prawa zatrzymać się na zdjęciu. */
  if (!odp.ok) return null;
  return URL.createObjectURL(await odp.blob());
}

function zamow(sciezka: string): Promise<string | null> {
  const juz = wToku.get(sciezka);
  if (juz) return juz;
  const p = new Promise<string | null>((resolve) => {
    kolejka.push(async () => {
      let wynik: string | null = null;
      try { wynik = await pobierz(sciezka); } catch { wynik = null; }
      pamiec.set(sciezka, wynik);
      wToku.delete(sciezka);
      ogloś(sciezka);
      resolve(wynik);
    });
    pchnij();
  });
  wToku.set(sciezka, p);
  return p;
}

/**
 * Adres `blob:` zdjęcia kartoteki albo `null`, gdy zdjęcia nie ma.
 *
 * `undefined` znaczy „jeszcze nie wiadomo" i tylko wtedy wolno pokazać stan
 * ładowania — inaczej kafel migałby przy każdym przerysowaniu listy.
 *
 * Adresów `blob:` nie zwalniamy: żyją do przeładowania panelu, dokładnie jak
 * w `biuro.html`. Zwolnienie przy odmontowaniu komponentu unieważniłoby je
 * drugiemu miejscu, które pokazuje ten sam towar.
 */
function useObraz(sciezka: string | null): string | null | undefined {
  const [, odswiez] = useState(0);

  useEffect(() => {
    if (sciezka == null) return;
    const f = () => odswiez((n) => n + 1);
    const zbior = nasluchy.get(sciezka) ?? new Set<() => void>();
    zbior.add(f);
    nasluchy.set(sciezka, zbior);
    if (!pamiec.has(sciezka)) void zamow(sciezka);
    return () => {
      zbior.delete(f);
      if (!zbior.size) nasluchy.delete(sciezka);
    };
  }, [sciezka]);

  if (sciezka == null) return null;
  return pamiec.get(sciezka);
}

export function useZdjecie(twId: number | null | undefined): string | null | undefined {
  return useObraz(twId == null ? null : `/api/products/${twId}/zdjecie`);
}

/**
 * Zdjęcie listingowe oferty Allegro (0.213.0).
 *
 * Adres jest NASZ, nie `a.allegroimg.com` — zakaz wyprowadzania przeglądarki
 * biura poza własną sieć obowiązuje dalej, a plik ciągnie serwer. Panel nie
 * zna adresu w CDN-ie i nie ma go po co znać.
 *
 * Numer oferty koduje `encodeURIComponent`: to jest ciąg z zewnątrz, wstawiany
 * w ścieżkę.
 */
export function useZdjecieOferty(externalId: string | null | undefined): string | null | undefined {
  const id = (externalId ?? "").trim();
  return useObraz(id === "" ? null : `/api/obsluga/oferta/${encodeURIComponent(id)}/zdjecie`);
}

/** Tylko do testów — mapa i kolejka są modułowe, więc żyją między nimi. */
export function _wyczyscPamiecZdjec() {
  pamiec.clear();
  wToku.clear();
  kolejka.length = 0;
  biegnie = 0;
  nasluchy.clear();
}
