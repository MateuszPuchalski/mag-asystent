import { useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleDashed, ExternalLink, UserRound } from "lucide-react";
import type { HistoriaKlienta, OsRozmowy } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Skopiuj, dzienMiesiac } from "../ui";
import { KafelOferty } from "../towar/Kafel";
import { klientMaHistorie, nowyKlient } from "./kokpit";
import { streszczenieKlienta } from "./Kontekst";
import { stanZakupu, type KrokZakupu } from "./zakup";

/* ── KARTA ZAKUPU I KLIENTA NAD ROZMOWĄ ─────────────────────────────────────
   Zgłoszenie właściciela: „więcej informacji osadzonych w rozmowie w środkowym
   oknie". Karta odpowiada na pytanie „czego dotyczy ta rozmowa", zanim agent
   przeczyta pierwszą wiadomość: towar ze zdjęciem i ceną, gdzie jest zakup
   i kim jest klient.

   STOI W PRZEWIJANIU OSI, nie nad nią. Przypięta zabierałaby wysokość edytorowi
   przez cały dzień, a wysokość należy do odpowiedzi. Cena: przy długiej
   rozmowie karta jest za górną krawędzią i trzeba przewinąć w górę.

   ZWIJA SIĘ DO JEDNEJ LINII, a wybór zostaje w przeglądarce, bo to nawyk
   stanowiska, nie decyzja na jedno otwarcie (jak kolejność kolejki).

   ZERO ZAPISU. Karta niczego nie odpytuje u przewoźnika ani u Allegro:
   „nie sprawdzano przesyłki" mówi wprost, a sprawdzenie zostaje tam, gdzie
   było, w kolumnie zamówienia.

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
  const zam = dane.zamowienie?.pobrane ?? null;
  const oferta = dane.oferta?.pobrana ?? null;
  const stan = zam ? stanZakupu(zam, dane.zamowienie?.przesylka ?? null) : null;

  /* Zły ładunek historii nie wywraca rozmowy: karta jest dodatkiem do osi, a
     błąd w zapytaniu pomocniczym nie ma prawa zabrać ze sobą ekranu, na którym
     agent odpowiada klientowi. Kształt, którego nie znamy, czytamy jak brak. */
  const h = Array.isArray(historia?.wpisy) && Array.isArray(historia?.maszyny) ? historia : undefined;
  const znaczniki: string[] = [];
  if (nowyKlient(h)) znaczniki.push("Nowy klient");
  const wczesniej = h && klientMaHistorie(h) ? streszczenieKlienta(h) : null;

  /* Karta bez treści nie zostaje pustą ramką: rozmowa bez zakupu i bez historii
     jest częsta, a pusta ramka mówiłaby, że czegoś brakuje. */
  if (!zam && !oferta && znaczniki.length === 0 && !wczesniej) return null;

  const pozycje = zam?.pozycje ?? [];
  const nazwa = pozycje[0]?.nazwa ?? oferta?.nazwa ?? null;
  const suma = zam ? zlote(zam.sumaGrosze, zam.waluta) : oferta ? zlote(oferta.cenaGrosze, oferta.waluta ?? "PLN") : null;
  const przelacz = () => setZwinieta((z) => { zapiszZwinieta(!z); return !z; });

  const klient = (znaczniki.length > 0 || wczesniej) && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-podpis text-slate-600">
    <UserRound size={13} aria-hidden="true" className="shrink-0 text-slate-500" />
    {znaczniki.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{t}</span>)}
    {wczesniej && <span>Wcześniej u nas: {wczesniej}</span>}
  </div>;

  if (zwinieta) {
    return <section aria-label="Kontekst zakupu" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <button type="button" aria-expanded={false} onClick={przelacz}
        className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-slate-700">
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-slate-500" />
        {/* Skraca się NAZWA towaru, a cena, anulowanie i historia zostają: to one
            są odpowiedzią na „co z tym zakupem", a nazwa bywa sześćdziesięcioznakowa. */}
        <span className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden">
          {nazwa && <b className="min-w-0 truncate font-semibold">{nazwa}</b>}
          {suma && <span className="shrink-0">· {suma}</span>}
          {stan?.anulowane && <span className="shrink-0 font-semibold text-ranga-zle">· anulowane</span>}
          {wczesniej && <span className="shrink-0 text-slate-500">· {wczesniej}</span>}
          {!nazwa && znaczniki.length > 0 && <span>{znaczniki.join(" · ")}</span>}
        </span>
        <span className="shrink-0 text-podpis font-semibold text-sky-800">rozwiń</span>
      </button>
    </section>;
  }

  return <section aria-label="Kontekst zakupu" className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex items-center gap-2 text-podpis text-slate-500">
      <button type="button" aria-expanded onClick={przelacz} aria-label="Zwiń kartę zakupu"
        className="-ml-1 rounded p-1 hover:bg-slate-100"><ChevronDown size={14} /></button>
      <span className="font-semibold uppercase tracking-wide">Zakup</span>
      {zam && <>
        <span className="font-mono text-slate-700">{zam.externalId}</span>
        <Skopiuj tekst={zam.externalId} tytul="Kopiuj numer zamówienia" />
        {(dane.zamowienie?.link ?? zam.link) && <a href={(dane.zamowienie?.link ?? zam.link) ?? undefined} target="_blank" rel="noopener noreferrer"
          aria-label="Otwórz zamówienie w Allegro"
          className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-slate-800">
          Allegro <ExternalLink size={11} /></a>}
      </>}
      {stan?.anulowane && <span className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-ranga-zle">anulowane</span>}
      {suma && <span className="ml-auto text-xs font-semibold tabular-nums text-slate-800">{suma}</span>}
    </div>

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
            + {pozycje.length - 2} {pozycje.length - 2 === 1 ? "pozycja" : "pozycji"} w zamówieniu — pełna lista w kolumnie obok</li>}
        </ul>
      : oferta && <div className="flex items-start gap-2.5">
          <KafelOferty externalId={dane.oferta?.externalId ?? null} stan={oferta.zdjecie} rozmiar={48}
            nazwa={`${oferta.nazwa} — zdjęcie oferty`} symbol={oferta.sku} />
          <div className="min-w-0 flex-1 text-xs">
            <div className="line-clamp-2 font-semibold text-slate-800">{oferta.nazwa}</div>
            <div className="mt-0.5 text-podpis text-slate-500">
              {oferta.sku && <span className="mr-2 font-mono text-slate-600">{oferta.sku}</span>}
              oferta, o którą pyta klient — zamówienia jeszcze nie powiązano</div>
          </div>
        </div>}

    {stan && !stan.anulowane && <ol aria-label="Status zakupu" className="flex items-start gap-1 border-t border-slate-100 pt-2">
      {stan.kroki.map((k) => <Krok key={k.klucz} krok={k} />)}
    </ol>}
    {klient && <div className="border-t border-slate-100 pt-2">{klient}</div>}
  </section>;
}
