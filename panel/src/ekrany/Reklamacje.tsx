import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ShieldQuestion } from "lucide-react";
import {
  useNotatka, useProwadze, useReklamacja, useReklamacje, useSynchronizuj,
} from "../api/reklamacje";
import type { KubelekReklamacji, Reklamacja, StanReklamacji } from "../api/typy";
import { Blad, Karta, Przycisk, Pusto, SIATKA_TRZECH_KOLUMN } from "../ui";
import { KUBELKI, Kolejka } from "../reklamacje/Kolejka";
import { Czat } from "../reklamacje/Czat";
import { Dowody } from "../reklamacje/Dowody";

/* ── Ekran reklamacji (0.222.0) ──────────────────────────────────────────────
   Trzy kolumny, jak skrzynka i jak zwroty — trzy ekrany obsługi mają mieć
   jeden nawyk, nie trzy.

   PRZYROST PIERWSZY CZYTA. Odpowiedź w czacie i formalny werdykt wysyła się
   na razie w Centrum Sprzedaży, a ekran mówi to wprost pod rozmową. Zdanie
   o tym, czego panel NIE robi, jest tu tak samo potrzebne jak sama kolejka:
   bez niego puste miejsce pod czatem obiecywałoby odpowiedź.

   Zysk przyrostu jest jeden i mierzalny: sprawy czekające na decyzję stoją
   uszeregowane po terminie, który podaje Allegro. Do tej pory nie stały nigdzie.

   Klawiatura DZIAŁA JUŻ TERAZ w tej części, która niczego nie zapisuje:
   strzałki chodzą po kolejce, cyfry przełączają kubełek. Odruch buduje się od
   pierwszego wydania, a nie po dołożeniu zapisu.                            */

/* Statusy synchronizacji po polsku. Słownik z §7 mówi je po angielsku, bo
   dzieli je ze skrzynką i ze zwrotami — a pasek czyta człowiek przy biurku. */
const STANY: Record<StanReklamacji["status"], string> = {
  current: "działa",
  delayed: "opóźniona",
  rate_limited: "wstrzymana limitem Allegro",
  authentication_error: "odmowa logowania do Allegro",
  failed: "nie działa",
};

/**
 * Ile spraw NIE WESZŁO do tej kolejki.
 *
 * Bezpiecznik stron urywa listę cicho: przebieg kończy się sukcesem, a reszta
 * zostaje po tamtej stronie. Kolejka ustawia się według terminu decyzji, więc
 * brakujące wiersze byłyby w większości tymi najbardziej spóźnionymi — czyli
 * dokładnie tymi, dla których ten ekran istnieje.
 *
 * Zero i `null` MILCZĄ: zero znaczy „lista skończyła się sama", `null` — że
 * Allegro nie podało liczby.
 */
function PasekOgona({ stan }: { stan: StanReklamacji }) {
  if (!stan.pozostaloDoPobrania) return null;
  return <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
    <b>Ta kolejka nie jest kompletna: {stan.pozostaloDoPobrania} spraw czeka
      po stronie Allegro.</b>{" "}
    Ostatni przebieg stanął na bezpieczniku stron. Dociągną się kolejnymi
    przebiegami — ale dopóki liczba tu stoi, najstarszych reklamacji może
    w tej liście nie być.
  </div>;
}

/** Pasek synchronizacji z przyciskiem — mówi też, ile dyskusji odsialiśmy. */
function PasekSynchronizacji({ stan, trwa, blad, onSynchronizuj }: {
  stan: StanReklamacji; trwa: boolean; blad: string; onSynchronizuj: () => void;
}) {
  const zle = stan.status !== "current";
  return <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg
    px-3 py-2 text-xs ${zle ? "border border-red-200 bg-red-50 text-red-900"
      : "border border-slate-200 bg-slate-50 text-slate-600"}`}>
    <span>Synchronizacja reklamacji: <b>{STANY[stan.status]}</b>
      {stan.kodOstatniegoBledu ? `, kod ${stan.kodOstatniegoBledu}` : ""}</span>
    {/* Liczba odsianych dyskusji NIE JEST błędem — to zakres panelu, decyzja
        właściciela. Stoi tu, żeby nikt nie szukał „zaginionej" reklamacji,
        która nigdy reklamacją nie była. */}
    {stan.dyskusjiPominietych !== null && stan.dyskusjiPominietych > 0 &&
      <span title="Panel prowadzi wyłącznie reklamacje; dyskusje zostają w Allegro">
        dyskusji pominiętych: <b className="tabular-nums">{stan.dyskusjiPominietych}</b></span>}
    {blad && <span className="w-full text-red-800">{blad}</span>}
    <Przycisk className="ml-auto !px-2 !py-1 !text-xs" disabled={trwa} onClick={onSynchronizuj}>
      {trwa ? "Pobieram…" : "Synchronizuj teraz"}
    </Przycisk>
  </div>;
}

/** Kody, po których człowiek szuka reklamacji — wszystkie, jakie sprawa niesie. */
const kody = (r: Reklamacja) => [r.numer, r.externalId, r.orderId, r.kupujacyLogin]
  .filter((k): k is string => Boolean(k)).map((k) => k.toLowerCase());

export function Reklamacje() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<KubelekReklamacji | null>("decyzja");
  const [fraza, setFraza] = useState("");
  const [bladZapisu, setBladZapisu] = useState("");
  const [bladSync, setBladSync] = useState("");

  const { data, isLoading, error } = useReklamacje();
  const prowadze = useProwadze();
  const notatka = useNotatka();
  const synchronizuj = useSynchronizuj();
  const trwa = prowadze.isPending || notatka.isPending;

  const wKubelku = useMemo(() => kubelek === null
    ? (data?.reklamacje ?? [])
    : (data?.reklamacje ?? []).filter((r) => r.kubelek === kubelek), [data, kubelek]);

  /* Filtr liczy się TUTAJ, w pamięci ekranu — tą samą drogą co filtr kubełka
     i z tego samego powodu: lista przyjeżdża w całości, bo spraw w pracy są
     dziesiątki, nie tysiące. */
  const pasujace = useMemo(() => {
    const f = fraza.trim().toLowerCase();
    if (!f) return null;
    return (data?.reklamacje ?? []).filter((r) => kody(r).some((k) => k.includes(f)));
  }, [data, fraza]);

  const widoczne = pasujace ?? wKubelku;
  const wybrana = id ? Number(id) : null;
  const reklamacja = data?.reklamacje.find((r) => r.id === wybrana) ?? null;
  const szczegol = useReklamacja(wybrana);

  /* Wejście z paska adresu na sprawę z innego kubełka ma pokazać TĘ sprawę,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (reklamacja && kubelek !== null && reklamacja.kubelek !== kubelek) {
      setKubelek(reklamacja.kubelek);
    }
  }, [reklamacja?.id]);

  /**
   * Przełączenie kubełka PRZESTAWIA TEŻ KURSOR.
   *
   * Bez tego jeden klawisz zmieniałby listę, a zaznaczenie zostawałoby na
   * sprawie z poprzedniego kubełka — środkowa kolumna pokazywałaby wtedy
   * pytanie nowego kubełka nad rozmową ze starego. Ta sama poprawka co przy
   * zwrotach.
   */
  const przelacz = (k: KubelekReklamacji | null) => {
    setKubelek(k);
    setFraza("");
    const pierwsza = (data?.reklamacje ?? []).find((r) => k === null || r.kubelek === k);
    nawiguj(pierwsza ? `/obsluga/reklamacje/${pierwsza.id}` : "/obsluga/reklamacje");
  };

  /* Kursor chodzi po liście WIDOCZNEJ, nie po kubełku: przy włączonym filtrze
     strzałka ma iść do następnego wyniku, a nie do sprawy schowanej przed
     oczami. */
  const idz = (o: number) => {
    if (!widoczne.length) return;
    const i = widoczne.findIndex((r) => r.id === wybrana);
    const nast = widoczne[Math.min(widoczne.length - 1, Math.max(0, (i < 0 ? 0 : i) + o))];
    if (nast) nawiguj(`/obsluga/reklamacje/${nast.id}`);
  };

  /* Skróty milkną, gdy ognisko stoi w polu tekstowym — inaczej cyfra wpisana
     w notatkę przełączałaby kubełek. */
  useEffect(() => {
    const wPolu = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"
        || el.isContentEditable));
    };
    const nasluch = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || wPolu(e.target)) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idz(-1); }
      else if (/^[1-3]$/.test(e.key)) przelacz(KUBELKI[Number(e.key) - 1].id);
      else if (e.key === "4") przelacz(null);
    };
    window.addEventListener("keydown", nasluch);
    return () => window.removeEventListener("keydown", nasluch);
  });

  if (error) return <Blad>{(error as Error).message}</Blad>;

  const opis = KUBELKI.find((k) => k.id === kubelek);

  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    {data?.stan && <PasekOgona stan={data.stan} />}
    {data?.stan && <PasekSynchronizacji stan={data.stan} blad={bladSync}
      trwa={synchronizuj.isPending}
      onSynchronizuj={() => {
        setBladSync("");
        synchronizuj.mutate(undefined, { onError: (e) => setBladSync((e as Error).message) });
      }} />}

    <div className={SIATKA_TRZECH_KOLUMN}>
      <Karta className="flex min-h-0 flex-col overflow-hidden">
        {/* `shrink-0` na blokach nad listą nie jest kosmetyką: lista ma bazę 0,
            więc przy ciasnym oknie kurczyłyby się WYŁĄCZNIE one. */}
        <nav className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 p-2">
          {KUBELKI.map((k, i) => {
            const ile = data?.liczniki?.[k.id] ?? 0;
            const aktywny = k.id === kubelek;
            return <button key={k.id} onClick={() => przelacz(k.id)}
              title={`${k.pytanie} (klawisz ${i + 1})`}
              className={`rounded-md px-2 py-1 text-xs font-bold ${
                aktywny ? "bg-wertis-amber text-wertis-ink" : "text-slate-600 hover:bg-slate-100"}`}>
              {k.etykieta}<span className="ml-1 tabular-nums opacity-70">{ile}</span>
            </button>;
          })}
          <button onClick={() => przelacz(null)} title="Wszystkie reklamacje (klawisz 4)"
            className={`rounded-md px-2 py-1 text-xs font-bold ${
              kubelek === null ? "bg-wertis-amber text-wertis-ink" : "text-slate-600 hover:bg-slate-100"}`}>
            Wszystkie<span className="ml-1 tabular-nums opacity-70">
              {data?.reklamacje?.length ?? 0}</span>
          </button>
        </nav>

        <div className="shrink-0 border-b border-slate-200 px-2 py-1.5">
          <label className="sr-only" htmlFor="szukaj-reklamacji">Szukaj reklamacji</label>
          <input id="szukaj-reklamacji" className="field !py-1 text-xs" value={fraza}
            onChange={(e) => setFraza(e.target.value)}
            placeholder="Numer, zamówienie albo login klienta" />
        </div>

        {/* Pytanie kubełka stoi NAD listą, bo to ono zastępuje menu akcji.
            Przy włączonym filtrze milknie: lista nie jest wtedy kubełkiem. */}
        {!pasujace && kubelek !== null &&
          <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
            {opis?.pytanie}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading
            ? <p className="p-6 text-center text-sm text-slate-500">Wczytuję kolejkę…</p>
            : <Kolejka reklamacje={widoczne} wybrana={wybrana}
                zKubelkiem={Boolean(pasujace) || kubelek === null}
                onWybierz={(r) => nawiguj(`/obsluga/reklamacje/${r}`)} />}
        </div>
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-y-auto p-4">
        {szczegol.data
          ? <Czat reklamacja={szczegol.data.reklamacja} czat={szczegol.data.czat}
              zalaczniki={szczegol.data.zalaczniki} />
          : <Pusto ikona={<ShieldQuestion size={40} className="text-slate-300" />}>
              {wybrana ? "Wczytuję sprawę…" : "Wybierz reklamację z kolejki po lewej"}
            </Pusto>}
      </Karta>

      <Karta className="flex min-h-0 flex-col overflow-y-auto">
        {szczegol.data
          ? <Dowody szczegol={szczegol.data} trwa={trwa} bladZapisu={bladZapisu}
              onProwadze={() => {
                setBladZapisu("");
                prowadze.mutate(
                  { id: szczegol.data!.reklamacja.id, wersja: szczegol.data!.reklamacja.wersja },
                  { onError: (e) => setBladZapisu((e as Error).message) });
              }}
              onNotatka={(tekst) => {
                setBladZapisu("");
                notatka.mutate({
                  id: szczegol.data!.reklamacja.id, notatka: tekst,
                  wersja: szczegol.data!.reklamacja.wersja,
                }, { onError: (e) => setBladZapisu((e as Error).message) });
              }} />
          : <p className="p-6 text-center text-sm text-slate-500">
              Dowody o sprawie pokażą się po wybraniu reklamacji.</p>}
      </Karta>
    </div>
  </div>;
}
