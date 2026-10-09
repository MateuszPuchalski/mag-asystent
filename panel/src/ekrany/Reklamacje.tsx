import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search, ShieldQuestion } from "lucide-react";
import {
  useCofnijNotatkeReklamacji, useDodajZalacznikSprawy, useNotatkaReklamacji, useOdpowiedz,
  useOdswiez, useProwadze, useReklamacja, useReklamacje, useSprawdzPrzesylke, useSynchronizuj,
  useUsunZalacznikSprawy, useWerdykt, useZalacznikiSprawy, useZwrotTowaru,
} from "../api/reklamacje";
import { useJa } from "../api/rozmowy";
import { Konflikt } from "../api/klient";
import { naBase64 } from "../api/plik";
import type {
  KubelekReklamacji, Reklamacja, SzczegolyWysylki, WiadomoscReklamacji,
} from "../api/typy";
import { DialogKonfliktu } from "../skrzynka/DialogKonfliktu";
import { Edytor } from "../reklamacje/Edytor";
import { Werdykt, type DecyzjaOTowarze, type ZadanieWerdyktu } from "../reklamacje/Werdykt";
import { useSzkicSprawy } from "../sprawy/useSzkicSprawy";
import { Blad, Karta, Pusto } from "../ui";
import { KUBELKI, Kolejka, kwotaWiersza, liniaPowodu, wGrupach } from "../reklamacje/Kolejka";
import { PasekSita, ZdanieOUkrytych, mojaSprawa, useSito, wSicie } from "../sprawy/Moje";
import { posortuj, usePorzadek, type OsPorzadku } from "../sprawy/Porzadek";
import { PasekProgu } from "../sprawy/Prog";
import { tagiWgLiczby } from "../sprawy/Tagi";
import { Czat } from "../reklamacje/Czat";
import { Glowica } from "../reklamacje/Glowica";
import { DrogaSprawy } from "../reklamacje/DrogaSprawy";
import { zdarzeniaPrzesylek } from "../reklamacje/przesylki";
import { Kafle } from "../reklamacje/Kafle";
import { PrzelacznikKubelkow } from "../reklamacje/Przelacznik";
import { FiltrKolejki } from "../reklamacje/Filtr";
import { Produkt } from "../reklamacje/Produkt";
import { Notatka } from "../reklamacje/Notatka";
import { pasujeDoFrazy, rozbij } from "../sprawy/szukanie";
import { klawiszZajety } from "../nawigacja/fokus";

/* ── Ekran reklamacji: kafle i trzy kolumny ──────────────────────────────────
   Na górze cztery liczby dnia i stan synchronizacji. Pod nimi kolejka,
   sprawa i decyzja. Kolejka po lewej, bo od niej zaczyna się każda praca.
   Sprawa w środku rośnie, bo rozmowę czyta się najdłużej. Decyzja z faktami
   stoi po prawej, bo nieodwracalne pytanie zadaje się PO rozmowie.

   UKŁAD ŁAMIE SIĘ W DÓŁ, NIE W BOK. Na szerokim oknie każda kolumna przewija
   się osobno, a na wąskim albo przy powiększeniu 200% kolumny spadają pod
   siebie i przewija się cały ekran. Nic nie wychodzi za kadr (WCAG 1.4.4).

   TRZY RODZAJE 409 i każdy każe co innego zrobić: dopisek klienta albo doradcy
   otwiera dialog z jawną zgodą, zamknięta rozmowa kończy temat, a rozjazd
   wersji każe odświeżyć. Rozróżnia je EKRAN, nie hak — ten sam podział co
   w skrzynce. Stanowisko o towarze dostaje TEN SAM triage (`dopisek()`).

   Klawiatura działa bez podpowiedzi na ekranie: strzałki i j/k chodzą po
   kolejce, cyfry przełączają kubełek, m i n — sito. Podpowiedzi nie stoją,
   bo skrót zna się z odruchu, a ich miejsce należy do listy. */

/* Na szerokim oknie trzy kolumny w siatce, każda z własnym przewijaniem.
   Poniżej `xl` ten sam kontener jest flexem z zawijaniem, więc kolumny same
   spadają pod siebie, a sprawa bierze resztę szerokości. */
const UKLAD = "flex flex-wrap items-start gap-4 "
  + "xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[22rem_minmax(0,1fr)_22rem] "
  + "xl:grid-rows-[minmax(0,1fr)] xl:items-stretch 2xl:grid-cols-[24rem_minmax(0,1fr)_24rem]";
const KOLUMNA = "min-w-0 xl:min-h-0";
const KARTA = "rounded-xl border border-slate-200 bg-white shadow-sm";

/* Niepewny los stanowiska o towarze. Serwer drugiego nie wyśle, a nic
   w panelu tej próby nie rozstrzyga, więc zdanie wskazuje Centrum Sprzedaży
   zamiast synchronizacji, która blokady nie zdejmie. */
const TOWAR_NIEPEWNY = "Stanowisko o towarze mogło nie dojść do kupującego. "
  + "Sprawdź w Centrum Sprzedaży, czy je dostał — panel drugiego nie wyśle.";

/** Osie porządku tej kolejki; pierwsza jest domyślna. */
const OSIE: OsPorzadku[] = ["termin", "otwarto", "ruch", "kwota"];

/* Porządek słowami pod przełącznikiem kubełków. Wybiera się go w filtrze,
   a zdanie mówi bez otwierania filtra, w jakiej kolejności stoi lista. */
const OPIS_PORZADKU: Partial<Record<OsPorzadku, string>> = {
  termin: "Najpilniejsze na górze",
  otwarto: "Najnowsze na górze",
  ruch: "Ostatni ruch na górze",
  kwota: "Najdroższe na górze",
};

/**
 * Dopisek klienta albo doradcy w chwili wysyłki — jedyny 409, który wymaga
 * DECYZJI agenta, więc jedyny z własnym dialogiem. Reszta (zamknięta rozmowa,
 * rozjazd wersji, odmowa Allegro) to zdanie z serwera pod polem.
 */
const dopisek = (e: unknown): SzczegolyWysylki | null =>
  e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).nowaWiadomosc !== undefined
    ? (e.szczegoly as SzczegolyWysylki) : null;

/**
 * Kody, po których człowiek szuka reklamacji — wszystkie, jakie sprawa niesie.
 *
 * Prowadzący, bo „gdzie jest sprawa, którą wzięła Ala” nie ma innej drogi.
 * Notatka, bo numer sprawy u Allegro nie ma własnego pola i ląduje tam.
 * Login i nazwa oferty, bo stoją na wierszu: pole, które nie znajduje tego,
 * co widać na liście, kłamałoby.
 */
const kody = (r: Reklamacja) =>
  [r.numer, r.externalId, r.orderId, r.kupujacyLogin, r.prowadzi, r.notatka, r.ofertaNazwa]
    .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

/**
 * Ostatnia NIE nasza wiadomość — punkt odniesienia dla kontroli świeżości.
 *
 * Liczy go panel z osi, a serwer sprawdza po swojemu i to on rozstrzyga.
 * Panel musi mieć CO wysłać, zanim serwer powie, czy się zgadza.
 */
const ostatniaNieNasza = (czat: WiadomoscReklamacji[]): number | null => {
  for (let i = czat.length - 1; i >= 0; i -= 1) {
    if (czat[i].autorRola !== "SELLER") return czat[i].id;
  }
  return null;
};

export function Reklamacje() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<KubelekReklamacji | null>("decyzja");
  const [fraza, setFraza] = useState("");
  const ja = useJa();
  const mojeId = ja.data?.user.userId ?? null;
  const { sito, przelacz: przelaczSito } = useSito();
  /* Domyślny porządek to TERMIN — kolejność, którą ekran miał zawsze. */
  const { porzadek, ustaw: ustawPorzadek } = usePorzadek("wertis.reklamacje.porzadek", OSIE, "termin");
  const [tag, setTag] = useState<number | null>(null);
  const [bladSync, setBladSync] = useState("");

  /* Próg daty zdejmuje się NA ŻĄDANIE i wybór nie przeżywa zamknięcia
     ekranu. Zapamiętany w przeglądarce pokazałby po tygodniu całe archiwum
     bez śladu, skąd się wzięło. */
  const [bezProgu, setBezProgu] = useState(false);
  const { data, isLoading, error } = useReklamacje(bezProgu);
  const prowadze = useProwadze();
  const synchronizuj = useSynchronizuj();
  const odpowiedz = useOdpowiedz();
  const odswiez = useOdswiez();
  const dodajZalacznik = useDodajZalacznikSprawy();
  const usunZalacznik = useUsunZalacznikSprawy();
  const sprawdzPrzesylke = useSprawdzPrzesylke();
  const werdykt = useWerdykt();
  const zwrotTowaru = useZwrotTowaru();
  const notatka = useNotatkaReklamacji();
  const cofnijNotatke = useCofnijNotatkeReklamacji();
  const [bladPrzesylki, setBladPrzesylki] = useState("");
  const [bladZalacznika, setBladZalacznika] = useState("");
  const [bladProwadze, setBladProwadze] = useState("");
  const [bladNotatki, setBladNotatki] = useState("");
  const [bladWysylki, setBladWysylki] = useState("");
  const [konfliktWysylki, setKonfliktWysylki] = useState<SzczegolyWysylki | null>(null);
  const [bladWerdyktu, setBladWerdyktu] = useState("");
  const [bladTowaru, setBladTowaru] = useState("");
  /* Dopisek przy stanowisku o towarze niesie DECYZJĘ i treść, żeby „wyślij
     mimo to” poszło z tym samym zamiarem, a nie z pustym formularzem. */
  const [konfliktTowaru, setKonfliktTowaru] = useState<
    { szczegoly: SzczegolyWysylki; decyzja: DecyzjaOTowarze; tresc: string } | null>(null);

  const wKubelku = useMemo(() => kubelek === null
    ? (data?.reklamacje ?? [])
    : (data?.reklamacje ?? []).filter((r) => r.kubelek === kubelek), [data, kubelek]);

  /* Filtry liczą się w pamięci ekranu: lista przyjeżdża w całości, bo spraw
     w pracy są dziesiątki, nie tysiące. Fraza dzieli się po spacjach i każdy
     człon musi trafić, więc „numer login” zawęża zamiast nie znajdować nic. */
  const pasujace = useMemo(() => {
    if (!rozbij(fraza).length) return null;
    return (data?.reklamacje ?? []).filter((r) => pasujeDoFrazy(kody(r), fraza));
  }, [data, fraza]);

  /* Tagi liczą skład KUBEŁKA, nie tego, co zostało po sitach. Licznik
     malejący przy każdym kliknięciu mówiłby o filtrze, a nie o pracy. */
  const wgTagow = useMemo(() => tagiWgLiczby(wKubelku), [wKubelku]);

  const moi = useMemo(
    () => wKubelku.filter((r) => wSicie(r.prowadziId, mojeId, sito)),
    [wKubelku, sito, mojeId]);

  /* Tag NAKŁADA SIĘ na sito: pytania „czyje to” i „o czym to” zadaje się
     naraz, więc odpowiedzi mają się mnożyć, nie wykluczać. */
  const poSitach = useMemo(
    () => (tag === null ? moi : moi.filter((r) => r.tagi.some((t) => t.id === tag))),
    [moi, tag]);

  /* SZUKANIE PRZEBIJA SITO I KUBEŁEK (§25a.9): wpisany numer ma znaleźć
     sprawę także wtedy, gdy prowadzi ją kolega.

     Sortowanie stoi NA KOŃCU łańcucha: najpierw ustala się, CO jest na liście,
     potem w jakiej kolejności. Grupa „Po terminie” idzie po sortowaniu, bo
     strzałki chodzą po tej samej tablicy, którą rysuje kolejka. */
  const widoczne = useMemo(
    () => wGrupach(posortuj(pasujace ?? poSitach, porzadek, {
      otwarto: (r) => r.otwartoAt,
      ruch: (r) => r.ostatniaWiadomoscAt ?? r.otwartoAt,
      termin: (r) => r.decyzjaDo,
      kwota: kwotaWiersza,
    })),
    [pasujace, poSitach, porzadek]);
  /* Zdanie liczy WYŁĄCZNIE to, co chowa sito. Tag widać w zdaniu obok,
     a pamiętanego sita nie widać nigdzie indziej. */
  const ukrytych = pasujace || sito === null ? 0 : wKubelku.length - moi.length;
  const wybrana = id ? Number(id) : null;
  /* Szkic stoi ZARAZ ZA numerem sprawy, bo jest do niego przypisany. */
  const { tresc, ustaw: setTresc, wyczysc: wyczyscSzkic } = useSzkicSprawy("reklamacja", wybrana);
  const reklamacja = data?.reklamacje.find((r) => r.id === wybrana) ?? null;
  const szczegol = useReklamacja(wybrana);
  /* Załączniki szkicu wiszą przy SPRAWIE, nie przy przeglądarce. */
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
   * Bez tego lista by się zmieniła, a zaznaczenie zostałoby na sprawie
   * z poprzedniego kubełka — środek pokazywałby rozmowę spoza listy.
   */
  const przelacz = (k: KubelekReklamacji | null) => {
    setKubelek(k);
    setFraza("");
    const pierwsza = (data?.reklamacje ?? []).find((r) => k === null || r.kubelek === k);
    nawiguj(pierwsza ? `/obsluga/reklamacje/${pierwsza.id}` : "/obsluga/reklamacje");
  };

  /* Kursor chodzi po liście WIDOCZNEJ, nie po kubełku: przy filtrze strzałka
     idzie do następnego wyniku, a nie do sprawy schowanej przed oczami. */
  const idz = (o: number) => {
    if (!widoczne.length) return;
    const i = widoczne.findIndex((r) => r.id === wybrana);
    const nast = widoczne[Math.min(widoczne.length - 1, Math.max(0, (i < 0 ? 0 : i) + o))];
    if (nast) nawiguj(`/obsluga/reklamacje/${nast.id}`);
  };

  /* ── WEJŚCIE W SPRAWĘ JĄ ODŚWIEŻA ──────────────────────────────────────────
     Świadomy wyjątek od „zera zapisu przy patrzeniu”, decyzją właściciela.
     Przebieg synchronizacji czyta najwyżej tysiąc spraw, więc ogona archiwum
     nie odświeża nigdy, a agent patrzy na sprawę teraz. Trasa `/odswiez` jest
     POST-em po to, żeby ten wyjątek był GŁOŚNY.

     Jedno żądanie na sprawę: `ostatnioOdswiezona` pilnuje, żeby nie powtórzyć
     go przy renderze ani drugi raz w trybie ścisłym Reacta. Błąd zostawia
     ekran w spokoju, bo odświeżenie jest dopiskiem, nie czynnością agenta. */
  const ostatnioOdswiezona = useRef<number | null>(null);
  useEffect(() => {
    if (wybrana === null || ostatnioOdswiezona.current === wybrana) return;
    ostatnioOdswiezona.current = wybrana;
    odswiez.mutate({ id: wybrana });
  }, [wybrana]);

  /* Szkic przeżywa zmianę sprawy, bo `useSzkicSprawy` przypisuje treść do
     NUMERU sprawy. Czyszczą się błędy i konflikty: należą do próby, nie do
     sprawy. */
  useEffect(() => {
    setBladWysylki("");
    setKonfliktWysylki(null);
    setBladWerdyktu("");
    setBladTowaru("");
    setKonfliktTowaru(null);
    setBladProwadze("");
    setBladPrzesylki("");
    setBladNotatki("");
  }, [wybrana]);

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
        /* Stan sprawy u Allegro zmienił się przed chwilą, a takt przyjdzie za
           trzy minuty. Przy wyniku niejednoznacznym to jedno żądanie
           rozstrzyga, czy wiadomość poszła. */
        odswiez.mutate({ id: d.reklamacja.id });
      },
      onError: (e) => {
        /* Dopisek ma WŁASNY ekran, bo wymaga decyzji. Reszta to jedno zdanie
           pod polem, które serwer przysyła gotowe. */
        const k = dopisek(e);
        if (k) setKonfliktWysylki(k);
        else setBladWysylki((e as Error).message);
      },
    });
  };

  /* Werdykt: los próby przychodzi w odpowiedzi, a po `onSettled` sprawa
     dociąga się z kolumnami `werdykt_*`. Tu zostaje tylko zdanie o porażce.

     STANOWISKO O TOWARZE jedzie tym samym żądaniem, a jego los w polu
     `towar`. Werdykt wyszedł nieodwracalnie, więc porażka towaru nie jest
     porażką werdyktu: dopisek otwiera ten sam dialog, reszta to zdanie. */
  const wyslijWerdykt = (z: ZadanieWerdyktu) => {
    const d = szczegol.data;
    if (!d) return;
    setBladWerdyktu("");
    setBladTowaru("");
    setKonfliktTowaru(null);
    const { towar, ...werdyktSam } = z;
    werdykt.mutate({
      id: d.reklamacja.id, ...werdyktSam, wersja: d.reklamacja.wersja,
      ...(towar ? { towar: { ...towar, expectedLastMessageId: ostatniaNieNasza(d.czat) } } : {}),
    }, {
      onSuccess: (w) => {
        if (w.status === "send_failed") setBladWerdyktu(w.blad ?? "Allegro odmówiło");
        const los = w.towar;
        if (towar && los) {
          if ("konflikt" in los) {
            if (los.konflikt.nowaWiadomosc !== undefined) {
              setKonfliktTowaru({ szczegoly: los.konflikt, decyzja: towar.decyzja, tresc: towar.tresc });
            } else setBladTowaru(los.konflikt.error ?? "Stanowisko o towarze nie wyszło — wyślij je jeszcze raz.");
          } else if ("blad" in los) setBladTowaru(los.blad);
          else if ("pominiety" in los) setBladTowaru(los.pominiety);
          else if (los.status !== "sent") setBladTowaru(TOWAR_NIEPEWNY);
        }
        /* Zieleń „potwierdzony przez Allegro” należy się dopiero statusowi
           z synchronizacji, więc dociągamy go od razu, zamiast czekać na takt. */
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
        if (w.status !== "sent") setBladTowaru(TOWAR_NIEPEWNY);
      },
      onError: (e) => {
        const k = dopisek(e);
        if (k) setKonfliktTowaru({ szczegoly: k, decyzja, tresc: trescTowaru });
        else setBladTowaru((e as Error).message);
      },
    });
  };

  /* Skróty milkną w polu tekstowym i pod oknem modalnym — inaczej cyfra
     wpisana w notatkę przełączałaby kubełek. Strażnik jest wspólny, bo własna
     kopia nie znała SELECT-a. */
  useEffect(() => {
    const nasluch = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || klawiszZajety(e.target)) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idz(-1); }
      /* Cyfry liczą się z długości `KUBELKI`, więc dopisanie kubełka nie
         rozjedzie klawiszy. Ostatnia cyfra to „Wszystkie”. */
      else if (/^[1-9]$/.test(e.key)) {
        const n = Number(e.key);
        if (n <= KUBELKI.length) przelacz(KUBELKI[n - 1].id);
        else if (n === KUBELKI.length + 1) przelacz(null);
      }
      /* `m` jak „moje”: litera, nie cyfra, bo cyfry należą do kubełków. */
      else if (e.key === "m" && mojeId !== null) przelaczSito(sito === "moje" ? null : "moje");
      else if (e.key === "n") przelaczSito(sito === "niczyje" ? null : "niczyje");
    };
    window.addEventListener("keydown", nasluch);
    return () => window.removeEventListener("keydown", nasluch);
  });

  const synchronizujTeraz = () => {
    setBladSync("");
    synchronizuj.mutate(undefined, { onError: (e) => setBladSync((e as Error).message) });
  };

  /* Nagłówek grupy spraw w terminie mówi, czym jest lista. Przy szukaniu
     lista miesza kubełki, więc nie udaje żadnego z nich. */
  const nazwaGrupy = pasujace ? "Wyniki szukania"
    : kubelek === null ? "Wszystkie" : (KUBELKI.find((k) => k.id === kubelek)?.etykieta ?? "");
  /* PRÓG, KTÓRY CHOWA PRACĘ, WOŁA NAD LISTĄ. W ciszy próg mieszka w filtrze,
     ale sprawy sprzed progu z żywym terminem to praca, a nie archiwum. */
  const progAlarmuje = Boolean(data?.prog && !data.prog.zdjety && data.prog.ukrytychZTerminem > 0);
  const stanTekst = data?.stan?.dyskusjiPominietych
    ? `pominiętych dyskusji ${data.stan.dyskusjiPominietych}` : undefined;
  const nazwaTagu = tag === null ? null : wgTagow.find(([t]) => t.id === tag)?.[0].nazwa ?? null;

  const d = szczegol.data;
  const r = d?.reklamacja;

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-y-auto xl:overflow-hidden">
    <Kafle statystyki={data?.statystyki} kubelek={kubelek} onKubelek={przelacz}
      stan={data?.stan} trwaSync={synchronizuj.isPending} bladSync={bladSync}
      onSynchronizuj={synchronizujTeraz} />

    {/* Zapytanie padło i nie ma danych: błąd zamiast kolumn, a kafle mówią
        „—”. Pusta lista przy awarii czytałaby się jako „nic nie czeka”. */}
    {error && !data
      ? <Blad>{(error as Error).message}</Blad>
      : <div className={UKLAD}>
        <section aria-label="Kolejka reklamacji"
          className={`${KOLUMNA} ${KARTA} flex flex-[1_1_340px] flex-col xl:overflow-hidden`}>
          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 px-4 pb-3 pt-4">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-tytul font-bold text-slate-900">Reklamacje</h1>
              <FiltrKolejki wgTagow={wgTagow} tag={tag} onTag={setTag}
                porzadek={porzadek} osie={OSIE} onPorzadek={ustawPorzadek}
                prog={data?.prog} onPrzelaczProg={setBezProgu} stanTekst={stanTekst} />
            </div>
            <label className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3">
              <Search size={18} aria-hidden="true" className="shrink-0 text-slate-600" />
              <span className="sr-only">Szukaj reklamacji</span>
              <input type="search" className="h-10 min-w-0 flex-1 bg-transparent text-tresc outline-none"
                value={fraza} onChange={(e) => setFraza(e.target.value)}
                placeholder="Login, numer, zamówienie, towar, notatka" />
            </label>
            <PrzelacznikKubelkow wybrany={kubelek} onWybierz={przelacz}
              liczniki={data?.liczniki} wszystkich={data?.reklamacje.length} />
            <div className="flex flex-wrap items-center gap-1.5">
              <PasekSita sito={sito} mojeId={mojeId} onPrzelacz={przelaczSito}
                moich={wKubelku.filter((x) => mojaSprawa(x.prowadziId, mojeId)).length}
                niczyich={wKubelku.filter((x) => x.prowadziId === null).length} />
              <span className="ml-auto text-xs text-slate-600">{OPIS_PORZADKU[porzadek]}</span>
            </div>
          </div>

          {progAlarmuje && data?.prog && <div className="shrink-0 px-3 pt-3">
            <PasekProgu prog={data.prog} onPrzelacz={setBezProgu} /></div>}
          {/* Tag schowany w filtrze zawęża listę po cichu, więc zdanie mówi
              o nim nad wierszami i daje drogę powrotną jednym kliknięciem. */}
          {nazwaTagu && !pasujace && <p className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 text-podpis text-slate-600">
            <span>Tylko sprawy z tagiem „{nazwaTagu}”.</span>
            <button type="button" onClick={() => setTag(null)}
              className="py-1 font-semibold text-slate-700 underline">pokaż wszystkie</button>
          </p>}
          <ZdanieOUkrytych ile={ukrytych} nazwa={sito === "niczyje" ? "Niczyje" : "Moje"}
            onPokazWszystkie={() => przelaczSito(null)} />

          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {isLoading
              ? <Pusto waga="lista">Wczytuję kolejkę…</Pusto>
              : <Kolejka reklamacje={widoczne} wybrana={wybrana} mojeId={mojeId}
                  nazwaGrupy={nazwaGrupy}
                  zKubelkiem={Boolean(pasujace) || kubelek === null}
                  onWybierz={(x) => nawiguj(`/obsluga/reklamacje/${x}`)} />}
          </div>
        </section>

        {d && r
          ? <>
            <section aria-label={`Reklamacja ${r.numer ?? r.externalId}`}
              className={`${KOLUMNA} ${KARTA} flex flex-[999_1_560px] flex-col xl:overflow-y-auto`}>
              <Glowica szczegol={d} mojeId={mojeId} trwa={prowadze.isPending} blad={bladProwadze}
                onProwadze={() => {
                  setBladProwadze("");
                  prowadze.mutate({ id: r.id, wersja: r.wersja },
                    { onError: (e) => setBladProwadze((e as Error).message) });
                }}
                onOdswiez={() => odswiez.mutate({ id: r.id })} odswieza={odswiez.isPending} />
              <DrogaSprawy szczegol={d} sprawdzaPrzesylke={sprawdzPrzesylke.isPending}
                bladPrzesylki={bladPrzesylki}
                onSprawdzPrzesylke={() => {
                  setBladPrzesylki("");
                  sprawdzPrzesylke.mutate({ id: r.id },
                    { onError: (e) => setBladPrzesylki((e as Error).message) });
                }} />
              <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200">
                <Czat tytul="Czat reklamacji"
                  sprawa={{
                    id: r.id,
                    /* `powodOpis` PIERWSZY: to zdanie klienta o usterce, a `opis`
                       bywa przy reklamacji pusty. */
                    opisZgloszenia: r.powodOpis ?? r.opis,
                    czatAktywny: r.czatAktywny,
                    wiadomosciIle: r.wiadomosciIle,
                    login: r.kupujacyLogin,
                    zgloszonoAt: r.otwartoAt,
                    powod: liniaPowodu(r),
                  }}
                  czat={d.czat}
                  zalaczniki={d.zalaczniki}
                  /* Przesyłki od klienta i od nas stają na osi rozmowy według
                     chwili, bo „odesłał, a potem napisał” czyta się po kolei. */
                  zdarzenia={zdarzeniaPrzesylek(d)}
                  /* Klucz sprawy: edytor trzyma własny stan (cofnięcie
                     wyczyszczenia, zwłokę Ctrl+Enter), a ekran nie montuje go
                     od nowa przy przejściu. */
                  edytor={<Edytor key={r.id} etykietaWyslij="Wyślij do klienta" tresc={tresc} wysyla={odpowiedz.isPending} blad={bladWysylki}
                    zalaczniki={zalacznikiWysylki.data?.zalaczniki ?? []}
                    dodajeZalacznik={dodajZalacznik.isPending}
                    bladZalacznika={bladZalacznika}
                    /* Plik czytamy TU, nie w komponencie: base64 to sprawa
                       klienta HTTP, a katalog `reklamacje/` trzyma komponenty czyste. */
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
                    czatAktywny={r.czatAktywny}
                    onZmiana={setTresc} onWyslij={() => wyslij()} />} />
              </div>
            </section>

            <aside aria-label="Decyzja i produkt"
              className={`${KOLUMNA} flex flex-[1_1_360px] flex-col gap-4 xl:overflow-y-auto`}>
              {/* Decyzja pierwsza: z niej wychodzi się z ekranu. Zgoda przed
                  wysłaniem zostaje przy OBU gałęziach, bo uznanie kosztuje
                  pieniądze i jest równie nieodwracalne co odmowa. */}
              <Werdykt reklamacja={r}
                czat={d.czat} trwa={werdykt.isPending} blad={bladWerdyktu}
                bladTowaru={bladTowaru} onWerdykt={wyslijWerdykt}
                /* Niepewny los werdyktu rozstrzyga jedno odświeżenie sprawy,
                   nie drugi werdykt — ten sam hak co wejście w sprawę. */
                onSprawdz={() => odswiez.mutate({ id: r.id })} sprawdza={odswiez.isPending} />
              <Produkt szczegol={d} />
              <Notatka reklamacja={r} trwa={notatka.isPending || cofnijNotatke.isPending}
                blad={bladNotatki}
                onZapisz={(tekst, gotowe) => {
                  setBladNotatki("");
                  notatka.mutate({ id: r.id, notatka: tekst.trim() || null, wersja: r.wersja },
                    { onSuccess: gotowe, onError: (e) => setBladNotatki((e as Error).message) });
                }}
                onCofnij={() => {
                  setBladNotatki("");
                  cofnijNotatke.mutate({ id: r.id, wersja: r.wersja },
                    { onError: (e) => setBladNotatki((e as Error).message) });
                }} />
            </aside>
          </>
          : <Karta className={`${KOLUMNA} flex flex-[999_1_560px] flex-col xl:col-span-2`}>
              <div className="flex min-h-[12rem] flex-1 items-center px-4">
                <Pusto ikona={ShieldQuestion}>
                  {wybrana ? "Wczytuję sprawę…" : "Wybierz reklamację z kolejki po lewej"}
                </Pusto>
              </div>
            </Karta>}
      </div>}

    {/* Jawna zgoda po dopisku — dialog ze skrzynki, bez kopiowania. Autora
        nazywa `ktoDopisal`, bo przy reklamacji bywa nim doradca Allegro. */}
    {konfliktWysylki && <DialogKonfliktu
      szczegoly={konfliktWysylki}
      szkic={tresc}
      wysyla={odpowiedz.isPending}
      blad={bladWysylki}
      ktoDopisal={konfliktWysylki.nowaWiadomosc?.rola === "ADMIN"
        ? "doradca Allegro" : "klient"}
      onWyslijMimoTo={() => wyslij(true)}
      onPopraw={() => setKonfliktWysylki(null)} />}

    {/* Ten sam dialog przy stanowisku o towarze — ta sama kolejka i ten sam
        rodzaj konfliktu, więc drugiego okna nie ma. */}
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
