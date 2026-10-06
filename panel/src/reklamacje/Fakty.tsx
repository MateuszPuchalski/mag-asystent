import React, { useId } from "react";
import { Route } from "lucide-react";
import type { CenaPoziomu, PozycjaZamowienia, Reklamacja, SzczegolReklamacji } from "../api/typy";
import { DrogaZakupu, SprawyZakupu } from "../sprawy/Spoiwo";
import { zlote } from "../api/zwroty";
import { EtykietaWartosci, czas, dzien, dniSlowo, ile, kiedy, Skopiuj } from "../ui";
import { dopisekDostaw } from "../skrzynka/PasmoOdpowiedzi";
import { CenyKartoteki } from "../skrzynka/TowarRozmowy";
import { STATUS_PACZKI } from "../skrzynka/statusy";
import { PRZEWOZNICY } from "../zwroty/Dowody";
import { useKartaTowaru } from "../api/rozmowy";
import type { KartotekaKolumny } from "./Glowica";

/* ── Fakty o reklamacji: pas komórek w głowicy ───────────────────────────────
   Decyzja właściciela: fakty z prawej kolumny idą do głowicy, a te same
   informacje łączą się w jedną. Prawa kolumna trzyma dowody i werdykt.
   Powód: rozmowę i dowody czyta się w środku, a fakt do decyzji ma stać
   nad nimi, w jednym pasie, który oko obejmuje bez przewijania kolumny.

   Każda komórka odpowiada na jedno pytanie: czy mamy, kiedy kupione, ile
   zapłacił, od kogo, gdzie paczka, co jeszcze w zamówieniu. Komórki stoją
   w stałej kolejności, więc oko szuka faktu tam, gdzie był.

   JEDEN DOM NA FAKT. Kwota żądania stoi w zdaniu „Chce:", więc komórka
   „Klient zapłacił" nie powtarza jej, gdy jest równa. Brak kartoteki mówi
   wiersz towaru, więc „Mamy" i „Dostawca" stają wtedy jedną komórką.
   Odnośniki do Allegro stoją przy numerze reklamacji w prawej szczelinie.

   Wszystko tu jest ODCZYTEM. Jedynym zapisem jest pytanie o paczkę, i to
   jawnym kliknięciem, nie skutkiem ubocznym patrzenia.

   BEZ COPILOTA I BEZ „ZLEĆ HALI". Decyzja właściciela przy przebudowie ekranu
   reklamacji: karta „Co wyczytał Copilot", jego rada i zlecenie dla hali na
   razie tu nie stoją. Dlatego nic w pasie nie woła modelu ani nie zleca pracy
   hali. Zapisane karty zostają w bazie, a `ZlecHali` dalej służy zwrotom
   i dyskusjom. Strażnik: `BezCopilota.test.tsx` i `Triaz.test.tsx`. */

/** Kartoteka sprawy przychodzi z głowicy — ta sama, której symbol tam stoi. */
export function FaktySprawy({ szczegol, towar, onSprawdzPrzesylke, sprawdzaPrzesylke = false, bladPrzesylki = "" }: {
  szczegol: SzczegolReklamacji;
  towar: KartotekaKolumny;
  /* Sprawdzenie przesyłki jest opcjonalne: czego nie da się zrobić, tego nie
     ma na ekranie. */
  onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean;
  bladPrzesylki?: string;
}) {
  const r = szczegol.reklamacja;
  /* Pozycja paragonu tej właśnie oferty — z niej bierze się cena w komórce
     „Klient zapłacił". Reklamacja dotyczy JEDNEJ oferty, więc jednej
     pozycji; ta sama oferta dwa razy na zamówieniu niesie tę samą cenę. */
  const pozycja = szczegol.zamowienie?.pozycje
    .find((p) => p.offerId !== null && p.offerId === r.offerId) ?? null;
  /* Ten sam hak, co w skrzynce — TanStack trzyma to pod jednym kluczem, więc
     otwarcie sprawy nie pyta serwera drugi raz o tę samą kartotekę. */
  const karta = useKartaTowaru(towar.twId);
  /* POZIOM 0 TO CENA ZAKUPU. Kolumny `tw_Cena` numerują się od zera, a widok
     nazw od jedynki — dlatego ten jeden poziom nie ma nazwy i mieć nie musi
     (`adapters/subiekt.mssql.ts`, `rozwinCeny`). Nie zgadujemy go „najniższą
     ceną z listy": najtańszy cennik sprzedaży to nadal sprzedaż. */
  const zakup = (karta.data?.ceny ?? []).find((c) => c.poziom === 0) ?? null;

  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap gap-2">
      <Triaz szczegol={szczegol} pozycja={pozycja} twId={towar.twId} karta={karta} zakup={zakup} />
      {szczegol.przesylka && <Paczka przesylka={szczegol.przesylka}
        onSprawdz={onSprawdzPrzesylke} trwa={sprawdzaPrzesylke} blad={bladPrzesylki} />}
      <Zamowienie szczegol={szczegol} />
    </div>
    <ZakupUNas szczegol={szczegol} />
  </div>;
}

/* ── CZTERY PYTANIA: CZY MAMY, KIEDY, ZA ILE, OD KOGO ────────────────────────
   Zgłoszenie właściciela: ceny „są kluczowe do szybkiego oceniania, czy warto
   rozpatrywać reklamację". Liczba używana do triażu nie może więc stać za
   kliknięciem — stoi w komórce, zawsze w tym samym miejscu.

   „Mamy" — przy żądaniu WYMIANY to jest cała decyzja, a pod spodem stoi, co
   jedzie od dostawcy, bo „nie mamy" bez „będzie we wtorek" to pół odpowiedzi.
   „Kupione" — wiek zakupu i to, po ilu dniach klient się zgłosił. „Klient
   zapłacił" — kwota z paragonu i obok nasz zakup. „Dostawca" — od kogo jest
   ta partia, czyli u kogo reklamujemy dalej.

   NIC SIĘ TU NIE ODEJMUJE. „Zapłacił" jest kwotą BRUTTO z paragonu, „nasz
   zakup" — netto z kartoteki. Różnica tych dwóch liczb nie jest marżą, a stawki
   VAT ten ładunek nie niesie. Dwie liczby obok siebie mówią prawdę; jedna
   wyliczona z nich kłamałaby z dokładnością do podatku.

   BRAK WIEDZY MÓWI O SOBIE („Brak danych to nie zero", `panel/CLAUDE.md`).
   Komórka bez danych nie znika, tylko mówi „nie wiemy" — pusty slot czytałby
   się jak „nie mamy", a zero jak wiedza, której nie ma. */
function Triaz({ szczegol, pozycja, twId, karta, zakup }: {
  szczegol: SzczegolReklamacji; pozycja: PozycjaZamowienia | null;
  twId: number | null;
  karta: ReturnType<typeof useKartaTowaru>;
  zakup: CenaPoziomu | null;
}) {
  const r = szczegol.reklamacja;
  const mag = karta.data?.mag ?? null;
  const polki = karta.data?.locs ?? [];
  /* Cenniki SPRZEDAŻY bez poziomu 0, który jest zakupem i stoi w podpisie.
     Decyzja właściciela: wszystkie poziomy, bo przy rozmowie o wymianie
     wybranie jednego za niego byłoby zgadywaniem. */
  const sprzedaz = (karta.data?.ceny ?? []).filter((c) => c.poziom !== 0);

  /* ── STAN CZYTA SIĘ PRZECIW ŻĄDANIU ───────────────────────────────────────
     „Mamy 2 szt." przy sprawie o trzy sztuki wygląda jak dobra wiadomość
     i nią nie jest — wymiany z tego nie będzie. Porównanie robi więc ekran,
     nie agent w głowie. */
  const zadane = r.ilosc !== null && r.ilosc > 1 ? r.ilosc : null;
  const starczy = mag !== null && zadane !== null ? mag.avail >= zadane : null;
  const wiek = wiekZakupuSlowem(r.dniOdZakupu);
  const poDniach = zgloszonoPoDniach(r);

  const cena = pozycja?.cenaGrosze ?? r.cenaParagonuGrosze ?? null;
  const waluta = pozycja?.waluta ?? r.waluta;
  /* Kwota żądania stoi w zdaniu „Chce:" tuż wyżej. Równa kwota drugi raz
     byłaby tą samą liczbą w dwóch miejscach, więc komórka mówi wtedy, że
     to ta sama kwota, a liczba ma jeden dom. */
  const tyleIleZada = cena !== null && r.oczekiwanaKwotaGrosze === cena && waluta === r.waluta;
  const naszZakup = zakup && (zakup.nettoGrosze ?? zakup.bruttoGrosze)
    ? `nasz zakup ${zlote(zakup.nettoGrosze ?? zakup.bruttoGrosze, zakup.waluta)} ${
      zakup.nettoGrosze !== null ? "netto" : "brutto"}`
    : null;
  /* Czytamy ostrożnie: starszy serwer pola nie zna, a jego brak ma znaczyć
     „nie wiemy", nie wywracać pasa. */
  const dostawa = szczegol.dostawa ?? null;

  return <>
    {/* Bez kartoteki „Mamy" i „Dostawca" mówiłyby dwa razy to samo, co wiersz
        towaru: „bez kartoteki". Jedna komórka mówi, czego przez to nie wiemy. */}
    {twId === null
      ? <Kostka etykieta="Mamy · dostawca" wartosc="nie wiadomo" kolor="text-slate-700"
          pod="stanu ani dostaw nie znamy" />
      : mag
        ? <Kostka etykieta="Mamy"
            wartosc={mag.avail > 0 ? `${mag.avail} ${karta.data?.unit || "szt."}` : "brak na stanie"}
            kolor={mag.avail > 0 && starczy !== false ? "text-ranga-ok" : "text-ranga-zle"}
            pod={[
              zadane ? `sprawa o ${zadane} szt.` : null,
              karta.data ? dopisekDostaw({ ...karta.data, mag }) : null,
              polki.length ? `półka ${polki.join(", ")}` : null,
            ].filter(Boolean).join(" · ")} />
        : <Kostka etykieta="Mamy" wartosc={karta.isLoading ? "…" : "nie wiemy"} kolor="text-slate-700"
            pod={karta.isLoading ? "pytam Subiekta" : "Subiekt nie podał stanu"} />}

    <Kostka etykieta="Kupione" wartosc={wiek?.napis ?? "nie wiemy"}
      /* Bursztyn, nie czerwień, i nie wyrok: rękojmia biegnie dwa lata od
         WYDANIA rzeczy, a my mierzymy od zamówienia albo od złożenia
         koszyka. Ekran mówi, że warto sprawdzić — nie że sprawa przepadła. */
      kolor={!wiek ? "text-slate-700" : wiek.poDwochLatach ? "text-ranga-uwaga" : "text-slate-900"}
      /* KTÓRY TO ZEGAR, mówi podpowiedź komórki: data z zamówienia i data
         z ładunku sprawy to dwie różne daty pod jedną etykietą. */
      tytul={r.kupionoAt ? `Data zakupu: ${dzien(r.kupionoAt)}, ${ZEGAR[r.kupionoZrodlo ?? "sprawa"]}` : undefined}
      /* Data zakupu stoi na widoku, nie tylko w podpowiedzi: podpowiedzi nie
         czyta klawiatura ani dotyk, a datę przepisuje się klientowi. */
      pod={poDniach !== null && r.kupionoAt ? `${dzien(r.kupionoAt)} · zgłoszone ${dniSlowo(poDniach)} po zakupie`
        : r.kupionoAt ? `${dzien(r.kupionoAt)} · ${ZEGAR[r.kupionoZrodlo ?? "sprawa"]}` : "brak daty zakupu"} />

    {/* Pieniądze sprawy w jednej komórce: zapłacone, nasz zakup i cenniki
        sprzedaży. Cennik stoi na wierzchu, bo służy do triażu, a liczba
        do triażu nie może stać za kliknięciem. */}
    <Kostka etykieta="Klient zapłacił"
      wartosc={cena === null ? "nie wiemy" : tyleIleZada ? "tyle, ile żąda" : zlote(cena, waluta)}
      kolor={cena !== null ? "text-slate-900" : "text-slate-700"}
      pod={[cena !== null ? "brutto" : "paragonu nie mamy", naszZakup].filter(Boolean).join(" · ")}>
      {sprzedaz.length > 0 && <div className="mt-1"><CenyKartoteki ceny={sprzedaz} ramka={false} /></div>}
    </Kostka>

    {twId !== null && <Kostka etykieta="Dostawca"
      wartosc={dostawa?.dostawca ?? "nie wiemy"}
      kolor={dostawa ? "text-slate-900" : "text-slate-700"}
      /* W komórce stoi SYMBOL kontrahenta, bo pełnej nazwy serwer nie
         importuje. Podpowiedź mówi to wprost, żeby nikt nie szukał nazwy. */
      tytul={dostawa ? `Symbol dostawcy w Subiekcie${
        dostawa.numer ? `. Dokument dostawy: ${dostawa.numer}` : ""}` : undefined}
      /* Partia SPRZED zakupu to ta, z której klient dostał sztukę. Gdy takiej
         nie ma, ostatnia dostawa w ogóle jest tylko tropem i tak się nazywa. */
      pod={dostawa
        ? `${dostawa.przedZakupem ? "dostawa przed zakupem" : "ostatnia dostawa"} ${dzien(dostawa.data)}`
        : "nie znamy dostawy tego towaru"} />}
  </>;
}

/** Skąd jest data zakupu — dwa zegary, dwie nazwy. */
const ZEGAR: Record<string, string> = {
  zamowienie: "data z zamówienia", sprawa: "data z ładunku sprawy",
};

/**
 * Po ilu pełnych dniach od zakupu klient zgłosił sprawę.
 *
 * Serwer liczy to sam; starszy go nie zna, więc wtedy liczymy z jego dwóch
 * dat — obie są z serwera, więc zegar przeglądarki w tym nie bierze udziału.
 */
function zgloszonoPoDniach(r: Reklamacja): number | null {
  if (r.zgloszonoPoDniach !== undefined) return r.zgloszonoPoDniach;
  if (!r.kupionoAt || !r.otwartoAt) return null;
  const dni = Math.floor((Date.parse(r.otwartoAt) - Date.parse(r.kupionoAt)) / 86_400_000);
  return Number.isFinite(dni) && dni >= 0 ? dni : null;
}

/**
 * Wiek zakupu jednym słowem — „14 miesięcy temu" zamiast „17 lipca 2025".
 *
 * Ta sama zamiana, co przy terminie decyzji: pytanie, które agent zadaje
 * patrząc na datę zakupu, brzmi „ile to już leży", a nie „który to był dzień".
 * Do dwóch miesięcy liczą się DNI, bo przy „uszkodzone w transporcie" różnica
 * między trzecim a trzydziestym dniem jest całą sprawą; dalej miesiące, bo
 * nikt nie liczy czterystu dni w głowie.
 *
 * `poDwochLatach` to FAKT ARYTMETYCZNY, nie wyrok: rękojmia biegnie dwa lata
 * od wydania rzeczy, a nasz zegar startuje od zamówienia albo od złożenia
 * koszyka — obie daty są WCZEŚNIEJSZE niż wydanie, więc próg wypada dla nas
 * bezpiecznie i sam niczego nie przesądza.
 */
function wiekZakupuSlowem(dni: number | null): { napis: string; poDwochLatach: boolean } | null {
  if (dni === null) return null;
  const poDwochLatach = dni > 730;
  if (dni < 60) {
    return { napis: dni === 0 ? "dziś" : `${dniSlowo(dni)} temu`, poDwochLatach };
  }
  /* 30,44 dnia to średnia długość miesiąca w roku zwykłym i przestępnym
     naraz. Dzielenie przez 30 dawałoby „12 miesięcy" przy 360 dniach, czyli
     przy dacie, która do roku jeszcze nie doszła. */
  const mies = Math.floor(dni / 30.44);
  if (mies < 24) return { napis: `${ile(mies, "miesiąc", "miesiące", "miesięcy")} temu`, poDwochLatach };
  const lata = Math.floor(dni / 365.25);
  return { napis: `${ile(lata, "rok", "lata", "lat")} temu`, poDwochLatach };
}

/* ── GDZIE JEST PACZKA DO KLIENTA ────────────────────────────────────────────
   „Czy on to w ogóle dostał" jest przy reklamacji pytaniem PIERWSZYM, a przy
   powodach „nie otrzymałem produktu" — całą sprawą. Dlatego odpowiedź stoi
   w komórce, widoczna bez klikania. Pod nią numer listu i pytanie od nowa.

   Ładunek zamówienia numeru przesyłki NIE MA — stoi pod osobną końcówką
   `/order/checkout-forms/{id}/shipments`. Pytamy na JAWNE kliknięcie: żądanie
   u dostawcy nie wychodzi z patrzenia. */
function Paczka({ przesylka: p, onSprawdz, trwa, blad }: {
  przesylka: NonNullable<SzczegolReklamacji["przesylka"]>;
  onSprawdz?: () => void;
  trwa: boolean;
  blad: string;
}) {
  return <Kostka etykieta="Paczka do klienta"
    wartosc={p.dostarczonoAt && p.waybill !== null ? "doręczona" : stanPaczki(p)}
    kolor={p.dostarczonoAt ? "text-slate-900" : "text-slate-700"}
    /* Przewoźnik słowem ze wspólnego słownika zwrotów, obok daty: numer
       listu ma wtedy własną linię razem z przyciskiem kopiowania. */
    pod={[
      p.dostarczonoAt && p.waybill !== null ? dzien(p.dostarczonoAt) : null,
      p.waybill !== null && p.przewoznik ? PRZEWOZNICY[p.przewoznik] ?? p.przewoznik : null,
    ].filter(Boolean).join(" · ")}>
    <div className="text-podpis text-slate-600">
      {/* Numer listu mono, bo czyta się go znak po znaku z naklejki. */}
      {p.waybill !== null && <p className="flex items-center gap-x-1">
        <span className="min-w-0 break-all font-mono text-slate-700">{p.waybill}</span>
        <Skopiuj tekst={p.waybill} tytul="Kopiuj numer listu" />
      </p>}
      {/* Kiedy pytaliśmy, stoi krótko: rok i godzina nie rozstrzygają, czy
          zapytać znowu. Pełną chwilę niesie podpowiedź. */}
      <p title={p.sprawdzonoAt ? `Pytaliśmy Allegro ${czas(p.sprawdzonoAt)}` : undefined}>
        {p.sprawdzonoAt ? `sprawdzone ${kiedy(p.sprawdzonoAt)}` : "nie pytaliśmy jeszcze Allegro"}
        {onSprawdz && <>{" · "}<button type="button" disabled={trwa} onClick={onSprawdz}
          className="min-h-6 font-semibold text-slate-700 underline underline-offset-2 disabled:opacity-50">
          {trwa ? "pytam…" : p.sprawdzonoAt ? "sprawdź jeszcze raz" : "sprawdź"}</button></>}
      </p>
      {blad && <p className="text-red-700">{blad}</p>}
    </div>
  </Kostka>;
}

/**
 * Stan paczki jednym zdaniem — to jest odpowiedź, którą widać bez otwierania.
 *
 * Kod przewoźnika idzie przez słownik skrzynki, bo „IN_TRANSIT" nie mówi
 * agentowi nic. Kod spoza słownika stoi z dopiskiem, skąd jest: kod da się
 * dopisać do słownika, a pustego miejsca nikt nie zauważy.
 */
function stanPaczki(p: NonNullable<SzczegolReklamacji["przesylka"]>): string {
  if (p.sprawdzonoAt === null) return "nie wiemy";
  if (p.waybill === null) return "Allegro nie ma numeru";
  if (p.status === null) return "przewoźnik nie podał statusu";
  return STATUS_PACZKI[p.status] ?? `przewoźnik podał: ${p.status}`;
}

/** Pozycja sporna i reszta zamówienia — po ofercie, której dotyczy reklamacja. */
function pozycjeZamowienia(pozycje: PozycjaZamowienia[], offerId: string | null) {
  const sporna = (p: PozycjaZamowienia) => p.offerId !== null && p.offerId === offerId;
  return { sporne: pozycje.filter(sporna), inne: pozycje.filter((p) => !sporna(p)) };
}

/* ── ZAMÓWIENIE: TO, CZEGO NIE MÓWI ANI GŁOWICA, ANI RESZTA PASA ─────────────
   Pozycji spornej się nie powtarza: nazwa stoi w wierszu towaru, cena
   w komórce „Klient zapłacił". Zostaje reszta zamówienia, dostawa i suma.
   DOSTAWA STOI OSOBNO, bo klient żądający zwrotu pyta czasem właśnie o nią.
   Odnośniki do Allegro stoją przy numerze reklamacji, w prawej szczelinie. */
function Zamowienie({ szczegol }: { szczegol: SzczegolReklamacji }) {
  const z = szczegol.zamowienie;
  if (!z) return <Kostka etykieta="Zamówienie" wartosc="nie pobraliśmy" kolor="text-slate-700" pod="" />;
  const { sporne, inne } = pozycjeZamowienia(z.pozycje, szczegol.reklamacja.offerId);
  const lista = sporne.length > 0 ? inne : z.pozycje;
  const tylkoTen = sporne.length > 0 && inne.length === 0;
  const wartosc = tylkoTen ? "tylko ten towar"
    : sporne.length > 0 ? `+${ile(inne.length, "inna pozycja", "inne pozycje", "innych pozycji")}`
      : ile(z.pozycje.length, "pozycja", "pozycje", "pozycji");
  /* Suma JEDNEJ SZTUKI z darmową dostawą to ta sama liczba, co komórka
     „Klient zapłacił" obok, więc wtedy jej nie ma. Komórka niesie cenę
     sztuki, więc przy kilku sztukach suma mówi coś nowego i zostaje. Zostaje
     też przy dostawie płatnej albo nieznanej: koszt dostawy kształtuje kwotę
     zwrotu, a nieznany koszt to nie zero. */
  const razemPowtarza = tylkoTen && sporne.length === 1 && sporne[0].ilosc === 1
    && z.dostawaGrosze === 0;
  return <Kostka etykieta="Zamówienie" wartosc={wartosc} kolor="text-slate-900"
    pod={[
      `dostawa ${zlote(z.dostawaGrosze, z.waluta)}${z.dostawaMetoda ? `, ${z.dostawaMetoda}` : ""}`,
      z.sumaGrosze !== null && !razemPowtarza ? `razem ${zlote(z.sumaGrosze, z.waluta)}` : null,
    ].filter(Boolean).join(" · ")}>
    {lista.length > 0 && <ul className="mt-0.5 text-podpis text-slate-700">
      {lista.map((p, i) => <li key={`${p.offerId ?? p.sku ?? i}`} className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">{p.nazwa}</span>
        <span className="shrink-0 tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
      </li>)}
    </ul>}
  </Kostka>;
}

/* ── TEN ZAKUP U NAS ─────────────────────────────────────────────────────────
   Droga jest nadzbiorem spraw o jednym zakupie: `services/droga-klienta.ts`
   składa przystanki z tych samych tabel, a każdy przystanek niesie odnośnik
   do swojej kolejki. Rodzeństwo spraw zostaje, bo niesie to, czego droga nie
   ma: termin cudzej sprawy, kto ją prowadzi i czy jest otwarta. To wiązanie
   drogi klienta w obie strony. Stoi w głowicy, widoczny bez przewijania,
   więc żaden wskaźnik do niego nie prowadzi. */
function ZakupUNas({ szczegol }: { szczegol: SzczegolReklamacji }) {
  const r = szczegol.reklamacja;
  const idNapisu = useId();
  if (szczegol.droga.length < 2 && szczegol.sprawy.length === 0) return null;
  return <section aria-labelledby={idNapisu} className="flex flex-wrap items-start gap-x-3 gap-y-1">
    <span id={idNapisu} className="inline-flex items-center gap-1 py-0.5 text-xs font-semibold text-slate-700">
      <Route size={14} aria-hidden="true" />Ten zakup u nas</span>
    {szczegol.droga.length > 1 && <DrogaZakupu droga={szczegol.droga}
      tutaj={{ rodzaj: "reklamacja", id: r.id }} wSekcji />}
    {szczegol.sprawy.length > 0 && <div className="min-w-0 flex-1">
      <SprawyZakupu sprawy={szczegol.sprawy} wSekcji /></div>}
  </section>;
}

/** Jedna komórka pasa: etykieta, wartość grubym drukiem, zdanie pod spodem. */
function Kostka({ etykieta, wartosc, kolor, pod, tytul, children }: {
  etykieta: string; wartosc: string; kolor: string; pod: string;
  /** Podpowiedź pod kursorem — to, co nie mieści się w komórce, a bywa potrzebne. */
  tytul?: string;
  children?: React.ReactNode;
}) {
  return <div title={tytul} className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
    <EtykietaWartosci className="block">{etykieta}</EtykietaWartosci>
    <p className={`mt-0.5 break-words text-lg font-bold leading-tight tabular-nums ${kolor}`}>{wartosc}</p>
    {pod && <p className="text-podpis text-slate-600">{pod}</p>}
    {children}
  </div>;
}
