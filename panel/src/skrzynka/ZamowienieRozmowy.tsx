import React from "react";
import type { ZamowienieRozmowy as Dane } from "../api/typy";
import { useWskazOferte } from "../api/rozmowy";
import { zlote } from "../api/zwroty";
import { Kafel, KafelOferty } from "../towar/Kafel";
import { ODNOSNIK } from "./odnosniki";

/**
 * Lista pozycji zamówienia rozmowy.
 *
 * Stoi w kolumnie, gdy któraś pozycja nie jest ofertą rozmowy: wtedy jej
 * kartoteki nie pokazuje „Oferta i towar", a kartoteka pozycji ma dom tylko
 * tutaj. Karta zakupu nad osią pokazuje dwie pozycje i odsyła tu po pełną
 * listę. Numer zamówienia, kopiowanie, odnośnik do Allegro, sumę i kroki
 * mówi karta, a paczkę — blok `Paczka.tsx`; lista ich nie powtarza.
 *
 * Bez treści zamówienia lista mówi zdaniem, że treść dopiero przyjedzie.
 * Milczenie w tym miejscu wyglądałoby jak usterka. Przycisku „dociągnij
 * teraz" ze zwrotów tu NIE ma: to zapis, a ekran rozmowy nie ma żadnego
 * zapisu przy patrzeniu — liczniki tras skrzynki tego pilnują.
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
  const wskaz = useWskazOferte();
  const z = zamowienie.pobrane;
  const doWskazania = Boolean(z && z.pozycje.length > 1 && ofertaRozmowy === null);
  return <section aria-label="Lista pozycji zamówienia" className="text-sm">
    {z
      ? <>
          {/* Kreska listy, bez pigułek: pozycje dzieli linia jak każdą listę
              kolumny, a tło pod każdą ważyło więcej niż sama pozycja. */}
          <ul className="divide-y divide-slate-200">
            {z.pozycje.map((p, i) => <li key={`${p.offerId}-${i}`}
              className="flex items-start gap-2 py-1.5 text-xs"
              aria-label={`Pozycja: ${p.nazwa}`}>
              {/* `stan` mówi, czy o obraz w ogóle pytano: bez niego kafel pisał
                  „bez zdjęcia" także wtedy, gdy nikt jeszcze nie pytał. */}
              <KafelOferty externalId={p.offerId} stan={p.ofertaZdjecie} rozmiar={40}
                nazwa={`${p.nazwa} — zdjęcie oferty`} symbol={p.sku} />
              <Kafel twId={p.twId} rozmiar={40} nazwa={p.nazwa} symbol={p.twSymbol} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate">{p.nazwa}</span>
                  {p.sku && <span className="shrink-0 text-slate-500">{p.sku}</span>}
                  <span className="ml-auto shrink-0 tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-podpis text-slate-500">
                  {/* Kartoteka z podpisem źródła: SKU albo wskazanie człowieka — zdanie z serwera. */}
                  {p.twId !== null
                    ? <span title={p.twZrodlo ?? undefined}>
                        Subiekt: <span className="font-mono text-slate-700">{p.twSymbol}</span></span>
                    : <span>bez kartoteki w Subiekcie</span>}
                  {ofertaRozmowy !== null && p.offerId === ofertaRozmowy &&
                    <span className="rounded bg-amber-100 px-1 font-semibold text-amber-900">oferta rozmowy</span>}
                  {doWskazania && p.offerId && <button type="button" disabled={wskaz.isPending}
                    onClick={() => wskaz.mutate({ id: rozmowaId, ofertaId: p.offerId! })}
                    className={`ml-auto ${ODNOSNIK}`}>
                    Wskaż jako ofertę rozmowy</button>}
                </div>
              </div>
            </li>)}
          </ul>
          {/* Podpis źródeł obu kafli (§4.3): dwa obrazy obok siebie bez podpisu
              wyglądałyby jak dwa ujęcia tej samej rzeczy. Jedna linia, bo §4.3
              żąda źródła przy fakcie, a nie zdania złożonego pod każdą pozycją. */}
          <p className="mt-1 text-podpis text-slate-500">
            Zdjęcia: oferta Allegro (widział klient) · kartoteka Subiekta (mamy na półce)
          </p>
          {wskaz.error && <p className="mt-1 text-xs text-ranga-zle">{(wskaz.error as Error).message}</p>}
        </>
      : <p className="text-xs text-slate-500">
          Treści zamówienia jeszcze nie pobrano — dociągnie ją najbliższa synchronizacja (do 10 min).
        </p>}
  </section>;
}
