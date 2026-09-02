import React, { useState } from "react";
import { Check, PackageSearch, X as Krzyzyk } from "lucide-react";
import type { KartaTowaru, OfertaRozmowy } from "../api/typy";
import { useKartaTowaru, useWskazKartoteke } from "../api/rozmowy";
import { Wyszukiwarka, type Towar as TowarZWyszukiwarki } from "../wyszukiwarka";
import { Zdjecie } from "../towar/Zdjecie";
import { Powiekszenie } from "../towar/Powiekszenie";

/**
 * Towar z Subiekta przy rozmowie (0.179.0).
 *
 * SKU sprzedawcy leżało w `offer_snapshot` od 0.178.0 i nie prowadziło
 * donikąd: żeby sprawdzić stan i półkę, agent otwierał Subiekta — czyli robił
 * to, czego §25 zabrania („agent obsłuży typowe pytanie bez otwierania panelu
 * Allegro" ma ten sam sens co „bez otwierania Subiekta").
 *
 * Blok ma trzy stany i każdy każe co innego zrobić: potwierdzona kartoteka
 * (widać stan i półkę), propozycja z automatu (jedno kliknięcie), brak
 * z POWODEM (wiadomo, które ogniwo pękło i czy naprawi się samo).
 *
 * ŹRÓDŁA SIĘ NIE MIESZAJĄ (§4.3). Wszystko pod nagłówkiem „Subiekt GT" jest
 * z Subiekta, a podpis przy kartotece mówi, czy stoi za nią SKU z Allegro,
 * czy decyzja człowieka.
 */
export function TowarRozmowy({ oferta, rozmowaId }: { oferta: OfertaRozmowy; rozmowaId: number }) {
  const [szukam, setSzukam] = useState(false);
  const [powiekszone, setPowiekszone] = useState(false);
  const zapisz = useWskazKartoteke();
  const k = oferta.kartoteka;
  /* Potwierdzona jest wtedy, gdy stoi za nią człowiek — pamięć wskazań.
     Propozycja automatu ma `twId`, ale czeka na kliknięcie. */
  const potwierdzona = k.pewnosc === "pamiec" ? k.twId : null;
  const karta = useKartaTowaru(potwierdzona);

  const ustaw = (twId: number | null) => zapisz.mutate(
    { id: rozmowaId, ofertaId: oferta.externalId, twId },
    { onSuccess: () => setSzukam(false) });

  return <div className="space-y-3 p-4">
    <div className="flex items-center gap-2">
      <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
        Źródło: Subiekt GT
      </span>
    </div>

    {potwierdzona !== null
      ? <>
          <div className="flex gap-3">
            <Zdjecie twId={potwierdzona} rozmiar={72} nazwa={k.symbol ?? ""}
              onKlik={() => setPowiekszone(true)} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{karta.data?.name ?? k.symbol}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-600">{k.symbol}</p>
              <p className="mt-1 text-xs text-slate-500">
                {/* Puste `sku` w pamięci znaczy „wskazał człowiek". Serwer pisze
                    to zdanie; panel go nie układa drugi raz. */}
                {k.zrodlo}
              </p>
            </div>
            <button type="button" title="Zdejmij powiązanie" disabled={zapisz.isPending}
              onClick={() => ustaw(null)}
              className="ml-auto h-6 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
              <Krzyzyk size={14} />
            </button>
          </div>

          {karta.isLoading && <p className="text-xs text-slate-500">Wczytuję stan z Subiekta…</p>}
          {karta.error && <p className="text-xs text-red-700">{(karta.error as Error).message}</p>}
          {karta.data && <StanTowaru karta={karta.data} />}

          {powiekszone && <Powiekszenie twId={potwierdzona} nazwa={karta.data?.name ?? ""}
            symbol={k.symbol ?? ""} zamknij={() => setPowiekszone(false)} />}
        </>
      : <div className="text-xs">
          {k.twId !== null
            /* Propozycja nie udaje faktu — mówi, skąd się wzięła, i czeka na
               zatwierdzenie (§4.3, §11.3). */
            ? <div className="flex flex-wrap items-center gap-2 text-amber-800">
                <span>Propozycja: <b>{k.symbol}</b>
                  <span className="text-slate-500"> · {k.zrodlo}</span></span>
                <button type="button" disabled={zapisz.isPending} onClick={() => ustaw(k.twId)}
                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  <Check size={12} />Zatwierdź</button>
              </div>
            /* POWÓD, nie samo „bez kartoteki": „oferty jeszcze nie pobrano"
               naprawi się samo w kilka minut, a „oferta bez SKU" nigdy. */
            : <p className="flex items-start gap-2 text-slate-500">
                <PackageSearch size={14} className="mt-0.5 shrink-0" />
                <span>Bez kartoteki · <span className="text-slate-600">{k.zrodlo}</span></span>
              </p>}

          {szukam
            ? <div className="mt-2">
                <Wyszukiwarka wybrany={null} etykieta="Wskazana przez Ciebie"
                  onWybierz={(t: TowarZWyszukiwarki | null) => t && ustaw(t.id)} />
              </div>
            : <button type="button" onClick={() => setSzukam(true)}
                className="mt-2 block text-slate-500 underline underline-offset-2 hover:text-slate-800">
                wskaż kartotekę</button>}
        </div>}

    {zapisz.error && <p className="text-xs text-red-700">{(zapisz.error as Error).message}</p>}
  </div>;
}

/**
 * Stan magazynowy. „Dostępny" stoi OSOBNO od stanu, bo to on odpowiada na
 * pytanie klienta — stan bez odjętych rezerwacji obiecuje towar, który jest
 * już czyjś.
 */
function StanTowaru({ karta }: { karta: KartaTowaru }) {
  const wiersze: Array<[string, string]> = [
    ["Stan", `${karta.mag.stan} ${karta.unit ?? "szt."}`],
    ["Rezerwacje", `${karta.mag.rez} ${karta.unit ?? "szt."}`],
    ["Dostępny", `${karta.mag.avail} ${karta.unit ?? "szt."}`],
    ["Lokalizacja", karta.locs.length ? karta.locs.join(" · ") : "brak"],
    ["EAN", karta.ean || "brak"],
  ];
  return <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
    {wiersze.map(([nazwa, wartosc]) => <div key={nazwa} className="flex items-baseline gap-2 text-xs">
      <span className="w-24 shrink-0 text-slate-500">{nazwa}</span>
      <span className={`font-semibold ${nazwa === "Dostępny" && karta.mag.avail <= 0
        ? "text-ranga-zle" : "text-slate-900"}`}>{wartosc}</span>
    </div>)}
    {karta.magazyny.length > 0 && <p className="pt-1 text-[11px] text-slate-500">
      Inne magazyny: {karta.magazyny.map((m) => `${m.kod} ${m.stan}`).join(" · ")}
    </p>}
  </div>;
}
