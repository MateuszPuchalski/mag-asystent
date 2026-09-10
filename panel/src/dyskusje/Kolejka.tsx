import React, { useEffect, useRef } from "react";
import { MessageSquareWarning, Headset, Lock, CircleHelp, Scale, Hourglass } from "lucide-react";
import type { Dyskusja, KubelekDyskusji, SygnalDyskusji } from "../api/typy";
import { Pusto } from "../ui";

/* ── Kolejka dyskusji ────────────────────────────────────────────────────────
   Wiersz ma się czytać W BIEGU i niesie PIĘĆ rzeczy: temat, kupującego, numer
   zamówienia, jak długo czeka na nas i sygnały.

   ZDJĘCIA OFERTY TU NIE MA i to nie jest oszczędność. `PostPurchaseIssue.offer`
   jest w schemacie opisane jako nieobecne przy dyskusji, więc nie ma czego
   pokazać — kafel zastępczy przy każdym wierszu byłby kolumną pustych
   prostokątów. Tożsamością sprawy jest tutaj TEMAT, który kupujący wpisał sam.

   Kolejność liczy SERWER (najdłużej czekające na górze) i panel jej nie
   zmienia. Dwie reguły sortowania rozjechałyby się przy pierwszej poprawce
   jednej z nich, a objawem byłby ekran pokazujący inną pilność niż liczniki. */

export const KUBELKI: Array<{ id: KubelekDyskusji; etykieta: string; pytanie: string }> = [
  { id: "odpowiedz", etykieta: "Do odpowiedzi", pytanie: "Co odpisać?" },
  { id: "klient", etykieta: "Czeka na klienta", pytanie: "Ruch po tamtej stronie." },
  { id: "zamknieta", etykieta: "Zamknięte", pytanie: "Tylko wgląd." },
];

/* Etykieta stoi W MAPIE, nie w łańcuchu `?:` przy renderze — ta sama poprawka
   co przy zwrotach w 0.209.0. Łańcuch milcząco podpisywałby każdy nowy sygnał
   ostatnią gałęzią, czyli kłamałby na ekranie zamiast nie przejść kompilacji. */
export const SYGNALY: Record<SygnalDyskusji,
  { tytul: string; krotko: string; ikona: React.ReactNode; klasa: string }> = {
  klient_czeka: { tytul: "Ostatnie słowo nie było nasze — ruch należy do nas",
    krotko: "czeka na nas",
    klasa: "bg-amber-100 text-ranga-uwaga", ikona: <MessageSquareWarning size={13} /> },
  /* Doradca Allegro odpisał jako ostatni w 61 sprawach na 100 w sondzie.
     Przy dyskusji stawia piłkę po NASZEJ stronie — inaczej niż przy
     reklamacji, gdzie o kolejności rozstrzyga zegar. */
  doradca: { tytul: "W rozmowie jest doradca Allegro i czyta wszystko",
    krotko: "doradca",
    klasa: "bg-sky-100 text-sky-800", ikona: <Headset size={13} /> },
  czat_zamkniety: { tytul: "Allegro nie przyjmie już nowej wiadomości w tej dyskusji",
    krotko: "czat zamknięty",
    klasa: "bg-slate-200 text-ranga-nic", ikona: <Lock size={13} /> },
  /* Sonda nie widziała ani jednej na sto, więc gdy się pojawi, jest
     wiadomością samą w sobie: Allegro uznało dyskusję za nierozstrzygniętą. */
  nierozstrzygnieta: { tytul: "Allegro oznaczyło tę dyskusję jako nierozstrzygniętą",
    krotko: "nierozstrzygnięta",
    klasa: "bg-red-100 text-ranga-zle", ikona: <Scale size={13} /> },
  status_nieznany: { tytul: "Allegro przysłało status, którego nie ma w specyfikacji",
    krotko: "status?", klasa: "bg-red-100 text-ranga-zle", ikona: <CircleHelp size={13} /> },
};

/** „1 dzień", ale „2 dni". Polszczyzna ma tu jeden wyjątek i tylko jeden. */
export const dniSlowo = (n: number) => `${n} ${n === 1 ? "dzień" : "dni"}`;

/**
 * Jak długo piłka jest po naszej stronie.
 *
 * TO NIE JEST TERMIN i nie wolno go tak nazwać ani tak pokazać. Allegro dla
 * dyskusji żadnego zegara nie oddaje: `decisionDueDate` i `statusDueDate` są
 * przy niej zawsze puste. Ta liczba jest faktem o NASZEJ skrzynce, więc mówi
 * „czeka", a nie „zostało" — blizna 0.121.0 to ustawowy zegar czternastu dni
 * liczony przez nas i rozjeżdżający się z tym, co widział kupujący.
 *
 * MILCZY, GDY RUCH NIE JEST NASZ. Liczba przy sprawie, przy której nie mamy
 * nic do zrobienia, czytałaby się jak zaległość.
 */
function Czeka({ dni, dlugo }: { dni: number | null; dlugo: boolean }) {
  if (dni === null) return null;
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-bold tabular-nums ${
    dlugo ? "bg-amber-100 text-ranga-uwaga" : "bg-slate-100 text-slate-600"}`}
    title="Tyle czasu minęło od ostatniej wiadomości, która nie była nasza">
    <Hourglass size={12} />{dni === 0 ? "dziś" : dniSlowo(dni)}</span>;
}

export function Kolejka({ dyskusje, wybrana, zKubelkiem = false, onWybierz }: {
  dyskusje: Dyskusja[];
  wybrana: number | null;
  /** Przy szukaniu lista miesza kubełki, więc wiersz musi powiedzieć swój. */
  zKubelkiem?: boolean;
  onWybierz: (id: number) => void;
}) {
  const aktywnyWiersz = useRef<HTMLButtonElement | null>(null);

  /* Kolejka jest zamknięta we własnym scrollerze, więc wybór trzeba DOGONIĆ
     widokiem — inaczej strzałka przesuwa zaznaczenie poza dolną krawędź
     i operator steruje czymś, czego nie widzi. */
  useEffect(() => { aktywnyWiersz.current?.scrollIntoView({ block: "nearest" }); }, [wybrana]);

  if (!dyskusje.length) {
    return <Pusto waga="lista">
      {zKubelkiem
        ? "Żadna dyskusja nie pasuje do tego, czego szukasz."
        : "Ten kubełek jest pusty — nic tu nie czeka na ruch."}</Pusto>;
  }
  return <ul className="divide-y divide-slate-200">
    {dyskusje.map((d) => {
      const aktywna = d.id === wybrana;
      return <li key={d.id}>
        <button
          aria-current={aktywna ? "true" : undefined}
          ref={aktywna ? aktywnyWiersz : null}
          onClick={() => onWybierz(d.id)}
          /* Zaznaczenie szare, marka na belce 3 px — powód przy tej samej
             klauzuli w `skrzynka/Kolejka.tsx`. */
          className={`flex w-full flex-col gap-1 border-l-[3px] px-4 py-3 text-left ${aktywna
            ? "border-l-wertis-amber bg-slate-200"
            : "border-l-transparent hover:bg-slate-50"}`}>
          <div className="flex items-center gap-2">
            {/* TEMAT jest tożsamością sprawy — wpisał go kupujący i to jego
                szuka się oczami. Numer zamówienia stoi niżej. */}
            <span className="truncate font-bold">{d.temat ?? d.externalId}</span>
            {d.prowadzi && <span title={`Prowadzi: ${d.prowadzi}`}
              className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
              {d.prowadzi}</span>}
            <span className="ml-auto" />
            {zKubelkiem && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600">
              {KUBELKI.find((k) => k.id === d.kubelek)?.etykieta}</span>}
            <Czeka dni={d.czekaOdDni} dlugo={d.dlugoCzeka} />
          </div>
          <div className="truncate text-sm text-slate-600">
            {d.kupujacyLogin ?? "bez loginu"}
            {d.orderId ? ` · zamówienie ${d.orderId}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Prośba o zakończenie NIE jest zamknięciem, więc czip mówi
                „poproszono", a nie „zamknięta". Zamknięcie przyniesie dopiero
                `DISPUTE_CLOSED` z synchronizacji. */}
            {d.zakonczenieStatus && <span
              title={`Prośba o zakończenie${d.zakonczeniePrzez ? `: ${d.zakonczeniePrzez}` : ""}`}
              className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
              <Scale size={13} />poproszono o zakończenie</span>}
            {d.sygnaly.map((s) => (
              <span key={s} title={SYGNALY[s].tytul}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${SYGNALY[s].klasa}`}>
                {SYGNALY[s].ikona}{SYGNALY[s].krotko}
              </span>
            ))}
          </div>
        </button>
      </li>;
    })}
  </ul>;
}
