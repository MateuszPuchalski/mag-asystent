import React from "react";
import { CalendarClock, Package, Receipt, ShoppingCart } from "lucide-react";
import type { Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { czas } from "../ui";

/* Kolumna dowodów: wszystko, co trzeba przeczytać, ZANIM padnie decyzja.
   Nic tu nie jest klikalne, bo to nie jest miejsce na akcję — akcja stoi
   w pasku werdyktu i ma być jedynym miejscem, gdzie się coś dzieje. */

const POWODY: Record<string, string> = {
  NONE: "bez powodu", MISTAKE: "pomyłka klienta", TRANSPORT: "uszkodzenie w transporcie",
  DAMAGED: "towar uszkodzony", NOT_AS_DESCRIBED: "niezgodny z opisem",
  DONT_LIKE_IT: "nie spodobał się", OVERDUE_DELIVERY: "dostawa po terminie",
  INCOMPLETE: "niekompletny", HIDDEN_FLAW: "wada ukryta", OTHER_FLAW: "inna wada",
  DIFFERENT: "inny towar",
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

export function Dowody({ zwrot }: { zwrot: Zwrot }) {
  return <div className="text-sm">
    <Sekcja ikona={<CalendarClock size={14} />} tytul="Zegar ustawowy">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-500">Zgłoszony</dt><dd>{czas(zwrot.utworzono)}</dd>
        <dt className="text-slate-500">Termin</dt>
        <dd className={zwrot.dniDoTerminu <= 3 ? "font-bold text-ranga-zle" : ""}>
          {czas(zwrot.terminAt)}</dd>
      </dl>
      {/* Założenie widoczne na ekranie, nie tylko w kodzie: liczymy od
          zgłoszenia, bo tego momentu Allegro nie rozdziela od doręczenia. */}
      <p className="mt-2 text-xs text-slate-500">
        Termin liczony od zgłoszenia zwrotu. Ustawa liczy go od otrzymania
        oświadczenia — te dwa momenty nie muszą być tym samym.</p>
    </Sekcja>

    <Sekcja ikona={<ShoppingCart size={14} />} tytul="Zamówienie">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-500">Numer zwrotu</dt><dd>{zwrot.numer ?? "—"}</dd>
        <dt className="text-slate-500">Zamówienie</dt>
        <dd className="break-all">{zwrot.orderId ?? "—"}</dd>
      </dl>
    </Sekcja>

    <Sekcja ikona={<Package size={14} />} tytul="Paczka zwrotna">
      {zwrot.paczkaAt
        ? <p>Wróciła {czas(zwrot.paczkaAt)}.</p>
        : <p className="font-semibold text-ranga-uwaga">
            Towar jeszcze nie wrócił, a termin biegnie.</p>}
      {/* Danych nadawcy nie pobieramy wcale — to jest decyzja z polityki
          danych, więc ekran mówi o niej wprost zamiast milczeć. */}
      <p className="mt-2 text-xs text-slate-500">
        Danych nadawcy i konta bankowego nie pobieramy.</p>
    </Sekcja>

    <Sekcja ikona={<Receipt size={14} />} tytul="Pozycje">
      {zwrot.pozycje.length === 0
        ? <p className="text-slate-500">Zwrot bez pozycji — nie ma czego wycenić.</p>
        : <ul className="space-y-2">
            {zwrot.pozycje.map((p) => <li key={p.id} className="rounded-lg bg-slate-50 p-2">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{p.nazwa}</span>
                <span className="ml-auto tabular-nums">{zlote(p.cenaGrosze, p.waluta)}</span>
              </div>
              <div className="text-xs text-slate-600">
                {p.ilosc} szt.{p.powod ? ` · ${POWODY[p.powod] ?? p.powod}` : ""}
                {p.ocena ? ` · ocena: ${p.ocena}` : ""}
              </div>
              {p.powodKomentarz && <p className="mt-1 text-xs italic text-slate-600">
                „{p.powodKomentarz}"</p>}
            </li>)}
          </ul>}
      <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-2">
        <span className="font-bold">Suma pozycji</span>
        <span className="text-lg font-bold tabular-nums">
          {zlote(zwrot.sumaPozycjiGrosze, zwrot.waluta)}</span>
      </div>
      {/* Kwota pełna to pozycje PLUS dostawa, a kosztu dostawy zwrot nie
          niesie — siedzi przy zamówieniu. Ekran ma mówić, czego nie wie. */}
      <p className="mt-1 text-xs text-slate-500">
        Bez kosztu dostawy — ten stoi przy zamówieniu, nie przy zwrocie.</p>
    </Sekcja>

    {zwrot.rejectionCode && <Sekcja ikona={<Receipt size={14} />} tytul="Rozstrzygnięte w Allegro">
      <p className="font-semibold">{ODRZUCENIA[zwrot.rejectionCode] ?? zwrot.rejectionCode}</p>
    </Sekcja>}
  </div>;
}
