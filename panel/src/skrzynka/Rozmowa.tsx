import React from "react";
import { Bell, Inbox, Ruler, UserCheck } from "lucide-react";
import { Wyszukiwarka, type Towar } from "../wyszukiwarka";
import type { OsRozmowy, StatusRozmowy, SzczegolyKonfliktu, WpisOsi } from "../api/typy";
import type { Obecnosc } from "../api/zdarzenia";
import { Przycisk, Pusto } from "../ui";
import { Os } from "./Os";
import { Edytor } from "./Edytor";
import { KonfliktPrzejecia } from "./KonfliktPrzejecia";
import { BrakOferty } from "./BrakOferty";
import { Status } from "./Status";
import { OcenaKategorii } from "./Copilot";
import { Sprawa } from "./Sprawa";
import { Obecni } from "./Obecni";

/**
 * Pytanie bez żadnego powiązania z towarem (§4.3).
 *
 * Do 0.165.0 liczyła się sama oferta. Zamówienie nazywa towar DOKŁADNIEJ niż
 * oferta (pozycje z nazwą i SKU), więc rozmowa z numerem zamówienia nie
 * dostaje bloku „brak powiązania z ofertą" — dostaje blok zamówienia.
 * Ekran dalej nie podstawia oferty zgadniętej z treści — tak wygrywały
 * kiedyś „zdemontowanym" i „Pozdrawiam".
 */
export function brakPowiazania(os: WpisOsi[]): boolean {
  return os.some((w) => w.rodzaj === "wiadomosc" && w.odKlienta && !w.ofertaId && !w.zamowienieId)
    && !os.some((w) => w.ofertaId || w.zamowienieId);
}

export function Rozmowa(p: {
  dane: OsRozmowy | undefined;
  mojeId: number | null;
  /** Kto jeszcze siedzi przy tej rozmowie — stan chwilowy z szyny zdarzeń. */
  obecni: Obecnosc[];
  nowaWiadomosc: boolean;
  szkic: string;
  zapisuje: boolean;
  zrodloPomiaru: number | null;
  wskazowka: string;
  towar: Towar | null;
  onPrzejmij: () => void;
  onPokazNowa: () => void;
  onSzkic: (v: string) => void;
  onZapiszSzkic: () => void;
  onZrodlo: (id: number | null) => void;
  onWskazowka: (v: string) => void;
  onTowar: (t: Towar | null) => void;
  onZlec: () => void;
  wysyla: boolean;
  onWyslij: () => void;
  komentarz: string;
  onKomentarz: (v: string) => void;
  onDodajKomentarz: () => void;
  komentuje: boolean;
  agenci: Array<{ userId: number; name: string }>;
  wzmianki: number[];
  onWzmianki: (v: number[]) => void;
  konflikt: SzczegolyKonfliktu | null;
  mozeWymusic: boolean;
  wymusza: boolean;
  bladKonfliktu: string;
  zapisujeOferte: boolean;
  bladOferty: string;
  onZamknijKonflikt: () => void;
  onPoprosOPrzekazanie: () => void;
  onWymus: (powod: string) => void;
  onWskazOferte: (ofertaId: string) => void;
  onDopytajOOferte: () => void;
  sprawy: import("../api/typy").WierszSprawy[];
  trwaSprawa: boolean;
  bladSprawy: string;
  onZalozSprawe: (tytul: string) => void;
  onDolaczDoSprawy: (sprawaId: number) => void;
  onOdlaczOdSprawy: () => void;
  onOtworzRozmowe: (id: number) => void;
  zapisujeStatus: boolean;
  onPriorytet: (priorytet: "normalny" | "pilny") => void;
  zapisujePriorytet: boolean;
  /* Werdykt o propozycji Copilota (§14, etap F). Opcjonalny, bo rozmowa bez
     rozpoznania nie ma czego oceniać — a każdy istniejący test tego ekranu
     opisuje właśnie taką rozmowę. */
  ocenia?: boolean;
  onOcenKategorie?: (ocena: "trafna" | "nietrafna") => void;
  bladStatusu: string;
  onZmienStatus: (status: StatusRozmowy, doKiedy: string | null) => void;
}) {
  if (!p.dane) {
    return <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <Pusto ikona={<Inbox size={38} />}>Wybierz rozmowę z listy</Pusto>
    </section>;
  }
  const { rozmowa, os } = p.dane;
  const moja = rozmowa.wlascicielId !== null && rozmowa.wlascicielId === p.mojeId;
  const cudza = rozmowa.wlascicielId != null && rozmowa.wlascicielId !== p.mojeId;
  const bezOferty = brakPowiazania(os);
  const wskazanaRecznie = Boolean(p.dane.ofertaWskazana);

  return <section className="card flex min-h-0 flex-1 flex-col overflow-hidden">
    {/* `shrink-0` na wszystkim poza osią (0.180.0): po zwężeniu kolumny do
        ~700 px nagłówki zawijają się na dwie linie, a `Os` jest jedynym
        blokiem z bazą 0 — bez tych klauzul kurczyłaby się treść rozmowy,
        czyli jedyna rzecz, po którą agent tu przyszedł. */}
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b p-4">
      <b className="mr-auto">{rozmowa.klient}</b>
      {rozmowa.wlasciciel
        ? <span className={`flex items-center gap-1 text-sm font-semibold ${
            moja ? "text-emerald-700" : "text-slate-600"}`}>
            <UserCheck size={15} />{moja ? "Twoja rozmowa" : `Prowadzi ${rozmowa.wlasciciel}`}</span>
        : <Przycisk wariant="glowny" onClick={p.onPrzejmij}>
            <UserCheck size={16} />PRZEJMIJ ROZMOWĘ</Przycisk>}
      {/* Status stoi w nagłówku, nie przy edytorze: odpowiada na pytanie „co
          z tą sprawą", a nie „co napisać". Zmienić go może każdy z biura,
          także bez prowadzenia rozmowy — zamknięcie cudzej sprawy załatwionej
          w telefonie nie jest przejęciem jej. */}
      {/* Werdykt o propozycji Copilota stoi PRZY NIEJ, nie za zębatką: ocenia
          się to, na co się właśnie patrzy. Za zębatką mieszka SUMA tych ocen,
          czyli pomiar — ekran pracy niesie to, co woła o reakcję (0.168.0). */}
      {rozmowa.kopilot && <OcenaKategorii kopilot={rozmowa.kopilot}
        zapisuje={p.ocenia} onOcen={p.onOcenKategorie ?? (() => {})} />}
      <Status rozmowa={rozmowa} zapisuje={p.zapisujeStatus} blad={p.bladStatusu}
        onZmien={p.onZmienStatus}
        onPriorytet={p.onPriorytet} zapisujePriorytet={p.zapisujePriorytet} />
    </header>

    {/* Obecność IDZIE PRZED sprawą: „ktoś tu już siedzi" zmienia decyzję
        o pisaniu odpowiedzi, a sprawa zmienia tylko sposób czytania. */}
    <Obecni obecni={p.obecni} mojeId={p.mojeId} />

    {/* Sprawa stoi POD nagłówkiem, nad wszystkim innym: „to ten sam problem
        co w tamtej rozmowie" zmienia sposób czytania całej reszty ekranu. */}
    <Sprawa sprawa={p.dane.sprawa} rozmowaId={rozmowa.id} sprawy={p.sprawy}
      trwa={p.trwaSprawa} blad={p.bladSprawy}
      onZaloz={p.onZalozSprawe} onDolacz={p.onDolaczDoSprawy} onOdlacz={p.onOdlaczOdSprawy}
      onOtworz={p.onOtworzRozmowe} />

    {/* Oferta, towar i zamówienie przeniosły się do KOLUMNY KONTEKSTU
        (0.180.0). Cztery bloki jeden pod drugim spychały pytanie klienta
        poniżej krawędzi okna, a to ono jest powodem, dla którego agent tu
        przyszedł. Środkowa kolumna niesie odtąd rozmowę i nic poza nią. */}

    {p.nowaWiadomosc && <p className="flex shrink-0 items-center gap-2 border-b bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
      <Bell size={16} />Klient dopisał nową wiadomość.
      <button className="underline" onClick={p.onPokazNowa}>Pokaż</button></p>}

    {p.konflikt && <KonfliktPrzejecia
      szczegoly={p.konflikt}
      mojaWersja={rozmowa.wersja}
      czasPrzejecia={p.konflikt.assignedAt ?? null}
      mozeWymusic={p.mozeWymusic}
      wymusza={p.wymusza}
      blad={p.bladKonfliktu}
      onZamknij={p.onZamknijKonflikt}
      onPoprosOPrzekazanie={p.onPoprosOPrzekazanie}
      onWymus={p.onWymus} />}

    {/* Wskazana ręcznie oferta ląduje na osi jako wybór agenta, więc blok
        znika dopiero wtedy, gdy oś ją zobaczy — nie zaraz po kliknięciu. */}
    {bezOferty && !wskazanaRecznie && <BrakOferty
      zapisuje={p.zapisujeOferte} blad={p.bladOferty}
      onWskaz={p.onWskazOferte} onDopytaj={p.onDopytajOOferte} />}

    <Os wpisy={os} zrodloPomiaru={p.zrodloPomiaru} mozeZlecac={!cudza}
      onZrodlo={p.onZrodlo}
      onWstawDoSzkicu={(t) => p.onSzkic(p.szkic ? `${p.szkic}\n${t}` : t)} />

    {p.zrodloPomiaru && <div className="shrink-0 border-t bg-amber-50 p-4">
      {/* Kartoteki nie wywiedziemy dziś z oferty, więc agent może ją wskazać.
          Zadanie zapisze, że to jego wybór, a nie fakt z Allegro. */}
      <div className="mb-3">
        <div className="mb-1 text-sm font-semibold">Kartoteka dla hali
          <span className="font-normal text-slate-500"> (opcjonalnie)</span></div>
        <Wyszukiwarka wybrany={p.towar} onWybierz={p.onTowar} etykieta="Wskazana przez Ciebie" />
      </div>
      <label className="block text-sm font-semibold">Wskazówka dla hali
        <span className="font-normal text-slate-500"> (opcjonalnie)</span>
        <input className="field mt-1" value={p.wskazowka}
          onChange={(e) => p.onWskazowka(e.target.value)}
          placeholder="Np. podaj wynik w milimetrach" /></label>
      <Przycisk wariant="glowny" className="mt-3" onClick={p.onZlec}>
        <Ruler size={16} />ZLEĆ POMIAR</Przycisk>
    </div>}

    <Edytor szkic={p.szkic} cudza={cudza} wlasciciel={rozmowa.wlasciciel}
      zapisuje={p.zapisuje} wysyla={p.wysyla}
      onZmiana={p.onSzkic} onZapisz={p.onZapiszSzkic} onWyslij={p.onWyslij}
      komentarz={p.komentarz} onKomentarz={p.onKomentarz}
      onDodajKomentarz={p.onDodajKomentarz} komentuje={p.komentuje}
      agenci={p.agenci} wzmianki={p.wzmianki} onWzmianki={p.onWzmianki} />
  </section>;
}
