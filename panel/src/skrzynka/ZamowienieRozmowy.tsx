import React, { useState } from "react";
import { Copy, ExternalLink, ShoppingCart } from "lucide-react";
import type { ZamowienieRozmowy as Dane } from "../api/typy";
import { useWskazOferte } from "../api/rozmowy";
import { zlote } from "../api/zwroty";
import { czas } from "../ui";
import { Kafel, KafelOferty } from "../towar/Kafel";

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
 *
 * ── DWA ZDJĘCIA PRZY POZYCJI (0.215.0) ─────────────────────────────────────
 * Właściciel przysłał zrzut rozmowy z samym zamówieniem: „tutaj powinny być
 * zdjęcia i przy ofercie, i przy towarze". Pozycja niesie OBA źródła naraz —
 * zdjęcie z oferty Allegro (to widział klient, kupując) i zdjęcie kartoteki
 * z Subiekta (to mamy na półce) — dokładnie jak pozycja zwrotu. Kafle stoją
 * ZAWSZE, także puste: wiersze mają zaczynać się w jednej linii, a pusty
 * kafel niesie własną informację (bez kartoteki / bez zdjęcia).
 *
 * „Wskaż" przy pozycji stoi tylko wtedy, gdy zamówienie ma KILKA pozycji
 * i rozmowa nie ma jeszcze oferty: przy jednej pozycji serwer wywodzi ofertę
 * sam, a zgadywanie z kilku byłoby podstawianiem oferty zamiast pytania
 * agenta. Wskazanie zapisuje się jako wybór człowieka, jak w `BrakOferty`.
 * Hak woła komponent SAM — precedens `TowarRozmowy.tsx`.
 */
export function ZamowienieRozmowy({ zamowienie, rozmowaId, ofertaRozmowy = null }: {
  zamowienie: Dane;
  rozmowaId: number;
  /** Numer oferty, którą rozmowa JUŻ ma — wtedy „Wskaż" nie stoi przy żadnej pozycji. */
  ofertaRozmowy?: string | null;
}) {
  const [skopiowano, setSkopiowano] = useState(false);
  const wskaz = useWskazOferte();
  const z = zamowienie.pobrane;
  const doWskazania = Boolean(z && z.pozycje.length > 1 && ofertaRozmowy === null);
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
              className="flex items-start gap-2 rounded bg-white px-2 py-1.5 text-xs"
              aria-label={`Pozycja: ${p.nazwa}`}>
              <KafelOferty externalId={p.offerId} rozmiar={40}
                nazwa={`${p.nazwa} — zdjęcie oferty`} symbol={p.sku} />
              <Kafel twId={p.twId} rozmiar={40} nazwa={p.nazwa} symbol={p.twSymbol} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate">{p.nazwa}</span>
                  {p.sku && <span className="shrink-0 text-slate-400">{p.sku}</span>}
                  <span className="ml-auto shrink-0 tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  {/* Kartoteka z podpisem źródła: SKU albo wskazanie człowieka — zdanie z serwera. */}
                  {p.twId !== null
                    ? <span title={p.twZrodlo ?? undefined}>
                        Subiekt: <span className="font-mono text-slate-700">{p.twSymbol}</span></span>
                    : <span>bez kartoteki w Subiekcie</span>}
                  {ofertaRozmowy !== null && p.offerId === ofertaRozmowy &&
                    <span className="rounded bg-amber-100 px-1 font-semibold text-amber-900">oferta rozmowy</span>}
                  {doWskazania && p.offerId && <button type="button" disabled={wskaz.isPending}
                    onClick={() => wskaz.mutate({ id: rozmowaId, ofertaId: p.offerId! })}
                    className="ml-auto font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900 disabled:opacity-50">
                    Wskaż jako ofertę rozmowy</button>}
                </div>
              </div>
            </li>)}
          </ul>
          {/* Podpis źródeł obu kafli (§4.3): dwa obrazy obok siebie bez podpisu
              wyglądałyby jak dwa ujęcia tej samej rzeczy. */}
          <p className="mt-1 text-[11px] text-slate-400">
            Zdjęcia: pierwsze z oferty Allegro (to widział klient), drugie z kartoteki Subiekta (to mamy na półce).
          </p>
          {wskaz.error && <p className="mt-1 text-xs text-red-700">{(wskaz.error as Error).message}</p>}
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
