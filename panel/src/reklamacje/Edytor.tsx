import React from "react";
import { Send } from "lucide-react";
import { Przycisk } from "../ui";
import type { ZalacznikSzkicu } from "../api/rozmowy";
import { PrzyciskZalacznika, ZalacznikiWysylki } from "../skrzynka/ZalacznikiWysylki";

/* ── Edytor odpowiedzi w reklamacji (0.224.0) ────────────────────────────────
   OSOBNY komponent, nie `skrzynka/Edytor.tsx`, i to nie jest kopia z lenistwa.
   Tamten ma siedem WYMAGANYCH propsów komentarza z wzmiankami (reklamacja ma
   jedno pole notatki), twardy import paska załączników z listą typów i limitem
   Centrum Wiadomości, oraz napis „WYŚLIJ DO KLIENTA" — który tutaj bywałby
   nieprawdą, bo rozmowa jest trójstronna i odbiorcą bywa doradca Allegro.

   Bierzemy z tamtego WZORCE: licznik znaków przy polu, przycisk martwy przy
   pustej treści, etykieta „WYSYŁAM…" w trakcie. Jedna rzecz jest tu lepsza:
   licznik NIE JEST niemy. W skrzynce limit 2000 znaków pilnuje wyłącznie
   serwer, więc agent dowiaduje się o przekroczeniu dopiero po kliknięciu;
   tutaj limit znamy z `MessageRequest.text` i blokujemy przed wysłaniem.     */

/** Limit z `MessageRequest.text` (`maxLength: 20000`) — dziesięć razy więcej
    niż w Centrum Wiadomości, bo to inny zasób. */
export const LIMIT_ZNAKOW = 20_000;

/** Od ilu znaków przed sufitem licznik przestaje być szary. */
const PROG_OSTRZEZENIA = 500;

export function Edytor({
  tresc, wysyla, blad, czatAktywny, onZmiana, onWyslij,
  zalaczniki = [], dodajeZalacznik = false, bladZalacznika = "",
  onDodajZalacznik, onUsunZalacznik,
}: {
  tresc: string;
  wysyla: boolean;
  blad: string;
  /* ── Załączniki wychodzące (0.274.0) ──────────────────────────────────────
     KOMPONENT JEST TEN SAM CO W SKRZYNCE, nie kopia: decyzja właściciela
     z 0.246.0 o wspólnym załączniku dotyczyła strony przychodzącej, a ta sama
     racja obowiązuje po drugiej stronie. Spinacz i lista mają wyglądać
     i zachowywać się identycznie, bo to ta sama czynność.

     Propsy są OPCJONALNE, żeby dyskusja mogła wołać edytor bez plików, gdyby
     kiedyś tego chciała — a nie żeby ktoś zapomniał ich podać. */
  zalaczniki?: ZalacznikSzkicu[];
  dodajeZalacznik?: boolean;
  bladZalacznika?: string;
  onDodajZalacznik?: (plik: File) => void;
  onUsunZalacznik?: (id: number) => void;
  /** `false` znaczy, że Allegro nie przyjmie już wiadomości w tej sprawie. */
  czatAktywny: boolean;
  onZmiana: (v: string) => void;
  onWyslij: () => void;
}) {
  /* ZAMKNIĘTEJ ROZMOWY NIE DA SIĘ NAPISAĆ, więc edytora tu NIE MA — nie jest
     wyłączony, tylko go nie ma w drzewie. Ta sama decyzja co przy trybie
     komentarza w skrzynce: pole, w które wolno pisać, a którego nie da się
     wysłać, jest obietnicą bez pokrycia. */
  if (!czatAktywny) {
    return <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
      Allegro zamknęło rozmowę w tej sprawie — nowej wiadomości nie przyjmie.
    </p>;
  }

  const znakow = tresc.length;
  const zaDlugo = znakow > LIMIT_ZNAKOW;
  const blisko = !zaDlugo && znakow > LIMIT_ZNAKOW - PROG_OSTRZEZENIA;

  return <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
    <label className="sr-only" htmlFor="odpowiedz-reklamacji">Odpowiedź w sprawie</label>
    <textarea id="odpowiedz-reklamacji" rows={4} value={tresc}
      onChange={(e) => onZmiana(e.target.value)}
      placeholder="Odpowiedź w tej sprawie — przeczyta ją kupujący, a bywa że i doradca Allegro"
      className="field resize-y text-sm" />

    {blad && <p className="text-xs text-red-700">{blad}</p>}

    {/* Lista dołożonych plików stoi PRZY wiadomości, którą się komponuje —
        pokazuje rzeczy, które naprawdę są już u Allegro. */}
    {onUsunZalacznik && <ZalacznikiWysylki lista={zalaczniki} blad={bladZalacznika}
      onUsun={onUsunZalacznik} wylaczone={wysyla} />}

    <div className="flex items-center gap-2">
      {onDodajZalacznik && <PrzyciskZalacznika dodaje={dodajeZalacznik}
        onDodaj={onDodajZalacznik} wylaczone={wysyla} />}
      {/* Licznik mówi, dopiero gdy ma co powiedzieć. Kolor przy progu, a nie
          zawsze — czerwony napis stojący cały czas przestaje być czytany. */}
      <span className={`text-xs tabular-nums ${
        zaDlugo ? "font-bold text-ranga-zle" : blisko ? "text-ranga-uwaga" : "text-slate-500"}`}>
        {znakow} znaków{zaDlugo ? ` — o ${znakow - LIMIT_ZNAKOW} za dużo` : ""}
      </span>
      <Przycisk className="ml-auto" wariant="glowny" onClick={onWyslij}
        disabled={wysyla || zaDlugo || !tresc.trim()}>
        <Send size={16} />{wysyla ? "WYSYŁAM…" : "WYŚLIJ ODPOWIEDŹ"}
      </Przycisk>
    </div>
    {/* Do przyrostu trzeciego stało tu zdanie „formalny werdykt wydaje się
        w Centrum Sprzedaży". Zniknęło razem z paskiem werdyktu nad rozmową —
        komentarz, który skłamał, jest gorszy od jego braku. */}
  </div>;
}
