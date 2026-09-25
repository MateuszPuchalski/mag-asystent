import React from "react";
import { ExternalLink, FileText, PackageSearch, ReceiptText } from "lucide-react";
import type { OsRozmowy } from "../api/typy";
import { zlote } from "../api/zwroty";
import { useDokumentySprzedazy, useKartaTowaru } from "../api/rozmowy";
import { NAZWA_KATEGORII } from "./statusy";
import { STATUS as STATUS_PACZKI } from "./ZamowienieRozmowy";
import { Przycisk, czas, dzien } from "../ui";
import {
  OKNO_PODWOJNEGO_GODZ, PROSBA_O_ZDJECIE, STATUS_ZAKUPU, podwojneZakupy, soczewka,
  type Soczewka as DaneSoczewki,
} from "./soczewki-reguly";

/**
 * Soczewka na górze kolumny kontekstu (0.499.0) — reguły i ryzyko
 * w `soczewki-reguly.ts`. Tutaj tylko rysowanie, każda soczewka to jedno pytanie
 * klienta i jedna odpowiedź, której agent dotąd szukał po całej kolumnie.
 */
export function Soczewka({ dane, onWstawDoSzkicu }: {
  dane: OsRozmowy;
  onWstawDoSzkicu: (tresc: string) => void;
}) {
  const s = soczewka(dane);
  if (!s) return null;
  return <section aria-label="Pytanie klienta" className="border-b px-4 pb-4 pt-3 text-sm">
    <Naglowek s={s} />
    {s.rodzaj === "anulowanie" && <Anulowanie dane={dane} />}
    {s.rodzaj === "inny_towar" && <InnyTowar dane={dane} s={s} onWstawDoSzkicu={onWstawDoSzkicu} />}
    {s.rodzaj === "faktura" && <Faktura dane={dane} />}
  </section>;
}

/* SKĄD KATEGORIA — zawsze, bo soczewka stoi na domyśle klasyfikatora.
   Agent, który widzi „wg Copilota", wie, że może się mylić, i wie, gdzie
   to poprawić: etykieta kategorii stoi w nagłówku rozmowy. */
function Naglowek({ s }: { s: DaneSoczewki }) {
  return <div className="mb-2">
    <h3 className="text-podpis font-bold uppercase tracking-wide text-slate-700">
      Pytanie klienta · {NAZWA_KATEGORII[s.kategoria]}</h3>
    <p className="text-podpis text-slate-600">
      {s.zCzlowieka ? "kategoria wskazana przez zespół"
        : "kategoria wg Copilota — poprawisz ją w nagłówku rozmowy"}
      {s.nieaktualna && " · sprzed ostatniej wiadomości klienta"}</p>
  </div>;
}

/* ── ANULOWANIE: ZAKUPY TEGO KLIENTA OBOK SIEBIE ────────────────────────────
   Dwa przykłady z listy właściciela to podwójny zakup: „pomyłkowo zapłacone
   podwójne zamówienie" i „widzę drugą płatność niezrealizowaną". Agent musiał
   otworzyć oba zamówienia w Allegro, żeby zobaczyć, które opłacone. Tu stoją
   obok siebie, z bliźniakiem zaznaczonym i statusem słowem. */
function Anulowanie({ dane }: { dane: OsRozmowy }) {
  const zakupy = [...dane.kandydaciZamowien]
    .sort((a, b) => (b.kupionoAt ?? "").localeCompare(a.kupionoAt ?? "")).slice(0, 5);
  if (zakupy.length === 0) {
    return <p className="text-slate-600">Nie znamy zakupów tego klienta — wątek nie niesie loginu
      albo zamówień jeszcze nie pobrano. Numer zamówienia trzeba wziąć od klienta.</p>;
  }
  const pary = podwojneZakupy(dane.kandydaciZamowien);
  const pierwszy = zakupy.find((z) => pary.has(z.externalId));
  const blizniak = pierwszy ? dane.kandydaciZamowien.find((z) => z.externalId === pary.get(pierwszy.externalId)) : null;
  const paczka = dane.zamowienie?.przesylka;
  return <div className="space-y-2">
    <p className="font-semibold text-slate-900">{pierwszy && blizniak
      ? `Te same pozycje kupione dwa razy: ${czas(blizniak.kupionoAt)} (${STATUS_ZAKUPU[blizniak.status ?? ""] ?? blizniak.status ?? "status nieznany"}) i ${czas(pierwszy.kupionoAt)} (${STATUS_ZAKUPU[pierwszy.status ?? ""] ?? pierwszy.status ?? "status nieznany"}).`
      : `Bez powtórzonego zakupu tych samych pozycji w ${OKNO_PODWOJNEGO_GODZ} godzinach.`}</p>
    <ul className="divide-y rounded-lg border" aria-label="Zakupy tego klienta">
      {zakupy.map((z) => <li key={z.externalId} className="px-3 py-2">
        {/* STATUS PIERWSZY (@wydanie): to on rozstrzyga, który zakup anulować,
            a początek wiersza jest jedynym miejscem, które oko czyta na pewno. */}
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className={z.status === "READY_FOR_PROCESSING" ? "font-semibold text-emerald-800"
            : z.status === "CANCELLED" ? "text-slate-600" : "font-semibold text-amber-900"}>
            {STATUS_ZAKUPU[z.status ?? ""] ?? z.status ?? "status nieznany"}</span>
          <b className="text-slate-900">{czas(z.kupionoAt)}</b>
          <span className="tabular-nums">{zlote(z.sumaGrosze, z.waluta)}</span>
          {pary.has(z.externalId) && <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-900">
            te same pozycje</span>}
          {z.externalId === dane.zamowienie?.externalId && <span className="rounded bg-slate-100 px-1.5 text-slate-700">
            zamówienie rozmowy</span>}
          {z.link && <a href={z.link} target="_blank" rel="noopener noreferrer" aria-label="Otwórz zamówienie w Allegro"
            className="ml-auto inline-flex items-center gap-1 text-sky-800 hover:text-sky-950">
            Allegro<ExternalLink size={12} /></a>}
        </div>
        <p className="truncate text-xs text-slate-600" title={z.pozycje}>{z.pozycje}</p>
      </li>)}
    </ul>
    {/* Paczka jest faktem, nie wyrokiem: czy nadane zamówienie da się jeszcze
        anulować, rozstrzyga Allegro, a nie ten ekran. */}
    {paczka?.status && <p className="text-xs text-slate-700">
      Zamówienie rozmowy ma już paczkę: {STATUS_PACZKI[paczka.status] ?? paczka.status}
      {paczka.przewoznik && ` (${paczka.przewoznik})`}.</p>}
  </div>;
}

/* ── INNY TOWAR / BRAK W PACZCE: CO MIAŁO PRZYJŚĆ ──────────────────────────
   „W paczce są inne rzeczy", „nem azt a terméket küldte el". Pierwsze
   pytanie agenta brzmi: co zamówił — a lista pozycji leżała w bloku
   zamówienia, pod ofertą i kartoteką. Tu stoi na górze, z półką każdej
   pozycji, bo drugie pytanie brzmi: skąd to wzięto na magazynie. */
function InnyTowar({ dane, s, onWstawDoSzkicu }: {
  dane: OsRozmowy; s: DaneSoczewki; onWstawDoSzkicu: (tresc: string) => void;
}) {
  if (!dane.zamowienie) {
    return <p className="text-slate-600">Rozmowa nie ma zamówienia — wskaż je w wierszu „Zamówienie"
      niżej. Bez niego nie wiadomo, co miało przyjść.</p>;
  }
  const pozycje = dane.zamowienie.pobrane?.pozycje ?? [];
  return <div className="space-y-2">
    <p className="font-semibold text-slate-900">{s.kategoria === "MISSING_PRODUCT"
      ? "Co było w zamówieniu — ustal z klientem, czego brakuje."
      : "Co klient zamówił — porównaj z tym, co przyszło."}</p>
    {pozycje.length === 0
      ? <p className="text-slate-600">Treści zamówienia jeszcze nie pobrano — dociągnie ją najbliższa synchronizacja.</p>
      : <ul className="divide-y rounded-lg border" aria-label="Pozycje zamówienia">
          {pozycje.map((p, i) => <li key={`${p.offerId}-${i}`} className="px-3 py-2">
            <div className="flex items-baseline gap-2">
              <b className="min-w-0 flex-1 text-slate-900">{p.nazwa}</b>
              <span className="shrink-0 tabular-nums">{p.ilosc} szt.</span>
            </div>
            <div className="flex flex-wrap gap-x-2 text-xs text-slate-600">
              {(p.twSymbol ?? p.sku) && <span className="font-mono">{p.twSymbol ?? p.sku}</span>}
              {p.twId !== null ? <Polka twId={p.twId} /> : <span>bez kartoteki — półki nie znamy</span>}
            </div>
          </li>)}
        </ul>}
    {/* Zdanie do szkicu WYŁĄCZNIE kliknięciem — soczewka niczego nie pisze sama. */}
    <Przycisk className="text-xs" onClick={() => onWstawDoSzkicu(PROSBA_O_ZDJECIE)}>
      <PackageSearch size={14} />Poproś o zdjęcie tego, co przyszło</Przycisk>
  </div>;
}

/** Półka pozycji z kartoteki — ten sam odczyt, który rysuje kartę towaru. */
function Polka({ twId }: { twId: number }) {
  const karta = useKartaTowaru(twId);
  if (!karta.data) return null;
  return <span>półka {karta.data.locs.length ? karta.data.locs.join(", ") : "nieznana"}</span>;
}

/* ── FAKTURA: CO JEST W SUBIEKCIE POD TYM ZAMÓWIENIEM ──────────────────────
   „Paczkę otrzymaliśmy, faktury nie". Odpowiedź leżała w Subiekcie, a panel
   nie mówił nawet, czy kupujący zaznaczył fakturę przy zakupie. Tu stoją
   obie rzeczy, a dokumenty — wyłącznie te z numerem zamówienia. */
function Faktura({ dane }: { dane: OsRozmowy }) {
  const dok = useDokumentySprzedazy(dane.rozmowa.id, dane.zamowienie !== null);
  if (!dane.zamowienie) {
    return <p className="text-slate-600">Rozmowa bez zamówienia — faktury nie ma do czego szukać.
      Wskaż zamówienie w wierszu „Zamówienie" niżej.</p>;
  }
  const zadana = dane.zamowienie.pobrane?.fakturaZadana ?? null;
  const dokumenty = dok.data?.dokumenty ?? [];
  const faktury = dokumenty.filter((d) => d.typ === "FS");
  return <div className="space-y-2">
    <p className="font-semibold text-slate-900">{dok.isLoading ? "Szukam w Subiekcie…"
      : dok.error ? "Subiekt nie odpowiedział — dokumentów nie sprawdzono."
      : faktury.length ? `Faktura jest: ${faktury.map((f) => f.numer).join(", ")} — wyślij ją jako załącznik.`
      : dokumenty.length ? "Jest tylko paragon — faktury do tego zamówienia w Subiekcie nie ma."
      : "W Subiekcie nie ma dokumentu z numerem tego zamówienia."}</p>
    <p className="flex items-center gap-1.5 text-xs text-slate-700">
      <ReceiptText size={13} className="shrink-0" />
      {zadana === true ? "Kupujący zaznaczył przy zakupie, że chce fakturę."
        : zadana === false ? "Przy zakupie kupujący nie zaznaczył faktury."
        : "Allegro nie podało, czy kupujący chciał fakturę."}</p>
    {dokumenty.length > 0 && <ul className="space-y-0.5 text-xs" aria-label="Dokumenty sprzedaży zamówienia">
      {dokumenty.map((d) => <li key={d.numer} className="flex items-center gap-1.5">
        <FileText size={13} className="shrink-0 text-slate-500" />
        <b className="font-mono">{d.numer}</b>
        <span className="text-slate-600">{d.typ === "FS" ? "faktura" : "paragon"} z {dzien(d.data)}</span>
      </li>)}
    </ul>}
  </div>;
}
