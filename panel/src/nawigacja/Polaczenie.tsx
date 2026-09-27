import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, WifiOff } from "lucide-react";
import { BrakPolaczenia, POLACZENIE_ZERWANE } from "../api/klient";
import { useZdrowie } from "../api/rozmowy";
import { godzina } from "../ui";

/* ── PASEK BRAKU POŁĄCZENIA (@wydanie) ───────────────────────────────────────
   Serwer bierze wydanie sam, kilka razy dziennie, i na minutę znika. Pomiar
   z zabitym serwerem pokazał trzy rzeczy naraz, każdą osobno mylącą:
     - listy bez danych mówiły „nic nie czeka na biuro", a liczniki „0";
     - ekran z pamięci pokazywał stare dane bez słowa, że są stare;
     - błędy stały po kawałku przy każdej sekcji, jako „Błąd 502".
   Agent brał brak połączenia za brak pracy. Pasek mówi to raz, w jednym
   miejscu, z godziną ostatniego kontaktu i tym, co z tego wynika.

   SKĄD WIE. Każde zapytanie i mutacja, które skończą się `BrakPolaczenia`,
   zgłaszają zdarzenie (`api/klient-zapytan.ts`). Pasek pojawia się od razu,
   bez czekania na takt zdrowia co 30 sekund.

   KIEDY ZNIKA. Co 5 sekund pyta `/api/health`. Pierwsza udana odpowiedź
   gasi pasek i odświeża wszystkie zapytania. Bez tego ekran zostałby
   z danymi sprzed awarii i błędami, które już nie są prawdą.

   ZERO ZAPISU. Pasek tylko czyta; „Ponów teraz" to ten sam GET zdrowia. */

const PONOW_CO_MS = 5_000;

export function PasekPolaczenia() {
  const qc = useQueryClient();
  const zdrowie = useZdrowie();
  const [zerwaneOd, setZerwaneOd] = useState<number | null>(null);

  useEffect(() => {
    const zerwane = () => setZerwaneOd((od) => od ?? Date.now());
    window.addEventListener(POLACZENIE_ZERWANE, zerwane);
    return () => window.removeEventListener(POLACZENIE_ZERWANE, zerwane);
  }, []);

  /* Błąd samego zdrowia też jest sygnałem: zdarzenie z pamięci podręcznej
     mogło przyjść, zanim pasek zaczął słuchać. */
  useEffect(() => {
    if (zdrowie.error instanceof BrakPolaczenia) setZerwaneOd((od) => od ?? Date.now());
  }, [zdrowie.error, zdrowie.errorUpdatedAt]);

  /* Powrót: udana odpowiedź zdrowia NOWSZA niż zerwanie. */
  useEffect(() => {
    if (zerwaneOd !== null && zdrowie.dataUpdatedAt > zerwaneOd) {
      setZerwaneOd(null);
      void qc.invalidateQueries();
    }
  }, [zdrowie.dataUpdatedAt, zerwaneOd, qc]);

  useEffect(() => {
    if (zerwaneOd === null) return;
    const t = window.setInterval(() => void zdrowie.refetch(), PONOW_CO_MS);
    return () => window.clearInterval(t);
  }, [zerwaneOd, zdrowie.refetch]);

  if (zerwaneOd === null) return null;
  const ostatni = zdrowie.dataUpdatedAt || zerwaneOd;
  return <section role="alert" aria-label="Brak połączenia z serwerem"
    className="flex items-start gap-3 border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-950">
    <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
    <p className="min-w-0 flex-1">
      <b>Brak połączenia z serwerem</b> · ostatni kontakt {godzina(new Date(ostatni).toISOString())}.
      {" "}Listy i liczniki mogą być puste albo nieaktualne — to brak połączenia, nie brak pracy.
      {" "}Zapis teraz nie przejdzie. Ponawiam co {PONOW_CO_MS / 1000} sekund.
    </p>
    <button type="button" onClick={() => void zdrowie.refetch()} disabled={zdrowie.isFetching}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold hover:bg-red-100
        disabled:opacity-60">
      <RefreshCw size={14} aria-hidden="true" className={zdrowie.isFetching ? "animate-spin" : ""} />
      Ponów teraz</button>
  </section>;
}
