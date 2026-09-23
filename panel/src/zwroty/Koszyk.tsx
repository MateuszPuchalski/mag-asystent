import React from "react";
import { Hand, Info, Lock, PackageOpen, PackagePlus, Trash2, X } from "lucide-react";
import {
  useKosz, useMmMimoKorekt, useNowyKoszyk, useUsunKoszyk, useZamknijKosz, useZdejmijTowar,
} from "../api/zwroty";
import { Przycisk, Blad, ile } from "../ui";
import { DolozTowar } from "./DolozTowar";
import { DrogaKoszyka } from "./DrogaKoszyka";

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

/**
 * Usunięcie całego pudła — jedno kliknięcie na pustym, dwa na napełnionym.
 *
 * PYTAMY TYLKO WTEDY, GDY JEST O CO. Pudło puste nie niesie niczyjej pracy,
 * więc pytanie po jego usunięciu byłoby pytaniem bez treści — a dekalog
 * zabrania pytań, na które jest jedna odpowiedź. Napełnione niesie oceny,
 * które wrócą do kubełka DO OCENY, i zdanie mówi to WPROST: nie „operacja
 * nieodwracalna", tylko co konkretnie się stanie.
 */
function UsunKoszyk({ kod, pozycji, trwa, pytamy, onPytaj, onNie, onTak }: {
  kod: string; pozycji: number; trwa: boolean; pytamy: boolean;
  onPytaj: () => void; onNie: () => void; onTak: () => void;
}) {
  /* KOSZ ZAMIAST NAPISU (0.453.0). Usunięcie to najrzadsza czynność na
     pasku, a napis „Usuń koszyk" był drugim najdłuższym przyciskiem. Nazwa
     zostaje w `aria-label` i w podpowiedzi — czytnik ekranu i mysz mają ją
     dalej; pytanie przy napełnionym pudle zostaje zdaniem, bo mówi koszt. */
  const kosz = (etykieta: string, onClick: () => void) =>
    <button type="button" aria-label={etykieta} title={etykieta} disabled={trwa} onClick={onClick}
      className="btn-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center p-0 text-red-800">
      <Trash2 size={14} aria-hidden="true" /></button>;
  if (pozycji === 0) return kosz("Usuń pusty koszyk", onTak);
  if (!pytamy) return kosz("Usuń koszyk", onPytaj);
  return <span className="flex w-full flex-wrap items-center gap-2">
    <span>
      Koszyk {kod} zniknie razem z {ile(pozycji, "pozycją", "pozycjami", "pozycjami")}.
      Oceny wrócą do kubełka DO OCENY, a towar zostanie tam, gdzie leży. Usuwam?
    </span>
    <Przycisk className="text-xs" disabled={trwa} onClick={onTak}>
      {trwa ? "Usuwam…" : `Tak, usuń ${kod}`}
    </Przycisk>
    <button type="button" className="btn-secondary text-xs" onClick={onNie}>Nie</button>
  </span>;
}

/**
 * Ile znaczników pozycji mieści pasek, zanim reszta zejdzie do „+N".
 *
 * Osiem, bo tyle symboli mieści się w jednej linii obok pola skanu na
 * ekranie biura. Ręczne pokazują się zawsze, choćby było ich więcej —
 * tylko przy nich stoi krzyżyk, a schowany krzyżyk to krzyżyk, którego nie ma.
 */
const MAKS_ZNACZNIKOW = 8;

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
  const usun = useUsunKoszyk();
  const [pewien, setPewien] = React.useState<number | null>(null);
  /* Osobny stan od `pewien`: tamten pyta o WYSTAWIENIE MM mimo korekt, ten
     o usunięcie pudła. Jeden stan na dwa pytania dałby ekran, na którym
     kliknięcie „tak" odpowiada na cudze. */
  const [doUsuniecia, setDoUsuniecia] = React.useState<number | null>(null);
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
    {/* PRZYCISK STOI ZAWSZE OD 0.379.0. Do 0.378.0 znikał przy otwartym pudle,
        bo obowiązywała zasada „jeden koszyk na operatora" — właściciel ją
        odwrócił i wtedy znikający przycisk stał się dokładnie tym, czego
        brakowało na ekranie. */}
    {/* Zdanie obok przycisku odeszło do podpowiedzi (0.453.0): mówiło to samo
        przy każdym wejściu na ekran, a przycisk z ikoną pudła i plusem mówi
        swoje sam. */}
    <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-1 text-xs"
          aria-label="Nowy koszyk zwrotów"
          title={kosze.length > 0
            ? "Kolejne pudło — przy kilku otwartych ocena pyta, do którego."
            : "Pudło do zbierania towaru — bez otwierania zwrotu."}
          disabled={nowy.isPending} onClick={() => nowy.mutate({})}>
          <PackagePlus size={12} aria-hidden="true" />
          {nowy.isPending ? "Zakładam…" : "Nowy koszyk"}
        </button>
      {nowy.error && <Blad>{(nowy.error as Error).message}</Blad>}
    </div>
    {/* Koszyki zamknięte BEZ DOKUMENTU. Stoją NAD otwartym, bo to praca
        zaległa: kosz jest już na hali, a dokumentu wciąż nie ma.

        TRZY POWODY, JEDEN PASEK (0.371.0). Kosz czeka albo na korektę, albo na
        poprawkę zawartości po odmowie Sfery, albo na samo wypuszczenie MM.
        Zdanie mówi, na który z nich — bo „czeka" bez powodu wygląda jak
        zacięta kolejka i wysyła człowieka do kolejki zadań w biurze. */}
    {czekajace.map((c) => <div key={c.id}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
        border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <PackageOpen size={14} aria-hidden="true" className="shrink-0" />
      <b><span className="sr-only">{nazwa(c.rodzaj)} </span>{c.kod}</b>
      {/* ── DROGA ZAMIAST DWÓCH ZDAŃ (0.453.0) ─────────────────────────────
          Do 0.452.0 pasek niósł stan i osobne zdanie „dlaczego czeka". Stan
          został, ale krótszy; „dlaczego" poszło pod ikonę informacji obok,
          bo powód jest ten sam przy każdym pudle w tym stanie. Odmowa Sfery
          zostaje w całości — to jedyne zdanie, które się tu zmienia. */}
      <DrogaKoszyka rodzaj={c.rodzaj} etap={c.blad || c.brakuje.length === 0 ? "mm" : "korekty"}
        brakuje={c.brakuje.length} blad={Boolean(c.blad)} />
      <span className="min-w-0 flex-1">
        {c.blad
          ? <>Sfera: <b>{c.blad}</b></>
          : c.brakuje.length > 0
            ? <>czeka na {c.brakuje.length === 1 ? "korektę" : "korekty"}: {
                c.brakuje.map((b) => b.numer).join(", ")}</>
            : <>komplet korekt</>}
      </span>
      {/* DLACZEGO czeka — pod ikoną, nie w wierszu. Treść bez zmian: odmowa
          Sfery mówi, CO z tym zrobić (blizna koszyka Z-8), korekta mówi, skąd
          bierze się czekanie, komplet mówi, że dokument wychodzi ręką. */}
      <span tabIndex={0} role="note" className="inline-flex shrink-0 items-center text-amber-800"
        aria-label="Dlaczego czeka"
        title={c.blad
          ? "Dokumentu nie ma, więc zawartość da się jeszcze poprawić: zdejmij wiersz, "
            + "który tam nie pasuje, i wystaw MM jeszcze raz."
            + ((c.pozycje ?? []).some((p) => p.brakNaMag)
              ? " Czerwone wiersze niżej to te, których na magazynie brakuje — Sfera odrzuciła dokument przez nie."
              : " Cały koszyk schodzi przyciskiem kosza.")
          : c.brakuje.length > 0
            ? "MM zdejmuje towar z magazynu głównego, a ze zwrotu wraca on tam dopiero po korekcie. "
              + "Dokument wyjdzie sam, gdy dojdzie ostatni numer."
            : "Zadanie MM zdjęto przy poprawce zawartości i nikt go nie ponawia sam — "
              + "dokument wychodzi po naciśnięciu."}>
        <Info size={14} aria-hidden="true" /></span>
      {/* ── CAŁA ZAWARTOŚĆ, Z KRZYŻYKIEM PRZY KAŻDYM WIERSZU (0.379.0) ────
          Do 0.378.0 stały tu wyłącznie wiersze ze SKANU, bo tylko one dawały
          się zdjąć. Koszyk Z-8 na produkcji pokazał cenę tej reguły: odbił się
          od Sfery na kartotece usługowej przyniesionej OCENĄ, więc nie miał
          ani jednego krzyżyka — żeby go odetkać, trzeba było odnaleźć zwrot,
          z którego przyszedł feralny wiersz. Zgłoszenie właściciela: „pozwól
          edytować te koszyki".

          Wiersz ze zwrotu jest OZNACZONY, bo jego zdjęcie cofa przy okazji
          ocenę i odsyła zwrot do kubełka DO OCENY. To ma być widać przed
          kliknięciem, a nie po nim. */}
      {(c.pozycje ?? []).length > 0 &&
        <span className="flex w-full flex-wrap items-center gap-1">
          <span className="text-amber-700">w pudle:</span>
          {(c.pozycje ?? []).map((p) => <span key={p.pozycjaId}
            className="inline-flex items-center gap-1 rounded border border-amber-300
              bg-white px-1">
            <span className={`font-mono ${p.brakNaMag ? "font-bold text-ranga-zle" : ""}`}>
              {p.symbol}</span>
            <span className="tabular-nums text-slate-500">×{p.ilosc}</span>
            {/* ── TEN WIERSZ WYWRÓCIŁ DOKUMENT (0.381.0) ──────────────────
                Sfera odrzuca MM zdaniem „Brak towaru w magazynie" i NIE MÓWI,
                którego. Zgłoszenie właściciela z produkcji: „dostaję brak
                towaru w magazynie, ale nie mówi jakiego, abym mógł go usunąć
                z koszyka". Liczba wskazuje wiersz palcem, a krzyżyk obok już
                stoi — tyle wystarczy, żeby kosz ruszył dalej. */}
            {p.brakNaMag && <span className="text-ranga-zle">
              na magazynie {p.stanMag ?? 0} z {p.ilosc}</span>}
            {p.zeZwrotu && <span className="text-amber-700" title="Zdjęcie cofnie ocenę">
              ze zwrotu</span>}
            <button type="button" disabled={zdejmij.isPending}
              onClick={() => zdejmij.mutate(p.pozycjaId)}
              aria-label={p.zeZwrotu
                ? `Zdejmij ${p.symbol} z koszyka ${c.kod} i cofnij ocenę`
                : `Zdejmij ${p.symbol} z koszyka ${c.kod}`}
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
      {/* USUNIĘCIE CAŁEGO PUDŁA (0.380.0) stoi także tutaj, bo to właśnie
          koszyki zaległe zajmowały pół ekranu. Zdejmowanie ich wiersz po
          wierszu było jedyną drogą i dlatego nikt tego nie robił. */}
      <UsunKoszyk kod={c.kod} pozycji={(c.pozycje ?? []).length} trwa={usun.isPending}
        pytamy={doUsuniecia === c.id}
        onPytaj={() => setDoUsuniecia(c.id)} onNie={() => setDoUsuniecia(null)}
        onTak={() => usun.mutate(c.id, { onSettled: () => setDoUsuniecia(null) })} />
      {mimo.error && <div className="w-full"><Blad>{(mimo.error as Error).message}</Blad></div>}
      {zdejmij.error && <div className="w-full"><Blad>{(zdejmij.error as Error).message}</Blad></div>}
    </div>)}
    {kosze.map((kosz) => {
      /* ── JEDEN WIERSZ NA PUDŁO (0.453.0) ────────────────────────────────
         Zgłoszenie właściciela: „ulżyj przeładowaniu tekstem". Do 0.452.0
         otwarty koszyk zajmował pięć linii: nagłówek, pole skanu z własnym
         przyciskiem „Zamknij", zdanie o tym, czego skan nie robi, zdanie
         o MM i korektach oraz osobny rząd „dołożone ręką". Zostaje jedno
         pasmo, a zdania idą do podpowiedzi drogi i pola.

         POZYCJE TO ZNACZNIKI, jedna lista zamiast dwóch. Do 0.452.0 symbol
         dołożony ręką stał w pasku dwa razy — w linijce zawartości i niżej,
         z krzyżykiem. Teraz stoi raz: ręczny z ikoną dłoni i krzyżykiem,
         ze zwrotu bez niego, bo tamten schodzi cofnięciem oceny. Ręczne idą
         PIERWSZE, bo tylko przy nich jest co kliknąć. */
      const reczne = kosz.pozycje.filter((p) => !p.zeZwrotu);
      const zeZwrotow = kosz.pozycje.filter((p) => p.zeZwrotu);
      const widoczne = [...reczne, ...zeZwrotow].slice(0, Math.max(MAKS_ZNACZNIKOW, reczne.length));
      const ukryte = kosz.pozycje.length - widoczne.length;
      const odpad = kosz.rodzaj === "odpad";
      return <div key={kosz.id}
      /* Odpad w innym kolorze niż zwroty: to dwa różne końce hali, a pasek
         czyta się kątem oka. */
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2
        text-xs ${odpad
          ? "border border-stone-300 bg-stone-100 text-stone-800"
          : "border border-sky-200 bg-sky-50 text-sky-900"}`}>
    <span className="flex shrink-0 items-center gap-2">
      <PackageOpen size={16} aria-hidden="true" className="shrink-0" />
      {/* Rodzaj mówi kolor i ikona; czytnikowi ekranu mówi go ukryty napis. */}
      <b className="text-sm"><span className="sr-only">{nazwa(kosz.rodzaj)} </span>{kosz.kod}</b>
      {odpad && <span className="rounded bg-stone-200 px-1.5 font-semibold">odpad</span>}
      <span className="tabular-nums opacity-80">
        {kosz.pozycji > 0 ? `${kosz.pozycji} poz · ${kosz.sztuk} szt` : "pusty"}</span>
    </span>
    {widoczne.length > 0 && <ul aria-label="Zawartość koszyka" className="flex flex-wrap items-center gap-1">
      {widoczne.map((p) => <li key={p.id} title={`${p.nazwa} × ${p.ilosc}${p.zeZwrotu ? "" : " — dołożone ręką"}`}
        className="inline-flex h-6 items-center gap-1 rounded border border-slate-300 bg-white px-1.5 text-slate-800">
        {!p.zeZwrotu && <Hand size={12} aria-label="dołożone ręką" className="shrink-0" />}
        <span className="font-mono">{p.symbol}</span>
        <span className="tabular-nums text-slate-600">×{p.ilosc}</span>
        {/* Krzyżyk TYLKO przy ręcznych (0.365.0): wiersz z oceny schodzi
            cofnięciem oceny na karcie zwrotu. */}
        {!p.zeZwrotu && <button type="button" disabled={zdejmij.isPending}
          onClick={() => zdejmij.mutate(p.id)}
          aria-label={`Zdejmij ${p.symbol} z koszyka`}
          className="rounded p-0.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
          <X size={12} aria-hidden="true" /></button>}
      </li>)}
      {ukryte > 0 && <li className="tabular-nums opacity-80"
        title={kosz.pozycje.slice(widoczne.length).map((p) => `${p.symbol} × ${p.ilosc}`).join(", ")}>
        +{ukryte}</li>}
    </ul>}
    {/* Skan do TEGO pudła (0.378.0) — w pasku stoi otwarty na stałe, bo
        przy pudle to jedyna czynność. */}
    <DolozTowar rodzaj={kosz.rodzaj} koszId={kosz.id} wiersz />
    {/* KOSZYK WIRTUALNY (0.350.0): zamknięcie kończy jego życie, a na hali
        rozkłada się kosz z numerem MM. Mówi to podpowiedź drogi — zdanie stało
        tu na stałe i przestało być czytane. */}
    <DrogaKoszyka rodzaj={kosz.rodzaj} etap="pakowanie" />
    <span className="flex shrink-0 items-center gap-2">
      {/* PUSTY NIE MA CZEGO ZAMYKAĆ — dokument bez linii nie jest dokumentem,
          więc serwer i tak odmówi. */}
      {kosz.pozycji > 0 &&
        <Przycisk className="inline-flex items-center gap-1 text-xs" disabled={zamknij.isPending}
          aria-label={`Zamknij koszyk ${kosz.kod}`}
          onClick={() => zamknij.mutate(kosz.id)}>
          <Lock size={13} aria-hidden="true" />
          {zamknij.isPending ? "Zamykam…" : "Zamknij"}
        </Przycisk>}
      <UsunKoszyk kod={kosz.kod} pozycji={kosz.pozycji} trwa={usun.isPending}
        pytamy={doUsuniecia === kosz.id}
        onPytaj={() => setDoUsuniecia(kosz.id)} onNie={() => setDoUsuniecia(null)}
        onTak={() => usun.mutate(kosz.id, { onSettled: () => setDoUsuniecia(null) })} />
    </span>
    {zamknij.error && <div className="w-full"><Blad>{(zamknij.error as Error).message}</Blad></div>}
    {usun.error && <div className="w-full"><Blad>{(usun.error as Error).message}</Blad></div>}
    {zdejmij.error && <div className="w-full"><Blad>{(zdejmij.error as Error).message}</Blad></div>}
    </div>;
    })}
  </>;
}
