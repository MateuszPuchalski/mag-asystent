import React from "react";
import { ExternalLink, Package, Tag } from "lucide-react";
import type { OfertaRozmowy as Dane } from "../api/typy";
import { zlote } from "../api/zwroty";

/**
 * Oferta, pod którą padło pytanie (0.178.0).
 *
 * Do 0.177.1 panel pokazywał przy wiadomości SAM NUMER oferty, a mail
 * powiadamiający z Allegro miał w bloku „Wiadomość dotyczy” tytuł, cenę
 * i zdjęcie. Panel miał więc mniej niż powiadomienie, od którego wszystko się
 * zaczyna — i agent szedł po tytuł do panelu Allegro, czyli tam, gdzie §25
 * obiecuje nie zaglądać.
 *
 * Blok ma dwa stany i każdy mówi co innego: tytuł z ceną (gdy ticker
 * dociągnął snapshot) albo zdanie, że tytuł dopiero przyjedzie. Milczenie
 * w drugim stanie wyglądałoby jak usterka.
 *
 * ZDJĘCIA Z ALLEGRO NIE MA świadomie: obrazek z ich serwera znaczyłby wyjście
 * przeglądarki biura poza własną sieć przy każdym otwarciu skrzynki — ta sama
 * decyzja, co przy awatarze rozmówcy (`docs/allegro-ksztalt.md`). Zdjęcie
 * z NASZEJ trasy `/api/products/:twId/zdjecie` tego zastrzeżenia nie łamie
 * i stoi w bloku towaru obok (0.179.0).
 */
export function OfertaRozmowy({ oferta }: { oferta: Dane }) {
  const o = oferta.pobrana;
  return <section className="border-b bg-slate-50 px-4 py-3 text-sm" aria-label="Oferta">
    <div className="flex flex-wrap items-center gap-2">
      <Package size={15} className="text-slate-500" />
      <b>Oferta</b>
      <span className="font-mono text-xs text-slate-600">{oferta.externalId}</span>
      {/* Status oferty stoi przy numerze, nie przy tytule: „zakończona” zmienia
          sens całej odpowiedzi, a agent czyta tę linijkę pierwszą. */}
      {o?.status && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">
        {o.status}</span>}
      {oferta.link && <a href={oferta.link} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        Otwórz w Allegro<ExternalLink size={12} /></a>}
    </div>

    {o
      ? <div className="mt-2 flex flex-wrap items-baseline gap-2 rounded bg-white px-2 py-1.5">
          <span className="text-sm font-semibold">{o.nazwa}</span>
          {/* SKU sprzedawcy z `external.id` OFERTY — mostek do kartoteki dla
              pytania sprzed zakupu, gdzie zamówienia jeszcze nie ma. */}
          {o.sku && <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Tag size={11} />{o.sku}</span>}
          {o.cenaGrosze != null && <span className="ml-auto shrink-0 tabular-nums text-sm font-bold">
            {zlote(o.cenaGrosze, o.waluta ?? "PLN")}</span>}
        </div>
      : <p className="mt-1 text-xs text-slate-500">
          Tytułu oferty jeszcze nie pobrano — dociągnie go najbliższa synchronizacja (do 7 min).
        </p>}
  </section>;
}
