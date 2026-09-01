import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Undo2 } from "lucide-react";
import { useZwroty } from "../api/zwroty";
import type { Kubelek } from "../api/typy";
import { Blad, Karta, Pusto } from "../ui";
import { KUBELKI, Kolejka } from "../zwroty/Kolejka";
import { Dowody } from "../zwroty/Dowody";

/* ── Ekran zwrotów (0.150.0) ─────────────────────────────────────────────────
   Trzy kolumny, jak skrzynka — dwa ekrany obsługi mają mieć jeden nawyk,
   nie dwa.

   TO WYDANIE TYLKO CZYTA. Werdykt, kwota, ocena i korekta wchodzą w 0.151.0.
   Pasek werdyktu jest tu mimo to widoczny, ale wyłączony i podpisany: agent
   ma od pierwszego dnia wiedzieć, gdzie ta decyzja stanie i jaki klawisz ją
   wywoła. Przycisk, który wygląda na działający i nie działa, byłby gorszy
   od jego braku — stąd jawne zdanie zamiast wyszarzenia bez wyjaśnienia.

   Klawiatura DZIAŁA JUŻ TERAZ w tej części, która niczego nie zapisuje:
   strzałki chodzą po kolejce, cyfry przełączają kubełek. Odruch buduje się
   od pierwszego wydania, a nie po dołożeniu zapisu.                        */

/** Klawisze decyzji z projektu — dziś podpisy, od 0.151.0 działanie. */
const DECYZJE: Record<Kubelek, Array<[string, string]>> = {
  decyzja: [["P", "Przyjmij"], ["O", "Odrzuć"], ["J", "Odłóż"]],
  ocena: [["S", "Na stan"], ["C", "Na przecenę"], ["U", "Utylizacja"]],
  zwrot: [["Enter", "Kwota proponowana"], ["B", "Bez wysyłki"], ["K", "Inna kwota"]],
  korekta: [["Enter", "Zleć korektę"], ["R", "Numer z palca"]],
  odrzucony: [],
  zamkniety: [],
};

export function Zwroty() {
  const { id } = useParams();
  const nawiguj = useNavigate();
  const [kubelek, setKubelek] = useState<Kubelek>("decyzja");
  const { data, isLoading, error } = useZwroty();

  const wKubelku = useMemo(
    () => (data?.zwroty ?? []).filter((z) => z.kubelek === kubelek),
    [data, kubelek]);

  const wybrany = id ? Number(id) : null;
  const zwrot = data?.zwroty.find((z) => z.id === wybrany) ?? null;

  /* Wejście z paska adresu na zwrot z innego kubełka ma pokazać ten zwrot,
     a nie pustą listę. Adres jest tu źródłem prawdy, kubełek za nim idzie. */
  useEffect(() => {
    if (zwrot && zwrot.kubelek !== kubelek) setKubelek(zwrot.kubelek);
  }, [zwrot?.id]);

  /**
   * Przełączenie kubełka PRZESTAWIA TEŻ KURSOR.
   *
   * Bez tego jeden klawisz zmieniał listę, a zaznaczenie zostawało na zwrocie
   * z poprzedniego kubełka — środkowa kolumna pokazywała wtedy pytanie nowego
   * kubełka nad klawiszami starego. Operator musiał dokliknąć wiersz, czyli
   * dokładnie to jedno kliknięcie, którego ten ekran miał nie mieć.
   */
  const przelacz = (k: Kubelek) => {
    setKubelek(k);
    const pierwszy = (data?.zwroty ?? []).find((z) => z.kubelek === k);
    nawiguj(pierwszy ? `/obsluga/zwroty/${pierwszy.id}` : "/obsluga/zwroty");
  };

  const idz = (o: number) => {
    if (!wKubelku.length) return;
    const i = wKubelku.findIndex((z) => z.id === wybrany);
    const nast = wKubelku[Math.min(wKubelku.length - 1, Math.max(0, (i < 0 ? 0 : i) + o))];
    if (nast) nawiguj(`/obsluga/zwroty/${nast.id}`);
  };

  useEffect(() => {
    const naKlawisz = (e: KeyboardEvent) => {
      /* Skrót nie ma prawa zadziałać, gdy ktoś pisze — inaczej „s" w polu
         szukania oceniałoby towar. */
      const cel = e.target as HTMLElement | null;
      if (cel && /^(INPUT|TEXTAREA|SELECT)$/.test(cel.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); idz(-1); }
      else if (/^[1-6]$/.test(e.key)) przelacz(KUBELKI[Number(e.key) - 1].id);
    };
    window.addEventListener("keydown", naKlawisz);
    return () => window.removeEventListener("keydown", naKlawisz);
  }, [wKubelku, wybrany, data]);

  if (error) return <Blad>{(error as Error).message}</Blad>;

  const opis = KUBELKI.find((k) => k.id === kubelek);

  return <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_340px]">
    <Karta className="overflow-hidden">
      <nav className="flex flex-wrap gap-1 border-b border-slate-200 p-2">
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
      </nav>
      {/* Pytanie kubełka stoi NAD listą, bo to ono zastępuje menu akcji. */}
      <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
        {opis?.pytanie}
      </p>
      {isLoading
        ? <p className="p-6 text-center text-sm text-slate-500">Wczytuję kolejkę…</p>
        : <Kolejka zwroty={wKubelku} wybrany={wybrany}
            onWybierz={(z) => nawiguj(`/obsluga/zwroty/${z}`)} />}
    </Karta>

    <Karta className="overflow-hidden">
      {!zwrot
        ? <Pusto ikona={<Undo2 size={40} className="text-slate-300" />}>
            Wybierz zwrot z kolejki — strzałkami albo kliknięciem.</Pusto>
        : <>
            {/* Pytanie bierze się z kubełka WYBRANEGO zwrotu, nie z zakładki
                listy. Te dwie rzeczy rozjeżdżają się przy wejściu z paska
                adresu, a wtedy nagłówek pytałby o co innego niż klawisze. */}
            <header className="border-b border-slate-200 p-4">
              <h2 className="text-lg font-bold">{zwrot.numer ?? zwrot.externalId}</h2>
              <p className="text-sm text-slate-500">
                {KUBELKI.find((k) => k.id === zwrot.kubelek)?.pytanie}</p>
            </header>
            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap gap-2">
                {DECYZJE[zwrot.kubelek].map(([klawisz, etykieta]) => (
                  <span key={klawisz}
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-400">
                    <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 text-xs">{klawisz}</kbd>
                    {etykieta}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {DECYZJE[zwrot.kubelek].length
                  ? "To wydanie tylko czyta. Decyzje zapisuje 0.151.0 — klawisze są już te."
                  : "Stan końcowy — nie ma tu decyzji do podjęcia."}
              </p>
            </div>
            <div className="p-4 text-sm text-slate-600">
              <p>Oś zwrotu pojawi się razem z pierwszą decyzją zapisaną w panelu.</p>
            </div>
          </>}
    </Karta>

    <Karta className="overflow-hidden">
      {zwrot
        ? <Dowody zwrot={zwrot} />
        : <p className="p-6 text-center text-sm text-slate-500">
            Dowody pokażą się po wybraniu zwrotu.</p>}
    </Karta>
  </div>;
}
