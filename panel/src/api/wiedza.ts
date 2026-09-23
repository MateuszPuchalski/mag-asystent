import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { klucze } from "./rozmowy";
import type {
  AliasSilnika, Identyfikator, ImportOdsylaczy, ImportWykazu, MapowanieWykazu, PrzegladWykazu, RaportWykazu,
  SprawdzenieOfert, StanPasujeDo, WynikListyOfert, WynikPartiiPasujeDo, KandydatZamiennosci, LukaSilnika, MapowanieOdsylaczy, ModelUrzadzenia, ModelZOpisu, NowaPropozycja, NowePasowanie,
  NowaZabudowa, Pasowanie, PasowaniaTowaru, PowodNegatywny, RaportImportuOdsylaczy, RodzajDowodu,
  RodzajIdentyfikatora, SiecWiedzy, TrescImportu,
  TokenSilnika, Zabudowa, Zamiennosc, Zastosowanie,
} from "./typy";

/* ── Baza wiedzy (§12, etap E2) ──────────────────────────────────────────────
   Hooki w OSOBNYM pliku od `rozmowy.ts`, bo strażnik adresów w testach tras
   czyta pliki z nazwy: `routes/skrzynka.test.ts` czyta `rozmowy.ts`,
   `routes/wiedza.test.ts` czyta ten. Hook w trzecim pliku ominąłby oba
   i kupiłby bliznę 0.181.1 po raz trzeci. */

export const kluczeWiedzy = {
  kolejka: ["wiedza", "kolejka"] as const,
  modele: (q: string) => ["wiedza", "modele", q] as const,
  towar: (twId: number) => ["wiedza", "towar", twId] as const,
  zOpisow: ["wiedza", "z-opisow"] as const,
  identyfikatory: (twId: number) => ["wiedza", "identyfikatory", twId] as const,
  silniki: ["wiedza", "silniki"] as const,
  tokeny: ["wiedza", "tokeny"] as const,
  siec: ["wiedza", "siec"] as const,
  odsylacze: ["wiedza", "odsylacze"] as const,
  wykazy: ["wiedza", "wykazy"] as const,
  pasujeDo: ["wiedza", "pasuje-do"] as const,
};

/**
 * Kolejka propozycji. Zegarem, bo propozycja przychodzi z CUDZEJ rozmowy
 * i cudzego pomiaru — ten ekran nie ma po czym poznać, że coś doszło.
 * Trzydzieści sekund to rytm wzmianek.
 */
export function useKolejkaWiedzy() {
  return useQuery({
    queryKey: kluczeWiedzy.kolejka,
    /* Trzy rodzaje decyzji w jednej kolejce; liczniki OSOBNO (lekcja 0.229.0). */
    queryFn: () => api<{
      propozycje: Zastosowanie[]; liczba: number; pasowania: Pasowanie[]; pasowanDoRozstrzygniecia: number;
      zamiennosciOem: KandydatZamiennosci[]; zamiennosciOemDoRozstrzygniecia: number;
      /** Propozycje z wykazów części pogrupowane do przeglądu listą; brak = starszy serwer. */
      wykazy?: PrzegladWykazu[];
    }>(`/api/obsluga/wiedza/kolejka`),
    refetchInterval: 30_000,
  });
}

export function useModele(q: string) {
  return useQuery({
    queryKey: kluczeWiedzy.modele(q),
    queryFn: () => api<{ modele: ModelUrzadzenia[] }>(`/api/obsluga/wiedza/modele?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
}

export function useWiedzaTowaru(twId: number | null) {
  return useQuery({
    queryKey: kluczeWiedzy.towar(twId ?? 0),
    queryFn: () => api<{
      potwierdzone: Zastosowanie[]; negatywne: Zastosowanie[]; propozycje: Zastosowanie[];
      /** Pasowania część↔część — ta sama trasa, drugi strzał po to samo byłby zbędny. */
      pasowania: PasowaniaTowaru;
      /** Żywe decyzje o zamienności przez wspólny numer oryginału — zatwierdzone i odrzucone. */
      zamiennosciOem: Zamiennosc[];
    }>(`/api/obsluga/wiedza/towar/${twId}`),
    enabled: twId !== null,
  });
}

/* Każda mutacja unieważnia kolejkę, wiedzę o kartotece i KANDYDATÓW każdej
   otwartej rozmowy: zatwierdzone zastosowanie jest od razu szczeblem doboru. */
function poWiedzy(qc: ReturnType<typeof useQueryClient>, twId?: number) {
  qc.invalidateQueries({ queryKey: kluczeWiedzy.kolejka });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.zOpisow });
  qc.invalidateQueries({ queryKey: ["wiedza", "identyfikatory"] });
  qc.invalidateQueries({ queryKey: ["wiedza", "towar"] });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.silniki });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.tokeny });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.siec });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.odsylacze });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.wykazy });
  qc.invalidateQueries({ queryKey: kluczeWiedzy.pasujeDo });
  qc.invalidateQueries({ queryKey: ["kandydaci"] });
  qc.invalidateQueries({ queryKey: ["wiedzaDoboru"] });
  if (twId !== undefined) qc.invalidateQueries({ queryKey: klucze.towar(twId) });
}

export function useZaproponujZastosowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NowaPropozycja) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/propozycje`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => poWiedzy(qc, v.twId),
  });
}

export function useRozstrzygnijZastosowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "zatwierdz" | "odrzuc"; powod?: string | null }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/${v.id}/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajZastosowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; powod?: string | null }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/${v.id}/wycofaj`, {
        method: "POST", body: JSON.stringify({ powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useDodajDowod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; rodzaj: RodzajDowodu; tresc: string; link?: string | null }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/${v.id}/dowody`, {
        method: "POST", body: JSON.stringify({ rodzaj: v.rodzaj, tresc: v.tresc, link: v.link ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

/* ── E3: sekcje „Modele:" z opisów i identyfikatory ─────────────────────────
   Lista z opisów zmienia się tylko po imporcie i po decyzji człowieka, więc
   minuta świeżości wystarczy; licznik na zakładce bierze się z tej samej
   odpowiedzi. */
export function useModeleZOpisow() {
  return useQuery({
    queryKey: kluczeWiedzy.zOpisow,
    queryFn: () => api<{ wiersze: ModelZOpisu[]; liczba: number }>(`/api/obsluga/wiedza/z-opisow`),
    staleTime: 60_000,
  });
}

export function usePrzerobModelZOpisu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; model: NowaPropozycja["model"] }) =>
      api<Zastosowanie>(`/api/obsluga/wiedza/z-opisow/${v.id}/przerob`, {
        method: "POST", body: JSON.stringify({ model: v.model }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useOdrzucModelZOpisu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<ModelZOpisu>(`/api/obsluga/wiedza/z-opisow/${v.id}/odrzuc`, { method: "POST", body: "{}" }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useIdentyfikatory(twId: number | null) {
  return useQuery({
    queryKey: kluczeWiedzy.identyfikatory(twId ?? 0),
    queryFn: () => api<Identyfikator[]>(`/api/obsluga/wiedza/identyfikatory/${twId}`),
    enabled: twId !== null,
  });
}

export function useDodajIdentyfikator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { twId: number; rodzaj: RodzajIdentyfikatora; wartosc: string }) =>
      api<Identyfikator>(`/api/obsluga/wiedza/identyfikatory`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => poWiedzy(qc, v.twId),
  });
}

/**
 * Cofnięcie numeru dopisanego z oferty (0.264.0) — WYŁĄCZNIE takiego.
 *
 * Wiersz `opis` cofa się poprawką opisu w Subiekcie i najbliższą przebudową,
 * wiersz `reczne` napisał człowiek. Wpisu z oferty nie cofa nic: przebudowa
 * go omija, bo nie ma z czego go odtworzyć. Serwer odmawia dla innych źródeł.
 */
export function useCofnijIdentyfikatorZOferty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; twId: number }) =>
      api<{ id: number; twId: number; wartosc: string }>(
        `/api/obsluga/wiedza/identyfikatory/${v.id}/cofnij-z-oferty`, { method: "POST", body: "{}" }),
    onSettled: (_d, _e, v) => poWiedzy(qc, v.twId),
  });
}

export type { PowodNegatywny };

/* ── Zabudowa silnika (§11.2) ────────────────────────────────────────────────
   Jeden odczyt oddaje trzy rzeczy: kolejkę par do rozstrzygnięcia, listę luk
   i pary zatwierdzone. Trzy zapytania po to samo byłyby trzema strzałami przy
   jednym otwarciu zakładki.

   Zegar jak przy kolejce propozycji: para przychodzi z cudzej rozmowy, więc
   ten ekran nie ma po czym poznać, że coś doszło. */
export function useSilniki() {
  return useQuery({
    queryKey: kluczeWiedzy.silniki,
    queryFn: () => api<{
      propozycje: Zabudowa[]; doRozstrzygniecia: number;
      luki: LukaSilnika[]; lukiRazem: number; zatwierdzone: Zabudowa[];
      /** Słownik silników (0.238.0) — ten sam odczyt, bo ekran pokazuje go obok luk. */
      aliasy: AliasSilnika[];
    }>(`/api/obsluga/wiedza/silniki`),
    refetchInterval: 30_000,
  });
}

/* ── Słownik silników (0.238.0) ──────────────────────────────────────────────
   Alias to zapis ręki biura: dodanie i usunięcie, bez rozstrzygania. Każda
   zmiana unieważnia też dobór (podpowiedź pod polem „Silnik") i kandydatów
   (powód pominięcia szczebla nazywa słownik) — robi to wspólne `poWiedzy`. */
export function useDodajAliasSilnika() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { tekst: string; silnik: NowaZabudowa["silnik"] }) =>
      api<AliasSilnika>(`/api/obsluga/wiedza/silniki/aliasy`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useUsunAliasSilnika() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<{ ok: true }>(`/api/obsluga/wiedza/silniki/aliasy/${v.id}/usun`, { method: "POST" }),
    onSettled: () => poWiedzy(qc),
  });
}

/* ── Tokeny silników w nazwach kartotek (0.239.0) ────────────────────────────
   Lista zmienia się po imporcie i po decyzji biura, więc minuta świeżości
   jak przy „Z opisów". Rozstrzygnięcie idzie HURTEM — jedna trasa na listę
   przejrzaną naraz, bo osobne wywołanie na kartotekę zamieniłoby jedno
   kliknięcie w trzydzieści. Zatwierdzone zastosowania są od razu szczeblem
   doboru, stąd wspólne `poWiedzy`. */
export function useTokenySilnikow() {
  return useQuery({
    queryKey: kluczeWiedzy.tokeny,
    queryFn: () => api<{ tokeny: TokenSilnika[]; nowychRazem: number }>(`/api/obsluga/wiedza/tokeny`),
    staleTime: 60_000,
  });
}

export function useDodajToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { token: string; silnik: NowaZabudowa["silnik"] }) =>
      api<TokenSilnika>(`/api/obsluga/wiedza/tokeny`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useRozstrzygnijToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; zatwierdz: number[]; pomin: number[] }) =>
      api<{ zatwierdzonych: number; juzBylo: number; pominietych: number }>(
        `/api/obsluga/wiedza/tokeny/${v.id}/rozstrzygnij`,
        { method: "POST", body: JSON.stringify({ zatwierdz: v.zatwierdz, pomin: v.pomin }) }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useUsunToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<{ ok: true }>(`/api/obsluga/wiedza/tokeny/${v.id}/usun`, { method: "POST" }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useZaproponujZabudowe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NowaZabudowa) =>
      api<Zabudowa>(`/api/obsluga/wiedza/silniki`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useRozstrzygnijZabudowe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "zatwierdz" | "odrzuc"; powod?: string | null }) =>
      api<Zabudowa>(`/api/obsluga/wiedza/silniki/${v.id}/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajZabudowe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; powod: string }) =>
      api<Zabudowa>(`/api/obsluga/wiedza/silniki/${v.id}/wycofaj`, {
        method: "POST", body: JSON.stringify({ powod: v.powod }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

/* ── Pasowanie części (§11.2) ────────────────────────────────────────────────
   Adresy WYŁĄCZNIE tutaj — strażnik w `routes/wiedza.test.ts` czyta ten plik. */

/* ── Import odsyłaczy od dostawców ───────────────────────────────────────────
   Podgląd i zapis to JEDNA trasa z flagą `zastosuj`. Podgląd niczego nie
   unieważnia, bo niczego nie zapisał; zapis odświeża całą wiedzę — nowe numery
   działają w szukaniu, w doborze i w kolejce zamienności. */
export function useImportOdsylaczy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { dostawca: string; plik: string | null; tresc: TrescImportu;
      mapowanie: MapowanieOdsylaczy | null; zastosuj: boolean }) =>
      api<RaportImportuOdsylaczy>(`/api/obsluga/wiedza/odsylacze`, { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (r) => { if (r.zapisano) poWiedzy(qc); },
  });
}

export function useHistoriaImportow() {
  return useQuery({
    queryKey: kluczeWiedzy.odsylacze,
    queryFn: () => api<ImportOdsylaczy[]>(`/api/obsluga/wiedza/odsylacze`),
  });
}

export function useWycofajImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<ImportOdsylaczy>(`/api/obsluga/wiedza/odsylacze/${id}/wycofaj`, { method: "POST" }),
    onSettled: () => poWiedzy(qc),
  });
}

/* ── Wykaz części producenta: podgląd i zapis jedną trasą, jak odsyłacze ─── */
export function useImportWykazu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { zrodlo: string; link: string | null; plik: string | null;
      rodzajDowodu: "producent" | "katalog_dostawcy"; tresc: TrescImportu;
      mapowanie: MapowanieWykazu | null; zastosuj: boolean }) =>
      api<RaportWykazu>(`/api/obsluga/wiedza/wykazy`, { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (r) => { if (r.zapisano) poWiedzy(qc); },
  });
}

export function useHistoriaWykazow() {
  return useQuery({
    queryKey: kluczeWiedzy.wykazy,
    queryFn: () => api<ImportWykazu[]>(`/api/obsluga/wiedza/wykazy`),
  });
}

/* ── „Pasuje do" z ofert: stan i sprawdzenie (odczyt), dwa kroki zbiórki ─── */
export function usePasujeDo() {
  return useQuery({
    queryKey: kluczeWiedzy.pasujeDo,
    queryFn: () => api<{ stan: StanPasujeDo; sprawdzenie: SprawdzenieOfert }>(`/api/obsluga/wiedza/pasuje-do`),
  });
}

/* Bez odświeżania po każdej stronie i partii: zbiórka to kilkadziesiąt
   żądań, a ekran odświeża stan sam, gdy przebieg się kończy. */
export function useSpiszOferty() {
  return useMutation({
    mutationFn: (offset: number) => api<WynikListyOfert>(`/api/obsluga/wiedza/pasuje-do/lista`,
      { method: "POST", body: JSON.stringify({ offset }) }),
  });
}

export function useZbierzPasujeDo() {
  return useMutation({
    mutationFn: () => api<WynikPartiiPasujeDo>(`/api/obsluga/wiedza/pasuje-do/zbierz`, { method: "POST" }),
  });
}

/** Zatwierdzenie listą — identyfikatory, które człowiek zostawił zaznaczone. */
export function useZatwierdzZWykazu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { importId: number; ids: number[] }) =>
      api<{ zatwierdzono: number; pominieto: number; wykaz: ImportWykazu }>(`/api/obsluga/wiedza/wykazy/${v.importId}/zatwierdz`,
        { method: "POST", body: JSON.stringify({ ids: v.ids }) }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajWykaz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<ImportWykazu>(`/api/obsluga/wiedza/wykazy/${id}/wycofaj`, { method: "POST" }),
    onSettled: () => poWiedzy(qc),
  });
}

/* ── Zamienność przez wspólny numer oryginału ────────────────────────────────
   Decyzja o PARZE kartotek, nie o wierszu — kandydat wiersza nie ma. */
export function useRozstrzygnijZamiennosc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { twA: number; twB: number; decyzja: "zatwierdz" | "odrzuc"; powod?: string | null }) =>
      api<Zamiennosc>(`/api/obsluga/wiedza/zamiennosci-oem/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ twA: v.twA, twB: v.twB, decyzja: v.decyzja, powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajZamiennosc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; powod?: string | null }) =>
      api<Zamiennosc>(`/api/obsluga/wiedza/zamiennosci-oem/${v.id}/wycofaj`, {
        method: "POST", body: JSON.stringify({ powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

/**
 * Cała sieć wiedzy jednym odczytem: pasowania, zastosowania, zabudowy
 * i zamienniki. Bez zegara, inaczej niż kolejka: sieć
 * to wgląd, nie praca, a przerysowany co pół minuty układ przesuwałby węzły
 * spod kursora. Świeżość daje `poWiedzy` po każdym zapisie z tego panelu.
 */
export function useSiecWiedzy() {
  return useQuery({
    queryKey: kluczeWiedzy.siec,
    queryFn: () => api<SiecWiedzy>("/api/obsluga/wiedza/siec"),
  });
}
export function useZaproponujPasowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NowePasowanie) =>
      api<Pasowanie>(`/api/obsluga/wiedza/pasowania`, { method: "POST", body: JSON.stringify(v) }),
    onSettled: (_d, _e, v) => { poWiedzy(qc, v.twId); qc.invalidateQueries({ queryKey: klucze.towar(v.doTwId) }); },
  });
}

export function useRozstrzygnijPasowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "zatwierdz" | "odrzuc"; powod?: string | null }) =>
      api<Pasowanie>(`/api/obsluga/wiedza/pasowania/${v.id}/rozstrzygnij`, {
        method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}

export function useWycofajPasowanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; powod?: string | null }) =>
      api<Pasowanie>(`/api/obsluga/wiedza/pasowania/${v.id}/wycofaj`, {
        method: "POST", body: JSON.stringify({ powod: v.powod ?? null }),
      }),
    onSettled: () => poWiedzy(qc),
  });
}
