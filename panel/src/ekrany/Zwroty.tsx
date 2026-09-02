import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Undo2 } from "lucide-react";
import { useDociagnijPoSkanie, useSkanZwrotu, useZwroty, type WynikSkanu } from "../api/zwroty";
import type { BilansKartotek, Kubelek, Zwrot } from "../api/typy";
import { Decyzje } from "../zwroty/Decyzje";
import { Pozycje } from "../zwroty/Pozycje";
import {
  useCofnijKorekte, useKorekta, useKwota, useOcena, useWerdykt, useZglosRabat,
} from "../api/zwroty";
import { Blad, Karta, Pusto } from "../ui";
import { KUBELKI, Kolejka } from "../zwroty/Kolejka";
import { Dowody } from "../zwroty/Dowody";
import { Szukanie } from "../zwroty/Szukanie";
import { useSkaner } from "../skaner";

/* ── Ekran zwrotów (0.150.0) ─────────────────────────────────────────────────
   Trzy kolumny, jak skrzynka — dwa ekrany obsługi mają mieć jeden nawyk,
   nie dwa.

   PIĘĆ KUBEŁKÓW MA DZIAŁANIE: werdykt, ocena i kwota od 0.156.0, korekta od
   0.162.0. Ekran nie wystawia korekty ani nie oddaje pieniędzy — jedno robi
   człowiek w Subiekcie, drugie w panelu Allegro — więc mówi to wprost przy
   przycisku. Zdanie o tym, czego panel nie robi, jest tu tak samo potrzebne
   jak sam przycisk: bez niego zamknięcie zwrotu obiecywałoby przelew.

   Klawiatura DZIAŁA JUŻ TERAZ w tej części, która niczego nie zapisuje:
   strzałki chodzą po kolejce, cyfry przełączają kubełek. Odruch buduje się
   od pierwszego wydania, a nie po dołożeniu zapisu.                        */

/* Krótkie etykiety do LICZNIKA. Pełne zdania pisze serwer i stoją przy
   pozycji (`Dowody`); tutaj muszą się zmieścić w jednym pasku, więc panel ma
   własne, skrócone. To jedyne miejsce, gdzie kod powodu zamienia się na tekst
   po naszej stronie — i dlatego nieznany kod pokazuje się SUROWY zamiast
   zniknąć. Licznik, który cicho gubi część liczb, jest gorszy od jego braku. */
const POWODY_SKROT: Record<string, string> = {
  do_zatwierdzenia: "czeka na zatwierdzenie",
  brak_zamowienia_w_zwrocie: "zwrot bez zamówienia",
  zamowienie_niepobrane: "zamówienie niepobrane",
  oferty_nie_ma_w_zamowieniu: "oferty nie ma w zamówieniu",
  oferta_bez_sku: "oferta bez SKU",
  sku_nie_trafia: "SKU nie trafia w kartotekę",
  symbol_zdublowany: "symbol zdublowany",
};

/**
 * Ile pozycji czeka na kartotekę i DLACZEGO.
 *
 * Bez tych liczb nie da się odpowiedzieć na pytanie właściciela — czy problem
 * jest w kodzie, czy w danych Allegro. Jedna pozycja bez kartoteki to zwykle
 * brak SKU u sprzedawcy; czterdzieści z tym samym powodem to usterka.
 *
 * Stany końcowe do licznika nie wchodzą (liczy je `bilansKartotek`): zamknięty
 * zwrot nie jest pracą do zrobienia i zawyżałby liczbę, która ma mówić „ile
 * jeszcze przede mną".
 */
function PasekKartotek({ bilans }: { bilans: BilansKartotek }) {
  if (!bilans.bez) return null;
  const powody = Object.entries(bilans.powody).sort((a, b) => b[1] - a[1]);
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    <b>Bez kartoteki: {bilans.bez} z {bilans.wszystkie} pozycji w pracy</b>
    {powody.map(([kod, ile]) => <span key={kod} className="text-amber-800">
      {POWODY_SKROT[kod] ?? kod} <b className="tabular-nums">{ile}</b>
    </span>)}
  </div>;
}

/**
 * Kody, po których człowiek szuka zwrotu — wszystkie, jakie zwrot niesie.
 *
 * Numer zwrotu bywa doklejony na paczce, identyfikator z Allegro wpada
 * z odnośnika, numer zamówienia z rozmowy z klientem, numer korekty z Subiekta.
 * Numeru listu przewozowego tu NIE MA i nie będzie: nie zapisujemy go
 * w modelu pracy (polityka danych zwrotów), więc szuka go dopiero serwer
 * w kopii odpowiedzi Allegro.
 */
const kody = (z: Zwrot) => [z.numer, z.externalId, z.orderId, z.korektaNumer]
  .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

export function Zwroty() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<Kubelek | null>("decyzja");
  const werdykt = useWerdykt();
  const ocena2 = useOcena();
  const kwota = useKwota();
  const korekta = useKorekta();
  const cofnijKorekte = useCofnijKorekte();
  const rabat = useZglosRabat();
  const [bladRabatu, setBladRabatu] = useState("");
  const trwa = werdykt.isPending || ocena2.isPending || kwota.isPending
    || korekta.isPending || cofnijKorekte.isPending;
  /* Konflikt wersji ma brzmieć jak zdanie, nie jak kod. Serwer przysyła je
     gotowe przy 409 — panel go nie układa od nowa. */
  const bledy = [werdykt.error, ocena2.error, kwota.error, korekta.error, cofnijKorekte.error];
  const bladDecyzji = bledy.find(Boolean) instanceof Error
    ? String((bledy.find(Boolean) as Error).message) : "";
  const { data, isLoading, error } = useZwroty();

  /* WSZYSTKIE to siódma zakładka, nie siódmy kubełek (0.169.0). Kubełki dalej
     są silnikiem pracy — każdy niesie jedno pytanie — a ta zakładka jest do
     SZUKANIA: „gdzie stoi ten zwrot", nie „co mam zrobić". Rejestr skasowany
     w 0.140.0 mieszał te dwie rzeczy i to go pogrążyło. */
  const [przewoznik, setPrzewoznik] = useState<string>("");
  const [poNadaniu, setPoNadaniu] = useState(false);

  const wKubelku = useMemo(() => {
    const lista = kubelek === null
      ? (data?.zwroty ?? [])
      : (data?.zwroty ?? []).filter((z) => z.kubelek === kubelek);
    return przewoznik ? lista.filter((z) => (z.przewoznik ?? "") === przewoznik) : lista;
  }, [data, kubelek, przewoznik]);

  /* Przewoźnicy z TEGO, co przyszło, nie ze słownika: Allegro nie publikuje
     zamkniętej listy, a sonda złapała `UNKNOWN`, którego nie ma w specyfikacji.
     Filtr, który zna wartości niewystępujące w danych, uczy klikać na próżno. */
  const przewoznicy = useMemo(() => [...new Set(
    (data?.zwroty ?? []).map((z) => z.przewoznik).filter((p): p is string => Boolean(p)),
  )].sort(), [data]);

  const skan = useSkanZwrotu();
  const dociagnij = useDociagnijPoSkanie();
  const [kod, setKod] = useState("");
  const [fraza, setFraza] = useState("");
  const [wynikSkanu, setWynikSkanu] = useState<WynikSkanu | null>(null);
  const [bladSkanu, setBladSkanu] = useState("");

  /* Filtr liczy się TUTAJ, w pamięci ekranu — tą samą drogą co filtr kubełka
     i z tego samego powodu: lista przyjeżdża w całości, bo zwrotów w pracy są
     dziesiątki, nie tysiące. Szukanie po fragmencie na serwerze musiałoby albo
     rozluźnić `znajdzZwrotPoKodzie` (a ono ma być DOKŁADNE, bo samo otwiera
     zwrot), albo dołożyć trasę z dziennikiem — czyli zapisać, czego ktoś
     szukał. Numeru listu ten filtr nie widzi: nie ma go w modelu pracy. Od
     niego jest Enter i `POST /skan`, który szuka w kopii odpowiedzi Allegro. */
  const pasujace = useMemo(() => {
    const f = fraza.trim().toLowerCase();
    if (!f) return null;
    return (data?.zwroty ?? []).filter((z) => kody(z).some((k) => k.includes(f)));
  }, [data, fraza]);

  /* Szukanie PRZEBIJA kubełek. Bez tego operator wpisuje numer, widzi „ten
     kubełek jest pusty" i nie ma jak się dowiedzieć, że zwrot stoi w
     ZAMKNIĘTYCH. Kod jest mocniejszy niż zakładka, na którą ktoś przed chwilą
     kliknął — tak samo jak adres w pasku przeglądarki. */
  /* Kolejność DOMYŚLNA zostaje po zegarze ustawowym — blizna 0.121.0: termin
     jest osobnym bytem i steruje kolejnością pracy. Sortowanie po dacie
     nadania jest PRZEŁĄCZNIKIEM, bo odpowiada na inne pytanie: „co przyszło
     najdawniej", a nie „co się najbardziej pali". */
  const widoczne = useMemo(() => {
    const lista = pasujace ?? wKubelku;
    if (!poNadaniu) return lista;
    return [...lista].sort((a, b) =>
      String(a.paczkaAt ?? "9999").localeCompare(String(b.paczkaAt ?? "9999")));
  }, [pasujace, wKubelku, poNadaniu]);

  /* Trafienie otwiera zwrot od razu — po to jest ten skan. Adres jest tu
     źródłem prawdy i sam dociąga kubełek, więc zwrot otwiera się także wtedy,
     gdy stoi w innym kubełku niż oglądany. */
  const przyjmij = (w: WynikSkanu) => {
    setWynikSkanu(w);
    setBladSkanu("");
    if (w.zwrotId) nawiguj(`/obsluga/zwroty/${w.zwrotId}`);
  };
  const szukaj = (v: string) => {
    setKod(v);
    setFraza(v);
    skan.mutate(v, { onSuccess: przyjmij, onError: (e) => setBladSkanu((e as Error).message) });
  };

  const wybrany = id ? Number(id) : null;
  const zwrot = data?.zwroty.find((z) => z.id === wybrany) ?? null;

  /* Wejście z paska adresu na zwrot z innego kubełka ma pokazać ten zwrot,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (zwrot && kubelek !== null && zwrot.kubelek !== kubelek) setKubelek(zwrot.kubelek);
  }, [zwrot?.id]);

  /**
   * CAŁY kod otwiera zwrot, fragment tylko zawęża listę.
   *
   * Ekran sam otwiera przy jednym wyniku, więc dopasowanie przybliżone
   * prowadziłoby do CUDZEJ sprawy — a przy zwrocie znaczy to cudzego klienta
   * i cudze pieniądze. Ta sama zasada stoi przy skanie od 0.163.0.
   *
   * Otwarcie w pół pisania nie jest wpadką: otwarty zwrot niczego nie mutuje
   * (zero zapisu przy patrzeniu), pole zostaje z tekstem, a dopisanie znaku
   * przenosi ekran dalej. Dwa zwroty o tym samym kodzie — na przykład dwa
   * zwroty z jednego zamówienia — nie otwierają żadnego; wybiera człowiek.
   */
  useEffect(() => {
    const f = fraza.trim().toLowerCase();
    if (!f) return;
    const trafienia = (data?.zwroty ?? []).filter((z) => kody(z).includes(f));
    if (trafienia.length === 1 && trafienia[0].id !== wybrany) {
      nawiguj(`/obsluga/zwroty/${trafienia[0].id}`);
    }
  }, [fraza, data]);

  /**
   * Przełączenie kubełka PRZESTAWIA TEŻ KURSOR.
   *
   * Bez tego jeden klawisz zmieniał listę, a zaznaczenie zostawało na zwrocie
   * z poprzedniego kubełka — środkowa kolumna pokazywała wtedy pytanie nowego
   * kubełka nad klawiszami starego. Operator musiał dokliknąć wiersz, czyli
   * dokładnie to jedno kliknięcie, którego ten ekran miał nie mieć.
   */
  const przelacz = (k: Kubelek | null) => {
    setKubelek(k);
    /* Kliknięcie w kubełek jest prośbą o TEN kubełek, więc zdejmuje filtr.
       Inaczej przełącznik wyglądałby na zepsuty: lista zostawałaby ta sama. */
    setFraza("");
    setWynikSkanu(null);
    const pierwszy = (data?.zwroty ?? []).find((z) => k === null || z.kubelek === k);
    nawiguj(pierwszy ? `/obsluga/zwroty/${pierwszy.id}` : "/obsluga/zwroty");
  };

  /* Kursor chodzi po liście WIDOCZNEJ, nie po kubełku: przy włączonym filtrze
     `j` ma iść do następnego wyniku, a nie do zwrotu schowanego przed oczami. */
  const idz = (o: number) => {
    if (!widoczne.length) return;
    const i = widoczne.findIndex((z) => z.id === wybrany);
    const nast = widoczne[Math.min(widoczne.length - 1, Math.max(0, (i < 0 ? 0 : i) + o))];
    if (nast) nawiguj(`/obsluga/zwroty/${nast.id}`);
  };

  /* Skróty idą TĄ SAMĄ drogą co czytnik (0.163.0). Dwa niezależne nasłuchy
     nie umiałyby się dogadać, który klawisz jest czyj — a numer listu
     `600000367616070023174201` zawiera wszystkie cyfry kubełków. */
  useSkaner(
    (kod) => szukaj(kod),
    (e) => {
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idz(-1); }
      else if (/^[1-6]$/.test(e.key)) przelacz(KUBELKI[Number(e.key) - 1].id);
      else if (e.key === "7") przelacz(null);
    },
  );

  if (error) return <Blad>{(error as Error).message}</Blad>;

  const opis = KUBELKI.find((k) => k.id === kubelek);

  /* Ekran trzyma się okna, a przewijają się KOLUMNY (0.165.0). Pion strony był
     tu drogą do zgubienia kolejki: żeby dojść do dołu dowodów, operator
     zjeżdżał z oczu liście, po której chodzi klawiszami.

     Pasek kartotek stoi POZA gridem, w zewnętrznej kolumnie. Jako warunkowy
     wiersz `auto` byłby pułapką: bez paska pierwsza karta wpadałaby w ten
     wiersz i cała blokada znikała. Kolumna flexa nie ma tego problemu — nie
     ma dziecka, nie ma wiersza, nie ma odstępu.

     `lg:grid-rows-[minmax(0,1fr)]` nie jest ozdobą: pojedynczy wiersz `auto`
     mierzy się do `max-content`, więc przy treści wyższej niż okno grid
     wylewałby się poza kontener zamiast przyciąć ścieżkę. */
  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {data?.kartoteki && <PasekKartotek bilans={data.kartoteki} />}
    <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
    <Karta className="flex min-h-0 flex-col overflow-hidden">
      {/* `shrink-0` na blokach nad listą nie jest kosmetyką: lista ma bazę 0,
          więc przy ciasnym oknie kurczyłyby się WYŁĄCZNIE one. */}
      <nav className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 p-2">
        {KUBELKI.map((k, i) => {
          const ile = data?.liczniki?.[k.id] ?? 0;
          const aktywny = k.id === kubelek;
          return <button key={k.id} onClick={() => przelacz(k.id)}
            title={`${k.pytanie} (klawisz ${i + 1})`}
            className={`rounded-md px-2 py-1 text-xs font-bold ${
              aktywny ? "bg-wertis-amber text-wertis-ink" : "text-slate-600 hover:bg-slate-100"}`}>
            {k.etykieta}<span className="ml-1 tabular-nums opacity-70">{ile}</span>
          </button>;
        })}
        <button onClick={() => przelacz(null)} title="Wszystkie zwroty (klawisz 7)"
          className={`rounded-md px-2 py-1 text-xs font-bold ${
            kubelek === null ? "bg-wertis-amber text-wertis-ink" : "text-slate-600 hover:bg-slate-100"}`}>
          Wszystkie<span className="ml-1 tabular-nums opacity-70">
            {data?.zwroty?.length ?? 0}</span>
        </button>
      </nav>

      {/* Filtr przewoźnika i kolejność. Oba liczą się w pamięci ekranu, tak
          samo jak kubełek — lista i tak przyjeżdża w całości. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-2 py-1.5 text-xs">
        <select className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
          aria-label="Przewoźnik" value={przewoznik}
          onChange={(e) => setPrzewoznik(e.target.value)}>
          <option value="">Każdy przewoźnik</option>
          {przewoznicy.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-1 text-slate-600">
          <input type="checkbox" checked={poNadaniu}
            onChange={() => setPoNadaniu((v) => !v)} />
          Od daty nadania
        </label>
        {/* Eksport zostawia ŚLAD w dzienniku, bo wynosi loginy kupujących —
            ta sama zasada co przy analizie i audycie. */}
        <a href="/api/obsluga/zwroty/csv" className="ml-auto text-slate-500 underline
          underline-offset-2 hover:text-slate-800">Pobierz CSV</a>
      </div>
      <Szukanie
        wynik={wynikSkanu} kod={kod} fraza={fraza} ile={pasujace?.length ?? null}
        szuka={skan.isPending} dociaga={dociagnij.isPending} blad={bladSkanu}
        onFraza={(v) => { setFraza(v); if (!v) setWynikSkanu(null); }}
        onSzukaj={szukaj}
        onDociagnij={(v) => dociagnij.mutate(v, {
          onSuccess: przyjmij, onError: (e) => setBladSkanu((e as Error).message) })}
        onWybierz={(x) => { setWynikSkanu(null); nawiguj(`/obsluga/zwroty/${x}`); }} />

      {/* Pytanie kubełka stoi NAD listą, bo to ono zastępuje menu akcji.
          Przy włączonym filtrze milknie: lista nie jest wtedy kubełkiem,
          więc jego pytanie mówiłoby nieprawdę o tym, co widać. */}
      {!pasujace && kubelek !== null && <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
        {opis?.pytanie}
      </p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading
          ? <p className="p-6 text-center text-sm text-slate-500">Wczytuję kolejkę…</p>
          : <Kolejka zwroty={widoczne} wybrany={wybrany} zKubelkiem={Boolean(pasujace) || kubelek === null}
              onWybierz={(z) => nawiguj(`/obsluga/zwroty/${z}`)} />}
      </div>
    </Karta>

    <Karta className="flex min-h-0 flex-col overflow-hidden">
      {!zwrot
        ? <Pusto ikona={<Undo2 size={40} className="text-slate-300" />}>
            Wybierz zwrot z kolejki — strzałkami albo kliknięciem.</Pusto>
        : <>
            {/* Pytanie bierze się z kubełka WYBRANEGO zwrotu, nie z zakładki
                listy. Te dwie rzeczy rozjeżdżają się przy wejściu z paska
                adresu, a wtedy nagłówek pytałby o co innego niż klawisze. */}
            <header className="shrink-0 border-b border-slate-200 p-4">
              <h2 className="text-lg font-bold">{zwrot.numer ?? zwrot.externalId}</h2>
              <p className="text-sm text-slate-500">
                {KUBELKI.find((k) => k.id === zwrot.kubelek)?.pytanie}</p>
            </header>
            {/* Pasek stoi NAD produktami i nie przewija się razem z nimi:
                decyzja o całym zwrocie ma być pod ręką także wtedy, gdy
                operator zjechał na dziewiątą pozycję. */}
            <Decyzje zwrot={zwrot} trwa={trwa} blad={bladDecyzji}
              onWerdykt={(decyzja, powod) =>
                werdykt.mutate({ id: zwrot.id, decyzja, powod, wersja: zwrot.wersja })}
              onKorekta={(numer) =>
                korekta.mutate({ id: zwrot.id, numer, wersja: zwrot.wersja })}
              onCofnijKorekte={() =>
                cofnijKorekte.mutate({ id: zwrot.id, wersja: zwrot.wersja })} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Pozycje zwrot={zwrot} trwa={trwa} blad={bladDecyzji}
                trwaRabat={rabat.isPending} bladRabatu={bladRabatu}
                onOcena={(pozycjaId, ocena) =>
                  ocena2.mutate({ pozycjaId, ocena, wersja: zwrot.wersja })}
                onKwota={(pozycjeIds, dostawa) =>
                  kwota.mutate({ id: zwrot.id, pozycjeIds, dostawa, wersja: zwrot.wersja })}
                onZglosRabat={(pozycjaId) => {
                  setBladRabatu("");
                  rabat.mutate({ pozycjaId },
                    { onError: (e) => setBladRabatu((e as Error).message) });
                }} />
            </div>
          </>}
    </Karta>

    {/* Cała ta kolumna jest do czytania, więc cała jedzie do scrollera —
        `Dowody` nie muszą o tym wiedzieć. */}
    <Karta className="flex min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
      {zwrot
        ? <Dowody zwrot={zwrot} />
        : <p className="p-6 text-center text-sm text-slate-500">
            Dowody pokażą się po wybraniu zwrotu.</p>}
      </div>
    </Karta>
    </div>
  </div>;
}
