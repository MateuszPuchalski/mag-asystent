import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search, ShieldQuestion } from "lucide-react";
import {
  useCofnijNotatkeReklamacji, useDodajZalacznikSprawy, useNotatkaReklamacji,
  useOdswiez, useProwadze, useReklamacja, useReklamacje, useSprawdzPrzesylke, useSynchronizuj,
  useUsunZalacznikSprawy, useZalacznikiSprawy,
} from "../api/reklamacje";
import { useJa } from "../api/rozmowy";
import { naBase64 } from "../api/plik";
import type { KubelekReklamacji, Reklamacja } from "../api/typy";
import { DialogKonfliktu } from "../skrzynka/DialogKonfliktu";
import { Edytor } from "../reklamacje/Edytor";
import { Werdykt } from "../reklamacje/Werdykt";
import { useSzkicSprawy } from "../sprawy/useSzkicSprawy";
import { useBledy } from "../sprawy/useBledy";
import { Blad, Karta, Pusto } from "../ui";
import { KUBELKI, Kolejka, kwotaWiersza, wGrupach } from "../reklamacje/Kolejka";
import { PasekSita, ZdanieOUkrytych, mojaSprawa, useSito, wSicie } from "../sprawy/Moje";
import { posortuj, usePorzadek, type OsPorzadku } from "../sprawy/Porzadek";
import { PasekProgu } from "../sprawy/Prog";
import { Czat } from "../reklamacje/Czat";
import { Glowica } from "../reklamacje/Glowica";
import { DrogaSprawy } from "../reklamacje/DrogaSprawy";
import { zdarzeniaPrzesylek } from "../reklamacje/przesylki";
import { Kubelki } from "../reklamacje/Kubelki";
import { PrzyciskSynchronizacji, StanSynchronizacji } from "../reklamacje/Synchronizacja";
import { FiltrKolejki } from "../reklamacje/Filtr";
import { Produkt } from "../reklamacje/Produkt";
import { Notatka } from "../reklamacje/Notatka";
import { liniaPowodu } from "../reklamacje/slownik";
import { useWysylki } from "../reklamacje/useWysylki";
import { pasujeDoFrazy, rozbij } from "../sprawy/szukanie";
import { klawiszZajety } from "../nawigacja/fokus";
import { useKursorListy } from "../nawigacja/kursor";

/* ── Ekran reklamacji: trzy kolumny ──────────────────────────────────────────
   Kolejka, sprawa i decyzja. Kolejka po lewej, bo od niej zaczyna się każda
   praca. Nad listą stoi jeden rząd kubełków z liczbą listy, a synchronizacja
   przy tytule, więc nad kolumnami nic nie zabiera wysokości.
   Sprawa w środku rośnie, bo rozmowę czyta się najdłużej. Decyzja z faktami
   stoi po prawej, bo nieodwracalne pytanie zadaje się PO rozmowie.

   EKRAN JEST UKŁADEM. Wysyłki do Allegro z triażem 409 i dialogiem zgody
   mieszkają w `useWysylki`, a zdania o porażce czynności w `useBledy`.

   UKŁAD ŁAMIE SIĘ W DÓŁ, NIE W BOK. Na szerokim oknie każda kolumna przewija
   się osobno, a na wąskim albo przy powiększeniu 200% kolumny spadają pod
   siebie i przewija się cały ekran. Nic nie wychodzi za kadr (WCAG 1.4.4).

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

/** Osie porządku tej kolejki; pierwsza jest domyślna. */
const OSIE: OsPorzadku[] = ["termin", "otwarto", "ruch", "kwota"];

/* Porządek słowami, ale TYLKO GDY NIE JEST DOMYŚLNY. Domyślny termin widać
   po nagłówku „Po terminie” na górze listy, a zdanie przy każdej sprawie
   powtarzałoby to, co lista mówi sama. */
const OPIS_PORZADKU: Partial<Record<OsPorzadku, string>> = {
  otwarto: "Najnowsze na górze",
  ruch: "Ostatni ruch na górze",
  kwota: "Najdroższe na górze",
};

/** Czynności na sprawie, które kończą się zdaniem o porażce przy swoim przycisku. */
type Czynnosc = "prowadze" | "przesylka" | "zalacznik" | "notatka";

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
  const [bladSync, setBladSync] = useState("");

  /* Próg daty zdejmuje się NA ŻĄDANIE i wybór nie przeżywa zamknięcia
     ekranu. Zapamiętany w przeglądarce pokazałby po tygodniu całe archiwum
     bez śladu, skąd się wzięło. */
  const [bezProgu, setBezProgu] = useState(false);
  const { data, isLoading, error } = useReklamacje(bezProgu);
  const prowadze = useProwadze();
  const synchronizuj = useSynchronizuj();
  const odswiez = useOdswiez();
  const dodajZalacznik = useDodajZalacznikSprawy();
  const usunZalacznik = useUsunZalacznikSprawy();
  const sprawdzPrzesylke = useSprawdzPrzesylke();
  const notatka = useNotatkaReklamacji();
  const cofnijNotatke = useCofnijNotatkeReklamacji();

  const wKubelku = useMemo(() => (data?.reklamacje ?? []).filter((r) =>
    kubelek === null || r.kubelek === kubelek), [data, kubelek]);

  /* Filtry liczą się w pamięci ekranu: lista przyjeżdża w całości, bo spraw
     w pracy są dziesiątki, nie tysiące. Fraza dzieli się po spacjach i każdy
     człon musi trafić, więc „numer login” zawęża zamiast nie znajdować nic. */
  const pasujace = useMemo(() => {
    if (!rozbij(fraza).length) return null;
    return (data?.reklamacje ?? []).filter((r) => pasujeDoFrazy(kody(r), fraza));
  }, [data, fraza]);

  const moi = useMemo(
    () => wKubelku.filter((r) => wSicie(r.prowadziId, mojeId, sito)),
    [wKubelku, sito, mojeId]);

  /* SZUKANIE PRZEBIJA SITO I KUBEŁEK (§25a.9): wpisany numer ma znaleźć
     sprawę także wtedy, gdy prowadzi ją kolega.

     Sortowanie stoi NA KOŃCU łańcucha: najpierw ustala się, CO jest na liście,
     potem w jakiej kolejności. Grupa „Po terminie” idzie po sortowaniu, bo
     strzałki chodzą po tej samej tablicy, którą rysuje kolejka. */
  const widoczne = useMemo(
    () => wGrupach(posortuj(pasujace ?? moi, porzadek, {
      otwarto: (r) => r.otwartoAt,
      ruch: (r) => r.ostatniaWiadomoscAt ?? r.otwartoAt,
      termin: (r) => r.decyzjaDo,
      kwota: kwotaWiersza,
    })),
    [pasujace, moi, porzadek]);
  /* Zdanie liczy to, co chowa sito, bo pamiętanego sita nie widać nigdzie
     indziej. Szukanie przebija sito, więc przy frazie nic nie jest schowane. */
  const ukrytych = pasujace || sito === null ? 0 : wKubelku.length - moi.length;
  const wybrana = id ? Number(id) : null;
  /* Szkic stoi ZARAZ ZA numerem sprawy, bo jest do niego przypisany. */
  const { tresc, ustaw: setTresc, wyczysc: wyczyscSzkic } = useSzkicSprawy("reklamacja", wybrana);
  const reklamacja = data?.reklamacje.find((r) => r.id === wybrana) ?? null;
  const szczegol = useReklamacja(wybrana);
  /* Załączniki szkicu wiszą przy SPRAWIE, nie przy przeglądarce. */
  const zalacznikiWysylki = useZalacznikiSprawy(wybrana);
  const { blad, zBledem } = useBledy<Czynnosc>(wybrana);
  const wysylki = useWysylki({ szczegol: szczegol.data, tresc, onWyslano: wyczyscSzkic });

  /* Wejście z paska adresu na sprawę z innego kubełka ma pokazać TĘ sprawę,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (reklamacja && kubelek !== null && reklamacja.kubelek !== kubelek) setKubelek(reklamacja.kubelek);
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

  /* Po werdykcie sprawa schodzi z kubełka, a `j` ma otworzyć tę, która
     stanęła na jej miejscu. Powód przy `nawigacja/kursor.ts`. */
  const idz = useKursorListy(widoczne, wybrana, (r) => nawiguj(`/obsluga/reklamacje/${r.id}`));

  /* ── WEJŚCIE W SPRAWĘ JĄ ODŚWIEŻA ──────────────────────────────────────────
     Agent pracuje na aktualnej sprawie. Przebieg synchronizacji przychodzi
     co trzy minuty i czyta najwyżej tysiąc spraw, a agent patrzy na sprawę
     teraz. To świadomy wyjątek od „zera zapisu przy patrzeniu”, decyzją
     właściciela. Trasa `/odswiez` jest POST-em po to, żeby był GŁOŚNY.

     Jedno żądanie na sprawę: `ostatnioOdswiezona` pilnuje, żeby nie powtórzyć
     go przy renderze ani drugi raz w trybie ścisłym Reacta. Błąd zostawia
     ekran w spokoju, bo odświeżenie jest dopiskiem, nie czynnością agenta. */
  const ostatnioOdswiezona = useRef<number | null>(null);
  useEffect(() => {
    if (wybrana === null || ostatnioOdswiezona.current === wybrana) return;
    ostatnioOdswiezona.current = wybrana;
    odswiez.mutate({ id: wybrana });
  }, [wybrana]);

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

  const d = szczegol.data;
  const r = d?.reklamacja;

  /* Zapytanie padło i nie ma danych: błąd zamiast listy, a pigułki mówią
     „—”. Pusta lista przy awarii czytałaby się jako „nic nie czeka”. */
  const bezDanych = Boolean(error && !data);

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-y-auto xl:overflow-hidden">
    <div className={UKLAD}>
      <section aria-label="Kolejka reklamacji"
        className={`${KOLUMNA} ${KARTA} flex flex-[1_1_340px] flex-col xl:overflow-hidden`}>
        {/* Tytuł z synchronizacją i filtrem, szukanie, kubełki, sito, lista.
            Liczby stoją raz, w kubełkach, bo drugi licznik tej samej pracy
            to druga decyzja. */}
        <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 px-4 pb-3 pt-4">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <h1 className="text-tytul font-bold text-slate-900">Reklamacje</h1>
                <PrzyciskSynchronizacji trwa={synchronizuj.isPending} onSynchronizuj={synchronizujTeraz} />
              </div>
              <StanSynchronizacji stan={data?.stan} blad={bladSync} />
            </div>
            <FiltrKolejki porzadek={porzadek} osie={OSIE} onPorzadek={ustawPorzadek}
              prog={data?.prog} onPrzelaczProg={setBezProgu} />
          </div>
          <label className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3">
            <Search size={18} aria-hidden="true" className="shrink-0 text-slate-600" />
            <span className="sr-only">Szukaj reklamacji</span>
            <input type="search" className="h-10 min-w-0 flex-1 bg-transparent text-tresc outline-none"
              value={fraza} onChange={(e) => setFraza(e.target.value)}
              placeholder="Login, numer, zamówienie, towar, notatka" />
          </label>
          <Kubelki wybrany={kubelek} onWybierz={przelacz}
            liczniki={data?.liczniki} wszystkich={data?.reklamacje.length} />
          {/* Sito bez danych mówiłoby „Moje 0”, czyli „nic nie czeka”. */}
          {!bezDanych && <div className="flex flex-wrap items-center gap-1.5">
            <PasekSita sito={sito} mojeId={mojeId} onPrzelacz={przelaczSito}
              moich={wKubelku.filter((x) => mojaSprawa(x.prowadziId, mojeId)).length}
              niczyich={wKubelku.filter((x) => x.prowadziId === null).length} />
            {OPIS_PORZADKU[porzadek] &&
              <span className="ml-auto text-xs text-slate-600">{OPIS_PORZADKU[porzadek]}</span>}
          </div>}
        </div>

        {progAlarmuje && data?.prog && <div className="shrink-0 px-3 pt-3">
          <PasekProgu prog={data.prog} onPrzelacz={setBezProgu} /></div>}
        <ZdanieOUkrytych ile={ukrytych} nazwa={sito === "niczyje" ? "Niczyje" : "Moje"}
          onPokazWszystkie={() => przelaczSito(null)} />

        <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          {bezDanych
            ? <div className="p-3"><Blad>{(error as Error).message}</Blad></div>
            : isLoading
            ? <Pusto waga="lista">Wczytuję kolejkę…</Pusto>
            : <Kolejka reklamacje={widoczne} wybrana={wybrana} mojeId={mojeId}
                nazwaGrupy={nazwaGrupy}
                zKubelkiem={Boolean(pasujace) || kubelek === null}
                onWybierz={(x) => nawiguj(`/obsluga/reklamacje/${x}`)} />}
        </div>
      </section>

      {/* Bez kolejki nie ma czego otworzyć, więc środek milczy zamiast
          obiecywać sprawę, która nie przyjdzie. */}
      {bezDanych ? null : d && r
        ? <>
          <section aria-label={`Reklamacja ${r.numer ?? r.externalId}`}
            className={`${KOLUMNA} ${KARTA} flex flex-[999_1_560px] flex-col xl:overflow-y-auto`}>
            <Glowica szczegol={d} mojeId={mojeId} trwa={prowadze.isPending} blad={blad("prowadze")}
              onProwadze={() => prowadze.mutate({ id: r.id, wersja: r.wersja }, zBledem("prowadze"))}
              onOdswiez={() => odswiez.mutate({ id: r.id })} odswieza={odswiez.isPending} />
            <DrogaSprawy dane={d} biezaca={{ rodzaj: "reklamacja", id: r.id }} sprawdzaPrzesylke={sprawdzPrzesylke.isPending}
              bladPrzesylki={blad("przesylka")}
              onSprawdzPrzesylke={() => sprawdzPrzesylke.mutate({ id: r.id }, zBledem("przesylka"))} />
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
                edytor={<Edytor key={r.id} etykietaWyslij="Wyślij do klienta" tresc={tresc}
                  wysyla={wysylki.odpowiedz.trwa} blad={wysylki.odpowiedz.blad}
                  zalaczniki={zalacznikiWysylki.data?.zalaczniki ?? []}
                  dodajeZalacznik={dodajZalacznik.isPending}
                  bladZalacznika={blad("zalacznik")}
                  /* Plik czytamy TU, nie w komponencie: base64 to sprawa
                     klienta HTTP, a katalog `reklamacje/` trzyma komponenty czyste. */
                  onDodajZalacznik={(plik) => {
                    const opcje = zBledem("zalacznik");
                    void naBase64(plik).then((dane) => dodajZalacznik.mutate(
                      { id: r.id, nazwa: plik.name, typ: plik.type, dane }, opcje));
                  }}
                  onUsunZalacznik={(zid) => usunZalacznik.mutate(
                    { id: r.id, zalacznikId: zid }, zBledem("zalacznik"))}
                  czatAktywny={r.czatAktywny}
                  onZmiana={setTresc} onWyslij={wysylki.odpowiedz.wyslij} />} />
            </div>
          </section>

          <aside aria-label="Decyzja i produkt"
            className={`${KOLUMNA} flex flex-[1_1_360px] flex-col gap-4 xl:overflow-y-auto`}>
            {/* Decyzja pierwsza: z niej wychodzi się z ekranu. Zgoda przed
                wysłaniem zostaje przy OBU gałęziach, bo uznanie kosztuje
                pieniądze i jest równie nieodwracalne co odmowa. */}
            <Werdykt reklamacja={r}
              czat={d.czat} trwa={wysylki.werdykt.trwa} blad={wysylki.werdykt.blad}
              bladTowaru={wysylki.werdykt.bladTowaru} onWerdykt={wysylki.werdykt.wyslij}
              /* Niepewny los werdyktu rozstrzyga jedno odświeżenie sprawy,
                 nie drugi werdykt — ten sam hak co wejście w sprawę. */
              onSprawdz={() => odswiez.mutate({ id: r.id })} sprawdza={odswiez.isPending} />
            <Produkt szczegol={d} />
            <Notatka reklamacja={r} trwa={notatka.isPending || cofnijNotatke.isPending}
              blad={blad("notatka")}
              onZapisz={(tekst, gotowe) => notatka.mutate(
                { id: r.id, notatka: tekst.trim() || null, wersja: r.wersja }, zBledem("notatka", gotowe))}
              onCofnij={() => cofnijNotatke.mutate({ id: r.id, wersja: r.wersja }, zBledem("notatka"))} />
          </aside>
        </>
        : <Karta className={`${KOLUMNA} flex flex-[999_1_560px] flex-col xl:col-span-2`}>
            <div className="flex min-h-[12rem] flex-1 items-center px-4">
              <Pusto ikona={ShieldQuestion}>
                {wybrana ? "Wczytuję sprawę…" : "Wybierz reklamację z kolejki po lewej"}
              </Pusto>
            </div>
          </Karta>}
    </div>

    {/* Jawna zgoda po dopisku — dialog ze skrzynki, jeden dla odpowiedzi
        i dla stanowiska o towarze. Klucz zdejmuje zgodę przy zmianie rodzaju. */}
    {wysylki.konflikt && <DialogKonfliktu key={wysylki.konflikt.rodzaj}
      szczegoly={wysylki.konflikt.szczegoly}
      szkic={wysylki.konflikt.szkic}
      wysyla={wysylki.konflikt.wysyla}
      blad={wysylki.konflikt.blad}
      ktoDopisal={wysylki.konflikt.ktoDopisal}
      onWyslijMimoTo={wysylki.konflikt.wyslijMimoTo}
      onPopraw={wysylki.konflikt.popraw} />}
  </div>;
}
