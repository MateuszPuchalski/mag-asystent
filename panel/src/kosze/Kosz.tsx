import React, { useEffect, useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { PowodBezPowrotu, PozycjaWKoszu, SzczegolKosza, WierszKosza } from "../api/kosze";
import { useZdrowie } from "../api/rozmowy";
import { useFormularzWMiejscu } from "../nawigacja/fokus";
import { Zdjecie } from "../towar/Zdjecie";
import { Blad, NaglowekSekcji, Pole, Przycisk, czas, ile } from "../ui";
import { CyklKosza } from "./Cykl";
import { PrzyciskTowaru } from "../towar/Szuflada";

/* ── Zawartość kosza — środkowa kolumna ───────────────────────────────────
   Biuro widzi, CO w koszu leży i gdzie hala to odłożyła. Sam licznik
   „3/6 poz." przy pominięciu mylił: kosz wracał niekompletny, a ekran
   pokazywał zwykły postęp.

   Ta sama trasa co karta kosza w biurze (`/api/biuro/kosze/:id`) — jedno
   źródło prawdy o zawartości.

   - POMINIĘTE STOJĄ OSOBNO I NA GÓRZE, z „Załatwione" przy sobie. To jedyne
     pozycje kosza, przy których ktoś czeka na biuro. W tabeli giną między
     odłożonymi, a w kolumnie obok trzeba je drugi raz odszukać po symbolu.
     Na wąskim oknie kolumna obok schodzi pod całą tabelę.
   - TRZY KOLUMNY ZAMIAST CZTERECH (dekalog pkt 2). Adres i stan odpowiadają
     na jedno pytanie: gdzie to leży i czy już leży. Osobno zabierają nazwie
     towaru tyle miejsca, że łamie się na trzy linie.
   - ZDJĘCIE PRZY POZYCJI stoi wtedy, gdy instalacja ma zdjęcia — ta sama
     reguła i powód co w `dostawy/Dokument.tsx`. */

/**
 * Gdzie pozycja leży i co się z nią stało — adres ze stanem w jednej komórce.
 *
 * Adres faktyczny jest pogrubiony, oczekiwany szary: pierwszy to fakt z hali,
 * drugi dopiero zamiar.
 */
function GdzieIStan({ p }: { p: PozycjaWKoszu }) {
  if (p.status === "done") {
    return <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b>{p.lokFaktyczna ?? p.lokOczekiwana ?? "—"}</b>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">odłożona</span>
      </div>
      {p.odlozonoPrzez && <div className="text-xs text-slate-600">
        {p.odlozonoPrzez}{p.odlozonoAt ? ` · ${czas(p.odlozonoAt)}` : ""}</div>}
      {/* Stan MM mówi, czy bufor NAPRAWDĘ się cofnął w Subiekcie — kolejka
          zapisów pokazuje błędy globalnie, ale nie wiąże ich z koszem. */}
      {p.mmNumer ? <div className="text-xs text-slate-600">MM {p.mmNumer}</div>
        : p.mmStatus === "error"
          ? <div><span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">MM w błędzie</span></div>
          : p.mmStatus ? <div className="text-xs text-slate-600">MM: {p.mmStatus}</div> : null}
    </>;
  }
  return <div className="flex flex-wrap items-baseline gap-x-2 text-slate-600">
    <span>{p.lokOczekiwana ?? "—"}</span>
    <span className="text-xs">czeka na hali</span>
  </div>;
}

/** Zamknięcie sprawy pominięcia — stan i zapis trzyma ekran. */
export interface Zalatwianie {
  trwa: boolean;
  blad: string;
  onZalatw: (pozycjaId: number, notatka: string) => void;
}

/**
 * Pozycja, którą hala pominęła — z „Załatwione" w miejscu.
 *
 * Załatwienie NIE kasuje pominięcia, tylko się do niego dopisuje. Kosz na
 * zawsze zostaje niekompletny, zmienia się to, czy sprawa wisi. Dlatego
 * załatwiona pozycja zostaje w tej sekcji, z osobą, czasem i notatką.
 *
 * DWA NAPISY NA DWA KROKI. Jeden „Załatwione" na przycisku, który otwiera
 * pole, i na tym, który zapisuje, każe zgadywać, czy pierwsze kliknięcie już
 * coś wysłało.
 */
function PozycjaPominieta({ p, zdjecia, zalatw, blokujeMm }: {
  p: PozycjaWKoszu; zdjecia: boolean; zalatw: Zalatwianie; blokujeMm: boolean;
}) {
  const formularz = useFormularzWMiejscu();
  const [notatka, setNotatka] = useState("");
  const idPodpowiedzi = useId();
  const anuluj = () => { formularz.wycofaj(); setNotatka(""); };
  /* ZAŁATWIONA POZYCJA ZAMYKA SWÓJ FORMULARZ I GUBI NOTATKĘ. Hala może
     pominąć tę samą pozycję drugi raz, a serwer zeruje wtedy załatwienie.
     Formularz schowany samym `zalatwioneAt` wróciłby przy odświeżeniu sam,
     z fokusem i dawną notatką, i Enter zamknąłby nowe zgłoszenie hali. */
  const zalatwiona = Boolean(p.zalatwioneAt);
  useEffect(() => { if (zalatwiona) { formularz.zamknij(); setNotatka(""); } }, [zalatwiona]);
  return <div className="flex gap-3 border-b border-slate-200 py-3 last:border-b-0">
    {zdjecia && <Zdjecie twId={p.twId} rozmiar={44} nazwa={p.nazwa} />}
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b>{p.symbol
          ? <PrzyciskTowaru twId={p.twId}>{p.symbol}</PrzyciskTowaru> : p.nazwa}</b>
        <span className="text-sm tabular-nums text-slate-600">{p.ilosc}{p.unit ? ` ${p.unit}` : " szt."}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {p.zalatwioneAt
            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">załatwiona</span>
            : <>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">pominięta</span>
                {!formularz.otwarty && <button ref={formularz.przycisk} type="button"
                  className="btn-secondary !px-2.5 !py-1 !text-xs" onClick={formularz.otworz}>
                  Oznacz jako załatwione</button>}
              </>}
        </span>
      </div>
      {p.symbol && <div className="text-sm text-slate-700">{p.nazwa}</div>}
      <p className="mt-1 text-sm">Hala: „{p.powod || "bez powodu"}”
        {p.lokOczekiwana && <span className="text-slate-600"> · miała trafić na {p.lokOczekiwana}</span>}</p>
      {/* Ten sam znacznik co w tabeli: pozycja blokuje MM bez względu na to,
          w której sekcji stoi. */}
      {blokujeMm && <p className="mt-1 text-xs font-bold text-ranga-zle">blokuje MM — brak wolnego stanu</p>}
      {p.zalatwioneAt && <p className="mt-1 text-xs text-slate-600">
        Załatwione: {p.zalatwionePrzez ? `${p.zalatwionePrzez} · ` : ""}{czas(p.zalatwioneAt)}
        {p.zalatwioneNotatka && <> — <span className="text-slate-800">{p.zalatwioneNotatka}</span></>}</p>}
      {formularz.otwarty && !p.zalatwioneAt &&
        /* Pole w całej szerokości, przyciski pod nim: w jednym rzędzie
           z przyciskami pole ma kilkadziesiąt pikseli i nie widać, co się
           wpisuje. Escape wycofuje się jak „Anuluj". */
        <form className="mt-2"
          onSubmit={(e) => { e.preventDefault(); zalatw.onZalatw(p.id, notatka.trim()); }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); anuluj(); } }}>
          <Pole autoFocus value={notatka} onChange={(e) => setNotatka(e.target.value)}
            placeholder="Jak to załatwiono?" aria-label="Jak załatwiono" aria-describedby={idPodpowiedzi} />
          <p id={idPodpowiedzi} className="mt-1 text-xs text-slate-600">
            Opcjonalnie, np. „znalazło się na regale”. Pozycja zostaje pominięta, znika tylko z listy pracy.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Przycisk wariant="glowny" type="submit" disabled={zalatw.trwa}>Załatwione</Przycisk>
            <Przycisk type="button" onClick={anuluj}>Anuluj</Przycisk>
          </div>
          {/* Błąd przy polu, którego dotyczy, nie pod całą sekcją: przy kilku
              pominiętych stałby daleko od miejsca, w którym człowiek patrzy. */}
          {zalatw.blad && <p className="mt-1 text-xs text-ranga-zle">{zalatw.blad}</p>}
        </form>}
    </div>
  </div>;
}

/** Nagłówek sekcji pominiętych: czekające zawsze, załatwione tylko gdy są. */
function licznikPominietych(lista: PozycjaWKoszu[]): string {
  const zalatwione = lista.filter((p) => p.zalatwioneAt).length;
  return `${lista.length - zalatwione} do załatwienia`
    + (zalatwione ? ` · ${ile(zalatwione, "załatwiona", "załatwione", "załatwionych")}` : "");
}

/** Stan ponowienia MM kosza z kłopotem. */
export interface PonowienieMm {
  problem: NonNullable<WierszKosza["problemMm"]>;
  trwa: boolean;
  blad: string;
  wynik: string;
  /** Odmowa „przerwano w trakcie zapisu" czeka na potwierdzenie człowieka. */
  czekaNaSprawdzenie: boolean;
  onPonow: (sprawdzono: boolean) => void;
  /** Zdjęcie kartoteki z MM, które nie weszło. */
  usun?: { trwa: boolean; blad: string; wynik: string; onUsun: (twId: number) => void };
}

/* Co zrobić, gdy MM powrotne nie powstało — zależnie od przyczyny.
   Kosz bez znanego kierunku NIE czeka na adresy: tam jedynym ruchem jest
   dokument w Subiekcie, bo aplikacja powrotu nie wystawi nigdy. */
const RUCH_BEZ_POWROTU: Record<PowodBezPowrotu, string> = {
  adresy: "Czeka na zapis adresu, który stoi w kolejce Sfery albo w błędzie — powrót wyjdzie sam po nim.",
  kierunek: "Aplikacja nie zna magazynu, z którego przyszedł dokument — MM powrotne wystaw w Subiekcie.",
  nieznany: "Powrót powinien był już wyjść — sprawdź kolejkę Sfery.",
};

/* Treść dawnego akapitu pod nagłówkiem kosza — dziś podpowiedź przycisku. */
const PODPOWIEDZ_PRZELICZENIA = "Dokumentu jeszcze nie ma, więc zawartość da się poprawić. "
  + "Przeliczenie układa ją od nowa z ocen „na stan” — zestaw sprzedany jedną ofertą "
  + "wchodzi rozbity, tak jak leży na magazynie.";

export function Kosz({ k, przelicz, zalatw, ponowMm = null, bezPowrotu = null }: {
  k: SzczegolKosza;
  przelicz: { trwa: boolean; blad: string; wynik: string; onPrzelicz: () => void };
  zalatw: Zalatwianie;
  ponowMm?: PonowienieMm | null;
  /** Rozłożony ponad dobę, a MM powrotne nie powstało — i dlaczego. */
  bezPowrotu?: PowodBezPowrotu | null;
}) {
  /* Potwierdzenie przy zdjęciu z MM: towar zostaje na magazynie
     źródłowym, a przesunięcie ręką to druga czynność — jeden klik za mało. */
  const [potwierdzUsun, setPotwierdzUsun] = useState<number | null>(null);
  const zdrowie = useZdrowie();
  const zdjecia = zdrowie.data?.zdjecia != null || zdrowie.data?.zdjeciaWlasne != null;
  const bezKorekty = k.zwroty.filter((z) => !z.korektaNumer);
  /* Czekające przed załatwionymi: biuro wchodzi w kosz po te pierwsze. */
  const pominiete = k.pozycje.filter((p) => p.status === "skipped")
    .sort((a, b) => Number(Boolean(a.zalatwioneAt)) - Number(Boolean(b.zalatwioneAt)));
  const czekajace = pominiete.filter((p) => !p.zalatwioneAt).length;
  const reszta = k.pozycje.filter((p) => p.status !== "skipped");
  const blokujeMm = (p: PozycjaWKoszu) => Boolean(k.brakiMm?.some((b) => b.twId === p.twId));
  const powrot = !k.powrot ? null
    : k.powrot.numer ? `powrót MM ${k.powrot.numer}`
      : k.powrot.status === "error" ? "powrót MM w błędzie — sprawdź kolejkę"
        : "powrót MM zamówiony, czeka na dokument";
  /* Cykl życia kosza jedną linią — przy sprawie pada pytanie „co się z tym
     działo". Kosz otwarty nie pokazuje niczego, bo nic się jeszcze nie stało. */
  const etapy = [
    k.zamknietoPrzez && `zamknął ${k.zamknietoPrzez} · ${czas(k.zamknietoAt)}`,
    k.rozlozonoPrzez && `rozłożył ${k.rozlozonoPrzez} · ${czas(k.rozlozonoAt)}`,
    powrot,
  ].filter(Boolean);

  return <>
    <div className="shrink-0 border-b border-slate-200 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-tytul font-bold">{k.kod}</h2>
        <CyklKosza status={k.status} />
        {k.rodzaj === "karton" && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">karton</span>}
        <span className="ml-auto" />
        {/* Wyjaśnienie w podpowiedzi przycisku: czyta się je raz — przy
            pierwszym przeliczeniu, czyli z myszą na przycisku. */}
        {k.doEdycji && <Przycisk disabled={przelicz.trwa} onClick={przelicz.onPrzelicz}
          title={PODPOWIEDZ_PRZELICZENIA}>
          <RefreshCw size={16} />Przelicz ze zwrotów</Przycisk>}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {k.mmNumer ? `z przesunięcia MM ${k.mmNumer}` : `${ile(k.zwroty.length, "zwrot przypięty", "zwroty przypięte", "zwrotów przypiętych")} w panelu`}
        {` · odłożone ${k.odlozonych}/${k.pozycje.length} poz.`}</p>
      {etapy.length > 0 && <p className="mt-1 text-sm text-slate-600">{etapy.join(" → ")}</p>}
      {przelicz.wynik && <p className="mt-1 text-sm text-ranga-ok">{przelicz.wynik}</p>}
      <Blad>{przelicz.blad}</Blad>
      {/* ── KŁOPOT Z MM I PONOWIENIE ──────────────────────────────────────
          Przycisk stoi tylko przy MM w błędzie TERAZ — MM, która weszła po
          odmowie, nie ma czego ponawiać, tam zostaje samo sprawdzenie stanów. */}
      {ponowMm && <div className={`mt-2 rounded-lg border p-2 text-sm ${ponowMm.problem.nierozwiazany
        ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <p className={ponowMm.problem.nierozwiazany ? "text-ranga-zle" : "text-ranga-uwaga"}>
          <b>{ponowMm.problem.nierozwiazany ? "MM w błędzie"
            /* PONAWIANE: powrót czeka na kolejną próbę. Weszło to dopiero
               dokument z numerem. */
            : ponowMm.problem.ponawiane ? "MM ponawiane po odmowie — jeszcze nie weszło"
              : "MM weszło po błędzie — sprawdź stany z Subiektem"}</b>
          {ponowMm.problem.ostatniBlad ? ` · ${ponowMm.problem.ostatniBlad}` : ""}</p>
        {/* KTÓRY TOWAR. Sfera mówi „brak towaru" o całym dokumencie;
            read-model stanów wskazuje linię. Pusta lista to też informacja:
            nasza kopia braku nie widzi, więc przyczyna leży poza nią. */}
        {(k.brakiMm?.length ?? 0) > 0 && <ul className="mt-2 space-y-2">
          {k.brakiMm!.map((b) => <li key={`${b.twId}-${b.magazyn}`}>
            <p className="text-ranga-zle"><b>{b.symbol ?? `kartoteka ${b.twId}`}</b>{b.nazwa ? ` · ${b.nazwa}` : ""}
              {` — MM chce ${b.potrzeba} szt. z ${b.magazyn}, a tam jest ${b.stan}`}
              {b.rezerwacja > 0 ? `, z czego ${b.rezerwacja} zarezerwowane` : ""}.</p>
            {/* ZDJĘCIE Z MM — decyzja właściciela. Przycisk pod zdaniem, nie
                dopisek na jego końcu: to ruch, po którym towar zostaje na
                magazynie źródłowym, więc ma wyglądać jak ruch. Jeden
                czasownik w obu krokach, żeby nie zgadywać, czy to to samo. */}
            {ponowMm.usun && (potwierdzUsun === b.twId
              ? <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-700">
                  <span>Zostanie na {b.magazyn} — przesuniesz go ręką w Subiekcie.</span>
                  <button type="button" disabled={ponowMm.usun.trwa}
                    onClick={() => { ponowMm.usun!.onUsun(b.twId); setPotwierdzUsun(null); }}
                    className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-ranga-zle hover:bg-red-100 disabled:opacity-50">
                    Zdejmij z MM</button>
                  <Przycisk className="!px-2.5 !py-1 !text-xs" onClick={() => setPotwierdzUsun(null)}>Anuluj</Przycisk>
                </div>
              : <Przycisk className="mt-1 !px-2.5 !py-1 !text-xs" onClick={() => setPotwierdzUsun(b.twId)}>
                  Zdejmij z MM…</Przycisk>)}
          </li>)}
        </ul>}
        {ponowMm.usun?.wynik && <p className="mt-1 text-ranga-ok">{ponowMm.usun.wynik}</p>}
        {ponowMm.usun && <Blad>{ponowMm.usun.blad}</Blad>}
        {k.brakiMm?.length === 0 && /brak towaru/i.test(ponowMm.problem.ostatniBlad ?? "")
          && (ponowMm.problem.nierozwiazany || ponowMm.problem.ponawiane)
          && <p className="mt-1 text-xs text-slate-600">Nasza kopia stanów nie widzi braku —
            sprawdź stan na magazynie źródłowym w Subiekcie; import mógł jeszcze nie dojść.</p>}
        {ponowMm.problem.nierozwiazany && <div className="mt-2 flex flex-wrap items-center gap-2">
          {ponowMm.czekaNaSprawdzenie
            ? <Przycisk wariant="glowny" disabled={ponowMm.trwa} onClick={() => ponowMm.onPonow(true)}>
                <RefreshCw size={16} />Sprawdziłem w Subiekcie — ponów MM</Przycisk>
            : <Przycisk wariant="glowny" disabled={ponowMm.trwa} onClick={() => ponowMm.onPonow(false)}>
                <RefreshCw size={16} />{ponowMm.trwa ? "Ponawiam…" : "Ponów MM"}</Przycisk>}
        </div>}
        {ponowMm.wynik && <p className="mt-1 text-ranga-ok">{ponowMm.wynik}</p>}
        <Blad>{ponowMm.blad}</Blad>
      </div>}
      {/* ── BEZ MM POWROTNEGO ────────────────────────────────────────────
          Zdanie kończy się RUCHEM, jak w rekoncyliacji, i zależy od przyczyny
          (`RUCH_BEZ_POWROTU`). Przycisku tu nie ma: powrót zamawia automat,
          gdy adresy wejdą, a ręczne zamówienie ominęłoby właśnie tę bramkę. */}
      {bezPowrotu && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-ranga-zle">
        <b>MM powrotne nie powstało</b> · towar leży na półce, a stan wisi na regale zwrotów,
        więc nie da się go sprzedać. {RUCH_BEZ_POWROTU[bezPowrotu]}</div>}
      {bezKorekty.length > 0 && <p className="mt-1 text-sm">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">czeka na korektę</span>
        {" "}MM wyjdzie, gdy dojdą numery korekt do {ile(bezKorekty.length, "zwrotu", "zwrotów", "zwrotów")}.</p>}
      {pominiete.length > 0 && <p className="mt-1 text-sm">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">kosz niekompletny</span>
        {" "}hala pominęła {pominiete.length} poz.{czekajace
          ? ` — ${czekajace} czeka na biuro, niżej.` : " — wszystkie załatwione."}</p>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
      {pominiete.length > 0 && <section className="mb-4">
        <NaglowekSekcji jako="h3">Pominięte przez halę · {licznikPominietych(pominiete)}</NaglowekSekcji>
        {pominiete.map((p) => <PozycjaPominieta key={p.id} p={p} zdjecia={zdjecia} zalatw={zalatw}
          blokujeMm={blokujeMm(p)} />)}
      </section>}

      <NaglowekSekcji jako="h3">
        {pominiete.length ? "Pozostała zawartość" : "Zawartość"} · {reszta.length}</NaglowekSekcji>
      {reszta.length
        ? <table className="mt-1 w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-600">
              {zdjecia && <th className="w-12 py-1.5 pr-2"><span className="sr-only">Zdjęcie</span></th>}
              <th className="py-1.5 pr-2 font-bold">Towar</th>
              <th className="w-20 py-1.5 pr-2 font-bold">Ilość</th>
              <th className="w-48 py-1.5 font-bold">Adres · stan</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {reszta.map((p) => <tr key={p.id} className="align-top">
                {zdjecia && <td className="py-2 pr-2"><Zdjecie twId={p.twId} rozmiar={40} nazwa={p.nazwa} /></td>}
                <td className="py-2 pr-2">
                  {p.symbol && <b className="block"><PrzyciskTowaru twId={p.twId}>{p.symbol}</PrzyciskTowaru></b>}
                  <span className="text-xs text-slate-600">{p.nazwa}</span></td>
                <td className="py-2 pr-2 font-bold tabular-nums">{p.ilosc}{p.unit ? ` ${p.unit}` : ""}</td>
                <td className="py-2"><GdzieIStan p={p} />
                  {/* Wiersz, który blokuje MM, oznaczony przy sobie —
                      żeby nie szukać symbolu z ramki wśród dwudziestu pięciu. */}
                  {blokujeMm(p) &&
                    <span className="mt-1 block text-xs font-bold text-ranga-zle">blokuje MM — brak wolnego stanu</span>}
                </td>
              </tr>)}
            </tbody>
          </table>
        : <p className="py-2 text-sm text-slate-600">
            {pominiete.length ? "Poza pominiętymi kosz nie ma pozycji." : "Kosz jest pusty."}</p>}
    </div>
  </>;
}
