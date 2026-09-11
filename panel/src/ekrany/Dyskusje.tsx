import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MessagesSquare } from "lucide-react";
import {
  useDyskusja, useDyskusje, useNotatkaDyskusji, useOdpowiedzWDyskusji,
  useProwadzeDyskusje, useZakoncz,
} from "../api/dyskusje";
import { useJa } from "../api/rozmowy";
import { Konflikt } from "../api/klient";
import type {
  Dyskusja, KubelekDyskusji, SzczegolyWysylki, WiadomoscReklamacji,
} from "../api/typy";
import { DialogKonfliktu } from "../skrzynka/DialogKonfliktu";
import { Edytor } from "../reklamacje/Edytor";
import { Czat } from "../reklamacje/Czat";
import { Blad, FiltrSegmentowy, Karta, Pusto, SIATKA_TRZECH_KOLUMN } from "../ui";
import { KUBELKI, Kolejka } from "../dyskusje/Kolejka";
import { PigulkaMoje, ZdanieOUkrytych, mojaSprawa, useMoje } from "../sprawy/Moje";
import { FiltrTagow, tagiWgLiczby } from "../sprawy/Tagi";
import { useNowyTag, useOdepnijTag, usePrzypnijTag, useTagi } from "../api/tagi";
import { Fakty } from "../dyskusje/Fakty";
import { Zakonczenie } from "../dyskusje/Zakonczenie";

/* ── Ekran dyskusji (0.245.0) ────────────────────────────────────────────────
   Trzy kolumny, jak skrzynka, zwroty i reklamacje — CZTERY ekrany obsługi mają
   mieć jeden nawyk, nie cztery.

   CO TU JEST INACZEJ NIŻ PRZY REKLAMACJI, i wszystko z tego samego powodu:
   dyskusja nie ma zegara ani werdyktu.

   - Kolejność liczy się z CZASU CZEKANIA, nie z terminu. Allegro dla dyskusji
     terminu nie oddaje, więc miarą jest to, jak długo piłka leży po naszej
     stronie. Wiersz mówi „czeka 5 dni", nigdy „termin".
   - Zamiast paska werdyktu stoi PROŚBA O ZAKOŃCZENIE (`END_REQUEST`) — jedyna
     operacja, którą Allegro przewiduje wyłącznie dla dyskusji.
   - Nie ma przycisku synchronizacji: dyskusje i reklamacje jadą jedną listą
     `/sale/issues`, więc drugi przycisk byłby drugą drogą w limit 429. Pasek
     mówi, jak stoi ta wspólna synchronizacja, i odsyła do reklamacji.

   Klawiatura ta sama: strzałki chodzą po kolejce, cyfry przełączają kubełek.
   Odruch ma być jeden na cztery ekrany.                                     */

const STANY: Record<string, string> = {
  current: "działa",
  delayed: "opóźniona",
  rate_limited: "wstrzymana limitem Allegro",
  authentication_error: "odmowa logowania do Allegro",
  failed: "nie działa",
};

/** Dopisek klienta albo doradcy — jedyny 409, który wymaga DECYZJI agenta. */
const dopisek = (e: unknown): SzczegolyWysylki | null =>
  e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).nowaWiadomosc !== undefined
    ? (e.szczegoly as SzczegolyWysylki) : null;

/** Kody, po których człowiek szuka dyskusji — wszystkie, jakie sprawa niesie. */
const kody = (d: Dyskusja) =>
  /* Prowadzący wchodzi do szukania — powód przy tej samej funkcji
     w `ekrany/Reklamacje.tsx`. */
  [d.externalId, d.orderId, d.kupujacyLogin, d.temat, d.prowadzi]
    .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

export function Dyskusje() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<KubelekDyskusji | null>("odpowiedz");
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

  const { data, isLoading, error } = useDyskusje();
  const prowadze = useProwadzeDyskusje();
  const notatka = useNotatkaDyskusji();
  const odpowiedz = useOdpowiedzWDyskusji();
  const zakoncz = useZakoncz();
  const trwa = prowadze.isPending || notatka.isPending;

  const [tresc, setTresc] = useState("");
  const [bladWysylki, setBladWysylki] = useState("");
  const [konfliktWysylki, setKonfliktWysylki] = useState<SzczegolyWysylki | null>(null);
  const [bladZakonczenia, setBladZakonczenia] = useState("");

  const wKubelku = useMemo(() => kubelek === null
    ? (data?.dyskusje ?? [])
    : (data?.dyskusje ?? []).filter((d) => d.kubelek === kubelek), [data, kubelek]);

  /* Filtr liczy się TUTAJ, w pamięci ekranu — tą samą drogą co filtr kubełka
     i z tego samego powodu: lista przyjeżdża w całości, bo spraw w pracy są
     dziesiątki, nie tysiące. */
  const pasujace = useMemo(() => {
    const f = fraza.trim().toLowerCase();
    if (!f) return null;
    return (data?.dyskusje ?? []).filter((d) => kody(d).some((k) => k.includes(f)));
  }, [data, fraza]);

  /* SZUKANIE PRZEBIJA SITO, tak samo jak przebija kubełek (§25a.9). Wpisany
     numer ma znaleźć sprawę także wtedy, gdy prowadzi ją kolega — inaczej pole
     szukania kłamałoby pustką przy sprawie, która jest tuż obok. */
  /* Pigułki tagów liczą skład KUBEŁKA, nie tego, co zostało po sitach.
     Licznik malejący do zera przy każdym kliknięciu mówiłby o własnym
     filtrze, a nie o pracy, która czeka. */
  const wgTagow = useMemo(() => tagiWgLiczby(wKubelku), [wKubelku]);

  const moi = useMemo(() => (moje
    ? wKubelku.filter((d) => mojaSprawa(d.prowadziId, mojeId)) : wKubelku),
  [wKubelku, moje, mojeId]);

  /* Tag NAKŁADA SIĘ na „Moje", a nie zastępuje go: pytania „czyje to"
     i „o czym to" zadaje się naraz, więc odpowiedzi mają się mnożyć,
     nie wykluczać. */
  const wSicie = useMemo(
    () => (tag === null ? moi : moi.filter((d) => d.tagi.some((t) => t.id === tag))),
    [moi, tag]);

  const widoczne = pasujace ?? wSicie;
  /* Zdanie liczy WYŁĄCZNIE to, co chowa „Moje". Doliczenie tu spraw odsianych
     tagiem byłoby kłamstwem o przyczynie: tag zdejmuje się kliknięciem w tę
     samą pigułkę i widać go na ekranie, a pamiętane „Moje" nie widać. */
  const ukrytych = pasujace || !moje ? 0 : wKubelku.length - moi.length;
  const wybrana = id ? Number(id) : null;
  const dyskusja = data?.dyskusje.find((d) => d.id === wybrana) ?? null;
  const szczegol = useDyskusja(wybrana);

  /* Wejście z paska adresu na sprawę z innego kubełka ma pokazać TĘ sprawę,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (dyskusja && kubelek !== null && dyskusja.kubelek !== kubelek) {
      setKubelek(dyskusja.kubelek);
    }
  }, [dyskusja?.id]);

  /**
   * Przełączenie kubełka PRZESTAWIA TEŻ KURSOR.
   *
   * Bez tego jeden klawisz zmieniałby listę, a zaznaczenie zostawałoby na
   * sprawie z poprzedniego kubełka — środkowa kolumna pokazywałaby wtedy
   * pytanie nowego kubełka nad rozmową ze starego.
   */
  const przelacz = (k: KubelekDyskusji | null) => {
    setKubelek(k);
    setFraza("");
    const pierwsza = (data?.dyskusje ?? []).find((d) => k === null || d.kubelek === k);
    nawiguj(pierwsza ? `/obsluga/dyskusje/${pierwsza.id}` : "/obsluga/dyskusje");
  };

  /* Kursor chodzi po liście WIDOCZNEJ, nie po kubełku: przy włączonym filtrze
     strzałka ma iść do następnego wyniku, a nie do sprawy schowanej przed
     oczami. */
  const idz = (o: number) => {
    if (!widoczne.length) return;
    const i = widoczne.findIndex((d) => d.id === wybrana);
    const nast = widoczne[Math.min(widoczne.length - 1, Math.max(0, (i < 0 ? 0 : i) + o))];
    if (nast) nawiguj(`/obsluga/dyskusje/${nast.id}`);
  };

  /* Pole czyści się przy ZMIANIE SPRAWY, nigdy przy odświeżeniu zapytania —
     inaczej odpowiedź pisana w trakcie taktu synchronizacji znikałaby w pół
     zdania. Ten sam warunek co przy szkicu w skrzynce. */
  useEffect(() => {
    setTresc("");
    setBladWysylki("");
    setKonfliktWysylki(null);
    setBladZakonczenia("");
  }, [wybrana]);

  /**
   * Ostatnia NIE nasza wiadomość — punkt odniesienia dla kontroli świeżości.
   *
   * Rozmowa bywa TRÓJSTRONNA, więc punkt przesuwa też doradca Allegro (rola
   * `ADMIN`). Liczy go panel z osi, a serwer sprawdza po swojemu i rozstrzyga.
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
      id: d.dyskusja.id,
      tresc,
      expectedWersja: d.dyskusja.wersja,
      expectedLastMessageId: ostatniaNieNasza(d.czat),
      mimoNowejWiadomosci,
    }, {
      onSuccess: (w) => {
        setKonfliktWysylki(null);
        if (w.status === "sent") setTresc("");
        else setBladWysylki(
          "Wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj sprawę, zanim spróbujesz znowu.");
      },
      onError: (e) => {
        /* Dopisek ma WŁASNY ekran, bo wymaga decyzji. Reszta — zamknięta
           rozmowa, rozjazd wersji, odmowa Allegro — to jedno zdanie pod polem;
           serwer przysyła je gotowe i panel go nie układa od nowa. */
        const k = dopisek(e);
        if (k) setKonfliktWysylki(k);
        else setBladWysylki((e as Error).message);
      },
    });
  };

  /* Prośba o zakończenie: los próby przychodzi w odpowiedzi, a po `onSettled`
     sprawa dociąga się z kolumnami `zakonczenie_*` i pasek pokazuje stan
     z WIERSZA. Tu zostaje zdanie o porażce, żeby agent nie czekał na
     odświeżenie. Konfliktu nie zamieniamy w dialog: „już poproszono" nie ma
     drugiej drogi, a dopisek klienta jest powodem, żeby przeczytać rozmowę,
     nie żeby prosić mimo to. */
  const wyslijZakonczenie = (trescProsby: string) => {
    const d = szczegol.data;
    if (!d) return;
    setBladZakonczenia("");
    zakoncz.mutate({
      id: d.dyskusja.id,
      tresc: trescProsby,
      wersja: d.dyskusja.wersja,
      expectedLastMessageId: ostatniaNieNasza(d.czat),
    }, {
      onSuccess: (w) => {
        if (w.status === "send_uncertain") {
          setBladZakonczenia(
            "Prośba poszła, ale Allegro nie potwierdziło — nie wysyłaj drugiej, sprawdź w Centrum Sprzedaży.");
        }
      },
      onError: (e) => setBladZakonczenia((e as Error).message),
    });
  };

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
      /* `m` jak „moje" — litera, nie cyfra: cyfry należą do kubełków,
         a piąta obiecywałaby piąty kubełek. */
      else if (e.key === "m" && mojeId !== null) przelaczMoje(!moje);
    };
    window.addEventListener("keydown", nasluch);
    return () => window.removeEventListener("keydown", nasluch);
  });

  if (error) return <Blad>{(error as Error).message}</Blad>;

  const opis = KUBELKI.find((k) => k.id === kubelek);

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {/* Pasek synchronizacji jest WSPÓLNY z reklamacjami i mówi to wprost —
        inaczej agent szukałby tu przycisku, którego nie ma, i uznał ekran
        za zepsuty. */}
    {data?.stan && <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1
      rounded-lg px-3 py-2 text-xs ${data.stan.status !== "current"
        ? "border border-red-200 bg-red-50 text-red-900"
        : "border border-slate-200 bg-slate-50 text-slate-600"}`}>
      <span>Synchronizacja spraw posprzedażowych: <b>{STANY[data.stan.status] ?? data.stan.status}</b>
        {data.stan.kodOstatniegoBledu ? `, kod ${data.stan.kodOstatniegoBledu}` : ""}</span>
      <span className="text-slate-500">
        Dyskusje i reklamacje przyjeżdżają jedną listą — odśwież ją na ekranie reklamacji.
      </span>
    </div>}

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
          <FiltrSegmentowy<KubelekDyskusji | null> wybrany={kubelek} onWybierz={przelacz}
            pozycje={[
              ...KUBELKI.map((k, i) => ({ klucz: k.id, etykieta: k.etykieta,
                ile: data?.liczniki?.[k.id] ?? 0,
                podpowiedz: `${k.pytanie} (klawisz ${i + 1})` })),
              { klucz: null, etykieta: "Wszystkie", ile: data?.dyskusje?.length ?? 0,
                podpowiedz: `Wszystkie dyskusje (klawisz ${KUBELKI.length + 1})` },
            ]} />
        </nav>

        {/* Sito „Moje" — własny rząd, powód przy tym samym paśmie
            w `ekrany/Reklamacje.tsx`. */}
        {(mojeId !== null || wgTagow.length > 0) &&
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 px-2 py-1">
            <PigulkaMoje moje={moje} mojeId={mojeId} onPrzelacz={przelaczMoje}
              ile={wKubelku.filter((d) => mojaSprawa(d.prowadziId, mojeId)).length} />
            {/* Tagi w TYM SAMYM rzędzie co „Moje", bo oba są zawężeniem tej
                samej listy — kubełek stoi nad nimi i jest wyborem, nie sitem. */}
            <FiltrTagow wgLiczby={wgTagow} wybrany={tag} onWybierz={setTag} />
          </div>}

        <div className="shrink-0 border-b border-slate-200 px-2 py-1.5">
          <label className="sr-only" htmlFor="szukaj-dyskusji">Szukaj dyskusji</label>
          <input id="szukaj-dyskusji" className="field !py-1 text-xs" value={fraza}
            onChange={(e) => setFraza(e.target.value)}
            placeholder="Temat, zamówienie albo login klienta" />
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
            : <Kolejka dyskusje={widoczne} wybrana={wybrana}
                zKubelkiem={Boolean(pasujace) || kubelek === null}
                onWybierz={(d) => nawiguj(`/obsluga/dyskusje/${d}`)} />}
        </div>
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-y-auto p-4">
        {szczegol.data
          ? <>
              <div className="mb-3">
                <Zakonczenie dyskusja={szczegol.data.dyskusja} wysyla={zakoncz.isPending}
                  blad={bladZakonczenia} onZakoncz={wyslijZakonczenie} />
              </div>
              <Czat
                sprawa={{
                  id: szczegol.data.dyskusja.id,
                  /* Dyskusja ma tylko `opis` — powodu, oczekiwania i tytułu
                     prawnego nie niesie, bo Allegro ich przy niej nie oddaje. */
                  opisZgloszenia: szczegol.data.dyskusja.opis,
                  wiadomosciIle: szczegol.data.dyskusja.wiadomosciIle,
                  czatUrwany: szczegol.data.dyskusja.czatUrwany,
                }}
                czat={szczegol.data.czat}
                zalaczniki={szczegol.data.zalaczniki}
                edytor={<Edytor tresc={tresc} wysyla={odpowiedz.isPending} blad={bladWysylki}
                  czatAktywny={szczegol.data.dyskusja.czatAktywny}
                  onZmiana={setTresc} onWyslij={() => wyslij()} />} />
            </>
          : <Pusto ikona={MessagesSquare}>
              {wybrana ? "Wczytuję dyskusję…" : "Wybierz dyskusję z kolejki po lewej"}
            </Pusto>}
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-y-auto">
        {szczegol.data
          ? <Fakty szczegol={szczegol.data} trwa={trwa} bladZapisu={bladZapisu}
              tagi={{
                slownik: slownikTagow.data?.tagi ?? [],
                trwa: nowyTag.isPending || przypnij.isPending || odepnij.isPending,
                blad: bladTagu,
                onPrzypnij: (tagId) => {
                  setBladTagu("");
                  przypnij.mutate({ id: szczegol.data!.dyskusja.id, rodzaj: "dyskusje", tagId },
                    { onError: (e) => setBladTagu((e as Error).message) });
                },
                onOdepnij: (tagId) => {
                  setBladTagu("");
                  odepnij.mutate({ id: szczegol.data!.dyskusja.id, rodzaj: "dyskusje", tagId },
                    { onError: (e) => setBladTagu((e as Error).message) });
                },
                onNowy: (nazwa) => {
                  setBladTagu("");
                  nowyTag.mutate({ id: szczegol.data!.dyskusja.id, rodzaj: "dyskusje", nazwa },
                    { onError: (e) => setBladTagu((e as Error).message) });
                },
              }}
              onProwadze={() => {
                setBladZapisu("");
                prowadze.mutate(
                  { id: szczegol.data!.dyskusja.id, wersja: szczegol.data!.dyskusja.wersja },
                  { onError: (e) => setBladZapisu((e as Error).message) });
              }}
              onNotatka={(tekst) => {
                setBladZapisu("");
                notatka.mutate({
                  id: szczegol.data!.dyskusja.id, notatka: tekst,
                  wersja: szczegol.data!.dyskusja.wersja,
                }, { onError: (e) => setBladZapisu((e as Error).message) });
              }} />
          : <Pusto waga="lista">
              Fakty o sprawie pokażą się po wybraniu dyskusji.</Pusto>}
      </Karta>
    </div>

    {/* Jawna zgoda po dopisku — dialog ze skrzynki, bez kopiowania. Autora
        nazywa `ktoDopisal`, bo przy dyskusji bywa nim doradca Allegro. */}
    {konfliktWysylki && <DialogKonfliktu
      szczegoly={konfliktWysylki}
      szkic={tresc}
      wysyla={odpowiedz.isPending}
      blad={bladWysylki}
      ktoDopisal={konfliktWysylki.nowaWiadomosc?.rola === "ADMIN"
        ? "doradca Allegro" : "klient"}
      onWyslijMimoTo={() => wyslij(true)}
      onPopraw={() => setKonfliktWysylki(null)} />}
  </div>;
}
