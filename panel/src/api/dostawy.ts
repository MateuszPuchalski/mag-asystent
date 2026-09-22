import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";

/* ── Dostawy w panelu (0.435.0) ────────────────────────────────────────────
   Pierwszy ekran magazynu przeniesiony z `biuro.html` (`docs/obsluga-klienta.md`
   §7). Trasy są TE SAME, którymi biuro jeździło od lat — przeprowadzka zmienia
   front, nie umowę z serwerem. Dzięki temu serwer nie ma okresu, w którym
   dwie wersje ekranu pytają go o dwie różne rzeczy.

   Typy stoją TUTAJ, a nie w `typy.ts`, z tego samego powodu, dla którego
   serwer trzyma `PodgladDokumentu` poza `types.ts`: to kształty tylko dla
   biura, a nie kontrakt z kolektorem. */

/** Wiersz listy dostaw — `DeliveryDocument` z serwera. */
export interface DokumentDostawy {
  dokId: number;
  typ: string;
  nrPelny: string;
  dataWyst: string;
  dostawca: string;
  khId: number | null;
  wyjatkiOtwarte: number;
  maLogo: boolean;
  positions: number;
  wBuforze: boolean;
  wPrzyjeciach: boolean;
  linesTotal: number;
  linesDone: number;
  /** `null` = nikt nie otwierał, `open` = w toku, `done`, `external` = poza WERTIS. */
  status: string | null;
}

/** Wyjątek zgłoszony przez halę — `ProblemView` z serwera. */
export interface Wyjatek {
  id: number;
  deliveryId: number | null;
  lineId: number | null;
  typ: string;
  typLabel: string;
  qty: number | null;
  symObcy: string | null;
  zamiastIlosc: number | null;
  qtyDok: number | null;
  opis: string | null;
  hasPhoto: boolean;
  createdAt: string;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  resolvedBy: string | null;
  docNumber: string | null;
  /** Numer dokumentu w Subiekcie — adres dokumentu w panelu. `null` = towar spoza dostawy. */
  dokId: number | null;
  sym: string | null;
  name: string | null;
  unit: string;
}

export interface NotatkaDoHali {
  id: number;
  dokId: number;
  tresc: string;
  createdAt: string;
  createdBy: string;
  /** `null` = hala jeszcze nie odpowiedziała — i to trzyma dostawę otwartą. */
  odpowiedz: string | null;
  odpAt: string | null;
  odpBy: string | null;
  /** `null` = biuro jeszcze nie widziało odpowiedzi. */
  odpWidzianaAt: string | null;
}

export interface OdpowiedzHali extends NotatkaDoHali { nrPelny: string | null }

export interface PozycjaDostawy {
  lineId: number | null;
  twId: number;
  sym: string;
  name: string;
  qtyDoc: number;
  qtyDone: number;
  locExpected: string | null;
  locActual: string | null;
  status: string;
  mismatch: boolean;
  bezLokalizacji: boolean;
  doneBy: string | null;
  doneAt: string | null;
  problemy: Wyjatek[];
}

/** Podgląd dokumentu — `PodgladDokumentu` z serwera. */
export interface Dokument {
  dokId: number;
  deliveryId: number | null;
  nrPelny: string;
  typ: string;
  dostawca: string;
  khId: number | null;
  maLogo: boolean;
  dataWyst: string;
  wBuforze: boolean;
  wPrzyjeciach: boolean;
  status: string | null;
  zamkniecie: { kto: string; at: string; powod: string } | null;
  dostawcaStat: { dostawWRoku: number; udzialWyjatkow: number | null; medianaDni: number | null } | null;
  notatki: NotatkaDoHali[];
  archiwalny: boolean;
  zrodlo: "snapshot" | "podglad";
  progress: { total: number; done: number; remaining: number; problems: number };
  lines: PozycjaDostawy[];
  problemyBezLinii: Wyjatek[];
}

export interface ZamknietaPoza {
  dokId: number;
  nrPelny: string;
  dostawca: string;
  dataWyst: string;
  zamknietaAt: string;
  zamknietaBy: string;
  powod: string;
  linie: number;
}

export const kluczeDostaw = {
  /* Przedrostek wszystkiego, co pokazuje ekran dostaw — zapis odświeża całość,
     bo wyjątek zamknięty w dokumencie zmienia i listę, i sygnały na niej. */
  wszystko: ["dostawy"] as const,
  lista: ["dostawy", "lista"] as const,
  wyjatki: ["dostawy", "wyjatki"] as const,
  poza: ["dostawy", "poza"] as const,
  odpowiedzi: ["dostawy", "odpowiedzi"] as const,
  archiwum: (q: string) => ["dostawy", "archiwum", q] as const,
  dokument: (dokId: number) => ["dostawy", "dokument", dokId] as const,
};

/* Rytm odświeżania — pół minuty, jak w `biuro.html`. Hala rozkłada na żywo,
   a biuro patrzy na postęp tej samej faktury; dłuższy rytm kazałby klikać
   „odśwież", czyli pamiętać, że trzeba. */
const RYTM = 30_000;

export function useDostawy() {
  return useQuery({
    queryKey: kluczeDostaw.lista,
    queryFn: () => api<{ documents: DokumentDostawy[]; dniWstecz: number }>("/api/delivery/documents"),
    refetchInterval: RYTM,
  });
}

export function useWyjatkiOtwarte() {
  return useQuery({
    queryKey: kluczeDostaw.wyjatki,
    queryFn: () => api<{ problems: Wyjatek[] }>("/api/problems/unresolved"),
    refetchInterval: RYTM,
  });
}

export function usePozaWertis() {
  return useQuery({
    queryKey: kluczeDostaw.poza,
    queryFn: () => api<{ documents: ZamknietaPoza[] }>("/api/biuro/zamkniete-poza"),
  });
}

export function useOdpowiedziHali() {
  return useQuery({
    queryKey: kluczeDostaw.odpowiedzi,
    queryFn: () => api<{ odpowiedzi: OdpowiedzHali[] }>("/api/biuro/notatki/odpowiedzi"),
    refetchInterval: RYTM,
  });
}

/**
 * Archiwum — pobierane WYŁĄCZNIE przy wybranym czipie.
 *
 * Zmienia się raz na dobę, gdy okno importu przesunie się o dzień, więc
 * ciągnięcie go w tle byłoby dwustoma wierszami na cykl za odpowiedź, na którą
 * nikt nie patrzy. Szuka SERWER — powód przy trasie.
 */
export function useArchiwumDostaw(q: string, wlaczone: boolean) {
  return useQuery({
    queryKey: kluczeDostaw.archiwum(q),
    queryFn: () => api<{ documents: DokumentDostawy[]; ile: number; limit: number }>(
      `/api/biuro/dostawy/archiwum?q=${encodeURIComponent(q)}`),
    enabled: wlaczone,
  });
}

/**
 * Podgląd dokumentu — CZYTA, nigdy nie otwiera dostawy.
 *
 * Wejście w dokument nie zabiera nikomu blokad i niczego nie zaczyna: to
 * zrobiłoby z patrzenia zmianę stanu magazynu. Trasa jest pod `/api/biuro`,
 * a nie obok `.../open`, właśnie po to, żeby nie dało się ich pomylić.
 */
export function useDokument(dokId: number | null) {
  return useQuery({
    queryKey: kluczeDostaw.dokument(dokId ?? 0),
    queryFn: () => api<Dokument>(`/api/biuro/dokument/${dokId}`),
    enabled: dokId !== null,
    refetchInterval: RYTM,
  });
}

function useOdswiezDostawy() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: kluczeDostaw.wszystko });
}

/** Notatka do hali. Treść waliduje serwer — ekran tylko pyta. */
export function useNotatkaDoHali() {
  const odswiez = useOdswiezDostawy();
  return useMutation({
    mutationFn: (v: { dokId: number; tresc: string }) =>
      api(`/api/biuro/dokument/${v.dokId}/notatka`, {
        method: "POST", body: JSON.stringify({ tresc: v.tresc }),
      }),
    onSuccess: odswiez,
  });
}

/** Potwierdzenie odczytu odpowiedzi. Powtórka z drugiego biurka jest nieszkodliwa. */
export function usePrzeczytane() {
  const odswiez = useOdswiezDostawy();
  return useMutation({
    mutationFn: (id: number) => api(`/api/biuro/notatki/${id}/przeczytane`, { method: "POST" }),
    onSuccess: odswiez,
  });
}

/**
 * Zamknięcie wyjątku przez biuro. Notatka trafia do `resolvedNote`, czyli
 * tam, skąd czyta ją protokół dla dostawcy.
 */
export function useRozwiazWyjatek() {
  const odswiez = useOdswiezDostawy();
  return useMutation({
    mutationFn: (v: { id: number; note: string }) =>
      api(`/api/problems/${v.id}/resolve`, { method: "POST", body: JSON.stringify({ note: v.note }) }),
    onSuccess: odswiez,
  });
}

/** Zdjęcie dostawy z listy pracy — rozłożona poza WERTIS. Powód jest obowiązkowy. */
export function useZamknijPozaWertis() {
  const odswiez = useOdswiezDostawy();
  return useMutation({
    mutationFn: (v: { dokId: number; powod: string }) =>
      api(`/api/biuro/dokument/${v.dokId}/zamknij`, {
        method: "POST", body: JSON.stringify({ powod: v.powod }),
      }),
    onSuccess: odswiez,
  });
}

/** Cofnięcie — dostawa wraca na listę pracy. */
export function usePrzywrocDostawe() {
  const odswiez = useOdswiezDostawy();
  return useMutation({
    mutationFn: (dokId: number) => api(`/api/biuro/dokument/${dokId}/otworz`, { method: "POST" }),
    onSuccess: odswiez,
  });
}

/** Wyjątki jednej dostawy — źródło protokołu dla dostawcy (także zamknięte). */
export const wyjatkiDostawy = (deliveryId: number) =>
  api<{ problems: Wyjatek[] }>(`/api/delivery/${deliveryId}/problems`);

/** Ilość bez sztucznych zer: 6 zamiast „6.00", ale 2.5 zostaje 2.5. */
export const ilosc = (n: number | null | undefined) =>
  n == null ? "—" : String(Math.round(Number(n) * 1000) / 1000);
