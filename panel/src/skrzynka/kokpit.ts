import type { HistoriaKlienta, Kategoria, Kubelek, OsRozmowy, StanPrzesylki, Zwrot } from "../api/typy";
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

/** Pozycji w zamówieniu, gdy jest ich więcej niż jedna i żadna nie jest wskazana. */
export function pozycjiDoWskazania(dane: OsRozmowy): number {
  const n = dane.zamowienie?.pobrane?.pozycje.length ?? 0;
  return !dane.oferta && n > 1 ? n : 0;
}

/* Kody przewoźnika, przy których paczka do klienta NIE idzie zwykłą drogą.
   Awizo, problem i powrót do nadawcy to trzy powody, dla których klient
   pisze „gdzie moja paczka" — i jedyne, przy których odpowiedź wymaga ruchu. */
const PACZKA_ODCHYLENIE: ReadonlySet<string> = new Set(["NOTICE_LEFT", "ISSUE", "RETURNED"]);

/**
 * Ta sama reguła na samym stanie przesyłki. Blok paczki dostaje zamówienie,
 * nie całą oś rozmowy, a barwa jego zdania musi zapalać się dokładnie wtedy,
 * kiedy paczka świeci w „Wymaga Ciebie". Dwie kopie warunku rozjechałyby się.
 */
export function odchyleniePrzesylki(s: StanPrzesylki | null | undefined): boolean {
  return Boolean(s?.status && !s.dostarczonoAt && PACZKA_ODCHYLENIE.has(s.status));
}

export function paczkaOdchylenie(dane: OsRozmowy): boolean {
  return odchyleniePrzesylki(dane.zamowienie?.przesylka);
}

/**
 * Paczka stoi NAD wierszem „Zamówienie": w soczewce albo w „Wymaga Ciebie".
 * Wtedy wiersz jej nie powtarza, bo ten sam stan w dwóch miejscach kolumny
 * kazał sprawdzać, czy oba mówią to samo.
 */
export function paczkaWyzej(dane: OsRozmowy): boolean {
  return paczkaWSoczewce(dane) || paczkaOdchylenie(dane);
}

/**
 * Któraś pozycja nie jest ofertą rozmowy, więc jej kartoteki nie pokazuje
 * „Oferta i towar". Wtedy kolumna listuje pozycje, bo kartoteka takiej
 * pozycji nie ma innego domu. Pozycja bez numeru oferty też się liczy.
 */
export function pozycjeWKolumnie(dane: OsRozmowy): boolean {
  const p = dane.zamowienie?.pobrane?.pozycje ?? [];
  const o = dane.oferta?.externalId ?? null;
  return p.some((x) => x.offerId === null || x.offerId !== o);
}

/**
 * Karta zakupu pokazuje tytuł, SKU i zdjęcie tej oferty. Wtedy kolumna ich
 * nie powtarza, bo drugi dom faktu kazał porównywać dwa miejsca. Bez pozycji
 * karta mówi o ofercie, gdy jej treść jest pobrana; inaczej nie ma czego.
 */
export function ofertaWKarcie(dane: OsRozmowy): boolean {
  const o = dane.oferta;
  if (!o) return false;
  const p = dane.zamowienie?.pobrane?.pozycje ?? [];
  return p.length > 0 ? p.some((x) => x.offerId === o.externalId) : o.pobrana !== null;
}

/* ── HISTORIA BEZ TEGO ZAKUPU ────────────────────────────────────────────────
   Serwer (`klient-historia.ts`) pomija w historii tylko bieżącą rozmowę.
   Klient z jedynym zakupem dostawał więc „Wcześniej u nas: 1 zakup" o tym
   samym zakupie, o który właśnie pisze. Zakup, jego zwrot, reklamacja
   i dyskusja niosą numer zamówienia rozmowy i mają dom w karcie zakupu.

   Rozmowy zostają: inna rozmowa to wcześniejszy kontakt, a nie ten zakup.
   Serwer daje im dziś pusty numer zamówienia, a człon `rodzaj === "rozmowa"`
   trzyma regułę także wtedy, gdy zacznie go podawać. Gdy serwer zacznie
   pomijać zakup sam, funkcja nic nie zmieni, bo nie znajdzie czego wyciąć. */
export function historiaPozaZakupem(h: HistoriaKlienta | undefined, zamowienieId: string | null):
  HistoriaKlienta | undefined {
  if (!h || !zamowienieId) return h;
  return { ...h, wpisy: h.wpisy.filter((w) => w.rodzaj === "rozmowa" || w.zamowienieId !== zamowienieId) };
}

/**
 * Wiersz „Klient" staje, gdy poza tym zakupem jest coś do powiedzenia:
 * inny wpis albo sprawa klienta. Sprawa liczy się także bez loginu,
 * bo serwer bierze jej login z zamówienia, a rozmowa ma do niej odsyłać.
 */
export function klientWKolumnie(h: HistoriaKlienta | undefined, zamowienieId: string | null,
  zakupyNaLiscie?: ReadonlySet<string>): boolean {
  const p = historiaWierszaKlienta(h, zamowienieId, zakupyNaLiscie);
  return Boolean(p && (p.wpisy.length > 0 || p.sprawa));
}

/**
 * Historia, którą mówi wiersz „Klient": bez tego zakupu, a w rozmowie BEZ
 * zamówienia także bez zakupów z listy „Zakupy tego klienta". Ta lista stoi
 * wtedy otwarta w wierszu „Zamówienie" i z niej się wiąże zakup z rozmową,
 * więc to jej dom. Przy powiązanym zamówieniu lista chowa się za „to nie ta
 * paczka?", bo służy do przepięcia, a nie do czytania. Wycięte z historii
 * nie stałyby wtedy nigdzie na widoku, więc zostają.
 *
 * Wiersz staje i streszcza się z TEJ historii, nie z pełnej. Inaczej stawałby
 * dla wpisów, których pod nim nie ma, i podawał datę zakupu, którego nie widać.
 */
export function historiaWierszaKlienta(h: HistoriaKlienta | undefined, zamowienieId: string | null,
  zakupyNaLiscie?: ReadonlySet<string>): HistoriaKlienta | undefined {
  const poza = historiaPozaZakupem(h, zamowienieId);
  if (!poza || zamowienieId !== null || !zakupyNaLiscie?.size) return poza;
  return { ...poza, wpisy: poza.wpisy.filter((w) =>
    !(w.rodzaj === "zakup" && w.zamowienieId !== null && zakupyNaLiscie.has(w.zamowienieId))) };
}

export type Swiatlo = "zwrot" | "sprawa" | "paczka" | "pozycja";

/**
 * Co świeci, w kolejności pilności. Zwrot i sprawa mają zegar Allegro, więc
 * idą pierwsze; paczka poza zwykłą drogą — za nimi. Wskazanie pozycji
 * to praca bez terminu.
 */
export function coSwieci(dane: OsRozmowy): Swiatlo[] {
  const s: Swiatlo[] = [];
  if (dane.zwroty.some(zwrotWToku)) s.push("zwrot");
  if (dane.sprawy.some((x) => x.otwarta)) s.push("sprawa");
  /* Paczkę poza zwykłą drogą pokazuje soczewka paczki, gdy stoi (0.531.0).
     Stoi NAD „Wymaga Ciebie", więc druga karta tej samej paczki niżej
     byłaby powtórzeniem, a nie drugim sygnałem. */
  if (paczkaOdchylenie(dane) && !paczkaWSoczewce(dane)) s.push("paczka");
  if (pozycjiDoWskazania(dane) > 0) s.push("pozycja");
  return s;
}

/* ── „OFERTA I TOWAR" OTWARTE DOMYŚLNIE — POZA JEDNYM PRZYPADKIEM ────────────
   Decyzja z 0.198.0 zostaje: oferta i kartoteka stoją razem i bez klikania,
   bo klient pytał kiedyś o gwint, a parametr leżał w niewidocznej zakładce.
   Niewidoczne znaczyło wtedy „nieistniejące".

   Zwija się wyłącznie przy zwrocie albo sprawie w toku. Wtedy temat rozmowy
   to decyzja z terminem, a karta towaru jest tłem, które spychało decyzję
   w połowę przewijania. */
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

/* ── PUSTY WIERSZ „KLIENT" ZNIKA (0.531.0) ─────────────────────────────────
   Decyzja właściciela z 26 września 2026, wbrew wyłączeniu z §26e. Przy
   większości rozmów wiersz mówił tylko „nic tu nie ma": cel 44 px, który
   trzeba przeczytać, żeby się tego dowiedzieć. §26d mówi
   „flagi tylko aktywne", więc wiersz staje dopiero z treścią.

   PRZED ODCZYTEM TEŻ NIE STAJE. Pusty wynik to najczęstszy przypadek, a
   wiersz „wczytuję…", który po chwili znika, to ruch na ekranie za nic.
   Wiersz z treścią pojawia się na dole kolumny, więc niczego nie przesuwa. */

/**
 * Klient ma u nas coś poza tą rozmową — wtedy karta zakupu mówi „Wcześniej
 * u nas". O wierszu „Klient" rozstrzyga `klientWKolumnie`, bo ten liczy też
 * sprawę klienta.
 */
export function klientMaHistorie(h: HistoriaKlienta | undefined): boolean {
  return Boolean(h && h.wpisy.length > 0);
}

/**
 * Pierwszy kontakt: login znany, a historii brak. To dalej informacja, więc
 * staje plakietką w karcie zakupu, także zwiniętej i w pasku nad osią. Bez
 * loginu nie wiemy, KTO pisze — „nowy klient" byłby wtedy kłamstwem o kimś,
 * kto kupuje u nas od lat.
 */
export function nowyKlient(h: HistoriaKlienta | undefined): boolean {
  return Boolean(h?.login) && !klientMaHistorie(h);
}
