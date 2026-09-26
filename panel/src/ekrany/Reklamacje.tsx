import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ShieldQuestion } from "lucide-react";
import {
  useDodajZalacznikSprawy, useNotatka, useOdpowiedz, useOdswiez,
  useRozpoznaj, useSprawdzPrzesylke, useUsunZalacznikSprawy, useZalacznikiSprawy,
  useProwadze, useReklamacja, useReklamacje, useSynchronizuj,
  useWerdykt, useZwrotTowaru, useCofnijNotatke
} from "../api/reklamacje";
import { useJa } from "../api/rozmowy";
import { Konflikt } from "../api/klient";
import { naBase64 } from "../api/plik";
import type {
  KubelekReklamacji, Reklamacja, StanReklamacji, SzczegolyWysylki, WiadomoscReklamacji,
} from "../api/typy";
import { DialogKonfliktu } from "../skrzynka/DialogKonfliktu";
import { Edytor } from "../reklamacje/Edytor";
import { Werdykt, type DecyzjaOTowarze, type ZadanieWerdyktu } from "../reklamacje/Werdykt";
import { Prowadzi } from "../sprawy/Prowadzi";
import { useSzkicSprawy } from "../sprawy/useSzkicSprawy";
import { Blad, FiltrSegmentowy, Karta, Przycisk, Pusto, SIATKA_TRZECH_KOLUMN } from "../ui";
import { KUBELKI, Kolejka } from "../reklamacje/Kolejka";
import { PasekSita, ZdanieOUkrytych, mojaSprawa, useSito, wSicie } from "../sprawy/Moje";
import { PasekPorzadku, posortuj, usePorzadek } from "../sprawy/Porzadek";
import { PasekProgu } from "../sprawy/Prog";
import { PasekTla, tloAlarmuje } from "../sprawy/PasekTla";
import { FiltrTagow, tagiWgLiczby } from "../sprawy/Tagi";
import { SkrotyKlawiszy } from "../sprawy/Skroty";
import { useNowyTag, useOdepnijTag, usePrzypnijTag, useTagi } from "../api/tagi";
import { Czat } from "../reklamacje/Czat";
import { Dowody } from "../reklamacje/Dowody";
import { pasujeDoFrazy, rozbij } from "../sprawy/szukanie";

/* ── Ekran reklamacji (0.222.0, odpowiedź od 0.224.0, werdykt od przyrostu trzeciego) ──
   Trzy kolumny, jak skrzynka i jak zwroty — trzy ekrany obsługi mają mieć
   jeden nawyk, nie trzy.

   OD 0.224.0 ODPOWIEDŹ WYCHODZI STĄD, a od przyrostu trzeciego także WERDYKT
   i stanowisko o towarze — pasek nad rozmową (`reklamacje/Werdykt.tsx`).
   Kryterium §25 „bez otwierania panelu Allegro" jest przy reklamacji spełnione.

   TRZY RODZAJE 409 i każdy każe co innego zrobić: dopisek klienta albo doradcy
   otwiera dialog z jawną zgodą, zamknięta rozmowa kończy temat, a rozjazd
   wersji każe odświeżyć. Rozróżnia je EKRAN, nie hak — ten sam podział co
   w skrzynce, bo tam ta sama sztuczka kosztowała blizna 0.110.0. Stanowisko
   o towarze idzie tą samą kolejką, więc dostaje TEN SAM triage (`dopisek()`),
   a nie drugą kopię.

   Klawiatura DZIAŁA JUŻ TERAZ w tej części, która niczego nie zapisuje:
   strzałki chodzą po kolejce, cyfry przełączają kubełek. Odruch buduje się od
   pierwszego wydania, a nie po dołożeniu zapisu.                            */

/* Statusy synchronizacji po polsku. Słownik z §7 mówi je po angielsku, bo
   dzieli je ze skrzynką i ze zwrotami — a pasek czyta człowiek przy biurku. */
const STANY: Record<StanReklamacji["status"], string> = {
  current: "działa",
  delayed: "opóźniona",
  rate_limited: "wstrzymana limitem Allegro",
  authentication_error: "odmowa logowania do Allegro",
  failed: "nie działa",
};

/**
 * Ile spraw NIE WESZŁO do tej kolejki.
 *
 * Bezpiecznik stron urywa listę cicho: przebieg kończy się sukcesem, a reszta
 * zostaje po tamtej stronie. Kolejka ustawia się według terminu decyzji, więc
 * brakujące wiersze byłyby w większości tymi najbardziej spóźnionymi — czyli
 * dokładnie tymi, dla których ten ekran istnieje.
 *
 * Zero i `null` MILCZĄ: zero znaczy „lista skończyła się sama", `null` — że
 * Allegro nie podało liczby.
 */
function PasekOgona({ stan }: { stan: StanReklamacji }) {
  if (!stan.pozostaloDoPobrania) return null;
  return <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
    <b>Ta kolejka nie jest kompletna: {stan.pozostaloDoPobrania} spraw czeka
      po stronie Allegro.</b>{" "}
    Ostatni przebieg stanął na bezpieczniku stron. Dociągną się kolejnymi
    przebiegami — ale dopóki liczba tu stoi, najstarszych reklamacji może
    w tej liście nie być.
  </div>;
}

/** Pasek synchronizacji z przyciskiem — mówi też, ile dyskusji odsialiśmy. */
function PasekSynchronizacji({ stan, trwa, blad, onSynchronizuj }: {
  stan: StanReklamacji; trwa: boolean; blad: string; onSynchronizuj: () => void;
}) {
  const zle = stan.status !== "current";
  return <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
    px-3 py-2 text-xs ${zle ? "border border-red-200 bg-red-50 text-red-900"
      : "border border-slate-200 bg-slate-50 text-slate-600"}`}>
    <span>Synchronizacja reklamacji: <b>{STANY[stan.status]}</b>
      {stan.kodOstatniegoBledu ? `, kod ${stan.kodOstatniegoBledu}` : ""}</span>
    {/* Liczba odsianych dyskusji NIE JEST błędem — to zakres panelu, decyzja
        właściciela. Stoi tu, żeby nikt nie szukał „zaginionej" reklamacji,
        która nigdy reklamacją nie była. */}
    {stan.dyskusjiPominietych !== null && stan.dyskusjiPominietych > 0 &&
      <span title="Panel prowadzi wyłącznie reklamacje; dyskusje zostają w Allegro">
        dyskusji pominiętych: <b className="tabular-nums">{stan.dyskusjiPominietych}</b></span>}
    {blad && <span className="w-full text-red-800">{blad}</span>}
    <Przycisk className="ml-auto !px-2 !py-1 !text-xs" disabled={trwa} onClick={onSynchronizuj}>
      {trwa ? "Pobieram…" : "Synchronizuj teraz"}
    </Przycisk>
  </div>;
}

/**
 * Dopisek klienta albo doradcy w chwili wysyłki — jedyny 409, który wymaga
 * DECYZJI agenta, więc jedyny z własnym dialogiem. Reszta (zamknięta rozmowa,
 * rozjazd wersji, odmowa Allegro) to zdanie z serwera pod polem.
 */
const dopisek = (e: unknown): SzczegolyWysylki | null =>
  e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).nowaWiadomosc !== undefined
    ? (e.szczegoly as SzczegolyWysylki) : null;

/** Kody, po których człowiek szuka reklamacji — wszystkie, jakie sprawa niesie. */
const kody = (r: Reklamacja) =>
  /* Prowadzący WCHODZI do szukania (0.278.0). Skrzynka szuka po nim od
     0.195.0, a tutaj „gdzie jest sprawa, którą wzięła Ala" nie miało dotąd
     żadnej drogi — ani sita, ani pola. */
  /* NOTATKA WCHODZI DO SZUKANIA (0.394.0). Zgłoszenie właściciela: gdy paczka
     nie dotarła, zgłaszamy to Allegro i dostajemy NUMER SPRAWY, który nie ma
     w naszych danych żadnego własnego pola — ląduje w notatce biura. Pole
     szukało po treści sprawy i po loginie, więc po tym numerze nie znajdowało
     NICZEGO, choć stał on na ekranie obok. Notatka jest zresztą jedynym
     miejscem, gdzie biuro pisze WŁASNYMI słowami; wykluczenie jej z szukania
     znaczyło, że im lepiej ktoś opisał sprawę, tym trudniej ją znaleźć. */
  [r.numer, r.externalId, r.orderId, r.kupujacyLogin, r.prowadzi, r.notatka]
    .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

export function Reklamacje() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<KubelekReklamacji | null>("decyzja");
  const [fraza, setFraza] = useState("");
  const ja = useJa();
  const mojeId = ja.data?.user.userId ?? null;
  const { sito, przelacz: przelaczSito } = useSito();
  /* Reklamacja ma wszystkie cztery osie: termin decyzji i oczekiwaną kwotę
     niosą jej pola z Allegro. Domyślny zostaje TERMIN — to jest kolejność,
     którą ekran miał zaszytą, więc wydanie niczego nie przestawia pod ręką. */
  const { porzadek, ustaw: ustawPorzadek } = usePorzadek(
    "wertis.reklamacje.porzadek", ["termin", "otwarto", "ruch", "kwota"], "termin");
  const [tag, setTag] = useState<number | null>(null);
  const slownikTagow = useTagi();
  const nowyTag = useNowyTag();
  const przypnij = usePrzypnijTag();
  const odepnij = useOdepnijTag();
  const [bladTagu, setBladTagu] = useState("");
  const cofnijNotatke = useCofnijNotatke();
  const [bladZapisu, setBladZapisu] = useState("");
  const [bladSync, setBladSync] = useState("");

  /* Próg daty jest zdejmowany NA ŻĄDANIE i wybór nie przeżywa zamknięcia
     ekranu. Zapamiętanie go w `localStorage` byłoby pułapką: biuro zobaczyłoby
     komplet archiwum po tygodniu i nie wiedziało, czemu. */
  const [bezProgu, setBezProgu] = useState(false);
  const { data, isLoading, error } = useReklamacje(bezProgu);
  const prowadze = useProwadze();
  const notatka = useNotatka();
  const synchronizuj = useSynchronizuj();
  const odpowiedz = useOdpowiedz();
  const odswiez = useOdswiez();
  const dodajZalacznik = useDodajZalacznikSprawy();
  const usunZalacznik = useUsunZalacznikSprawy();
  const rozpoznaj = useRozpoznaj();
  const [bladRozpoznania, setBladRozpoznania] = useState("");
  const sprawdzPrzesylke = useSprawdzPrzesylke();
  const [bladPrzesylki, setBladPrzesylki] = useState("");
  const [bladZalacznika, setBladZalacznika] = useState("");
  const werdykt = useWerdykt();
  const zwrotTowaru = useZwrotTowaru();
  const trwa = prowadze.isPending || notatka.isPending;

  const [bladWysylki, setBladWysylki] = useState("");
  const [konfliktWysylki, setKonfliktWysylki] = useState<SzczegolyWysylki | null>(null);
  const [bladWerdyktu, setBladWerdyktu] = useState("");
  const [bladTowaru, setBladTowaru] = useState("");
  /* Dopisek przy stanowisku o towarze niesie DECYZJĘ i treść, żeby „wyślij
     mimo to" poszło z tym samym zamiarem, a nie z pustym formularzem. */
  const [konfliktTowaru, setKonfliktTowaru] = useState<
    { szczegoly: SzczegolyWysylki; decyzja: DecyzjaOTowarze; tresc: string } | null>(null);

  const wKubelku = useMemo(() => kubelek === null
    ? (data?.reklamacje ?? [])
    : (data?.reklamacje ?? []).filter((r) => r.kubelek === kubelek), [data, kubelek]);

  /* Filtr liczy się TUTAJ, w pamięci ekranu — tą samą drogą co filtr kubełka
     i z tego samego powodu: lista przyjeżdża w całości, bo spraw w pracy są
     dziesiątki, nie tysiące.

     DOPASOWANIE JEST WSPÓLNE dla trzech ekranów obsługi (0.367.0) — ten sam
     `useMemo` stał tu przepisany znak w znak. Od tego wydania fraza dzieli się
     po spacjach i każdy człon musi trafić, więc „numer login" zawęża zamiast
     nie znajdować nic. */
  const pasujace = useMemo(() => {
    if (!rozbij(fraza).length) return null;
    return (data?.reklamacje ?? []).filter((r) => pasujeDoFrazy(kody(r), fraza));
  }, [data, fraza]);

  /* SZUKANIE PRZEBIJA SITO, tak samo jak przebija kubełek (§25a.9). Wpisany
     numer ma znaleźć sprawę także wtedy, gdy prowadzi ją kolega — inaczej pole
     szukania kłamałoby pustką przy sprawie, która jest tuż obok. */
  /* Pigułki tagów liczą skład KUBEŁKA, nie tego, co zostało po sitach.
     Licznik malejący do zera przy każdym kliknięciu mówiłby o własnym
     filtrze, a nie o pracy, która czeka. */
  const wgTagow = useMemo(() => tagiWgLiczby(wKubelku), [wKubelku]);

  const moi = useMemo(
    () => wKubelku.filter((r) => wSicie(r.prowadziId, mojeId, sito)),
    [wKubelku, sito, mojeId]);

  /* Tag NAKŁADA SIĘ na „Moje", a nie zastępuje go: pytania „czyje to"
     i „o czym to" zadaje się naraz, więc odpowiedzi mają się mnożyć,
     nie wykluczać. */
  const poSitach = useMemo(
    () => (tag === null ? moi : moi.filter((r) => r.tagi.some((t) => t.id === tag))),
    [moi, tag]);

  /* ── PORZĄDEK WYBIERA AGENT (0.401.0) ────────────────────────────────────
     Zgłoszenie właściciela: „dodaj sortowanie po dacie etc". Kolejność była
     zaszyta — najpierw termin, potem data otwarcia malejąco — i nie dało się
     jej ruszyć. Sortowanie stoi NA KOŃCU łańcucha, po kubełku, sitach, tagu
     i szukaniu: najpierw ustala się, CO jest na liście, potem w jakiej
     kolejności. Odwrotnie byłoby sortowaniem rzeczy, które i tak odpadną. */
  const widoczne = useMemo(
    () => posortuj(pasujace ?? poSitach, porzadek, {
      otwarto: (r) => r.otwartoAt,
      ruch: (r) => r.ostatniaWiadomoscAt ?? r.otwartoAt,
      termin: (r) => r.decyzjaDo,
      kwota: (r) => r.oczekiwanaKwotaGrosze,
    }),
    [pasujace, poSitach, porzadek]);
  /* Zdanie liczy WYŁĄCZNIE to, co chowa „Moje". Doliczenie tu spraw odsianych
     tagiem byłoby kłamstwem o przyczynie: tag zdejmuje się kliknięciem w tę
     samą pigułkę i widać go na ekranie, a pamiętane „Moje" nie widać. */
  const ukrytych = pasujace || sito === null ? 0 : wKubelku.length - moi.length;
  const wybrana = id ? Number(id) : null;
  /* Szkic stoi ZARAZ ZA numerem sprawy, bo jest do niego przypisany. */
  const { tresc, ustaw: setTresc, wyczysc: wyczyscSzkic } = useSzkicSprawy("reklamacja", wybrana);
  const reklamacja = data?.reklamacje.find((r) => r.id === wybrana) ?? null;
  const szczegol = useReklamacja(wybrana);
  /* Załączniki szkicu wiszą przy SPRAWIE, nie przy przeglądarce —
     odświeżenie karty niczego nie gubi, a kolega widzi to samo. */
  const zalacznikiWysylki = useZalacznikiSprawy(wybrana);

  /* Wejście z paska adresu na sprawę z innego kubełka ma pokazać TĘ sprawę,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (reklamacja && kubelek !== null && reklamacja.kubelek !== kubelek) {
      setKubelek(reklamacja.kubelek);
    }
  }, [reklamacja?.id]);

  /**
   * Przełączenie kubełka PRZESTAWIA TEŻ KURSOR.
   *
   * Bez tego jeden klawisz zmieniałby listę, a zaznaczenie zostawałoby na
   * sprawie z poprzedniego kubełka — środkowa kolumna pokazywałaby wtedy
   * pytanie nowego kubełka nad rozmową ze starego. Ta sama poprawka co przy
   * zwrotach.
   */
  const przelacz = (k: KubelekReklamacji | null) => {
    setKubelek(k);
    setFraza("");
    const pierwsza = (data?.reklamacje ?? []).find((r) => k === null || r.kubelek === k);
    nawiguj(pierwsza ? `/obsluga/reklamacje/${pierwsza.id}` : "/obsluga/reklamacje");
  };

  /* Kursor chodzi po liście WIDOCZNEJ, nie po kubełku: przy włączonym filtrze
     strzałka ma iść do następnego wyniku, a nie do sprawy schowanej przed
     oczami. */
  const idz = (o: number) => {
    if (!widoczne.length) return;
    const i = widoczne.findIndex((r) => r.id === wybrana);
    const nast = widoczne[Math.min(widoczne.length - 1, Math.max(0, (i < 0 ? 0 : i) + o))];
    if (nast) nawiguj(`/obsluga/reklamacje/${nast.id}`);
  };

  /* ── WEJŚCIE W SPRAWĘ JĄ ODŚWIEŻA (0.410.0) ────────────────────────────────
     Zgłoszenie właściciela: „reklamacje w aplikacji mają nieaktualny stan",
     a potem wprost: „możesz po prostu odświeżyć reklamację, jak w nią wejdę?".

     TO JEST ŚWIADOME ZŁAMANIE „ZERO ZAPISU PRZY PATRZENIU" i tak ma być
     zapisane, a nie przemilczane. Reguła stoi w CLAUDE.md, a trasa
     `/odswiez` jest POST-em właśnie po to, żeby łamać ją GŁOŚNO. Decyzja
     właściciela z 19 września 2026 mówi, że nieaktualny stan sprawy kosztuje
     więcej niż żądanie wychodzące przy otwarciu ekranu — i to jest prawda
     mierzalna: przebieg synchronizacji czyta najwyżej tysiąc spraw, więc
     ogona archiwum nie odświeża NIGDY, a nie „za trzy minuty".

     CENA JEST ZNANA I MAŁA. `odswiezSprawe` to JEDNO żądanie do Allegro;
     drugie idzie wyłącznie wtedy, gdy licznik wiadomości rozjechał się
     z tym, co mamy. Przeglądanie kolejki strzałkami zapłaci więc po jednym
     żądaniu za sprawę — dlatego `ostatnioOdswiezona` pilnuje, żeby nie
     powtórzyć go przy każdym renderze ani drugi raz w trybie ścisłym Reacta.

     BŁĄD ZOSTAWIA EKRAN W SPOKOJU (patrz `useOdswiez`): odświeżenie jest
     dopiskiem do tego, co agent i tak widzi, a nie czynnością, o którą
     prosił. Gdy Allegro odmówi, zostaje stan z ostatniego taktu — czyli
     dokładnie to, co było przed tym wydaniem. */
  const ostatnioOdswiezona = useRef<number | null>(null);
  useEffect(() => {
    if (wybrana === null || ostatnioOdswiezona.current === wybrana) return;
    ostatnioOdswiezona.current = wybrana;
    odswiez.mutate({ id: wybrana });
  }, [wybrana]);

  /* ── SZKIC PRZEŻYWA ZMIANĘ SPRAWY (0.423.0) ───────────────────────────────
     Do 0.422.0 stało tu `setTresc("")` i to kasowało napisaną odpowiedź, gdy
     agent przełączył się na sprawę pilniejszą. Broniło przed wyjazdem szkicu
     do cudzej sprawy — i tej obrony nie tracimy: `useSzkicSprawy` przypisuje
     treść do NUMERU sprawy, więc każda ma własną. Czyszczą się tu za to
     wszystkie błędy i konflikty, bo one należą do próby, nie do sprawy. */
  useEffect(() => {
    setBladWysylki("");
    setKonfliktWysylki(null);
    setBladWerdyktu("");
    setBladTowaru("");
    setKonfliktTowaru(null);
  }, [wybrana]);

  /**
   * Ostatnia NIE nasza wiadomość — punkt odniesienia dla kontroli świeżości.
   *
   * Liczy go panel z osi, a serwer sprawdza po swojemu i to on rozstrzyga.
   * Dwie kopie tej reguły są tu świadome: panel musi mieć CO wysłać, zanim
   * serwer powie, czy się zgadza.
   */
  const ostatniaNieNasza = (czat: WiadomoscReklamacji[]): number | null => {
    for (let i = czat.length - 1; i >= 0; i -= 1) {
      if (czat[i].autorRola !== "SELLER") return czat[i].id;
    }
    return null;
  };

  const wyslij = (mimoNowejWiadomosci = false) => {
    const d = szczegol.data;
    if (!d) return;
    setBladWysylki("");
    odpowiedz.mutate({
      id: d.reklamacja.id,
      tresc,
      expectedWersja: d.reklamacja.wersja,
      expectedLastMessageId: ostatniaNieNasza(d.czat),
      mimoNowejWiadomosci,
    }, {
      onSuccess: (w) => {
        setKonfliktWysylki(null);
        if (w.status === "sent") wyczyscSzkic();
        else setBladWysylki(
          "Wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj sprawę, zanim spróbujesz znowu.");
        /* Stan sprawy po stronie Allegro ZMIENIŁ SIĘ przed chwilą, a takt
           przyjdzie za trzy minuty (0.273.0). Przy wyniku niejednoznacznym to
           jedno żądanie rozstrzyga, czy wiadomość poszła — czyli dokładnie to,
           po co pasek odsyłał do Centrum Sprzedaży. */
        odswiez.mutate({ id: d.reklamacja.id });
      },
      onError: (e) => {
        /* Dopisek ma WŁASNY ekran, bo wymaga decyzji. Reszta — zamknięta
           rozmowa, rozjazd wersji, odmowa Allegro — to jedno zdanie pod polem;
           serwer przysyła je gotowe i panel go nie układa od nowa. */
        const d = dopisek(e);
        if (d) setKonfliktWysylki(d);
        else setBladWysylki((e as Error).message);
      },
    });
  };

  /* Werdykt: los próby przychodzi w odpowiedzi, a po `onSettled` sprawa
     dociąga się z kolumnami `werdykt_*` i pasek pokazuje stan z WIERSZA.
     Tu zostaje tylko zdanie o porażce, żeby agent nie czekał na odświeżenie. */
  const wyslijWerdykt = (z: ZadanieWerdyktu) => {
    const d = szczegol.data;
    if (!d) return;
    setBladWerdyktu("");
    werdykt.mutate({ id: d.reklamacja.id, ...z, wersja: d.reklamacja.wersja }, {
      onSuccess: (w) => {
        if (w.status === "send_failed") setBladWerdyktu(w.blad ?? "Allegro odmówiło");
        /* Werdykt zmienia `status_allegro`, a zieleń „Potwierdzony przez
           Allegro" należy się dopiero statusowi z synchronizacji — więc
           dociągamy go od razu, zamiast kazać czekać na takt. */
        odswiez.mutate({ id: d.reklamacja.id });
      },
      onError: (e) => setBladWerdyktu((e as Error).message),
    });
  };

  const wyslijTowar = (decyzja: DecyzjaOTowarze, trescTowaru: string, mimoNowejWiadomosci = false) => {
    const d = szczegol.data;
    if (!d) return;
    setBladTowaru("");
    zwrotTowaru.mutate({
      id: d.reklamacja.id, decyzja, tresc: trescTowaru,
      expectedWersja: d.reklamacja.wersja,
      expectedLastMessageId: ostatniaNieNasza(d.czat),
      mimoNowejWiadomosci,
    }, {
      onSuccess: (w) => {
        setKonfliktTowaru(null);
        if (w.status !== "sent") setBladTowaru(
          "Wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj sprawę, zanim spróbujesz znowu.");
      },
      onError: (e) => {
        const k = dopisek(e);
        if (k) setKonfliktTowaru({ szczegoly: k, decyzja, tresc: trescTowaru });
        else setBladTowaru((e as Error).message);
      },
    });
  };

  /* Skróty milkną, gdy ognisko stoi w polu tekstowym — inaczej cyfra wpisana
     w notatkę przełączałaby kubełek. */
  useEffect(() => {
    const wPolu = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"
        || el.isContentEditable));
    };
    const nasluch = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || wPolu(e.target)) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idz(-1); }
      else if (/^[1-3]$/.test(e.key)) przelacz(KUBELKI[Number(e.key) - 1].id);
      else if (e.key === "4") przelacz(null);
      /* `m` jak „moje" — sito ma być jednym ruchem, bo o to właściciel
         prosił. Litera, nie cyfra: cyfry należą do kubełków i piąta z nich
         obiecywałaby piąty kubełek. */
      else if (e.key === "m" && mojeId !== null) przelaczSito(sito === "moje" ? null : "moje");
      else if (e.key === "n") przelaczSito(sito === "niczyje" ? null : "niczyje");
    };
    window.addEventListener("keydown", nasluch);
    return () => window.removeEventListener("keydown", nasluch);
  });

  if (error) return <Blad>{(error as Error).message}</Blad>;

  const opis = KUBELKI.find((k) => k.id === kubelek);
  const alarmTla = tloAlarmuje({
    prog: data?.prog, zlaSynchronizacja: Boolean(data?.stan && data.stan.status !== "current"),
    pozostaloDoPobrania: data?.stan?.pozostaloDoPobrania ?? null,
  });

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {/* ── TŁO PRACY: JEDEN WIERSZ, DOPÓKI JEST SPOKÓJ (0.392.0) ────────────
        Zgłoszenie właściciela ze zrzutem: „schowaj to gdzieś, zajmuje dużo
        miejsca". Dwie karty pełnej szerokości zjadały nad kolejką około
        dziewięćdziesięciu pikseli na rzeczy, których nikt nie czyta przy
        każdej sprawie.

        ALARM ZOSTAJE GŁOŚNY: gdy próg chowa sprawy z żywym terminem, gdy
        synchronizacja stoi albo gdy lista jest niekompletna, wracają pełne,
        kolorowe paski. Schowanie alarmu byłoby kupieniem pikseli za pracę,
        której nikt nie zobaczy. */}
    {alarmTla
      ? <>
          {data?.prog && <PasekProgu prog={data.prog} onPrzelacz={setBezProgu} />}
          {data?.stan && <PasekOgona stan={data.stan} />}
          {data?.stan && <PasekSynchronizacji stan={data.stan} blad={bladSync}
            trwa={synchronizuj.isPending}
            onSynchronizuj={() => {
              setBladSync("");
              synchronizuj.mutate(undefined,
                { onError: (e) => setBladSync((e as Error).message) });
            }} />}
        </>
      : <PasekTla prog={data?.prog} onPrzelaczProg={setBezProgu}
          /* ── CISZA NIE MA CO MÓWIĆ (0.402.0) ─────────────────────────
             Do 0.401.0 stało tu „synchronizacja: działa" — zdanie, które
             w stanie normalnym jest prawdziwe ZAWSZE i przez to nie niesie
             nic. Zgłoszenie właściciela o chaosie ekranu trafia w to wprost:
             zasada 10 projektu żąda widocznej AWARII, nie widocznego spokoju.

             Zostaje wyłącznie to, co odstaje: stan inny niż `current` (wtedy
             i tak alarmuje `tloAlarmuje`) oraz pominięte dyskusje, których
             liczba jest faktem o niekompletnej liście. Gdy nie ma ani jednego,
             pole jest puste i wiersz kurczy się do samego progu. */
          stanTekst={data?.stan && (data.stan.status !== "current" || data.stan.dyskusjiPominietych)
            ? [
              data.stan.status === "current" ? null
                : `synchronizacja: ${STANY[data.stan.status] ?? data.stan.status}`,
              data.stan.dyskusjiPominietych
                ? `pominiętych dyskusji ${data.stan.dyskusjiPominietych}` : null,
            ].filter(Boolean).join(" · ")
            : undefined}
          trwaSync={synchronizuj.isPending}
          onSynchronizuj={() => {
            setBladSync("");
            synchronizuj.mutate(undefined, { onError: (e) => setBladSync((e as Error).message) });
          }} />}
    {/* Błąd synchronizacji nie chowa się nigdy — także w trybie cichym. */}
    {bladSync && !alarmTla && <p className="px-1 text-podpis text-red-700">{bladSync}</p>}

    <div className={SIATKA_TRZECH_KOLUMN}>
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {/* `shrink-0` na blokach nad listą nie jest kosmetyką: lista ma bazę 0,
            więc przy ciasnym oknie kurczyłyby się WYŁĄCZNIE one. */}
        <nav className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 p-2">
          {/* ── JEDEN KSZTAŁT WYBORU (0.262.0) ─────────────────────────────────
              Ten rząd stał w trzech ekranach przepisany znak w znak, w bursztynie,
              bez tła pigułki niewybranej i bez `aria-pressed`. Kształt jest teraz
              jeden dla całego panelu — powód stoi przy `FiltrSegmentowy`.

              „Wszystkie" WCHODZI DO TABLICY, zamiast wisieć osobnym przyciskiem
              pod pętlą: to jest ten sam wybór, co każdy kubełek, tylko bez
              zawężenia. Numer klawisza liczy się z długości listy, więc dopisanie
              kubełka nie zostawia w podpowiedzi nieaktualnej cyfry. */}
          <FiltrSegmentowy<KubelekReklamacji | null> wybrany={kubelek} onWybierz={przelacz}
            pozycje={[
              ...KUBELKI.map((k, i) => ({ klucz: k.id, etykieta: k.etykieta,
                ile: data?.liczniki?.[k.id] ?? 0,
                podpowiedz: `${k.pytanie} (klawisz ${i + 1})` })),
              { klucz: null, etykieta: "Wszystkie", ile: data?.reklamacje?.length ?? 0,
                podpowiedz: `Wszystkie reklamacje (klawisz ${KUBELKI.length + 1})` },
            ]} />
        </nav>

        {/* ── SIEDEM PASM SCHODZI DO TRZECH (0.402.0) ────────────────────────
            Zgłoszenie właściciela ze zrzutem: „panel wygląda chaotycznie".
            Policzone: nad pierwszą sprawą stało SIEDEM pasm sterowania, 268 px
            w kolumnie szerokiej na 280 — kubełki w dwóch rzędach, kolejność,
            sita, skróty, szukanie i pytanie kubełka. Cztery z nich odpowiadały
            na to samo pytanie „co pokazać", każde w innym kształcie.

            Zostają TRZY: kubełki (wybór), wiersz narzędzi (szukanie, kolejność,
            skróty) i wiersz zawężeń (sita, tagi, próg daty). Nie ubyła ani
            jedna funkcja — ubyły rzędy.

            SZUKANIE STOI PIERWSZE W SWOIM WIERSZU i rośnie na całą wolną
            szerokość: to jedyne pole, do którego się pisze, a reszta wiersza to
            przyciski. */}
        <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 px-2 py-1.5">
          <label className="sr-only" htmlFor="szukaj-reklamacji">Szukaj reklamacji</label>
          <input id="szukaj-reklamacji" className="field min-w-0 flex-1 !py-1 text-xs" value={fraza}
            onChange={(e) => setFraza(e.target.value)}
            placeholder="Numer, zamówienie, login, notatka" />
          <PasekPorzadku porzadek={porzadek}
            dozwolone={["termin", "otwarto", "ruch", "kwota"]} onZmien={ustawPorzadek} />
          <SkrotyKlawiszy zMoje={mojeId !== null} kubelkow={KUBELKI.length} />
        </div>

        {/* ── SITO „MOJE" (0.278.0) ────────────────────────────────────────
            Kubełek mówi „na jakim to etapie", sito „czyje to" — zlanie tego
            w jeden rząd odebrałoby pytanie „moje sprawy do decyzji", czyli
            dokładnie to, które właściciel zadaje najczęściej. Ten rząd niesie
            też czipy tagów („o czym to") i od 0.402.0 próg daty, bo zakres
            listy to trzecie zawężenie tej samej listy, a nie stan systemu. */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1">
          <PasekSita sito={sito} mojeId={mojeId} onPrzelacz={przelaczSito}
            moich={wKubelku.filter((r) => mojaSprawa(r.prowadziId, mojeId)).length}
            niczyich={wKubelku.filter((r) => r.prowadziId === null).length} />
          <FiltrTagow wgLiczby={wgTagow} wybrany={tag} onWybierz={setTag} />
        </div>

        {/* ── PYTANIE KUBEŁKA ZOSTAJE (0.402.0) ──────────────────────────────
            Pierwsze podejście do tej poprawki zdjęło ten wiersz razem z resztą
            pasm. To był błąd: dekalog, punkt 5 — pytanie ZASTĘPUJE menu akcji,
            więc mówi, po co ten kubełek istnieje, a pigułka mówi tylko, jak
            się nazywa. Reguła wygrywa z rachunkiem pikseli.

            Przy włączonym filtrze milknie: lista nie jest wtedy kubełkiem. */}
        {!pasujace && kubelek !== null &&
          <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
            {opis?.pytanie}</p>}

        <ZdanieOUkrytych ile={ukrytych} nazwa={sito === "niczyje" ? "Niczyje" : "Moje"}
          onPokazWszystkie={() => przelaczSito(null)} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading
            ? <Pusto waga="lista">Wczytuję kolejkę…</Pusto>
            : <Kolejka reklamacje={widoczne} wybrana={wybrana}
                mojeId={mojeId}
                zKubelkiem={Boolean(pasujace) || kubelek === null}
                onWybierz={(r) => nawiguj(`/obsluga/reklamacje/${r}`)} />}
        </div>
      </Karta>

      {/* ── TRZY PASY, NIE JEDEN OBSZAR PRZEWIJANIA (0.418.0) ────────────────
          Zgłoszenie właściciela ze zrzutem: „werdykt nie jest przyklejony".
          Cała kolumna przewijała się jako jedna kartka, więc pasek werdyktu
          wędrował z osią i lądował w połowie cudzej wiadomości.

          Teraz nie przewija się NIC poza rozmową: znacznik „prowadzę" stoi
          u góry, pole odpowiedzi i werdykt na dole, a oś płynie między nimi.
          To jest układ okna rozmowy, nie strony — a ta kolumna jest oknem
          rozmowy od 0.224.0. */}
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {/* Kto prowadzi — CZYNNOŚĆ, więc stoi przy innych czynnościach, a nie
            w kolumnie faktów (0.392.0, zgłoszenie właściciela ze zrzutem). */}
        {szczegol.data && <div className="shrink-0 border-b border-slate-200 px-4 py-2">
          <Prowadzi prowadzi={szczegol.data.reklamacja.prowadzi}
          trwa={prowadze.isPending}
          onProwadze={() => {
            setBladZapisu("");
            prowadze.mutate(
              { id: szczegol.data!.reklamacja.id, wersja: szczegol.data!.reklamacja.wersja },
              { onError: (e) => setBladZapisu((e as Error).message) });
          }} /></div>}
        {szczegol.data
          ? <Czat
              sprawa={{
                id: szczegol.data.reklamacja.id,
                /* `powodOpis` PIERWSZY: to zdanie klienta o usterce, a `opis`
                   bywa przy reklamacji pusty. Skleja to wołający, bo tylko on
                   wie, jaki rodzaj sprawy trzyma. */
                opisZgloszenia: szczegol.data.reklamacja.powodOpis ?? szczegol.data.reklamacja.opis,
                wiadomosciIle: szczegol.data.reklamacja.wiadomosciIle,
                czatUrwany: szczegol.data.reklamacja.czatUrwany,
              }}
              czat={szczegol.data.czat}
              zalaczniki={szczegol.data.zalaczniki}
              edytor={<Edytor tresc={tresc} wysyla={odpowiedz.isPending} blad={bladWysylki}
                zalaczniki={zalacznikiWysylki.data?.zalaczniki ?? []}
                dodajeZalacznik={dodajZalacznik.isPending}
                bladZalacznika={bladZalacznika}
                /* Plik czytamy TU, nie w komponencie: katalog `reklamacje/`
                   trzyma komponenty czyste, a base64 to sprawa klienta HTTP. */
                onDodajZalacznik={(plik) => {
                  setBladZalacznika("");
                  void naBase64(plik).then((dane) => {
                    if (!wybrana) return;
                    dodajZalacznik.mutate(
                      { id: wybrana, nazwa: plik.name, typ: plik.type, dane },
                      { onError: (e) => setBladZalacznika((e as Error).message) });
                  });
                }}
                onUsunZalacznik={(zid) => wybrana && usunZalacznik.mutate(
                  { id: wybrana, zalacznikId: zid },
                  { onError: (e) => setBladZalacznika((e as Error).message) })}
                czatAktywny={szczegol.data.reklamacja.czatAktywny}
                onZmiana={setTresc} onWyslij={() => wyslij()} />} />
          : <div className="flex min-h-0 flex-1 items-center px-4">
              <Pusto ikona={ShieldQuestion}>
                {wybrana ? "Wczytuję sprawę…" : "Wybierz reklamację z kolejki po lewej"}
              </Pusto>
            </div>}

        {/* ── WERDYKT POD ROZMOWĄ (0.412.0) ────────────────────────────────
            Do 0.411.0 pasek werdyktu stał PIERWSZY w tej kolumnie — nad
            treścią zgłoszenia, którego dotyczy. Uzasadnienie („rozstrzygnięcie
            całej sprawy stoi wyżej niż jej ostatnia wiadomość") było spójne,
            ale mierzyło ważność, a nie kolejność czytania.

            Dekalog obsługi, punkt 9: nieodwracalne pyta. UZNAJĘ i ODRZUCAM są
            nieodwracalne wobec Allegro — drugiego werdyktu w tej samej sprawie
            nikt nie przyjmie. Ekran zadawał więc pytanie, zanim pokazał
            cokolwiek, z czego wynika odpowiedź. Dekalog ergonomii, punkt 5:
            aplikacja prowadzi człowieka, nie odwrotnie.

            NIC NIE ZNIKA: pasek jest tam, gdzie kończy się czytanie sprawy.
            Zgoda przed wysłaniem zostaje przy OBU gałęziach — uznanie kosztuje
            pieniądze i jest równie nieodwracalne co odmowa. */}
        {szczegol.data && <div className="shrink-0"><Werdykt reklamacja={szczegol.data.reklamacja}
          czat={szczegol.data.czat} trwa={werdykt.isPending} blad={bladWerdyktu}
          trwaTowar={zwrotTowaru.isPending} bladTowaru={bladTowaru}
          onWerdykt={wyslijWerdykt} onTowar={(dec, t) => wyslijTowar(dec, t)} /></div>}
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-y-auto">
        {szczegol.data
          ? <Dowody szczegol={szczegol.data} trwa={trwa} bladZapisu={bladZapisu}
              onCofnijNotatke={szczegol.data.reklamacja.maPoprzedniaNotatke
                ? () => {
                  setBladZapisu("");
                  cofnijNotatke.mutate(
                    { id: szczegol.data!.reklamacja.id, wersja: szczegol.data!.reklamacja.wersja },
                    { onError: (e) => setBladZapisu((e as Error).message) });
                }
                : undefined}
              tagi={{
                slownik: slownikTagow.data?.tagi ?? [],
                trwa: nowyTag.isPending || przypnij.isPending || odepnij.isPending,
                blad: bladTagu,
                onPrzypnij: (tagId) => {
                  setBladTagu("");
                  przypnij.mutate({ id: szczegol.data!.reklamacja.id, rodzaj: "reklamacje", tagId },
                    { onError: (e) => setBladTagu((e as Error).message) });
                },
                onOdepnij: (tagId) => {
                  setBladTagu("");
                  odepnij.mutate({ id: szczegol.data!.reklamacja.id, rodzaj: "reklamacje", tagId },
                    { onError: (e) => setBladTagu((e as Error).message) });
                },
                onNowy: (nazwa) => {
                  setBladTagu("");
                  nowyTag.mutate({ id: szczegol.data!.reklamacja.id, rodzaj: "reklamacje", nazwa },
                    { onError: (e) => setBladTagu((e as Error).message) });
                },
              }}
              sprawdzaPrzesylke={sprawdzPrzesylke.isPending}
              bladPrzesylki={bladPrzesylki}
              onSprawdzPrzesylke={() => {
                setBladPrzesylki("");
                sprawdzPrzesylke.mutate({ id: szczegol.data!.reklamacja.id },
                  { onError: (e) => setBladPrzesylki((e as Error).message) });
              }}
              rozpoznaje={rozpoznaj.isPending}
              bladRozpoznania={bladRozpoznania}
              onRozpoznaj={() => {
                setBladRozpoznania("");
                rozpoznaj.mutate({ id: szczegol.data!.reklamacja.id },
                  { onError: (e) => setBladRozpoznania((e as Error).message) });
              }}
              onNotatka={(tekst) => {
                setBladZapisu("");
                notatka.mutate({
                  id: szczegol.data!.reklamacja.id, notatka: tekst,
                  wersja: szczegol.data!.reklamacja.wersja,
                }, { onError: (e) => setBladZapisu((e as Error).message) });
              }} />
          : <Pusto waga="lista">
              Dowody o sprawie pokażą się po wybraniu reklamacji.</Pusto>}
      </Karta>
    </div>

    {/* Jawna zgoda po dopisku — dialog ze skrzynki, bez kopiowania. Autora
        nazywa `ktoDopisal`, bo przy reklamacji bywa nim doradca Allegro,
        a nie kupujący. */}
    {konfliktWysylki && <DialogKonfliktu
      szczegoly={konfliktWysylki}
      szkic={tresc}
      wysyla={odpowiedz.isPending}
      blad={bladWysylki}
      ktoDopisal={konfliktWysylki.nowaWiadomosc?.rola === "ADMIN"
        ? "doradca Allegro" : "klient"}
      onWyslijMimoTo={() => wyslij(true)}
      onPopraw={() => setKonfliktWysylki(null)} />}

    {/* Ten sam dialog przy stanowisku o towarze — to ta sama kolejka i ten
        sam rodzaj konfliktu, więc drugiego okna nie ma. */}
    {konfliktTowaru && <DialogKonfliktu
      szczegoly={konfliktTowaru.szczegoly}
      szkic={konfliktTowaru.tresc}
      wysyla={zwrotTowaru.isPending}
      blad={bladTowaru}
      ktoDopisal={konfliktTowaru.szczegoly.nowaWiadomosc?.rola === "ADMIN"
        ? "doradca Allegro" : "klient"}
      onWyslijMimoTo={() => wyslijTowar(konfliktTowaru.decyzja, konfliktTowaru.tresc, true)}
      onPopraw={() => setKonfliktTowaru(null)} />}
  </div>;
}
