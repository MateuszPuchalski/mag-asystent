import React, { useState } from "react";
import { Copy, ExternalLink, ShoppingCart, Truck } from "lucide-react";
import type { StanPrzesylki, ZamowienieRozmowy as Dane } from "../api/typy";
import { useSprawdzPrzesylkeRozmowy, useWskazOferte } from "../api/rozmowy";
import { zlote } from "../api/zwroty";
import { NaglowekSekcji, czas } from "../ui";
import { Kafel, KafelOferty } from "../towar/Kafel";
import { ZnakAllegro } from "../ui/ZnakAllegro";

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
export function ZamowienieRozmowy({ zamowienie, rozmowaId, ofertaRozmowy = null, bezPaczki = false }: {
  zamowienie: Dane;
  rozmowaId: number;
  /** Numer oferty, którą rozmowa JUŻ ma — wtedy „Wskaż" nie stoi przy żadnej pozycji. */
  ofertaRozmowy?: string | null;
  /**
   * Paczkę pokazuje soczewka nad kolumną (@wydanie). Druga linijka tej samej
   * paczki z drugim „sprawdź" kazałaby porównywać dwa miejsca.
   */
  bezPaczki?: boolean;
}) {
  const [skopiowano, setSkopiowano] = useState(false);
  const wskaz = useWskazOferte();
  const z = zamowienie.pobrane;
  const doWskazania = Boolean(z && z.pozycje.length > 1 && ofertaRozmowy === null);
  return <section className="border-b px-4 py-3 text-sm" aria-label="Zamówienie">
    <div className="flex flex-wrap items-center gap-2">
      <NaglowekSekcji ikona={<ShoppingCart size={13} />}>Zamówienie</NaglowekSekcji>
      {/* UUID SKRÓCONY (0.249.0). Pełne trzydzieści sześć znaków w wadze treści
          zajmowało pół wiersza nagłówka, a nikt ich nie czyta — od przepisania
          jest przycisk kopiowania obok, a od sprawdzenia podpowiedź. */}
      <span className="font-mono text-podpis text-slate-500" title={zamowienie.externalId}>
        {zamowienie.externalId.slice(0, 8)}…</span>
      {/* UUID nikt nie przepisuje z ekranu ręcznie — jak przy zwrotach. */}
      {/* kontrast: to przycisk ikonowy, ikona nie niesie pisma */}
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
        aria-label="Otwórz w Allegro"
        /* Cichnie jak bliźniak przy ofercie (0.249.0): dwa identyczne błękitne
           odnośniki były jedynym błękitem w kolumnie i ciągnęły wzrok mocniej
           niż nazwa towaru — a to nawigacja, nie treść. */
        className="inline-flex items-center gap-1 text-podpis font-semibold text-slate-500 hover:text-slate-800">
        Otwórz w <ZnakAllegro wysokosc={10} /><ExternalLink size={11} /></a>}
    </div>

    {z
      ? <>
          <ul className="mt-2 space-y-1">
            {z.pozycje.map((p, i) => <li key={`${p.offerId}-${i}`}
              className="flex items-start gap-2 rounded bg-slate-50 px-2 py-1.5 text-xs"
              aria-label={`Pozycja: ${p.nazwa}`}>
              {/* `stan` od 0.217.0: bez niego kafel pisał „bez zdjęcia" także
                  wtedy, gdy o obraz nikt jeszcze nie pytał — ta sama pomyłka,
                  którą 0.214.0 naprawiło przy pozycji zwrotu. */}
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
                    className="ml-auto font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900 disabled:opacity-50">
                    Wskaż jako ofertę rozmowy</button>}
                </div>
              </div>
            </li>)}
          </ul>
          {/* Podpis źródeł obu kafli (§4.3): dwa obrazy obok siebie bez podpisu
              wyglądałyby jak dwa ujęcia tej samej rzeczy. */}
          <p className="mt-1 text-podpis text-slate-500">
            {/* JEDNA LINIA, oba źródła nadal nazwane (0.249.0). §4.3 żąda, żeby
                przy każdym fakcie było widać źródło — nie żąda zdania złożonego.
                Dwa wiersze szarej prozy pod każdą pozycją ważyły więcej niż
                sama pozycja. */}
            Zdjęcia: oferta Allegro (widział klient) · kartoteka Subiekta (mamy na półce)
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
    {zamowienie.przesylka && !bezPaczki && <Paczka przesylka={zamowienie.przesylka} rozmowaId={rozmowaId} />}
  </section>;
}

/* Kody przewoźnika słowem, z perspektywy KLIENTA — paczka jedzie do niego.
   Słownik zwrotów mówi „w drodze do nas" i tu dałby zdanie odwrotne. Nieznany
   kod stoi surowy, jak u przewoźnika. Eksport od 0.498.0: wiersz zamówienia
   w kolumnie kontekstu streszcza paczkę tymi samymi słowami, a od @wydanie
   mówi nimi także soczewka paczki. */
export const STATUS: Record<string, string> = {
  PENDING: "czeka na nadanie",
  IN_TRANSIT: "w drodze do klienta",
  RELEASED_FOR_DELIVERY: "wydana do doręczenia",
  AVAILABLE_FOR_PICKUP: "czeka w punkcie odbioru",
  NOTICE_LEFT: "awizo — nieudana próba doręczenia",
  ISSUE: "problem z przesyłką",
  RETURNED: "wraca do nadawcy",
};

/**
 * Gdzie jest paczka (23 września 2026). Klient pod zamówieniem pyta
 * najczęściej o to, a agent szedł po odpowiedź do panelu Allegro.
 *
 * „Sprawdź" to JAWNE kliknięcie: dwa żądania u Allegro nie wychodzą
 * z otwarcia rozmowy. Świeży stan dociąga też układanie szkicu, więc po
 * „Ułóż odpowiedź" linijka zwykle jest już wypełniona.
 */
function Paczka({ przesylka, rozmowaId }: { przesylka: StanPrzesylki; rozmowaId: number }) {
  const sprawdz = useSprawdzPrzesylkeRozmowy();
  return <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-xs" aria-label="Przesyłka">
    <Truck size={13} className="self-center text-slate-500" aria-hidden="true" />
    {przesylka.sprawdzonoAt === null
      ? <span className="text-slate-600">nie pytaliśmy jeszcze Allegro o paczkę</span>
      : przesylka.waybill === null
        ? <span className="text-slate-600">Allegro nie ma numeru — paczka nienadana albo nadana poza Allegro</span>
        : <>
            {przesylka.dostarczonoAt
              ? <b className="text-ranga-ok">doręczona {czas(przesylka.dostarczonoAt)}</b>
              : <b>{przesylka.status ? STATUS[przesylka.status] ?? przesylka.status
                : "przewoźnik nie podał statusu"}</b>}
            <span className="text-slate-600">{przesylka.przewoznik}{" "}
              <span className="font-mono">{przesylka.waybill}</span></span>
          </>}
    {przesylka.sprawdzonoAt && <span className="text-slate-500">stan z {czas(przesylka.sprawdzonoAt)}</span>}
    <button type="button" disabled={sprawdz.isPending} onClick={() => sprawdz.mutate({ id: rozmowaId })}
      className="font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900 disabled:opacity-50">
      {sprawdz.isPending ? "pytam…" : "sprawdź"}</button>
    {sprawdz.error && <p className="w-full text-red-700">{(sprawdz.error as Error).message}</p>}
  </div>;
}
