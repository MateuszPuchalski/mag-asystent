import React, { useState } from "react";
import { AlarmClock, Eye, Inbox, RefreshCw, Ruler, UserCheck, Wrench } from "lucide-react";
import type { Kategoria, Rozmowa, StanCopilota, StanSkrzynki, WynikPartii } from "../api/typy";
import { Plakietka, czas } from "../ui";
import { NAZWA, NAZWA_DOBORU, NAZWA_KATEGORII } from "./statusy";
import { PasekCopilota, PlakietkaKategorii, doRozpoznania } from "./Copilot";

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

/**
 * Czas oczekiwania po ludzku. Minuty do godziny, potem godziny do doby, dalej
 * dni — bo „czeka 3140 min" nie mówi nic, a „czeka 2 d" mówi wszystko.
 */
export function czekaOd(ms: number): string {
  const minuty = Math.floor(ms / 60_000);
  if (minuty < 60) return `${minuty} min`;
  const godziny = Math.floor(minuty / 60);
  if (godziny < 24) return `${godziny} g ${minuty % 60} min`;
  return `${Math.floor(godziny / 24)} d ${godziny % 24} g`;
}

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
export function Kolejka({ rozmowy, stan, copilot, klasyfikacja, onRozpoznaj = () => {},
  wybranaId, mojeId = null, onWybierz, onOdswiez, laduje, nieswieza }: {
  rozmowy: Rozmowa[];
  stan: StanSkrzynki;
  /** Stan Copilota (§14, etap F). `undefined` = jeszcze nie wiadomo, milcz. */
  copilot?: StanCopilota;
  /* Przebieg ostatniej partii. Kolejka go nie wywołuje — wywołanie mieszka
     w `ekrany/Skrzynka.tsx`, tak jak każdy inny hak zapytania w tym panelu. */
  klasyfikacja?: { trwa: boolean; wynik: WynikPartii | null; blad: string | null };
  onRozpoznaj?: (rozmowyId: number[]) => void;
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
  /* Filtr kategorii jest DRUGIM sitem, nałożonym na kubełek, a nie trzecim
     rzędem kubełków: kubełek mówi „czyje to", kategoria — „o czym to". Zlanie
     tego w jedną listę zmusiłoby agenta do wyboru między dwoma pytaniami,
     na które odpowiada naraz. */
  const [kategoria, setKategoria] = useState<Kategoria | null>(null);
  const wKubelkuTeraz = rozmowy.filter((r) => wKubelku(r, kubelek, mojeId));
  const widoczne = kategoria === null ? wKubelkuTeraz
    : wKubelkuTeraz.filter((r) => r.kopilot?.kategoria === kategoria);

  /* Skład kubełka JEDNYM SPOJRZENIEM (dekalog ergonomii, punkt 1: informacja
     w miejscu, gdzie zapada decyzja). Liczniki liczą się z tego, co widać —
     serwer nie musi ich podawać, bo lista i tak przyjeżdża w całości. */
  const liczniki = new Map<Kategoria, number>();
  for (const r of wKubelkuTeraz) {
    if (!r.kopilot || r.kopilot.nieaktualna) continue;
    liczniki.set(r.kopilot.kategoria, (liczniki.get(r.kopilot.kategoria) ?? 0) + 1);
  }
  const wgLiczby = [...liczniki.entries()].sort((a, b) => b[1] - a[1]);
  return <section className="card flex min-h-0 flex-col overflow-hidden">
    {/* `shrink-0` nad scrollerem i `min-h-0` na nim (0.180.0). Bez tego przy
        węższej kolumnie kubełki zawijają się na trzy rzędy, a lista — jedyny
        blok z bazą 0 — kurczy się do zera. Wzorzec z kolumn zwrotów. */}
    {/* JEDNO PASMO ZAMIAST DWÓCH (0.192.0). Data synchronizacji stała we
        WŁASNYM pasku pod nagłówkiem, a pigułka „Synchronizacja 18:29 · 0 błędów"
        niesie tę samą rzecz w pasku górnym, na każdym ekranie panelu. Pięć
        pasm sterujących nad pierwszym wierszem zjadało ćwierć wysokości
        kolumny — a kolumna kolejki istnieje po to, żeby pokazywać PYTANIA.

        Dlaczego data w ogóle tu jest: pusta lista o 9:00 znaczy co innego, gdy
        synchronizator stanął o 6:00, a co innego, gdy przebiegł minutę temu.
        Tego zdania nie usuwamy — schodzi obok tytułu, w rozmiar podpisu. */}
    <header className="flex shrink-0 items-center gap-2 border-b p-4">
      <Inbox size={18} />
      <div className="mr-auto min-w-0">
        <b>Rozmowy</b>
        <p className="truncate text-xs font-normal text-slate-500">
          synchronizacja {czas(stan.ostatniaSynchronizacja)}
          {stan.bledy > 0 && <span className="ml-1 font-bold text-amber-700">· błędów: {stan.bledy}</span>}
        </p>
      </div>
      {nieswieza && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-ranga-zle">
        STAN Z {czas(stan.ostatniaSynchronizacja).slice(-8, -3) || "—"}</span>}
      <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOdswiez}
        title="Odśwież" aria-label="Odśwież"><RefreshCw size={16} /></button>
    </header>
    <div className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-2">
      {KUBELKI.map((k) => <button key={k.klucz} onClick={() => setKubelek(k.klucz)}
        aria-pressed={kubelek === k.klucz}
        className={`rounded px-2 py-1 text-xs font-semibold ${kubelek === k.klucz
          ? "bg-wertis-ink text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
        {k.etykieta} <span className="font-normal">
          {rozmowy.filter((r) => wKubelku(r, k.klucz, mojeId)).length}</span></button>)}
    </div>
    <PasekCopilota stan={copilot} kandydaci={doRozpoznania(wKubelkuTeraz)}
      trwa={klasyfikacja?.trwa} wynik={klasyfikacja?.wynik} blad={klasyfikacja?.blad}
      onRozpoznaj={onRozpoznaj} />
    {/* Pasek liczników zamiast PRZESTAWIANIA kolejki i to jest decyzja.
        Dzisiejsze klucze kolejności — ręczna flaga „pilne" i czas oczekiwania
        klienta — są FAKTAMI; kategoria jest przypuszczeniem maszyny, a jedna
        pomyłka klasyfikatora zakopałaby prawdziwe pytanie na dole listy tak,
        że nikt by tego nie zauważył. Agent widzi skład skrzynki i sam wybiera,
        co bierze. Regułę kolejności wolno dołożyć dopiero wtedy, gdy pomiar
        trafności ją uzasadni (etap G). */}
    {wgLiczby.length > 0 && <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5 text-xs">
      {wgLiczby.map(([k, ile]) => <button key={k} type="button"
        aria-pressed={kategoria === k}
        onClick={() => setKategoria(kategoria === k ? null : k)}
        className={`rounded px-1.5 py-0.5 font-semibold ${kategoria === k
          ? "bg-violet-700 text-white" : "bg-violet-50 text-violet-800 hover:bg-violet-100"}`}>
        {NAZWA_KATEGORII[k]} <span className="font-normal">{ile}</span></button>)}
      {kategoria !== null && <button type="button" className="ml-auto text-slate-500 underline"
        onClick={() => setKategoria(null)}>pokaż wszystkie</button>}
    </div>}
    <div className={`min-h-0 flex-1 overflow-y-auto ${nieswieza ? "opacity-60" : ""}`}>
      {laduje && <p className="p-4 text-sm text-slate-500">Wczytuję…</p>}
      {!laduje && !rozmowy.length &&
        <p className="p-4 text-sm text-slate-500">Brak rozmów w zsynchronizowanej skrzynce.</p>}
      {/* Pusty KUBEŁEK to co innego niż pusta skrzynka: „nic nie czeka na
          mnie" nie znaczy „nic nie przyszło", a jedno zdanie mniej kazałoby
          agentowi zgadywać, czy synchronizacja stanęła. */}
      {/* Pusty KUBEŁEK to co innego niż pusty FILTR. „Zajrzyj do Wszystkie"
          przy włączonym filtrze kategorii wysłałoby agenta w złą stronę —
          rozmowy są, tylko sito je zasłania. */}
      {!laduje && rozmowy.length > 0 && !widoczne.length && kategoria !== null &&
        <p className="p-4 text-sm text-slate-500">
          Nic w kategorii „{NAZWA_KATEGORII[kategoria]}" w tym kubełku.</p>}
      {!laduje && rozmowy.length > 0 && !widoczne.length && kategoria === null &&
        <p className="p-4 text-sm text-slate-500">Ten kubełek jest pusty — zajrzyj do „Wszystkie".</p>}
      {widoczne.map((r) => <button key={r.id} onClick={() => onWybierz(r.id)}
        aria-current={wybranaId === r.id}
        className={`block w-full border-b p-4 text-left hover:bg-slate-50 ${
          wybranaId === r.id ? "border-l-[3px] border-l-wertis-amber bg-amber-50" : ""}`}>
        {/* ── CO CZYTA SIĘ PIERWSZE (0.192.0) ────────────────────────────
            Do 0.191.1 najgrubszym drukiem w wierszu stał LOGIN KUPUJĄCEGO,
            a pytanie leżało pod nim, mniejsze i szare. Login Allegro nie mówi
            nic — „Kupujący 44300444" to nie jest osoba, którą się zna. Triaż
            robi się po TREŚCI, więc treść dostała pierwszy plan, a login zszedł
            do podpisu obok czasu. Makieta rysowała to tak od początku: klient
            13,5 px, a nad nim temat rozmowy.

            Plakietki zostają na górze, bo odpowiadają na pytanie zadawane
            PRZED czytaniem: czy tę rozmowę w ogóle brać. */}
        <div className="flex items-center gap-2">
          {/* PILNE przed statusem: „co się pali" czyta się przed „co z tym
              zrobiono". Flagę stawia człowiek — patrz `ustawPriorytet`. */}
          {r.priorytet === "pilny" &&
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-ranga-zle">
              PILNE</span>}
          {/* KROPKA, NIE SŁOWO (0.192.0). Stało tu „NOWE", a obok, w plakietce
              statusu, „NOWA" — dwa różne fakty jednym wyrazem. „Nowa" znaczy
              „sprawy nikt nie tknął", „nowe" znaczyło „Allegro trzyma wątek
              jako nieodczytany". Czytało się to jak powtórzenie, a przy okazji
              zjadało szerokość, przez którą plakietka statusu łamała się na
              dwie linie. Kropka to znak nieprzeczytanego znany ze wszystkich
              skrzynek — nazwę niesie `title` i tekst dla czytnika ekranu. */}
          {r.nieprzeczytana && <span title="Nieprzeczytana wiadomość"
            className="h-2 w-2 shrink-0 rounded-full bg-wertis-amber">
            <span className="sr-only">NOWE</span></span>}
          <Plakietka status={r.status}>{NAZWA[r.status]}</Plakietka>
          {/* Czas OCZEKIWANIA, nie data: „czeka 2 g" odpowiada na pytanie
              „za co się wziąć", a data każe je dopiero policzyć w głowie.
              Stoi w prawym rogu górnej linii, bo razem z PILNE tworzy jedyną
              parę sygnałów, po której układa się kolejność pracy (§10.2). */}
          {r.czekaOdMs !== null && <span className={`ml-auto shrink-0 text-xs font-bold ${
            r.poTerminie ? "text-ranga-zle" : "text-slate-600"}`}>
            czeka {czekaOd(r.czekaOdMs)}</span>}
        </div>
        {/* Podgląd to słowa KLIENTA (0.166.0). Gdy klient nic nie napisał, stoi
            nasza wiadomość — ale z podpisem, bo bez niego czytałoby się ją jak
            pytanie. Autoodpowiedź konta Allegro wyglądała tak przez pół roku. */}
        <p className="mt-1.5 line-clamp-2 text-sm font-medium text-slate-800">
          {!r.ostatniaOdKlienta && r.ostatniaWiadomosc &&
            <span className="font-semibold text-slate-400">Biuro: </span>}
          {r.ostatniaWiadomosc}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-500">{r.klient}</span>
          <span>{czas(r.ostatniaWiadomoscAt)}</span>
          {/* Liczba DOPISKÓW klienta od naszej odpowiedzi. Nie nazywamy jej
              „nieprzeczytane": tego Allegro nie podaje, a ekran nie ma prawa
              obiecywać pomiaru, którego nie robi. */}
          {r.nowychOdOdpowiedzi > 1 &&
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
              {r.nowychOdOdpowiedzi} dopiski klienta</span>}
          {r.zadanieWToku && <span className="flex items-center gap-1 font-semibold text-slate-600">
            <Ruler size={12} />zadanie w toku</span>}
          {/* Status DOBORU (§10.2, E1). `not_started` i `not_applicable` milczą:
              plakietka „nierozpoczęty" na każdym wierszu nie mówiłaby niczego,
              a „nie dotyczy" to wiersz, przy którym doboru NIE trzeba robić. */}
          {r.dobor !== "not_started" && r.dobor !== "not_applicable" &&
            <span className={`flex items-center gap-1 font-semibold ${
              r.dobor === "confirmed" ? "text-emerald-700"
                : r.dobor === "missing_information" ? "text-ranga-zle" : "text-amber-700"}`}>
              <Wrench size={12} />{NAZWA_DOBORU[r.dobor]}</span>}
          {/* Plakietka Copilota PO statusie doboru: dobór jest faktem
              zapisanym przez człowieka, kategoria — przypuszczeniem maszyny,
              a kolejność na wierszu ma odpowiadać wadze. */}
          {r.kopilot && <PlakietkaKategorii kopilot={r.kopilot} />}
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
