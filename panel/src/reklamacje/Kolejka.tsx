import React, { useEffect, useRef } from "react";
import {
  AlertTriangle, MessageSquareWarning, Headset, Lock, PackageCheck, CircleHelp,
  Gavel, CircleX, PackageSearch,
} from "lucide-react";
import type { KubelekReklamacji, Reklamacja, SygnalReklamacji } from "../api/typy";
import { ZdjecieOferty } from "../towar/Zdjecie";
import { NaglowekSekcji, Pusto, dataCyfrowa, dniSlowo } from "../ui";
import { CzipTagu } from "../sprawy/Tagi";
import { mojaSprawa } from "../sprawy/Moje";

/* ── Kolejka reklamacji ──────────────────────────────────────────────────────
   Wiersz czyta się W BIEGU: kto, czyja, do kiedy, o jaki towar i która to
   sprawa. Żądania i kwoty na wierszu nie ma, bo to pytania do otwartej sprawy,
   a nie do przeglądania listy. Prawa kolumna sprawy niesie je w jednym domu.

   KLIENT NA CZELE WIERSZA. Login stoi pierwszy, mono i pogrubiony, jak
   w wierszu skrzynki, bo to klucz klienta w całej drodze. Obok znak
   prowadzącego inicjałami, bo imię zjadałoby miejsce loginu.

   NUMER STOI NA WIDOKU. Agent przepisuje go z rozmowy z klientem i z Allegro,
   więc ma go widzieć, a nie tylko znaleźć szukaniem.

   Zdjęcie oferty zostaje, bo jest tożsamością sprawy. Bierzemy obraz OFERTY,
   nie kartoteki: klient reklamuje to, co kupił. Kafel ma stały rozmiar także
   bez obrazu, żeby wiersze nie skakały pod kursorem.

   PO TERMINIE NIESIE NAGŁÓWEK GRUPY. Sprawy po terminie decyzji stoją
   pierwsze, pod jednym nagłówkiem, a wiersz mówi już tylko „ile”. Kolejność
   grup liczy `wGrupach`, a ekran chodzi strzałkami po tej samej tablicy.   */

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

/* To samo w dopełniaczu, bo w dymku zgłoszenia stoi po „chce”. */
const CHCE: Record<string, string> = {
  REPAIR: "naprawy",
  EXCHANGE: "wymiany",
  REFUND: "zwrotu pieniędzy",
  PARTIAL_REFUND: "częściowego zwrotu",
};

/**
 * Linia nad zdaniem klienta w dymku zgłoszenia: „Powód: … · chce …”.
 *
 * Kod spoza słownika zostaje kodem, bo zgadnięte słowo byłoby nieprawdą.
 * Brak obu daje `null`, a dymek stoi wtedy bez tej linii.
 */
export function liniaPowodu(r: Pick<Reklamacja, "powodTyp" | "oczekiwanie">): string | null {
  const czesci: string[] = [];
  if (r.powodTyp) czesci.push(`Powód: ${POWODY[r.powodTyp] ?? r.powodTyp}`);
  if (r.oczekiwanie) {
    const chce = CHCE[r.oczekiwanie] ?? r.oczekiwanie;
    czesci.push(czesci.length ? `chce ${chce}` : `Chce ${chce}`);
  }
  return czesci.length ? czesci.join(" · ") : null;
}

/* `dniSlowo` mieszka w `ui/` od audytu z 15 września 2026 — stało w trzech
   kolejkach przepisane znak w znak. Re-eksport zostaje, bo wołają je stąd
   sąsiednie pliki i test tej kolejki. */
export { dniSlowo } from "../ui";

/**
 * Kwota w grze — oś porządku „kwota”.
 *
 * Liczy ją serwer: żądany zwrot, a bez niego cena z paragonu razy ilość.
 * Starszy serwer pola nie zna (`undefined`), więc wtedy zostaje żądany zwrot.
 * `null` znaczy „nie wiemy”, nie zero, i spada na koniec listy.
 */
export function kwotaWiersza(r: Reklamacja): number | null {
  return r.kwotaGrosze !== undefined ? r.kwotaGrosze : r.oczekiwanaKwotaGrosze;
}

/** Kolejność listy: najpierw sprawy po terminie decyzji, potem reszta, każda grupa w swoim porządku. */
export function wGrupach(lista: Reklamacja[]): Reklamacja[] {
  return [...lista.filter((r) => r.poTerminie), ...lista.filter((r) => !r.poTerminie)];
}

/** Inicjały prowadzącego — „A. Lewandowska” daje „AL”. */
export function inicjaly(imie: string): string {
  const czlony = imie.split(/[\s.]+/).filter(Boolean);
  return czlony.slice(0, 2).map((c) => c[0]!.toLocaleUpperCase("pl")).join("");
}

/**
 * Dni do terminu decyzji — jedyna liczba na wierszu, którą czyta się jako pilność.
 *
 * BRAK TERMINU MÓWI TO WPROST. Allegro nie podaje `decisionDueDate` dla
 * każdej sprawy, a puste miejsce w kolumnie pilności czytałoby się jako „zdąży
 * się” — czyli odwrotnie, niż trzeba.
 *
 * W GRUPIE PO TERMINIE wystarczy „ile”: słowo „po” stoi już w nagłówku grupy.
 * Barwa idzie za pilnością: czerwień od dnia terminu, bursztyn przy trzech
 * dniach, bo tyle trwa zebranie dowodów od klienta.
 */
function Termin({ dni, wGrupie }: { dni: number | null; wGrupie: boolean }) {
  const pigulka = "shrink-0 rounded-full px-2 text-xs font-bold leading-5 tabular-nums";
  if (dni === null) {
    return <span className={`${pigulka} bg-slate-100 text-ranga-nic`}
      title="Allegro nie podało terminu decyzji przy tej sprawie">bez terminu</span>;
  }
  const ton = dni <= 0 ? "bg-red-50 text-ranga-zle"
    : dni <= 3 ? "bg-orange-50 text-ranga-uwaga" : "bg-slate-100 text-ranga-nic";
  const ileDni = dniSlowo(Math.abs(dni));
  const tekst = dni < 0 ? (wGrupie ? ileDni : `${ileDni} po`) : dni === 0 ? "dziś" : ileDni;
  return <span className={`${pigulka} ${ton}`}
    title={`Termin decyzji: ${dni < 0 ? "przekroczony" : "za " + dniSlowo(dni)}`}>{tekst}</span>;
}

/**
 * Kto prowadzi — inicjały w kółku albo „niczyja”.
 *
 * O „moja” rozstrzyga NUMER KONTA, nie imię, bo w biurze bywają imienniczki.
 * Własna sprawa ma zieleń, tę samą co „Prowadzisz” w głowicy sprawy.
 */
function Prowadzacy({ prowadzi, moja }: { prowadzi: string | null; moja: boolean }) {
  if (!prowadzi) return <span className="shrink-0 text-xs text-slate-600">niczyja</span>;
  return <span title={moja ? `Prowadzisz tę sprawę (${prowadzi})` : `Prowadzi: ${prowadzi}`}
    className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-bold ${
      moja ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-800"}`}>
    <span aria-hidden="true">{inicjaly(prowadzi)}</span>
    <span className="sr-only">{moja ? "prowadzisz" : `prowadzi ${prowadzi}`}</span>
  </span>;
}

export function Kolejka({ reklamacje, wybrana, zKubelkiem = false, onWybierz, mojeId = null,
  nazwaGrupy = "Pozostałe" }: {
  /** Lista w kolejności `wGrupach` — tej samej, po której chodzą strzałki. */
  reklamacje: Reklamacja[];
  wybrana: number | null;
  /** Przy szukaniu lista miesza kubełki, więc wiersz musi powiedzieć swój. */
  zKubelkiem?: boolean;
  /* Tożsamość zalogowanego. Bez niej „prowadzisz” nie ma jak powstać,
     a lista wygląda dokładnie tak, jak wyglądała. */
  mojeId?: number | null;
  onWybierz: (id: number) => void;
  /** Nagłówek grupy spraw w terminie — zwykle nazwa bieżącego kubełka. */
  nazwaGrupy?: string;
}) {
  const aktywnyWiersz = useRef<HTMLButtonElement | null>(null);

  /* Wybór trzeba DOGONIĆ widokiem — inaczej strzałka przesuwa zaznaczenie
     poza dolną krawędź i operator steruje czymś, czego nie widzi. */
  useEffect(() => { aktywnyWiersz.current?.scrollIntoView?.({ block: "nearest" }); }, [wybrana]);

  if (!reklamacje.length) {
    return <Pusto waga="lista">
      {zKubelkiem
        ? "Żadna reklamacja nie pasuje do tego, czego szukasz."
        : "Ten kubełek jest pusty — nic tu nie czeka na ruch."}</Pusto>;
  }

  const wiersz = (r: Reklamacja) => {
    const aktywna = r.id === wybrana;
    /* Termin niesie plakietka z dniami, więc czip „termin” byłby drugim
       znakiem tej samej rzeczy na jednym wierszu. */
    const sygnaly = r.sygnaly.filter((s) => s !== "termin");
    const numer = r.numer ?? r.externalId;
    const werdykt = r.werdyktNazwa && r.werdyktStatus !== "send_failed";
    const czipy = werdykt || r.tagi.length > 0 || sygnaly.length > 0;
    return <li key={r.id}>
      <button type="button"
        /* Enter na wierszu prowadzi do pola odpowiedzi, jak w skrzynce. */
        data-wiersz-kolejki=""
        aria-current={aktywna ? "true" : undefined}
        ref={aktywna ? aktywnyWiersz : null}
        onClick={() => onWybierz(r.id)}
        /* ZAZNACZENIE SZARE I BEZ BURSZTYNU: belka 3 px stoi przy każdym
           wierszu, a przy wybranym zmienia tylko barwę na grafit. Bursztyn
           w tej kolejce znaczy „uwaga”, więc nie może znaczyć „wybrane”. */
        className={`flex w-full gap-3 border-l-[3px] px-4 py-3 text-left ${aktywna
          ? "wiersz-wybrany border-l-slate-600 bg-slate-200"
          : "border-l-transparent hover:bg-slate-50"}`}>
        <ZdjecieOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={88}
          nazwa={r.ofertaNazwa ?? numer} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            {/* Login jest ZWYKŁYM TEKSTEM, nie przyciskiem kopiowania: cały
                wiersz jest przyciskiem, a przycisków się nie zagnieżdża. */}
            {r.kupujacyLogin
              ? <span title={r.kupujacyLogin}
                  className="min-w-0 truncate font-mono text-sm font-bold text-slate-900">{r.kupujacyLogin}</span>
              : <span className="min-w-0 truncate text-sm text-slate-600">bez loginu</span>}
            <Prowadzacy prowadzi={r.prowadzi} moja={mojaSprawa(r.prowadziId, mojeId)} />
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {zKubelkiem && <span className="text-podpis font-semibold text-slate-600">
                {KUBELKI.find((k) => k.id === r.kubelek)?.etykieta}</span>}
              <Termin dni={r.dniDoTerminu} wGrupie={r.poTerminie} />
            </span>
          </span>
          {/* Nazwa w DWÓCH liniach: nazwy części bywają długie, a koniec
              nazwy („46 cm”, „Stihl MS181”) rozróżnia sprawy najczęściej. */}
          {r.ofertaNazwa
            ? <span className="line-clamp-2 text-sm text-slate-800">{r.ofertaNazwa}</span>
            : <span className="text-sm text-slate-600">Oferty nie pobrano</span>}
          <span className="flex flex-wrap gap-x-2.5 text-xs text-slate-600">
            <span className="font-semibold tabular-nums text-slate-900">{numer}</span>
            <span>zgłoszono {dataCyfrowa(r.otwartoAt)}</span>
          </span>
          {czipy && <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* Werdykt z PANELU na wierszu rozstrzygniętym — zdanie pisze serwer.
                Sprawa rozstrzygnięta w Centrum Sprzedaży czipa nie ma, bo
                udawanie jej naszą decyzją byłoby kłamstwem. */}
            {werdykt &&
              <span title={`Werdykt z panelu${r.werdyktPrzez ? `: ${r.werdyktPrzez}` : ""}`}
                className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 text-xs font-bold leading-5 text-emerald-800">
                <Gavel size={13} />{r.werdyktNazwa}</span>}
            {/* TAGI PRZED SYGNAŁAMI: sygnał liczy maszyna z faktu, tag pisze
                człowiek, a szuka się słowa, które się samemu wpisało. */}
            {r.tagi.map((t) => <CzipTagu key={t.id} nazwa={t.nazwa} />)}
            {sygnaly.map((s) => (
              <span key={s} title={SYGNALY[s].tytul}
                className={`inline-flex items-center gap-1 rounded px-1.5 text-xs font-bold leading-5 ${SYGNALY[s].klasa}`}>
                {SYGNALY[s].ikona}{SYGNALY[s].krotko}
              </span>
            ))}
          </span>}
        </span>
      </button>
    </li>;
  };

  const po = reklamacje.filter((r) => r.poTerminie);
  const reszta = reklamacje.filter((r) => !r.poTerminie);
  /* Dwie listy pod dwoma nagłówkami, nie nagłówek wciśnięty w jedną: lista
     niesie wyłącznie swoje pozycje, a czytnik ogłasza grupę i jej liczbę. */
  return <div>
    {po.length > 0 && <>
      <NaglowekSekcji jako="h3" ton="text-ranga-zle" className="px-4 pb-1 pt-2.5">
        Po terminie</NaglowekSekcji>
      <ul className="divide-y divide-slate-200 border-b border-slate-200">{po.map(wiersz)}</ul>
    </>}
    {reszta.length > 0 && <>
      <NaglowekSekcji jako="h3" ton="text-slate-600" className="px-4 pb-1 pt-2.5">
        {nazwaGrupy}</NaglowekSekcji>
      <ul className="divide-y divide-slate-200">{reszta.map(wiersz)}</ul>
    </>}
  </div>;
}
