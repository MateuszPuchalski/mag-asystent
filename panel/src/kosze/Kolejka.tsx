import React from "react";
import type { Pominieta, WierszKosza, ZnalezionaWKoszu } from "../api/kosze";
import { Pusto, WierszKolejki, czas, dniSlowo, ile } from "../ui";
import { CyklKosza, StanMmKosza } from "./Cykl";

/* ── Kolejka koszy (0.438.0) ───────────────────────────────────────────────
   Z MAGAZYNU ZWROTÓW w `biuro.html`, w ramie kolejek panelu. Kubełki
   odpowiadają na pytania biura przy koszach, po kolei:

     W pracy     — co jest w drodze: koszyk zbiera towar albo kosz stoi na hali;
     Pominięte   — czego hala nie znalazła; każdy wiersz czeka na decyzję;
     Rozłożone   — historia, do sprawdzenia „kto to rozłożył";
     Anulowane   — praca, która się nie wydarzyła.

   KARTONY stoją na tej samej liście, bo dla biura „co jest na hali" to jedno
   pytanie — ale z pastylką, inaczej karton bez zwrotów i bez MM wyglądałby
   jak kosz zepsuty. Biuro go wyłącznie ogląda: zawartość zbiera hala. */

export type KubelekKoszy = "praca" | "pominiete" | "mm" | "rozlozone" | "anulowane";

export const KUBELKI_KOSZY: Array<{ id: KubelekKoszy; etykieta: string; pytanie: string }> = [
  { id: "praca", etykieta: "W pracy", pytanie: "Co jest w drodze na regał?" },
  { id: "pominiete", etykieta: "Pominięte", pytanie: "Szukać dalej, reklamować czy poprawić dokument?" },
  /* Problem z MM (0.501.0), zgłoszenie właściciela: „muszę sprawdzić stany
     z Subiektem". Kubełek PRZEKROJOWY — kosz stoi tu obok swojego kubełka
     statusu, bo kłopot z dokumentem nie zmienia tego, gdzie kosz jest. */
  { id: "mm", etykieta: "Problem z MM", pytanie: "Czy stany w Subiekcie zgadzają się z koszem?" },
  { id: "rozlozone", etykieta: "Rozłożone", pytanie: "Tylko wgląd." },
  { id: "anulowane", etykieta: "Anulowane", pytanie: "Tylko wgląd." },
];

/**
 * Kosze jednego kubełka w kolejności, którą ten kubełek zadaje (0.486.4).
 *
 * ROZŁOŻONE PO CHWILI ROZŁOŻENIA, najświeższe na górze. Zgłoszenie
 * właściciela: „rozłożone koszyki układaj kolejnością rozłożenia". Kubełek
 * jest historią i odpowiada na „co hala właśnie skończyła" — a lista stała
 * w porządku serwera, czyli po założeniu kosza. Kosz założony wcześniej bywa
 * rozłożony później, więc tamten porządek mieszał dzień pracy hali.
 *
 * Kosz rozłożony bez zapisanej chwili (sprzed wprowadzenia pola) idzie na
 * koniec, zamiast udawać najstarszy albo najnowszy. Pozostałe kubełki
 * zostają w porządku serwera — tam pytanie jest inne.
 */
export function koszeKubelka(kosze: WierszKosza[], kubelek: KubelekKoszy): WierszKosza[] {
  /* PROBLEM Z MM po chwili ostatniego kłopotu, najświeższy na górze:
     nierozwiązany błąd i wczorajsza odmowa są pilniejsze od tej sprzed
     miesiąca, którą remanent mógł już wyrównać. */
  if (kubelek === "mm") {
    /* Kosz BEZ MM POWROTNEGO też tu stoi (0.505.0): jego stan wisi na
       regale zwrotów, więc sprawdza się go z Subiektem tak samo. Dla niego
       chwilą kłopotu jest rozłożenie — od niej powrót powinien był wyjść. */
    const kiedy = (k: WierszKosza) => k.problemMm?.ostatnioAt ?? k.rozlozonoAt ?? "";
    return kosze.filter(maKlopotMm).sort((a, b) => kiedy(b).localeCompare(kiedy(a)));
  }
  const wybrane = kosze.filter((k) => kubelekKosza(k) === kubelek);
  if (kubelek !== "rozlozone") return wybrane;
  return [...wybrane].sort((a, b) => {
    if (!a.rozlozonoAt || !b.rozlozonoAt) return a.rozlozonoAt ? -1 : b.rozlozonoAt ? 1 : 0;
    return b.rozlozonoAt.localeCompare(a.rozlozonoAt);
  });
}

/** Czy kosz należy do kubełka PROBLEM Z MM — liczniki i lista pytają tu jednym zdaniem. */
export function maKlopotMm(k: WierszKosza): boolean {
  return Boolean(k.problemMm) || Boolean(k.bezPowrotu);
}

export function kubelekKosza(k: WierszKosza): KubelekKoszy {
  if (k.status === "anulowany") return "anulowane";
  if (k.status === "rozlozony") return "rozlozone";
  return "praca";
}

/** Zdanie o postępie — to, co w biurze stało pod numerem kosza. */
function postep(k: WierszKosza): string {
  const karton = k.rodzaj === "karton";
  if (k.status === "anulowany") {
    return `Anulowany${k.anulowanoPrzez ? ` przez ${k.anulowanoPrzez}` : ""} — ${
      k.odlozonych} z ${k.pozycji} poz. zdążyło wrócić na półki.`;
  }
  if (k.status === "otwarty") {
    return karton ? "Hala zbiera zawartość — pudło jeszcze otwarte."
      : "Przyjmuje zwroty — rozkładanie jeszcze nie ruszyło.";
  }
  /* Chwila rozłożenia w zdaniu (0.486.4): kubełek ROZŁOŻONE układa się po
     niej, więc porządek ma być widać, a nie trzeba go zgadywać. */
  return `Rozłożono ${k.odlozonych}/${k.pozycji} poz.${
    k.status === "rozlozony" && k.rozlozonoAt ? ` · ${czas(k.rozlozonoAt)}` : ""}${
    k.rozlozonoPrzez ? ` · ${k.rozlozonoPrzez}` : ""}`;
}

export function KolejkaKoszy({ kosze, wybrany, onWybierz, pokazBladMm = false }: {
  kosze: WierszKosza[]; wybrany: number | null; onWybierz: (id: number) => void;
  /** W kubełku PROBLEM Z MM treść odmowy zastępuje zdanie o postępie. */
  pokazBladMm?: boolean;
}) {
  if (!kosze.length) return <Pusto waga="lista">Ten kubełek jest pusty.</Pusto>;
  return <ul className="divide-y divide-slate-200">
    {kosze.map((k) => {
      const karton = k.rodzaj === "karton";
      return <WierszKolejki key={k.id} aktywny={k.id === wybrany} onKlik={() => onWybierz(k.id)}>
        <span className="flex w-full items-baseline gap-2">
          <span className="truncate font-bold">{k.kod}</span>
          <span className="ml-auto shrink-0 text-xs text-slate-600">
            {karton ? ile(k.pozycji, "pozycja", "pozycje", "pozycji")
              : k.mmNumer ? `MM ${k.mmNumer}` : ile(k.zwrotow, "zwrot", "zwroty", "zwrotów")}</span>
        </span>
        {pokazBladMm && k.problemMm
          ? <span className="w-full truncate text-sm text-ranga-zle"
              title={k.problemMm.ostatniBlad ?? undefined}>
              {k.problemMm.ostatniBlad ?? "Sfera odmówiła bez treści"} · {czas(k.problemMm.ostatnioAt)}</span>
          : pokazBladMm && k.bezPowrotu
            ? <span className="w-full truncate text-sm text-ranga-zle">
                MM powrotne nie powstało{k.rozlozonoAt ? ` · rozłożono ${czas(k.rozlozonoAt)}` : ""}</span>
            : <span className="w-full truncate text-sm text-slate-600">{postep(k)}</span>}
        <span className="mt-1 flex w-full flex-wrap items-center gap-1.5">
          {karton && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">karton</span>}
          <CyklKosza status={k.status} mmBlad={k.mmStan === "blad" && !k.mmNumer && !karton} />
          <StanMmKosza mmStan={k.mmStan} mmNumer={k.mmNumer} brakujeKorekt={k.brakujeKorekt} karton={karton} />
          {/* ZNACZNIK KŁOPOTU Z MM (0.501.0) w każdym kubełku. Czerwony, gdy
              zadanie stoi w błędzie teraz; bursztynowy, gdy przeszło po
              odmowie — wtedy dokument jest, ale stany trzeba sprawdzić. */}
          {k.problemMm &&
            <span title={`${ile(k.problemMm.prob, "nieudana próba", "nieudane próby", "nieudanych prób")} MM${
              k.problemMm.ostatniBlad ? `: ${k.problemMm.ostatniBlad}` : ""} — sprawdź stany z Subiektem`}
              className={`rounded px-1.5 py-0.5 text-xs font-bold ${k.problemMm.nierozwiazany
                ? "bg-red-100 text-ranga-zle" : "bg-amber-100 text-ranga-uwaga"}`}>
              {k.problemMm.nierozwiazany ? "MM w błędzie"
                /* Ponawiane (0.530.0): po odmowie czeka na próbę — jeszcze nie weszło. */
                : k.problemMm.ponawiane ? "MM ponawiane" : "MM po błędzie"}</span>}
          {/* BEZ MM POWROTNEGO (0.505.0). Czerwony, bo towar leży na półce,
              a stan na regale zwrotów — sprzedać się go nie da. */}
          {k.bezPowrotu &&
            <span title="Rozłożony ponad dobę temu, a MM powrotne nie powstało — stan wisi na regale zwrotów"
              className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-ranga-zle">
              bez MM powrotnej</span>}
          {k.pominietych > 0 &&
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">
              {ile(k.pominietych, "pominięta", "pominięte", "pominiętych")}</span>}
        </span>
      </WierszKolejki>;
    })}
  </ul>;
}

/**
 * Pominięte ze WSZYSTKICH koszy — lista pracy, nie historia. Najdłużej
 * czekające na górze: sprawa sprzed tygodnia kosztuje więcej niż wczorajsza.
 * Wiersz otwiera swój kosz, bo tam stoi reszta jego zawartości i ZAŁATWIONE.
 */
export function KolejkaPominietych({ lista, wybranyKosz, onWybierz }: {
  lista: Pominieta[]; wybranyKosz: number | null; onWybierz: (koszId: number) => void;
}) {
  if (!lista.length) return <Pusto waga="lista">Hala niczego nie pominęła — nic tu nie czeka.</Pusto>;
  return <ul className="divide-y divide-slate-200">
    {lista.map((p) => <WierszKolejki key={p.pozycjaId} aktywny={p.koszId === wybranyKosz}
      onKlik={() => onWybierz(p.koszId)}>
      <span className="flex w-full items-baseline gap-2">
        <span className="truncate font-bold">{p.symbol || p.kod}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-600">{p.dni > 0 ? dniSlowo(p.dni) : "dziś"}</span>
      </span>
      <span className="w-full truncate text-sm text-slate-600">{p.nazwa} · {p.ilosc} szt.</span>
      <span className="mt-1 flex w-full flex-wrap gap-1.5">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">kosz {p.kod}</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">
          {p.powod || "bez powodu"}</span>
      </span>
    </WierszKolejki>)}
  </ul>;
}

/** „W którym koszu jechał ten towar?" — wynik szukania zamiast kolejki. */
export function WynikiSzukania({ lista, onWybierz }: {
  lista: ZnalezionaWKoszu[]; onWybierz: (koszId: number) => void;
}) {
  if (!lista.length) return <Pusto waga="lista">Nic w koszach nie pasuje do tego, czego szukasz.</Pusto>;
  return <ul className="divide-y divide-slate-200">
    {lista.map((z, i) => <WierszKolejki key={`${z.koszId}-${i}`} aktywny={false} onKlik={() => onWybierz(z.koszId)}>
      <span className="flex w-full items-baseline gap-2">
        <span className="truncate font-bold">{z.symbol || z.nazwa}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-600">{z.kiedy ? czas(z.kiedy) : "—"}</span>
      </span>
      <span className="w-full truncate text-sm text-slate-600">{z.nazwa} · {z.ilosc} szt.</span>
      <span className="mt-1 flex w-full flex-wrap items-center gap-1.5">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">kosz {z.kod}</span>
        {z.status === "skipped"
          ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">pominięta</span>
          : z.lokFaktyczna
            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">{z.lokFaktyczna}</span>
            : <span className="text-xs text-slate-600">czeka na hali</span>}
      </span>
    </WierszKolejki>)}
  </ul>;
}
