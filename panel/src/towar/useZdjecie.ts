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
   a rozmiar dobiera `services/zdjecia-ofert.ts`.

   ── TRZECIE ŹRÓDŁO: ZAŁĄCZNIKI KLIENTA (0.219.1) ──────────────────────────
   0.218.0 wystawiło zdjęcie z wiadomości wprost przez `<img src>` — czyli
   dokładnie tak, jak punkt 1 wyżej ZABRANIA od 0.152.0. Na ekranie właściciela
   wyszła ikona zepsutego obrazu, bo trasa oddała 401. Blizna kupiona trzeci
   raz w tym samym froncie; dlatego załączniki dochodzą TUTAJ, a nie dostają
   własnego pobierania obok.                                                  */

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

/* ── Porażka Z POWODEM, osobno od pamięci negatywu (przyrost „zdjęcia w rozmowach") ──
   Do tego wydania KAŻDY kod poza 2xx — także 401 po wygaśnięciu sesji, 502
   „Allegro odmówiło" i urwana sieć — lądował w `pamiec` jako `null`, czyli
   „na pewno brak", do końca życia karty. Jedna chwilowa porażka gasiła
   zdjęcie na resztę dnia, a odświeżenie strony „naprawiało" i zacierało ślad.

   `null` w `pamiec` zostaje dla ODPOWIEDZI: 404 (zdjęcia nie ma) i 415 (plik
   nie jest obrazem). Reszta trafia tutaj, ze zdaniem z serwera i z czasem —
   po minucie ponowne zamontowanie pyta znowu, a `ponow()` od razu.        */
const BLAD_TTL_MS = 60_000;
const bledy = new Map<string, { zdanie: string; at: number }>();

const bladSwiezy = (sciezka: string): string | null => {
  const b = bledy.get(sciezka);
  if (!b) return null;
  if (Date.now() - b.at > BLAD_TTL_MS) { bledy.delete(sciezka); return null; }
  return b.zdanie;
};

/** Kody, które są ODPOWIEDZIĄ o obrazie, nie awarią drogi do niego. */
const KODY_BRAKU = new Set([404, 415]);

async function pobierz(sciezka: string): Promise<string | null> {
  let odp: Response;
  try {
    odp = await fetch(sciezka, { headers: { "x-session": token() } });
  } catch {
    throw new Error("Serwer nie odpowiada — sprawdź połączenie z siecią firmy.");
  }
  if (odp.ok) return URL.createObjectURL(await odp.blob());
  /* 404 znaczy „potwierdzony brak" i jest ODPOWIEDZIĄ, nie awarią — serwer
     nie zapisuje go nawet w audycie; 415 to „plik nie jest obrazem". */
  if (KODY_BRAKU.has(odp.status)) return null;
  if (odp.status === 401) throw new Error("Sesja wygasła — zaloguj się ponownie.");
  /* Zdanie z serwera, gdy je dał (502 „Allegro nie oddało…", 503 „Konto
     niepołączone…"); goły kod dopiero, gdy nie dał nic. */
  let zdanie = "";
  try { zdanie = String(((await odp.json()) as { error?: unknown })?.error ?? ""); } catch { /* nie JSON */ }
  throw new Error(zdanie || `Serwer odpowiedział kodem ${odp.status}.`);
}

function zamow(sciezka: string): Promise<string | null> {
  const juz = wToku.get(sciezka);
  if (juz) return juz;
  const p = new Promise<string | null>((resolve) => {
    kolejka.push(async () => {
      let wynik: string | null = null;
      try {
        wynik = await pobierz(sciezka);
        pamiec.set(sciezka, wynik);
        bledy.delete(sciezka);
      } catch (e) {
        /* Porażka NIE idzie do `pamiec` — tam leżą wyłącznie odpowiedzi. */
        bledy.set(sciezka, { zdanie: e instanceof Error ? e.message : String(e), at: Date.now() });
      }
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
    /* Świeża porażka NIE pyta drugi raz — dopiero po minucie albo po `ponow()`. */
    if (!pamiec.has(sciezka) && bladSwiezy(sciezka) === null) void zamow(sciezka);
    return () => {
      zbior.delete(f);
      if (!zbior.size) nasluchy.delete(sciezka);
    };
  }, [sciezka]);

  if (sciezka == null) return null;
  if (pamiec.has(sciezka)) return pamiec.get(sciezka);
  /* Porażka wygląda dla odbiorców jak brak (`null`) — kafel kartoteki,
     oferty i reklamacji zachowują się jak dotąd. Kto chce zdania i ponowienia,
     bierze `useZdjecieZalacznika`. */
  return bladSwiezy(sciezka) !== null ? null : undefined;
}

/** Zdanie ostatniej porażki dla ścieżki albo `null`; `ponow` kasuje ją i pyta od razu. */
function useBladObrazu(sciezka: string | null): { blad: string | null; ponow: () => void } {
  const [, odswiez] = useState(0);
  return {
    blad: sciezka == null ? null : bladSwiezy(sciezka),
    ponow: () => {
      if (sciezka == null) return;
      bledy.delete(sciezka);
      odswiez((n) => n + 1);
      void zamow(sciezka);
    },
  };
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

/**
 * Podgląd załącznika wiadomości (0.219.1).
 *
 * Trasa `/api/obsluga/zalaczniki/:id/podglad` stoi za sesją jak dwie poprzednie,
 * więc `<img src>` na nią dostaje 401 i rysuje ikonę zepsutego obrazu. Wspólna
 * kolejka jest tu warta więcej niż przy kartotekach: jedna wiadomość niesie
 * czasem kilka zdjęć z telefonu, a te bywają wielomegabajtowe.
 *
 * `null` (nieudane pobranie) NIE jest awarią ekranu — pod obrazem stoi nazwa
 * pliku i odnośnik pobrania, więc agent dalej wie, że klient coś przysłał.
 */
export function useZdjecieZalacznika(id: number | null | undefined): {
  url: string | null | undefined; blad: string | null; ponow: () => void;
} {
  const sciezka = id == null ? null : `/api/obsluga/zalaczniki/${id}/podglad`;
  const url = useObraz(sciezka);
  /* Zdanie i ponowienie WYŁĄCZNIE tutaj: w skrzynce brak zdjęcia to sama
     nazwa pliku bez powodu, a właściciel patrzył na to od 0.219.2. Kartoteka
     i oferta zostają przy `null` — tam brak obrazu jest stanem codziennym. */
  const { blad, ponow } = useBladObrazu(sciezka);
  return { url, blad, ponow };
}

/**
 * CZWARTE ŹRÓDŁO: załączniki reklamacji (0.223.0).
 *
 * Ta sama mechanika, co przy trzech poprzednich — sesja w nagłówku, pamięć
 * negatywu, trzy pobrania naraz — więc wchodzi do WSPÓLNEJ kolejki, a nie
 * obok niej. Osobne pobieranie rozjechałoby się z tym przy pierwszej
 * poprawce; nagłówek tego pliku opisuje, ile razy już to kosztowało.
 *
 * `null` znaczy tu coś WIĘCEJ niż „brak zdjęcia": trasa oddaje 415, gdy plik
 * obrazem nie jest, choć jego nazwa to obiecywała. Panel spada wtedy na
 * przycisk pobrania, a pamięć negatywu pilnuje, żeby nie pytał drugi raz.
 */
export function useObrazZalacznikaReklamacji(
  reklamacjaId: number, zalacznikId: number,
): string | null | undefined {
  return useObraz(`/api/obsluga/reklamacje/${reklamacjaId}/zalaczniki/${zalacznikId}/podglad`);
}

/** Tylko do testów — mapa i kolejka są modułowe, więc żyją między nimi. */
export function _wyczyscPamiecZdjec() {
  pamiec.clear();
  bledy.clear();
  wToku.clear();
  kolejka.length = 0;
  biegnie = 0;
  nasluchy.clear();
}
