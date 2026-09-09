import React from "react";
import { ArrowRight, Bot, Camera, ClipboardList, Lock, Paperclip, Ruler, ScanSearch, Send, User } from "lucide-react";
import type { StatusDoboru, StatusRozmowy, WpisOsi, ZalacznikOsi } from "../api/typy";
import { NAZWA, NAZWA_DOBORU } from "./statusy";
import { LoginKlienta, Przycisk, czas } from "../ui";
import { pobierzPlik } from "../api/klient";
import { useZdjecieZalacznika } from "../towar/useZdjecie";
import { Kafel } from "../towar/Kafel";

/* Załączniki wiadomości (0.155.0). Sonda pokazała je w 7 z 39 wiadomości —
   do tej pory rozmowa milczała o tym, że klient coś przysłał.

   ADRES ALLEGRO NIE TRAFIA DO PRZEGLĄDARKI. Pobranie idzie przez naszą trasę,
   bo wymaga tokena konta firmy, a ten zostaje po stronie serwera.

   Plik nie do pobrania ZOSTAJE WIDOCZNY. Ukrycie kłamałoby, że klient nic nie
   przysłał; `UNSAFE` znaczy, że Allegro uznało go za niebezpieczny, a `EXPIRED`
   — że wygasł u nich. Agent ma wiedzieć, że coś było, i móc o to dopytać. */
const POWOD: Record<string, string> = {
  UNSAFE: "Allegro uznało plik za niebezpieczny",
  EXPIRED: "załącznik wygasł po stronie Allegro",
  NEW: "Allegro jeszcze go sprawdza",
};

/**
 * ZDJĘCIE WIDAĆ, NIE TRZEBA W NIE KLIKAĆ (0.218.0, naprawione w 0.219.1).
 *
 * 0.155.0 dołożyło na oś nazwę pliku i na tym stanęło. Agent widział
 * „szarpak.jpeg" i musiał kliknąć, ściągnąć plik na dysk i otworzyć go
 * w przeglądarce zdjęć — trzy ruchy po to, żeby zobaczyć treść pytania.
 * Właściciel: „gdy klient wysyła zdjęcie, wyświetlaj w czacie".
 *
 * ── OBIE DROGI IDĄ PRZEZ `fetch`, NIE PRZEZ ATRYBUT (0.219.1) ──────────────
 * Sesja jedzie nagłówkiem `x-session`, a ani `<img src>`, ani `<a href>` go
 * nie niosą: obie dostają 401 i pokazują ikonę zepsutego obrazu albo surowy
 * JSON z „Brak sesji". Podgląd bierze więc `useZdjecieZalacznika` (wspólna
 * kolejka obrazów), a pobranie — `pobierzPlik`. Pobranie było zepsute
 * od 0.155.0 i wyglądało, jakby działało.
 *
 * PODGLĄD I POBRANIE ZOSTAJĄ OSOBNO. Pierwsze odpowiada na „co klient
 * przysłał", drugie na „chcę to mieć u siebie" — to dwa różne pytania,
 * a plik na dysku ma nosić własną nazwę.
 */
function Zalaczniki({ lista }: { lista: ZalacznikOsi[] }) {
  return <ul className="mt-2 space-y-2 border-t pt-2 text-xs">
    {lista.map((z) => <Zalacznik key={z.id} z={z} />)}
  </ul>;
}

/** Jeden załącznik: obraz nad nazwą, nazwa zawsze. Osobny komponent, bo obraz
    wisi na haku, a haka nie wolno wołać w pętli. */
function Zalacznik({ z }: { z: ZalacznikOsi }) {
  const obraz = useZdjecieZalacznika(z.podglad ? z.id : null);
  const [blad, setBlad] = React.useState<string | null>(null);

  return <li>
    {/* Wysokość ograniczona, nie szerokość: zdjęcie z telefonu bywa pionowe
        i rozpychałoby oś na cały ekran. */}
    {obraz && <img src={obraz} alt={z.nazwa} loading="lazy"
      className="mb-1 max-h-64 w-auto max-w-full rounded border border-slate-200 bg-white p-1" />}
    <span className="flex items-center gap-1.5">
      <Paperclip size={12} className="shrink-0 text-slate-400" />
      {z.doPobrania
        ? <button type="button" className="font-bold text-slate-700 underline hover:text-slate-900"
            onClick={() => {
              setBlad(null);
              pobierzPlik(`/api/obsluga/zalaczniki/${z.id}`, z.nazwa)
                .catch((e: unknown) => setBlad(e instanceof Error ? e.message : "Nie udało się pobrać"));
            }}>{z.nazwa}</button>
        : <span className="text-slate-500">
            <span className="font-bold">{z.nazwa}</span>
            {" — "}{POWOD[z.status] ?? `stan ${z.status}`}
          </span>}
    </span>
    {/* Nieudane pobranie MÓWI o sobie. Do 0.219.1 kliknięcie otwierało kartę
        z surowym JSON-em błędu — agent nie miał jak zgadnąć, co poszło źle. */}
    {blad && <p className="mt-0.5 text-ranga-zle">{blad}</p>}
  </li>;
}

/**
 * Blok firmowy pod odpowiedzią, ZWINIĘTY (0.219.1).
 *
 * Nazwa spółki, adres, NIP, KRS, REGON, telefon — siedem wierszy, w każdej
 * naszej wiadomości te same, i ani jeden o sprawie klienta. Przy trzech
 * odpowiedziach w wątku stopka zajmowała na osi więcej miejsca niż wszystko,
 * co naprawdę napisaliśmy.
 *
 * Zwinięta, nie skasowana — z tego samego powodu, co autoodpowiedź: to jest
 * treść, którą klient DOSTAŁ, i przy sporze musi dać się przeczytać w panelu.
 * Podpis człowieka („Z poważaniem, Mateusz") zostaje wyżej, w treści: mówi,
 * z kim klient rozmawiał, więc nie jest stopką.
 */
function Stopka({ tresc }: { tresc: string }) {
  const [otwarte, setOtwarte] = React.useState(false);
  return <div className="mt-1">
    <button type="button" className="text-[11px] text-slate-400 underline hover:text-slate-600"
      aria-expanded={otwarte} onClick={() => setOtwarte(!otwarte)}>
      {otwarte ? "ukryj stopkę firmową" : "stopka firmowa"}
    </button>
    {otwarte && <p className="mt-1 whitespace-pre-wrap border-t pt-1 text-xs text-slate-500">
      {tresc}</p>}
  </div>;
}

/**
 * Nasze automatyczne potwierdzenie, ZWINIĘTE do jednej linijki (0.218.0).
 *
 * Odbicie „Dziękujemy za kontakt" jest długie — godziny pracy biura, ta sama
 * treść po polsku i po angielsku — i nie niesie ani jednego zdania o sprawie
 * klienta. Rozwinięte na osi spycha pytanie poniżej krawędzi okna, czyli
 * chowa dokładnie tę rzecz, po którą agent tu przyszedł.
 *
 * ZWIJAMY, NIE KASUJEMY. Autoodpowiedź jest faktem w rozmowie: dowodzi, że
 * list dotarł, i tłumaczy, skąd u klienta kontakt bez treści. Ukryta kazałaby
 * przy sporze szukać prawdy poza panelem. Rozwinięcie stoi jedno kliknięcie
 * dalej i pokazuje całość.
 */
function Autoodpowiedz({ wpis }: { wpis: WpisOsi }) {
  const [otwarte, setOtwarte] = React.useState(false);
  return <article className="ml-auto max-w-[75ch] rounded-lg border border-dashed
      border-slate-200 bg-slate-50/70 px-3 py-1.5">
    <button type="button" className="flex w-full items-center gap-2 text-left text-xs text-slate-400"
      aria-expanded={otwarte} onClick={() => setOtwarte(!otwarte)}>
      <Bot size={12} className="shrink-0" />
      <span className="font-bold uppercase tracking-wide">Autoodpowiedź biura</span>
      <span>{czas(wpis.at)}</span>
      <span className="ml-auto underline">{otwarte ? "zwiń" : "pokaż treść"}</span>
    </button>
    {otwarte && <p className="mt-1 whitespace-pre-wrap border-t pt-1 text-sm text-slate-500">
      {wpis.tresc}</p>}
  </article>;
}

/* §10.3: każdy rodzaj wpisu ma wyglądać inaczej. Komentarze, zdarzenia
   systemowe i wpisy wysyłki dochodzą w kolejnych etapach i mają tu DOŁOŻYĆ
   gałąź, a nie przepisać tę. Barwy idą z tokenów `os.*`, nie z klas Tailwinda
   wprost.

   ── CZTERY CECHY, NIE JEDNA (0.193.0) ──────────────────────────────────────
   Makieta `docs/projekt-widokow/Main.dc.html` odróżnia rodzaje kart CZTEREMA
   cechami naraz — tłem, ramką, IKONĄ i WCIĘCIEM — plus podpisem rodzaju
   („Klient · Allegro", „Odpowiedź firmy") we własnej barwie. Komentarz tłumaczący
   tokeny w `tailwind.config.js` mówi to samo od początku.

   Front doszedł do jednej cechy z czterech. Wiadomość klienta ma tło #ffffff,
   nasza odpowiedź #f8fafc, obie tę samą ramkę — na ekranie to jest RÓŻNICA
   NIEWIDOCZNA. Wychodziło z tego, że jedynym wyraźnym wpisem osi była notatka
   wewnętrzna, czyli rzecz, której klient w ogóle nie zobaczy, a najsłabszym —
   podział „kto to powiedział", czyli oś sporu w każdej rozmowie.

   Wcięcia idą wprost z makiety: klient odsunięty od PRAWEJ, my od LEWEJ.
   Dwie strony rozmowy stoją po dwóch stronach kolumny i widać to, zanim
   zdąży się przeczytać podpis.

   Godzina wpisu doszła przy okazji: `at` jechał w kontrakcie od początku,
   a oś go nie pokazywała wcale — czytało się rozmowę bez wiedzy, czy między
   pytaniem a odpowiedzią minęła minuta, czy trzy dni. */
export function Os({ wpisy, zrodloPomiaru, mozeZlecac, onZrodlo, onWstawDoSzkicu }: {
  wpisy: WpisOsi[];
  zrodloPomiaru: number | null;
  mozeZlecac: boolean;
  onZrodlo: (messageId: number | null) => void;
  onWstawDoSzkicu: (tresc: string) => void;
}) {
  const listaRef = React.useRef<HTMLDivElement>(null);
  const [podswietlony, setPodswietlony] = React.useState<string | null>(null);

  const { wypowiedzi, zdarzenia } = React.useMemo(() => rozdziel(wpisy), [wpisy]);

  /* Podświetlenie GAŚNIE SAMO. Trwałe zostawiłoby na osi ślad po nawigacji,
     czyli stan, którego nikt nie zdejmuje i który po chwili kłamie o tym,
     gdzie agent jest. Skok ma pokazać miejsce, nie oznaczyć go. */
  React.useEffect(() => {
    if (podswietlony === null) return;
    const t = setTimeout(() => setPodswietlony(null), 1600);
    return () => clearTimeout(t);
  }, [podswietlony]);

  const skocz = (celId: string) => {
    /* Szukamy po DZIECIACH, nie selektorem `[data-wpis="..."]`: identyfikator
       wpisu jest ciągiem z serwera, a wstawiony do selektora wymagałby
       ucieczki. Lista dzieci to dokładnie owijki wypowiedzi — porównanie
       wartości nie ma jak się pomylić i nie zależy od `CSS.escape`. */
    const el = Array.from(listaRef.current?.children ?? [])
      .find((c) => (c as HTMLElement).dataset.wpis === celId);
    /* `center`, nie `start`: wypowiedź wepchnięta pod górną krawędź traci
       kontekst tego, co ją poprzedza, a po to właśnie się tu skacze. */
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPodswietlony(celId);
  };

  /* `min-h-40`, nie `min-h-0` (0.232.1): karta szkicu Copilota zwinęła oś do
     jednej linii, bo edytor pod nią jest `shrink-0`. Rozmowa ma zostać
     czytelna przy każdej wysokości edytora — to ona jest powodem ekranu. */
  return <div className="flex min-h-0 flex-1 flex-col">
  <div ref={listaRef} className="min-h-40 flex-1 space-y-3 overflow-y-auto p-4">
    {wypowiedzi.map((w) => <div key={w.id} data-wpis={w.id}
      className={podswietlony === w.id
        ? "rounded-lg ring-2 ring-amber-400 ring-offset-2 transition-shadow" : "transition-shadow"}>
    {w.rodzaj === "komentarz"
      /* §6.4: komentarz ma być WIZUALNIE ODRÓŻNIONY od wiadomości klienta.
         Inna barwa to za mało — kłódka i podpis mówią wprost, że klient tego
         nie widzi, bo to jedyna rzecz, o którą tu naprawdę chodzi. */
      ? <article key={w.id} className="ml-6 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
            <Lock size={12} />NOTATKA WEWNĘTRZNA · {w.autor}
            {w.wzmianki?.length ? <span className="font-normal">
              · dla: {w.wzmianki.map((m) => m.name).join(", ")}</span> : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
        </article>
      /* Zwinięcie stoi PRZED gałęzią zwykłej wiadomości, bo autoodpowiedź jest
         wiadomością wychodzącą i inaczej wpadłaby w tamtą gałąź. */
      : w.automatyczna
      ? <Autoodpowiedz key={w.id} wpis={w} />
      : w.rodzaj === "zlecenie"
      ? <Zlecenie key={w.id} wpis={w} />
      : w.rodzaj === "wynik_zadania"
      ? <article key={w.id} className="ml-6 rounded-lg border border-os-wynik-ramka bg-os-wynik p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-ranga-ok">
            <Ruler size={12} />Wynik z magazynu · {w.autor}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
          {/* Wynik nie staje się odpowiedzią sam — do szkicu trafia wyłącznie
              na jawne kliknięcie agenta. */}
          <Przycisk className="mt-2 text-xs" onClick={() => onWstawDoSzkicu(w.tresc)}>
            Wstaw wynik do szkicu</Przycisk>
        </article>
      /* PRÓG CZYTELNOŚCI, nie ozdoba (0.198.0). Od zdjęcia ogranicznika
         1500 px z `<main>` środkowa kolumna rośnie z monitorem, a wypowiedź
         rozciągnięta na całą jej szerokość dawałaby linijkę na sto dwadzieścia
         znaków: oko gubi początek następnego wiersza. 75ch to górna granica
         tego, co czyta się bez wysiłku.
         Kierunek zamiast wcięcia: klient przy lewej krawędzi, my przy prawej.
         Stałe `mr-10`/`ml-10` zostawiały na szerokim ekranie jeden martwy
         pas z jednej strony i nie mówiły nic — teraz strona sama mówi, kto
         mówi, zanim agent przeczyta podpis. */
      : <article key={w.id} className={`max-w-[75ch] rounded-lg border p-3 ${w.odKlienta
          ? "mr-auto border-os-klient-ramka bg-os-klient"
          : "ml-auto border-os-firma-ramka bg-os-firma"}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {/* ── LOGIN STOI W MIEJSCU SŁOWA „KLIENT" (0.219.2) ────────────
                Do 0.219.1 podpis brzmiał „KLIENT · ALLEGRO", a login jechał
                obok, drobnym drukiem. Komentarz tłumaczył to zdaniem „login
                kupującego i tak nic nie mówi" — i to jest nieprawda, którą
                obalił własny ekran: agent czyta wątek, żeby wiedzieć, KTO
                pisze, a „bagslublin" odróżnia rozmówcę, podczas gdy słowo
                „klient" jest prawdziwe o każdej wiadomości przychodzącej.

                Fallback zostaje: gdy wątek nie niesie loginu, serwer podstawia
                „Klient" i wtedy podpis wygląda jak dawniej. Kanał („Allegro")
                zostaje przy loginie, bo ten sam ciąg na innym kanale byłby
                kimś innym. */}
            <span className={`flex items-center gap-1 font-bold uppercase tracking-wide ${
              w.odKlienta ? "text-amber-700" : "text-slate-600"}`}>
              {w.odKlienta ? <User size={12} /> : <Send size={12} />}
              {/* Login kopiuje się kliknięciem (0.228.0). Kanał zostaje obok,
                  poza przyciskiem: kopiujemy sam login, nie zdanie o nim. */}
              {w.odKlienta
                ? <><LoginKlienta login={w.autor} className="uppercase" /> · Allegro</>
                : "Odpowiedź firmy"}</span>
            {/* Nazwisko OSOBNO tylko przy nas: przy kliencie stoi już wyżej,
                a powtórzone dwa razy w jednym wierszu jest szumem. */}
            {!w.odKlienta && <b>{w.autor}</b>}
            <span className="text-slate-400">{czas(w.at)}</span>
            {/* Nazwa przy ofercie jest Z ZAMÓWIENIA (§4.3) — mail Allegro
                „Wiadomość dotyczy" pokazuje tytuł, goły numer kazał agentowi
                szukać towaru drugi raz. Zamówienie skracamy: UUID w całości
                nikomu nic nie mówi, a całość niesie blok nad osią. */}
            {w.ofertaId && <span>· oferta {w.ofertaId}{w.nazwaOferty && ` — ${w.nazwaOferty}`}</span>}
            {w.zamowienieId && <span title={w.zamowienieId}>· zamówienie {w.zamowienieId.slice(0, 8)}…</span>}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{w.tresc}</p>
          {w.stopka && <Stopka tresc={w.stopka} />}
          {w.zalaczniki?.length ? <Zalaczniki lista={w.zalaczniki} /> : null}
          {w.odKlienta && mozeZlecac && <button
            className={`mt-2 text-xs font-bold ${
              zrodloPomiaru === w.messageId ? "text-amber-700" : "text-slate-500"}`}
            onClick={() => onZrodlo(zrodloPomiaru === w.messageId ? null : w.messageId!)}>
            {zrodloPomiaru === w.messageId ? "✓ źródło pomiaru" : "Zleć z tej wiadomości"}</button>}
        </article>}
    </div>)}
  </div>

    {/* Pasek stoi POD oknem wiadomości, nad edytorem — czyli tam, gdzie kończy
        się czytanie, a zaczyna pisanie odpowiedzi. */}
    <PasekZdarzen zdarzenia={zdarzenia} onSkocz={skocz} />
  </div>;
}

/* ── ZDARZENIA SPRAWY ZESZŁY Z OSI DO JEDNEGO PASKA (0.243.0) ────────────────
   Zgłoszenie właściciela: „can we move all the status changes into one
   horizontal row below messaging window like a timeline, when clicking on
   event it goes to that part in messaging window".

   Do 0.242.0 każda zmiana statusu, sklejenie sprawy i każdy krok doboru stały
   na osi jako osobna kreska między wypowiedziami. Przy jednej sprawie to jest
   znak, że coś się wydarzyło; przy siedmiu — ściana szarego tekstu, przez
   którą trzeba się przewinąć, żeby dojść do zdania klienta. Na zrzucie od
   właściciela dwa takie bloki zajmują więcej miejsca niż obie wypowiedzi
   razem, i to one, nie rozmowa, dyktują długość przewijania.

   OŚ ZOSTAJE ROZMOWĄ, PASEK ZOSTAJE PRZEBIEGIEM. To są dwa różne pytania:
   „co klient napisał" i „jak sprawa szła". Pierwsze czyta się po kolei, drugie
   ogarnia się jednym spojrzeniem — i dlatego jedno jest kolumną, a drugie
   rzędem.

   Kliknięcie WRACA na oś, bo inaczej rozdzielenie gubiłoby to, co kreska
   niosła najlepiej: MIEJSCE w rozmowie, w którym stan się zmienił. Celem
   skoku jest pierwsza wypowiedź PO zdarzeniu — ta, której zdarzenie dotyczy.
   Gdy zdarzenie jest ostatnie i nic po nim nie padło, celem zostaje ostatnia
   wypowiedź przed nim, bo skok donikąd byłby przyciskiem bez skutku.        */

const ZDARZENIE: ReadonlySet<string> = new Set(["status", "sprawa", "dobor"]);

type Zdarzenie = WpisOsi & { cel: string | null };

export function rozdziel(wpisy: WpisOsi[]): {
  wypowiedzi: WpisOsi[]; zdarzenia: Zdarzenie[];
} {
  const wypowiedzi: WpisOsi[] = [];
  const zdarzenia: Zdarzenie[] = [];
  for (let i = 0; i < wpisy.length; i++) {
    const w = wpisy[i];
    if (!ZDARZENIE.has(w.rodzaj)) { wypowiedzi.push(w); continue; }
    let cel: string | null = null;
    for (let j = i + 1; j < wpisy.length && cel === null; j++) {
      if (!ZDARZENIE.has(wpisy[j].rodzaj)) cel = wpisy[j].id;
    }
    for (let j = i - 1; j >= 0 && cel === null; j--) {
      if (!ZDARZENIE.has(wpisy[j].rodzaj)) cel = wpisy[j].id;
    }
    zdarzenia.push({ ...w, cel });
  }
  return { wypowiedzi, zdarzenia };
}

/* ── KRÓTKA ETYKIETA I BARWA RODZAJU ────────────────────────────────────────
   Pierwsza wersja paska pokazywała `tresc` w całości i to była pomyłka
   zmierzona, nie przeczuta: dziewięć zdarzeń dało 1343 px nadmiaru w poziomie
   przy kolumnie na 680 px, czyli widać było trzy z dziewięciu. Rząd, po którym
   trzeba przewijać, nie daje tego jednego spojrzenia, po które się go zakładało.

   Chip niesie STAN DOCELOWY, nie przejście. Stan poprzedni stoi w chipie obok,
   po lewej — powtarzanie go dublowałoby połowę paska. Pełne zdanie, autor
   i godzina zostają w podpowiedzi, bo to są dane do sprawdzenia, nie do
   przeglądania.

   RODZAJ NIESIE BARWA, nie prefiks. „dobór: " przed każdym chipem kosztowało
   siedem znaków na każdym z nich i mówiło to samo co kolor. */
const BARWA_ZDARZENIA: Record<string, string> = {
  status: "border-slate-200 bg-white text-slate-600",
  dobor: "border-sky-200 bg-sky-50 text-sky-900",
  dobor_wybor: "border-sky-200 bg-sky-50 text-sky-900",
  sprawa: "border-violet-200 bg-violet-50 text-violet-900",
};

function etykieta(z: Zdarzenie): string {
  const e = z.zdarzenie;
  /* Bez pola strukturalnego zostaje pełne zdanie. To nie jest martwa gałąź:
     oś bywa czytana z odpowiedzi zapisanej przed 0.243.0. */
  if (!e) return z.tresc;
  if (e.rodzaj === "status") return e.po ? NAZWA[e.po as StatusRozmowy] ?? e.po : z.tresc;
  if (e.rodzaj === "dobor") return e.po ? NAZWA_DOBORU[e.po as StatusDoboru] ?? e.po : z.tresc;
  if (e.rodzaj === "dobor_wybor") {
    return `${e.wybrano ? "wybrano" : "zdjęto"} ${e.symbol ?? "?"}`;
  }
  /* Gałąź JAWNA, nie „reszta": `"status" | "dobor"` to jeden wariant unii,
     więc dwa `return` wyżej go nie wyczerpują i TypeScript ma rację. */
  if (e.rodzaj === "sprawa") {
    return e.dolaczona ? `sprawa: ${e.tytul ?? "?"}` : "odłączono od sprawy";
  }
  return z.tresc;
}

function PasekZdarzen({ zdarzenia, onSkocz }: {
  zdarzenia: Zdarzenie[];
  onSkocz: (celId: string) => void;
}) {
  /* Pusty pasek NIE ZOSTAJE jako pusta ramka. Rozmowa bez ani jednej zmiany
     stanu jest częsta i pas szarości pod nią mówiłby, że czegoś brakuje. */
  if (!zdarzenia.length) return null;

  return <nav aria-label="Przebieg sprawy"
    className="shrink-0 border-t bg-slate-50 px-3 py-2">
    {/* Przewijanie w POZIOMIE, nie zawijanie do drugiego rzędu: pasek ma mieć
        stałą wysokość, bo rośnie kosztem osi, czyli kosztem rozmowy. */}
    <ol className="flex items-center gap-1.5 overflow-x-auto">
      {zdarzenia.map((z, i) => <li key={z.id} className="flex shrink-0 items-center gap-1.5">
        {i > 0 && <ArrowRight size={11} className="shrink-0 text-slate-300" />}
        <button type="button" disabled={z.cel === null}
          onClick={() => z.cel !== null && onSkocz(z.cel)}
          title={`${z.tresc} · ${z.autor} · ${czas(z.at)}`}
          className={`max-w-[14rem] truncate rounded-full border px-2.5 py-1 text-xs ${
            BARWA_ZDARZENIA[z.zdarzenie?.rodzaj ?? "status"] ?? BARWA_ZDARZENIA.status} ${
            z.cel === null ? "cursor-default opacity-60" : "hover:ring-2 hover:ring-amber-300"}`}>
          {etykieta(z)}
        </button>
      </li>)}
    </ol>
  </nav>;
}

/* ── ZLECENIE DLA HALI NA OSI (0.226.0) ──────────────────────────────────────
   Zgłoszenie właściciela: „zlecenie zmierzenia też powinno zostać pokazane
   jako blok w wiadomości". Do 0.224.0 oś pokazywała sam WYNIK — prośba, która
   go wywołała, nie zostawiała po sobie nic poza kreskami zmiany statusu
   rozmowy, z których nie da się odczytać, o co kto poprosił.

   Blok stoi PO TEJ SAMEJ STRONIE co wynik (`ml-6`) i w tej samej rodzinie
   kształtu, bo to dwie połowy jednej sprawy: pytanie do hali i odpowiedź hali.
   Barwa jest inna i to jest cała różnica na ekranie — bursztyn znaczy „czeka",
   zieleń wyniku „przyszło". Zlecenie WYKONANE gaśnie do szarości: jego rola
   się skończyła, a odpowiedź stoi niżej i to ona ma przyciągać wzrok.

   Kartoteka z kaflem, bo to jest odniesienie do produktu — ta sama reguła, co
   wszędzie indziej w obsłudze (§25a.6a).                                     */

/* Nagłówek i ikona idą z rodzaju zadania. IKONA NIE JEST OZDOBĄ: rozmowa
   bywa długa, a agent przewija ją wzrokiem, nie czyta od góry. Jeden kształt
   dla czterech różnych próśb kazałby czytać nagłówek, żeby odróżnić pomiar
   od zdjęcia — a to jest dokładnie ta sekunda, którą blok miał oszczędzić. */
const RODZAJ_ZLECENIA: Record<string, { nazwa: string; Ikona: typeof Ruler }> = {
  pomiar: { nazwa: "Zlecono pomiar", Ikona: Ruler },
  zdjecie: { nazwa: "Zlecono zdjęcie", Ikona: Camera },
  weryfikacja: { nazwa: "Zlecono weryfikację", Ikona: ScanSearch },
  inne: { nazwa: "Zlecenie dla magazynu", Ikona: ClipboardList },
};

/* Status mówi, CZY CZEKAMY — nie powtarza słownika ekranu zadań. */
const STAN_ZLECENIA: Record<string, { etykieta: string; klasa: string }> = {
  nowe: { etykieta: "czeka na halę", klasa: "bg-amber-100 text-amber-900" },
  w_toku: { etykieta: "hala pracuje", klasa: "bg-sky-100 text-sky-900" },
  wykonane: { etykieta: "wykonane", klasa: "bg-emerald-100 text-emerald-800" },
  anulowane: { etykieta: "anulowane", klasa: "bg-slate-200 text-slate-600" },
};

function Zlecenie({ wpis }: { wpis: WpisOsi }) {
  const z = wpis.zlecenie;
  if (!z) return null;
  const zamkniete = z.status === "wykonane" || z.status === "anulowane";
  const stan = STAN_ZLECENIA[z.status] ?? { etykieta: z.status, klasa: "bg-slate-100 text-slate-600" };
  const { nazwa, Ikona } = RODZAJ_ZLECENIA[z.rodzaj] ?? RODZAJ_ZLECENIA.inne;
  return <article aria-label={`Zlecenie: ${z.tytul}`}
    className={`ml-6 rounded-lg border p-3 ${zamkniete
      ? "border-slate-200 bg-slate-50" : "border-amber-300 bg-amber-50"}`}>
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold uppercase ${
      zamkniete ? "text-slate-500" : "text-amber-800"}`}>
      <Ikona size={12} />
      {nazwa} · {wpis.autor}
      {/* GODZINA ZLECENIA, choć wynik jej nie ma. Wynik jest ostatnim, co się
          wydarzyło, a otwarte zlecenie ma WIEK — „czeka na halę" od dziesięciu
          minut i od wczoraj to dwie różne decyzje agenta wobec klienta. */}
      <span className="font-normal normal-case text-slate-500">{czas(wpis.at)}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] ${stan.klasa}`}>{stan.etykieta}</span>
      {/* PILNE mówi o tym, jak zlecenie stoi w kolejce hali, nie o rozmowie. */}
      {z.priorytet === "pilny" &&
        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-ranga-zle">pilne</span>}
    </div>
    <p className="mt-1 text-sm font-semibold">{z.tytul}</p>
    {/* Instrukcja słowo w słowo: to ona pojechała na kolektor i po niej widać,
        czy wynik odpowiada na zadane pytanie. */}
    {wpis.tresc && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{wpis.tresc}</p>}
    {z.twId !== null && <div className="mt-2 flex items-center gap-2">
      <Kafel twId={z.twId} rozmiar={32} nazwa={z.nazwaTowaru ?? z.symbol ?? ""} symbol={z.symbol} />
      <div className="min-w-0 text-xs">
        <div className="truncate font-semibold">{z.nazwaTowaru}</div>
        <div className="truncate font-mono text-slate-600">{z.symbol}</div>
      </div>
    </div>}
    {/* Kto WZIĄŁ zadanie. Bez tego „czeka na halę" i „ktoś już to robi"
        wyglądają tak samo, a to różnica między czekaniem a ponagleniem. */}
    {z.przypisanoPrzez && !zamkniete && <p className="mt-1 text-xs text-slate-500">
      realizuje: {z.przypisanoPrzez}</p>}
  </article>;
}
