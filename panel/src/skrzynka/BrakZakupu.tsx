import React, { useState } from "react";
import { Link2, ShoppingBag } from "lucide-react";
import type { KandydatZamowienia } from "../api/typy";
import { useWskazZamowienie } from "../api/rozmowy";
import { zlote } from "../api/zwroty";
import { Przycisk, dzien, ile } from "../ui";

/** Zdanie, które „Wstaw pytanie” dopisuje do odpowiedzi. */
export const PYTANIE_O_ZAMOWIENIE = "Proszę podać numer zamówienia, którego dotyczy wiadomość.";

/**
 * BRAKUJĄCY ZAKUP NAD POLEM ODPOWIEDZI (0.547.0).
 *
 * Rozmowa bez zamówienia odpowiada na domysłach. Copilot pisze wtedy „brak
 * w faktach danych o zamówieniu”, a agent pisze „paczka jest w drodze” bez
 * pokrycia. Tymczasem zakup tego loginu stoi w kolumnie kontekstu, zwinięty
 * w wierszu „Zamówienie”. Pasek przynosi go tam, gdzie agent pisze, bo tam
 * zapada decyzja, co klientowi obiecać.
 *
 * WIĄŻE KLIKNIĘCIE, nie automat, z tego samego powodu co `ZamowieniaKlienta`.
 * Ten sam login nie znaczy „ta paczka”. Pasek pokazuje więc zakup z jego
 * datą, pozycjami i kwotą, żeby decyzja była świadoma. Kolejność kandydatów
 * ustala serwer: najpierw zakup z ofertą rozmowy, potem najnowszy.
 * Przy kilku zakupach pasek pokazuje pierwszy, a resztę odsyła do kolumny.
 *
 * Drugie wyjście to pytanie o numer. Bez niego agent, który nie rozpozna
 * paczki, zostaje z paskiem, którego nie ma jak zamknąć.
 */
type Wlasciwosci = {
  kandydaci: KandydatZamowienia[];
  rozmowaId: number;
  maZamowienie: boolean;
  szkic: string;
  onWstawDoSzkicu: (tresc: string) => void;
};

export function BrakZakupu(p: Wlasciwosci) {
  /* Warunek PRZED hakiem mutacji, w osobnym komponencie. Rozmowa związana
     albo bez kandydata nie potrzebuje klienta zapytań. Testy nagłówka
     rozmowy rysują ją bez niego i tak ma zostać. */
  if (p.maZamowienie || p.kandydaci.length === 0) return null;
  return <Pasek {...p} />;
}

function Pasek({ kandydaci, rozmowaId, szkic, onWstawDoSzkicu }: Wlasciwosci) {
  const wskaz = useWskazZamowienie();
  const [blad, setBlad] = useState("");
  const k = kandydaci[0];
  const reszta = kandydaci.length - 1;
  /* Pytanie już w odpowiedzi: drugi klik dopisałby je drugi raz. */
  const pytanieJest = szkic.includes(PYTANIE_O_ZAMOWIENIE);

  return <section aria-label="Rozmowa bez zamówienia"
    className="ml-auto w-full max-w-[75ch] rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
    <p className="flex flex-wrap items-baseline gap-x-1.5">
      <ShoppingBag size={14} className="shrink-0 self-center text-amber-800" aria-hidden="true" />
      <b>Rozmowa nie ma zamówienia.</b>
      <span>{reszta > 0 ? `Ten login ma ${ile(kandydaci.length, "zakup", "zakupy", "zakupów")}, pierwszy:` : "Ten login kupił:"}</span>
      <span className="min-w-0 font-semibold">
        {k.kupionoAt ? dzien(k.kupionoAt) : "bez daty zakupu"} · {zlote(k.sumaGrosze, k.waluta)}</span>
      {/* Plakietka mówi, DLACZEGO ten zakup stoi pierwszy — jak w kolumnie. */}
      {k.maTeOferte && <span className="rounded bg-emerald-100 px-1 py-0.5 text-podpis font-bold text-emerald-800">
        ta oferta</span>}
    </p>
    <p className="mt-0.5 truncate text-xs text-amber-900" title={k.pozycje}>{k.pozycje}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Przycisk wariant="glowny" className="px-3 py-1.5 text-xs" disabled={wskaz.isPending}
        onClick={() => {
          setBlad("");
          wskaz.mutate({ id: rozmowaId, externalId: k.externalId },
            { onError: (e) => setBlad((e as Error).message) });
        }}>
        <Link2 size={14} />{wskaz.isPending ? "Wiążę…" : "Powiąż ten zakup"}</Przycisk>
      {!pytanieJest && <Przycisk className="px-3 py-1.5 text-xs"
        onClick={() => onWstawDoSzkicu(PYTANIE_O_ZAMOWIENIE)}>
        Wstaw pytanie o numer zamówienia</Przycisk>}
      {reszta > 0 && <span className="text-xs text-amber-900">
        Pozostałe w kolumnie kontekstu, w wierszu „Zamówienie”.</span>}
    </div>
    {blad && <p role="alert" className="mt-1 text-xs text-red-700">{blad}</p>}
  </section>;
}
