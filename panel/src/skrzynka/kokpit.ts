import type { HistoriaKlienta, Kategoria, Kubelek, OsRozmowy, StatusDoboru, WiedzaDoboru, Zwrot }
  from "../api/typy";
import { paczkaWSoczewce } from "./soczewki-reguly";

/* ── CIEMNY KOKPIT: CO W KOLUMNIE KONTEKSTU ŚWIECI (0.498.0) ────────────────
   Zgłoszenie właściciela z nagraniem prawej kolumny: „uporządkuj ten panel".
   Na nagraniu nazwa towaru stała cztery razy, SKU sześć, a jedyna rzecz,
   która czekała na człowieka — zwrot do decyzji — leżała w połowie przewijania,
   tą samą wagą co tabela sześciu cen. Właściciel wybrał z kanwy „E + A + D".

   A to zasada kokpitu Airbusa: w normie lampki gasną, świeci odchylenie.
   Kolumna ma więc dwie części. „Wymaga Ciebie" niesie to, co ma zegar albo
   czeka na ruch agenta. „W normie" to jedna linia na temat, rozwijana na żądanie.

   REGUŁY STOJĄ TUTAJ, w czystych funkcjach z testem, a nie w JSX. Wygaszony
   wiersz jest bezpieczny tylko wtedy, gdy reguła „w normie" jest prawdziwa;
   pomyłka w niej chowa sprawę przed agentem, który nauczył się szarości nie
   czytać. Każda reguła ma więc test, że zapala się, gdy warunek pęka.       */

/** Kubełki zwrotu, w których ktoś u nas ma jeszcze ruch. Reszta to wgląd. */
const ZWROT_W_TOKU: ReadonlySet<Kubelek> = new Set<Kubelek>(["decyzja", "ocena", "zwrot", "korekta"]);

export function zwrotWToku(z: Zwrot): boolean {
  return ZWROT_W_TOKU.has(z.kubelek);
}

/** Dobór w robocie — ktoś (agent albo automat) szuka i jeszcze nie skończył. */
const DOBOR_W_TOKU: ReadonlySet<StatusDoboru> = new Set<StatusDoboru>([
  "extracting_data", "missing_information", "searching", "candidates_found", "requires_expert",
]);

export function doborWToku(s: StatusDoboru): boolean {
  return DOBOR_W_TOKU.has(s);
}

/* ── BRAMKA DOBORU (E) ───────────────────────────────────────────────────────
   Na nagraniu klient ZWRACAŁ nóż 14-25001, kupiony w tym zamówieniu. Dobór
   szukał „noża 16 mm" po wymiarach i pokazał jedenaście kandydatów — świecę
   NGK, sprężynę do gięcia rur, przewody paliwa — a kupionego 14-25001 wśród
   nich nie było. Lista nie była pusta, tylko myląca, a mylący kandydat to
   gorszy wynik niż żaden.

   Towar jest ZNANY, gdy oferta rozmowy jest pozycją jej zamówienia: wtedy
   klient mówi o rzeczy, którą od nas kupił. Szukanie innego towaru zostaje
   możliwe jednym kliknięciem, bo „czy macie zamiennik" też bywa pytaniem —
   ale nie jest już domyślną treścią kolumny.

   Wybór agenta wygrywa z bramką: zatwierdzony kandydat to praca, której nie
   wolno schować za zdaniem „dobór zbędny". */
export function towarZnany(dane: OsRozmowy): boolean {
  const oferta = dane.oferta;
  if (!oferta || !dane.zamowienie || dane.dobor.wybrany) return false;
  if (oferta.zrodlo === "zamowienie") return true;
  return (dane.zamowienie.pobrane?.pozycje ?? [])
    .some((p) => p.offerId !== null && p.offerId === oferta.externalId);
}

/** Pozycji w zamówieniu, gdy jest ich więcej niż jedna i żadna nie jest wskazana. */
export function pozycjiDoWskazania(dane: OsRozmowy): number {
  const n = dane.zamowienie?.pobrane?.pozycje.length ?? 0;
  return !dane.oferta && n > 1 ? n : 0;
}

/* Kody przewoźnika, przy których paczka do klienta NIE idzie zwykłą drogą.
   Awizo, problem i powrót do nadawcy to trzy powody, dla których klient
   pisze „gdzie moja paczka" — i jedyne, przy których odpowiedź wymaga ruchu. */
const PACZKA_ODCHYLENIE: ReadonlySet<string> = new Set(["NOTICE_LEFT", "ISSUE", "RETURNED"]);

export function paczkaOdchylenie(dane: OsRozmowy): boolean {
  const s = dane.zamowienie?.przesylka;
  return Boolean(s?.status && !s.dostarczonoAt && PACZKA_ODCHYLENIE.has(s.status));
}

/**
 * Czy dobór schować za bramką. Towar znany — ale gdy dobór w toku uruchomił
 * CZŁOWIEK, a nie automat, to jego jawna decyzja i bramka jej nie zasłania.
 * Automat podpisuje się `automat (…)` od 0.341.0 (`services/dobor.ts`).
 */
export function bramkaDoboru(dane: OsRozmowy): boolean {
  if (!towarZnany(dane)) return false;
  const kto = dane.dobor.updatedBy;
  const czlowiekSzuka = doborWToku(dane.dobor.status) && kto !== null && !kto.startsWith("automat");
  return !czlowiekSzuka;
}

export type Swiatlo = "zwrot" | "sprawa" | "paczka" | "pozycja" | "dobor";

/**
 * Co świeci, w kolejności pilności. Zwrot i sprawa mają zegar Allegro, więc
 * idą pierwsze; paczka poza zwykłą drogą — za nimi. Wskazanie pozycji
 * i dobór to praca bez terminu.
 */
export function coSwieci(dane: OsRozmowy): Swiatlo[] {
  const s: Swiatlo[] = [];
  if (dane.zwroty.some(zwrotWToku)) s.push("zwrot");
  if (dane.sprawy.some((x) => x.otwarta)) s.push("sprawa");
  /* Paczkę poza zwykłą drogą pokazuje soczewka paczki, gdy stoi (@wydanie).
     Stoi NAD „Wymaga Ciebie", więc druga karta tej samej paczki niżej
     byłaby powtórzeniem, a nie drugim sygnałem. */
  if (paczkaOdchylenie(dane) && !paczkaWSoczewce(dane)) s.push("paczka");
  if (pozycjiDoWskazania(dane) > 0) s.push("pozycja");
  if (doborWToku(dane.dobor.status) && !bramkaDoboru(dane)) s.push("dobor");
  return s;
}

/* ── „OFERTA I TOWAR" OTWARTE DOMYŚLNIE — POZA JEDNYM PRZYPADKIEM ────────────
   Decyzja z 0.198.0 zostaje: oferta i kartoteka stoją razem i bez klikania,
   bo klient pytał kiedyś o gwint, a parametr leżał w niewidocznej zakładce.
   Niewidoczne znaczyło wtedy „nieistniejące".

   Zwija się wyłącznie przy zwrocie albo sprawie w toku. Wtedy temat rozmowy
   to decyzja z terminem, a karta towaru jest tłem, które spychało decyzję
   w połowę przewijania. Dobór w toku niczego nie zwija: szuka się właśnie
   po to, żeby porównać z kartoteką. */
export function towarOtwartyNaStart(swiatla: Swiatlo[], kategoria: Kategoria | null = null): boolean {
  if (swiatla.includes("zwrot") || swiatla.includes("sprawa")) return false;
  /* ── TYLKO PRZY PYTANIU O TOWAR (0.506.0) ────────────────────────────────
     Zgłoszenie agenta: „przytłacza". Na zrzucie klient pisał o odesłaniu
     części, a karta oferty z cenami, EAN i opisem stała otwarta nad
     wszystkim — pasmo nad kolumną mówiło już nazwę, SKU i stan. Powód
     z 0.198.0 (gwint w niewidocznej zakładce) dotyczy pytań O TOWAR, więc
     przy nich karta zostaje otwarta. Bez rozpoznania też: nie wiemy, o co
     pyta klient, a ukrycie byłoby zgadywaniem. */
  return kategoria === null || KATEGORIE_O_TOWAR.has(kategoria);
}

/** Kategorie, przy których odpowiedź leży w karcie towaru (parametry, zgodność, stan). */
const KATEGORIE_O_TOWAR: ReadonlySet<Kategoria> = new Set<Kategoria>([
  "PRODUCT_COMPATIBILITY", "PRODUCT_QUESTION", "PRODUCT_AVAILABILITY", "WRONG_PRODUCT",
  "MISSING_PRODUCT", "DAMAGED_PRODUCT", "OTHER",
]);

/* ── PUSTE WIERSZE „KLIENT" I „WIEDZA" ZNIKAJĄ (@wydanie) ───────────────────
   Decyzja właściciela z 26 września 2026, wbrew wyłączeniu z §26e. Przy
   większości rozmów oba wiersze mówiły tylko „nic tu nie ma": dwa cele po
   44 px, które trzeba przeczytać, żeby się tego dowiedzieć. §26d mówi
   „flagi tylko aktywne", więc wiersz staje dopiero z treścią.

   PRZED ODCZYTEM TEŻ NIE STAJE. Pusty wynik to najczęstszy przypadek, a
   wiersz „wczytuję…", który po chwili znika, to ruch na ekranie za nic.
   Wiersz z treścią pojawia się na dole kolumny, więc niczego nie przesuwa. */

/** Klient ma u nas coś poza tą rozmową — wtedy wiersz „Klient" staje. */
export function klientMaHistorie(h: HistoriaKlienta | undefined): boolean {
  return Boolean(h && (h.wpisy.length > 0 || h.maszyny.length > 0));
}

/**
 * Pierwszy kontakt: login znany, a historii brak. To dalej informacja, więc
 * zamiast wiersza staje jedna krótka linijka. Bez loginu nie wiemy, KTO pisze
 * — „nowy klient" byłby wtedy kłamstwem o kimś, kto kupuje u nas od lat.
 */
export function nowyKlient(h: HistoriaKlienta | undefined): boolean {
  return Boolean(h?.login) && !klientMaHistorie(h);
}

/**
 * Wiersz „Wiedza" ma treść: zatwierdzone zastosowanie albo pomiar z tej
 * rozmowy. Pusty wiersz nie zabiera drogi do dodania wiedzy — jedyny przycisk
 * w nim, „Zaproponuj jako dowód", stoi przy pomiarze, a pomiar wiersz stawia.
 */
export function wiedzaMaTresc(w: WiedzaDoboru | undefined): boolean {
  return Boolean(w && (w.zastosowanie !== null || w.pomiary.length > 0));
}
