import React from "react";
import { RefreshCw } from "lucide-react";
import type { PozycjaWKoszu, SzczegolKosza, WierszKosza } from "../api/kosze";
import { Zdjecie } from "../towar/Zdjecie";
import { Blad, NaglowekSekcji, Przycisk, czas, ile } from "../ui";
import { CyklKosza } from "./Cykl";
import { PrzyciskTowaru } from "../towar/Szuflada";

/* ── Zawartość kosza — środkowa kolumna (0.438.0) ─────────────────────────
   Biuro widziało kiedyś sam licznik „3/6 poz." i nie miało jak sprawdzić,
   CO w koszu leży ani gdzie hala to odłożyła. Przy pominięciu było to już
   mylące: kosz wracał niekompletny, a ekran pokazywał zwykły postęp.

   Ta sama trasa co karta kosza w biurze (`/api/biuro/kosze/:id`) — jedno
   źródło prawdy o zawartości. */

/** Jedno zdanie o pozycji: co się z nią stało i kto to zrobił. */
function StanPozycji({ p }: { p: PozycjaWKoszu }) {
  if (p.status === "skipped") {
    /* Załatwienie NIE kasuje pominięcia — dopisuje się do niego. Kosz na
       zawsze zostaje niekompletny, zmienia się tylko to, czy sprawa wisi. */
    return <>
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">pominięta</span>
      <div className="text-xs text-slate-600">„{p.powod || "bez powodu"}”</div>
      {p.zalatwioneAt && <div className="text-xs text-slate-600">
        załatwione{p.zalatwionePrzez ? ` · ${p.zalatwionePrzez}` : ""}
        {p.zalatwioneNotatka ? ` — „${p.zalatwioneNotatka}”` : ""}</div>}
    </>;
  }
  if (p.status === "done") {
    return <>
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">odłożona</span>
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
  return <span className="text-xs text-slate-600">czeka na hali</span>;
}

/** Stan ponowienia MM kosza z kłopotem (0.503.0). */
export interface PonowienieMm {
  problem: NonNullable<WierszKosza["problemMm"]>;
  trwa: boolean;
  blad: string;
  wynik: string;
  /** Odmowa „przerwano w trakcie zapisu" czeka na potwierdzenie człowieka. */
  czekaNaSprawdzenie: boolean;
  onPonow: (sprawdzono: boolean) => void;
}

export function Kosz({ k, przelicz, ponowMm = null }: {
  k: SzczegolKosza;
  przelicz: { trwa: boolean; blad: string; wynik: string; onPrzelicz: () => void };
  ponowMm?: PonowienieMm | null;
}) {
  const bezKorekty = k.zwroty.filter((z) => !z.korektaNumer);
  const pominiete = k.pozycje.filter((p) => p.status === "skipped");
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
        {k.doEdycji && <Przycisk disabled={przelicz.trwa} onClick={przelicz.onPrzelicz}>
          <RefreshCw size={16} />Przelicz ze zwrotów</Przycisk>}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {k.mmNumer ? `z przesunięcia MM ${k.mmNumer}` : `${ile(k.zwroty.length, "zwrot przypięty", "zwroty przypięte", "zwrotów przypiętych")} w panelu`}
        {` · odłożone ${k.odlozonych}/${k.pozycje.length} poz.`}</p>
      {etapy.length > 0 && <p className="mt-1 text-sm text-slate-600">{etapy.join(" → ")}</p>}
      {k.doEdycji && <p className="mt-1 text-sm text-slate-600">
        Dokumentu jeszcze nie ma, więc zawartość da się poprawić. Przeliczenie układa ją od nowa
        z ocen „na stan" — zestaw sprzedany jedną ofertą wchodzi rozbity, tak jak leży na magazynie.</p>}
      {przelicz.wynik && <p className="mt-1 text-sm text-ranga-ok">{przelicz.wynik}</p>}
      <Blad>{przelicz.blad}</Blad>
      {/* ── KŁOPOT Z MM I PONOWIENIE (0.503.0) ──────────────────────────────
          Zgłoszenie właściciela: „dodaj, abym mógł wywołać ponownie". Przycisk
          stoi tylko przy MM w błędzie TERAZ — MM, która weszła po odmowie, nie
          ma czego ponawiać, tam zostaje samo sprawdzenie stanów. */}
      {ponowMm && <div className={`mt-2 rounded-lg border p-2 text-sm ${ponowMm.problem.nierozwiazany
        ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <p className={ponowMm.problem.nierozwiazany ? "text-ranga-zle" : "text-ranga-uwaga"}>
          <b>{ponowMm.problem.nierozwiazany ? "MM w błędzie" : "MM weszło po błędzie — sprawdź stany z Subiektem"}</b>
          {ponowMm.problem.ostatniBlad ? ` · ${ponowMm.problem.ostatniBlad}` : ""}</p>
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
      {bezKorekty.length > 0 && <p className="mt-1 text-sm">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">czeka na korektę</span>
        {" "}MM wyjdzie, gdy dojdą numery korekt do {ile(bezKorekty.length, "zwrotu", "zwrotów", "zwrotów")}.</p>}
      {pominiete.length > 0 && <p className="mt-1 text-sm">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-ranga-uwaga">kosz niekompletny</span>
        {" "}hala pominęła {pominiete.length} poz. — powód przy wierszu niżej.</p>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
      <NaglowekSekcji jako="h3">Zawartość · {k.pozycje.length}</NaglowekSekcji>
      <table className="mt-1 w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-600">
          <th className="py-1.5 pr-2 font-bold">Towar</th>
          <th className="w-20 py-1.5 pr-2 font-bold">Ilość</th>
          <th className="w-28 py-1.5 pr-2 font-bold">Adres</th>
          <th className="w-44 py-1.5 font-bold">Stan</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {k.pozycje.map((p) => <tr key={p.id} className="align-top">
            <td className="py-2 pr-2">
              <div className="flex gap-2">
                <Zdjecie twId={p.twId} rozmiar={36} nazwa={p.nazwa} />
                <div className="min-w-0">{p.symbol && <b className="block"><PrzyciskTowaru twId={p.twId}>{p.symbol}</PrzyciskTowaru></b>}
                  <span className="text-xs text-slate-600">{p.nazwa}</span></div>
              </div></td>
            <td className="py-2 pr-2 font-bold tabular-nums">{p.ilosc}{p.unit ? ` ${p.unit}` : ""}</td>
            <td className="py-2 pr-2">{p.lokFaktyczna
              ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-ranga-ok">{p.lokFaktyczna}</span>
              : <span className="text-xs text-slate-600">{p.lokOczekiwana ?? "—"}</span>}</td>
            <td className="py-2"><StanPozycji p={p} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </>;
}
