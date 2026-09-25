import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  useAktualizacja, useSprawdzWydania, useZlecAktualizacje, type SekcjaZmian, type StanAktualizacji,
} from "../api/ustawienia";
import { Blad, Pole, Przycisk, czas } from "../ui";
import { KartaWgladu } from "../ui/wglad";

/* ── Aktualizacja serwera (0.492.0) ─────────────────────────────────────
   Zamiast pulpitu zdalnego i `-Aktualizuj` w PowerShellu: wybór wydania,
   hasło, jeden przycisk. Serwer tylko ZLECA — wykonuje zadanie Harmonogramu
   (`instalator/zlecenie.ps1`), bo aktualizacja zatrzymuje usługę serwera,
   a razem z nią wszystko, co serwer by uruchomił.

   JEDNA DECYZJA NA WEJŚCIU. Domyślnie wybrane jest najnowsze wydanie z paczką;
   starsze są pod listą rozwijaną dla tego, kto wie, po co mu one. Zmiany
   widać od razu, bez klikania — czyta się je PRZED decyzją, nie po.

   HASŁO PONOWNIE, choć admin jest zalogowany. Panel zostawiony otwarty na
   biurku nie może wymienić wersji programu za jednym kliknięciem obcego.

   „[wymaga działania]" W ZMIANACH blokuje przycisk do odhaczenia. Takie
   wydanie potrzebuje czegoś poza przyciskiem — kliknięcie bez przeczytania
   kosztuje wdrożenie, które wstaje, ale nie działa.

   TYLKO ADMIN, i karta dla biura nie istnieje wcale — ten sam wzór co
   konfiguracja obok. Otwarcie karty niczego nie zapisuje; „Sprawdź teraz"
   stoi za przyciskiem, bo serwer i tak pyta GitHuba co godzinę. */

const ETAP: Record<string, { zdanie: string; klasa: string }> = {
  trwa: { zdanie: "trwa", klasa: "text-slate-700" },
  gotowe: { zdanie: "udana", klasa: "text-ranga-ok" },
  blad: { zdanie: "nieudana, serwer wrócił do poprzedniej wersji", klasa: "text-ranga-zle font-bold" },
};

function Ostatnia({ s }: { s: StanAktualizacji }) {
  const o = s.ostatnia;
  if (!o) return null;
  const e = ETAP[o.etap] ?? ETAP.trwa!;
  return <p className="mb-3 text-sm">
    Ostatnia aktualizacja do <b>{o.wersja}</b>: <span className={e.klasa}>{e.zdanie}</span>
    {o.kto && <> · zlecił(a) {o.kto}</>} · {czas(o.do ?? o.od)}.
    {o.etap === "blad" && <> Dziennik: <code>server\data\aktualizacja\ostatnia.log</code>.</>}
  </p>;
}

/* Jedno zdanie o automacie: w jakim trybie jest i co zrobi. To samo zdanie
   kieruje taktem na serwerze, więc panel nie zgaduje. Zmiana trybu idzie
   przez kartę konfiguracji obok — nie ma tu drugiego miejsca na tę decyzję. */
const TRYB: Record<string, string> = {
  noc: "w nocy", zaraz: "gdy nikt nie pracuje", wylaczona: "wyłączona",
};

function Automat({ a }: { a: NonNullable<StanAktualizacji["auto"]> }) {
  const wiek = a.dojrzaloscGodz > 0 ? `, wydanie starsze niż ${a.dojrzaloscGodz} h` : "";
  const szczegoly = a.tryb === "wylaczona" ? ""
    : `${a.tryb === "noc" ? ` ${a.okno.od}:00–${a.okno.do}:00` : ""}${wiek}${a.kanarek ? ", po kanarku" : ""}`;
  return <p className="mb-3 text-sm">
    <b>Automatycznie:</b> {TRYB[a.tryb] ?? a.tryb}{szczegoly}. {a.powod}
    {" "}<span className="text-slate-600">Tryb zmienisz w konfiguracji (AKTUALIZACJA_AUTO).</span>
  </p>;
}

/* ── Pasek postępu (0.504.0) ──────────────────────────────────────────
   Kroki są PRAWDZIWE: zapisuje je instalator (`Set-WertisPostep`), a serwer
   podaje dalej. Żadnych procentów liczonych z zegara — pobieranie zależy od
   łącza, więc pasek z czasu kłamałby dokładnie wtedy, gdy ktoś na niego
   patrzy. Zegar obok mówi tylko, ile już trwa.

   W kroku zamiany serwer nie odpowiada. Karta zostaje wtedy przy ostatnim
   znanym kroku i mówi, że to norma, zamiast pokazywać czerwony błąd. */
function Postep({ s, bezOdpowiedzi }: { s: StanAktualizacji; bezOdpowiedzi: boolean }) {
  const p = s.ostatnia?.etap === "trwa" ? s.ostatnia.postep : undefined;
  const z = p?.z ?? 4;
  const krok = p?.krok ?? 0;
  const opis = p ? `Krok ${krok} z ${z}: ${p.nazwa}` : "Przygotowanie aktualizacji";
  const trwaOd = useTrwa(s.ostatnia?.etap === "trwa" ? s.ostatnia.od : undefined);
  return <div className="mb-3">
    <div role="progressbar" aria-label="Postęp aktualizacji" aria-valuemin={0} aria-valuemax={z}
      aria-valuenow={krok} aria-valuetext={opis} className="flex gap-1">
      {Array.from({ length: z }, (_, i) => <span key={i} className={`h-2 flex-1 rounded ${
        i + 1 < krok ? "bg-ranga-ok" : i + 1 === krok ? "animate-pulse bg-slate-700" : "bg-slate-200"}`} />)}
    </div>
    <p className="mt-1 text-sm font-bold">{opis}{trwaOd && <span className="font-normal text-slate-600"> · {trwaOd}</span>}</p>
    {bezOdpowiedzi && <p className="text-sm text-slate-600">Serwer chwilowo nie odpowiada. Przy zamianie wersji
      to norma; karta pyta dalej co pięć sekund.</p>}
  </div>;
}

/** „m:ss" od startu, odświeżane co sekundę. To czas TRWANIA, nie data — stąd
 *  nie przez `czas()`. */
function useTrwa(od: string | undefined): string | null {
  const [teraz, setTeraz] = useState(() => Date.now());
  useEffect(() => {
    if (!od) return;
    const t = setInterval(() => setTeraz(Date.now()), 1000);
    return () => clearInterval(t);
  }, [od]);
  if (!od) return null;
  const sek = Math.max(0, Math.floor((teraz - Date.parse(od)) / 1000));
  return Number.isNaN(sek) ? null : `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, "0")}`;
}

function Zmiany({ zmiany }: { zmiany: SekcjaZmian[] }) {
  if (!zmiany.length) return null;
  return <div className="mb-3 max-h-80 overflow-y-auto rounded border">
    {zmiany.map((z) => <section key={z.wersja} className="border-b px-3 py-2 last:border-b-0">
      <h3 className="text-sm font-bold text-slate-700">
        {z.tytul}
        {z.wymagaDzialania && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-ranga-zle">
          wymaga działania</span>}
      </h3>
      <p className="whitespace-pre-wrap text-sm text-slate-700">{z.tresc}</p>
    </section>)}
  </div>;
}

export function Aktualizacja({ admin }: { admin: boolean }) {
  const akt = useAktualizacja(admin);
  const sprawdz = useSprawdzWydania();
  const zlec = useZlecAktualizacje();
  const [wybrana, setWybrana] = useState<string | null>(null);
  const [haslo, setHaslo] = useState("");
  const [przeczytane, setPrzeczytane] = useState(false);
  /* Wersja, na której serwer stał przy otwarciu karty. Gdy się zmieni,
     przeglądarka trzyma STARY panel — trzeba go przeładować. */
  const przyOtwarciu = useRef<string | null>(null);
  if (!admin) return null;

  const s = akt.data;
  if (s && przyOtwarciu.current === null) przyOtwarciu.current = s.obecna;
  const zPaczka = (s?.wydania ?? []).filter((w) => w.maPaczke);
  const cel = wybrana ?? zPaczka[0]?.wersja ?? null;
  /* Zmiany przychodzą od obecnej do najnowszej; do starszego celu ucinamy. */
  const zmiany = (s?.zmiany ?? []).filter((z) => !cel || porownaj(z.wersja, cel) <= 0);
  const wymaga = zmiany.some((z) => z.wymagaDzialania);
  const trwa = !!s && (s.czekaZlecenie || s.ostatnia?.etap === "trwa");
  const nowaWersja = !!s && przyOtwarciu.current !== null && s.obecna !== przyOtwarciu.current;

  return <KartaWgladu id="karta-aktualizacja" tytul="Aktualizacja serwera"
    opis={<>Serwer pracuje na <b>{s?.obecna ?? "…"}</b>. Sprawdzone: {czas(s?.sprawdzono)}. Aktualizacja
      zatrzymuje serwer na minutę lub dwie; nieudana wraca sama do obecnej wersji.</>}
    akcje={<Przycisk disabled={sprawdz.isPending} onClick={() => sprawdz.mutate()}>
      <RefreshCw size={16} />Sprawdź teraz</Przycisk>}>
    {nowaWersja && <p className="mb-3 rounded bg-slate-100 px-3 py-2 text-sm">
      Serwer pracuje już na <b>{s!.obecna}</b>. <Przycisk className="ml-2" onClick={() => location.reload()}>
        Odśwież panel</Przycisk>
    </p>}
    {s && <Ostatnia s={s} />}
    {s?.auto && <Automat a={s.auto} />}
    {trwa && s && <Postep s={s} bezOdpowiedzi={akt.isError} />}
    {s?.bladSprawdzenia && <p className="mb-3 text-sm text-ranga-zle">
      Nie udało się zapytać o wydania: {s.bladSprawdzenia}</p>}
    {/* Serwer pyta GitHuba pierwszy raz do dwudziestu minut po starcie
        (rozrzut `uruchomTakt`). Pusta lista przed tym to brak wiedzy, nie
        „najnowsza wersja". */}
    {s && !trwa && (s.wydania.length === 0
      ? <p className="text-sm text-slate-600">{s.sprawdzono ? "To najnowsza wersja."
          : "Serwer jeszcze nie sprawdzał wydań od startu — kliknij „Sprawdź teraz”."}</p>
      : <>
        <Zmiany zmiany={zmiany} />
        {!zPaczka.length && <p className="mb-3 text-sm text-slate-600">Nowsze wydanie nie ma jeszcze paczki —
          CI dokłada ją kilka minut po scaleniu.</p>}
        {zPaczka.length > 0 && <form aria-label="Zlecenie aktualizacji" className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            /* Hasło znika po udanym zleceniu — nie ma po co leżeć w pamięci karty. */
            if (cel) zlec.mutate({ wersja: cel, haslo }, { onSuccess: () => setHaslo("") });
          }}>
          {zPaczka.length > 1 && <select aria-label="Wersja docelowa" className="field w-auto"
            value={cel ?? ""} onChange={(e) => { setWybrana(e.target.value); setPrzeczytane(false); }}>
            {zPaczka.map((w) => <option key={w.wersja} value={w.wersja}>{w.wersja}</option>)}
          </select>}
          <Pole aria-label="Twoje hasło" type="password" autoComplete="current-password" className="w-48"
            placeholder="Twoje hasło" value={haslo} onChange={(e) => setHaslo(e.target.value)} />
          {wymaga && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={przeczytane} onChange={(e) => setPrzeczytane(e.target.checked)} />
            Przeczytałem(-am), co wymaga działania
          </label>}
          <Przycisk wariant="glowny" type="submit"
            disabled={!!s.blokada || !haslo || (wymaga && !przeczytane) || zlec.isPending}>
            Zaktualizuj do {cel}</Przycisk>
        </form>}
        {s.blokada && <p className="mt-2 text-sm text-slate-600">{s.blokada}</p>}
      </>)}
    {/* W trakcie serwer znika na chwilę; nieudane odpytanie to wtedy norma, nie błąd. */}
    <Blad>{zlec.error?.message ?? sprawdz.error?.message ?? (trwa ? undefined : akt.error?.message)}</Blad>
  </KartaWgladu>;
}

/** Liczbowo, nie tekstowo — po napisach „0.99.0" wychodzi nowsze niż „0.100.0". */
function porownaj(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
