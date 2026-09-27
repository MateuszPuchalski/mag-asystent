import React, { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, BellDot, CalendarClock, ChevronDown, ChevronRight, ClipboardList, ExternalLink,
  MessageSquare, MessagesSquare, Scale, ShoppingBag, StickyNote, Undo2, UserRound,
} from "lucide-react";
import { useJa } from "../api/rozmowy";
import {
  useCofnijNotatkeKlienta, useKrokSprawy, useNotatkaKlienta, useProfilKlienta, usePrzejmijSprawe,
  useWznowSprawe, useZakonczSprawe, type NoweZdarzenie, type ProfilKlienta as Profil,
  type RodzajSprawyKlienta, type SprawaKlienta,
} from "../api/spoiwo";
import { zlote } from "../api/zwroty";
import { Cofniecie, type DoCofniecia } from "../skrzynka/Cofniecie";
import { WidokHistorii } from "../skrzynka/Klient";
import { dzienZKalendarza, opisTerminu, terminyOdlozenia } from "../skrzynka/terminOdlozenia";
import { Blad, Karta, LoginKlienta, Przycisk, Pusto, czas, dataLokalna, dzien, termin } from "../ui";

/* ── PROFIL KLIENTA (24 września 2026) ───────────────────────────────────────
   Zgłoszenie właściciela: „profil klienta ze wszystkim, co z nim związane,
   w jednym widoku". Do tej wersji klient nie miał adresu — jego historia
   stała zawsze PRZY sprawie, w zakładce KLIENT albo w szufladzie zwrotu.
   Teraz ma własny ekran, do którego prowadzi szukanie i każda historia.

   KOLEJNOŚĆ TO KOLEJNOŚĆ PYTAŃ agenta, który otwiera profil przed odpowiedzią:
   „czy coś się pali" (sygnały), „co jest otwarte", „co kupił", „kim jest"
   (notatka, maszyny, cała oś). Liczby w nagłówku odpowiadają na „jak duży to
   klient" jednym spojrzeniem.

   EKRAN JEST ODCZYTEM, poza notatką i sprawą klienta (S6, @wydanie) — oba
   zapisy idą wyłącznie na kliknięcie, otwarcie nie mutuje niczego. Sprawy
   z kolejek załatwia się na ich ekranach; tu każdy wiersz do nich prowadzi.
   Sprawa klienta mieszka TUTAJ, bo jej kluczem jest login, a login ma
   dokładnie jeden ekran. */

const IKONY: Record<RodzajSprawyKlienta, React.ComponentType<{ size?: number; className?: string }>> = {
  rozmowa: MessageSquare, zwrot: Undo2, reklamacja: Scale, dyskusja: MessagesSquare,
};
const NAZWY: Record<RodzajSprawyKlienta, string> = {
  rozmowa: "Rozmowa", zwrot: "Zwrot", reklamacja: "Reklamacja", dyskusja: "Dyskusja",
};

export function ProfilKlienta() {
  const { login = "" } = useParams();
  const p = useProfilKlienta(login);
  const nawiguj = useNavigate();

  if (p.isLoading) return <Pusto waga="lista">Wczytuję profil…</Pusto>;
  if (p.error || !p.data) {
    return <Karta className="p-4"><Pusto waga="lista" ikona={UserRound}>
      {(p.error as Error | null)?.message ?? "Nie znamy klienta o takim loginie."}</Pusto></Karta>;
  }
  const d = p.data;

  /* Własny scroller — rama panelu nie przewija za ekrany. */
  return <div className="space-y-4 lg:h-full lg:overflow-y-auto">
    <Naglowek d={d} />
    {d.sygnaly.length > 0 && <Sygnaly d={d} />}
    {/* Pod sygnałami, nad kolejkami: odpowiada na „co ja z tym klientem
        robię", czyli pytanie, z którym prowadzący otwiera profil.
        KLUCZ PO LOGINIE: przejście z profilu A na zapamiętany profil B nie
        odmontowuje karty, a z nią zostawały jej stan i pasek „Cofnij".
        Cofnięcie z karty A wysłało wtedy wersję A pod adres B. */}
    <KartaSprawy key={d.login.toLowerCase()} d={d} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4">
        <Otwarte d={d} />
        <Zamowienia d={d} />
      </div>
      <div className="space-y-4">
        {/* Ten sam klucz z tego samego powodu: szkic notatki A nie ma prawa
            przejść na klienta B. */}
        <Notatka key={d.login.toLowerCase()} login={d.login} notatka={d.notatka} />
        {/* Oś i maszyny w tym samym widoku co zakładka KLIENT i szuflada —
            klienta czyta się tak samo, skądkolwiek się przyszło. */}
        <Karta className="p-0">
          <WidokHistorii historia={{ login: d.login, maszyny: d.maszyny, wpisy: d.os }}
            tutaj="tym profilem" bezProfilu onOtworzRozmowe={(r) => nawiguj(`/obsluga/skrzynka/${r}`)} />
        </Karta>
      </div>
    </div>
  </div>;
}

function Liczba({ ile, podpis }: { ile: React.ReactNode; podpis: string }) {
  return <div className="min-w-0">
    <p className="text-naglowek font-bold tabular-nums text-slate-900">{ile}</p>
    <p className="text-podpis text-slate-600">{podpis}</p>
  </div>;
}

function Naglowek({ d }: { d: Profil }) {
  const l = d.liczby;
  return <Karta className="p-4">
    <div className="flex flex-wrap items-center gap-3">
      <UserRound size={20} className="text-slate-500" />
      <LoginKlienta login={d.login} className="text-tytul font-bold text-slate-900" />
      {l.pierwszyZakup && <span className="text-sm text-slate-600">
        klient od {dzien(l.pierwszyZakup)}</span>}
    </div>
    <div className="mt-3 grid grid-cols-3 gap-4 sm:grid-cols-6">
      <Liczba ile={l.zamowien} podpis="zamówienia" />
      <Liczba ile={zlote(l.wydanoGrosze, l.waluta ?? "PLN")} podpis="zapłacone" />
      <Liczba ile={l.rozmow} podpis="rozmowy" />
      <Liczba ile={l.zwrotow} podpis="zwroty" />
      <Liczba ile={l.reklamacji} podpis="reklamacje" />
      <Liczba ile={l.dyskusji} podpis="dyskusje" />
    </div>
  </Karta>;
}

/* Sygnały na górze, bo odpowiadają na „czy coś się pali". Czerwień WYŁĄCZNIE
   przy tonie „źle" — kolor zapalany zawsze uczy go ignorować. */
function Sygnaly({ d }: { d: Profil }) {
  return <ul className="flex flex-wrap gap-2" aria-label="Sygnały">
    {d.sygnaly.map((s, i) => {
      const klasa = `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
        s.ton === "zle" ? "bg-red-50 text-ranga-zle" : "bg-slate-100 text-slate-800"}`;
      const tresc = <><AlertTriangle size={14} />{s.tekst}</>;
      return <li key={i}>{!s.cel
        ? <span className={klasa}>{tresc}</span>
        : s.cel.startsWith("/")
          ? <Link to={s.cel} className={`${klasa} hover:underline`}>{tresc}</Link>
          : <a href={s.cel} target="_blank" rel="noreferrer"
              className={`${klasa} hover:underline`}>{tresc}<ExternalLink size={12} /></a>}</li>;
    })}
  </ul>;
}

/* ── SPRAWA KLIENTA (S6, @wydanie) ──────────────────────────────────────────
   Decyzja właściciela z 26 września 2026 (`docs/obsluga-klienta-calosc.md`
   S6). Jedna osoba prowadzi braki, kontakt i reklamacje, a jej listą zadań
   były powiadomienia Allegro w Gmailu. Sprawa trzyma cztery rzeczy: kto
   prowadzi, następny krok z terminem, zakończenie i przebudzenie, gdy klient
   dopisze coś nowego. Stanu kolejek nie trzyma — ten stoi kartę niżej.

   ZWINIĘTA DOMYŚLNIE (dekalog p. 2). Większość klientów sprawy nie ma, więc
   karta mówi wtedy jedno zdanie. Formularz rozwija się dopiero na kliknięcie.

   KROK TO JEDYNA DROGA do założenia i wznowienia sprawy. Bez kroku sprawa się
   kończy, więc nie ma „Usuń krok" ani „Otwórz ponownie". Pomyłkę przy
   zakończeniu cofa wspólny pasek „Cofnij" (powód w `Cofniecie.tsx`). Sprawę
   zakończoną, którą klient obudził, zaczyna się nowym krokiem albo kończy
   znów jednym kliknięciem, gdy nic nie zostało do zrobienia. Dwa przyciski
   na jedno znaczenie to decyzja więcej przy każdym kliknięciu (dekalog p. 5). */

/** Lustro `LIMIT_KROKU` i `NAJDLUZSZY_KROK_DNI` z `services/prowadzenie-klienta.ts`. */
const LIMIT_KROKU = 200;
const NAJDLUZSZY_KROK_DNI = 60;
const DOBA_MS = 86_400_000;

/* Trzy kroki, które biuro nazwało w wywiadzie z 26 września 2026. Wypełniają
   pole, nie zapisują: „dosłać" bez dopisku, CO dosłać, bywa za krótkie. */
const PODPOWIEDZI_KROKU = ["czekamy na zwrot", "dosłać", "czekamy na dostawcę"] as const;

function KartaSprawy({ d }: { d: Profil }) {
  const s = d.sprawa;
  const ja = useJa();
  const krok = useKrokSprawy(d.login);
  const zakoncz = useZakonczSprawe(d.login);
  const wznow = useWznowSprawe(d.login);
  const przejmij = usePrzejmijSprawe(d.login);
  const [forma, setForma] = useState(false);
  /* Jeden błąd na kartę, nie cztery: pomyłka starej czynności nie może wisieć
     nad udaną nową, a `error` mutacji trwa aż do jej następnego wywołania. */
  const [blad, setBlad] = useState<string | null>(null);
  const [doCofniecia, setDoCofniecia] = useState<DoCofniecia | null>(null);
  const pracuje = krok.isPending || zakoncz.isPending || wznow.isPending || przejmij.isPending;
  /* Po zamknięciu formularza fokus wraca na przycisk, który go otworzył.
     Pole z fokusem znika razem z formularzem, a wtedy klawiatura lądowała
     na początku dokumentu, daleko od karty. */
  const wnetrze = useRef<HTMLDivElement>(null);
  const bylaForma = useRef(false);
  useEffect(() => {
    if (bylaForma.current && !forma) {
      wnetrze.current?.querySelector<HTMLButtonElement>("[data-otwiera-krok]")?.focus();
    }
    bylaForma.current = forma;
  }, [forma]);
  const jaId = ja.data?.user.userId ?? null;
  /* Porównanie po IDENTYFIKATORZE, nie po imieniu (lekcja 0.278.0): dwie Ole
     w biurze to dwie osoby. Dopóki nie wiemy, kim jesteśmy, „Przejmij" się
     nie pokazuje — lepiej o klik później niż przejęcie własnej sprawy. */
  const moja = s !== null && s.prowadziId !== null && s.prowadziId === jaId;
  const cudza = s?.stan === "w_toku" && s.prowadziId !== null && jaId !== null && s.prowadziId !== jaId;
  const naBlad = (e: Error) => setBlad(e.message);

  /* Każdy nowy zapis zdejmuje pasek „Cofnij". Jego domknięcie pamięta
     wersję z odpowiedzi zakończenia, a po kroku ta wersja jest już stara:
     „Cofnij" dałoby 409 „zmienił ktoś inny", choć zmienił sam agent. */
  const zapiszKrok = (tekst: string, kiedy: Date) => {
    setDoCofniecia(null);
    setBlad(null);
    /* Bez sprawy nie ma wersji ani odcisku: `wersja: 0` mówi serwerowi, że
       wiersza jeszcze nie ma. Odcisk jedzie pusty, bo trasa wymaga każdego
       klucza, a przy pierwszym kroku serwer go nie sprawdza (`sprawdzOdcisk`):
       sprawa, której nie było, nie potwierdza żadnego „nowego". */
    krok.mutate({ krok: tekst, krokDo: kiedy.toISOString(), wersja: s?.wersja ?? 0, odcisk: s?.odcisk ?? "" },
      { onSuccess: () => setForma(false), onError: naBlad });
  };
  const zakonczSprawe = (sprawa: SprawaKlienta) => {
    setDoCofniecia(null);
    setBlad(null);
    /* Ponowne zakończenie obudzonej NIE dostaje paska. Cofnięcie otworzyłoby
       sprawę z krokiem, którego termin zwykle już minął, zamiast przywrócić
       obudzoną zakończoną — serwer takiego cofnięcia odmawia. */
    const zCofnieciem = sprawa.stan === "w_toku";
    zakoncz.mutate({ wersja: sprawa.wersja, odcisk: sprawa.odcisk }, {
      /* Cofnięcie niesie wersję i odcisk z ODPOWIEDZI zakończenia, nie
         z ekranu: ekran pamięta stan sprzed zapisu, a serwer odmówiłby go
         jako nieświeżego — i „Cofnij" nie cofnęłoby niczego. */
      onSuccess: ({ sprawa: po }) => {
        if (!zCofnieciem) return;
        setDoCofniecia({ klucz: Date.now(), opis: "Sprawa zakończona", cofnij: () => {
          setBlad(null);
          wznow.mutate({ wersja: po.wersja, odcisk: po.odcisk }, { onError: naBlad });
        } });
      },
      onError: naBlad,
    });
  };

  return <Karta className="p-4" role="region" aria-label="Sprawa klienta"><div ref={wnetrze}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <ClipboardList size={16} className="shrink-0 text-slate-500" />
      {!s
        ? <>
            <span className="text-slate-600">Brak sprawy klienta</span>
            {!forma && <Przycisk data-otwiera-krok className="ml-auto" onClick={() => setForma(true)}>
              Ustaw krok</Przycisk>}
          </>
        : s.stan === "w_toku"
        ? <>
            <span className="min-w-0 text-slate-800">Krok: <b className="text-slate-900">{s.krok}</b>
              {" · "}<span className="whitespace-nowrap tabular-nums">{termin(s.krokDo)}</span></span>
            {/* Czerwień WYŁĄCZNIE po terminie — ta sama zasada co przy sygnałach.
                „Dziś" to informacja, nie alarm, więc zostaje szare. */}
            {s.poTerminie
              ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">po terminie</span>
              : s.dzis && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-800">dziś</span>}
            {(moja || s.prowadzi) && <span className="text-slate-600">
              · {moja ? "prowadzisz" : `prowadzi ${s.prowadzi}`}</span>}
          </>
        : <>
            <span className="text-slate-800">Sprawa zakończona {dzien(s.zakonczonoAt)}
              {s.zakonczyl && `, ${s.zakonczyl}`}</span>
            <span className="min-w-0 truncate text-slate-600">· ostatni krok: {s.krok}</span>
          </>}
    </div>

    {s && <NoweOdKlienta nowe={s.nowe} />}

    {/* Podpowiedź, nie automat: zakończenie to werdykt człowieka. Serwer liczy
        warunek (nic w kolejkach i dzień kroku nadszedł), ekran tylko pyta. */}
    {s?.stan === "w_toku" && d.podpowiedzZakonczenia && <p className="mt-2 text-sm text-slate-700">
      Nic nie czeka w kolejkach, a termin kroku „{s.krok}” minął. Zakończ sprawę?</p>}

    {s && !forma && <div className="mt-3 flex flex-wrap gap-2">
      {s.stan === "w_toku"
        ? <>
            <Przycisk data-otwiera-krok disabled={pracuje} onClick={() => setForma(true)}>Zmień krok</Przycisk>
            {/* Przy podpowiedzi zakończenie staje się akcją główną — jedna
                decyzja mniej, gdy serwer już wie, że nic nie czeka. */}
            <Przycisk wariant={d.podpowiedzZakonczenia ? "glowny" : "drugi"} disabled={pracuje}
              onClick={() => zakonczSprawe(s)}>Zakończ sprawę</Przycisk>
            {cudza && <Przycisk disabled={pracuje} onClick={() => {
              setDoCofniecia(null);
              setBlad(null);
              przejmij.mutate({ wersja: s.wersja, odcisk: s.odcisk }, { onError: naBlad });
            }}>Przejmij</Przycisk>}
          </>
        : <>
            <Przycisk data-otwiera-krok disabled={pracuje} onClick={() => setForma(true)}>Ustaw krok</Przycisk>
            {/* Obudzona, a nic nie zostało do zrobienia („Zwrot dotarł" po
                zwrocie pieniędzy): jedno kliknięcie gasi obudzenie. Bez niego
                trzeba było wymyślić krok na jutro i zakończyć sprawę drugi raz,
                a wiersz stał do tego czasu na samej górze „Moje". */}
            {s.nowe.length > 0 && <Przycisk disabled={pracuje} onClick={() => zakonczSprawe(s)}>
              Zakończ sprawę</Przycisk>}
          </>}
    </div>}

    {forma && <FormularzKroku poczatek={s?.krok ?? ""} pracuje={pracuje} onZapisz={zapiszKrok}
      onAnuluj={() => { setForma(false); setBlad(null); }} />}

    {blad && <div className="mt-2"><Blad>{blad}</Blad></div>}

    {/* Pasek w tym samym miejscu co w skrzynce — jedno „Cofnij" w panelu,
        w jednym miejscu, żeby ręka nie uczyła się drugiego. */}
    {doCofniecia && <div className="fixed bottom-4 left-4 z-40 w-[min(23rem,calc(100vw-2rem))]">
      <Cofniecie wpis={doCofniecia} onZamknij={() => setDoCofniecia(null)} />
    </div>}
  </div></Karta>;
}

/* Powód przebudzenia słowami panelu, z odnośnikiem do źródła. Zdanie składa
   serwer, żeby „Klient napisał" znaczyło to samo w profilu i na liście „Moje". */
function NoweOdKlienta({ nowe }: { nowe: NoweZdarzenie[] }) {
  if (nowe.length === 0) return null;
  const klasa = "inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900";
  return <ul className="mt-2 space-y-1" aria-label="Nowe od klienta">
    {nowe.map((n, i) => {
      const tresc = <><BellDot size={14} className="shrink-0 text-slate-500" />{n.tekst}</>;
      return <li key={`${n.rodzaj}-${i}`}>{n.cel
        ? <Link to={n.cel} className={`${klasa} hover:underline`}>{tresc}</Link>
        : <span className={klasa}>{tresc}</span>}</li>;
    })}
  </ul>;
}

/* Granice kalendarza kroku, liczone jak na serwerze. Od jutra, bo kalendarz
   daje dzień na 8:00, a dzisiejsza ósma zwykle już minęła — serwer odrzuca
   termin w przeszłości. Sufit to sześćdziesiąt dni od TERAZ, co do
   milisekundy: przed ósmą rano 8:00 ostatniego dnia leży już za sufitem,
   więc wtedy ostatnim dniem jest dzień wcześniejszy. */
function granicaKalendarza(teraz: Date) {
  const jutro = new Date(teraz);
  jutro.setDate(jutro.getDate() + 1);
  const najwczesniej = dzienZKalendarza(dataLokalna(jutro.toISOString())) ?? jutro;
  const sufit = teraz.getTime() + NAJDLUZSZY_KROK_DNI * DOBA_MS;
  const najpozniej = dzienZKalendarza(dataLokalna(new Date(sufit).toISOString())) ?? new Date(sufit);
  if (najpozniej.getTime() > sufit) najpozniej.setDate(najpozniej.getDate() - 1);
  return {
    najwczesniej, najpozniej,
    min: dataLokalna(najwczesniej.toISOString()), max: dataLokalna(najpozniej.toISOString()),
  };
}

/* FORMULARZ KROKU. Gotowy termin ZAPISUJE od razu — wpisany krok i jedno
   kliknięcie, jak przy odłożeniu rozmowy (`terminOdlozenia.ts`, dekalog
   p. 1: wybór zamiast wpisywania). Kalendarz zostaje na resztę jako czwarta
   droga i dopiero on potrzebuje osobnego „Zapisz krok". */
function FormularzKroku({ poczatek, pracuje, onZapisz, onAnuluj }: {
  poczatek: string;
  pracuje: boolean;
  onZapisz: (krok: string, kiedy: Date) => void;
  onAnuluj: () => void;
}) {
  const [tekst, setTekst] = useState(poczatek);
  const [kalendarz, setKalendarz] = useState("");
  /* Chwila otwarcia formularza, nie każdego przerysowania: gotowe terminy
     i granice kalendarza nie mają skakać pod kursorem w trakcie pisania. */
  const [teraz] = useState(() => new Date());
  const pole = useRef<HTMLInputElement>(null);
  const idTerminow = useId();
  const g = granicaKalendarza(teraz);
  const krok = tekst.trim();
  const wybrany = dzienZKalendarza(kalendarz);
  const dobryDzien = wybrany !== null && wybrany.getTime() >= g.najwczesniej.getTime()
    && wybrany.getTime() <= g.najpozniej.getTime();

  return <form className="mt-3 space-y-2 border-t border-slate-100 pt-3" aria-label="Następny krok"
    onSubmit={(e) => { e.preventDefault(); if (krok && wybrany && dobryDzien && !pracuje) onZapisz(krok, wybrany); }}>
    <label className="block text-sm font-semibold text-slate-800" htmlFor="krok-sprawy">Następny krok</label>
    {/* Kursor od razu w polu: formularz otwiera się po to, żeby coś wpisać. */}
    <input id="krok-sprawy" ref={pole} autoFocus value={tekst} maxLength={LIMIT_KROKU}
      onChange={(e) => setTekst(e.target.value)} placeholder="Co ma się stać, np. czekamy na zwrot"
      className="field text-sm" />
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Podpowiedzi kroku">
      {PODPOWIEDZI_KROKU.map((p) => <button key={p} type="button"
        onClick={() => { setTekst(p); pole.current?.focus(); }}
        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
        {p}</button>)}
    </div>
    {/* Grupa nazwana tym zdaniem: czytnik ekranu mówi przy każdym przycisku,
        że on ZAPISUJE, a nie tylko wybiera datę. */}
    <p id={idTerminow} className="text-xs text-slate-600">Zapisz z terminem:</p>
    <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={idTerminow}>
      {terminyOdlozenia(teraz).map((t) => <button key={t.etykieta} type="button"
        disabled={!krok || pracuje} onClick={() => onZapisz(krok, t.kiedy)}
        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
        <CalendarClock size={13} />{opisTerminu(t.kiedy)}
        <span className="font-normal text-slate-600">· {t.etykieta.toLowerCase()}</span>
      </button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" aria-label="Termin kroku" min={g.min} max={g.max} value={kalendarz}
        onChange={(e) => setKalendarz(e.target.value)} className="field w-auto text-sm" />
      <Przycisk type="submit" wariant="glowny" disabled={!krok || !dobryDzien || pracuje}>Zapisz krok</Przycisk>
      <Przycisk type="button" onClick={onAnuluj}>Anuluj</Przycisk>
    </div>
  </form>;
}

/* „OTWARTE W KOLEJKACH", nie „Otwarte sprawy" (@wydanie). Od sprawy klienta
   słowo „sprawa" na tym ekranie znaczy jedno: to, co ktoś prowadzi dla
   klienta. Wiersze tutaj to byty kolejek, każdy ze swoim właścicielem. */
function Otwarte({ d }: { d: Profil }) {
  return <Karta className="overflow-hidden p-0" role="region" aria-label="Otwarte w kolejkach">
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2"><b>Otwarte w kolejkach</b>
      <span className="ml-2 text-sm text-slate-600">{d.otwarte.length}</span></div>
    {d.otwarte.length === 0
      ? <p className="px-4 py-2 text-sm text-slate-500">Nic nie jest otwarte.</p>
      : <ul>{d.otwarte.map((o) => {
          const Ikona = IKONY[o.rodzaj];
          return <li key={`${o.rodzaj}-${o.id}`} className="border-t first:border-t-0">
            <Link to={o.cel} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
              <Ikona size={15} className="shrink-0 text-slate-500" />
              <span className="w-24 shrink-0 text-xs font-semibold text-slate-600">{NAZWY[o.rodzaj]}</span>
              <span className="min-w-0 flex-1 truncate">{o.opis}</span>
              <span className="shrink-0 text-xs font-semibold text-slate-700">{o.stan}</span>
              <ChevronRight size={15} className="shrink-0 text-slate-400" />
            </Link>
          </li>;
        })}</ul>}
  </Karta>;
}

/* Zamówienie rozwija się do pozycji i paczki. Zwinięte domyślnie: przy stałym
   kliencie lista ma kilkanaście zakupów, a pytanie dotyczy zwykle jednego. */
function Zamowienia({ d }: { d: Profil }) {
  const [otwarte, setOtwarte] = useState<string | null>(null);
  return <Karta className="overflow-hidden p-0" role="region" aria-label="Zamówienia">
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2"><b>Zamówienia</b>
      <span className="ml-2 text-sm text-slate-600">{d.zamowienia.length}</span></div>
    {d.zamowienia.length === 0
      ? <p className="px-4 py-2 text-sm text-slate-500">Nie kupował u nas.</p>
      : <ul>{d.zamowienia.map((z) => {
          const rozwiniete = otwarte === z.id;
          const anulowane = z.status === "CANCELLED";
          return <li key={z.id} className="border-t first:border-t-0">
            <button type="button" aria-expanded={rozwiniete}
              onClick={() => setOtwarte(rozwiniete ? null : z.id)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50 ${
                anulowane ? "text-slate-500" : ""}`}>
              {rozwiniete ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
              <ShoppingBag size={15} className="shrink-0 text-slate-500" />
              <span className="w-32 shrink-0 whitespace-nowrap tabular-nums">{z.kupionoAt ? dzien(z.kupionoAt) : "—"}</span>
              <span className="min-w-0 flex-1 truncate">
                {z.pozycje.map((p) => p.nazwa).join(", ") || "Zamówienie bez pozycji"}</span>
              <span className="shrink-0 text-xs text-slate-600">
                {anulowane ? "anulowane" : z.przesylka ?? ""}</span>
              <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                {zlote(z.sumaGrosze, z.waluta ?? "PLN")}</span>
            </button>
            {rozwiniete && <div className="border-t border-slate-100 bg-slate-50 px-12 py-2 text-sm">
              <ul className="space-y-0.5">
                {z.pozycje.map((p, i) => <li key={i} className="flex gap-3">
                  <span className="w-10 shrink-0 tabular-nums text-slate-600">{p.ilosc}×</span>
                  <span className="min-w-0 flex-1">{p.nazwa}</span>
                  <span className="shrink-0 tabular-nums">{zlote(p.cenaGrosze, z.waluta ?? "PLN")}</span>
                </li>)}
              </ul>
              {z.link && <a href={z.link} target="_blank" rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-slate-600 underline hover:text-slate-900">
                zamówienie {z.id} w Allegro<ExternalLink size={11} /></a>}
            </div>}
          </li>;
        })}</ul>}
  </Karta>;
}

/* NOTATKA ZAPISUJE SIĘ NA KLIKNIĘCIE, nie przy każdym znaku: każdy zapis to
   wpis w dzienniku, a „zero zapisu przy patrzeniu" wyklucza zapis przy samym
   otwarciu. Cofnięcie przywraca jedno poprzednie brzmienie. */
function Notatka({ login, notatka }: { login: string; notatka: Profil["notatka"] }) {
  const [tresc, setTresc] = useState(notatka?.tresc ?? "");
  useEffect(() => { setTresc(notatka?.tresc ?? ""); }, [notatka?.tresc]);
  const zapisz = useNotatkaKlienta(login);
  const cofnij = useCofnijNotatkeKlienta(login);
  const zmieniona = tresc.trim() !== (notatka?.tresc ?? "");
  const blad = (zapisz.error ?? cofnij.error) as Error | null;
  return <Karta className="p-4" role="region" aria-label="Notatka o kliencie">
    <p className="mb-2 flex items-center gap-2"><StickyNote size={15} className="text-slate-500" />
      <b>Notatka o kliencie</b></p>
    <label className="sr-only" htmlFor="notatka-klienta">Notatka o kliencie</label>
    <textarea id="notatka-klienta" rows={3} value={tresc} maxLength={1000}
      onChange={(e) => setTresc(e.target.value)}
      placeholder="Co warto wiedzieć przed odpowiedzią — widzi cały zespół"
      className="field w-full resize-y text-sm" />
    <Blad>{blad?.message}</Blad>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Przycisk wariant="glowny" disabled={!zmieniona || zapisz.isPending}
        onClick={() => zapisz.mutate(tresc.trim() || null)}>
        {zapisz.isPending ? "ZAPISUJĘ…" : "ZAPISZ"}</Przycisk>
      {notatka?.cofalna && <Przycisk disabled={cofnij.isPending} onClick={() => cofnij.mutate()}>
        Cofnij</Przycisk>}
      {notatka && <span className="text-xs text-slate-500">{notatka.przez}, {czas(notatka.at)}</span>}
    </div>
  </Karta>;
}
