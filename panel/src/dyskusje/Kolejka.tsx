import React, { useEffect, useRef } from "react";
import { MessageSquareWarning, Headset, Lock, CircleHelp, Scale, Hourglass } from "lucide-react";
import type { Dyskusja, KubelekDyskusji, SygnalDyskusji } from "../api/typy";
import { Pusto, dniSlowo } from "../ui";
import { CzipTagu } from "../sprawy/Tagi";
import { mojaSprawa } from "../sprawy/Moje";
import { krotkiNumerZamowienia } from "../sprawy/numer";

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

/* `dniSlowo` mieszka w `ui/` od audytu z 15 września 2026 — stało w trzech
   kolejkach przepisane znak w znak. Re-eksport zostaje, bo wołają je stąd
   sąsiednie pliki i test tej kolejki. */
export { dniSlowo } from "../ui";

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
function Czeka({ dni, godzin, dlugo, pilna }: {
  dni: number | null; godzin: number | null; dlugo: boolean; pilna: boolean;
}) {
  if (dni === null) return null;
  /* Poniżej doby godziny, nie „dziś": dyskusja, która czeka od rana, ma być
     widoczna jako taka. Alarm (czerwień) bierze próg z serwera, więc wiersz,
     pasek i stan systemu mówią tą samą liczbą. */
  const tekst = dni > 0 ? dniSlowo(dni) : godzin !== null && godzin >= 1 ? `${godzin} godz.` : "dziś";
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-bold tabular-nums ${
    pilna ? "bg-red-100 text-red-900"
      : dlugo ? "bg-amber-100 text-ranga-uwaga" : "bg-slate-100 text-slate-600"}`}
    title={pilna
      ? "Pytanie bez naszej odpowiedzi od tak dawna, że przekroczyło próg alarmu"
      : "Tyle czasu minęło od pytania, na które nie odpowiedzieliśmy"}>
    <Hourglass size={12} />{tekst}</span>;
}

export function Kolejka({ dyskusje, wybrana, zKubelkiem = false, onWybierz, mojeId = null }: {
  dyskusje: Dyskusja[];
  wybrana: number | null;
  /** Przy szukaniu lista miesza kubełki, więc wiersz musi powiedzieć swój. */
  zKubelkiem?: boolean;
  /* Tożsamość zalogowanego (0.281.0). Bez niej czip „Ty" nie ma jak powstać,
     a lista wygląda dokładnie tak, jak wyglądała. */
  mojeId?: number | null;
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
      /* „Czeka na nas" w kubełku „Do odpowiedzi" mówi to, co kubełek: oba
         liczą się z tego samego `ruchNalezyDoNas` (serwer, `services/dyskusje.ts`).
         Czip stojący na KAŻDYM wierszu kubełka nie odróżnia żadnego od żadnego,
         a zabiera rząd. Poza tym kubełkiem (szukanie miesza kubełki) zostaje. */
      const sygnaly = d.sygnaly.filter((s) => !(s === "klient_czeka" && d.kubelek === "odpowiedz"));
      const maCzipy = Boolean(d.zakonczenieStatus) || d.tagi.length > 0 || sygnaly.length > 0;
      return <li key={d.id}>
        <button
          /* Enter na wierszu prowadzi do pola odpowiedzi, jak w skrzynce. */
          data-wiersz-kolejki=""
          aria-current={aktywna ? "true" : undefined}
          ref={aktywna ? aktywnyWiersz : null}
          onClick={() => onWybierz(d.id)}
          /* Zaznaczenie szare, marka na belce 3 px — powód przy tej samej
             klauzuli w `skrzynka/Kolejka.tsx`. */
          className={`flex w-full flex-col gap-1 border-l-[3px] px-4 py-3 text-left ${aktywna
            ? "wiersz-wybrany border-l-wertis-amber bg-slate-200"
            : "border-l-transparent hover:bg-slate-50"}`}>
          {/* `items-start`: temat bywa dwulinijkowy, a czipy i czas mają stać
              przy jego pierwszej linii, nie w połowie wysokości. */}
          <div className="flex items-start gap-2">
            {/* TEMAT jest tożsamością sprawy i POWODEM — wpisał go kupujący
                i to jego szuka się oczami. Zawija się do dwóch linii, bo
                ucięty w pół zdania („brak zwrotu wpłaty po odesłaniu...")
                nie mówi, o co chodzi, a to jest pierwsze pytanie agenta. */}
            <span className="line-clamp-2 min-w-0 font-bold" title={d.temat ?? undefined}>
              {d.temat ?? d.externalId}</span>
            {/* ── CZIP MÓWI „TY", GDY SPRAWA JEST MOJA (0.281.0) ─────────────
                Właściciel pytał wprost: „które reklamacje są moje". Samo imię
                na to nie odpowiada — dwie osoby w biurze bywają imienniczkami,
                a przy własnym nazwisku i tak trzeba je przeczytać. Rozstrzyga
                NUMER KONTA, ten sam, po którym liczy się sito.

                Odpowiedź stoi na wierszu, bez włączania jakiegokolwiek filtru:
                sito zawęża listę, a to jest pytanie zadawane przy przeglądaniu
                całej kolejki. */}
            {d.prowadzi && <span
              title={mojaSprawa(d.prowadziId, mojeId)
                ? `Prowadzisz tę sprawę (${d.prowadzi})` : `Prowadzi: ${d.prowadzi}`}
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${
                mojaSprawa(d.prowadziId, mojeId)
                  ? "bg-emerald-700 text-white" : "bg-emerald-100 text-emerald-800"}`}>
              {mojaSprawa(d.prowadziId, mojeId) ? "Ty" : d.prowadzi}</span>}
            <span className="ml-auto" />
            {zKubelkiem && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600">
              {KUBELKI.find((k) => k.id === d.kubelek)?.etykieta}</span>}
            <Czeka dni={d.czekaOdDni} godzin={d.czekaOdGodzin} dlugo={d.dlugoCzeka} pilna={d.pilna} />
          </div>
          {/* LOGIN PRZED NUMEREM, decyzją właściciela: kto pisze i o co, to
              pytania zadawane przy każdym wierszu, a numer zamówienia —
              dopiero w sprawie. Login jest kluczem klienta, więc stoi
              wyraźnie. Numer zostaje drobnym dopiskiem, bo szukanie po nim
              działa i przy telefonie od klienta trzeba go zobaczyć. */}
          <div className="flex min-w-0 items-baseline gap-2"
            title={d.orderId ? `Zamówienie ${d.orderId}` : undefined}>
            <span className="truncate text-sm font-semibold text-slate-800">
              {d.kupujacyLogin ?? "bez loginu"}</span>
            {d.orderId && <span className="shrink-0 text-xs text-slate-600">
              zam. {krotkiNumerZamowienia(d.orderId)}</span>}
          </div>
          {maCzipy && <div className="flex flex-wrap items-center gap-1.5">
            {/* Prośba o zakończenie NIE jest zamknięciem, więc czip mówi
                „poproszono", a nie „zamknięta". Zamknięcie przyniesie dopiero
                `DISPUTE_CLOSED` z synchronizacji. */}
            {d.zakonczenieStatus && <span
              title={`Prośba o zakończenie${d.zakonczeniePrzez ? `: ${d.zakonczeniePrzez}` : ""}`}
              className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
              <Scale size={13} />poproszono o zakończenie</span>}
            {/* Tagi przed sygnałami — powód przy tej samej linii
                w `reklamacje/Kolejka.tsx`. */}
            {d.tagi.map((t) => <CzipTagu key={t.id} nazwa={t.nazwa} />)}
            {sygnaly.map((s) => (
              <span key={s} title={SYGNALY[s].tytul}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${SYGNALY[s].klasa}`}>
                {SYGNALY[s].ikona}{SYGNALY[s].krotko}
              </span>
            ))}
          </div>}
        </button>
      </li>;
    })}
  </ul>;
}
