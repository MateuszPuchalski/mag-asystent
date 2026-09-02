import React, { useState } from "react";
import { AlarmClock, Eye, Inbox, RefreshCw, UserCheck } from "lucide-react";
import type { Rozmowa, StanSkrzynki } from "../api/typy";
import { Plakietka, czas } from "../ui";
import { NAZWA } from "./statusy";

/* Kubełki kolejki wprost z §10.1: „Nieprzypisane, Moje, Oczekujące, Po
   terminie". Filtr jest po stronie EKRANU, bo lista i tak przyjeżdża w
   całości — dokładanie parametru do trasy nic by dziś nie oszczędziło,
   a rozmnożyłoby reguły przynależności na dwie strony.

   „Po terminie" liczy SERWER (`poTerminie`). Ekran tej reguły nie wyprowadza
   drugi raz — kubełki zwrotów już raz pokazały, czym kończą się dwie kopie
   jednej definicji: dwiema różnymi kolejkami przy jednym liczniku. */
type Kubelek = "wszystkie" | "nieprzypisane" | "moje" | "oczekujace" | "poTerminie";

const KUBELKI: Array<{ klucz: Kubelek; etykieta: string }> = [
  { klucz: "wszystkie", etykieta: "Wszystkie" },
  { klucz: "nieprzypisane", etykieta: "Nieprzypisane" },
  { klucz: "moje", etykieta: "Moje" },
  { klucz: "oczekujace", etykieta: "Oczekujące" },
  { klucz: "poTerminie", etykieta: "Po terminie" },
];

/* Rozmowa zamknięta i spam znikają z kolejki roboczej, ale NIE z panelu:
   widać je w „Wszystkie". Ukrycie ich wszędzie znaczyłoby, że pomyłkowego
   zamknięcia nie da się cofnąć — a nikt nie szuka sprawy, której nie ma. */
const ZESZLA_Z_BIURKA = ["closed", "spam"];

function wKubelku(r: Rozmowa, kubelek: Kubelek, mojeId: number | null): boolean {
  if (kubelek === "wszystkie") return true;
  if (kubelek === "poTerminie") return r.poTerminie;
  if (ZESZLA_Z_BIURKA.includes(r.status)) return false;
  if (kubelek === "nieprzypisane") return r.wlascicielId === null;
  if (kubelek === "moje") return mojeId !== null && r.wlascicielId === mojeId;
  return r.status === "waiting_for_customer" || r.status === "waiting_for_internal"
    || r.status === "snoozed";
}

/* Kolejka pokazuje moment ostatniej synchronizacji, bo pusta lista o 9:00
   znaczy co innego, gdy synchronizator stanął o 6:00, a co innego, gdy
   przebiegł minutę temu. Bez tej daty ekran kłamałby ciszą. */
export function Kolejka({ rozmowy, stan, wybranaId, mojeId = null, onWybierz, onOdswiez,
  laduje, nieswieza }: {
  rozmowy: Rozmowa[];
  stan: StanSkrzynki;
  wybranaId: number | null;
  /** Bez tego „Moje" nie ma znaczenia — kubełek zostaje wtedy pusty, nie mylący. */
  mojeId?: number | null;
  onWybierz: (id: number) => void;
  onOdswiez: () => void;
  laduje: boolean;
  /* Kolejka nieświeża wygląda inaczej, bo znaczy co innego. Pusta lista przy
     stojącym synchronizatorze to nie „brak pytań", tylko „nie wiem". */
  nieswieza?: boolean;
}) {
  const [kubelek, setKubelek] = useState<Kubelek>("wszystkie");
  const widoczne = rozmowy.filter((r) => wKubelku(r, kubelek, mojeId));
  return <section className="card flex min-h-0 flex-col overflow-hidden">
    {/* `shrink-0` nad scrollerem i `min-h-0` na nim (0.180.0). Bez tego przy
        węższej kolumnie kubełki zawijają się na trzy rzędy, a lista — jedyny
        blok z bazą 0 — kurczy się do zera. Wzorzec z kolumn zwrotów. */}
    <header className="flex shrink-0 items-center gap-2 border-b p-4">
      <Inbox size={18} /><b className="mr-auto">Rozmowy</b>
      {nieswieza && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-ranga-zle">
        STAN Z {czas(stan.ostatniaSynchronizacja).slice(-8, -3) || "—"}</span>}
      <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOdswiez}
        title="Odśwież" aria-label="Odśwież"><RefreshCw size={16} /></button>
    </header>
    <p className="shrink-0 border-b bg-slate-50 px-4 py-2 text-xs text-slate-500">
      Ostatnia synchronizacja: {czas(stan.ostatniaSynchronizacja)}
      {stan.bledy > 0 && <span className="ml-2 font-bold text-amber-700">błędów: {stan.bledy}</span>}
    </p>
    <div className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-2">
      {KUBELKI.map((k) => <button key={k.klucz} onClick={() => setKubelek(k.klucz)}
        aria-pressed={kubelek === k.klucz}
        className={`rounded px-2 py-1 text-xs font-semibold ${kubelek === k.klucz
          ? "bg-wertis-ink text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
        {k.etykieta} <span className="font-normal">
          {rozmowy.filter((r) => wKubelku(r, k.klucz, mojeId)).length}</span></button>)}
    </div>
    <div className={`min-h-0 flex-1 overflow-y-auto ${nieswieza ? "opacity-60" : ""}`}>
      {laduje && <p className="p-4 text-sm text-slate-500">Wczytuję…</p>}
      {!laduje && !rozmowy.length &&
        <p className="p-4 text-sm text-slate-500">Brak rozmów w zsynchronizowanej skrzynce.</p>}
      {/* Pusty KUBEŁEK to co innego niż pusta skrzynka: „nic nie czeka na
          mnie" nie znaczy „nic nie przyszło", a jedno zdanie mniej kazałoby
          agentowi zgadywać, czy synchronizacja stanęła. */}
      {!laduje && rozmowy.length > 0 && !widoczne.length &&
        <p className="p-4 text-sm text-slate-500">Ten kubełek jest pusty — zajrzyj do „Wszystkie".</p>}
      {widoczne.map((r) => <button key={r.id} onClick={() => onWybierz(r.id)}
        aria-current={wybranaId === r.id}
        className={`block w-full border-b p-4 text-left hover:bg-slate-50 ${
          wybranaId === r.id ? "border-l-[3px] border-l-wertis-amber bg-amber-50" : ""}`}>
        <div className="flex items-center gap-2">
          <b className="truncate">{r.klient}</b>
          {r.nieprzeczytana &&
            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold">NOWE</span>}
          <Plakietka status={r.status}>{NAZWA[r.status]}</Plakietka>
        </div>
        {/* Podgląd to słowa KLIENTA (0.166.0). Gdy klient nic nie napisał, stoi
            nasza wiadomość — ale z podpisem, bo bez niego czytałoby się ją jak
            pytanie. Autoodpowiedź konta Allegro wyglądała tak przez pół roku. */}
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">
          {!r.ostatniaOdKlienta && r.ostatniaWiadomosc &&
            <span className="font-semibold text-slate-400">Biuro: </span>}
          {r.ostatniaWiadomosc}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>{czas(r.ostatniaWiadomoscAt)}</span>
          {r.wlasciciel && <span className="flex items-center gap-1 font-semibold text-slate-600">
            <UserCheck size={12} />{r.wlasciciel}</span>}
          {r.poTerminie && <span className="flex items-center gap-1 font-bold text-ranga-uwaga">
            <AlarmClock size={12} />po terminie</span>}
          {/* Kolega SIEDZI przy tym pytaniu (0.159.0). Bez tego znaku dwóch
              agentów pisze tę samą odpowiedź, a dowiadują się o tym dopiero
              przy wysyłce — czyli po straconej pracy. */}
          {r.oglada && r.oglada.userId !== mojeId &&
            <span className="flex items-center gap-1 font-semibold text-violet-700">
              <Eye size={12} />{r.oglada.name}</span>}
        </div>
      </button>)}
      {nieswieza && <p className="border-t bg-red-50 px-4 py-2 text-xs text-red-800">
        Dalsze wiersze mogą istnieć w Allegro i nie zostały jeszcze pobrane.</p>}
    </div>
  </section>;
}
