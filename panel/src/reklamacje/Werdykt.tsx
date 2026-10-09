import React, { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, X } from "lucide-react";
import type {
  Reklamacja, WiadomoscReklamacji, Werdykt as KodWerdyktu,
} from "../api/typy";
import { czas, dzien, Skopiuj } from "../ui";
import { zlote } from "../api/zwroty";
import { STATUS_ALLEGRO, rozstrzygniecie, znanyStatus } from "./statusy";
import { LIMIT_ZNAKOW } from "./Edytor";
import { DlugaTresc, scisle, zawieraOpis } from "./tresc";

/* ── KARTA „DECYZJA” (makiety właściciela: Main, Werdykt, Stany) ─────────────
   Pierwszy element prawej kolumny i jedyne miejsce nieodwracalnego kroku.
   Karta rysuje się sama, z ramą, bo ekran stawia ją bez opakowania.

   ZWINIĘTA TO DWA DUŻE PRZYCISKI W BARWACH GAŁĘZI. Zieleń uznania i czerwień
   odmowy niosą znaczenie razem z ikoną i słowem (WCAG 1.4.1). Bursztyn tu
   nie wraca: w panelu znaczy „to idzie teraz do klienta” i należy do
   wysyłki odpowiedzi w czacie, dwie kolumny dalej.

   ROZWINIĘTA TO JEDNA GRUPA JEDENASTU WARTOŚCI ALLEGRO, podzielona na
   „Uznaję” i „Odrzucam, bo”. Lista radiowa pokazuje wszystkie naraz, więc
   pomyłkę pozycji widać bez otwierania listy rozwijanej.

   ZGODA ZOSTAJE, decyzją właściciela, choć makieta jej nie rysuje. Allegro
   drugiego werdyktu nie przyjmie, więc zamiast cofnięcia jest kliknięcie
   w zdanie „Allegro dostanie: …”. Zmiana werdyktu, kwoty albo towaru zdejmuje
   ptaszek, bo zgoda dotyczy konkretnej decyzji, a nie formularza.

   TOWAR: JAWNY WYBÓR BEZ DOMYŚLNEGO, a nie pole wyboru z makiety. Pole
   wyboru ma tylko dwa stany, więc „nie odhaczone” czytałoby się jak „towar
   zostaje”, choć agent o towarze nie pomyślał. Obie odpowiedzi kosztują:
   jedna oddaje sztukę, druga każe klientowi pakować paczkę. Stanowisko
   wychodzi osobną wiadomością typu Allegro, więc niesie własną treść.

   PO WERDYKCIE KARTA MÓWI, CO WYSZŁO I CO Z TEGO WIADOMO. Ponowienie dostaje
   wyłącznie `send_failed`: przy niepewnym losie drugi strzał mógłby być
   drugim werdyktem. Werdykt z Centrum Sprzedaży nie udaje naszego.        */

/** Od ilu znaków przed sufitem licznik w ogóle się pokazuje — jak w edytorze. */
const PROG_LICZNIKA = 500;

/** „12,50" albo „12.50" → grosze; śmieci dają `null`, a nie zero. */
export function naGrosze(tekst: string): number | null {
  const t = tekst.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export type DecyzjaOTowarze = "wymagany" | "niewymagany";

export interface ZadanieWerdyktu {
  werdykt: KodWerdyktu;
  wiadomosc: string;
  kwotaGrosze: number | null;
  /** Stanowisko o towarze — tylko przy uznaniu, gdy los towaru nie zapadł. */
  towar?: { decyzja: DecyzjaOTowarze; tresc: string };
}

/* Kolejność i krótkie nazwy z makiety właściciela. Pełne zdania serwera
   (`werdyktNazwa`) zostają dla stanu po werdykcie, który pisze serwer. */
const UZNAJE: Array<[KodWerdyktu, string]> = [
  ["ACCEPTED_REPAIR", "Naprawa"],
  ["ACCEPTED_EXCHANGE", "Wymiana na nowy"],
  ["ACCEPTED_REFUND", "Zwrot pieniędzy"],
  ["ACCEPTED_PARTIAL_REFUND", "Częściowy zwrot pieniędzy"],
];
const ODRZUCAM: Array<[KodWerdyktu, string]> = [
  ["REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED", "Klient nie uzupełnił wymagań"],
  ["REJECTED_PRODUCT_NOT_RETURNED", "Towar do nas nie wrócił"],
  ["REJECTED_PRODUCT_DAMAGED_BY_USER", "Uszkodzenie z winy kupującego"],
  ["REJECTED_PRODUCT_CONFORMS_TO_CONTRACT", "Towar zgodny z umową"],
  ["REJECTED_MINOR_DEFECT", "Wada nieistotna"],
  ["REJECTED_OTHER", "Inny powód"],
  ["REJECTED_CLAIM_WITHDRAWN_BY_BUYER", "Klient wycofał reklamację"],
];
const KROTKO = Object.fromEntries([...UZNAJE, ...ODRZUCAM]) as Record<KodWerdyktu, string>;

/* Czego chce klient (`PostPurchaseIssueExpectation.name`): uznanie startuje
   na jego życzeniu, bo tak brzmi każde uznanie bez sporu o sposób. */
const UZNANIE_ZYCZENIA: Record<string, KodWerdyktu> = {
  REPAIR: "ACCEPTED_REPAIR", EXCHANGE: "ACCEPTED_EXCHANGE",
  REFUND: "ACCEPTED_REFUND", PARTIAL_REFUND: "ACCEPTED_PARTIAL_REFUND",
};
const CHCE: Record<string, string> = {
  REPAIR: "chce naprawy", EXCHANGE: "chce wymiany",
  REFUND: "chce zwrotu pieniędzy", PARTIAL_REFUND: "chce częściowego zwrotu",
};

/** Zdania startowe stanowiska o towarze — do edycji, nie do wysłania w ciemno. */
const ZDANIE_O_TOWARZE = {
  wymagany: "Prosimy o odesłanie reklamowanego towaru na adres sklepu. Po otrzymaniu paczki zrealizujemy uznaną reklamację.",
  niewymagany: "Towaru nie trzeba odsyłać. Uznaną reklamację zrealizujemy bez zwrotu przesyłki.",
} as const;

/** Jak wybór o towarze brzmi w podsumowaniu i w podpisie pola. */
const TOWAR_SLOWEM: Record<DecyzjaOTowarze, string> = {
  wymagany: "do odesłania", niewymagany: "zostaje u klienta",
};

const uznanie = (kod: string | null) => (kod ?? "").startsWith("ACCEPTED");

/* Barwy gałęzi: tło, pismo i przycisk. Tokeny rangi, nie hexy z makiety. */
const TON = {
  ok: { tlo: "bg-emerald-50", pismo: "text-ranga-ok", przycisk: "bg-ranga-ok text-white", radio: "accent-ranga-ok" },
  zle: { tlo: "bg-red-50", pismo: "text-ranga-zle", przycisk: "bg-ranga-zle text-white", radio: "accent-ranga-zle" },
} as const;

/** Rama karty — ta sama we wszystkich stanach, bo ekran nie dokłada własnej. */
function Karta({ etykieta, obrys = "", children }: {
  etykieta: string; obrys?: string; children: React.ReactNode;
}) {
  const id = useId();
  return <section aria-labelledby={id} className={`card flex flex-col gap-2.5 px-5 py-4 ${obrys}`}>
    <h2 id={id} className="text-naglowek font-bold">{etykieta}</h2>
    {children}
  </section>;
}

/** Kto i kiedy wysłał — bez rodzaju gramatycznego, bo panel nie zna płci osoby. */
function ktoKiedy(r: Reklamacja): string {
  return [r.werdyktAt && `wysłano ${czas(r.werdyktAt)}`, r.werdyktPrzez].filter(Boolean).join(" · ");
}

/** Nazwa wysłanego werdyktu z kwotą i towarem — jedno zdanie, jak w podsumowaniu formularza. */
function nazwaWyslanego(r: Reklamacja): string {
  const nazwa = r.werdyktNazwa ?? KROTKO[r.werdykt as KodWerdyktu] ?? String(r.werdykt);
  const kwota = r.werdyktKwotaGrosze !== null ? ` ${zlote(r.werdyktKwotaGrosze, r.waluta)}` : "";
  const towar = r.zwrotTowaru ? `, towar ${TOWAR_SLOWEM[r.zwrotTowaru]}` : "";
  return `${nazwa}${kwota}${towar}`;
}

export function Werdykt({
  reklamacja: r, czat = [], trwa, blad, bladTowaru = "", onWerdykt, onSprawdz, sprawdza = false,
}: {
  reklamacja: Reklamacja;
  /** Rozmowa sprawy — tylko po to, żeby nie powtarzać wiadomości werdyktu,
      którą Allegro oddało w rozmowie. Bez niej karta pokazuje ją jak dotąd. */
  czat?: WiadomoscReklamacji[];
  trwa: boolean;
  /** Zdanie z serwera pod formularzem: konflikt, sufit kwoty, odmowa Allegro. */
  blad: string;
  /* Krok „towar do odesłania?” po werdykcie zszedł z ekranu decyzją
     właściciela. Zostaje samo zdanie błędu, bo stanowisko, które nie wyszło,
     agent pisze w czacie. */
  bladTowaru?: string;
  onWerdykt: (z: ZadanieWerdyktu) => void;
  /** „Sprawdź w Allegro teraz” przy niepewnym losie; bez obsługi przycisku nie ma. */
  onSprawdz?: () => void;
  sprawdza?: boolean;
}) {
  const [galaz, setGalaz] = useState<"uznaje" | "odrzucam" | null>(null);
  const [kod, setKod] = useState<KodWerdyktu | null>(null);
  const [kwota, setKwota] = useState("");
  const [wiadomosc, setWiadomosc] = useState("");
  const [zgoda, setZgoda] = useState(false);
  const [towar, setTowar] = useState<DecyzjaOTowarze | null>(null);
  const [trescTowaru, setTrescTowaru] = useState("");
  const grupa = useId();
  const formularz = useRef<HTMLFormElement | null>(null);
  /* Po zwinięciu fokus wraca na przycisk, z którego agent przyszedł. Inaczej
     ląduje na `body` i klawiatura zaczyna stronę od początku. */
  const powrot = useRef<"uznaje" | "odrzucam" | null>(null);
  const przyciski = useRef<Record<string, HTMLButtonElement | null>>({});

  /* Formularz czyści się przy ZMIANIE SPRAWY — inaczej werdykt pisany do
     jednej reklamacji wyjechałby do drugiej po strzałce w kolejce. */
  useEffect(() => {
    setGalaz(null); setKod(null); setZgoda(false); setKwota(""); setWiadomosc("");
    setTowar(null); setTrescTowaru("");
  }, [r.id]);

  /* Fokus idzie za kliknięciem: po rozwinięciu na wybraną wartość albo na
     pierwszą pozycję gałęzi, po zwinięciu z powrotem na przycisk. */
  useEffect(() => {
    if (galaz !== null) {
      const pola = formularz.current?.querySelectorAll<HTMLInputElement>(`input[name="${grupa}"]`);
      const lista = pola ? [...pola] : [];
      const cel = lista.find((p) => p.checked)
        ?? lista.find((p) => uznanie(p.value) === (galaz === "uznaje"));
      cel?.focus();
    } else if (powrot.current) {
      przyciski.current[powrot.current]?.focus();
      powrot.current = null;
    }
  }, [galaz, grupa]);

  const status = r.werdyktStatus;
  const wydany = status === "sent" || status === "send_uncertain" || status === "sending";
  const uAllegro = rozstrzygniecie(r.statusAllegro);
  /* Równość po ściśnięciu łapie krótkie zdania, zawarcie — nasze zdanie
     wklejone przez Allegro w dłuższą wiadomość (próg dubla z `tresc.tsx`). */
  const wiadomoscWerdyktu = r.werdyktWiadomosc ?? "";
  const wRozmowie = wiadomoscWerdyktu !== "" && czat.some((w) => w.autorRola === "SELLER"
    && (scisle(w.tresc) === scisle(wiadomoscWerdyktu) || zawieraOpis(w.tresc, wiadomoscWerdyktu)));

  const otworz = (g: "uznaje" | "odrzucam",
    start?: { kod: KodWerdyktu | null; wiadomosc: string; kwota: number | null }) => {
    powrot.current = g;
    setGalaz(g);
    setKod(start ? start.kod : g === "uznaje" ? UZNANIE_ZYCZENIA[r.oczekiwanie ?? ""] ?? null : null);
    setWiadomosc(start?.wiadomosc ?? "");
    setKwota(start?.kwota != null ? (start.kwota / 100).toFixed(2).replace(".", ",") : "");
    setZgoda(false);
    setTowar(null); setTrescTowaru("");
  };

  /* ── Po werdykcie: nasz w drodze, wysłany, niepewny albo z Centrum ─────── */
  if (wydany || (uAllegro && status !== "send_failed")) {
    if (!r.werdykt) {
      /* Rozstrzygnięcie poza panelem: bez „kto i kiedy”, bo panel tego nie wie. */
      const slowo = znanyStatus(r.statusAllegro) ? STATUS_ALLEGRO[r.statusAllegro].slowo : "Rozstrzygnięta poza panelem";
      return <Karta etykieta="Decyzja">
        <p className={`font-semibold ${uAllegro === "odrzucona" ? "text-ranga-zle" : "text-ranga-ok"}`}>{slowo}</p>
      </Karta>;
    }
    const ton = TON[uznanie(r.werdykt) ? "ok" : "zle"];
    const niepewny = status === "send_uncertain";
    const naglowek = niepewny
      ? <p className="flex items-center gap-2 font-bold text-ranga-uwaga">
          <AlertTriangle size={20} aria-hidden="true" className="flex-none" />Nie wiemy, czy Allegro przyjęło werdykt</p>
      : status === "sending"
        ? <p className="flex items-center gap-2 font-bold text-slate-700">
            <Clock size={20} aria-hidden="true" className="flex-none" />Werdykt jest w drodze do Allegro</p>
        : <p className={`flex items-center gap-2 font-bold ${ton.pismo}`}>
            <Check size={20} aria-hidden="true" className="flex-none" />
            {uAllegro ? "Allegro przyjęło werdykt" : "Werdykt wysłany do Allegro"}</p>;
    return <Karta etykieta="Decyzja">
      {naglowek}
      <div className={`rounded-lg px-3 py-2.5 text-sm ${niepewny ? "bg-orange-50 text-ranga-uwaga" : `${ton.tlo} ${ton.pismo}`}`}>
        <b>{nazwaWyslanego(r)}</b>
        {ktoKiedy(r) && <><br />{ktoKiedy(r)}</>}
      </div>
      {niepewny
        ? <p className="text-sm text-slate-600">
            Połączenie zerwało się po wysłaniu. Nie wysyłaj werdyktu drugi raz. Sprawdzimy stan w Allegro.</p>
        : status === "sent" && !uAllegro && <p className="text-sm text-slate-600">
            Czekamy, aż Allegro potwierdzi. Nie wysyłaj werdyktu drugi raz.</p>}
      {niepewny && onSprawdz && <button type="button" onClick={onSprawdz} disabled={sprawdza}
        className="h-11 rounded-lg border border-wertis-ink bg-white font-bold disabled:opacity-60">
        {sprawdza ? "Sprawdzam…" : "Sprawdź w Allegro teraz"}</button>}
      {/* ── WIADOMOŚĆ WERDYKTU RAZ I KRÓTKO ────────────────────────────────
          Zwija się do czterech linii, bo długa zjadałaby kolumnę. Gdy Allegro
          oddało ją w rozmowie jako naszą wiadomość, tu już jej nie ma. */}
      {r.werdyktWiadomosc && !wRozmowie && <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <DlugaTresc key={r.id} tekst={r.werdyktWiadomosc} className="text-sm text-slate-800" etykieta="Pokaż całą" />
        </div>
        <Skopiuj tekst={r.werdyktWiadomosc} tytul="Kopiuj wiadomość werdyktu" />
      </div>}
      {bladTowaru && <p className="text-sm font-semibold text-ranga-zle">
        {bladTowaru}. Napisz klientowi w czacie, co z towarem.</p>}
    </Karta>;
  }

  const nieudany = status === "send_failed";

  /* ── Zwinięta: dwa przyciski, po terminie albo po nieudanej próbie ──────── */
  if (galaz === null) {
    const duzy = (g: "uznaje" | "odrzucam", napis: string, start?: Parameters<typeof otworz>[1]) =>
      <button type="button" disabled={trwa} onClick={() => otworz(g, start)}
        ref={(el) => { przyciski.current[g] = el; }}
        className={`flex h-12 items-center justify-center gap-2 rounded-lg font-bold disabled:opacity-60 ${
          TON[g === "uznaje" ? "ok" : "zle"].przycisk}`}>
        {g === "uznaje" ? <Check size={18} strokeWidth={2.4} aria-hidden="true" />
          : <X size={18} strokeWidth={2.4} aria-hidden="true" />}
        {napis}</button>;

    if (nieudany) {
      const g = uznanie(r.werdykt) ? "uznaje" : "odrzucam";
      return <Karta etykieta="Decyzja">
        <p className="font-bold text-ranga-zle">Werdykt nie przeszedł</p>
        <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-ranga-zle">
          <b>{nazwaWyslanego(r)}</b><br />{r.werdyktBlad ?? "Allegro odmówiło"}</div>
        <p className="text-sm text-slate-600">Werdyktu nie ma w Allegro, więc termin dalej biegnie.</p>
        <button type="button" disabled={trwa} ref={(el) => { przyciski.current[g] = el; }}
          onClick={() => otworz(g, {
            kod: r.werdykt as KodWerdyktu, wiadomosc: r.werdyktWiadomosc ?? "", kwota: r.werdyktKwotaGrosze,
          })}
          className="h-11 rounded-lg border border-wertis-ink bg-white font-bold disabled:opacity-60">
          Spróbuj jeszcze raz</button>
      </Karta>;
    }

    if (r.poTerminie) {
      /* Czternaście dni milczenia uznaje reklamację z mocy prawa tylko przy
         rękojmi. Przy gwarancji i przy nieznanym tytule tego nie obiecujemy,
         więc zostają oba przyciski. */
      const rekojmia = r.prawo === "COMPLAINT";
      const zyczenie = UZNANIE_ZYCZENIA[r.oczekiwanie ?? ""];
      return <Karta etykieta="Decyzja" obrys="border-2 border-ranga-zle">
        <p className="flex items-center gap-2 font-bold text-ranga-zle">
          <Clock size={20} aria-hidden="true" className="flex-none" />
          {r.decyzjaDo ? `Termin minął ${dzien(r.decyzjaDo)}` : "Termin decyzji minął"}</p>
        {rekojmia
          ? <>
              <p className="text-sm text-slate-600">
                Bez odpowiedzi w 14 dni reklamację uważa się za uznaną. Zostaje już tylko ją rozliczyć.</p>
              {duzy("uznaje", zyczenie ? `Uznaj — ${KROTKO[zyczenie].toLowerCase()}` : "Uznaj reklamację…")}
            </>
          : <>{duzy("uznaje", "Uznaj reklamację…")}{duzy("odrzucam", "Odrzuć reklamację…")}</>}
      </Karta>;
    }

    return <Karta etykieta="Decyzja">
      {duzy("uznaje", "Uznaj reklamację…")}
      {duzy("odrzucam", "Odrzuć reklamację…")}
    </Karta>;
  }

  /* ── Rozwinięta: formularz z makiety „Werdykt” ──────────────────────────── */
  const zatwierdz = uznanie(kod);
  const ton = kod === null ? null : TON[zatwierdz ? "ok" : "zle"];
  const czesciowy = kod === "ACCEPTED_PARTIAL_REFUND";
  const grosze = naGrosze(kwota);
  const znakow = wiadomosc.length;
  const zaDlugo = znakow > LIMIT_ZNAKOW;
  /* O towarze pytamy tylko przy uznaniu i tylko wtedy, gdy jego los jeszcze
     nie zapadł — ani u nas, ani w Centrum Sprzedaży. Drugie stanowisko po
     pierwszym byłoby sprzecznością. Przy rozmowie zamkniętej przez Allegro
     stanowisko nie wyjdzie, więc zamiast wyboru stoi zdanie. */
  const towarDoUstalenia = zatwierdz && r.zwrotTowaru === null && r.zwrotWymagany === null;
  const pytajOTowar = towarDoUstalenia && r.czatAktywny !== false;
  const towarGotowy = !pytajOTowar
    || (towar !== null && Boolean(trescTowaru.trim()) && trescTowaru.trim().length <= LIMIT_ZNAKOW);
  const gotowe = kod !== null && Boolean(wiadomosc.trim()) && !zaDlugo && zgoda && towarGotowy
    && (!czesciowy || (grosze !== null && grosze > 0));
  const zaplacil = r.kwotaZrodlo === "paragon" && r.kwotaGrosze != null ? r.kwotaGrosze
    : r.cenaParagonuGrosze != null && r.ilosc != null ? r.cenaParagonuGrosze * r.ilosc : null;

  /* Podsumowanie bierze nazwę i kwotę ZE STANU FORMULARZA, więc zmiana listy
     przepisuje je natychmiast. Kwota wchodzi, dopiero gdy jest prawidłowa. */
  const podsumowanie = kod === null ? null
    : `${zatwierdz ? "Uznana" : "Odrzucona"} — ${KROTKO[kod].toLowerCase()}`
      + (czesciowy && grosze !== null && grosze > 0 ? ` ${zlote(grosze, r.waluta)}` : "")
      + (pytajOTowar && towar !== null ? `, towar ${TOWAR_SLOWEM[towar]}` : "");

  const wybierz = (k: KodWerdyktu) => { if (k !== kod) { setKod(k); setZgoda(false); } };
  /* Klik w wybór, który już jest wciśnięty, niczego nie zmienia — inaczej
     upewnienie się kasowałoby poprawioną wiadomość i zgodę. */
  const wybierzTowar = (d: DecyzjaOTowarze) => {
    if (d === towar) return;
    setTowar(d); setTrescTowaru(ZDANIE_O_TOWARZE[d]); setZgoda(false);
  };
  const zwin = () => setGalaz(null);

  const pozycja = ([k, napis]: [KodWerdyktu, string], t: (typeof TON)["ok" | "zle"]) =>
    <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 ${
      kod === k ? `${t.tlo} font-semibold` : "bg-white"}`}>
      <input type="radio" name={grupa} value={k} checked={kod === k} onChange={() => wybierz(k)}
        className={`h-5 w-5 flex-none ${t.radio}`} />
      <span>{napis}</span>
    </label>;

  const podpis = [r.kupujacyLogin, r.ofertaNazwa, CHCE[r.oczekiwanie ?? ""]].filter(Boolean).join(" · ");

  return <form ref={formularz} aria-label="Werdykt" onSubmit={(e) => e.preventDefault()}
    className="card flex flex-col gap-3.5 px-5 py-4">
    <div className="flex items-center justify-between">
      <h2 className="text-naglowek font-bold">Werdykt</h2>
      <button type="button" onClick={zwin} aria-label="Anuluj" title="Zwiń bez wysyłania"
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white">
        <X size={16} strokeWidth={2.2} aria-hidden="true" /></button>
    </div>
    {podpis && <span className="text-sm text-slate-600">{podpis}</span>}

    <fieldset className="flex flex-col gap-0.5">
      <legend className="pb-1.5 text-xs font-bold uppercase tracking-wide text-ranga-ok">Uznaję</legend>
      {UZNAJE.map((p) => pozycja(p, TON.ok))}
    </fieldset>

    {czesciowy && <label className="flex flex-col gap-1 pl-8 text-sm text-slate-600">
      Kwota zwrotu
      <span className="flex h-11 items-center rounded-lg border border-slate-300 bg-white px-3">
        {/* Podpowiedź, nie wartość domyślna: kwotę wpisuje agent (decyzja
            właściciela), a serwer pilnuje sufitu i mówi, skąd go wziął. */}
        <input inputMode="decimal" aria-label="Kwota zwrotu" value={kwota} placeholder="np. 40,00"
          onChange={(e) => { setKwota(e.target.value); setZgoda(false); }}
          className="min-w-0 flex-1 border-0 bg-transparent tabular-nums text-wertis-ink outline-none" />
        <span>{r.waluta === "PLN" ? "zł" : r.waluta}</span>
      </span>
      {zaplacil !== null && <span className="text-xs">Klient zapłacił {zlote(zaplacil, r.waluta)}.</span>}
      {r.oczekiwanie === "PARTIAL_REFUND" && r.oczekiwanaKwotaGrosze !== null &&
        <span className="text-xs">Klient prosi o {zlote(r.oczekiwanaKwotaGrosze, r.waluta)}.</span>}
    </label>}

    <fieldset className="flex flex-col gap-0.5">
      <legend className="pb-1.5 text-xs font-bold uppercase tracking-wide text-ranga-zle">Odrzucam, bo</legend>
      {ODRZUCAM.map((p) => pozycja(p, TON.zle))}
    </fieldset>

    {towarDoUstalenia && !pytajOTowar && <p className="border-t border-slate-200 pt-2.5 text-sm text-slate-600">
      <b>Towar:</b> Allegro zamknęło rozmowę, więc osobnej wiadomości o towarze nie wyślemy.
      Napisz kupującemu w wiadomości werdyktu, czy odsyła towar.</p>}
    {pytajOTowar && <fieldset className="flex flex-col gap-0.5 border-t border-slate-200 pt-2.5">
      <legend className="sr-only">Towar</legend>
      {([
        ["wymagany", "Towar do odesłania", "Allegro poprosi klienta o zwrot towaru"],
        ["niewymagany", "Towar zostaje u klienta", "Klient niczego nie odsyła"],
      ] as const).map(([d, napis, opis]) =>
        <label key={d} className="flex min-h-11 cursor-pointer items-center gap-2.5">
          <input type="radio" name={`${grupa}-towar`} checked={towar === d} onChange={() => wybierzTowar(d)}
            className="h-5 w-5 flex-none accent-wertis-ink" />
          <span className="flex flex-col leading-snug">
            <span className="font-semibold">{napis}</span>
            <span className="text-xs text-slate-600">{opis}</span>
          </span>
        </label>)}
      {towar !== null && <label className="mt-1 flex flex-col gap-1 text-sm text-slate-600">
        Wiadomość o towarze — {TOWAR_SLOWEM[towar]}
        <textarea className="field min-h-16 text-sm" value={trescTowaru}
          onChange={(e) => setTrescTowaru(e.target.value)} />
      </label>}
    </fieldset>}

    <label className="flex flex-col gap-1 text-sm text-slate-600">
      Wiadomość do klienta (wymagana)
      <textarea rows={4} className="field resize-y text-tresc text-wertis-ink" value={wiadomosc}
        onChange={(e) => setWiadomosc(e.target.value)} />
      {/* Licznik tylko przy limicie — „0 znaków” pod każdym werdyktem niczego nie rozstrzygał. */}
      {znakow > LIMIT_ZNAKOW - PROG_LICZNIKA && <span className={`text-xs font-semibold tabular-nums ${
        zaDlugo ? "text-ranga-zle" : "text-ranga-uwaga"}`}>
        {znakow} / {LIMIT_ZNAKOW}{zaDlugo ? ` — o ${znakow - LIMIT_ZNAKOW} za dużo` : ""}</span>}
    </label>

    {/* ── ZGODA TO KLIKNIĘCIE W PODSUMOWANIE ──────────────────────────────
        Pole stoi w ramce „Allegro dostanie”, a całe zdanie jest jego
        etykietą. Agent potwierdza to, co czyta, a nie ogólne „na pewno?”. */}
    <label className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 ${
      ton ? `${ton.tlo} ${ton.pismo} cursor-pointer` : "bg-slate-100 text-slate-700"}`}>
      <input type="checkbox" checked={zgoda} disabled={kod === null}
        onChange={(e) => setZgoda(e.target.checked)} className="mt-0.5 h-5 w-5 flex-none" />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-bold uppercase tracking-wide">Allegro dostanie</span>
        <b>{podsumowanie ?? "Wybierz werdykt z listy"}</b>
        {kod !== null && <span className="text-xs">
          Potwierdzam, razem z {pytajOTowar && towar !== null ? "obiema wiadomościami" : "wiadomością"} do klienta.</span>}
      </span>
    </label>

    <button type="button" disabled={trwa || !gotowe}
      onClick={() => kod !== null && onWerdykt({
        werdykt: kod, wiadomosc: wiadomosc.trim(), kwotaGrosze: czesciowy ? grosze : null,
        ...(pytajOTowar && towar !== null ? { towar: { decyzja: towar, tresc: trescTowaru.trim() } } : {}),
      })}
      className={`h-12 rounded-lg font-bold disabled:opacity-60 ${ton ? ton.przycisk : "bg-slate-200 text-slate-700"}`}>
      {trwa ? "Wysyłam…" : kod === null ? "Wyślij do Allegro"
        : zatwierdz ? "Uznaj i wyślij do Allegro" : "Odrzuć i wyślij do Allegro"}</button>
    <span className="text-center text-xs text-slate-600">Werdyktu nie da się cofnąć w Allegro.</span>
    {blad && <p className="text-sm font-semibold text-ranga-zle">{blad}</p>}
  </form>;
}
