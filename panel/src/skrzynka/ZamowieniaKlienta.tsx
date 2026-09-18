import React, { useState } from "react";
import { Link2, ShoppingBag } from "lucide-react";
import type { KandydatZamowienia } from "../api/typy";
import { useWskazZamowienie } from "../api/rozmowy";
import { zlote } from "../api/zwroty";
import { NaglowekSekcji, czas } from "../ui";

/**
 * Zakupy tego kupującego — kandydaci do powiązania z rozmową (0.397.0).
 *
 * Zgłoszenie właściciela ze zrzutem: klient napisał pod OFERTĄ „dzisiaj
 * otrzymałem paczkę, ale nie było w zestawie świecy", a rozmowa nie miała
 * zamówienia wcale. Agent widział ofertę i kartotekę, nie widział ZAKUPU —
 * więc nie wiedział, co klient dostał, za ile ani czy paczka w ogóle doszła.
 *
 * POWÓD JEST W ALLEGRO: wątek niesie JEDEN obiekt powiązany, a pytanie zadane
 * pod ofertą niesie ofertę. Numeru zamówienia w tym ładunku nie ma.
 *
 * DWIE WAGI, jedna lista. Dopóki rozmowa nie ma zakupu, blok stoi otwarty
 * i mocno: to jest brakujące ogniwo, bez którego reszta kolumny milczy. Gdy
 * zakup już jest, blok schodzi pod przycisk — klient miewa kilka paczek
 * i „nie o tę chodzi" pada częściej niż raz, ale wtedy jest to poprawka,
 * a nie główna czynność ekranu.
 *
 * WIĄŻE KLIKNIĘCIE, nie automat. Ten sam login nie znaczy „ta paczka";
 * automat pomyliłby się cicho, i to przy sprawie o brak w zestawie, czyli
 * tam, gdzie pomyłka kosztuje pieniądze. Lista mówi, co ją ułożyło —
 * plakietka przy zakupie niosącym ofertę z rozmowy.
 */
export function ZamowieniaKlienta({ kandydaci, rozmowaId, maZamowienie }: {
  kandydaci: KandydatZamowienia[];
  rozmowaId: number;
  /** Czy rozmowa ma już zakup — decyduje o wadze bloku, nie o jego istnieniu. */
  maZamowienie: boolean;
}) {
  const wskaz = useWskazZamowienie();
  const [otwarte, setOtwarte] = useState(false);
  const [blad, setBlad] = useState("");
  if (kandydaci.length === 0) return null;

  const widoczne = !maZamowienie || otwarte;

  return <section className="border-b px-4 py-3 text-sm" aria-label="Zakupy tego klienta">
    <div className="flex flex-wrap items-center gap-2">
      <NaglowekSekcji ikona={<ShoppingBag size={13} />}>Zakupy tego klienta</NaglowekSekcji>
      <span className="text-podpis text-slate-500">{kandydaci.length}</span>
      {maZamowienie && <button type="button" onClick={() => setOtwarte((o) => !o)}
        className="ml-auto text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800">
        {otwarte ? "zwiń" : "to nie ta paczka?"}</button>}
    </div>

    {/* Zdanie POWODU stoi tylko wtedy, gdy powiązania nie ma. Przy związanej
        rozmowie byłoby tłumaczeniem czegoś, co już się nie dzieje. */}
    {!maZamowienie && <p className="mt-1 text-xs text-slate-500">
      Klient napisał pod ofertą, więc Allegro nie podało numeru zakupu.
      Wskaż paczkę, o którą pyta — pozycje, kwoty i status przesyłki pojawią się wtedy tutaj.
    </p>}

    {widoczne && <ul className="mt-2 space-y-1">
      {kandydaci.map((k) => <li key={k.externalId}
        className="rounded border border-slate-200 bg-white p-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-podpis text-slate-500" title={k.externalId}>
            {k.externalId.slice(0, 8)}…</span>
          {/* Plakietka mówi, DLACZEGO ten zakup stoi pierwszy. Bez niej
              kolejność byłaby magią, a agent nie miałby jak jej sprawdzić. */}
          {k.maTeOferte && <span className="rounded bg-emerald-100 px-1 py-0.5 text-podpis font-bold text-emerald-800">
            ta oferta</span>}
          <span className="text-podpis text-slate-500">
            {k.kupionoAt ? czas(k.kupionoAt) : "bez daty zakupu"}</span>
          <b className="ml-auto shrink-0 tabular-nums">{zlote(k.sumaGrosze, k.waluta)}</b>
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-700" title={k.pozycje}>{k.pozycje}</p>
        <button type="button" disabled={wskaz.isPending}
          onClick={() => {
            setBlad("");
            wskaz.mutate({ id: rozmowaId, externalId: k.externalId },
              { onError: (e) => setBlad((e as Error).message) });
          }}
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-wertis-ink underline underline-offset-2 disabled:opacity-50">
          <Link2 size={12} />{wskaz.isPending ? "wiążę…" : "to ta paczka"}</button>
      </li>)}
    </ul>}

    {blad && <p className="mt-1 text-xs text-red-700">{blad}</p>}
  </section>;
}
