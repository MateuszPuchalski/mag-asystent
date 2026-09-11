import React, { useEffect, useRef } from "react";
import {
  AlertTriangle, MessageSquareWarning, Headset, Lock, PackageCheck, CircleHelp,
  Gavel, CircleX, PackageSearch,
} from "lucide-react";
import type { KubelekReklamacji, Reklamacja, SygnalReklamacji } from "../api/typy";
import { zlote } from "../api/zwroty";
import { ZdjecieOferty } from "../towar/Zdjecie";
import { Pusto } from "../ui";
import { CzipTagu } from "../sprawy/Tagi";

/* ── Kolejka reklamacji ──────────────────────────────────────────────────────
   Wiersz ma się czytać W BIEGU, więc niesie SIEDEM rzeczy i ani jednej więcej:
   zdjęcie, numer, klienta, powód, czego klient chce, dni do terminu decyzji
   i sygnały. Wszystko, co trzeba doczytać, siedzi w kolumnie dowodów po prawej.

   ZDJĘCIE JEST TOŻSAMOŚCIĄ SPRAWY (0.223.0), nie ozdobą. Reklamacja dotyczy
   jednej oferty, a „pękła obudowa" przy zdjęciu kosiarki czyta się w biegu —
   przy samym numerze wymaga otwarcia sprawy. Bierzemy obraz OFERTY, nie
   kartoteki: klient reklamuje to, co kupił, a kartoteka bywa niepowiązana.
   Kafel ma stały rozmiar także wtedy, gdy obrazu nie ma — rosnący przesuwałby
   wiersze pod kursorem (lekcja z `biuro.html`).

   Kolejność liczy SERWER (najkrótszy termin na górze) i panel jej nie zmienia.
   Dwie reguły sortowania rozjechałyby się przy pierwszej poprawce jednej
   z nich, a objawem byłby ekran pokazujący inną pilność niż liczniki. */

export const KUBELKI: Array<{ id: KubelekReklamacji; etykieta: string; pytanie: string }> = [
  { id: "decyzja", etykieta: "Do decyzji", pytanie: "Uznać czy odrzucić?" },
  { id: "odpowiedz", etykieta: "Do odpowiedzi", pytanie: "Co odpisać klientowi?" },
  { id: "zamknieta", etykieta: "Rozstrzygnięte", pytanie: "Tylko wgląd." },
];

/* Etykieta stoi W MAPIE, nie w łańcuchu `?:` przy renderze — ta sama poprawka
   co przy zwrotach w 0.209.0. Łańcuch milcząco podpisywałby każdy nowy sygnał
   ostatnią gałęzią, czyli kłamałby na ekranie zamiast nie przejść kompilacji. */
export const SYGNALY: Record<SygnalReklamacji,
  { tytul: string; krotko: string; ikona: React.ReactNode; klasa: string }> = {
  termin: { tytul: "Termin decyzji blisko albo minął", krotko: "termin",
    klasa: "bg-red-100 text-ranga-zle", ikona: <AlertTriangle size={13} /> },
  klient_czeka: { tytul: "Ostatnie słowo było klienta — ruch należy do nas",
    krotko: "klient czeka",
    klasa: "bg-amber-100 text-ranga-uwaga", ikona: <MessageSquareWarning size={13} /> },
  /* Doradca Allegro odpisał w 61 sprawach na 100 w sondzie z żywego konta.
     To nie jest przypadek brzegowy i zmienia ton odpowiedzi: w rozmowie jest
     trzecia strona, która czyta wszystko. */
  doradca: { tytul: "W rozmowie jest doradca Allegro", krotko: "doradca",
    klasa: "bg-sky-100 text-sky-800", ikona: <Headset size={13} /> },
  czat_zamkniety: { tytul: "Allegro nie przyjmie już nowej wiadomości w tej sprawie",
    krotko: "czat zamknięty",
    klasa: "bg-slate-200 text-ranga-nic", ikona: <Lock size={13} /> },
  zwrot_wymagany: { tytul: "Sprzedawca zażądał zwrotu towaru", krotko: "zwrot towaru",
    klasa: "bg-violet-100 text-violet-800", ikona: <PackageCheck size={13} /> },
  /* Status spoza specyfikacji NIE JEST BŁĘDEM: nie wywraca przebiegu i nie
     znika z ekranu. To jest mechanizm weryfikacji listy na żywym koncie. */
  status_nieznany: { tytul: "Allegro przysłało status, którego nie ma w specyfikacji",
    krotko: "status?", klasa: "bg-red-100 text-ranga-zle", ikona: <CircleHelp size={13} /> },
  /* Los NASZEGO werdyktu (przyrost trzeci). `statusAllegro` należy do Allegro
     i mówi o nim dopiero po synchronizacji — do tego czasu wiersz ma powiedzieć,
     że decyzja zapadła i czeka na potwierdzenie, a nie milczeć. */
  werdykt_niepotwierdzony: { tytul: "Werdykt wysłany z panelu — Allegro jeszcze nie potwierdziło",
    krotko: "werdykt czeka", klasa: "bg-amber-100 text-ranga-uwaga", ikona: <Gavel size={13} /> },
  werdykt_nieudany: { tytul: "Allegro odrzuciło werdykt kodem — spróbuj jeszcze raz",
    krotko: "werdykt nieudany", klasa: "bg-red-100 text-ranga-zle", ikona: <CircleX size={13} /> },
  towar_do_decyzji: { tytul: "Reklamacja uznana, a kupujący nie wie, czy odsyłać towar",
    krotko: "towar?", klasa: "bg-violet-100 text-violet-800", ikona: <PackageSearch size={13} /> },
};

/** Powody z `PostPurchaseIssueReason.type` po polsku. Nieznany zostaje SUROWY. */
export const POWODY: Record<string, string> = {
  DEFECT_FOUND_DURING_USE: "usterka przy używaniu",
  NOT_AS_DESCRIBED: "niezgodny z opisem",
  MISSING_PRODUCT_ELEMENT: "brakuje elementu",
  PRODUCT_DAMAGED_PARCEL_INTACT: "uszkodzony, paczka cała",
  PRODUCT_AND_PARCEL_DAMAGED_IN_TRANSIT: "uszkodzony w transporcie",
  NO_PRODUCT_RECEIVED: "towar nie dotarł",
  NO_PRODUCT_IN_PARCEL: "brak towaru w paczce",
  NO_PROOF_OF_PURCHASE_MANUAL_OR_WARRANTY: "brak dowodu zakupu",
  ITEM_IS_DAMAGED: "towar uszkodzony",
  RECEIVED_INCOMPLETE_ORDER: "niekompletne zamówienie",
  RECEIVED_ITEMS_NOT_MATCHING_DESCRIPTION: "towar niezgodny z opisem",
  OTHER: "inny powód",
};

/** Czego klient chce — `PostPurchaseIssueExpectation.name`. */
export const OCZEKIWANIA: Record<string, string> = {
  REPAIR: "naprawa",
  EXCHANGE: "wymiana",
  REFUND: "zwrot pieniędzy",
  PARTIAL_REFUND: "częściowy zwrot",
};

/** „1 dzień", ale „2 dni". Polszczyzna ma tu jeden wyjątek i tylko jeden. */
export const dniSlowo = (n: number) => `${n} ${n === 1 ? "dzień" : "dni"}`;

/**
 * Dni do terminu decyzji — jedyna liczba na wierszu, którą czyta się jako pilność.
 *
 * BRAK TERMINU MÓWI TO WPROST. Allegro nie podaje `decisionDueDate` dla
 * każdej sprawy, a puste miejsce w kolumnie pilności czytałoby się jako „zdąży
 * się" — czyli odwrotnie, niż trzeba.
 */
function Termin({ dni }: { dni: number | null }) {
  if (dni === null) {
    return <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600"
      title="Allegro nie podało terminu decyzji przy tej sprawie">bez terminu</span>;
  }
  const pilne = dni <= 3;
  const tekst = dni < 0 ? `${dniSlowo(Math.abs(dni))} po` : dni === 0 ? "dziś" : dniSlowo(dni);
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums ${
    pilne ? "bg-red-100 text-ranga-zle" : "bg-slate-100 text-slate-600"}`}
    title={`Termin decyzji: ${dni < 0 ? "przekroczony" : "za " + dniSlowo(dni)}`}>{tekst}</span>;
}

export function Kolejka({ reklamacje, wybrana, zKubelkiem = false, onWybierz }: {
  reklamacje: Reklamacja[];
  wybrana: number | null;
  /** Przy szukaniu lista miesza kubełki, więc wiersz musi powiedzieć swój. */
  zKubelkiem?: boolean;
  onWybierz: (id: number) => void;
}) {
  const aktywnyWiersz = useRef<HTMLButtonElement | null>(null);

  /* Kolejka jest zamknięta we własnym scrollerze, więc wybór trzeba DOGONIĆ
     widokiem — inaczej strzałka przesuwa zaznaczenie poza dolną krawędź
     i operator steruje czymś, czego nie widzi. Ta sama mechanika co przy
     zwrotach od 0.165.0. */
  useEffect(() => { aktywnyWiersz.current?.scrollIntoView({ block: "nearest" }); }, [wybrana]);

  if (!reklamacje.length) {
    return <Pusto waga="lista">
      {zKubelkiem
        ? "Żadna reklamacja nie pasuje do tego, czego szukasz."
        : "Ten kubełek jest pusty — nic tu nie czeka na ruch."}</Pusto>;
  }
  return <ul className="divide-y divide-slate-200">
    {reklamacje.map((r) => {
      const aktywna = r.id === wybrana;
      return <li key={r.id}>
        <button
          aria-current={aktywna ? "true" : undefined}
          ref={aktywna ? aktywnyWiersz : null}
          onClick={() => onWybierz(r.id)}
          /* Zaznaczenie szare, marka na belce 3 px — powód przy tej samej
             klauzuli w `skrzynka/Kolejka.tsx`. */
          className={`flex w-full gap-3 border-l-[3px] px-4 py-3 text-left ${aktywna
            ? "border-l-wertis-amber bg-slate-200"
            : "border-l-transparent hover:bg-slate-50"}`}>
          <ZdjecieOferty externalId={r.offerId} stan={r.ofertaZdjecie} rozmiar={44}
            nazwa={r.ofertaNazwa ?? r.numer ?? r.externalId} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-bold">{r.numer ?? r.externalId}</span>
            {r.prowadzi && <span title={`Prowadzi: ${r.prowadzi}`}
              className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
              {r.prowadzi}</span>}
            <span className="ml-auto" />
            {zKubelkiem && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-600">
              {KUBELKI.find((k) => k.id === r.kubelek)?.etykieta}</span>}
            <Termin dni={r.dniDoTerminu} />
          </div>
          {/* Nazwa oferty PRZED loginem: agent szuka oczami towaru, nie
              klienta. Bez snapshotu zostaje sam login i powód. */}
          {r.ofertaNazwa && <div className="truncate text-sm text-slate-800">
            {r.ofertaNazwa}</div>}
          <div className="truncate text-sm text-slate-600">
            {r.kupujacyLogin ?? "bez loginu"}
            {r.powodTyp ? ` · ${POWODY[r.powodTyp] ?? r.powodTyp}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {r.oczekiwanie && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-bold">
              {OCZEKIWANIA[r.oczekiwanie] ?? r.oczekiwanie}
              {r.oczekiwanaKwotaGrosze !== null
                ? ` · ${zlote(r.oczekiwanaKwotaGrosze, r.waluta)}` : ""}</span>}
            {/* Werdykt z PANELU na wierszu rozstrzygniętym — zdanie pisze serwer.
                Sprawa rozstrzygnięta w Centrum Sprzedaży czipa nie ma: „pochodzenie
                decyzji jest informacją", a udawanie jej naszą byłoby kłamstwem. */}
            {r.werdyktNazwa && r.werdyktStatus !== "send_failed" &&
              <span title={`Werdykt z panelu${r.werdyktPrzez ? `: ${r.werdyktPrzez}` : ""}`}
                className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
                <Gavel size={13} />{r.werdyktNazwa}</span>}
            {/* TAGI PRZED SYGNAŁAMI: sygnał liczy maszyna z faktu, tag pisze
                człowiek — a przy szukaniu własnej sprawy szuka się słowa,
                które się samemu wpisało. Kolejności wiersza to nie zmienia
                (§14.5): czip zawęża listę, nie podnosi jej wyżej. */}
            {r.tagi.map((t) => <CzipTagu key={t.id} nazwa={t.nazwa} />)}
            {r.sygnaly.map((s) => (
              <span key={s} title={SYGNALY[s].tytul}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${SYGNALY[s].klasa}`}>
                {SYGNALY[s].ikona}{SYGNALY[s].krotko}
              </span>
            ))}
          </div>
          </div>
        </button>
      </li>;
    })}
  </ul>;
}
