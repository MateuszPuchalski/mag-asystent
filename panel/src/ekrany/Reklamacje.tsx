import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ShieldQuestion } from "lucide-react";
import {
  useDodajZalacznikSprawy, useNotatka, useOdpowiedz, useOdswiez,
  useRozpoznaj, useUsunZalacznikSprawy, useZalacznikiSprawy, useProwadze, useReklamacja, useReklamacje, useSynchronizuj,
  useWerdykt, useZwrotTowaru,
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
import { Blad, FiltrSegmentowy, Karta, Przycisk, Pusto, SIATKA_TRZECH_KOLUMN } from "../ui";
import { KUBELKI, Kolejka } from "../reklamacje/Kolejka";
import { PigulkaMoje, ZdanieOUkrytych, mojaSprawa, useMoje } from "../sprawy/Moje";
import { FiltrTagow, tagiWgLiczby } from "../sprawy/Tagi";
import { useNowyTag, useOdepnijTag, usePrzypnijTag, useTagi } from "../api/tagi";
import { Czat } from "../reklamacje/Czat";
import { Dowody } from "../reklamacje/Dowody";

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
  [r.numer, r.externalId, r.orderId, r.kupujacyLogin, r.prowadzi]
    .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

export function Reklamacje() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<KubelekReklamacji | null>("decyzja");
  const [fraza, setFraza] = useState("");
  const ja = useJa();
  const mojeId = ja.data?.user.userId ?? null;
  const { moje, przelacz: przelaczMoje } = useMoje();
  const [tag, setTag] = useState<number | null>(null);
  const slownikTagow = useTagi();
  const nowyTag = useNowyTag();
  const przypnij = usePrzypnijTag();
  const odepnij = useOdepnijTag();
  const [bladTagu, setBladTagu] = useState("");
  const [bladZapisu, setBladZapisu] = useState("");
  const [bladSync, setBladSync] = useState("");

  const { data, isLoading, error } = useReklamacje();
  const prowadze = useProwadze();
  const notatka = useNotatka();
  const synchronizuj = useSynchronizuj();
  const odpowiedz = useOdpowiedz();
  const odswiez = useOdswiez();
  const dodajZalacznik = useDodajZalacznikSprawy();
  const usunZalacznik = useUsunZalacznikSprawy();
  const rozpoznaj = useRozpoznaj();
  const [bladRozpoznania, setBladRozpoznania] = useState("");
  const [bladZalacznika, setBladZalacznika] = useState("");
  const werdykt = useWerdykt();
  const zwrotTowaru = useZwrotTowaru();
  const trwa = prowadze.isPending || notatka.isPending;

  const [tresc, setTresc] = useState("");
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
     dziesiątki, nie tysiące. */
  const pasujace = useMemo(() => {
    const f = fraza.trim().toLowerCase();
    if (!f) return null;
    return (data?.reklamacje ?? []).filter((r) => kody(r).some((k) => k.includes(f)));
  }, [data, fraza]);

  /* SZUKANIE PRZEBIJA SITO, tak samo jak przebija kubełek (§25a.9). Wpisany
     numer ma znaleźć sprawę także wtedy, gdy prowadzi ją kolega — inaczej pole
     szukania kłamałoby pustką przy sprawie, która jest tuż obok. */
  /* Pigułki tagów liczą skład KUBEŁKA, nie tego, co zostało po sitach.
     Licznik malejący do zera przy każdym kliknięciu mówiłby o własnym
     filtrze, a nie o pracy, która czeka. */
  const wgTagow = useMemo(() => tagiWgLiczby(wKubelku), [wKubelku]);

  const moi = useMemo(() => (moje
    ? wKubelku.filter((r) => mojaSprawa(r.prowadziId, mojeId)) : wKubelku),
  [wKubelku, moje, mojeId]);

  /* Tag NAKŁADA SIĘ na „Moje", a nie zastępuje go: pytania „czyje to"
     i „o czym to" zadaje się naraz, więc odpowiedzi mają się mnożyć,
     nie wykluczać. */
  const wSicie = useMemo(
    () => (tag === null ? moi : moi.filter((r) => r.tagi.some((t) => t.id === tag))),
    [moi, tag]);

  const widoczne = pasujace ?? wSicie;
  /* Zdanie liczy WYŁĄCZNIE to, co chowa „Moje". Doliczenie tu spraw odsianych
     tagiem byłoby kłamstwem o przyczynie: tag zdejmuje się kliknięciem w tę
     samą pigułkę i widać go na ekranie, a pamiętane „Moje" nie widać. */
  const ukrytych = pasujace || !moje ? 0 : wKubelku.length - moi.length;
  const wybrana = id ? Number(id) : null;
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

  /* Pole czyści się przy ZMIANIE SPRAWY, nigdy przy odświeżeniu zapytania —
     inaczej odpowiedź pisana w trakcie taktu synchronizacji znikałaby w pół
     zdania. Ten sam warunek co przy szkicu w skrzynce. */
  useEffect(() => {
    setTresc("");
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
        if (w.status === "sent") setTresc("");
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
      else if (e.key === "m" && mojeId !== null) przelaczMoje(!moje);
    };
    window.addEventListener("keydown", nasluch);
    return () => window.removeEventListener("keydown", nasluch);
  });

  if (error) return <Blad>{(error as Error).message}</Blad>;

  const opis = KUBELKI.find((k) => k.id === kubelek);

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {data?.stan && <PasekOgona stan={data.stan} />}
    {data?.stan && <PasekSynchronizacji stan={data.stan} blad={bladSync}
      trwa={synchronizuj.isPending}
      onSynchronizuj={() => {
        setBladSync("");
        synchronizuj.mutate(undefined, { onError: (e) => setBladSync((e as Error).message) });
      }} />}

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

        {/* ── SITO „MOJE" (0.278.0) ────────────────────────────────────────
            WŁASNY RZĄD, nie czwarta pigułka wśród kubełków. Kubełek mówi
            „na jakim to etapie", sito „czyje to" — zlanie tego w jeden rząd
            odebrałoby pytanie „moje sprawy do decyzji", czyli dokładnie to,
            które właściciel zadaje najczęściej. Ten rząd weźmie też czipy
            tagów, bo one odpowiadają na trzecie pytanie: „o czym to". */}
        {(mojeId !== null || wgTagow.length > 0) &&
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 px-2 py-1">
            <PigulkaMoje moje={moje} mojeId={mojeId} onPrzelacz={przelaczMoje}
              ile={wKubelku.filter((r) => mojaSprawa(r.prowadziId, mojeId)).length} />
            {/* Tagi w TYM SAMYM rzędzie co „Moje", bo oba są zawężeniem tej
                samej listy — kubełek stoi nad nimi i jest wyborem, nie sitem. */}
            <FiltrTagow wgLiczby={wgTagow} wybrany={tag} onWybierz={setTag} />
          </div>}

        <div className="shrink-0 border-b border-slate-200 px-2 py-1.5">
          <label className="sr-only" htmlFor="szukaj-reklamacji">Szukaj reklamacji</label>
          <input id="szukaj-reklamacji" className="field !py-1 text-xs" value={fraza}
            onChange={(e) => setFraza(e.target.value)}
            placeholder="Numer, zamówienie albo login klienta" />
        </div>

        {/* Pytanie kubełka stoi NAD listą, bo to ono zastępuje menu akcji.
            Przy włączonym filtrze milknie: lista nie jest wtedy kubełkiem. */}
        {!pasujace && kubelek !== null &&
          <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
            {opis?.pytanie}</p>}

        <ZdanieOUkrytych ile={ukrytych} onPokazWszystkie={() => przelaczMoje(false)} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading
            ? <Pusto waga="lista">Wczytuję kolejkę…</Pusto>
            : <Kolejka reklamacje={widoczne} wybrana={wybrana}
                zKubelkiem={Boolean(pasujace) || kubelek === null}
                onWybierz={(r) => nawiguj(`/obsluga/reklamacje/${r}`)} />}
        </div>
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-y-auto p-4">
        {/* Pasek werdyktu NAD rozmową: rozstrzygnięcie całej sprawy stoi
            wyżej niż jej ostatnia wiadomość. */}
        {szczegol.data && <Werdykt reklamacja={szczegol.data.reklamacja}
          trwa={werdykt.isPending} blad={bladWerdyktu}
          trwaTowar={zwrotTowaru.isPending} bladTowaru={bladTowaru}
          onWerdykt={wyslijWerdykt} onTowar={(dec, t) => wyslijTowar(dec, t)} />}
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
          : <Pusto ikona={ShieldQuestion}>
              {wybrana ? "Wczytuję sprawę…" : "Wybierz reklamację z kolejki po lewej"}
            </Pusto>}
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-y-auto">
        {szczegol.data
          ? <Dowody szczegol={szczegol.data} trwa={trwa} bladZapisu={bladZapisu}
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
              rozpoznaje={rozpoznaj.isPending}
              bladRozpoznania={bladRozpoznania}
              onRozpoznaj={() => {
                setBladRozpoznania("");
                rozpoznaj.mutate({ id: szczegol.data!.reklamacja.id },
                  { onError: (e) => setBladRozpoznania((e as Error).message) });
              }}
              onProwadze={() => {
                setBladZapisu("");
                prowadze.mutate(
                  { id: szczegol.data!.reklamacja.id, wersja: szczegol.data!.reklamacja.wersja },
                  { onError: (e) => setBladZapisu((e as Error).message) });
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
