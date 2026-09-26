import React, { useEffect, useRef, useState } from "react";
import { AlarmClock, CheckCircle2, Flame, RotateCcw, Scale } from "lucide-react";
import type { Rozmowa } from "../api/typy";
import { KLASA_STATUSU } from "../ui";
import { NAZWA, ZRODLO_ZAKONCZENIA } from "./statusy";
import { polePisania, useSkrotyDzialaja } from "../nawigacja/fokus";
import { MenuRozmowy, WierszMenu } from "./MenuRozmowy";
import { dzienZKalendarza, opisTerminu, poDniachRoboczych, terminyOdlozenia } from "./terminOdlozenia";

/* Status rozmowy (§7, 0.158.0). Nagłówek rozmowy pokazuje go ZAWSZE, także
   gdy nikt go nie ruszył — „Nowa" znaczy, że sprawy nie tknięto, a to jest
   informacja, nie brak informacji.

   ── STATUS JEST ODCZYTEM, NIE WYBOREM (22 września 2026) ─────────────────
   Decyzja właściciela: ręczne werdykty — odłożenie, „Rozwiązana",
   „Zamknięta", „Spam" — odeszły razem z trasą, która je nadawała. Stan
   wynika wyłącznie z faktów: z kierunku ostatniej wiadomości i ze zlecenia
   pomiaru. Pole wyboru zostałoby polem z jedną pozycją, więc zostaje sama
   plakietka. Werdykt zapisany przed tą zmianą widać dalej, bo stoi w bazie.

   Od 23 września 2026 wraca JEDEN werdykt — „Zakończ" — i tylko on. Menu
   nie wraca: kto ma ruch, dalej liczy się sam (powód przy `wyliczStatus`). */
/* Stany, w których ruch jest po naszej stronie — zakończenie przy nich
   wymaga jednego pytania (serwer pilnuje tego samego, patrz `zakonczRozmowe`). */
const KLIENT_CZEKA = new Set(["new", "open", "waiting_for_us"]);

export function Status({ rozmowa, blad, onPriorytet, zapisujePriorytet,
  onReklamacyjna, zapisujeReklamacyjna = false, onZakoncz, onOtworz, onOdloz, onWrocZOdlozenia,
  zmieniaStatus = false, menu }: {
  rozmowa: Rozmowa;
  blad: string;
  onPriorytet: (priorytet: "normalny" | "pilny") => void;
  zapisujePriorytet: boolean;
  /* Znacznik reklamacyjny (0.390.0) — OPCJONALNY tym samym wzorcem co Copilot
     i tagi: czego nie da się zrobić, tego nie ma na ekranie. */
  onReklamacyjna?: (reklamacyjna: boolean) => void;
  zapisujeReklamacyjna?: boolean;
  /* ── ZAKOŃCZ / OTWÓRZ PONOWNIE (23 września 2026) ───────────────────────
     Decyzja właściciela: „potrzebuję sposobu, żeby rozmowa była rozwiązana".
     JEDEN werdykt zamiast menu statusów — tamto odeszło 22 września, bo nikt
     go nie używał dobrze. Stan „kto ma ruch" dalej liczy się sam. */
  onZakoncz?: (mimoPytania: boolean) => void;
  onOtworz?: () => void;
  /* ── ODŁÓŻ DO TERMINU (0.533.0) — decyzja właściciela z 26 września 2026,
     powód przy `odlozRozmowe` na serwerze. Werdykt z datą, nie status z menu:
     tamten odszedł 22 września i nie wraca. Drugi przycisk zdejmuje odłożenie. */
  onOdloz?: (doKiedy: string, opis: string) => void;
  onWrocZOdlozenia?: () => void;
  zmieniaStatus?: boolean;
  /* Wiersze menu „⋯" od ekranu rozmowy (0.506.0): prowadzący i kategoria.
     Przełączniki w spoczynku dokłada tu sam `Status` — powód w `MenuRozmowy.tsx`. */
  menu?: React.ReactNode;
}) {
  const [pytam, setPytam] = useState(false);
  /* Znaczek „Z" tylko wtedy, gdy klawisz działa — powód w `nawigacja/fokus.ts`. */
  const skrotyDzialaja = useSkrotyDzialaja();
  const zakonczona = rozmowa.status === "resolved" || rozmowa.status === "closed";
  const odlozona = rozmowa.status === "snoozed";
  const [kalendarz, setKalendarz] = useState("");
  const odlozDo = (kiedy: Date) => onOdloz?.(kiedy.toISOString(), `do ${opisTerminu(kiedy)}`);
  const zrodlo = zakonczona && rozmowa.zakonczenie ? ZRODLO_ZAKONCZENIA[rozmowa.zakonczenie] : null;

  /* KLAWISZ Z — ta sama droga co przycisk, łącznie z pytaniem, gdy klient
     czeka. Nasłuch mieszka TU, a nie w ekranie, bo to tu stoi pytanie; ten
     sam strażnik co przy E i R: pole tekstowe wygrywa zawsze, bo „z" w słowie
     „zamówienie" nie może kończyć rozmowy. */
  /* DRUGIE „Z" ZATWIERDZA (0.533.0). Pytanie zostaje jedno i w miejscu
     przycisku, ale odpowiedź na nie wymagała myszy — agent kończący
     z klawiatury musiał zmienić narzędzie w połowie ruchu. Esc anuluje. */
  const klawisz = useRef((_k: "z" | "o" | "esc") => {});
  klawisz.current = (k) => {
    if (k === "esc") { setPytam(false); return; }
    if (k === "o") {
      /* „O" — następny dzień roboczy, 8:00: najczęstsze odłożenie jednym
         klawiszem, z paskiem „Cofnij" jak Zakończ. */
      if (onOdloz && !zakonczona && !zmieniaStatus) odlozDo(poDniachRoboczych(new Date(), 1));
      return;
    }
    if (!onZakoncz || zakonczona || zmieniaStatus) return;
    if (pytam) { setPytam(false); onZakoncz(true); return; }
    if (KLIENT_CZEKA.has(rozmowa.status)) setPytam(true); else onZakoncz(false);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (polePisania(e.target)) return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); klawisz.current("z"); }
      if (e.key === "o" || e.key === "O") { e.preventDefault(); klawisz.current("o"); }
      if (e.key === "Escape") klawisz.current("esc");
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
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
    {/* PODNIESIONA FLAGA ZOSTAJE NA WIERZCHU (0.506.0). To stan sprawy
        i ma krzyczeć; kliknięcie opuszcza ją tym samym przyciskiem.
        Przełącznik w spoczynku zszedł do menu „⋯" — `MenuRozmowy.tsx`. */}
    {rozmowa.priorytet === "pilny" && <button type="button" disabled={zapisujePriorytet}
      aria-pressed title="Zdejmij flagę pilne" onClick={() => onPriorytet("normalny")}
      className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-xs font-bold text-ranga-zle hover:bg-red-200 disabled:opacity-50">
      <Flame size={13} />PILNE</button>}
    {onReklamacyjna && rozmowa.reklamacyjna && <button type="button" disabled={zapisujeReklamacyjna}
      aria-pressed
      title="Prowadzimy tę rozmowę jak reklamację. W Allegro sprawy nie ma — założyć ją może tylko kupujący."
      onClick={() => onReklamacyjna(false)}
      className="inline-flex items-center gap-1 rounded bg-violet-100 px-2 py-1 text-xs font-bold text-violet-900 hover:bg-violet-200 disabled:opacity-50">
      <Scale size={13} />REKLAMACYJNA</button>}

    {/* STATUS RAZ, NIE DWA (0.193.0): jedna plakietka z barwą stanu, bez
        podpisu „Status" — nazwa stanu mówi to samo jednym wyrazem mniej. */}
    <span className={`rounded px-2 py-1 text-sm font-bold ${KLASA_STATUSU[rozmowa.status] ?? ""}`}
      title={zrodlo ?? undefined}
      aria-label="Status rozmowy">{NAZWA[rozmowa.status]}
      {/* Odłożona mówi do kiedy — bez daty to „Odłożona" na zawsze. */}
      {odlozona && rozmowa.odlozoneDo && <span className="font-semibold"> do {opisTerminu(new Date(rozmowa.odlozoneDo))}</span>}
    </span>
    {/* Źródło zakończenia SAMEGO stoi słowem: „zakończona" bez „dlaczego"
        przy regule, której nikt nie kliknął, wyglądałaby na pomyłkę. */}
    {zrodlo && rozmowa.zakonczenie !== "agent" && <span className="text-xs text-slate-600">{zrodlo}</span>}

    <MenuRozmowy>
      {menu}
      {/* Przełączniki W SPOCZYNKU — ta sama gramatyka co dotąd: „pilne" mówi
          o rozmowie, którą się czyta, a „reklamacyjna" o tym, jak ją prowadzimy.
          Sprawy w Allegro to NIE zakłada (0.390.0) i podpis mówi to wprost. */}
      {(rozmowa.priorytet !== "pilny" || (onReklamacyjna && !rozmowa.reklamacyjna)) &&
        <WierszMenu etykieta="Oznacz">
          {rozmowa.priorytet !== "pilny" && <button type="button" disabled={zapisujePriorytet}
            aria-pressed={false} aria-label="Oznacz jako pilne" title="Oznacz jako pilne"
            onClick={() => onPriorytet("pilny")}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            <Flame size={13} />pilne</button>}
          {onReklamacyjna && !rozmowa.reklamacyjna && <button type="button" disabled={zapisujeReklamacyjna}
            aria-pressed={false} aria-label="Sprawa reklamacyjna"
            title="Oznacz, że prowadzimy tę rozmowę jak reklamację. Sprawy w Allegro to nie zakłada."
            onClick={() => onReklamacyjna(true)}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            <Scale size={13} />reklamacyjna</button>}
        </WierszMenu>}
      {/* Odłożenie w menu, nie na wierzchu: to ruch raz na kilka rozmów.
          Klawisz „O" bierze najczęstszy termin bez otwierania menu. */}
      {onOdloz && !zakonczona && <WierszMenu etykieta="Odłóż do">
        <span className="flex flex-col items-start gap-1">
          {terminyOdlozenia().map((t) => <button key={t.etykieta} type="button" disabled={zmieniaStatus}
            onClick={() => odlozDo(t.kiedy)}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            <AlarmClock size={13} />{opisTerminu(t.kiedy)}
            <span className="font-normal text-slate-600">· {t.etykieta.toLowerCase()}</span>
            {t.etykieta === "Następny dzień roboczy" && skrotyDzialaja &&
              <kbd aria-hidden="true" className="rounded bg-black/10 px-1 font-sans text-podpis">O</kbd>}
          </button>)}
          <span className="flex items-center gap-1 text-xs">
            <input type="date" aria-label="Odłóż do dnia" value={kalendarz}
              onChange={(e) => setKalendarz(e.target.value)} className="field w-auto py-0.5 text-xs" />
            <button type="button" disabled={zmieniaStatus || !dzienZKalendarza(kalendarz)}
              onClick={() => { const d = dzienZKalendarza(kalendarz); if (d) odlozDo(d); }}
              className="rounded bg-slate-100 px-2 py-1 font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
              Odłóż</button>
          </span>
        </span>
      </WierszMenu>}
    </MenuRozmowy>

    {odlozona && onWrocZOdlozenia && <button type="button" disabled={zmieniaStatus} onClick={onWrocZOdlozenia}
      className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
      <RotateCcw size={13} />Wróć teraz</button>}
    {zakonczona
      ? onOtworz && <button type="button" disabled={zmieniaStatus} onClick={onOtworz}
          className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
          <RotateCcw size={13} />Otwórz ponownie</button>
      : onZakoncz && !pytam && <button type="button" disabled={zmieniaStatus}
          aria-keyshortcuts="Z" title="Zakończ rozmowę (Z)"
          onClick={() => (KLIENT_CZEKA.has(rozmowa.status) ? setPytam(true) : onZakoncz(false))}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
          <CheckCircle2 size={13} />Zakończ
          {skrotyDzialaja && <kbd aria-hidden="true" className="rounded bg-black/15 px-1 font-sans text-podpis">Z</kbd>}
        </button>}
    {/* PYTANIE RAZ, W MIEJSCU PRZYCISKU, nie oknem na środku ekranu — ten sam
        wzorzec co groźne ruchy w stanie systemu. To jedyna pomyłka tego
        przycisku, która kosztuje klienta bez odpowiedzi. */}
    {pytam && !zakonczona && onZakoncz && <span role="alert"
      className="inline-flex flex-wrap items-center gap-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">
      Klient czeka na odpowiedź — zakończyć bez odpowiedzi?
      <button type="button" disabled={zmieniaStatus} onClick={() => { setPytam(false); onZakoncz(true); }}
        aria-keyshortcuts="Z"
        className="inline-flex items-center gap-1 rounded bg-red-700 px-2 py-0.5 font-bold text-white hover:bg-red-800">Zakończ mimo to
        {skrotyDzialaja && <kbd aria-hidden="true" className="rounded bg-white/20 px-1 font-sans text-podpis">Z</kbd>}</button>
      <button type="button" onClick={() => setPytam(false)} className="font-semibold underline">Anuluj</button>
    </span>}

    {blad && <p className="w-full text-xs font-semibold text-ranga-zle">{blad}</p>}
  </div>;
}
