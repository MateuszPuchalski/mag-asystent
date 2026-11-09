import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./klient";
import { poZapisieSprawy } from "./spoiwo";
import type { DoDopisania, FakturaZwrotu, KandydatFaktury, KolejkaZwrotow, KoszZwrotow, Ocena, PozycjaNaOutlet, SkladPozycji, StanZwrotow, StanZwrotuPieniedzy, WierszDokumentu, WpisOsiZwrotu, WynikDosylki, ZwrotPlatnosciAllegro, DosylkaZalozona, Zwrot, SprawaZakupu, PrzystanekDrogi } from "./typy";

/* Zwroty jadą JEDNYM zapytaniem razem z licznikami. Zwrotów w pracy są
   dziesiątki, nie tysiące, a dzięki temu przełączenie kubełka nie kosztuje
   ani jednego strzału do serwera — czyli dokładnie ten koszt, który ten
   ekran miał zdjąć. */

export const kluczeZwrotow = {
  kolejka: ["zwroty"] as const,
  zwrot: (id: number) => ["zwrot", id] as const,
  /* Przedrostek WSZYSTKICH szczegółów — dla zapisów, które nie znają numeru
     zwrotu, a zmieniają to, co szczegół niesie. Otwarty jest i tak
     jeden, więc nic zbędnego się tym nie odświeża. */
  szczegoly: ["zwrot"] as const,
  kosz: ["zwroty", "kosz"] as const,
  /* Lista robocza outletu — osobny klucz, bo odświeża ją co innego
     niż koszyk: ocena „na outlet" i meldunek o przeniesieniu. */
  outlet: ["zwroty", "outlet"] as const,
};

/**
 * Odświeżenie po zapisie zwrotu — kolejka DOKŁADNIE i otwarty szczegół.
 *
 * DOKŁADNIE, bo `["zwroty"]` jest przedrostkiem także koszyka i rozjazdów,
 * a rozjazdy liczy się z całej bazy, choć żaden z tych zapisów ich nie rusza. Rozjazdy mają własny rytm co minutę, a koszyk odświeża ten, kto go zmienia.
 *
 * SZCZEGÓŁ ZAWSZE, bo to on niesie blok pieniędzy: po zapisaniu przyjęcia
 * albo kwoty ma się pojawić przycisk ODDAJ PIENIĄDZE.
 *
 * ZWRACAMY OBIETNICĘ KOLEJKI i tylko jej. Mutacja zostaje w toku, aż kolejka
 * wróci, więc następny klawisz dostaje świeży kubełek i wersję — bez tego `P`
 * i zaraz `S` odbiłoby się od blokady optymistycznej. Na szczegół nikt nie
 * czeka: klawisze go nie czytają.
 */
function odswiez(qc: ReturnType<typeof useQueryClient>, { kosz = false } = {}) {
  void qc.invalidateQueries({ queryKey: kluczeZwrotow.szczegoly });
  if (kosz) void qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
  return qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
}

export function useZwroty() {
  return useQuery({
    queryKey: kluczeZwrotow.kolejka,
    queryFn: () => api<KolejkaZwrotow>("/api/obsluga/zwroty"),
  });
}

export function useZwrot(id: number | null) {
  return useQuery({
    queryKey: kluczeZwrotow.zwrot(id ?? 0),
    queryFn: () => api<{
      zwrot: Zwrot; os: WpisOsiZwrotu[]; kandydaciFaktury: KandydatFaktury[];
      doDopisania: DoDopisania[]; pieniadze: StanZwrotuPieniedzy;
      /* Klucz to identyfikator pozycji. Serwer liczy to TYLKO w szczególe —
         w kolejce byłoby kilkaset zapytań o dokumenty i mapowania ofert. */
      sklady: Record<number, SkladPozycji>;
      /* Wiersze paragonu — materiał do RĘCZNEGO składu. Jeden raz na
         zwrot, bo dokument jest jeden. */
      wierszeDokumentu: WierszDokumentu[];
      /* Spoiwo kolejek (S1 i S3): reklamacje tego zakupu oraz jego
         droga. Tylko w szczególe — powód ten sam, co przy składach wyżej. */
      sprawy: SprawaZakupu[];
      droga: PrzystanekDrogi[];
      /* Kosze z towarem tego zwrotu — wiązanie kosz ↔ zwrot
         od strony zwrotu. Tylko w szczególe, z tego samego powodu co wyżej. */
      kosze: Array<{ id: number; kod: string; status: string }>;
    }>(
      `/api/obsluga/zwroty/${id}`),
    enabled: id !== null,
  });
}

/** Grosze na tekst, który czyta biuro. Jedna funkcja na cały panel. */
export const zlote = (grosze: number | null | undefined, waluta = "PLN") =>
  grosze == null ? "—" : `${(grosze / 100).toFixed(2).replace(".", ",")} ${waluta}`;

/**
 * Potwierdzenie kartoteki dla pozycji zwrotu.
 *
 * `twId: null` ZDEJMUJE powiązanie — droga wyjścia z błędnego potwierdzenia.
 * `zrodlo` jedzie razem z wyborem, bo bez niego nie da się później odróżnić
 * zatwierdzonej propozycji automatu od wskazania człowieka (§4.3).
 */
export function usePotwierdzKartoteke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; twId: number | null; zrodlo: "sku" | "reczne" }) =>
      api<{ twId: number | null; twSymbol: string | null; twZrodlo: string | null }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/kartoteka`,
        { method: "POST", body: JSON.stringify({ twId: v.twId, zrodlo: v.zrodlo }) },
      ),
    /* SZCZEGÓŁ TEŻ. To on niesie `sklady`, czyli zdanie „nie weszła
       do koszyka — POWÓD". Bez tego zatwierdzenie kartoteki zostawiłoby na
       ekranie powód sprzed zatwierdzenia. */
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.szczegoly });
    },
  });
}


/**
 * Ręczne dociągnięcie zamówień.
 *
 * Bez niego diagnoza „czemu ta pozycja nie ma kartoteki" wymagała czekania
 * dziesięciu minut na najrzadszy z trzech tickerów — czyli dokładnie wtedy,
 * gdy ktoś patrzy na ekran i chce wiedzieć, czy problem jest w danych, czy
 * w kodzie.
 */
/**
 * Ręczna synchronizacja zwrotów.
 *
 * Takt zwrotów chodzi rzadziej niż skrzynka — zwrot ma termin w dniach —
 * więc po nadaniu paczki biuro czekałoby kilkanaście minut na wiersz, o którym
 * już wie. Ten sam wzorzec co „Synchronizuj teraz" w reklamacjach.
 *
 * Żądanie BEZ ciała nie deklaruje typu treści; pilnuje tego `api()` i jego
 * test. Pusty JSON to `FST_ERR_CTP_EMPTY_JSON_BODY` i gołe „Bad Request"
 * na ekranie.
 */
export function useSynchronizujZwroty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ stan: StanZwrotow; kartoteki: number }>(
      "/api/obsluga/zwroty/synchronizuj", { method: "POST" }),
    onSettled: () => odswiez(qc),
  });
}

export interface WynikDociagniecia {
  pobrano: number;
  /* Ile zaległości dopiął przy okazji przebieg wiązania. Kartoteki
     są tu najważniejsze: to one odpowiadają na pytanie „czemu ta pozycja nie
     ma kartoteki", z którym operator ten przycisk naciska. */
  kartoteki: number;
  faktury: number;
  korekty: number;
  koszyki: number;
}

export function useDociagnijZamowienia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<WynikDociagniecia>("/api/obsluga/zwroty/zamowienia", { method: "POST" }),
    onSettled: () => odswiez(qc),
  });
}

/* ── Decyzje biura ───────────────────────────────────────────────────────────
   Trzy mutacje domykają trzy pierwsze kubełki. Każda niesie WERSJĘ zwrotu,
   bo dwóch agentów nie ma prawa zamknąć jednego zwrotu dwiema kwotami —
   ten sam wzorzec, co przy przejmowaniu rozmowy. Konflikt wraca kodem 409
   i typem `Konflikt`, więc ekran rysuje „ktoś zdążył pierwszy", a nie błąd. */

export function useWerdykt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; decyzja: "przyjety" | "odrzucony"; powod: string | null; wersja: number }) =>
      api<{ werdykt: string; wersja: number }>(`/api/obsluga/zwroty/${v.id}/werdykt`,
        { method: "POST", body: JSON.stringify({ decyzja: v.decyzja, powod: v.powod, wersja: v.wersja }) }),
    onSettled: () => odswiez(qc),
  });
}

/**
 * Ptaszek przy składniku kompletu.
 *
 * `wKoszyku` to stan DOCELOWY, nie czynność — jedna trasa na oba kierunki,
 * więc panel nie musi wiedzieć, co dziś stoi w koszyku, zanim kliknie.
 *
 * Unieważnia szczegół zwrotu I pasek koszyka: odznaczenie zdejmuje wiersz
 * z dokumentu, więc licznik zebranych sztuk zmienia się razem z ptaszkiem.
 */
export function useZaznaczSkladnik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; twId: number; wKoszyku: boolean; zwrotId: number }) =>
      api<{ sklad: SkladPozycji }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/skladnik`,
        { method: "POST", body: JSON.stringify({ twId: v.twId, wKoszyku: v.wKoszyku }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.zwrotId) });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
      /* Ptaszek na składniku odłożonym na outlet zdejmuje go z listy regału. */
      qc.invalidateQueries({ queryKey: kluczeZwrotow.outlet });
    },
  });
}

/**
 * Składnik kompletu na regał outletowy zamiast na MM.
 *
 * Osobna trasa, a nie trzeci stan ptaszka: odznaczony składnik nie trafia
 * nigdzie, a outlet ma czytelnika, czyli listę roboczą regału. `naOutlet` to stan
 * docelowy, jak przy ptaszku, więc cofnięcie idzie tą samą drogą.
 *
 * Unieważnia też listę outletu, bo składnik właśnie na nią wszedł albo zszedł.
 */
export function useSkladnikNaOutlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; twId: number; naOutlet: boolean; zwrotId: number }) =>
      api<{ sklad: SkladPozycji }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/skladnik/outlet`,
        { method: "POST", body: JSON.stringify({ twId: v.twId, naOutlet: v.naOutlet }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.zwrotId) });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.outlet });
    },
  });
}

/**
 * Ręczne wskazanie składu kompletu.
 *
 * Odświeża szczegół (powód i skład), kolejkę (`wKoszyku` pozycji) i pasek
 * koszyka: zapis wkłada pozycję do pudła, gdy ocena „na stan" już stoi.
 */
export function useWskazSklad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      pozycjaId: number; zwrotId: number;
      skladniki: Array<{ twId: number; naKomplet: number }>;
    }) => api<{ sklad: SkladPozycji; koszyk: number | null }>(
      `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/sklad`,
      { method: "POST", body: JSON.stringify({ skladniki: v.skladniki }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.zwrotId) });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
    },
  });
}

export function useOcena() {
  const qc = useQueryClient();
  return useMutation({
    /* `null` COFA ocenę. */
    mutationFn: (v: { pozycjaId: number; ocena: Ocena | null; wersja: number;
      koszId?: number }) =>
      api<{ wersja: number; koszyk: number | null }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/ocena`,
        { method: "POST", body: JSON.stringify(
          { ocena: v.ocena, wersja: v.wersja, koszId: v.koszId }) }),
    /* Ocena „na stan" dokłada pozycję do koszyka zwrotów, więc odświeża też
       jego pasek — inaczej licznik na ekranie stałby w miejscu, a operator
       nie wiedziałby, ile już zebrał. */
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
      /* I lista outletu: ocena „na outlet" dopisuje do niej pozycję, a zmiana
         na inną — zabiera. */
      void qc.invalidateQueries({ queryKey: kluczeZwrotow.outlet });
      /* I szczegół — po ocenie zmienia się `wKoszyku` każdego składnika. */
      void qc.invalidateQueries({ queryKey: kluczeZwrotow.szczegoly });
      /* OBIETNICA KOLEJKI WRACA — reguła `odswiez` wyżej. Inaczej szybkie
         `s s s` wysłałoby drugą ocenę ze starą wersją. */
      return qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
    },
  });
}

/* ── Koszyk zakładany WPROST ────────────────────────────────────────────────
   Zgłoszenie właściciela: „potrzebuję tworzenia koszy zwrotowych i dodawania
   produktów do nich jako oddzielna opcja".

   Obie mutacje odświeżają WYŁĄCZNIE koszyk: zwrotów nie ruszają, bo pudło
   zakładane wprost nie ma za sobą żadnego zwrotu.                            */

export function useNowyKoszyk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rodzaj?: "zwroty" | "odpad" } = {}) =>
      api<{ kosz: KoszZwrotow }>("/api/obsluga/zwroty/kosz/nowy",
        { method: "POST", body: JSON.stringify({ rodzaj: v.rodzaj ?? "zwroty" }) }),
    onSettled: () => { qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz }); },
  });
}

/**
 * Usuwa CAŁY koszyk — także napełniony.
 *
 * Odświeża TAKŻE zwroty: usunięcie pudła cofa oceny wszystkich wierszy, które
 * przyszły ze zwrotów, więc karty wracają do kubełka DO OCENY.
 */
export function useUsunKoszyk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (koszId: number) =>
      api<{ koszId: number; kod: string; pozycji: number; zwrotow: number }>(
        "/api/obsluga/zwroty/kosz/usun",
        { method: "POST", body: JSON.stringify({ koszId }) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.szczegoly });
    },
  });
}

/* ── Regał outletowy obsługiwany ręką ───────────────────────────────────────
   Decyzja właściciela: „na razie będziemy obsługiwać outlet ręcznie". Panel
   nie wystawia tu żadnego dokumentu — mówi, co czeka na przeniesienie,
   i przyjmuje meldunek, że już nie czeka.

   Lista jest WARUNKIEM istnienia trzeciej oceny: znacznik ma czytelnika,
   który niesie towar na regał.                                              */

export function useOutlet() {
  return useQuery({
    queryKey: kluczeZwrotow.outlet,
    queryFn: () => api<{ pozycje: PozycjaNaOutlet[] }>("/api/obsluga/zwroty/outlet"),
  });
}

export function usePrzeniesionoNaOutlet() {
  const qc = useQueryClient();
  return useMutation({
    /* `twId` odklikuje jeden składnik kompletu; bez niego całą pozycję. */
    mutationFn: (v: { pozycjaId: number; twId?: number }) =>
      api<{ pozycjaId: number; outletAt: string }>(
        "/api/obsluga/zwroty/outlet/przeniesiono",
        { method: "POST", body: JSON.stringify(v) }),
    /* Także oś zwrotu: meldunek dopisuje do niej zdanie, więc otwarta karta
       pokazywałaby stan sprzed kliknięcia. */
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.outlet });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.szczegoly });
    },
  });
}

/**
 * Koszyk zamknięty BEZ DOKUMENTU: brak korekt albo MM odrzucone przez
 * Sferę. Ten drugi wymaga ręki, bo sam się nie odblokuje.
 */
export interface KoszykCzekajacy {
  id: number;
  kod: string;
  /** Zwroty czy odpad — ekran mówi, na który koniec hali czeka papier. */
  rodzaj: "zwroty" | "odpad";
  zamknietoAt: string;
  brakuje: Array<{ zwrotId: number; numer: string }>;
  /** Odmowa Sfery; niepusta znaczy też, że zadanie wciąż wisi przy koszu. */
  blad?: string | null;
  /**
   * CAŁA zawartość pudła, nie tylko wiersze ze skanu.
   *
   * Koszyk Z-8 pokazał cenę tamtego zawężenia: odbił się od Sfery na kartotece
   * przyniesionej OCENĄ, więc nie miał ani jednego krzyżyka i nie było jak go
   * odetkać z tego ekranu. `zeZwrotu` zostaje, bo zdjęcie takiego wiersza cofa
   * przy okazji ocenę — ekran ma to powiedzieć PRZED kliknięciem.
   */
  pozycje?: Array<{
    pozycjaId: number; symbol: string; nazwa: string; ilosc: number; zeZwrotu: boolean;
    /** Ile tego towaru leży na magazynie, z którego MM ma go zabrać. */
    stanMag?: number;
    /** Czy to TEN wiersz wywrócił dokument: na magazynie jest go za mało. */
    brakNaMag?: boolean;
    /** Ile z `stanMag` jest zarezerwowane. */
    rezerwacja?: number;
    /** Towar jest, ale wolnego (stan − rezerwacje) za mało — naprawa: rezerwacja w Subiekcie. */
    brakWolnego?: boolean;
  }>;
}

/** Co leży w otwartym koszyku zwrotów tego operatora. */
export function useKosz() {
  return useQuery({
    queryKey: kluczeZwrotow.kosz,
    queryFn: () => api<{ kosze: KoszZwrotow[]; czekajace?: KoszykCzekajacy[] }>(
      "/api/obsluga/zwroty/kosz"),
  });
}

/** Kartoteka w wyniku szukania do koszyka — tyle, ile trzeba, żeby wskazać. */
export interface TowarDoKosza {
  twId: number;
  symbol: string;
  nazwa: string;
  ean: string | null;
  /** Stan na magazynie głównym; `null` przy trafieniu ze skanu. */
  stanMag: number | null;
}

/**
 * Towar do koszyka: skan albo kartoteka.
 *
 * JEDNO PYTANIE, jedna trasa — „który to towar". Kod z czytnika wraca jako
 * `dokladne` z jednym wynikiem, fraza jako lista. Pusty nie pyta serwera.
 */
export function useTowaryDoKosza(q: string) {
  const czysty = q.trim();
  return useQuery({
    queryKey: ["kosz-towary", czysty] as const,
    enabled: czysty.length > 0,
    queryFn: () => szukajTowaruDoKosza(czysty),
  });
}

/**
 * To samo pytanie bez hooka — dla skanu z nasłuchu ekranu.
 *
 * Skan EAN-u na zakładce zwrotów pyta kartotekę RAZ i od odpowiedzi zależy,
 * dokąd kod pójdzie dalej. Zapytanie kluczowane frazą trzymałoby w pamięci
 * każdy zeskanowany kod, a tu wynik jest potrzebny tylko w tej jednej chwili.
 */
export function szukajTowaruDoKosza(q: string) {
  return api<{ towary: TowarDoKosza[]; dokladne: boolean; przyblizone: boolean }>(
    `/api/obsluga/zwroty/kosz/towary?q=${encodeURIComponent(q.trim())}`);
}

/**
 * Dołożenie towaru do koszyka ręką.
 *
 * Decyzja właściciela: „dodaj możliwość dodawania produktów do koszyka
 * zwrotowego poprzez zeskanowanie produktu lub wybranie go z kartoteki",
 * z granicą „tylko z poziomu obsługi zwrotów, jak jeszcze nie jest zamknięty".
 * Odświeża pasek koszyka, bo licznik ma rosnąć na oczach.
 */
export function useDolozTowar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { twId: number; ilosc?: number; rodzaj?: "zwroty" | "odpad";
      koszId?: number }) =>
      api<{ koszId: number; kod: string; pozycjaId: number; symbol: string; ilosc: number }>(
        "/api/obsluga/zwroty/kosz/towar", { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz }),
  });
}

/**
 * Zdjęcie wiersza z koszyka bez dokumentu — cena pomyłki przy skanie i ocenie.
 *
 * ODŚWIEŻA TAKŻE ZWROTY. Schodzi stąd również wiersz przyniesiony OCENĄ, a wtedy serwer cofa tę ocenę: zwrot wraca do kubełka
 * DO OCENY. Bez unieważnienia kolejki karta zwrotu pokazywałaby ocenę, której
 * już nie ma.
 */
export function useZdejmijTowar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pozycjaId: number) =>
      api<{ koszId: number; kod: string; symbol: string }>(
        "/api/obsluga/zwroty/kosz/towar/zdejmij",
        { method: "POST", body: JSON.stringify({ pozycjaId }) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.szczegoly });
    },
  });
}

/**
 * Domknięcie koszyka: MM wychodzi PO KOMPLECIE KOREKT.
 *
 * Odświeża TAKŻE kolejkę zwrotów, bo domknięcie zmienia stan pozycji
 * (`wKoszyku`) w każdym zwrocie, z którego coś do kosza wpadło.
 */
export function useZamknijKosz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (koszId: number) =>
      api<{ koszId: number; kod: string; pozycji: number; queueId: number }>(
        "/api/obsluga/zwroty/kosz/zamknij",
        { method: "POST", body: JSON.stringify({ koszId }) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
      /* Zamknięty koszyk staje się koszem na liście koszy — bez tego
         przełącznik na kosze pokazywał listę sprzed zamknięcia. */
      qc.invalidateQueries({ queryKey: ["kosze"] });
    },
  });
}

/**
 * Wypuszczenie MM koszyka MIMO brakujących korekt.
 *
 * Decyzja właściciela: „dodaj opcję sforsowania zamknięcia koszyka, nawet
 * jeśli nie ma wszystkich ZW". Bramka zostaje domyślna — to wyjście
 * awaryjne obok niej.
 *
 * OSOBNY ADRES, nie flaga przy `zamknij`: flaga w ciele robi z wyjątku wariant
 * zwykłej czynności, a tę decyzję ma być widać w kodzie i w logu.
 *
 * Odświeża to samo co domknięcie — dokument zmienia stan kosza i pozycji.
 */
export function useMmMimoKorekt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (koszId: number) =>
      api<{ koszId: number; kod: string; queueId: number; pominietoKorekt: number }>(
        "/api/obsluga/zwroty/kosz/mm-mimo-korekt",
        { method: "POST", body: JSON.stringify({ koszId }) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
    },
  });
}

/** Jedna paczka z historii klienta — tyle, ile trzeba, żeby wskazać właściwą. */
export interface PaczkaKlienta {
  orderId: string;
  kupionoAt: string | null;
  sumaGrosze: number | null;
  waluta: string;
  pozycji: number;
  zawartosc: string;
  /** Zwrot dla tego zamówienia już istnieje — ostrzeżenie, nie blokada. */
  maZwrot: boolean;
  /** Nazwa odbiorcy z naklejki — po niej rozpoznaje się karton. */
  odbiorcaNazwa: string | null;
  /** Login kupującego — paczkę znalezioną po nazwisku trzeba zapisać z nim. */
  kupujacyLogin: string | null;
  /* ── Reszta adresu ───────────────────────────────────────────────────────
     Do ROZRÓŻNIANIA trafień, nie do szukania. Telefon bywa `null` także przy
     pełnym adresie: `phoneNumber` nie stoi w `required` schematu Allegro. */
  odbiorcaTelefon: string | null;
  odbiorcaUlica: string | null;
  odbiorcaMiasto: string | null;
  odbiorcaKod: string | null;
  /** Zamówienie w panelu Allegro; `null` bez wzorca adresu. */
  link: string | null;
}

/**
 * Co ten klient u nas kupił.
 *
 * Zgłoszenie właściciela: „kupujący może mieć wiele paczek kupionych
 * w historii sklepu, więc muszę mieć możliwość wybrania paczki". Pusty uchwyt
 * NIE PYTA serwera — zapytanie o wszystkich byłoby listą cudzych zakupów,
 * a nie odpowiedzią na pytanie operatora.
 *
 * UCHWYTEM JEST LOGIN ALBO NAZWISKO Z NAKLEJKI. Jedno pole, bo operator
 * z kartonem w ręku ma to, co ma — dwa pola kazałyby mu najpierw rozstrzygnąć,
 * czym jest to, co przepisuje. Zasady dopasowania rozstrzyga serwer: login
 * w całości, nazwisko po fragmencie.
 *
 * POST, CHOĆ TO ODCZYT — ta sama decyzja co przy `/skan`. Uchwyt
 * w adresie wylądowałby w logu żądań serwera, a bywa nim teraz nazwisko.
 *
 * Odczyt, więc `useQuery`: otwarcie i przeglądanie niczego nie mutuje.
 */
export function usePaczkiKlienta(szukane: string) {
  const czysty = szukane.trim();
  return useQuery({
    queryKey: ["paczki-klienta", czysty] as const,
    enabled: czysty.length > 0,
    queryFn: () => api<{ paczki: PaczkaKlienta[] }>(
      "/api/obsluga/zwroty/paczki-klienta",
      { method: "POST", body: JSON.stringify({ szukane: czysty }) }),
  });
}

/**
 * Czy uchwyt może być loginem Allegro — lustro `wygladaNaLogin` z serwera.
 *
 * Panel sprawdza sam, żeby nazwisko ze spacją nie wysyłało żądania, które
 * serwer i tak odrzuci. Serwer sprawdza drugi raz, bo panel nie jest bramką.
 */
export function wygladaNaLogin(uchwyt: string): boolean {
  const u = uchwyt.trim();
  /* Drugi wzór to login bez pseudonimu, `client:124843816` —
     Sales Center pokazuje go wprost jako login kupującego. */
  return /^[\p{L}\p{N}._-]{2,64}$/u.test(u) || /^client:\d{3,20}$/i.test(u);
}

/**
 * Zamówienia kupującego prosto z Allegro, po loginie.
 *
 * Nasza baza zna tylko zamówienia, do których prowadzi zwrot, wiadomość albo
 * reklamacja. Paczka nieodebrana nie ma żadnego z nich, więc lista paczek
 * klienta wychodziła przy niej pusta, a biuro szukało na stronie Allegro.
 *
 * MUTACJA, nie zapytanie: serwer zapisuje pobrane zamówienia, a żądanie do
 * Allegro ma wyjść z ręki operatora, nie z odświeżenia okna. Po sukcesie
 * odświeżamy listę paczek — to ona pokazuje wynik, ta mutacja tylko go
 * sprowadza.
 */
export function useZamowieniaZAllegro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (login: string) => api<{ pobrano: number }>(
      "/api/obsluga/zwroty/paczki-klienta/allegro",
      { method: "POST", body: JSON.stringify({ login: login.trim() }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paczki-klienta"] }),
  });
}

/**
 * Paczka nieodebrana przyjęta z wyniku szukania.
 *
 * Wysyła zamówienie i — gdy panel go ma — numer z naklejki, który chybił
 * w skanie. Nic więcej: pozycje, login i odbiorcę serwer bierze z zamówienia.
 * Po sukcesie odświeża kolejkę, żeby nowy zwrot dał się od razu otworzyć,
 * i listę paczek, żeby wiersz pokazał „ma już zwrot".
 */
export function usePrzyjmijNieodebrana() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { orderId: string; waybill: string | null }) =>
      api<{ zwrotId: number; pozycji: number }>("/api/obsluga/zwroty/przyjmij-nieodebrana",
        { method: "POST", body: JSON.stringify(v) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["paczki-klienta"] });
      return odswiez(qc);
    },
  });
}

/**
 * Potrącenie za utratę wartości pojedynczej pozycji.
 *
 * To JEDYNA liczba o pieniądzach, jaką panel wolno mu wysłać — i dlatego
 * serwer trzyma ją w widełkach `0…wartość pozycji` i żąda powodu. Kwotę do
 * oddania dalej składa on sam z zaznaczenia; potrącenie tylko ją obniża.
 */
export function usePotracenie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; grosze: number | null; powod: string; wersja: number }) =>
      api<{ wersja: number; potracenieGrosze: number | null }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/potracenie`,
        { method: "POST", body: JSON.stringify({ grosze: v.grosze, powod: v.powod, wersja: v.wersja }) }),
    onSettled: () => odswiez(qc),
  });
}

/**
 * Zapis kwoty — wysyła ZAZNACZENIE, nigdy liczby.
 *
 * §25a.3: „Liczy ją serwer, panel niczego nie zgaduje". Suma na ekranie jest
 * podglądem; gdyby panel przysyłał gotową kwotę, dałoby się oddać dowolną
 * sumę żądaniem z pominięciem ekranu.
 */
export function useKwota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; pozycjeIds: number[]; dostawa: boolean; wersja: number }) =>
      api<{ kwotaGrosze: number; dostawaGrosze: number; wariant: string; wersja: number }>(
        `/api/obsluga/zwroty/${v.id}/kwota`,
        { method: "POST", body: JSON.stringify({
          pozycjeIds: v.pozycjeIds, dostawa: v.dostawa, wersja: v.wersja }) }),
    onSettled: () => odswiez(qc),
  });
}

/**
 * Numer korekty wystawionej w Subiekcie — i jego cofnięcie.
 *
 * Panel niczego nie wystawia: `korekta_zwrot` w kolejce Sfery potrzebuje
 * `dok_Id` dokumentu SPRZEDAŻY, a read-model zna wyłącznie zakupy. Zapisujemy
 * FAKT, że korekta powstała, i pozwalamy go cofnąć — numer przepisuje ręką
 * człowiek, więc literówka jest tu zdarzeniem normalnym (§25a.5).
 */
export function useKorekta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; numer: string; wersja: number }) =>
      api<{ korektaNumer: string; zamknietyAt: string; wersja: number }>(
        `/api/obsluga/zwroty/${v.id}/korekta`,
        { method: "POST", body: JSON.stringify({ numer: v.numer, wersja: v.wersja }) }),
    onSettled: () => odswiez(qc),
  });
}

/**
 * Ile sztuk naprawdę wróciło w kartonie. `null` czyści zapis.
 *
 * Odświeża też pasek koszyka: liczba sztuk na dokumencie MM bierze się z tej
 * samej wartości, więc licznik przy koszu musi ruszyć razem z nią.
 */
export function useIloscZwrocona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number; ilosc: number | null; wersja: number }) =>
      api<{ wersja: number; iloscZwrocona: number | null }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/ilosc`,
        { method: "POST", body: JSON.stringify({ ilosc: v.ilosc, wersja: v.wersja }) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: kluczeZwrotow.kosz });
      /* Obietnica kolejki, jak przy ocenie: `Enter` zaraz po
         zapisie liczby ma trafić w świeży kubełek i wersję. */
      return qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
    },
  });
}

/**
 * Cofnięcie PRZYJĘCIA zwrotu — wraca do kubełka DECYZJA.
 */
export function useCofnijWerdykt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/${v.id}/werdykt/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: () => odswiez(qc),
  });
}

/**
 * Cofnięcie ustalonej kwoty — zwrot wraca do DO ZWROTU.
 *
 * Odświeża kolejkę tak samo jak zapis kwoty: kubełek zwrotu się zmienia, więc
 * licznik przy nagłówku musi ruszyć razem z nim.
 */
export function useCofnijKwote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/${v.id}/kwota/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: () => odswiez(qc),
  });
}

export function useCofnijKorekte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/${v.id}/korekta/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: () => odswiez(qc),
  });
}

/**
 * Złożenie wniosku o rabat transakcyjny — jedyna mutacja panelu, która
 * WYCHODZI do Allegro.
 *
 * Bez `wersja` i to jest wybór: wniosek nie zmienia stanu zwrotu u nas, a przed
 * dubletem broni strażnik serwera (końcówka Allegro nie ma idempotencji).
 * Blokada optymistyczna na cudzym zasobie dawałaby złudzenie kontroli.
 */
export function useZglosRabat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pozycjaId: number }) =>
      api<{ wniosekId: string; lineItemId: string }>(
        `/api/obsluga/zwroty/pozycje/${v.pozycjaId}/rabat`, { method: "POST" }),
    onSettled: () => odswiez(qc),
  });
}

/* ── Skan etykiety zwrotnej ──────────────────────────────────────────────────
   Kod jedzie CIAŁEM ŻĄDANIA, nie adresem, i to jest ta sama ostrożność co przy
   szynie zdarzeń: numer listu przewozowego w adresie wylądowałby w logu żądań
   serwera. */

export type TrafienieSkanu = "numer" | "external" | "waybill" | "wiele" | null;

export interface WynikSkanu {
  trafienie: TrafienieSkanu;
  zwrotId: number | null;
  zwroty: Array<{ id: number; numer: string | null; externalId: string }>;
  /** Tylko z dociągnięcia: ile zwrotów przyjechało z Allegro. */
  pobrano?: number;
}

export function useSkanZwrotu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kod: string) =>
      api<WynikSkanu>("/api/obsluga/zwroty/skan", {
        method: "POST", body: JSON.stringify({ kod }),
      }),
    /* Trafienie bywa świeże po dociągnięciu, więc kolejka ma się odświeżyć —
       ale samo szukanie niczego nie zapisuje. */
    onSuccess: (w) => { if (w.trafienie) qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true }); },
  });
}

/** Skan, który nie trafił u nas: pytamy Allegro o ten jeden numer listu. */
export function useDociagnijPoSkanie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kod: string) =>
      api<WynikSkanu>("/api/obsluga/zwroty/skan/dociagnij", {
        method: "POST", body: JSON.stringify({ kod }),
      }),
    onSettled: () => odswiez(qc),
  });
}

/**
 * Wskazanie dokumentu sprzedaży z Subiekta.
 *
 * `dokId: null` ZDEJMUJE powiązanie — droga wyjścia z pomyłki, a nie brak
 * funkcji (§25a.5). Panel wysyła sam identyfikator z listy kandydatów: numeru
 * wpisanego z palca serwer i tak nie przyjmie, bo dokument musi stać
 * w read-modelu.
 */
export function useFaktura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; dokId: number | null }) =>
      api<{ faktura: FakturaZwrotu }>(`/api/obsluga/zwroty/${v.id}/faktura`,
        { method: "POST", body: JSON.stringify({ dokId: v.dokId }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/**
 * Dopisanie produktu, którego klient nie zgłosił.
 *
 * Panel wysyła identyfikator POZYCJI ZAMÓWIENIA, nigdy nazwy ani ceny. Klient
 * może odesłać wyłącznie to, co kupił, a kwotę do oddania dalej składa serwer
 * z zaznaczenia (§25a.3).
 */
export function useDopiszPozycje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; zamPozycjaId: number; wersja: number }) =>
      api<{ wersja: number; pozycjaId: number }>(`/api/obsluga/zwroty/${v.id}/pozycje`,
        { method: "POST", body: JSON.stringify({ zamPozycjaId: v.zamPozycjaId, wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/** Zdjęcie pozycji dopisanej przez biuro — §25a.5, cofnięcie zamiast potwierdzenia. */
export function useZdejmijPozycje() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; pozycjaId: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/pozycje/${v.pozycjaId}/zdejmij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/* ── Zwrot pieniędzy i odmowa ────────────────────────────────────────────────
   Pierwsze wyjście tego panelu po CUDZE PIENIĄDZE. Stąd trzy różnice
   względem sąsiednich mutacji.

   KWOTY NIE MA W CIELE. Serwer bierze tę, którą sam policzył z zaznaczenia;
   panel podający liczbę pozwoliłby oddać dowolną kwotę żądaniem z pominięciem
   ekranu (ta sama decyzja co przy `useKwota`).

   PONOWIENIE JEST BEZPIECZNE po stronie serwera (`commandId`), ale przycisk
   i tak blokuje się na czas żądania: dwa kliknięcia to dwa żądania, a drugie
   dostałoby 409 i wyglądałoby jak awaria.

   UNIEWAŻNIAMY TEŻ SZCZEGÓŁ, nie samą kolejkę — po oddaniu pieniędzy zmienia
   się dokładnie ten ekran, na który patrzy operator. */

export function useZwrocPieniadze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ refundId: string; status: string | null; wersja: number }>(
        `/api/obsluga/zwroty/${v.id}/pieniadze`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/**
 * Zapis przelewu oddanego poza Allegro i jego cofnięcie.
 *
 * Przy pobraniu Allegro nie trzymało tych pieniędzy, więc `useZwrocPieniadze`
 * jest tam zamknięte z definicji, a zwrot zamykał się bez śladu po wypłacie.
 */
export function useZapiszPrzelew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number; referencja: string | null }) =>
      api<{ kiedy: string; wersja: number }>(`/api/obsluga/zwroty/${v.id}/przelew`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja, referencja: v.referencja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

export function useCofnijPrzelew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/${v.id}/przelew/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/**
 * Ręczne zamknięcie zwrotu bez korekty i jego cofnięcie.
 *
 * Dotyczy WYŁĄCZNIE naszej kolejki: nic nie idzie do Allegro ani do Subiekta.
 * Unieważniamy po sukcesie i po błędzie, bo odmowa (towar w koszyku, zwrot już
 * zamknięty) znaczy zwykle, że ekran widzi stary stan zwrotu.
 */
export function useZamknijRecznie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number; powod?: string }) =>
      api<{ zamknietyAt: string; wersja: number }>(
        `/api/obsluga/zwroty/${v.id}/zamkniecie-reczne`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja, powod: v.powod }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

export function useOtworzPonownie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<{ wersja: number }>(`/api/obsluga/zwroty/${v.id}/zamkniecie-reczne/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/**
 * „Sprawdź w Allegro” przy pieniądzach zwrotu: serwer pyta Allegro o zwroty
 * płatności tego zamówienia i zapisuje je w lustrze.
 *
 * PRZYCISK, NIE AUTOMAT. Zapytanie zmienia lustro, a otwarcie ekranu niczego
 * nie zapisuje. Agent klika wtedy, gdy Sales Center pokazuje już oddane
 * pieniądze, a nasz stan jeszcze o nich nie wie.
 *
 * IDZIE BEZ CIAŁA (reguła klienta HTTP): serwer bierze zamówienie ze zwrotu.
 * Unieważniamy kolejkę i szczegół, bo po sprawdzeniu zwrot może zmienić
 * kubełek, a sekcja pieniędzy ma pokazać wypłatę z Allegro.
 */
export function useSprawdzPlatnosci() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<{ znaleziono: number; wyplacone: boolean; platnosci: ZwrotPlatnosciAllegro[];
        powodBraku: string | null }>(
        `/api/obsluga/zwroty/${v.id}/platnosci/sprawdz`, { method: "POST" }),
    onSettled: (_d, _e, v) => Promise.all([
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true }),
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) }),
    ]),
  });
}

/** Podsumowanie hurtowego sprawdzenia płatności — kształt odpowiedzi serwera. */
export interface WynikSprawdzeniaWszystkich {
  sprawdzonych: number;
  zapisane: number;
  zatrzasniete: number;
  bezZwrotuPlatnosci: number;
  /** `powod` to gotowe zdanie serwera; ekran pokazuje je wprost. */
  zPowodem: Array<{ powod: string; ile: number }>;
  /** Lista Allegro dłuższa niż jedno wejście (limit stron) — trzeba kliknąć jeszcze raz. */
  urwane: boolean;
}

/**
 * „Sprawdź wszystkie w Allegro” na kolejce: ten sam ruch co `useSprawdzPlatnosci`,
 * ale dla wszystkich zwrotów w pracy naraz.
 *
 * Sprawdzanie po jednym przyciskiem z sekcji pieniędzy było za wolne przy
 * setkach zwrotów. Żądanie bywa długie (serwer czyta do dwudziestu stron
 * Allegro), więc ekran blokuje przycisk na czas żądania.
 *
 * IDZIE BEZ CIAŁA (reguła klienta HTTP). Unieważniamy kolejkę I SZCZEGÓŁ także
 * po błędzie: przerwane sprawdzanie mogło część zwrotów już przestawić, a liczniki
 * kubełków mają pokazać stan faktyczny, nie sprzed kliknięcia.
 */
export function useSprawdzWszystkiePlatnosci() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<WynikSprawdzeniaWszystkich>(
      "/api/obsluga/zwroty/platnosci/sprawdz-wszystkie", { method: "POST" }),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true }),
      qc.invalidateQueries({ queryKey: kluczeZwrotow.szczegoly }),
    ]),
  });
}

/**
 * Odmowa wypłaty. Przy kodach dosyłki ta sama trasa zakłada też
 * śledzenie dosyłki i krok sprawy klienta — odpowiedź niesie wtedy `dosylka`.
 * Przy pozostałych kodach tego pola nie ma wcale.
 *
 * OBIETNICA WRACA z `onSettled` — lekcja `poZapisieSprawy` w `spoiwo.ts`.
 * Bez niej `isPending` gasło przed odświeżeniem szczegółu, a sekcja pieniędzy
 * rysowała przez chwilę stan sprzed odmowy z czynnym formularzem.
 */
export function useOdmowPlatnosci() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; kod: string; powod: string | null; wersja: number }) =>
      api<{ kod: string; wersja: number; dosylka?: WynikDosylki }>(`/api/obsluga/zwroty/${v.id}/odmowa-platnosci`,
        { method: "POST", body: JSON.stringify({ kod: v.kod, powod: v.powod, wersja: v.wersja }) }),
    onSettled: (d, _e, v) => Promise.all([
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true }),
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) }),
      d?.dosylka?.zalozona ? poZapisieSprawy(qc, d.dosylka.login) : null,
    ]),
  });
}

/**
 * „Śledź dosyłkę” przy zwrocie — ponowienie po odmowie, przy
 * której zapis u nas się nie udał, albo po odmowie złożonej w panelu
 * Allegro, której kod przyszedł synchronizacją (`rejection_code`).
 *
 * IDZIE BEZ CIAŁA. Serwer bierze zamówienie i konto ze zwrotu, więc nie ma
 * czego wysłać — a pusty JSON to „Bad Request” od Fastify (reguła klienta
 * HTTP z `CLAUDE.md`). Podwójne kliknięcie niczego nie psuje: drugie
 * żądanie oddaje tę samą dosyłkę bez nowego zapisu.
 *
 * Porażka przychodzi błędem 400 ze stałym zdaniem serwera, nie kształtem
 * `zalozona: false` — stąd typ odpowiedzi bez tej gałęzi. Obietnica wraca
 * z `onSettled` z tego samego powodu co przy odmowie wyżej.
 */
export function useSledzDosylkeZwrotu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number }) =>
      api<DosylkaZalozona>(`/api/obsluga/zwroty/${v.id}/dosylka`, { method: "POST" }),
    /* „Do decyzji” też: przycisk stoi tam w wierszu odmowy z panelu
       Allegro. Listę odświeża i tak każda udana mutacja (`klient-zapytan.ts`),
       ale `onSettled` na nią CZEKA — przycisk gaśnie dopiero, gdy wiersz już
       zszedł, więc drugiego kliknięcia w ten sam wiersz nie ma. */
    onSettled: (d, _e, v) => Promise.all([
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true }),
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) }),
      qc.invalidateQueries({ queryKey: ["do-decyzji"] }),
      d ? poZapisieSprawy(qc, d.login) : null,
    ]),
  });
}

/* ── Notatka biura i rozjazdy ────────────────────────────────────────────── */

/** Stan notatki po zapisie — nagłówek zwrotu odświeża się z tego, nie z listy. */
export interface StanNotatkiZwrotu {
  notatka: string | null;
  notatkaAt: string | null;
  notatkaPrzez: string | null;
  maPoprzednia: boolean;
  wersja: number;
}

export function useNotatkaZwrotu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; notatka: string | null; wersja: number }) =>
      api<StanNotatkiZwrotu>(`/api/obsluga/zwroty/${v.id}/notatka`,
        { method: "POST", body: JSON.stringify({ notatka: v.notatka, wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

export function useCofnijNotatkeZwrotu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; wersja: number }) =>
      api<StanNotatkiZwrotu>(`/api/obsluga/zwroty/${v.id}/notatka/cofnij`,
        { method: "POST", body: JSON.stringify({ wersja: v.wersja }) }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: kluczeZwrotow.kolejka, exact: true });
      qc.invalidateQueries({ queryKey: kluczeZwrotow.zwrot(v.id) });
    },
  });
}

/** Rozjazd rekoncyliacji — tyle, ile niesie wiersz paska. */
export interface RozjazdZwrotu {
  rodzaj: string;
  klucz: string;
  opis: string;
  odKiedy: string | null;
}

/**
 * Cztery kontrole rekoncyliacji, które dotyczą zwrotów.
 *
 * Osobne zapytanie, nie część kolejki: liczy je serwer z całej bazy, a kolejka
 * jedzie przy każdym kliknięciu kubełka. Odświeżanie co minutę wystarcza —
 * to raport poranny, nie alarm czasu rzeczywistego.
 */
export function useRozjazdyZwrotow() {
  return useQuery({
    queryKey: ["zwroty", "rozjazdy"] as const,
    queryFn: () => api<{ rozjazdy: RozjazdZwrotu[] }>("/api/obsluga/zwroty/rozjazdy"),
    refetchInterval: 60_000,
  });
}

