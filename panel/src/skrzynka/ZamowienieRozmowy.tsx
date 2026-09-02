import React, { useState } from "react";
import { Copy, ExternalLink, ShoppingCart } from "lucide-react";
import type { ZamowienieRozmowy as Dane } from "../api/typy";
import { zlote } from "../api/zwroty";
import { czas } from "../ui";

/**
 * Zamówienie, którego dotyczy rozmowa (0.166.0).
 *
 * Mail Allegro „Wiadomość dotyczy" pokazywał towar, a panel — nic: gałąź
 * `relatesTo.order` była wyrzucana przy mapowaniu. Blok ma trzy stany i każdy
 * mówi coś innego: numer z odnośnikiem (od razu), pozycje z nazwą i ceną (gdy
 * ticker dociągnął treść) albo zdanie, że treść dopiero przyjedzie. Milczenie
 * w trzecim stanie wyglądałoby jak usterka.
 *
 * Przycisku „dociągnij teraz" ze zwrotów tu NIE ma: to zapis, a ekran rozmowy
 * nie ma żadnego zapisu przy patrzeniu — liczniki tras skrzynki tego pilnują.
 */
export function ZamowienieRozmowy({ zamowienie }: { zamowienie: Dane }) {
  const [skopiowano, setSkopiowano] = useState(false);
  const z = zamowienie.pobrane;
  return <section className="border-b bg-slate-50 px-4 py-3 text-sm" aria-label="Zamówienie">
    <div className="flex flex-wrap items-center gap-2">
      <ShoppingCart size={15} className="text-slate-500" />
      <b>Zamówienie</b>
      <span className="font-mono text-xs text-slate-600" title={zamowienie.externalId}>
        {zamowienie.externalId}</span>
      {/* UUID nikt nie przepisuje z ekranu ręcznie — jak przy zwrotach. */}
      <button type="button" title="Kopiuj numer zamówienia"
        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        onClick={() => {
          void navigator.clipboard?.writeText(zamowienie.externalId).then(() => {
            setSkopiowano(true);
            setTimeout(() => setSkopiowano(false), 1500);
          }).catch(() => {});
        }}>
        <Copy size={13} />
        <span className="sr-only">{skopiowano ? "Skopiowano" : "Kopiuj"}</span>
      </button>
      {zamowienie.link && <a href={zamowienie.link} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
        Otwórz w Allegro<ExternalLink size={12} /></a>}
    </div>

    {z
      ? <>
          <ul className="mt-2 space-y-1">
            {z.pozycje.map((p, i) => <li key={`${p.offerId}-${i}`}
              className="flex items-baseline gap-2 rounded bg-white px-2 py-1 text-xs">
              <span className="truncate">{p.nazwa}</span>
              {p.sku && <span className="shrink-0 text-slate-400">{p.sku}</span>}
              <span className="ml-auto shrink-0 tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
            </li>)}
          </ul>
          <p className="mt-1 text-xs text-slate-500">
            {z.kupionoAt && <>Kupione {czas(z.kupionoAt)} · </>}
            {z.dostawaMetoda && <>{z.dostawaMetoda} · </>}
            zapłacono {zlote(z.sumaGrosze, z.waluta)}
          </p>
        </>
      : <p className="mt-1 text-xs text-slate-500">
          Treści zamówienia jeszcze nie pobrano — dociągnie ją najbliższa synchronizacja (do 10 min).
        </p>}
  </section>;
}
