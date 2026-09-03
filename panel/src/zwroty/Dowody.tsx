import React, { useState } from "react";
import {
  CalendarClock, MessageSquare, Package, Receipt, RefreshCw, ShoppingCart, Undo2,
} from "lucide-react";
import type { KandydatFaktury, PozycjaZwrotu, Zwrot } from "../api/typy";
import { Dokument, ikonaDokumentu } from "./Dokument";
import { useDociagnijZamowienia, zlote } from "../api/zwroty";
import { czas, Plakietka, Skopiuj } from "../ui";
import { Link } from "./Link";

/* Kolumna dowodów: wszystko, co trzeba przeczytać, ZANIM padnie decyzja.
   Akcji tu nie ma — te stoją w pasku werdyktu i mają być jedynym miejscem,
   gdzie coś się dzieje. Wyjątkiem są odnośniki: one nie zmieniają niczego
   u nas, tylko skracają drogę do Allegro, gdy naprawdę trzeba tam wejść.

   Od 0.167.0 to kolumna o ZWROCIE, nie o towarze: zegar ustawowy, numery,
   zamówienie klienta, fakt powrotu paczki. Produkty przeniosły się do
   głównego okna (`Pozycje.tsx`), bo 340 px ucinało im nazwy w połowie. */

/* Przewoźnicy i formy płatności po polsku. Kod nieznany pokazuje się SUROWY,
   bo Allegro nie publikuje zamkniętej listy przewoźników — sonda złapała
   `UNKNOWN`, którego nie ma w żadnej specyfikacji. */
const PRZEWOZNICY: Record<string, string> = {
  INPOST: "InPost", DPD: "DPD", ALLEGRO: "Allegro", POCZTA_POLSKA: "Poczta Polska",
  DHL: "DHL", UPS: "UPS", GLS: "GLS", FEDEX: "FedEx", UNKNOWN: "nieznany",
};

const PLATNOSCI: Record<string, string> = {
  ONLINE: "online", CASH_ON_DELIVERY: "za pobraniem", WIRE_TRANSFER: "przelew",
  SPLIT_PAYMENT: "podzielona", EXTENDED_TERM: "odroczona",
};

/* Statusy przesyłki z `/order/carriers/{id}/tracking` (0.187.0). Osiem kodów
   wymienia specyfikacja; nieznany pokazuje się SUROWY, jak przewoźnik. */
const PRZESYLKA: Record<string, string> = {
  PENDING: "Przygotowana, czeka na nadanie.",
  IN_TRANSIT: "W drodze do nas.",
  RELEASED_FOR_DELIVERY: "Wydana do doręczenia.",
  AVAILABLE_FOR_PICKUP: "Czeka do odbioru.",
  NOTICE_LEFT: "Awizo — próba doręczenia nie powiodła się.",
  ISSUE: "Problem z przesyłką.",
  RETURNED: "Wraca do nadawcy.",
};

const ODRZUCENIA: Record<string, string> = {
  REFUND_REJECTED: "odmowa zwrotu pieniędzy",
  NEW_ITEM_SENT: "wysłano nowy towar",
  ITEM_FIXED: "towar naprawiono",
  MISSING_PART_SENT: "dosłano brakującą część",
};

const Sekcja = ({ ikona, tytul, children }: {
  ikona: React.ReactNode; tytul: string; children: React.ReactNode;
}) => <section className="border-b border-slate-200 p-4 last:border-0">
  <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
    {ikona}{tytul}</h3>
  {children}
</section>;

/**
 * Ręczne dociągnięcie zamówień.
 *
 * Stoi DOKŁADNIE tam, gdzie widać jego brak — w sekcji zamówienia, pod
 * zdaniem „jeszcze nie pobrano". Bez niego jedyną odpowiedzią na „czemu ta
 * pozycja nie ma kartoteki" było czekanie dziesięciu minut na ticker.
 *
 * To jest ZAPIS na ekranie, który poza tym tylko czyta, i dlatego wymaga
 * kliknięcia: „zero zapisu przy patrzeniu" znaczy, że otwarcie ekranu niczego
 * nie mutuje, a nie że ekran nie ma prawa mieć przycisku.
 */
function DociagnijZamowienia() {
  const dociagnij = useDociagnijZamowienia();
  return <div className="mt-2">
    <button type="button" disabled={dociagnij.isPending}
      onClick={() => dociagnij.mutate()}
      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      <RefreshCw size={12} className={dociagnij.isPending ? "animate-spin" : ""} />
      {dociagnij.isPending ? "Pobieram…" : "Dociągnij teraz"}
    </button>
    {dociagnij.error && <p className="mt-1 text-xs text-red-700">
      {(dociagnij.error as Error).message}</p>}
    {dociagnij.isSuccess && <p className="mt-1 text-xs text-slate-500">
      Pobrano zamówień: {dociagnij.data?.pobrano ?? 0}.</p>}
  </div>;
}

export function Dowody({ zwrot, kandydaciFaktury = [], fakturaTrwa = false,
  fakturaBlad = "", onFaktura }: {
  zwrot: Zwrot;
  kandydaciFaktury?: KandydatFaktury[];
  fakturaTrwa?: boolean;
  fakturaBlad?: string;
  /** Brak = kolumna nie proponuje wskazania (przycisk bez działania kłamie). */
  onFaktura?: (dokId: number | null) => void;
}) {
  const zam = zwrot.zamowienie;

  return <div className="text-sm">
    <Sekcja ikona={<CalendarClock size={14} />} tytul="Zegar ustawowy">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-500">Zgłoszony</dt><dd>{czas(zwrot.utworzono)}</dd>
        <dt className="text-slate-500">Termin</dt>
        <dd className={zwrot.dniDoTerminu <= 3 ? "font-bold text-ranga-zle" : ""}>
          {czas(zwrot.terminAt)}</dd>
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        Termin liczony od zgłoszenia zwrotu. Ustawa liczy go od otrzymania
        oświadczenia — te dwa momenty nie muszą być tym samym.</p>
    </Sekcja>

    <Sekcja ikona={<Undo2 size={14} />} tytul="Zwrot">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
        <dt className="text-slate-500">Numer</dt>
        <dd><Link href={zwrot.linkZwrotu}>{zwrot.numer ?? zwrot.externalId}</Link></dd>
        {/* Login stoi PRZY ZWROCIE, więc widać go także wtedy, gdy zamówienia
            jeszcze nie pobrano. To jedyna dana osobowa, którą polityka danych
            zwrotów dopuszcza wprost — imienia Allegro tu nie podaje wcale.

            WIERSZ STOI ZAWSZE (0.177.0). Do 0.176.0 znikał przy pustym polu,
            więc na ekranie nie było ani loginu, ani śladu po nim — a właściciel
            szukał go i nie znalazł. Puste pole ma powiedzieć, że to Allegro go
            nie podało, a nie zostawiać ekran, który o kupującym milczy. */}
        <dt className="text-slate-500">Kupujący</dt>
        <dd className="flex items-center gap-1 break-all">
          {zwrot.kupujacyLogin
            ? <>{zwrot.kupujacyLogin}
                <Skopiuj tekst={zwrot.kupujacyLogin} tytul="Kopiuj login kupującego" /></>
            : <span className="text-slate-400">Allegro nie podało</span>}</dd>
        {zwrot.przewoznik && <>
          <dt className="text-slate-500">Przewoźnik</dt>
          <dd>{PRZEWOZNICY[zwrot.przewoznik] ?? zwrot.przewoznik}</dd></>}
      </dl>
    </Sekcja>

    <Sekcja ikona={<ShoppingCart size={14} />} tytul="Zamówienie">
      {!zam
        ? <>
            <div className="flex items-center gap-1">
              <span className="break-all font-mono text-xs">{zwrot.orderId ?? "—"}</span>
              {zwrot.orderId && <Skopiuj tekst={zwrot.orderId} />}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {zwrot.orderId
                ? `Treści zamówienia jeszcze nie pobrano — dociągnie ją najbliższa
                   synchronizacja. Bez niej pozycje zwrotu nie mają skąd wziąć kartoteki.`
                : `Allegro nie podało przy tym zwrocie numeru zamówienia. Bez niego
                   nie ma czego dociągnąć ani z czego wziąć kartoteki.`}</p>
            {/* Przycisk tylko wtedy, gdy JEST co pobrać. Przy zwrocie bez numeru
                zamówienia dociąganie nie zmieni niczego, a obiecywałoby, że
                zmieni. */}
            {zwrot.orderId && <DociagnijZamowienia />}
          </>
        : <>
            <div className="flex items-center gap-1">
              <Link href={zam.link}>Otwórz w Allegro</Link>
              <Skopiuj tekst={zam.externalId} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {zam.kupionoAt && <><dt className="text-slate-500">Kupione</dt>
                <dd>{czas(zam.kupionoAt)}</dd></>}
              {zam.dostawaMetoda && <><dt className="text-slate-500">Dostawa</dt>
                <dd>{zam.dostawaMetoda} · {zlote(zam.dostawaGrosze, zam.waluta)}</dd></>}
              <dt className="text-slate-500">Zapłacono</dt>
              <dd className="tabular-nums">{zlote(zam.sumaGrosze, zam.waluta)}</dd>
              {/* Forma płatności to przy zwrocie nie ciekawostka: przy pobraniu
                  nie ma karty, na którą oddać pieniądze. */}
              {zam.platnoscTyp && <><dt className="text-slate-500">Płatność</dt>
                <dd>{PLATNOSCI[zam.platnoscTyp] ?? zam.platnoscTyp}</dd></>}
              {/* NAZWA WIERSZA, nie treść (0.176.0). Stało tu „Dokument" i to
                  samo słowo tytułowało sekcję z numerem paragonu z Subiekta —
                  więc „Dokument: nie wiadomo" czytało się jako „nie znaleziono
                  dokumentu sprzedaży", stojąc obok znalezionego. To zdanie
                  mówi o ŻYCZENIU KLIENTA i tylko o nim.

                  `null` znaczy „nie wiadomo" i tak się pokazuje — paragon
                  wpisany na ślepo kazałby wystawić niewłaściwą korektę. */}
              <dt className="text-slate-500">Klient chciał</dt>
              <dd>{zam.fakturaZadana == null
                ? <span className="text-slate-400">nie wiadomo</span>
                : zam.fakturaZadana ? "faktury" : "paragonu"}</dd>
            </dl>
            {/* CAŁE zamówienie, nie tylko zwracane pozycje: „kupił trzy,
                oddaje jedną" jest kontekstem decyzji, a nie ciekawostką. */}
            <ul className="mt-3 space-y-1">
              {zam.pozycje.map((p, i) => <li key={`${p.offerId}-${i}`}
                className={`flex items-baseline gap-2 rounded px-2 py-1 text-xs ${
                  p.zwracana ? "bg-amber-50 font-semibold" : "text-slate-600"}`}>
                <span className="truncate">{p.nazwa}</span>
                <span className="ml-auto shrink-0 tabular-nums">
                  {p.ilosc} × {zlote(p.cenaGrosze, p.waluta)}</span>
                {/* PLAKIETKA NIESIE SZTUKI (0.176.0). Samo „wraca" stało obok
                    liczby KUPIONYCH sztuk, więc „2 × 18,99 wraca" czytało się
                    jako „wracają dwie" przy zwrocie jednej. Przy zwrocie
                    całości „z 2" byłoby szumem — dlatego pada tylko wtedy,
                    gdy część zakupu zostaje u klienta. */}
                {p.zwracana && <span className="shrink-0 rounded bg-amber-200 px-1 text-[10px] uppercase">
                  wraca {p.wracaIlosc}{p.wracaIlosc < p.ilosc ? ` z ${p.ilosc}` : ""}</span>}
              </li>)}
            </ul>
          </>}

      {/* ── Dokument sprzedaży (0.174.0, wciągnięty do zamówienia w 0.176.0) ──
          Do 0.175.0 stał osobną sekcją NA DNIE kolumny, pod wiadomościami —
          czyli daleko od zamówienia, którego dotyczy, i pod wierszem
          „Dokument", który mówił o czym innym. Właściciel powiedział wprost:
          „dokument sprzedaży powinien być w zamówieniu". To jego druga strona:
          zamówienie mówi, co klient kupił w Allegro, dokument — pod jakim
          numerem ta sprzedaż stoi w Subiekcie. Po tym numerze biuro wystawia
          korektę.

          Stoi POZA rozgałęzieniem `zam`, bo wiąże go numer zamówienia, a nie
          jego pobrana treść: dokument bywa znany, zanim ticker dociągnie
          pozycje. */}
      {onFaktura && <div className="mt-3 border-t border-slate-200 pt-2">
        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {ikonaDokumentu} Dokument sprzedaży</p>
        <Dokument faktura={zwrot.faktura} kandydaci={kandydaciFaktury}
          trwa={fakturaTrwa} blad={fakturaBlad} onWskaz={onFaktura} />
      </div>}
    </Sekcja>

    <Sekcja ikona={<Package size={14} />} tytul="Paczka zwrotna">
      {/* „Nadana", nie „wróciła" (0.169.0): przy paczce stoi data jej
          UTWORZENIA przez klienta. Do 0.167.0 ekran nazywał ją powrotem
          towaru i to było nieprawdą.

          DRUGA NIEPRAWDA, zdjęta w 0.187.0: stało tu „Allegro nie podaje daty
          doręczenia do nas". Podaje — tyle że nie w obiekcie zwrotu, lecz
          w `/order/carriers/{id}/tracking`, gdzie każda zmiana statusu ma
          `occurredAt`. Zdanie wzięło się ze zbyt wąskiego czytania jednego
          schematu i przez trzy wydania mówiło operatorowi, że czegoś nie da
          się wiedzieć. */}
      {zwrot.paczkaAt
        ? <>
            <p>Nadana przez klienta {czas(zwrot.paczkaAt)}.</p>
            {zwrot.dostarczonoAt
              ? <p className="mt-1 font-semibold text-ranga-ok">
                  Doręczona do nas {czas(zwrot.dostarczonoAt)}.</p>
              : <p className="mt-1 font-semibold text-ranga-uwaga">
                  {PRZESYLKA[zwrot.przesylkaStatus ?? ""]
                    ?? "Jeszcze do nas nie dotarła."}</p>}
            {/* Kod przewoźnika surowo, gdy go nie znamy — ta sama zasada co
                przy `carrierId`: lista nie jest zamknięta. */}
            {zwrot.przesylkaStatus && !PRZESYLKA[zwrot.przesylkaStatus] &&
              <p className="mt-1 text-xs text-slate-500">
                Przewoźnik mówi: {zwrot.przesylkaStatus}.</p>}
          </>
        : <p className="font-semibold text-ranga-uwaga">
            Klient nie nadał jeszcze paczki, a termin biegnie.</p>}
      <p className="mt-2 text-xs text-slate-500">
        Danych nadawcy i konta bankowego nie pobieramy.</p>
    </Sekcja>

    {/* ── Wiadomości o tym zakupie (0.169.0) ─────────────────────────────────
        Mostkiem jest numer zamówienia przy wiadomości (`related_order_id`,
        mapowany od 0.166.0) — ani jednego nowego żądania do Allegro.

        Pusty wynik mówi „Allegro nic nie powiązało", a nie „klient nie
        pisał". To dwa różne zdania i tylko pierwsze jest prawdziwe: Allegro
        oznacza zamówieniem tylko część wiadomości, a klient piszący z poziomu
        oferty tym mostkiem się nie znajdzie. */}
    <Sekcja ikona={<MessageSquare size={14} />} tytul="Wiadomości o tym zakupie">
      {zwrot.rozmowy.length === 0
        ? <p className="text-xs text-slate-500">
            Allegro nie powiązało z tym zamówieniem żadnej wiadomości.</p>
        : <ul className="space-y-1">
            {zwrot.rozmowy.map((r) => <li key={r.id}>
              <a href={`/obsluga/skrzynka/${r.id}`}
                className="block rounded-lg bg-slate-50 px-2 py-1 hover:bg-slate-100">
                <span className="font-semibold text-sky-700 underline underline-offset-2">
                  {r.temat?.trim() || "Rozmowa bez tematu"}</span>
                <span className="ml-2 text-xs text-slate-500">{czas(r.ostatniaAt)}</span>
                <Plakietka status={r.status} className="ml-2">{r.status}</Plakietka>
              </a>
            </li>)}
          </ul>}
    </Sekcja>

    {zwrot.rejectionCode && <Sekcja ikona={<Receipt size={14} />} tytul="Rozstrzygnięte w Allegro">
      <p className="font-semibold">{ODRZUCENIA[zwrot.rejectionCode] ?? zwrot.rejectionCode}</p>
    </Sekcja>}

  </div>;
}
