import React from "react";
import { ExternalLink, MessageSquare, MessagesSquare, Scale, Tractor, Undo2, UserRound }
  from "lucide-react";
import { Link } from "react-router-dom";
import type { HistoriaKlienta, MaszynaKlienta, WpisHistorii } from "../api/typy";
import { useHistoriaKlienta } from "../api/rozmowy";
import { czas, LoginKlienta, NaglowekSekcji, Pusto } from "../ui";

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
export function Klient({ rozmowaId, onOtworzRozmowe }: {
  rozmowaId: number;
  onOtworzRozmowe: (id: number) => void;
}) {
  const h = useHistoriaKlienta(rozmowaId);

  if (h.isLoading) return <Pusto waga="lista">Szukam historii klienta…</Pusto>;

  /* Wątek bez rozmówcy to „nie wiem, kto to", a nie „klient bez historii".
     Różnica jest cała: drugie zdanie byłoby kłamstwem o kliencie, który kupuje
     u nas od lat, tylko napisał z konta bez loginu w lądowisku wątku. */
  if (!h.data?.login) {
    return <p className="flex items-start gap-2 p-4 text-sm text-slate-500">
      <UserRound size={16} className="mt-0.5 shrink-0" />
      <span>Ten wątek nie niesie loginu kupującego, więc nie wiemy, czyja to
        historia. Panel nie zgaduje klienta z treści rozmowy.</span>
    </p>;
  }

  return <WidokHistorii historia={{ ...h.data, login: h.data.login }} tutaj="tą rozmową"
    bezLoginu onOtworzRozmowe={onOtworzRozmowe} />;
}

/**
 * Sama historia, bez pobierania — rysuje ją zakładka KLIENT w skrzynce i szuflada
 * historii przy zwrocie, reklamacji i dyskusji (23 września 2026). Jeden widok
 * na cztery wejścia: agent czyta klienta tak samo, skądkolwiek przyszedł.
 */
export function WidokHistorii({ historia, tutaj, onOtworzRozmowe, bezProfilu = false, bezLoginu = false }: {
  historia: HistoriaKlienta & { login: string };
  /** „tą rozmową", „tym zwrotem" — o czym mówi pusta oś. */
  tutaj: string;
  onOtworzRozmowe: (id: number) => void;
  /** Na samym profilu odnośnik do profilu prowadziłby w miejsce. */
  bezProfilu?: boolean;
  /** W skrzynce login stoi już w nagłówku rozmowy i przy każdej wiadomości. */
  bezLoginu?: boolean;
}) {
  const { login, maszyny, wpisy } = historia;

  return <div className="p-3" aria-label="Historia klienta">
    <NaglowekSekcji jako="p">Historia u nas</NaglowekSekcji>
    {/* Klik kopiuje (0.228.0): po loginie szuka się klienta w panelu Allegro
        i w Subiekcie, a przepisany z ekranu bywa przekręcony. */}
    {/* Profil klienta (24 września 2026): cały klient na jednym ekranie —
        liczby, sygnały, otwarte sprawy, zamówienia z pozycjami, notatka.
        Na samym profilu login stoi w nagłówku, więc tu drugi raz go nie ma. */}
    {/* Login zszedł ze skrzynki (@wydanie): stał tam trzeci raz, po nagłówku
        rozmowy i wątku, a kopiuje się go z nagłówka. Szuflada przy sprawach
        go zachowuje — tam zasłania kartę, na której login stoi. */}
    {!bezProfilu && <>
      {!bezLoginu && <LoginKlienta login={login}
        className="mr-2 font-mono text-sm font-semibold text-slate-900" />}
      <Link to={`/obsluga/klient/${encodeURIComponent(login)}`}
        className="text-xs font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        Profil klienta</Link>
    </>}

    {maszyny.length > 0 && <section className="mt-3" aria-label="Maszyny klienta">
      <NaglowekSekcji>Maszyny klienta</NaglowekSekcji>
      <ul className="mt-1 space-y-1">
        {maszyny.map((m) => <Maszyna key={`${m.marka}|${m.nazwa}|${m.wariant ?? ""}`} maszyna={m}
          onOtworzRozmowe={onOtworzRozmowe} />)}
      </ul>
    </section>}

    <section className="mt-3" aria-label="Oś historii klienta">
      {wpisy.length === 0
        ? <p className="text-xs text-slate-500">
            {maszyny.length === 0
              ? "Pierwszy kontakt — nie mamy u tego klienta ani zakupu, ani wcześniejszej rozmowy."
              : `Poza ${tutaj} nie mamy u tego klienta nic więcej.`}
          </p>
        : <ul className="space-y-1">
            {wpisy.map((w, i) => <Wpis key={`${w.rodzaj}-${w.sprawaId ?? w.zamowienieId ?? w.rozmowaId}-${i}`}
              wpis={w} onOtworzRozmowe={onOtworzRozmowe} />)}
          </ul>}
    </section>
  </div>;
}

/**
 * Maszyna z odsyłaczem do rozmowy, w której ją ustalono.
 *
 * ROZMOWA JEST TU ŹRÓDŁEM, nie ozdobą: „NAC LS 46-450" bez niej to twierdzenie
 * bez pokrycia, a §4.3 żąda, żeby każdy fakt niósł swoje. Klik prowadzi do
 * rozmowy, w której ktoś to ustalił — tam stoi dobór, który za tym stoi.
 */
function Maszyna({ maszyna, onOtworzRozmowe }: {
  maszyna: MaszynaKlienta; onOtworzRozmowe: (id: number) => void;
}) {
  const opis = [maszyna.marka, maszyna.nazwa, maszyna.wariant].filter(Boolean).join(" ");
  return <li className="rounded border border-slate-200 p-2 text-xs">
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
    <span className="w-20 shrink-0 pt-0.5 text-podpis text-slate-500">{czas(wpis.at)}</span>
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
