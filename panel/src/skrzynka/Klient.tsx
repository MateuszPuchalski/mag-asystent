import React from "react";
import { ClipboardList, ExternalLink, MessageSquare, MessagesSquare, Scale, Tractor, Undo2, UserRound }
  from "lucide-react";
import { Link } from "react-router-dom";
import type { HistoriaKlienta, MaszynaKlienta, SprawaKlienta, WpisHistorii } from "../api/typy";
import { useHistoriaKlienta } from "../api/rozmowy";
import { najwazniejszaDosylka } from "../api/spoiwo";
import { barwaTonu, czas, dzien, LoginKlienta, NaglowekSekcji, Pusto, termin } from "../ui";
import { historiaPozaZakupem } from "./kokpit";

/**
 * Zakładka KLIENT — historia u nas (makieta „Klient", §10.1).
 *
 * ZAKŁADKA WRÓCIŁA Z MAKIETY decyzją właściciela. §10.1 skreślił ją w 0.198.0
 * zdaniem „nie ma bytu" — prawdziwym o TABELI, nie o danych. Kupujący ma
 * login, po którym wiążą się jego zamówienia, jego rozmowy i maszyny ustalone
 * w tych rozmowach; wszystkie trzy rzeczy leżą w bazie od E1.
 *
 * DLACZEGO TO JEST WARTE ZAKŁADKI. Odpowiedź „ten szarpak pasuje" waży inaczej,
 * gdy ten sam klient kupił go rok temu do tej samej kosiarki. §11.3 nazywa to
 * wprost: `sprzedaz_weryfikacja` jest rodzajem dowodu. Bez tego ekranu agent
 * musiałby szukać tego w panelu Allegro — czyli tam, gdzie §25 obiecuje nie
 * zaglądać.
 *
 * EKRAN NICZEGO NIE ZAPISUJE. Maszyny są WYPROWADZONE z domkniętych doborów,
 * nie przypięte ręcznie: osobny rejestr trzeba by utrzymywać przy każdej
 * poprawce doboru i rozjechałby się przy pierwszej. To ten sam kształt, który
 * w 0.128.0 kosztował cztery tabele nakładki spraw.
 */
export function Klient({ rozmowaId, onOtworzRozmowe, zamowienieId = null, pomin }: {
  rozmowaId: number;
  onOtworzRozmowe: (id: number) => void;
  /** Zamówienie rozmowy — jego wpisy schodzą z historii, bo mają dom gdzie indziej. */
  zamowienieId?: string | null;
  /** Inne zakupy klienta, które stoją w wierszu „Zamówienie" — historia ich nie powtarza. */
  pomin?: ReadonlySet<string>;
}) {
  const h = useHistoriaKlienta(rozmowaId);

  if (h.isLoading) return <Pusto waga="lista">Szukam historii klienta…</Pusto>;

  /* HISTORIA BEZ TEGO ZAKUPU. Wpisy tego zakupu — sam zakup, jego zwrot,
     reklamacja i dyskusja — mają dom w karcie zakupu, w ramie „Wymaga
     Ciebie", w „Zamkniętych sprawach" i w osi rozmowy. Tutaj byłyby
     czwartym zapisem tego samego. Reguła w `kokpit.ts`. */
  const poza = historiaPozaZakupem(h.data, zamowienieId);

  /* Wątek bez rozmówcy to „nie wiem, kto to", a nie „klient bez historii".
     Różnica jest cała: drugie zdanie byłoby kłamstwem o kliencie, który kupuje
     u nas od lat, tylko napisał z konta bez loginu w lądowisku wątku. */
  if (!poza?.login) {
    /* Sprawa klienta i tak bywa tu znana (0.535.0): serwer bierze jej login
       z zamówienia rozmowy, nie z treści. Sprawa budzi się z takiej rozmowy
       i do niej odsyła, więc rozmowa pokazuje ją z powrotem — wiązanie
       jednostronne to wiązanie, którego nie ma. Historii dalej nie ma. */
    const sprawa = poza?.sprawa;
    /* Bez własnego wcięcia: oddech daje treść wiersza „Klient". */
    return <div>
      <p className="flex items-start gap-2 text-sm text-slate-500">
        <UserRound size={16} className="mt-0.5 shrink-0" />
        <span>Ten wątek nie niesie loginu kupującego, więc nie wiemy, czyja to
          historia. Panel nie zgaduje klienta z treści rozmowy.</span>
      </p>
      {sprawa && <LiniaSprawy login={sprawa.login} sprawa={sprawa} />}
    </div>;
  }

  /* INNE ZAKUPY RAZ. Ten sam drugi zakup stał w „Innych zakupach klienta"
     i tutaj, raz z „PLN" i uciętym numerem, raz z „zł" i pełnym. Dom ma tam,
     bo stamtąd się go wiąże z rozmową. Zwroty i sprawy innych zakupów
     zostają, bo w tamtej liście ich nie ma. */
  const wpisy = poza.wpisy.filter((w) =>
    !(w.rodzaj === "zakup" && w.zamowienieId !== null && pomin?.has(w.zamowienieId)));
  /* Pusta oś przy zakupie mówi „poza tym zakupem". „Pierwszy kontakt"
     byłby kłamstwem: zakup jest, tylko ma dom w karcie nad osią. Gdy oś
     opróżniły inne zakupy, zdanie mówi, gdzie one stoją. */
  const pustaOs = wpisy.length < poza.wpisy.length
    ? "Zakupy klienta stoją w wierszu „Zamówienie”, a poza nimi nie mamy u niego nic więcej."
    : zamowienieId ? "Poza tym zakupem nie mamy u tego klienta nic więcej." : undefined;
  return <WidokHistorii historia={{ ...poza, wpisy, login: poza.login }} tutaj="tą rozmową" wKolumnie
    pustaOs={pustaOs} bezLoginu onOtworzRozmowe={onOtworzRozmowe} />;
}

/**
 * Sama historia, bez pobierania — rysuje ją wiersz „Klient" w skrzynce i szuflada
 * historii przy zwrocie, reklamacji i dyskusji (23 września 2026). Jeden widok
 * na cztery wejścia: agent czyta klienta tak samo, skądkolwiek przyszedł.
 */
export function WidokHistorii({ historia, tutaj, onOtworzRozmowe, bezProfilu = false, bezLoginu = false,
  wKolumnie = false, pustaOs }: {
  historia: HistoriaKlienta & { login: string };
  /** „tą rozmową", „tym zwrotem" — o czym mówi pusta oś. */
  tutaj: string;
  /**
   * Widok w wierszu „Klient" prawej kolumny skrzynki. Profil i szuflady przy
   * zwrocie, reklamacji i dyskusji stawiają go samodzielnie, z wcięciem
   * i nagłówkiem. W kolumnie oddech daje wiersz, tytuł wiersza mówi już
   * „Klient", a maszyny stoją listą z kreską jak każda lista kolumny.
   */
  wKolumnie?: boolean;
  /** Zdanie pustej osi zamiast obu domyślnych — gdy historia jest przycięta i „pierwszy kontakt" kłamałby. */
  pustaOs?: string;
  onOtworzRozmowe: (id: number) => void;
  /** Na samym profilu odnośnik do profilu prowadziłby w miejsce. */
  bezProfilu?: boolean;
  /** W skrzynce login stoi już w nagłówku rozmowy i przy każdej wiadomości. */
  bezLoginu?: boolean;
}) {
  const { login, maszyny, wpisy } = historia;

  return <div className={wKolumnie ? undefined : "p-3"} aria-label="Historia klienta">
    {!wKolumnie && <NaglowekSekcji jako="p">Historia u nas</NaglowekSekcji>}
    {/* Klik kopiuje (0.228.0): po loginie szuka się klienta w panelu Allegro
        i w Subiekcie, a przepisany z ekranu bywa przekręcony. */}
    {/* Profil klienta (24 września 2026): cały klient na jednym ekranie —
        liczby, sygnały, otwarte sprawy, zamówienia z pozycjami, notatka.
        Na samym profilu login stoi w nagłówku, więc tu drugi raz go nie ma. */}
    {/* Login zszedł ze skrzynki (0.513.0): stał tam trzeci raz, po nagłówku
        rozmowy i wątku, a kopiuje się go z nagłówka. Szuflada przy sprawach
        go zachowuje — tam zasłania kartę, na której login stoi. */}
    {!bezProfilu && <>
      {!bezLoginu && <LoginKlienta login={login}
        className="mr-2 font-mono text-sm font-semibold text-slate-900" />}
      <Link to={`/obsluga/klient/${encodeURIComponent(login)}`}
        className="text-xs font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        Profil klienta</Link>
      {historia.sprawa && <LiniaSprawy login={login} sprawa={historia.sprawa} />}
    </>}

    {maszyny.length > 0 && <section className="mt-3" aria-label="Maszyny klienta">
      <NaglowekSekcji>Maszyny klienta</NaglowekSekcji>
      <ul className={wKolumnie ? "mt-1 divide-y divide-slate-200" : "mt-1 space-y-1"}>
        {maszyny.map((m) => <Maszyna key={`${m.marka}|${m.nazwa}|${m.wariant ?? ""}`} maszyna={m}
          plasko={wKolumnie} onOtworzRozmowe={onOtworzRozmowe} />)}
      </ul>
    </section>}

    <section className="mt-3" aria-label="Oś historii klienta">
      {wpisy.length === 0
        ? <p className="text-xs text-slate-500">
            {pustaOs ?? (maszyny.length === 0
              ? "Pierwszy kontakt — nie mamy u tego klienta ani zakupu, ani wcześniejszej rozmowy."
              : `Poza ${tutaj} nie mamy u tego klienta nic więcej.`)}
          </p>
        : <ul className="space-y-1">
            {wpisy.map((w, i) => <Wpis key={`${w.rodzaj}-${w.sprawaId ?? w.zamowienieId ?? w.rozmowaId}-${i}`}
              wpis={w} onOtworzRozmowe={onOtworzRozmowe} />)}
          </ul>}
    </section>
  </div>;
}

/**
 * Sprawa klienta przy źródle (S6, 0.535.0) — jedna linijka, cała klikalna.
 *
 * WIĄZANIE W OBIE STRONY (`CLAUDE.md`). Profil prowadzi do rozmowy, zwrotu
 * i reklamacji; bez tej linijki agent przy rozmowie nie wiedziałby, że ktoś
 * już prowadzi tego klienta i czeka na zwrot — a wiązanie jednostronne to
 * wiązanie, którego nie ma. Linijka prowadzi do profilu, bo tam stoją krok
 * i zakończenie; tutaj sprawy się nie zmienia.
 */
function LiniaSprawy({ login, sprawa: s }: { login: string; sprawa: SprawaKlienta }) {
  /* Dosyłka (0.536.0) doklejona do TEJ SAMEJ linijki. Bez niej stan drugiej
     paczki stał tylko na profilu, o ekran dalej od rozmowy, zwrotu czy
     reklamacji. Jedno zdanie, najpilniejsze — reszta jest na profilu.
     Zakończona sprawa przychodzi z pustą listą (`prowadzenie-klienta.ts`),
     więc osobnego warunku na stan tu nie ma. */
  const dosylka = najwazniejszaDosylka(s.dosylki);
  return <Link to={`/obsluga/klient/${encodeURIComponent(login)}`}
    className="mt-2 flex items-start gap-1.5 rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-800 hover:bg-slate-50">
    <ClipboardList size={13} className="mt-0.5 shrink-0 text-slate-400" />
    <span className="min-w-0">
      {s.stan === "w_toku"
        ? <>Sprawa klienta: {s.krok} · {termin(s.krokDo)}
            {/* Czerwień wyłącznie po terminie — jak na profilu i w „Moje". */}
            {s.poTerminie && <b className="text-ranga-zle"> po terminie</b>}
            {s.prowadzi && ` · prowadzi ${s.prowadzi}`}
            {dosylka && <> · <span className={barwaTonu(dosylka.ton)}>{dosylka.opis}</span></>}</>
        : <>Sprawa klienta zakończona {dzien(s.zakonczonoAt)}</>}
      {/* Pierwsze zdarzenie po naszym ruchu, bo to ono obudziło sprawę. */}
      {s.nowe[0] && <span className="block font-semibold text-slate-900">{s.nowe[0].tekst}</span>}
    </span>
  </Link>;
}

/**
 * Maszyna z odsyłaczem do rozmowy, w której ją ustalono.
 *
 * ROZMOWA JEST TU ŹRÓDŁEM, nie ozdobą: „NAC LS 46-450" bez niej to twierdzenie
 * bez pokrycia, a §4.3 żąda, żeby każdy fakt niósł swoje. Klik prowadzi do
 * rozmowy, w której ktoś to ustalił — tam stoi dobór, który za tym stoi.
 */
function Maszyna({ maszyna, plasko, onOtworzRozmowe }: {
  maszyna: MaszynaKlienta;
  /** W kolumnie skrzynki bez ramki: jedyne pudełko w treści kolumny ważyło więcej niż ustalenie. */
  plasko: boolean;
  onOtworzRozmowe: (id: number) => void;
}) {
  const opis = [maszyna.marka, maszyna.nazwa, maszyna.wariant].filter(Boolean).join(" ");
  return <li className={plasko ? "py-1.5 text-xs" : "rounded border border-slate-200 p-2 text-xs"}>
    <p className="flex items-center gap-1.5 font-semibold text-slate-900">
      <Tractor size={13} className="shrink-0 text-slate-400" />
      {opis}{maszyna.rocznik && <span className="font-normal text-slate-500">({maszyna.rocznik})</span>}
    </p>
    {maszyna.silnik && <p className="mt-0.5 text-slate-700">silnik <span className="font-mono">{maszyna.silnik}</span></p>}
    <p className="mt-0.5 text-slate-500">
      ustalone w{" "}
      <button type="button" className="underline hover:text-slate-800"
        onClick={() => onOtworzRozmowe(maszyna.rozmowaId)}>rozmowie #{maszyna.rozmowaId}</button>
      , {czas(maszyna.at)}
    </p>
  </li>;
}

/* Sprawa z trzech pozostałych kolejek: dokąd prowadzi wiersz i czym się
   przedstawia. Jedno miejsce, żeby nazwy nie rozjechały się z blokiem spoiwa. */
const SPRAWY_OSI = {
  zwrot: { nazwa: "Zwrot", ikona: Undo2, sciezka: "/obsluga/zwroty" },
  reklamacja: { nazwa: "Reklamacja", ikona: Scale, sciezka: "/obsluga/reklamacje" },
  dyskusja: { nazwa: "Dyskusja", ikona: MessagesSquare, sciezka: "/obsluga/dyskusje" },
} as const;

/** Jeden wiersz osi: zakup prowadzi do zamówienia, rozmowa — do rozmowy. */
function Wpis({ wpis, onOtworzRozmowe }: {
  wpis: WpisHistorii; onOtworzRozmowe: (id: number) => void;
}) {
  return <li className="flex gap-2 border-t border-slate-100 py-1.5 text-xs first:border-t-0">
    {/* Data w jednej linii: przy `w-20` część dat łamała się na dwie,
        a sąsiednie nie, i kolumna dat skakała z wiersza na wiersz. */}
    <span className="w-24 shrink-0 whitespace-nowrap pt-0.5 text-podpis tabular-nums text-slate-500">{czas(wpis.at)}</span>
    <span className="min-w-0 flex-1">
      {wpis.rodzaj !== "zakup" && wpis.rodzaj !== "rozmowa" && wpis.sprawaId !== null
        ? (() => {
            /* Trzy kolejki doszły w S2 spoiwa. Wiersz prowadzi na ekran
               właściwej kolejki, bo tam stoją bramki tej sprawy — historia
               jest czytaniem, nigdy pracą. */
            const { nazwa, ikona: Ikona, sciezka } = SPRAWY_OSI[wpis.rodzaj];
            /* `Link`, nie `href`: gołe przeładowanie wyrzuciłoby wspólny
               cache zapytań i dociągnęło całą skrzynkę od nowa. */
            return <Link to={`${sciezka}/${wpis.sprawaId}`} className="hover:underline">
              <Ikona size={11} className="mr-1 inline align-baseline text-slate-400" />
              <span className="text-slate-500">{nazwa}:</span>{" "}
              <span className="text-slate-800">{wpis.tresc}</span>
            </Link>;
          })()
        : wpis.rodzaj === "zakup"
        ? <>
            <span className="text-slate-800">Zakup: {wpis.tresc}</span>
            <span className="text-slate-500"> · zamówienie{" "}
              {wpis.link
                ? <a className="underline hover:text-slate-800" href={wpis.link} target="_blank" rel="noreferrer">
                    {wpis.zamowienieId}<ExternalLink size={10} className="ml-0.5 inline align-baseline" /></a>
                : wpis.zamowienieId}</span>
          </>
        : <button type="button" className="text-left hover:underline"
            onClick={() => wpis.rozmowaId && onOtworzRozmowe(wpis.rozmowaId)}>
            <MessageSquare size={11} className="mr-1 inline align-baseline text-slate-400" />
            <span className="text-slate-500">Rozmowa #{wpis.rozmowaId}:</span>{" "}
            <span className="text-slate-800">{wpis.tresc}</span>
          </button>}
    </span>
  </li>;
}
