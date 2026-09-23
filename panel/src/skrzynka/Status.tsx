import React from "react";
import { Flame, Scale } from "lucide-react";
import type { Rozmowa } from "../api/typy";
import { KLASA_STATUSU } from "../ui";
import { NAZWA } from "./statusy";

/* Status rozmowy (§7, 0.158.0). Nagłówek rozmowy pokazuje go ZAWSZE, także
   gdy nikt go nie ruszył — „Nowa" znaczy, że sprawy nie tknięto, a to jest
   informacja, nie brak informacji.

   ── STATUS JEST ODCZYTEM, NIE WYBOREM (22 września 2026) ─────────────────
   Decyzja właściciela: ręczne werdykty — odłożenie, „Rozwiązana",
   „Zamknięta", „Spam" — odeszły razem z trasą, która je nadawała. Stan
   wynika wyłącznie z faktów: z kierunku ostatniej wiadomości i ze zlecenia
   pomiaru. Pole wyboru zostałoby polem z jedną pozycją, więc zostaje sama
   plakietka. Werdykt zapisany przed tą zmianą widać dalej, bo stoi w bazie. */
export function Status({ rozmowa, blad, onPriorytet, zapisujePriorytet,
  onReklamacyjna, zapisujeReklamacyjna = false }: {
  rozmowa: Rozmowa;
  blad: string;
  onPriorytet: (priorytet: "normalny" | "pilny") => void;
  zapisujePriorytet: boolean;
  /* Znacznik reklamacyjny (0.390.0) — OPCJONALNY tym samym wzorcem co Copilot
     i tagi: czego nie da się zrobić, tego nie ma na ekranie. */
  onReklamacyjna?: (reklamacyjna: boolean) => void;
  zapisujeReklamacyjna?: boolean;
}) {
  /* Bez `w-full` (0.193.0): pasek statusu łamał wiersz nagłówka ZAWSZE,
     także wtedy, gdy miejsce było. Nagłówek rozmowy zajmował przez to dwa
     pasma zamiast jednego, a pytanie klienta zaczynało się niżej. Zawinięcie
     zostaje — przy wąskiej kolumnie ma się złamać. */
  return <div className="flex flex-wrap items-center gap-2">
    {/* Priorytet stoi PRZY statusie, nie w kolejce: „to się pali" mówi się
        o rozmowie, którą się właśnie czyta. Przełącznik jest jeden i widać po
        nim stan — flaga podniesiona wygląda inaczej niż opuszczona. */}
    {/* ZNAK, GDY TO CZYNNOŚĆ; SŁOWO, GDY TO FAKT (23 września 2026, „za dużo
        tekstu"). Opuszczony przełącznik jest propozycją ruchu i wystarczy mu
        ikona z dymkiem. Podniesiony jest stanem sprawy — ten czyta się
        słowem, bo ma być zauważony, a nie rozszyfrowany. */}
    <button type="button" disabled={zapisujePriorytet}
      aria-pressed={rozmowa.priorytet === "pilny"}
      aria-label={rozmowa.priorytet === "pilny" ? undefined : "Oznacz jako pilne"}
      title={rozmowa.priorytet === "pilny" ? "Zdejmij flagę pilne" : "Oznacz jako pilne"}
      onClick={() => onPriorytet(rozmowa.priorytet === "pilny" ? "normalny" : "pilny")}
      className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold disabled:opacity-50 ${
        rozmowa.priorytet === "pilny"
          ? "bg-red-100 text-ranga-zle hover:bg-red-200"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
      <Flame size={13} />{rozmowa.priorytet === "pilny" && "PILNE"}
    </button>

    {/* ── ZNACZNIK REKLAMACYJNY (0.390.0) ───────────────────────────────────
        Właściciel: „chcę zaznaczyć, że to jest pytanie reklamacyjne i będzie
        traktowane jako reklamacja, ale nie będzie w allegrowych reklamacjach".

        SPRAWY W ALLEGRO ZAŁOŻYĆ SIĘ NIE DA i to nie jest nasz wybór:
        `/sale/issues` w `docs/allegro/swagger.yaml` ma wyłącznie GET, sprawę
        otwiera kupujący. Ten znacznik jest NASZ i mówi wyłącznie, jak biuro
        prowadzi tę rozmowę.

        Przełącznik, nie droga w jedną stronę: agent bierze pytanie za
        reklamacyjne po pierwszym zdaniu klienta, a po wyniku z hali bywa, że
        to pytanie o dobór. Ten sam kształt co przy „pilne" obok — dwa
        przełączniki, dwa różne pytania, jedna gramatyka. */}
    {onReklamacyjna && <button type="button" disabled={zapisujeReklamacyjna}
      aria-pressed={rozmowa.reklamacyjna}
      aria-label={rozmowa.reklamacyjna ? undefined : "Sprawa reklamacyjna"}
      title={rozmowa.reklamacyjna
        ? "Prowadzimy tę rozmowę jak reklamację. W Allegro sprawy nie ma — założyć ją może tylko kupujący."
        : "Oznacz, że prowadzimy tę rozmowę jak reklamację. Sprawy w Allegro to nie zakłada."}
      onClick={() => onReklamacyjna(!rozmowa.reklamacyjna)}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold disabled:opacity-50 ${
        rozmowa.reklamacyjna
          ? "bg-violet-100 text-violet-900 hover:bg-violet-200"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
      <Scale size={13} />{rozmowa.reklamacyjna && "REKLAMACYJNA"}
    </button>}

    {/* STATUS RAZ, NIE DWA (0.193.0): jedna plakietka z barwą stanu, bez
        podpisu „Status" — nazwa stanu mówi to samo jednym wyrazem mniej. */}
    <span className={`rounded px-2 py-1 text-sm font-bold ${KLASA_STATUSU[rozmowa.status] ?? ""}`}
      aria-label="Status rozmowy">{NAZWA[rozmowa.status]}</span>

    {blad && <p className="w-full text-xs font-semibold text-ranga-zle">{blad}</p>}
  </div>;
}
