import React from "react";
import { PackageOpen, PackagePlus, X } from "lucide-react";
import {
  useKosz, useMmMimoKorekt, useNowyKoszyk, usePorzucKoszyk, useZamknijKosz, useZdejmijTowar,
} from "../api/zwroty";
import { Przycisk, Blad } from "../ui";
import { DolozTowar } from "./DolozTowar";

/* ── Pasek otwartego koszyka zwrotów (0.192.0) ──────────────────────────────
   Właściciel opisał obieg, który biuro robi od lat ręką: „gdy agent zasiada do
   zwrotów, to otwiera pustą MM i dodaje kolejno przedmioty ze zwrotów; gdy
   koszyk się zapełni, zamyka MM i tak w kółko".

   Ten pasek jest tą pustą MM. Nie ma na nim przycisku „dodaj" i to jest
   decyzja: dokłada ocena „na stan", którą operator i tak naciska przy towarze.
   Osobny przycisk kazałby powiedzieć dwa razy to samo (dekalog, punkt 5).

   Pasek POKAZUJE SIĘ DOPIERO Z ZAWARTOŚCIĄ. Pusty byłby stałym elementem
   mówiącym „zero" — punkt 2 dekalogu każe pokazywać to, co potrzebne teraz,
   a pusty kosz nie jest niczyją pracą.

   Stoi na górze, obok paska kartotek, bo dotyczy CAŁEJ SESJI pracy, a nie
   otwartego zwrotu. Wewnątrz karty zwrotu znikałby przy każdym przejściu do
   następnej paczki — a licznik ma rosnąć na oczach.                          */

export function Koszyk() {
  const { data } = useKosz();
  const zamknij = useZamknijKosz();
  /* Zdejmowanie dotyczy WYŁĄCZNIE wierszy dołożonych ręką (0.365.0). Wiersz
     z oceny schodzi cofnięciem oceny na karcie zwrotu — jedna droga na oba
     kosztowałaby kasowanie cudzej oceny z drugiej strony ekranu. */
  const zdejmij = useZdejmijTowar();
  /* WYMUSZENIE DOKUMENTU (0.368.0) — decyzja właściciela, wyjście awaryjne
     obok bramki z 0.200.0. Osobna mutacja, bo osobna trasa: tę decyzję ma być
     widać, a nie ukrywać w fladze przy zwykłym zamykaniu. */
  const mimo = useMmMimoKorekt();
  /* KOSZYK ZAKŁADANY WPROST (0.378.0) — zgłoszenie właściciela: „potrzebuję
     tworzenia koszy zwrotowych i dodawania produktów do nich jako oddzielna
     opcja". Porzucanie jest warunkiem zakładania, nie ozdobą: pustego kosza
     nie da się zamknąć, więc bez tej drugiej drogi pomyłka stałaby w pasku
     na zawsze. */
  const nowy = useNowyKoszyk();
  const porzuc = usePorzucKoszyk();
  const [pewien, setPewien] = React.useState<number | null>(null);
  /* DWA KOSZYKI OD 0.211.0: zwroty i odpad. Pusty się nie pokazuje — pasek
     rośnie wtedy, kiedy operator naprawdę coś w nim ma. */
  /* PUSTY KOSZYK JEST WIDOCZNY OD 0.378.0, i to nie łamie punktu 2 dekalogu,
     tylko go stosuje. Reguła mówi: pokazuj to, co potrzebne TERAZ. Pudło
     założone wprost JEST bieżącą pracą operatora — stoi przy biurku i czeka na
     pierwszą sztukę. Niewidoczne kazałoby zgadywać, czy przycisk zadziałał. */
  const kosze = data?.kosze ?? [];
  const czekajace = data?.czekajace ?? [];

  const nazwa = (rodzaj: "zwroty" | "odpad") =>
    rodzaj === "odpad" ? "Koszyk odpadu" : "Koszyk zwrotów";

  return <>
    {/* ── ZAŁOŻENIE PUDŁA WPROST (0.378.0) ──────────────────────────────────
        Do tego wydania koszyk powstawał wyłącznie jako SKUTEK UBOCZNY:
        pierwszej oceny „na stan" albo skanu w karcie otwartego zwrotu. Agent,
        który stawia przy biurku pusty karton, ZANIM otworzy pierwszą paczkę,
        nie miał czym go zgłosić.

        Rząd stoi tu, a nie w osobnym ekranie, bo to ta sama praca co reszta
        paska — i bo pudło dotyczy CAŁEJ sesji, nie otwartego zwrotu.

        Przycisk znika, gdy koszyk zwrotów już stoi: naciśnięcie oddałoby ten
        sam kosz (jeden na operatora, decyzja z 3 września 2026), więc byłby to
        przycisk bez skutku. */}
    {!kosze.some((k) => k.rodzaj === "zwroty") &&
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs"
          disabled={nowy.isPending} onClick={() => nowy.mutate({})}>
          <PackagePlus size={12} />
          {nowy.isPending ? "Zakładam…" : "Nowy koszyk zwrotów"}
        </button>
        <span className="text-xs text-slate-500">
          Pudło do zbierania towaru — bez otwierania zwrotu.
        </span>
        {nowy.error && <Blad>{(nowy.error as Error).message}</Blad>}
      </div>}
    {/* Koszyki zamknięte BEZ DOKUMENTU. Stoją NAD otwartym, bo to praca
        zaległa: kosz jest już na hali, a dokumentu wciąż nie ma.

        TRZY POWODY, JEDEN PASEK (0.371.0). Kosz czeka albo na korektę, albo na
        poprawkę zawartości po odmowie Sfery, albo na samo wypuszczenie MM.
        Zdanie mówi, na który z nich — bo „czeka" bez powodu wygląda jak
        zacięta kolejka i wysyła człowieka do kolejki zadań w biurze. */}
    {czekajace.map((c) => <div key={c.id}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
        border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <PackageOpen size={14} className="shrink-0" />
      <b>{nazwa(c.rodzaj)} {c.kod}</b>
      <span className="min-w-0 flex-1">
        {c.blad
          ? <>Sfera odrzuciła MM: <b>{c.blad}</b></>
          : c.brakuje.length > 0
            ? <>czeka na {c.brakuje.length === 1 ? "korektę" : "korekty"}: {
                c.brakuje.map((b) => b.numer).join(", ")}</>
            : <>komplet korekt — MM czeka na wypuszczenie</>}
      </span>
      {/* DLACZEGO czeka — bez tego zdania wygląda to na zaciętą kolejkę. */}
      <span className="w-full text-amber-700">
        {c.blad
          /* Odmowa Sfery bywa o towarze, którego nie da się przesunąć — tak
             zaczął koszyk Z-8, do którego wszedł skanem koszt przesyłki.
             Zdanie mówi, CO z tym zrobić, a nie tylko że jest źle. */
          ? <>Dokumentu nie ma, więc zawartość da się jeszcze poprawić: zdejmij
              wiersz, który tam nie pasuje, i wystaw MM jeszcze raz. Wiersz ze
              zwrotu schodzi cofnięciem oceny na karcie zwrotu.</>
          : c.brakuje.length > 0
            ? <>MM zdejmuje towar z magazynu głównego, a ze zwrotu wraca on tam
                dopiero po korekcie. Dokument wyjdzie sam, gdy dojdzie ostatni
                numer.</>
            : <>Zadanie MM zdjęto przy poprawce zawartości i nikt go nie ponawia
                sam — dokument wychodzi po naciśnięciu.</>}
      </span>
      {/* ── WIERSZE DOŁOŻONE RĘKĄ (0.371.0) ───────────────────────────────
          Od tego wydania da się je zdjąć TAKŻE z kosza zamkniętego, dopóki nie
          ma dokumentu — zgłoszenie właściciela: „pozwól mi edytować koszyki
          zwrotowe, z których nie zostały jeszcze utworzone MM". Bez tego
          pomyłka przy skanie była nie do odkręcenia w aplikacji, a kosz stał
          na hali z dokumentem, którego Sfera nie chciała przyjąć. */}
      {(c.dolozone ?? []).length > 0 &&
        <span className="flex w-full flex-wrap items-center gap-1">
          <span className="text-amber-700">dołożone ręką:</span>
          {(c.dolozone ?? []).map((p) => <span key={p.pozycjaId}
            className="inline-flex items-center gap-1 rounded border border-amber-300
              bg-white px-1">
            <span className="font-mono">{p.symbol}</span>
            <span className="tabular-nums text-slate-500">×{p.ilosc}</span>
            <button type="button" disabled={zdejmij.isPending}
              onClick={() => zdejmij.mutate(p.pozycjaId)}
              aria-label={`Zdejmij ${p.symbol} z koszyka ${c.kod}`}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X size={12} /></button>
          </span>)}
        </span>}
      {/* ── WYMUSZENIE (0.368.0) ──────────────────────────────────────────
          Decyzja właściciela: „dodaj opcję sforsowania zamknięcia koszyka,
          nawet jeśli nie ma wszystkich ZW". Kosz stoi czasem tygodniami i
          blokuje pracę hali, a człowiek przy biurku wie to, czego baza nie wie
          — korekta bywa wystawiona poza aplikacją albo wystawi się za chwilę.

          DWA KLIKNIĘCIA, i to jest jedyne miejsce w tym panelu, gdzie pytamy
          „czy na pewno". Dekalog zabrania pytania po czynności, którą coś już
          potwierdziło — tu nie ma czego potwierdzać, bo skutek jest po drugiej
          stronie ekranu, w Subiekcie, i widać go dopiero, gdy MM się wywróci.

          Zdanie mówi KOSZT, nie „operacja nieodwracalna". Człowiek ma wiedzieć,
          co konkretnie może pójść źle, a nie że ma się bać. */}
      {/* PRZYCISKU NIE MA PRZY ODMOWIE SFERY, i to nie jest przeoczenie:
          nieudane zadanie WCIĄŻ WISI przy koszu, więc nie ma czego wypuszczać,
          a druga MM obok pierwszej dałaby dwa papiery na jedno pudło. Zdjęcie
          wiersza odpina tamto zadanie i przycisk pojawia się sam. */}
      {c.blad ? null : pewien === c.id
        ? <span className="flex w-full flex-wrap items-center gap-2">
            <span className="text-amber-800">
              MM pójdzie na stan, którego jeszcze nie ma: Sfera odrzuci
              dokument albo — gdy Subiekt dopuszcza ujemne — stan zejdzie pod
              zero do czasu korekty. Wystawiam?
            </span>
            <Przycisk className="text-xs" disabled={mimo.isPending}
              onClick={() => mimo.mutate(c.id, { onSettled: () => setPewien(null) })}>
              {mimo.isPending ? "Wystawiam…" : "Tak, wystaw MM"}
            </Przycisk>
            <button type="button" className="btn-secondary text-xs"
              onClick={() => setPewien(null)}>Nie</button>
          </span>
        /* KOMPLET KOREKT NIE PYTA „czy na pewno". Pytanie wyżej mówi o koszcie,
           którego tu nie ma: stan jest na miejscu, a wystawienie robi dokładnie
           to, co i tak zrobiłby automat przy najbliższym takcie wiązań.
           Dekalog zabrania pytania, na które jest tylko jedna odpowiedź. */
        : c.brakuje.length > 0
          ? <button type="button" className="btn-secondary text-xs"
              onClick={() => setPewien(c.id)}>Wystaw MM mimo braku korekt</button>
          : <Przycisk className="text-xs" disabled={mimo.isPending}
              onClick={() => mimo.mutate(c.id)}>
              {mimo.isPending ? "Wystawiam…" : "Wystaw MM"}
            </Przycisk>}
      {mimo.error && <div className="w-full"><Blad>{(mimo.error as Error).message}</Blad></div>}
      {zdejmij.error && <div className="w-full"><Blad>{(zdejmij.error as Error).message}</Blad></div>}
    </div>)}
    {kosze.map((kosz) => <div key={kosz.id}
      /* Odpad w innym kolorze niż zwroty: to dwa różne końce hali, a pasek
         czyta się kątem oka. */
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2
        text-xs ${kosz.rodzaj === "odpad"
          ? "border border-stone-300 bg-stone-100 text-stone-800"
          : "border border-sky-200 bg-sky-50 text-sky-900"}`}>
    <PackageOpen size={14} className="shrink-0" />
    <b>{nazwa(kosz.rodzaj)} {kosz.kod}</b>
    <span className="tabular-nums">
      {kosz.pozycji > 0 ? `${kosz.pozycji} poz. · ${kosz.sztuk} szt.` : "pusty"}</span>
    {/* Symbole, nie nazwy: przy koszu liczy się to, co stoi na opakowaniu
        i na dokumencie MM. Nazwy nie zmieściłyby się w jednym pasku.

        Ta linijka pokazuje CAŁĄ zawartość i tak zostaje. Wiersze dołożone
        ręką wracają niżej drugi raz — z krzyżykiem, bo tylko one dają się tu
        zdjąć (0.365.0). Powtórzenie symbolu jest ceną za to, że jedna linijka
        dalej odpowiada na pytanie „co leży w pudle". */}
    <span className={`min-w-0 flex-1 truncate ${
      kosz.rodzaj === "odpad" ? "text-stone-600" : "text-sky-700"}`}
      title={kosz.pozycje.map((p) => `${p.symbol} × ${p.ilosc}`).join(", ")}>
      {kosz.pozycje.map((p) => p.symbol).join(", ")}</span>
    {/* PUSTY NIE MA CZEGO ZAMYKAĆ — dokument bez linii nie jest dokumentem,
        więc serwer i tak odmówi. Zamiast przycisku, który zawsze odmawia,
        stoi tu droga wyjścia: porzucenie pudła, którego nikt nie napełnił. */}
    {kosz.pozycji > 0
      ? <Przycisk className="text-xs" disabled={zamknij.isPending}
          onClick={() => zamknij.mutate(kosz.id)}>
          {zamknij.isPending ? "Zamykam…" : "Zamknij koszyk"}
        </Przycisk>
      : <button type="button" className="btn-secondary text-xs" disabled={porzuc.isPending}
          onClick={() => porzuc.mutate(kosz.id)}>
          {porzuc.isPending ? "Porzucam…" : "Porzuć pusty koszyk"}
        </button>}
    {/* Co się stanie po kliknięciu — wprost, bo powstaje dokument w Subiekcie.
        Ta sama zasada co przy korekcie: ekran mówi, czego NIE robi i co robi
        za człowieka. */}
    {/* ── SKAN DO TEGO PUDŁA (0.378.0) ──────────────────────────────────
        Ten sam komponent, który stoi w karcie zwrotu, tylko bez zwrotu pod
        ręką. Tamto miejsce ZOSTAJE: operator stoi wtedy nad otwartym kartonem
        konkretnej paczki i ekran idzie za czynnością fizyczną. Tutaj chodzi
        o drugą czynność — zbieranie towaru do pudła, które stoi przy biurku
        niezależnie od tego, co akurat jest otwarte na ekranie. */}
    <div className="w-full">
      <DolozTowar rodzaj={kosz.rodzaj} />
    </div>
    <span className={`w-full ${kosz.rodzaj === "odpad" ? "text-stone-600" : "text-sky-700"}`}>
      {/* KOSZYK WIRTUALNY (0.350.0): zamknięcie kończy jego życie. Na hali
          rozkłada się kosz z dokumentu MM, a nie ten koszyk — zdanie mówi
          to wprost, bo inaczej etykieta „Z-" trafiałaby na regał. */}
      Zamknięcie kończy koszyk. MM z magazynu głównego {kosz.rodzaj === "odpad"
        ? "na magazyn odpadu" : "na regał zwrotów"} wychodzi, gdy wszystkie
      zwroty z tego koszyka mają numer korekty — na hali rozkłada się kosz
      z numerem tego MM.
    </span>
    {/* DOŁOŻONE RĘKĄ — osobno i z krzyżykiem (0.365.0). Osobno, bo tylko one
        dają się tu zdjąć; krzyżyk, bo skan bywa pomyłką, a wiersz bez zwrotu
        nie ma oceny do cofnięcia. Przy koszyku bez takich wierszy nie ma tu
        niczego: pusta etykieta „dołożone" byłaby napisem o braku. */}
    {kosz.pozycje.some((p) => !p.zeZwrotu) && <span className="flex w-full flex-wrap items-center gap-1">
      <span className={kosz.rodzaj === "odpad" ? "text-stone-600" : "text-sky-700"}>
        dołożone ręką:</span>
      {kosz.pozycje.filter((p) => !p.zeZwrotu).map((p) => <span key={p.id}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1">
        <span className="font-mono">{p.symbol}</span>
        <span className="tabular-nums text-slate-500">×{p.ilosc}</span>
        <button type="button" disabled={zdejmij.isPending}
          onClick={() => zdejmij.mutate(p.id)}
          aria-label={`Zdejmij ${p.symbol} z koszyka`}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={12} /></button>
      </span>)}
    </span>}
    {zamknij.error && <div className="w-full"><Blad>{(zamknij.error as Error).message}</Blad></div>}
    {porzuc.error && <div className="w-full"><Blad>{(porzuc.error as Error).message}</Blad></div>}
    {zdejmij.error && <div className="w-full"><Blad>{(zdejmij.error as Error).message}</Blad></div>}
    </div>)}
  </>;
}
