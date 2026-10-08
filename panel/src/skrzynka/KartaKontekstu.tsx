import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleDashed, ExternalLink, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { HistoriaKlienta, OsRozmowy } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Skopiuj, dzienMiesiac, ile } from "../ui";
import { KafelOferty } from "../towar/Kafel";
import { historiaPozaZakupem, klientMaHistorie, nowyKlient } from "./kokpit";
import { streszczenieKlienta } from "./Kontekst";
import { ODNOSNIK } from "./odnosniki";
import { stanZakupu, type KrokZakupu } from "./zakup";
import { Anulowanie } from "./Anulowanie";

/* ── KARTA ZAKUPU I KLIENTA NAD ROZMOWĄ ─────────────────────────────────────
   Zgłoszenie właściciela: „więcej informacji osadzonych w rozmowie w środkowym
   oknie". Karta odpowiada na pytanie „czego dotyczy ta rozmowa", zanim agent
   przeczyta pierwszą wiadomość: towar ze zdjęciem i ceną, gdzie jest zakup
   i kim jest klient.

   STOI W PRZEWIJANIU OSI, nie nad nią. Przypięta zabierałaby wysokość edytorowi
   przez cały dzień, a wysokość należy do odpowiedzi. Cena: oś zjeżdża na dół
   przy otwarciu, więc karta ląduje za górną krawędzią. Dlatego, GDY KARTY NIE
   WIDAĆ, u góry osi stoi jednolinijkowe streszczenie, które przewija do niej.
   Pasek istnieje tylko wtedy: przy krótkiej rozmowie karta jest w kadrze
   i streszczenie dublowałoby ją o jedną linię wyżej.

   ZWIJA SIĘ DO JEDNEJ LINII, a wybór zostaje w przeglądarce, bo to nawyk
   stanowiska, nie decyzja na jedno otwarcie (jak kolejność kolejki).

   ZERO ZAPISU. Karta niczego nie odpytuje u przewoźnika ani u Allegro:
   „nie sprawdzano przesyłki" mówi wprost, a sprawdzenie stoi w bloku paczki
   w prawej kolumnie (`Paczka.tsx`), wyłącznie na kliknięcie.

   PRYWATNOŚĆ. Tylko to, co panel już dostaje: towar, cena, numer zamówienia,
   login kupującego pokazuje nagłówek rozmowy. Adresu dostawy, telefonu i
   e-maila tu nie ma i nie będzie (`docs/obsluga-klienta.md`).                */

const KLUCZ = "wertis.skrzynka.karta.zwinieta";

function odczytajZwinieta(): boolean {
  try { return window.localStorage.getItem(KLUCZ) === "1"; } catch { return false; }
}
function zapiszZwinieta(v: boolean): void {
  try { window.localStorage.setItem(KLUCZ, v ? "1" : "0"); } catch { /* przeglądarka bez pamięci */ }
}

function Krok({ krok }: { krok: KrokZakupu }) {
  const tak = krok.stan === "tak";
  return <li className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center"
    title={krok.uwaga ?? undefined}>
    <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full border ${
      tak ? "border-ranga-ok bg-ranga-ok text-white"
        : krok.stan === "nie" ? "border-slate-300 bg-white text-slate-300"
          : "border-dashed border-slate-400 bg-white text-slate-400"}`}>
      {tak ? <Check size={12} /> : krok.stan === "nieznane" ? <CircleDashed size={12} /> : null}
    </span>
    <span className={`text-podpis ${tak ? "font-semibold text-slate-800" : "text-slate-500"}`}>{krok.etykieta}</span>
    <span className="text-podpis tabular-nums text-slate-500">
      {krok.at ? dzienMiesiac(krok.at) : krok.stan === "nieznane" ? "nie sprawdzono" : "—"}
    </span>
  </li>;
}

export function KartaKontekstu({ dane, historia }: { dane: OsRozmowy; historia?: HistoriaKlienta }) {
  const [zwinieta, setZwinieta] = useState(odczytajZwinieta);
  const kartaRef = useRef<HTMLElement>(null);
  /* `true` na starcie, jak przy pytaniu klienta w osi: obserwator oddaje wynik
     dopiero po renderze, a pasek, który mignąłby przed pierwszym pomiarem,
     dublowałby kartę widoczną w kadrze. */
  const [wKadrze, setWKadrze] = useState(true);
  const zam = dane.zamowienie?.pobrane ?? null;
  const oferta = dane.oferta?.pobrana ?? null;
  const stan = zam ? stanZakupu(zam, dane.zamowienie?.przesylka ?? null) : null;

  /* Zły ładunek historii nie wywraca rozmowy: karta jest dodatkiem do osi, a
     błąd w zapytaniu pomocniczym nie ma prawa zabrać ze sobą ekranu, na którym
     agent odpowiada klientowi. Kształt, którego nie znamy, czytamy jak brak. */
  const zgodna = Array.isArray(historia?.wpisy) ? historia : undefined;
  /* „WCZEŚNIEJ" ZNACZY PRZED TYM ZAKUPEM. Serwer oddaje historię razem z tym
     zakupem, jego zwrotem i sprawami, więc karta mówiła „Wcześniej u nas:
     1 zakup" o tym samym zakupie, a „Nowy klient" nie stawał przy pierwszym.
     Kolumna obok nie mówi już tego faktu wcale, więc jedyny dom musi mówić
     prawdę. Reguła w `kokpit.ts`, wspólna z wierszem „Klient". */
  const h = historiaPozaZakupem(zgodna, dane.zamowienie?.externalId ?? null);
  const znaczniki: string[] = [];
  if (nowyKlient(h)) znaczniki.push("Nowy klient");
  const wczesniej = h && klientMaHistorie(h) ? streszczenieKlienta(h) : null;
  /* NUMER Z POWIĄZANIA, NIE Z TREŚCI. Serwer podaje numer i odnośnik od razu,
     a treść zamówienia dojeżdża synchronizacją (do 10 minut, dłużej przy
     nieudanym pobraniu). Kolumna obok numeru już nie powtarza, więc karta
     musi go mieć także w tym oknie: agent podaje go klientowi i otwiera
     zamówienie w Allegro. */
  const numer = dane.zamowienie?.externalId ?? null;
  const linkZamowienia = dane.zamowienie?.link ?? zam?.link ?? null;

  const jestKarta = Boolean(numer || zam || oferta || znaczniki.length > 0 || wczesniej);
  /* Przy prośbie o anulowanie zamówienie stoi pod ręką w każdej postaci
     karty, także zwiniętej. Bez numeru nie ma czego otworzyć. */
  const anulowanie = dane.rozmowa.kopilot?.kategoria === "CANCEL_ORDER" && numer
    ? <Anulowanie link={linkZamowienia} zam={zam} stan={stan} /> : null;
  /* Zależność od `zwinieta`: rozwinięta i zwinięta karta to dwa różne elementy
     pod tym samym refem, więc obserwator musi złapać nowy. */
  useEffect(() => {
    const el = kartaRef.current;
    if (!jestKarta || !el || typeof IntersectionObserver === "undefined") {
      setWKadrze(true);
      return;
    }
    const o = new IntersectionObserver(([w]) => setWKadrze(w.isIntersecting));
    o.observe(el);
    return () => o.disconnect();
  }, [jestKarta, zwinieta]);

  /* Karta bez treści nie zostaje pustą ramką: rozmowa bez zakupu i bez historii
     jest częsta, a pusta ramka mówiłaby, że czegoś brakuje. */
  if (!jestKarta) return null;

  /* POZYCJA ROZMOWY PIERWSZA. Karta pokazuje dwie pozycje, a ta, o którą
     pyta klient, bywała trzecia i nie stała w karcie wcale. Bez wskazanej
     oferty karta nie zgaduje: przy kilku pozycjach mówi ich liczbę, bo
     pierwsza podana jako towar rozmowy przeczyłaby ramie „Wymaga Ciebie",
     która prosi właśnie o wskazanie. */
  const ofertaId = dane.oferta?.externalId ?? null;
  const pozycje = [...(zam?.pozycje ?? [])].sort((a, b) =>
    Number(ofertaId !== null && b.offerId === ofertaId) - Number(ofertaId !== null && a.offerId === ofertaId));
  const pozycjaRozmowy = ofertaId === null ? undefined : pozycje.find((p) => p.offerId === ofertaId);
  const nazwa = pozycjaRozmowy?.nazwa ?? (pozycje.length === 1 ? pozycje[0].nazwa
    : pozycje.length > 1 ? ile(pozycje.length, "pozycja", "pozycje", "pozycji") : oferta?.nazwa ?? null);
  /* Cena oferty staje w miejscu sumy tylko bez numeru zamówienia. Obok numeru
     to miejsce czyta się jak suma tego zamówienia, a cena oferty nią nie jest:
     wtedy stoi przy ofercie, podpisana. */
  const cenaOferty = oferta ? zlote(oferta.cenaGrosze, oferta.waluta ?? "PLN") : null;
  const suma = zam ? zlote(zam.sumaGrosze, zam.waluta) : numer ? null : cenaOferty;
  const przelacz = () => setZwinieta((z) => { zapiszZwinieta(!z); return !z; });

  /* PROFIL KLIENTA Z KARTY. Karta jest domem klienta, a wiersz „Klient"
     w kolumnie staje tylko z historią poza tym zakupem. Przy pierwszym
     zakupie rozmowa nie miałaby więc żadnej drogi do profilu, a tylko tam
     zakłada się sprawę klienta z krokiem i terminem. Profil prowadzi do
     rozmowy, więc rozmowa prowadzi do profilu: wiązanie w obie strony. */
  const login = h?.login ?? null;
  const klient = (znaczniki.length > 0 || wczesniej) && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-podpis text-slate-600">
    <UserRound size={13} aria-hidden="true" className="shrink-0 text-slate-500" />
    {znaczniki.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{t}</span>)}
    {wczesniej && <span>Wcześniej u nas: {wczesniej}</span>}
    {login && <Link to={`/obsluga/klient/${encodeURIComponent(login)}`} className={`ml-auto ${ODNOSNIK}`}>
      Profil klienta</Link>}
  </div>;

  /* Skraca się NAZWA towaru, a cena, anulowanie i historia zostają: to one są
     odpowiedzią na „co z tym zakupem", a nazwa bywa sześćdziesięcioznakowa.
     Ten sam fragment czyta karta zwinięta i pasek u góry osi. */
  const streszczenie = <span className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden">
    {nazwa && <b className="min-w-0 truncate font-semibold">{nazwa}</b>}
    {suma && <span className="shrink-0">· {suma}</span>}
    {stan?.anulowane && <span className="shrink-0 font-semibold text-ranga-zle">· anulowane</span>}
    {wczesniej && <span className="shrink-0 text-slate-500">· {wczesniej}</span>}
    {/* „Nowy klient" stoi w każdej postaci karty. Przy oknie 1366 px karta
        jest zwykle poza kadrem i widać tylko pasek, a fakt zdjęty z kolumny
        nie może stać się kliknięciem. */}
    {/* Bez treści zamówienia nie ma ani nazwy, ani sumy. Numer mówi wtedy,
        czego karta dotyczy, zamiast pustego paska z samym „rozwiń". */}
    {!nazwa && !suma && numer && <span className="min-w-0 truncate">zamówienie <span className="font-mono">{numer}</span></span>}
    {znaczniki.length > 0 && <span className="shrink-0 font-semibold text-slate-700">
      {nazwa || suma || numer ? "· " : ""}{znaczniki.join(" · ")}</span>}
  </span>;

  /* Przewija OŚ, nie `scrollIntoView`: ten przewija też stronę i wypchnął
     nagłówek ekranu za górną krawędź (zmierzone w przeglądarce). Karta jest
     bezpośrednim dzieckiem przewijanej listy, a margines 16 px zostawia jej
     oddech nad górną krawędzią. */
  const pokazKarte = () => {
    const karta = kartaRef.current;
    const lista = karta?.parentElement;
    if (!karta || !lista) return;
    const przesuniecie = karta.getBoundingClientRect().top - lista.getBoundingClientRect().top;
    lista.scrollTo?.({ top: Math.max(0, lista.scrollTop + przesuniecie - 16), behavior: "smooth" });
  };

  /* Wrapper ma wysokość ZERO i `!mt-0`: `space-y-3` osi doliczyłby mu odstęp,
     a pasek przypięty NAD kadrem nie ma prawa przesunąć ani jednej wypowiedzi.
     Sam pasek wisi absolutnie wewnątrz, więc nie bierze miejsca w układzie. */
  const pasek = <div className="pointer-events-none sticky top-0 z-10 !mt-0 h-0">
    {!wKadrze && <button type="button" onClick={pokazKarte}
      aria-label={`Pokaż kartę zakupu${nazwa ? `: ${nazwa}` : ""}`}
      className="pointer-events-auto absolute inset-x-0 top-2 flex w-full min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 shadow-md hover:bg-slate-50">
      <ChevronUp size={14} aria-hidden="true" className="shrink-0 text-slate-500" />
      {streszczenie}
      <span className="shrink-0 text-podpis font-semibold text-sky-800">pokaż kartę</span>
    </button>}
  </div>;

  if (zwinieta) {
    return <><section ref={kartaRef} aria-label="Kontekst zakupu"
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <button type="button" aria-expanded={false} onClick={przelacz}
        className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-slate-700">
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-slate-500" />
        {streszczenie}
        <span className="shrink-0 text-podpis font-semibold text-sky-800">rozwiń</span>
      </button>
      {anulowanie && <div className="mt-1.5">{anulowanie}</div>}
    </section>{pasek}</>;
  }

  return <><section ref={kartaRef} aria-label="Kontekst zakupu"
    className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex items-center gap-2 text-podpis text-slate-500">
      <button type="button" aria-expanded onClick={przelacz} aria-label="Zwiń kartę zakupu"
        className="-ml-1 rounded p-1 hover:bg-slate-100"><ChevronDown size={14} /></button>
      <span className="font-semibold uppercase tracking-wide">Zakup</span>
      {numer && <>
        <span className="font-mono text-slate-700">{numer}</span>
        <Skopiuj tekst={numer} tytul="Kopiuj numer zamówienia" />
        {linkZamowienia && <a href={linkZamowienia} target="_blank" rel="noopener noreferrer"
          aria-label="Otwórz zamówienie w Allegro"
          className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-800">
          Allegro <ExternalLink size={11} /></a>}
      </>}
      {stan?.anulowane && <span className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-ranga-zle">anulowane</span>}
      {suma && <span className="ml-auto text-xs font-semibold tabular-nums text-slate-800">{suma}</span>}
    </div>
    {anulowanie}

    {pozycje.length > 0
      ? <ul className="space-y-1.5">
          {pozycje.slice(0, 2).map((p, i) => <li key={`${p.offerId}-${i}`} className="flex items-start gap-2.5">
            <KafelOferty externalId={p.offerId} stan={p.ofertaZdjecie} rozmiar={48}
              nazwa={`${p.nazwa} — zdjęcie oferty`} symbol={p.sku} />
            <div className="min-w-0 flex-1 text-xs">
              <div className="line-clamp-2 font-semibold text-slate-800">{p.nazwa}</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-podpis text-slate-500">
                {p.sku && <span className="font-mono text-slate-600">{p.sku}</span>}
                <span className="tabular-nums">{p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
              </div>
            </div>
          </li>)}
          {pozycje.length > 2 && <li className="text-podpis text-slate-500">
            + {ile(pozycje.length - 2, "pozycja", "pozycje", "pozycji")} w zamówieniu — pełna lista w kolumnie obok</li>}
        </ul>
      : oferta && <div className="flex items-start gap-2.5">
          <KafelOferty externalId={dane.oferta?.externalId ?? null} stan={oferta.zdjecie} rozmiar={48}
            nazwa={`${oferta.nazwa} — zdjęcie oferty`} symbol={oferta.sku} />
          <div className="min-w-0 flex-1 text-xs">
            <div className="line-clamp-2 font-semibold text-slate-800">{oferta.nazwa}</div>
            <div className="mt-0.5 text-podpis text-slate-500">
              {oferta.sku && <span className="mr-2 font-mono text-slate-600">{oferta.sku}</span>}
              {numer && cenaOferty && <span className="mr-2 tabular-nums">cena w ofercie {cenaOferty}</span>}
              {/* Zamówienie powiązane, a treść w drodze, to co innego niż brak
                  zamówienia: pierwsze naprawi synchronizacja, drugie agent. */}
              oferta, o którą pyta klient — {numer ? "treść zamówienia jeszcze nie pobrana" : "zamówienia jeszcze nie powiązano"}</div>
          </div>
        </div>}

    {stan && !stan.anulowane && <ol aria-label="Status zakupu" className="flex items-start gap-1 border-t border-slate-100 pt-2">
      {stan.kroki.map((k) => <Krok key={k.klucz} krok={k} />)}
    </ol>}
    {klient && <div className="border-t border-slate-100 pt-2">{klient}</div>}
  </section>{pasek}</>;
}
