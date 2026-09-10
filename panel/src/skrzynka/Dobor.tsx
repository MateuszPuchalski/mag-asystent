import React, { useState } from "react";
import { AlertTriangle, Check, FileText, Pencil, Ruler, Search, Sparkles, X as Krzyzyk } from "lucide-react";
import type {
  DaneDoboru, Dobor as DoborTyp, DrogaDoboru, KandydatDoboru, NegatywDoboru,
  StatusDoboru, SzczebelDoboru, SzkicCopilota,
} from "../api/typy";
import { Konflikt } from "../api/klient";
import {
  useKandydaci, useStatusDoboru, useWiedzaDoboru, useWybierzKandydata, useZapiszDaneDoboru,
} from "../api/rozmowy";
import { useOcenDaneDoboru, useOcenPasowanie } from "../api/copilot";
import { propozycjaDoboru } from "./propozycjaDoboru";
import { Przycisk } from "../ui";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { Kafel } from "../towar/Kafel";
import { PasowanieForm } from "../wiedza/PasowanieForm";
import { useZaproponujPasowanie, useZaproponujZabudowe } from "../api/wiedza";
import { DO_WYBORU_DOBORU, NAZWA_DOBORU, NAZWA_ROLI } from "./statusy";

/**
 * Dobór części przy rozmowie (§11, etap E1) — trzecia zakładka kolumny
 * kontekstu, wg makiety `docs/projekt-widokow/Dobor.dc.html`.
 *
 * Komponent woła hooki SAM — precedens `TowarRozmowy.tsx` — więc `Rozmowa.tsx`
 * z jego czterdziestoma sześcioma propsami zostaje nietknięty.
 *
 * Trzy rzeczy, których ekran NIE robi, bo zabrania tego projekt:
 * - nie układa zdania do szkicu (§14.3: pisze je serwer, ze źródłem),
 * - nie zgaduje maszyny z treści pytania (dane wpisuje agent; w E1 nie ma
 *   Copilota, więc nie ma też „propozycji Copilota" z makiety),
 * - nie zatwierdza sam: `confirmed` klika człowiek, a serwer odmawia bez wyboru.
 *
 * DWA zatwierdzenia z makiety to jedno. Stopka makiety zatwierdzała
 * ZASTOSOWANIE — „tylko ekspert". Decyzją właściciela roli eksperta nie ma,
 * a zastosowanie idzie w E2 do kolejki propozycji; tu zatwierdza się DOBÓR.
 */

const POLA: Array<{ klucz: keyof Omit<DaneDoboru, "parametry">; nazwa: string; przyklad: string }> = [
  { klucz: "marka", nazwa: "Marka", przyklad: "NAC" },
  { klucz: "model", nazwa: "Model", przyklad: "LS 46-450" },
  { klucz: "wariant", nazwa: "Wariant", przyklad: "HS" },
  { klucz: "rocznik", nazwa: "Rocznik", przyklad: "2019" },
  { klucz: "nrSeryjny", nazwa: "Nr seryjny", przyklad: "pełny, z tabliczki" },
  { klucz: "silnik", nazwa: "Silnik", przyklad: "B&S 450E" },
  { klucz: "oem", nazwa: "Numer OEM / symbol", przyklad: "532 19 93-77" },
  { klucz: "nazwaCzesci", nazwa: "Część", przyklad: "szarpak rozrusznika" },
];

const NAZWA_DROGI: Record<DrogaDoboru, string> = {
  symbol: "symbol", ean: "EAN", oem: "OEM", zastosowanie: "zastosowanie", silnik: "przez silnik",
  pasowanie: "pasuje do części", zamiennik: "zamiennik", oferta: "oferta", pelnotekst: "pełny tekst",
  wyszukiwarka: "wyszukiwarka", wymiar: "zgodne wymiary",
};

const PEWNOSC: Record<KandydatDoboru["pewnosc"], { etykieta: string; klasa: string }> = {
  potwierdzone: { etykieta: "potwierdzone", klasa: "bg-emerald-100 text-emerald-800" },
  prawdopodobne: { etykieta: "prawdopodobne", klasa: "bg-amber-100 text-amber-800" },
  wymaga_danych: { etykieta: "wymaga danych", klasa: "bg-slate-100 text-slate-600" },
};

const KLASA_STATUSU: Partial<Record<StatusDoboru, string>> = {
  confirmed: "bg-emerald-100 text-emerald-800",
  missing_information: "bg-red-100 text-ranga-zle",
  candidates_found: "bg-amber-100 text-amber-800",
  requires_expert: "bg-violet-100 text-violet-800",
  rejected: "bg-slate-200 text-slate-700",
};

/** Parametry jako tekst „klucz: wartość" wiersz po wierszu — lista jest otwarta. */
const parametryNaTekst = (p: Record<string, string>) =>
  Object.entries(p).map(([k, v]) => `${k}: ${v}`).join("\n");
const tekstNaParametry = (t: string): Record<string, string> => {
  const wynik: Record<string, string> = {};
  for (const linia of t.split("\n")) {
    const i = linia.indexOf(":");
    if (i <= 0) continue;
    const k = linia.slice(0, i).trim(); const v = linia.slice(i + 1).trim();
    if (k && v) wynik[k] = v;
  }
  return wynik;
};

type Formularz = Record<keyof Omit<DaneDoboru, "parametry">, string> & { parametry: string };
const naFormularz = (d: DaneDoboru): Formularz => ({
  marka: d.marka ?? "", model: d.model ?? "", wariant: d.wariant ?? "", rocznik: d.rocznik ?? "",
  nrSeryjny: d.nrSeryjny ?? "", silnik: d.silnik ?? "", oem: d.oem ?? "", nazwaCzesci: d.nazwaCzesci ?? "",
  parametry: parametryNaTekst(d.parametry),
});

export function Dobor({ dobor, rozmowaId, propozycja = null, onWstawDoSzkicu, onZlecPomiar }: {
  dobor: DoborTyp;
  rozmowaId: number;
  /** Szkic Copilota z danymi rozpoznanymi w rozmowie (przyrost trzeci). */
  propozycja?: SzkicCopilota | null;
  onWstawDoSzkicu: (tresc: string) => void;
  onZlecPomiar: (towar: TowarZWyszukiwarki) => void;
}) {
  const kandydaci = useKandydaci(rozmowaId);
  const zapisz = useZapiszDaneDoboru();
  const ocenDane = useOcenDaneDoboru();
  const zRozmowy = propozycjaDoboru(propozycja, dobor.dane);
  /* Para z rozmowy (przyrost czwarty): karta stoi, dopóki agent nie kliknie;
     po „Zaproponuj" zdanie bierze się Z DANYCH (`pasowanieOcena`), więc
     przeżywa odświeżenie — w odróżnieniu od lokalnego `pasowanieOk` niżej. */
  const ocenPasowanie = useOcenPasowanie();
  const para = propozycja?.pasowanie ?? null;
  const paraOcena = propozycja?.pasowanieOcena ?? null;
  const status = useStatusDoboru();
  const wybierz = useWybierzKandydata();
  /* Ten sam odczyt, z którego zakładka WIEDZA bierze dowody — tu potrzebne są
     z niego SILNIKI maszyny. Drugie żądanie po to samo byłoby drugim strzałem. */
  const wiedza = useWiedzaDoboru(rozmowaId);
  const silniki = wiedza.data?.silniki ?? [];
  /* Słownik (0.238.0): tekst z pola „Silnik" rozpoznany aliasem biura. Jedno
     kliknięcie proponuje zabudowę z dowodem „rozmowa" (klient podał silnik);
     rozstrzyga człowiek w Wiedza → Silniki, a szczebel rusza po zatwierdzeniu. */
  const zPola = wiedza.data?.silnikZPola ?? null;
  const zaproponujZabudowe = useZaproponujZabudowe();
  const [bladZabudowy, setBladZabudowy] = useState("");
  const zaproponujZPola = () => {
    if (!zPola || !dobor.dane.marka || !dobor.dane.model) return;
    setBladZabudowy("");
    zaproponujZabudowe.mutate({
      maszyna: { rodzaj: "maszyna", marka: dobor.dane.marka, nazwa: dobor.dane.model, wariant: dobor.dane.wariant },
      silnik: { rodzaj: "silnik", marka: zPola.alias.silnik.marka, nazwa: zPola.alias.silnik.nazwa,
        wariant: zPola.alias.silnik.wariant },
      rodzajDowodu: "rozmowa", dowodTresc: `klient podał silnik „${dobor.dane.silnik}” w rozmowie`,
      conversationId: rozmowaId,
    }, { onError: (e) => setBladZabudowy((e as Error).message) });
  };
  /* „Pasuje do…": jedyne miejsce, gdzie pasowanie rodzi się Z PRACY. Kotwica
     to kartoteka, którą agent wskazał symbolem/numerem albo kartoteka oferty —
     inna niż wybrany kandydat. Kierunek narzucony (wybrany pasuje DO kotwicy),
     bo taki jest sens pytania klienta. Bez automatu przy ZATWIERDŹ DOBÓR: rola
     nieznana, a kotwica bywa samą częścią (klient pyta o dostępność gaźnika). */
  const zaproponujPasowanie = useZaproponujPasowanie();
  const [pasujeDo, setPasujeDo] = useState<number | null>(null);
  const [pasowanieOk, setPasowanieOk] = useState("");

  const [edycja, setEdycja] = useState(false);
  const [formularz, setFormularz] = useState<Formularz>(() => naFormularz(dobor.dane));
  const [konflikt, setKonflikt] = useState<string>("");
  const [brakuje, setBrakuje] = useState(dobor.brakuje ?? "");
  const [pytamOBrak, setPytamOBrak] = useState(false);
  const [szukam, setSzukam] = useState(false);
  /* `null` = zapisz wiedzę przy MASZYNIE (zachowanie sprzed zmiany). Liczba to
     model silnika z zatwierdzonej zabudowy — nigdy tekst z pola „Silnik". */
  const [doSilnika, setDoSilnika] = useState<number | null>(null);

  const blad = [zapisz.error, status.error, wybierz.error, ocenDane.error, ocenPasowanie.error]
    .find((e) => e && !(e instanceof Konflikt)) as Error | undefined;

  /* Konflikt przy propozycji to ten sam wyścig, co przy formularzu: ktoś zapisał
     dane, zanim doszło kliknięcie. Zdanie to samo, bo sytuacja ta sama. */
  const ocenDaneZRozmowy = (ocena: "wpisane" | "odrzucone") =>
    ocenDane.mutate({ rozmowaId, ocena, expectedVersion: dobor.wersja }, {
      onSuccess: () => setKonflikt(""),
      onError: (e) => {
        if (e instanceof Konflikt) {
          setKonflikt(`Ktoś zmienił dane doboru (${String(e.szczegoly.updatedBy ?? "inny agent")}) — odśwież i kliknij ponownie`);
        }
      },
    });

  const zapiszDane = () => {
    const dane: Partial<DaneDoboru> = { parametry: tekstNaParametry(formularz.parametry) };
    for (const p of POLA) dane[p.klucz] = formularz[p.klucz].trim() || null;
    zapisz.mutate({ id: rozmowaId, dane, expectedVersion: dobor.wersja }, {
      onSuccess: () => { setEdycja(false); setKonflikt(""); },
      /* 409 NIE kasuje wpisanego: agent widzi, kto zmienił dane, i sam decyduje,
         czy wczytać cudze, czy nadpisać po odświeżeniu. */
      onError: (e) => {
        if (e instanceof Konflikt) {
          setKonflikt(`Ktoś zmienił dane doboru (${String(e.szczegoly.updatedBy ?? "inny agent")}) — odśwież i wpisz ponownie`);
        }
      },
    });
  };

  const ustawStatus = (s: StatusDoboru, notatka: string | null = null, silnikModelId: number | null = null) =>
    status.mutate({ id: rozmowaId, status: s, brakuje: notatka, silnikModelId },
      { onSuccess: () => setPytamOBrak(false) });

  const wybierzTowar = (twId: number | null, droga: DrogaDoboru) =>
    wybierz.mutate({ id: rozmowaId, twId, droga, expectedVersion: dobor.wersja },
      { onSuccess: () => setSzukam(false) });

  const wypelnione = POLA.filter((p) => dobor.dane[p.klucz]);

  return <div className="flex min-h-0 flex-col text-sm">
    {/* ── Status ─────────────────────────────────────────────────────────── */}
    <div className="flex flex-wrap items-center gap-2 border-b p-3">
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        KLASA_STATUSU[dobor.status] ?? "bg-slate-100 text-slate-600"}`}>{NAZWA_DOBORU[dobor.status]}</span>
      {dobor.updatedBy && <span className="text-xs text-slate-500">· {dobor.updatedBy}</span>}
      <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
        Status
        <select className="field w-auto py-1 text-xs" aria-label="Status doboru" value={dobor.status}
          disabled={status.isPending}
          onChange={(e) => {
            const s = e.target.value as StatusDoboru;
            if (s === "missing_information") { setPytamOBrak(true); return; }
            ustawStatus(s);
          }}>
          {/* Stan bieżący bywa spoza listy ręcznej (`extracting_data` z F):
              pole musi mieć opcję dla wartości, którą pokazuje. */}
          {!DO_WYBORU_DOBORU.includes(dobor.status) &&
            <option value={dobor.status}>{NAZWA_DOBORU[dobor.status]}</option>}
          {DO_WYBORU_DOBORU.map((s) => <option key={s} value={s}>{NAZWA_DOBORU[s]}</option>)}
        </select>
      </label>
      {(pytamOBrak || dobor.status === "missing_information") &&
        <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-900">
          <AlertTriangle size={14} className="shrink-0" />
          <input className="field min-w-0 flex-1 py-1 text-xs" aria-label="Czego brakuje" value={brakuje}
            placeholder="Czego dopytać klienta, np. pełny numer seryjny"
            onChange={(e) => setBrakuje(e.target.value)} />
          <Przycisk className="text-xs" disabled={status.isPending}
            onClick={() => ustawStatus("missing_information", brakuje.trim() || null)}>Zapisz</Przycisk>
          {/* Pytanie doprecyzowujące idzie do szkicu na kliknięcie, nigdy samo. */}
          {dobor.brakuje && <button type="button" className="underline underline-offset-2"
            onClick={() => onWstawDoSzkicu(`Proszę o ${dobor.brakuje} — wtedy dobiorę właściwą część.`)}>
            wstaw pytanie do szkicu</button>}
        </div>}
    </div>

    {/* ── Dane wejściowe (§11.1) ─────────────────────────────────────────── */}
    <section className="border-b p-3" aria-label="Dane wejściowe">
      <div className="mb-2 flex items-center gap-2">
        <b className="text-xs uppercase tracking-wide text-slate-500">Dane wejściowe</b>
        <span className="text-[11px] text-slate-500">wersja {dobor.wersja}</span>
        {!edycja && <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
          onClick={() => { setFormularz(naFormularz(dobor.dane)); setKonflikt(""); setEdycja(true); }}>
          <Pencil size={12} />{wypelnione.length ? "Popraw" : "Wpisz dane"}</button>}
      </div>

      {/* DANE Z ROZMOWY (etap F, przyrost trzeci). Pytanie właściciela z 8.09.2026:
          „dlaczego dane wejściowe nie zostały wprowadzone automatycznie ze
          szkicu?". Odpowiedź stoi tu: Copilot je ROZPOZNAŁ, serwer sprawdził
          przeciw rozmowie, a wpisuje agent — jednym kliknięciem, w PUSTE pola.
          To, co agent wpisał sam, zostaje; różnicę karta tylko nazywa. Bez
          nowych pól karty nie ma, bo nie miałaby czego wpisać. */}
      {!edycja && zRozmowy.nowe.length > 0 && <section aria-label="Dane z rozmowy"
        className="mb-2 rounded-lg border border-violet-200 bg-violet-50 p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
          <b className="text-violet-900"><Sparkles size={12} className="inline" /> Copilot rozpoznał w rozmowie</b>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Przycisk wariant="glowny" className="text-xs" disabled={ocenDane.isPending}
              onClick={() => ocenDaneZRozmowy("wpisane")}>Wpisz do danych</Przycisk>
            <Przycisk className="text-xs" disabled={ocenDane.isPending}
              onClick={() => ocenDaneZRozmowy("odrzucone")}>Odrzuć</Przycisk>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {zRozmowy.nowe.map((p) => <span key={p.klucz} className="rounded border border-violet-200 bg-white px-2 py-0.5 text-xs">
            <span className="text-slate-500">{p.nazwa}: </span><b>{p.wartosc}</b></span>)}
        </div>
        {zRozmowy.inaczej.length > 0 && <p className="mt-1 text-[11px] text-slate-600">
          Inaczej niż wpisano (zostaje Twoje): {zRozmowy.inaczej.map((p) => `${p.nazwa} „${p.wartosc}"`).join(", ")}.</p>}
        <p className="mt-1 text-[11px] text-slate-500">Wartości dosłownie z rozmowy klienta — sprawdzone przez serwer, wpisane dopiero po kliknięciu.</p>
        {konflikt && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-ranga-zle">
          <AlertTriangle size={13} />{konflikt}</p>}
      </section>}

      {/* PASOWANIE Z ROZMOWY (etap F, przyrost czwarty). Model nazwał parę
          SYMBOLAMI z faktów, serwer sprawdził oba końce po kartotekach, które
          sam położył na stole — tu agent tylko klika. „Zaproponuj" kładzie parę
          w kolejce wiedzy ze źródłem copilot i JEGO podpisem; rozstrzyga biuro.
          Zła rola albo pozycja → „Odrzuć" i formularz „Pasuje do…" obok,
          bo poprawianie propozycji modelu w miejscu byłoby drugim formularzem. */}
      {!edycja && para && paraOcena !== "odrzucone" && <section aria-label="Pasowanie z rozmowy"
        className="mb-2 rounded-lg border border-violet-200 bg-violet-50 p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
          <b className="text-violet-900"><Sparkles size={12} className="inline" /> Copilot rozpoznał pasowanie</b>
          {paraOcena === null && <span className="ml-auto flex flex-wrap items-center gap-2">
            <Przycisk wariant="glowny" className="text-xs" disabled={ocenPasowanie.isPending}
              onClick={() => ocenPasowanie.mutate({ rozmowaId, ocena: "zaproponowane" })}>Zaproponuj pasowanie</Przycisk>
            <Przycisk className="text-xs" disabled={ocenPasowanie.isPending}
              onClick={() => ocenPasowanie.mutate({ rozmowaId, ocena: "odrzucone" })}>Odrzuć</Przycisk>
          </span>}
        </div>
        <div className="flex items-center gap-2">
          <Kafel twId={para.czesc.twId} rozmiar={40} nazwa={para.czesc.nazwa} symbol={para.czesc.symbol} />
          <div className="min-w-0 flex-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <b className="font-mono">{para.czesc.symbol}</b>
              <span className="text-slate-500">→</span>
              <b className="font-mono">{para.doCzego.symbol}</b>
              <span className="rounded border border-violet-200 bg-white px-1.5 py-0.5 text-[11px]">
                {NAZWA_ROLI[para.rola]}{para.pozycja ? ` · ${para.pozycja}` : ""}</span>
            </div>
            <p className="truncate text-slate-600">{para.czesc.nazwa} → {para.doCzego.nazwa}</p>
          </div>
          <Kafel twId={para.doCzego.twId} rozmiar={40} nazwa={para.doCzego.nazwa} symbol={para.doCzego.symbol} />
        </div>
        {paraOcena === "zaproponowane"
          ? <p className="mt-1 text-[11px] text-emerald-800">
              Propozycja „{para.czesc.symbol} pasuje do {para.doCzego.symbol}” czeka w kolejce wiedzy — rozstrzyga biuro.</p>
          : <p className="mt-1 text-[11px] text-slate-500">
              Oba końce to kartoteki z tej rozmowy, sprawdzone przez serwer; do kolejki trafia po kliknięciu,
              rozstrzyga biuro. Zła rola albo pozycja: Odrzuć i użyj „Pasuje do…” przy wybranym kandydacie.</p>}
      </section>}

      {!edycja && (wypelnione.length === 0 && Object.keys(dobor.dane.parametry).length === 0
        ? <p className="text-xs text-slate-500">Nie wiadomo jeszcze, o jaką maszynę i część chodzi.
            Wpisz, co podał klient — bez tego automat nie ma czego szukać.</p>
        : <div className="flex flex-wrap gap-1.5">
            {wypelnione.map((p) => <span key={p.klucz} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
              <span className="text-slate-500">{p.nazwa}: </span><b>{dobor.dane[p.klucz]}</b></span>)}
            {Object.entries(dobor.dane.parametry).map(([k, v]) =>
              <span key={`p-${k}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                <span className="text-slate-500">{k}: </span><b>{v}</b></span>)}
          </div>)}

      {/* POLE „SILNIK" PRZESTAJE BYĆ SIEROTĄ. Do tego wydania agent je wypełniał,
          a żaden szczebel go nie czytał. Szczebel „przez silnik" idzie przez
          ZATWIERDZONĄ zabudowę, więc ekran musi powiedzieć, czy taka jest —
          inaczej wpisany tekst dalej wygląda na coś, co działa. */}
      {!edycja && dobor.dane.marka && dobor.dane.model && <p className="mt-1 text-[11px] text-slate-500">
        {silniki.length > 0
          ? <>Silnik z bazy: <b>{silniki.map((z) => z.silnik.etykieta).join(" · ")}</b>
            {silniki.length > 1 && " — ta maszyna bywa z kilkoma silnikami, potwierdź z tabliczki"}</>
          : zPola
            ? zPola.zabudowa
              /* Para już czeka: drugi klik dałby 409, więc zamiast przycisku jest zdanie. */
              ? <>„{dobor.dane.silnik}" to <b>{zPola.alias.silnik.etykieta}</b> (słownik) — para z tą maszyną
                czeka na rozstrzygnięcie w Wiedza → Silniki.</>
              : <>„{dobor.dane.silnik}" to <b>{zPola.alias.silnik.etykieta}</b> (słownik). Nikt nie potwierdził,
                że stoi w {[dobor.dane.marka, dobor.dane.model, dobor.dane.wariant].filter(Boolean).join(" ")}.{" "}
                <button type="button" className="font-semibold text-violet-800 underline underline-offset-2"
                  disabled={zaproponujZabudowe.isPending} onClick={zaproponujZPola}>Zaproponuj zabudowę</button>
                {bladZabudowy && <span className="ml-1 font-semibold text-ranga-zle">{bladZabudowy}</span>}</>
            : dobor.dane.silnik
              ? <>„{dobor.dane.silnik}" nie ma w słowniku silników — dopisz go w Wiedza → Silniki,
                wtedy dobór znajdzie części tego silnika.</>
              : null}
      </p>}

      {edycja && <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); zapiszDane(); }}>
        {POLA.map((p) => <label key={p.klucz} className="text-[11px] text-slate-500">{p.nazwa}
          <input className="field mt-0.5 py-1 text-xs" value={formularz[p.klucz]} placeholder={p.przyklad}
            aria-label={p.nazwa}
            onChange={(e) => setFormularz({ ...formularz, [p.klucz]: e.target.value })} /></label>)}
        <label className="col-span-2 text-[11px] text-slate-500">Parametry i wymiary (wiersz: nazwa: wartość)
          <textarea className="field mt-0.5 py-1 text-xs" rows={2} value={formularz.parametry}
            aria-label="Parametry" placeholder={"rozstaw: 82 mm\nśrednica: 148 mm"}
            onChange={(e) => setFormularz({ ...formularz, parametry: e.target.value })} /></label>
        {konflikt && <p className="col-span-2 flex items-center gap-1 text-xs font-semibold text-ranga-zle">
          <AlertTriangle size={13} />{konflikt}</p>}
        <div className="col-span-2 flex gap-2">
          <Przycisk wariant="glowny" type="submit" disabled={zapisz.isPending}>ZAPISZ</Przycisk>
          <Przycisk type="button" onClick={() => { setEdycja(false); setKonflikt(""); }}>Anuluj</Przycisk>
        </div>
      </form>}
    </section>

    {/* ── Kandydaci (§11.2) ──────────────────────────────────────────────── */}
    <section className="border-b p-3" aria-label="Kandydaci">
      <b className="text-xs uppercase tracking-wide text-slate-500">Kandydaci</b>
      {kandydaci.data && <Szczeble drogi={kandydaci.data.drogi} />}
      {kandydaci.isLoading && <p className="mt-2 text-xs text-slate-500">Szukam…</p>}
      {kandydaci.error && <p className="mt-2 text-xs text-red-700">{(kandydaci.error as Error).message}</p>}
      {kandydaci.data && kandydaci.data.kandydaci.length === 0 &&
        <p className="mt-2 text-xs text-slate-500">Żadna sprawdzona droga nic nie dała. Uzupełnij dane
          wejściowe albo wskaż kartotekę z wyszukiwarki.</p>}
      <ul className="mt-2 space-y-2">
        {kandydaci.data?.kandydaci.map((k) => {
          /* Kandydat bez kartoteki (E3): numer OEM, którego nie ma w żadnym
             opisie. Nie ma stanu i nie ma Wybierz — `twId: null` w wyborze
             znaczy „zdejmij", więc przycisk zrobiłby odwrotność obietnicy. */
          const bezKartoteki = k.twId === null;
          const wybrany = !bezKartoteki && dobor.wybrany?.twId === k.twId;
          return <li key={k.twId ?? `bez-kartoteki-${k.symbol}`} className={`rounded-lg border p-2 ${wybrany
            ? "border-wertis-amber bg-amber-50" : bezKartoteki ? "border-dashed border-slate-300" : "border-slate-200"}`}>
            {/* ── CO CZYTA SIĘ PIERWSZE (0.203.0) ─────────────────────────
                Wiersz kandydata zaczynał się od symbolu, a nazwa leżała pod
                nim, w tym samym rozmiarze co źródło i droga. Cztery linijki
                jednej wagi każą przeczytać wszystkie, żeby wybrać jedną.

                Dobór rozstrzyga pytanie „czy TO jest ta część", a odpowiada
                na nie kształt przedmiotu i jego nazwa. Zdjęcie idzie więc na
                lewo, nazwa dostaje pierwszy plan, symbol i pewność schodzą
                do podpisu, a droga ze źródłem — na trzeci plan. Symbol
                zostaje, bo to on jedzie na dokument i na halę.

                DOSTĘPNOŚĆ MA BARWĘ W OBIE STRONY. Do 0.202.0 tylko zero
                było czerwone, a dodatnie liczby były szare jak reszta —
                choć „mamy 28 sztuk" kończy rozmowę z klientem jednym
                zdaniem, a zero każe szukać dalej. */}
            {/* `items-start`: kafle mają stać w JEDNEJ pionowej linii, bo
                wzrok jedzie po nich w dół. Wyśrodkowane skakałyby wraz
                z długością nazwy — a nazwa raz się łamie, raz nie. */}
            <div className="flex items-start gap-2">
              <Kafel twId={k.twId} rozmiar={56} nazwa={k.nazwa} symbol={k.symbol} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-100 text-[10px] font-bold text-slate-600">{k.nr}</span>
                  <b className="min-w-0 flex-1 text-sm leading-snug text-slate-900">{k.nazwa}</b>
                  {k.stan === null
                    ? <span className="shrink-0 text-[11px] font-bold text-slate-500">brak w kartotece</span>
                    : <span className={`shrink-0 text-[11px] font-bold ${k.stan <= 0
                        ? "text-ranga-zle" : "text-emerald-700"}`}>dostępne {k.stan}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-slate-600">{k.symbol}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PEWNOSC[k.pewnosc].klasa}`}>
                    {PEWNOSC[k.pewnosc].etykieta}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  <span className="rounded bg-slate-100 px-1 py-0.5 font-semibold text-slate-600">droga: {NAZWA_DROGI[k.droga]}</span>
                  {" "}{k.zrodlo}</p>
              </div>
            </div>
            {k.ostrzezenia.map((o) => <p key={o} className="mt-1 flex items-center gap-1 rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              <AlertTriangle size={12} />{o}</p>)}
            {!wybrany && !bezKartoteki && <button type="button" disabled={wybierz.isPending}
              onClick={() => wybierzTowar(k.twId, k.droga)}
              className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              <Check size={12} />Wybierz</button>}
          </li>;
        })}
      </ul>
      {kandydaci.data && kandydaci.data.negatywne.length > 0 &&
        <Negatywne lista={kandydaci.data.negatywne} />}
      {/* Wyszukiwarka klikana ręcznie NIE jest kandydatem — to od razu wybór
          z drogą `wyszukiwarka`, podpisany agentem. */}
      {szukam
        ? <div className="mt-2"><Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
            onWybierz={(t) => t && wybierzTowar(t.id, "wyszukiwarka")} /></div>
        : <button type="button" onClick={() => setSzukam(true)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
            <Search size={12} />wskaż kartotekę z wyszukiwarki</button>}
    </section>

    {/* ── Wybrano ────────────────────────────────────────────────────────── */}
    <section className="p-3" aria-label="Wybrano">
      {dobor.wybrany
        ? <>
            {/* ── WNIOSEK MA WYGLĄDAĆ NA WNIOSEK (0.203.0) ─────────────────
                Sekcja stała gołym tekstem pod listą kandydatów, w tym samym
                rozmiarze co ich podpisy — a to jest jedyna rzecz na tej
                zakładce, która trafi do klienta. Rama z barwą stanu oddziela
                to, co WYBRANO, od tego, co dopiero można wybrać, i mówi bez
                czytania, czy dobór jest już zatwierdzony.

                Zdjęcie stoi tu drugi raz, choć widać je wyżej przy
                kandydacie. Nie jest powtórzeniem: przy kandydacie odpowiada
                na pytanie „którego wybrać", a tutaj — „czy na pewno ten
                pojechał do odpowiedzi". Lista kandydatów bywa przewinięta
                poza ekran, gdy agent pisze szkic. */}
            <div className={`rounded-lg border p-2 ${dobor.status === "confirmed"
              ? "border-emerald-300 bg-emerald-50" : "border-wertis-amber bg-amber-50"}`}>
              <div className="flex gap-3">
                <Kafel twId={dobor.wybrany.twId} rozmiar={56}
                  nazwa={dobor.wybrany.symbol} symbol={dobor.wybrany.symbol} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">Wybrano: <b className="font-mono text-sm text-slate-900">{dobor.wybrany.symbol}</b>
                    {" "}· droga: {NAZWA_DROGI[dobor.wybrany.droga]} · {dobor.wybrany.przez}
                    <button type="button" title="Zdejmij wybór" disabled={wybierz.isPending}
                      onClick={() => wybierzTowar(null, dobor.wybrany!.droga)}
                      className="ml-1 rounded p-0.5 align-middle text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                      <Krzyzyk size={12} /></button></p>
                  <p className="mt-1 rounded border border-slate-200 bg-white p-2 text-xs italic text-slate-700">
                    {dobor.wybrany.zdanieDoSzkicu}</p>
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Przycisk className="text-xs" onClick={() => onZlecPomiar({
                id: dobor.wybrany!.twId, sym: dobor.wybrany!.symbol, name: dobor.wybrany!.symbol, locs: [] })}>
                <Ruler size={14} />Zleć pomiar</Przycisk>
              <Przycisk className="text-xs" onClick={() => onWstawDoSzkicu(dobor.wybrany!.zdanieDoSzkicu)}>
                <FileText size={14} />Wstaw do szkicu ze źródłem</Przycisk>
              {dobor.status !== "confirmed" && <Przycisk wariant="glowny" className="text-xs"
                disabled={status.isPending} onClick={() => ustawStatus("confirmed", null, doSilnika)}>
                <Check size={14} />ZATWIERDŹ DOBÓR</Przycisk>}
            </div>
            {/* DO MASZYNY CZY DO SILNIKA — bez tego wyboru baza silnikowa nie
                urosłaby nigdy, bo zatwierdzenie zawsze zapisywało maszynę.
                Opcja silnikowa pojawia się WYŁĄCZNIE przy zatwierdzonej
                zabudowie: wybór z ekranu nie ma udawać faktu, którego w bazie
                nie ma. Część silnikowa zapisana raz przy jednej kosiarce
                odpowiada odtąd na pytania o wszystkie maszyny z tym silnikiem. */}
            {(() => {
              const kotwice = (kandydaci.data?.kotwice ?? []).filter((k) => k.twId !== dobor.wybrany!.twId);
              const cel = kotwice.find((k) => k.twId === pasujeDo);
              if (kotwice.length === 0) return null;
              return <div className="mt-2">
                {!cel && <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                  <span>pasowanie:</span>
                  {kotwice.map((k) => <Przycisk key={k.twId} className="text-xs" onClick={() => { setPasujeDo(k.twId); setPasowanieOk(""); }}>
                    Pasuje do {k.symbol}</Przycisk>)}
                  {pasowanieOk && <span className="text-emerald-800">{pasowanieOk}</span>}
                </div>}
                {cel && <PasowanieForm
                  para={{ czesc: { twId: dobor.wybrany!.twId, symbol: dobor.wybrany!.symbol, nazwa: dobor.wybrany!.symbol }, doCzego: cel }}
                  conversationId={rozmowaId} trwa={zaproponujPasowanie.isPending}
                  blad={(zaproponujPasowanie.error as Error | null)?.message}
                  onAnuluj={() => setPasujeDo(null)}
                  onWyslij={(v) => zaproponujPasowanie.mutate(v, {
                    onSuccess: () => { setPasujeDo(null); setPasowanieOk(`Propozycja „${dobor.wybrany!.symbol} pasuje do ${cel.symbol}” czeka w kolejce wiedzy.`); },
                  })} />}
              </div>;
            })()}
            {dobor.status !== "confirmed" && silniki.length > 0 &&
              <fieldset className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                <legend className="sr-only">Gdzie zapisać zastosowanie</legend>
                <span>zastosowanie zapisz do:</span>
                <label className="flex items-center gap-1">
                  <input type="radio" name="doCzego" checked={doSilnika === null}
                    onChange={() => setDoSilnika(null)} />
                  maszyny {[dobor.dane.marka, dobor.dane.model].filter(Boolean).join(" ")}</label>
                {silniki.map((z) => <label key={z.id} className="flex items-center gap-1">
                  <input type="radio" name="doCzego" checked={doSilnika === z.silnik.id}
                    onChange={() => setDoSilnika(z.silnik.id)} />
                  {z.silnik.etykieta}</label>)}
              </fieldset>}
          </>
        : <p className="text-xs text-slate-500">Nic jeszcze nie wybrano. Zatwierdzenie doboru wymaga
            wybranej kartoteki.</p>}
      {blad && <p className="mt-2 text-xs text-red-700">{blad.message}</p>}
    </section>

  </div>;
}

/**
 * Negatywne dopasowania (§11.4). Sekcja OSOBNA od kandydatów, bo negatyw
 * dotyczy także kartoteki, której na liście nie ma — to ostrzeżenie, nie
 * brak danych, i nie usuwa go automat (§14.2).
 */
function Negatywne({ lista }: { lista: NegatywDoboru[] }) {
  return <div className="mt-3 rounded-lg border border-red-200" aria-label="Negatywne dopasowania">
    <p className="flex items-center gap-1 rounded-t-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-900">
      {/* „Nie pasuje", nie „do tej maszyny": negatyw pasowania dotyczy części klienta. */}
      <AlertTriangle size={12} />Nie pasuje
      <span className="font-normal text-red-800">· ostrzeżenie, nie brak danych</span></p>
    {/* Kafel jest MNIEJSZY niż przy kandydacie i to jest celowe: negatyw ma
        się rzucić w oczy, gdy agent pojedzie wzrokiem po liście, ale nie ma
        konkurować z częściami, które wolno wybrać. */}
    <ul className="divide-y divide-red-100">
      {lista.map((n) => <li key={n.twId} className="flex items-start gap-2 px-2 py-1.5 text-xs">
        <Kafel twId={n.twId} rozmiar={36} nazwa={n.nazwa ?? n.symbol} symbol={n.symbol} />
        <div className="min-w-0 flex-1">
          <b className="font-mono">{n.symbol}</b>{n.nazwa && <span className="text-slate-600"> · {n.nazwa}</span>}
          <p className="text-red-900">{n.powod}</p>
          <p className="text-[11px] text-slate-500">{n.zrodlo}</p>
        </div>
      </li>)}
    </ul>
  </div>;
}

/**
 * Pasek szczebli §11.2. Szczebel POMINIĘTY mówi dlaczego — blizna 0.153.1:
 * milczący ekran każe zgadywać, czy automat szukał i nie znalazł, czy nie
 * miał czego szukać.
 */
function Szczeble({ drogi }: { drogi: SzczebelDoboru[] }) {
  return <div className="mt-1 flex flex-wrap gap-1" aria-label="Sprawdzone drogi">
    {drogi.map((d) => <span key={d.droga} title={d.sprawdzona ? `${d.wynikow} wyników` : `pominięty: ${d.powod ?? ""}`}
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${d.sprawdzona
        ? "bg-slate-200 text-slate-700" : "bg-slate-50 text-slate-500 line-through"}`}>
      {NAZWA_DROGI[d.droga]}{d.sprawdzona ? ` ${d.wynikow}` : ""}</span>)}
  </div>;
}
