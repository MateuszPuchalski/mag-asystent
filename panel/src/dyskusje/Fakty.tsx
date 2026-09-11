import React, { useEffect, useState } from "react";
import { ExternalLink, Undo2 } from "lucide-react";
import type { Dyskusja, SzczegolDyskusji, Tag } from "../api/typy";
import { TagiSprawy } from "../sprawy/Tagi";
import { EtykietaWartosci, NaglowekSekcji, czas, LoginKlienta, Przycisk, Skopiuj } from "../ui";

/* ── Kolumna faktów o dyskusji ───────────────────────────────────────────────
   Jedna lista faktów o jednej sprawie, więc SEKCJE jedna pod drugą, a nie
   zakładki — ta sama decyzja co przy zwrocie w 0.180.0 i przy reklamacji.

   TA KOLUMNA JEST CHUDSZA OD REKLAMACYJNEJ I MÓWI TO WPROST. Dyskusja nie
   niesie powodu, oczekiwania, tytułu prawnego, kwoty ani oferty — schemat
   opisuje każde z tych pól jako nieobecne przy `type: "DISPUTE"`. Rysowanie
   pustych wierszy „—" udawałoby, że dane są, tylko puste; sekcja, której nie
   ma, mówi prawdę taniej.

   ADRESU SAMEJ DYSKUSJI W CENTRUM SPRZEDAŻY NIE ZGADUJEMY. Wzorzec
   `/claims/{id}` dotyczy reklamacji, a wywiedziony z analogii dał już raz 404
   (blizna 0.226.1) — dlatego jedynym odnośnikiem jest ZAMÓWIENIE, adres
   sprawdzony, prowadzący tam, skąd dyskusję widać.

   Wszystko poniżej to ODCZYT. Dwa zapisy tego ekranu — „prowadzę" i notatka —
   są jawnymi kliknięciami, nie skutkiem ubocznym patrzenia.                 */

const Wiersz = ({ etykieta, children }: { etykieta: string; children: React.ReactNode }) =>
  <div className="flex items-baseline gap-2 py-1 text-sm">
    <EtykietaWartosci className="w-32 shrink-0">{etykieta}</EtykietaWartosci>
    <span className="min-w-0 flex-1 text-slate-800">{children}</span>
  </div>;

const Sekcja = ({ tytul, children }: { tytul: string; children: React.ReactNode }) =>
  <section className="border-t border-slate-200 px-4 py-3 first:border-t-0">
    <NaglowekSekcji jako="h3" className="mb-1">{tytul}</NaglowekSekcji>
    {children}
  </section>;

const Link = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
  href
    ? <a href={href} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-wertis-ink">
        {children}<ExternalLink size={12} /></a>
    : <>{children}</>;

/**
 * Notatka biura — nasze ustalenia, których Allegro nie zna.
 *
 * Zapis JAWNYM przyciskiem, nie przy każdym znaku: notatka pisze się zdaniami,
 * a zapis po każdej literze podnosiłby wersję rekordu i wywracał kontrolę
 * świeżości u kolegi przy drugim biurku.
 */
function Notatka({ dyskusja, trwa, blad, onZapisz }: {
  dyskusja: Dyskusja;
  trwa: boolean;
  blad: string;
  onZapisz: (tekst: string) => void;
}) {
  const [tekst, setTekst] = useState(dyskusja.notatka ?? "");
  /* Przełączenie sprawy podmienia treść pola. Bez tego notatka poprzedniej
     zostawałaby w edytorze i dało się ją zapisać na cudzej dyskusji. */
  useEffect(() => { setTekst(dyskusja.notatka ?? ""); }, [dyskusja.id, dyskusja.notatka]);
  const zmienione = tekst.trim() !== (dyskusja.notatka ?? "").trim();
  return <div className="flex flex-col gap-2">
    <label className="sr-only" htmlFor="notatka-dyskusji">Notatka biura</label>
    <textarea id="notatka-dyskusji" rows={3} value={tekst}
      onChange={(e) => setTekst(e.target.value)}
      placeholder="Ustalenia, których Allegro nie zna"
      className="field resize-y text-sm" />
    {blad && <p className="text-xs text-red-700">{blad}</p>}
    <Przycisk wariant="glowny" disabled={!zmienione || trwa}
      onClick={() => onZapisz(tekst)}>
      {trwa ? "Zapisuję…" : "Zapisz notatkę"}
    </Przycisk>
  </div>;
}

export function Fakty({ szczegol, trwa, bladZapisu, onProwadze, onNotatka, tagi }: {
  szczegol: SzczegolDyskusji;
  trwa: boolean;
  bladZapisu: string;
  onProwadze: () => void;
  onNotatka: (tekst: string) => void;
  /* Opcjonalne tym samym wzorcem co przy reklamacji: czego nie da się zrobić,
     tego nie ma na ekranie. */
  tagi?: {
    slownik: Tag[];
    trwa: boolean;
    blad: string;
    onPrzypnij: (tagId: number) => void;
    onOdepnij: (tagId: number) => void;
    onNowy: (nazwa: string) => void;
  };
}) {
  const d = szczegol.dyskusja;
  return <div className="flex min-h-0 flex-col">
    <Sekcja tytul="Sprawa">
      <Wiersz etykieta="Temat">{d.temat ?? "bez tematu"}</Wiersz>
      <Wiersz etykieta="Kupujący">{d.kupujacyLogin
        ? <LoginKlienta login={d.kupujacyLogin} /> : "—"}</Wiersz>
      <Wiersz etykieta="Otwarto">{czas(d.otwartoAt)}</Wiersz>
    </Sekcja>

    <Sekcja tytul="Stan">
      {/* TERMINU TU NIE MA i to nie jest brak danych. Allegro nie oddaje przy
          dyskusji ani `decisionDueDate`, ani `statusDueDate`; jedyną miarą
          pilności jest to, jak długo piłka leży po naszej stronie. */}
      <Wiersz etykieta="Czeka na nas">
        {d.czekaOdDni === null
          ? "ruch należy do klienta"
          : `${d.czekaOdDni === 0 ? "od dziś" : `${d.czekaOdDni} dni`} — Allegro terminu tu nie stawia`}
      </Wiersz>
      <Wiersz etykieta="Status Allegro">{d.statusAllegro ?? "—"}</Wiersz>
      <Wiersz etykieta="Rozmowa">
        {d.czatAktywny ? "otwarta" : "zamknięta przez Allegro"}
        {` · ${d.wiadomosciIle} wiadomości`}
      </Wiersz>
    </Sekcja>

    <Sekcja tytul="Kontekst zakupu">
      <Wiersz etykieta="Zamówienie">
        {d.orderId
          ? <><Link href={d.linkZamowienia}>{d.orderId}</Link>
              <Skopiuj tekst={d.orderId} tytul="Kopiuj numer zamówienia" /></>
          : "dyskusja bez numeru zamówienia"}
      </Wiersz>
    </Sekcja>

    {/* Zwroty tego zamówienia — mostkiem jest numer zamówienia, ten sam
        mechanizm co przy rozmowie od 0.221.0 i przy reklamacji. */}
    {szczegol.zwroty.length > 0 && <Sekcja tytul="Zwroty tego zamówienia">
      <ul className="flex flex-col gap-1">
        {szczegol.zwroty.map((z) => <li key={z.id} className="text-sm">
          <a href={`/obsluga/zwroty/${z.id}`}
            className="inline-flex items-center gap-1 underline underline-offset-2">
            <Undo2 size={12} />{z.numer ?? z.externalId}</a>
          <span className="ml-2 text-slate-500">{czas(z.utworzono)}</span>
        </li>)}
      </ul>
    </Sekcja>}

    {szczegol.rozmowy.length > 0 && <Sekcja tytul="Rozmowy o tym zakupie">
      <ul className="flex flex-col gap-1">
        {szczegol.rozmowy.map((c) => <li key={c.id} className="text-sm">
          <a href={`/obsluga/skrzynka/${c.id}`} className="underline underline-offset-2">
            {c.temat ?? `Rozmowa ${c.id}`}</a>
          <span className="ml-2 text-slate-500">{czas(c.ostatniaAt)}</span>
        </li>)}
      </ul>
    </Sekcja>}

    <Sekcja tytul="Praca biura">
      <Wiersz etykieta="Prowadzi">{d.prowadzi ?? "nikt"}</Wiersz>
      {/* ZNACZNIK, nie zamek. Ponowne kliknięcie zdejmuje. */}
      <Przycisk className="mt-1 w-full" disabled={trwa} onClick={onProwadze}>
        {d.prowadzi ? "Odłóż sprawę" : "Prowadzę tę sprawę"}
      </Przycisk>
      {/* Tagi nad notatką — powód przy tej samej sekcji w `reklamacje/Dowody.tsx`. */}
      {tagi && <div className="mt-3">
        <TagiSprawy przypiete={d.tagi} slownik={tagi.slownik} trwa={tagi.trwa}
          blad={tagi.blad} onPrzypnij={tagi.onPrzypnij} onOdepnij={tagi.onOdepnij}
          onNowy={tagi.onNowy} />
      </div>}
      <div className="mt-3">
        <Notatka dyskusja={d} trwa={trwa} blad={bladZapisu} onZapisz={onNotatka} />
      </div>
    </Sekcja>
  </div>;
}
