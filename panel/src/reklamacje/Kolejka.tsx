import React, { useEffect, useRef } from "react";
import {
  AlertTriangle, MessageSquareWarning, Headset, Lock, PackageCheck, CircleHelp,
  Gavel, CircleX, PackageSearch,
} from "lucide-react";
import type { KubelekReklamacji, Reklamacja, SygnalReklamacji } from "../api/typy";
import { zlote } from "../api/zwroty";
import { ZdjecieOferty } from "../towar/Zdjecie";
import { NaglowekSekcji, Pusto, dniSlowo } from "../ui";
import { CzipTagu } from "../sprawy/Tagi";
import { mojaSprawa } from "../sprawy/Moje";

/* ── Kolejka reklamacji ──────────────────────────────────────────────────────
   Wiersz ma się czytać W BIEGU, więc niesie TRZY linie i jedną barwę sygnału.
   Pierwsza to towar i ile zostało do terminu, druga — czego klient chce, za
   co i za ile, trzecia — numer, login i kto prowadzi. Wszystko, co trzeba
   doczytać, stoi w obszarze sprawy po prawej.

   TYTUŁEM JEST TOWAR, nie numer: oko szuka kosiarki, a numer sprawy czyta
   się dopiero przy kopiowaniu, więc schodzi do podpisu. Zdjęcie oferty
   zostaje, bo jest tożsamością sprawy — „pękła obudowa" przy zdjęciu
   kosiarki czyta się w biegu, przy samym numerze wymaga otwarcia sprawy.
   Bierzemy obraz OFERTY, nie kartoteki: klient reklamuje to, co kupił.
   Kafel ma stały rozmiar także bez obrazu, żeby wiersze nie skakały pod
   kursorem.

   SYGNAŁ WSPÓLNY DLA CAŁEGO KUBEŁKA ZNIKA Z WIERSZA. W „Do odpowiedzi"
   każda sprawa ma „klient czeka", bo tak liczy się sam kubełek — jedenaście
   identycznych czipów nie rozróżnia niczego. Które sygnały są wspólne,
   liczy EKRAN ze składu kubełka (`wspolneSygnaly`) i mówi je raz nad listą.
   Kolejka sama tego nie liczy, bo lista z jednym wierszem miałaby wtedy
   wspólne wszystko.

   PO TERMINIE NIESIE NAGŁÓWEK GRUPY. Sprawy po terminie decyzji stoją
   pierwsze, pod jednym nagłówkiem, a wiersz mówi już tylko „ile". Kolejność
   grup liczy `wGrupach`, a ekran chodzi strzałkami po tej samej tablicy —
   inaczej kursor skakałby po liście w innym porządku, niż ją widać.       */

export const KUBELKI: Array<{ id: KubelekReklamacji; etykieta: string; pytanie: string }> = [
  { id: "decyzja", etykieta: "Do decyzji", pytanie: "Uznać czy odrzucić?" },
  { id: "odpowiedz", etykieta: "Do odpowiedzi", pytanie: "Co odpisać klientowi?" },
  { id: "zamknieta", etykieta: "Rozstrzygnięte", pytanie: "Tylko wgląd." },
  /* CZWARTY KUBEŁEK, nie ukrycie. Sprawa z zamkniętą rozmową i terminem sprzed
     miesiąca nie jest pracą — Allegro nie przyjmie już wiadomości, a zegar nic
     nie mierzy. Zniknięcie z kolejki musi mieć jednak widoczne uzasadnienie
     i własny licznik; ta sama reguła co przy zwrotach rozliczonych (0.339.0). */
  { id: "bez_ruchu", etykieta: "Bez ruchu", pytanie: "Nic tu nie zrobimy." },
];

/* Etykieta stoi W MAPIE, nie w łańcuchu `?:` przy renderze — ta sama poprawka
   co przy zwrotach w 0.209.0. Łańcuch milcząco podpisywałby każdy nowy sygnał
   ostatnią gałęzią, czyli kłamałby na ekranie zamiast nie przejść kompilacji. */
export const SYGNALY: Record<SygnalReklamacji,
  { tytul: string; krotko: string; ikona: React.ReactNode; klasa: string }> = {
  termin: { tytul: "Termin decyzji blisko albo minął", krotko: "termin",
    klasa: "bg-red-100 text-ranga-zle", ikona: <AlertTriangle size={13} /> },
  klient_czeka: { tytul: "Ostatnie słowo było klienta — ruch należy do nas",
    krotko: "klient czeka",
    klasa: "bg-amber-100 text-ranga-uwaga", ikona: <MessageSquareWarning size={13} /> },
  /* Doradca Allegro odpisał w 61 sprawach na 100 w sondzie z żywego konta.
     To nie jest przypadek brzegowy i zmienia ton odpowiedzi: w rozmowie jest
     trzecia strona, która czyta wszystko. */
  doradca: { tytul: "W rozmowie jest doradca Allegro", krotko: "doradca",
    klasa: "bg-sky-100 text-sky-800", ikona: <Headset size={13} /> },
  czat_zamkniety: { tytul: "Allegro nie przyjmie już nowej wiadomości w tej sprawie",
    krotko: "czat zamknięty",
    klasa: "bg-slate-200 text-ranga-nic", ikona: <Lock size={13} /> },
  zwrot_wymagany: { tytul: "Sprzedawca zażądał zwrotu towaru", krotko: "zwrot towaru",
    klasa: "bg-violet-100 text-violet-800", ikona: <PackageCheck size={13} /> },
  /* Status spoza specyfikacji NIE JEST BŁĘDEM: nie wywraca przebiegu i nie
     znika z ekranu. To jest mechanizm weryfikacji listy na żywym koncie. */
  status_nieznany: { tytul: "Allegro przysłało status, którego nie ma w specyfikacji",
    krotko: "status?", klasa: "bg-red-100 text-ranga-zle", ikona: <CircleHelp size={13} /> },
  /* Los NASZEGO werdyktu (przyrost trzeci). `statusAllegro` należy do Allegro
     i mówi o nim dopiero po synchronizacji — do tego czasu wiersz ma powiedzieć,
     że decyzja zapadła i czeka na potwierdzenie, a nie milczeć. */
  werdykt_niepotwierdzony: { tytul: "Werdykt wysłany z panelu — Allegro jeszcze nie potwierdziło",
    krotko: "werdykt czeka", klasa: "bg-amber-100 text-ranga-uwaga", ikona: <Gavel size={13} /> },
  werdykt_nieudany: { tytul: "Allegro odrzuciło werdykt kodem — spróbuj jeszcze raz",
    krotko: "werdykt nieudany", klasa: "bg-red-100 text-ranga-zle", ikona: <CircleX size={13} /> },
  towar_do_decyzji: { tytul: "Reklamacja uznana, a kupujący nie wie, czy odsyłać towar",
    krotko: "towar?", klasa: "bg-violet-100 text-violet-800", ikona: <PackageSearch size={13} /> },
};

/** Powody z `PostPurchaseIssueReason.type` po polsku. Nieznany zostaje SUROWY. */
export const POWODY: Record<string, string> = {
  DEFECT_FOUND_DURING_USE: "usterka przy używaniu",
  NOT_AS_DESCRIBED: "niezgodny z opisem",
  MISSING_PRODUCT_ELEMENT: "brakuje elementu",
  PRODUCT_DAMAGED_PARCEL_INTACT: "uszkodzony, paczka cała",
  PRODUCT_AND_PARCEL_DAMAGED_IN_TRANSIT: "uszkodzony w transporcie",
  NO_PRODUCT_RECEIVED: "towar nie dotarł",
  NO_PRODUCT_IN_PARCEL: "brak towaru w paczce",
  NO_PROOF_OF_PURCHASE_MANUAL_OR_WARRANTY: "brak dowodu zakupu",
  ITEM_IS_DAMAGED: "towar uszkodzony",
  RECEIVED_INCOMPLETE_ORDER: "niekompletne zamówienie",
  RECEIVED_ITEMS_NOT_MATCHING_DESCRIPTION: "towar niezgodny z opisem",
  OTHER: "inny powód",
};

/** Czego klient chce — `PostPurchaseIssueExpectation.name`. */
export const OCZEKIWANIA: Record<string, string> = {
  REPAIR: "naprawa",
  EXCHANGE: "wymiana",
  REFUND: "zwrot pieniędzy",
  PARTIAL_REFUND: "częściowy zwrot",
};

/* `dniSlowo` mieszka w `ui/` od audytu z 15 września 2026 — stało w trzech
   kolejkach przepisane znak w znak. Re-eksport zostaje, bo wołają je stąd
   sąsiednie pliki i test tej kolejki. */
export { dniSlowo } from "../ui";

/**
 * Kwota w grze — ta sama liczba na wierszu i w porządku „kwota".
 *
 * Liczy ją serwer: żądany zwrot, a bez niego cena z paragonu razy ilość.
 * Starszy serwer pola nie zna (`undefined`), więc wtedy zostaje żądany zwrot,
 * jedyna kwota, jaką wiersz miał zawsze. `null` znaczy „nie wiemy", nie zero.
 */
export function kwotaWiersza(r: Reklamacja): number | null {
  return r.kwotaGrosze !== undefined ? r.kwotaGrosze : r.oczekiwanaKwotaGrosze;
}

/** Kolejność listy: najpierw sprawy po terminie decyzji, potem reszta, każda grupa w swoim porządku. */
export function wGrupach(lista: Reklamacja[]): Reklamacja[] {
  return [...lista.filter((r) => r.poTerminie), ...lista.filter((r) => !r.poTerminie)];
}

/**
 * Sygnały, które ma KAŻDA sprawa listy — tylko przy co najmniej dwóch.
 *
 * Jedna sprawa nie ma z czym się porównać, więc przy niej nic nie jest
 * „wspólne". Termin odpada zawsze, bo niesie go liczba dni na wierszu.
 */
export function wspolneSygnaly(lista: Reklamacja[]): SygnalReklamacji[] {
  if (lista.length < 2) return [];
  return lista[0].sygnaly.filter((s) => s !== "termin" && lista.every((r) => r.sygnaly.includes(s)));
}

/**
 * Dni do terminu decyzji — jedyna liczba na wierszu, którą czyta się jako pilność.
 *
 * BRAK TERMINU MÓWI TO WPROST. Allegro nie podaje `decisionDueDate` dla
 * każdej sprawy, a puste miejsce w kolumnie pilności czytałoby się jako „zdąży
 * się" — czyli odwrotnie, niż trzeba.
 *
 * W GRUPIE PO TERMINIE wystarczy „ile": słowo „po" stoi już w nagłówku grupy,
 * a powtórzone na każdym wierszu byłoby tą samą czerwoną pigułką jedenaście
 * razy. Bez pigułki — sama barwa pisma, bo tło na każdym wierszu krzyczało
 * równo i przez to nie rozróżniało niczego.
 */
function Termin({ dni, wGrupie }: { dni: number | null; wGrupie: boolean }) {
  if (dni === null) {
    return <span className="shrink-0 text-xs font-semibold text-slate-600"
      title="Allegro nie podało terminu decyzji przy tej sprawie">bez terminu</span>;
  }
  const pilne = dni <= 3;
  const ileDni = dniSlowo(Math.abs(dni));
  const tekst = dni < 0 ? (wGrupie ? ileDni : `${ileDni} po`) : dni === 0 ? "dziś" : ileDni;
  return <span className={`shrink-0 text-xs font-bold tabular-nums ${
    pilne ? "text-ranga-zle" : "text-slate-600"}`}
    title={`Termin decyzji: ${dni < 0 ? "przekroczony" : "za " + dniSlowo(dni)}`}>{tekst}</span>;
}

/** Skąd jest kwota z prawej — żądanie klienta to inna rozmowa niż cena z paragonu. */
const ZRODLO_KWOTY: Record<string, string> = {
  zadanie: "Kwota, której żąda klient",
  paragon: "Cena z paragonu za reklamowane sztuki",
};

export function Kolejka({ reklamacje, wybrana, zKubelkiem = false, onWybierz, mojeId = null,
  ukryjSygnaly = [] }: {
  /** Lista w kolejności `wGrupach` — tej samej, po której chodzą strzałki. */
  reklamacje: Reklamacja[];
  wybrana: number | null;
  /** Przy szukaniu lista miesza kubełki, więc wiersz musi powiedzieć swój. */
  zKubelkiem?: boolean;
  /* Tożsamość zalogowanego. Bez niej „prowadzisz" nie ma jak powstać,
     a lista wygląda dokładnie tak, jak wyglądała. */
  mojeId?: number | null;
  onWybierz: (id: number) => void;
  /** Sygnały wspólne całemu kubełkowi; mówi je ekran raz, nad listą. */
  ukryjSygnaly?: SygnalReklamacji[];
}) {
  const aktywnyWiersz = useRef<HTMLButtonElement | null>(null);

  /* Kolejka jest zamknięta we własnym scrollerze, więc wybór trzeba DOGONIĆ
     widokiem — inaczej strzałka przesuwa zaznaczenie poza dolną krawędź
     i operator steruje czymś, czego nie widzi. Ta sama mechanika co przy
     zwrotach od 0.165.0. */
  useEffect(() => { aktywnyWiersz.current?.scrollIntoView({ block: "nearest" }); }, [wybrana]);

  if (!reklamacje.length) {
    return <Pusto waga="lista">
      {zKubelkiem
        ? "Żadna reklamacja nie pasuje do tego, czego szukasz."
        : "Ten kubełek jest pusty — nic tu nie czeka na ruch."}</Pusto>;
  }

  const wiersz = (r: Reklamacja) => {
    const aktywna = r.id === wybrana;
    /* Czip „termin" odpala przy tym samym progu (≤ 3 dni, `PROG_TERMINU_DNI`
       na serwerze), przy którym liczba dni robi się czerwona. Dwa znaki jednej
       rzeczy na jednym wierszu: liczba niesie przy tym dni, czip tylko
       ostrzeżenie. */
    const sygnaly = r.sygnaly.filter((s) => s !== "termin" && !ukryjSygnaly.includes(s));
    const numer = r.numer ?? r.externalId;
    const oczekiwanie = r.oczekiwanie ? (OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie) : null;
    const powod = r.powodTyp ? (POWODY[r.powodTyp] ?? r.powodTyp) : null;
    const kwota = kwotaWiersza(r);
    const moja = mojaSprawa(r.prowadziId, mojeId);
    const werdykt = r.werdyktNazwa && r.werdyktStatus !== "send_failed";
    const czipy = werdykt || r.tagi.length > 0 || sygnaly.length > 0;
    return <li key={r.id}>
      <button
        /* Enter na wierszu prowadzi do pola odpowiedzi, jak w skrzynce. */
        data-wiersz-kolejki=""
        aria-current={aktywna ? "true" : undefined}
        ref={aktywna ? aktywnyWiersz : null}
        onClick={() => onWybierz(r.id)}
        /* ZAZNACZENIE SZARE I BEZ BURSZTYNU: belka 3 px stoi przy każdym
           wierszu, a przy wybranym zmienia tylko barwę na grafit. Bursztyn
           w tej kolejce znaczy „uwaga", więc nie może znaczyć „wybrane". */
        className={`flex w-full gap-3 border-l-[3px] px-4 py-2.5 text-left ${aktywna
          ? "wiersz-wybrany border-l-slate-600 bg-slate-200"
          : "border-l-transparent hover:bg-slate-50"}`}>
        <ZdjecieOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={44}
          nazwa={r.ofertaNazwa ?? numer} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            {/* Bez snapshotu oferty tytułem zostaje numer — wiersz ma dalej
                mówić, o jaką sprawę chodzi, zamiast udawać, że zna towar. */}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
              {r.ofertaNazwa ?? numer}</span>
            {zKubelkiem && <span className="shrink-0 text-podpis font-semibold text-slate-600">
              {KUBELKI.find((k) => k.id === r.kubelek)?.etykieta}</span>}
            <Termin dni={r.dniDoTerminu} wGrupie={r.poTerminie} />
          </div>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {oczekiwanie && <b className="font-semibold text-slate-800">{oczekiwanie}</b>}
              {powod && <span className="text-slate-600">{oczekiwanie ? " · " : ""}{powod}</span>}
            </span>
            {/* Kwota z prawej, jak kolumna: oko porównuje ją z sąsiednimi
                wierszami, a w środku zdania musiałoby jej szukać. */}
            {kwota !== null && <span className="shrink-0 text-xs tabular-nums text-slate-700"
              title={r.kwotaZrodlo ? ZRODLO_KWOTY[r.kwotaZrodlo] : undefined}>
              {zlote(kwota, r.waluta)}</span>}
          </div>
          <div className="flex min-w-0 items-baseline gap-1 text-podpis text-slate-600">
            {r.ofertaNazwa && <>
              <span className="shrink-0 tabular-nums">{numer}</span>
              <span aria-hidden="true">·</span>
            </>}
            <span className="min-w-0 truncate">{r.kupujacyLogin ?? "bez loginu"}</span>
            {/* ── „PROWADZISZ", GDY SPRAWA JEST MOJA ──────────────────────────
                Właściciel pytał wprost: „które reklamacje są moje". Samo imię
                na to nie odpowiada — dwie osoby w biurze bywają imienniczkami,
                a przy własnym nazwisku i tak trzeba je przeczytać. Rozstrzyga
                NUMER KONTA, ten sam, po którym liczy się sito. Odpowiedź stoi
                na wierszu bez włączania filtru, bo pytanie zadaje się przy
                przeglądaniu całej kolejki. */}
            {r.prowadzi && <>
              <span aria-hidden="true">·</span>
              <span title={moja ? `Prowadzisz tę sprawę (${r.prowadzi})` : `Prowadzi: ${r.prowadzi}`}
                className={`shrink-0 font-semibold ${moja ? "text-emerald-800" : "text-slate-700"}`}>
                {moja ? "prowadzisz" : r.prowadzi}</span>
            </>}
          </div>
          {czipy && <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* Werdykt z PANELU na wierszu rozstrzygniętym — zdanie pisze serwer.
                Sprawa rozstrzygnięta w Centrum Sprzedaży czipa nie ma: „pochodzenie
                decyzji jest informacją", a udawanie jej naszą byłoby kłamstwem. */}
            {werdykt &&
              <span title={`Werdykt z panelu${r.werdyktPrzez ? `: ${r.werdyktPrzez}` : ""}`}
                className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
                <Gavel size={13} />{r.werdyktNazwa}</span>}
            {/* TAGI PRZED SYGNAŁAMI: sygnał liczy maszyna z faktu, tag pisze
                człowiek — a przy szukaniu własnej sprawy szuka się słowa,
                które się samemu wpisało. Kolejności wiersza to nie zmienia
                (§14.5): czip zawęża listę, nie podnosi jej wyżej. */}
            {r.tagi.map((t) => <CzipTagu key={t.id} nazwa={t.nazwa} />)}
            {sygnaly.map((s) => (
              <span key={s} title={SYGNALY[s].tytul}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${SYGNALY[s].klasa}`}>
                {SYGNALY[s].ikona}{SYGNALY[s].krotko}
              </span>
            ))}
          </div>}
        </div>
      </button>
    </li>;
  };

  const po = reklamacje.filter((r) => r.poTerminie);
  if (po.length === 0) return <ul className="divide-y divide-slate-200">{reklamacje.map(wiersz)}</ul>;
  const reszta = reklamacje.filter((r) => !r.poTerminie);
  /* Dwie listy pod dwoma nagłówkami, nie nagłówek wciśnięty w jedną: lista
     ma prawo nieść wyłącznie swoje pozycje, a czytnik ekranu ogłasza wtedy
     grupę i liczbę spraw w niej. */
  return <div>
    <NaglowekSekcji jako="h3" ton="text-ranga-zle" className="px-4 pb-1 pt-2">
      Po terminie decyzji</NaglowekSekcji>
    <ul className="divide-y divide-slate-200">{po.map(wiersz)}</ul>
    {reszta.length > 0 && <>
      <NaglowekSekcji jako="h3" className="border-t border-slate-200 px-4 pb-1 pt-2">
        Pozostałe</NaglowekSekcji>
      <ul className="divide-y divide-slate-200">{reszta.map(wiersz)}</ul>
    </>}
  </div>;
}
