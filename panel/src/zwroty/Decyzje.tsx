import React, { useState } from "react";
import type { Zwrot } from "../api/typy";
import { Przycisk, Pole, Blad } from "../ui";

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
  trwa: boolean;
  blad: string;
};

export function Decyzje({ zwrot, onWerdykt, onKorekta, onCofnijKorekte,
  trwa, blad }: Props) {
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
                i wymaga powodu — bez niego nie ma czego pokazać klientowi. */}
            <label className="block text-xs font-bold text-slate-600" htmlFor="powod-odmowy">
              Powód odmowy — zobaczy go klient
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
          </div>}
      {blad && <Blad>{blad}</Blad>}
    </div>;
  }

  /* DO OCENY i DO ZWROTU nie mają paska: ich pytanie zadaje wiersz produktu,
     bo dotyczy pojedynczej pozycji, a nie całego zwrotu. */
  if (zwrot.kubelek === "ocena" || zwrot.kubelek === "zwrot") return null;

  if (zwrot.kubelek === "korekta") {
    return <div className={ramka}>
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
      : <p className="text-xs text-slate-500">Stan końcowy — nie ma tu decyzji do podjęcia.</p>}
    {blad && <Blad>{blad}</Blad>}
  </div>;
}
