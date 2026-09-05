import React, { useState } from "react";
import type { Zwrot } from "../api/typy";
import { Przycisk, Pole, Blad, Skopiuj } from "../ui";
import { zlote } from "../api/zwroty";

/* ── Pasek decyzji zwrotu (0.156.0) ──────────────────────────────────────────
   Do tego wydania klawisze z §25a.2 stały tu jako PODPISY: `kubelekZwrotu`
   routował po `werdykt`, ocenie pozycji i `kwota_grosze`, a żadnej z tych
   kolumn nic nie zapisywało. Kolejka bramek była maszyną bez paliwa.

   Trzy kubełki dostały działanie w 0.156.0, czwarty — korekta — w 0.162.0.
   Korekty NIE wystawia panel: robi to człowiek w Subiekcie, a tutaj przepisuje
   jej numer. Stąd pole tekstowe zamiast przycisku „zleć" i stąd cofnięcie
   (§25a.5): literówka w przepisanym numerze jest zdarzeniem normalnym.

   Od 0.167.0 zostają tu decyzje o CAŁYM zwrocie: werdykt, korekta, cofnięcie.
   Ocena towaru i wycena dotyczą pojedynczych pozycji, więc przeniosły się na
   wiersz produktu (`Pozycje.tsx`) — operator ocenia towar, patrząc na towar,
   a nie na jego nazwę wypisaną drugi raz obok.                              */

type Props = {
  zwrot: Zwrot;
  onWerdykt: (decyzja: "przyjety" | "odrzucony", powod: string | null) => void;
  onKorekta: (numer: string) => void;
  onCofnijKorekte: () => void;
  onCofnijKwote: () => void;
  onCofnijWerdykt: () => void;
  trwa: boolean;
  blad: string;
};

export function Decyzje({ zwrot, onWerdykt, onKorekta, onCofnijKorekte, onCofnijKwote,
  onCofnijWerdykt, trwa, blad }: Props) {
  const [odmowa, setOdmowa] = useState(false);
  const [powod, setPowod] = useState("");
  /* Numer korekty PRZEPISUJE człowiek z Subiekta — panel go nie wywiedzie
     z niczego, bo read-model zna tylko dokumenty zakupu (FZ, PZ). */
  const [numer, setNumer] = useState("");

  const ramka = "border-b border-slate-200 bg-slate-50 p-4";

  if (zwrot.kubelek === "decyzja") {
    return <div className={ramka}>
      {!odmowa
        ? <div className="flex flex-wrap gap-2">
            <Przycisk wariant="glowny" disabled={trwa}
              onClick={() => onWerdykt("przyjety", null)}>
              <kbd className="rounded border border-black/20 px-1 text-xs">P</kbd> Przyjmij
            </Przycisk>
            <Przycisk disabled={trwa} onClick={() => setOdmowa(true)}>
              <kbd className="rounded border border-slate-300 px-1 text-xs">O</kbd> Odrzuć
            </Przycisk>
          </div>
        : <div className="space-y-2">
            {/* Odmowa jest NIEODWRACALNA (§25a.5), więc dostaje potwierdzenie
                i wymaga powodu.

                ETYKIETA MÓWI PRAWDĘ OD 0.210.0. Stało tu „zobaczy go klient" —
                i to była jedyna nieprawda na tym ekranie. Allegro nie zna
                pojęcia „odrzuć zwrot": końcówka `rejection` odmawia WYPŁATY,
                nie zwrotu. Nasz werdykt jest decyzją biura i nigdzie nie
                wychodzi, więc klient nie dowie się niczego, dopóki ktoś mu
                nie napisze. Zdanie niżej mówi, co zrobić dalej. */}
            <label className="block text-xs font-bold text-slate-600" htmlFor="powod-odmowy">
              Powód odmowy — zostaje u nas
            </label>
            <Pole id="powod-odmowy" value={powod} autoFocus
              onChange={(e) => setPowod(e.target.value)}
              placeholder="np. towar nosi ślady użycia" />
            <div className="flex gap-2">
              <Przycisk wariant="glowny" disabled={trwa || powod.trim() === ""}
                onClick={() => onWerdykt("odrzucony", powod.trim())}>
                Potwierdź odmowę
              </Przycisk>
              <Przycisk onClick={() => { setOdmowa(false); setPowod(""); }}>Wróć</Przycisk>
            </div>
            <p className="text-xs text-slate-500">
              Klientowi trzeba powiedzieć osobno — Allegro nie zna odmowy
              zwrotu, zna tylko odmowę wypłaty. Napisz do niego w skrzynce
              albo kliknij ODMÓW WYPŁATY z kodem.
            </p>
          </div>}
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  /* DO OCENY i DO ZWROTU nie mają paska: ich pytanie zadaje wiersz produktu,
     bo dotyczy pojedynczej pozycji, a nie całego zwrotu.

     WYJĄTEK: świeżo przyjęty zwrot, w którym nikt jeszcze nic nie ocenił
     (0.204.0). Przyjęcie idzie jednym kliknięciem, bez pytania o nic, więc
     pomyłka jest zdarzeniem normalnym — a wykrywa się ją natychmiast, patrząc
     na kubełek, do którego zwrot właśnie wpadł. To jedno zdanie, nie ramka
     z decyzją: pytanie ekranu dalej zadaje wiersz produktu.

     Po pierwszej ocenie klawisz znika, bo serwer i tak by odmówił — schodzi
     się po jednym szczeblu, a ocena jest szczebel niżej. */
  if (zwrot.kubelek === "ocena" || zwrot.kubelek === "zwrot") {
    const nieoceniony = zwrot.kubelek === "ocena" && zwrot.pozycje.every((p) => !p.ocena);
    if (!nieoceniony) return null;
    return <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50
      px-4 py-2 text-xs text-slate-500">
      <span>Zwrot przyjęty — oceń produkty niżej.</span>
      <button type="button" disabled={trwa} onClick={onCofnijWerdykt}
        className="underline underline-offset-2 disabled:opacity-50">cofnij przyjęcie</button>
      {blad && <span className="text-ranga-zle">{blad}</span>}
    </div>;
  }

  if (zwrot.kubelek === "korekta") {
    return <div className={ramka}>
      {/* KWOTA Z DROGĄ WYJŚCIA (0.202.0). To jedyny ekran, na którym kwota jest
          już ustalona, a jeszcze nic na jej podstawie nie wyszło z firmy —
          więc tu, i tylko tu, da się ją poprawić. Pomyłka w zaznaczeniu
          pozycji zostawała dotąd na zawsze: pasek wyceny znika razem
          z kubełkiem DO ZWROTU. */}
      {zwrot.kwotaGrosze !== null && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Do oddania</span>
        <b className="tabular-nums">{zlote(zwrot.kwotaGrosze, zwrot.waluta)}</b>
        <button type="button" disabled={trwa} onClick={onCofnijKwote}
          className="text-xs text-slate-500 underline underline-offset-2 disabled:opacity-50">
          popraw kwotę</button>
      </div>}
      <p className="mb-2 text-xs text-slate-500">
        {/* Wprost, bo inaczej ekran obiecywałby, że zrobi to sam. */}
        Korektę wystawiasz w Subiekcie. Tu przepisz jej numer — to zamyka zwrot.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Pole className="w-56" value={numer} aria-label="Numer korekty"
          placeholder="Np. KFS 12/2026" onChange={(e) => setNumer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && numer.trim()) onKorekta(numer.trim()); }} />
        <Przycisk wariant="glowny" disabled={trwa || !numer.trim()}
          onClick={() => onKorekta(numer.trim())}>
          <kbd className="rounded border border-black/20 px-1 text-xs">Enter</kbd> Zapisz korektę
        </Przycisk>
      </div>
      {/* Pieniądze oddaje człowiek w panelu Allegro — zamknięcie znaczy
          „nasza część zrobiona", nie „klient dostał przelew". */}
      <p className="mt-1 text-xs text-slate-500">
        Pieniądze oddajesz w panelu Allegro; panel ich nie przelewa.
      </p>
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  return <div className={ramka}>
    {zwrot.korektaNumer
      ? <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Korekta</span>
            <b className="mr-auto">{zwrot.korektaNumer}</b>
            {/* Cofnięcie zamiast potwierdzenia (§25a.5) — i tak samo dostępne
                dla numeru znalezionego przez automat: cofnięcie cudzej pomyłki
                nie ma być trudniejsze niż cofnięcie własnej. */}
            <Przycisk disabled={trwa} onClick={onCofnijKorekte}>
              <kbd className="rounded border border-slate-300 px-1 text-xs">R</kbd> Cofnij korektę
            </Przycisk>
          </div>
          {/* Skąd wziął się numer, jest częścią informacji — ta sama zasada co
              przy dokumencie sprzedaży (§4.3). Fakt z danych nie ma udawać
              czyjejś decyzji, a decyzja nie ma udawać faktu. */}
          <p className="mt-0.5 text-xs text-slate-500">
            {zwrot.korektaZrodlo === "subiekt"
              ? "Znaleziona w Subiekcie — dokument koryguje tę sprzedaż."
              : "Numer przepisany w panelu."}
          </p>
        </>
      : zwrot.kubelek === "odrzucony" && zwrot.werdyktPowod
        /* POWÓD ODMOWY WIDOCZNY (0.210.0). Zapisywał się do bazy i nikt go nie
           czytał — ani panel, ani nic innego. Operator, który ma napisać
           klientowi, musiał pamiętać własne zdanie sprzed tygodnia albo szukać
           go w dzienniku. Z klawiszem kopiowania, bo to zdanie się przekleja. */
        ? <div className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">Odmówiono</span>
              <b className="mr-auto">{zwrot.werdyktPowod}</b>
              <Skopiuj tekst={zwrot.werdyktPowod} tytul="Kopiuj powód odmowy" />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Powód został u nas. Jeśli klient go jeszcze nie zna, napisz mu
              w skrzynce.
            </p>
          </div>
        : <p className="text-xs text-slate-500">Stan końcowy — nie ma tu decyzji do podjęcia.</p>}
    {blad && <Blad>{blad}</Blad>}
  </div>;
}
