import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Towar } from "../wyszukiwarka";
import { Konflikt } from "../api/klient";
import { naBase64 } from "../api/plik";
import {
  zglosCofnietaWysylke, useAgenci, useDodajKomentarz, useJa, useOdloz, usePrzygotujRozmowe,
  usePrzekaz, useRozmowa, useUstawReklamacyjna, useZakoncz, useOtworz,
  usePisze, useRozmowy, useSynchronizuj, useUchwytRozmowy, useUstawPriorytet, useWskazOferte, useWyslij,
  useZapiszSzkic, useZdrowie, useZlecPomiar,
  useDodajZalacznik, useUsunZalacznik, useZalaczniki,
} from "../api/rozmowy";
import { useSzynaZdarzen } from "../api/zdarzenia";
import { Blad, SIATKA_TRZECH_KOLUMN } from "../ui";
import { Kolejka } from "../skrzynka/Kolejka";
import {
  LIMIT_PYTANIA, useCopilot, useKlasyfikuj, usePoprawKlasyfikacje, useOcenSzkic, useUlozSzkic,
  useWymianyCopilota, useZadajPytanie, useZapiszPasowanieZDopytania,
} from "../api/copilot";
import { Rozmowa } from "../skrzynka/Rozmowa";
import { Kontekst } from "../skrzynka/Kontekst";
import { paraPasowania, propozycjaDoboru } from "../skrzynka/propozycjaDoboru";
import { szkicNaStartRozmowy } from "../skrzynka/SzkicCopilota";
import { AlarmSynchronizacji } from "../skrzynka/AlarmSynchronizacji";
import type { SzczegolyKonfliktu, SzczegolyWysylki } from "../api/typy";
import { DialogKonfliktu } from "../skrzynka/DialogKonfliktu";
import { OKNO_COFNIECIA_MS, Odlozone, nastepnaRozmowa, type Odlozona } from "../skrzynka/Odlozone";
import { Cofniecie, type DoCofniecia } from "../skrzynka/Cofniecie";
import { polePisania } from "../nawigacja/fokus";
import { useSygnaly } from "../skrzynka/Sygnaly";
import { useZglosPominiecie } from "../api/wglad";
import { pamietanySzkic, zapamietajSzkic } from "../sprawy/useSzkicSprawy";

/* Człony klucza magazynu karty — ten sam magazyn co reklamacje i dyskusje
   (`sprawy/useSzkicSprawy.ts`), osobno odpowiedź i notatka, bo to dwa pola. */
const PAMIEC_ODPOWIEDZI = "rozmowa";
const PAMIEC_NOTATKI = "rozmowa-notatka";

type Paczka = Parameters<ReturnType<typeof useWyslij>["mutateAsync"]>[0];

/** Odłożona wysyłka z tym, czego trzeba, żeby ją wysłać albo cofnąć. */
interface Wpis extends Odlozona {
  paczka: Paczka;
  body: string;
  /** Błąd z serwera, gdy wysyłka odpadła — z nim wraca się do rozmowy. */
  blad?: unknown;
}

/* Zdanie o odmowie serwera do dymka pod ekranem. Konflikty mają własne
   zdania, bo to one mówią agentowi, CO zastanie po powrocie do rozmowy. */
function opisBledu(e: unknown): string {
  if (e instanceof Konflikt) {
    const s = e.szczegoly as SzczegolyWysylki & SzczegolyKonfliktu;
    if (s?.nowaWiadomosc !== undefined) return "klient dopisał w międzyczasie";
    if (s?.trzymajacyName) return `przy rozmowie siedzi ${s.trzymajacyName}`;
    if (s?.assignedUserId != null) return "rozmowę prowadzi ktoś inny";
  }
  return e instanceof Error ? e.message : String(e);
}

export function Skrzynka() {
  /* Wybrana rozmowa siedzi w ADRESIE, nie w stanie komponentu. Do 0.146.0
     panel zapisywał `?rozmowa=N` przez `history.replaceState` i nigdy tego
     nie odczytywał, więc odświeżenie strony gubiło wybór. */
  const { id } = useParams<{ id: string }>();
  const wybranaId = id ? Number(id) : null;
  const nawiguj = useNavigate();

  const ja = useJa();
  const lista = useRozmowy();
  const rozmowa = useRozmowa(wybranaId);
  /* Copilot (§14, etap F). Stan to odczyt KONFIGURACJI, więc jeden na wejście
     do ekranu — hak trzyma go do restartu usługi. Mutacje siedzą tutaj, a nie
     w widokach: cały katalog `skrzynka/` to komponenty czyste. */
  const copilot = useCopilot();
  /* Szkic z Copilota (0.231.0): jedna rozmowa na kliknięcie, wynik wraca
     w `osRozmowy` i wchodzi do pola dopiero na „Wstaw" albo „Zastąp". */
  const ulozSzkic = useUlozSzkic();
  const ocenSzkic = useOcenSzkic();
  const [bladSzkicu, setBladSzkicu] = useState("");
  /* Dopytanie (0.332.0). Limit znaków stoi TU jako stała panelu, a serwer ma
     swoją — ta jest po to, żeby przycisk gasł przed żądaniem, tamta po to,
     żeby żądanie odpadło przed siecią. Dwie granice, jedna liczba. */
  const wymiany = useWymianyCopilota(wybranaId ?? 0);
  const zadajPytanie = useZadajPytanie();
  const zapiszPasowanie = useZapiszPasowanieZDopytania();
  const [bladPytania, setBladPytania] = useState<string | null>(null);
  const klasyfikuj = useKlasyfikuj();
  const poprawKategorie = usePoprawKlasyfikacje();
  const przekaz = usePrzekaz();
  const oferta = useWskazOferte();
  const zdrowie = useZdrowie();
  const synchronizuj = useSynchronizuj();
  const wyslij = useWyslij();
  /* ── DRUGA INSTANCJA DLA WYSYŁEK ODŁOŻONYCH (@wydanie) ──────────────────
     Jedna mutacja niosła obie drogi, a `wysyla={wyslij.isPending}` gasił
     przycisk BIEŻĄCEJ rozmowy, gdy po dziesięciu sekundach wychodziła
     odpowiedź do POPRZEDNIEJ. Przy pracy w rytmie rozmowa na dziesięć sekund
     trafiało to regularnie: „Wysyłam…" na przycisku, którego agent nie
     kliknął, i Ctrl+Enter połknięty bez słowa. Stan odłożonych niesie
     `odlozone` — tu liczy się tylko wysyłka tej rozmowy, „mimo to". */
  const wyslijWTle = useWyslij();
  const zapisz = useZapiszSzkic();
  const zlec = useZlecPomiar();
  const zalaczniki = useZalaczniki(wybranaId);
  const dodajZalacznik = useDodajZalacznik();
  const usunZalacznik = useUsunZalacznik();

  const priorytet = useUstawPriorytet();
  const reklamacyjna = useUstawReklamacyjna();
  const zakoncz = useZakoncz();
  const otworz = useOtworz();
  const odloz = useOdloz();
  const przygotuj = usePrzygotujRozmowe();
  const agenci = useAgenci();
  const dodajKomentarz = useDodajKomentarz();

  const [szkic, setSzkic] = useState("");
  /* Czy pole trzyma szkic Copilota (0.499.0) — nad polem stoi wtedy zdanie
     „Szkic Copilota w polu", a pod nim to, na czym szkic stoi. */
  const [zCopilota, setZCopilota] = useState(false);
  /* Pasek „Cofnij" po czynności jednym kliknięciem — powód w `Cofniecie.tsx`. */
  const [doCofniecia, setDoCofniecia] = useState<DoCofniecia | null>(null);
  /* Szkice, które już raz weszły do pola: `rozmowa:czas szkicu`. Ref, nie
     stan — to pamięć ekranu, nie coś, od czego zależy rysowanie. */
  const wstawione = useRef(new Set<string>());
  /* Komentarz ma WŁASNY stan, osobny od szkicu. Gdyby dzieliły jeden, notatka
     „klient bywa trudny" zostawałaby w szkicu po przełączeniu trybu i czekała
     na kliknięcie WYŚLIJ (§6.4). */
  const [komentarz, setKomentarz] = useState("");
  const [wzmianki, setWzmianki] = useState<number[]>([]);
  /* Licznik, nie flaga: każde „Poproś o przekazanie" ma przełączyć edytor
     na notatkę, także drugie z rzędu. */
  const [doNotatki, setDoNotatki] = useState(0);
  const [zrodlo, setZrodlo] = useState<number | null>(null);
  const [wskazowka, setWskazowka] = useState("");
  const [towar, setTowar] = useState<Towar | null>(null);
  const [nowa, setNowa] = useState(false);
  const [blad, setBlad] = useState("");
  const [konflikt, setKonflikt] = useState<SzczegolyKonfliktu | null>(null);
  const [bladKonfliktu, setBladKonfliktu] = useState("");
  const [bladOferty, setBladOferty] = useState("");
  const [bladSynchronizacji, setBladSynchronizacji] = useState("");
  const [konfliktWysylki, setKonfliktWysylki] = useState<SzczegolyWysylki | null>(null);
  const [bladWysylki, setBladWysylki] = useState("");
  const [bladZalacznika, setBladZalacznika] = useState("");
  const [bladStatusu, setBladStatusu] = useState("");
  const [przyRozmowie, setPrzyRozmowie] = useState<string | null>(null);

  /* ── ODŁOŻONE WYSYŁKI I NASTĘPNA ROZMOWA (23 września 2026) ─────────────
     Patrz `skrzynka/Odlozone.tsx`. Kolejka podaje listę WIDOCZNYCH rozmów
     (po kubełku i szukaniu), bo „następna" ma znaczyć następną w tym, co
     agent właśnie przerabia — nie w całej skrzynce. */
  const [odlozone, setOdlozone] = useState<Wpis[]>([]);
  const timery = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const widoczne = useRef<number[]>([]);
  const przywroc = useRef<{ rozmowaId: number; body: string; blad?: unknown } | null>(null);

  const { obecnosc } = useSzynaZdarzen(wybranaId, () => setNowa(true));
  /* Licznik w tytule karty i powiadomienia systemowe — `skrzynka/Sygnaly.ts`. */
  const sygnaly = useSygnaly(lista.data?.rozmowy, (x) => nawiguj(`/obsluga/skrzynka/${x}`));
  /* Samo wejście w pytanie trzyma je dla tego agenta — do wyjścia albo do
     odpowiedzi, która przydziela je na stałe (decyzja właściciela, 0.159.0). */
  useUchwytRozmowy(wybranaId);
  /* Znak „pisze" powstaje TU, przy polu tekstowym, a nie w hooku obecności:
     obecność znaczy „mam to otwarte", pisanie znaczy „zaraz odpowiem". Zlanie
     ich w jedno kazałoby ekranowi kłamać o drugim. */
  const zglosPisanie = usePisze(wybranaId);

  /* Szkic wchodzi do pola przy zmianie ROZMOWY, nie przy każdym odczycie:
     nadpisywanie go w trakcie pisania kasowałoby pracę agenta. */
  const komentarzTeraz = useRef(komentarz);
  komentarzTeraz.current = komentarz;
  useEffect(() => {
    /* ── NIEZAPISANY TEKST ZOSTAJE PRZY SWOJEJ ROZMOWIE (@wydanie) ──────────
       Do tego wydania j/k, klik w wiersz albo powiadomienie nadpisywały pole
       szkicem z serwera — niezapisana odpowiedź przepadała bez słowa. Gorzej
       z notatką: nie czyścił jej nikt, więc zaczęta przy jednej rozmowie
       zapisywała się przy NASTĘPNEJ. Pamięć karty trzyma tekst przy
       rozmowie, do której był pisany; powrót go oddaje, a obca rozmowa
       dostaje czyste pole. Zapis do pamięci to nie zapis stanu sprawy —
       reguła „zero zapisu przy patrzeniu" dotyczy serwera. */
    const zapamietany = wybranaId === null ? null : pamietanySzkic(PAMIEC_ODPOWIEDZI, wybranaId);
    setKomentarz(wybranaId === null ? "" : pamietanySzkic(PAMIEC_NOTATKI, wybranaId) ?? "");
    setWzmianki([]);
    /* SZKIC COPILOTA DO PUSTEGO POLA (0.499.0) — reguła i jej granice przy
       `szkicNaStart`. To stan ekranu, nie zapis: otwarcie niczego nie mutuje.
       Klucz z czasu szkicu pamięta, że ten szkic już raz wszedł — agent, który
       wyczyścił pole, nie ma go dostać z powrotem przy następnym odczycie. */
    const startowy = rozmowa.data ? szkicNaStartRozmowy(rozmowa.data, ja.data?.user.userId ?? null) : null;
    const klucz = startowy !== null && rozmowa.data
      ? `${rozmowa.data.rozmowa.id}:${rozmowa.data.szkicCopilota?.at}` : null;
    if (zapamietany !== null) {
      /* Własny tekst agenta wygrywa ze szkicem zespołu i z Copilotem: to jego
         praca, a tamte stoją dalej — szkic Copilota w karcie pod polem. */
      if (klucz) wstawione.current.add(klucz);
      setSzkic(zapamietany);
      setZCopilota(false);
    } else if (klucz && !wstawione.current.has(klucz)) {
      wstawione.current.add(klucz);
      setSzkic(startowy ?? "");
      setZCopilota(true);
    } else {
      setSzkic(rozmowa.data?.szkic?.body ?? "");
      setZCopilota(false);
    }
    setZrodlo(null); setWskazowka(""); setTowar(null); setNowa(false); setBlad("");
    setKonflikt(null); setBladKonfliktu(""); setBladOferty("");
    setKonfliktWysylki(null); setBladWysylki(""); setBladStatusu(""); setPrzyRozmowie(null);
    setBladSzkicu("");
    /* Powrót po „Cofnij" albo po odmowie odłożonej wysyłki: treść wraca do
       pola, a konflikt — do swojego dialogu. Dopiero gdy rozmowa się wczytała,
       inaczej szkic z serwera nadpisałby przywróconą treść chwilę później. */
    const p = przywroc.current;
    if (p && rozmowa.data?.rozmowa.id === p.rozmowaId) {
      przywroc.current = null;
      setSzkic(p.body);
      setZCopilota(false);
      if (p.blad instanceof Konflikt) {
        const sz = p.blad.szczegoly as SzczegolyWysylki & SzczegolyKonfliktu;
        if (sz?.nowaWiadomosc !== undefined) setKonfliktWysylki(sz);
        else if (sz?.trzymajacyName) setPrzyRozmowie(sz.trzymajacyName);
        else if (sz?.assignedUserId != null) setKonflikt(sz);
      }
    }
  }, [wybranaId, rozmowa.data?.rozmowa.id]);

  /* ── NIC NIE WCHODZI DO POLA, GDY AGENT JUŻ PATRZY (0.500.0) ──────────────
     Do 0.500.0 szkic, który takt ułożył w tle przy otwartej rozmowie, sam
     wypełniał puste pole — tekst pojawiał się agentowi pod ręką w trakcie
     czytania wątku. Zasada najmniejszego zaskoczenia (Raskin, „The Humane
     Interface"): stan ekranu zmienia się na ruch człowieka, nie obok niego.
     Szkic spóźniony staje więc w karcie pod polem z „Wstaw do odpowiedzi".

     Zostaje JEDEN przypadek dociągnięcia: konto zalogowanego doczytało się
     po rozmowie. Wtedy przy otwarciu własna rozmowa wyglądała na cudzą
     i szkic nie wszedł, choć agent nie zdążył jeszcze niczego zobaczyć. */
  const szkicTeraz = useRef(szkic);
  szkicTeraz.current = szkic;
  const wybranaIdTeraz = useRef(wybranaId);
  wybranaIdTeraz.current = wybranaId;
  useEffect(() => {
    if (!rozmowa.data || szkicTeraz.current !== "") return;
    const startowy = szkicNaStartRozmowy(rozmowa.data, ja.data?.user.userId ?? null);
    const klucz = `${rozmowa.data.rozmowa.id}:${rozmowa.data.szkicCopilota?.at}`;
    if (startowy === null || wstawione.current.has(klucz)) return;
    wstawione.current.add(klucz);
    setSzkic(startowy);
    setZCopilota(true);
    /* WYŁĄCZNIE `ja` w zależnościach — celowo bez czasu szkicu. Szkic
       spóźniony ma NIE uruchamiać tego efektu; powód wyżej. */
  }, [ja.data?.user.userId]);

  /* ── POMINIĘCIE ROZMOWY (@wydanie) ────────────────────────────────────────
     Pomiar pod decyzję właściciela z 26 września 2026: jak często agent
     otwiera rozmowę i odchodzi bez ruchu — bez wysyłki, zakończenia,
     odłożenia i notatki. Tego kosztu nie widział żaden licznik, a to on
     mówi, ile rozmów bez możliwego ruchu stoi w kolejce.

     NIGDY PRZY OTWARCIU. Raport idzie przy WYJŚCIU: przejście do innej
     rozmowy, wyjście z ekranu, zamknięcie karty. Zapis jest zbiorczy, bez
     osoby i bez rozmowy (`POST /api/obsluga/pominiecie`, wyjątek od
     `logEvent` przyjęty przez właściciela — powód przy trasie).

     RAPORT ODROCZONY O JEDEN OBRÓT PĘTLI. `StrictMode` montuje efekty dwa
     razy; natychmiastowy raport przy sprzątaniu liczyłby pominięcie przy
     każdym otwarciu. Ta sama rozmowa zamontowana z powrotem odwołuje raport. */
  const zglosPominiecie = useZglosPominiecie();
  type Pobyt = { id: number; dzialal: boolean; kategoria: string | null };
  const pobyt = useRef<Pobyt | null>(null);
  const raportPominiecia = useRef<{ p: Pobyt; t: ReturnType<typeof setTimeout> } | null>(null);
  const oznaczDzialanie = () => { if (pobyt.current) pobyt.current.dzialal = true; };
  useEffect(() => {
    if (wybranaId === null) return;
    const o = raportPominiecia.current;
    if (o && o.p.id === wybranaId) {
      clearTimeout(o.t);
      raportPominiecia.current = null;
      pobyt.current = o.p;
    } else {
      pobyt.current = { id: wybranaId, dzialal: false, kategoria: null };
    }
    return () => {
      const p = pobyt.current;
      pobyt.current = null;
      if (!p || p.dzialal) return;
      const t = setTimeout(() => {
        if (raportPominiecia.current?.p === p) raportPominiecia.current = null;
        zglosPominiecie(p.kategoria);
      }, 0);
      raportPominiecia.current = { p, t };
    };
  }, [wybranaId]);
  /* Kategoria przychodzi z danymi rozmowy, a raport idzie dopiero przy
     wyjściu — dopisujemy ją, gdy się wczyta. */
  useEffect(() => {
    const p = pobyt.current;
    const k = rozmowa.data?.rozmowa.kopilot;
    if (!p || rozmowa.data?.rozmowa.id !== p.id) return;
    p.kategoria = k ? (k.status === "FAILED" ? "nierozpoznane" : k.kategoria) : null;
  }, [rozmowa.data]);
  /* Zamknięcie karty: odroczony raport by nie zdążył, więc idzie od razu
     (`keepalive` w haku), a pobyt dostaje znacznik, żeby nie poszedł drugi raz. */
  useEffect(() => {
    const f = () => {
      const p = pobyt.current;
      if (p && !p.dzialal) { p.dzialal = true; zglosPominiecie(p.kategoria); }
    };
    window.addEventListener("pagehide", f);
    return () => window.removeEventListener("pagehide", f);
  }, []);

  /* CHWILA OTWARCIA ROZMOWY — pomiar tarcia (0.500.0). Liczy się od
     wejścia w rozmowę do kliknięcia „Wyślij", nie do wyjścia odpowiedzi po
     dziesięciu sekundach: okno cofnięcia to nie szukanie po ekranie. */
  const otwartaOd = useRef(Date.now());
  useEffect(() => { otwartaOd.current = Date.now(); }, [wybranaId]);

  /* Każda zmiana pola ląduje w pamięci karty pod TĄ rozmową — patrz efekt
     zmiany rozmowy wyżej. Pusty tekst kasuje wpis. */
  function ustawSzkic(v: string) {
    setSzkic(v);
    if (wybranaId !== null) zapamietajSzkic(PAMIEC_ODPOWIEDZI, wybranaId, v);
  }
  function ustawKomentarz(v: string) {
    setKomentarz(v);
    if (wybranaId !== null) zapamietajSzkic(PAMIEC_NOTATKI, wybranaId, v);
  }

  const zglos = (e: unknown) =>
    setBlad(e instanceof Konflikt ? `${e.message} — odśwież rozmowę` : (e as Error).message);


  /* Kontrola świeżości porównuje ostatnią wiadomość KLIENTA, nie ostatnią
     w ogóle — inaczej własna odpowiedź blokowałaby kolejną w tej rozmowie. */
  const ostatniaKlienta = [...(rozmowa.data?.os ?? [])].reverse()
    .find((w) => w.rodzaj === "wiadomosc" && w.odKlienta)?.messageId ?? null;

  const zmienOdlozona = (klucz: number, zmiana: Partial<Wpis>) =>
    setOdlozone((l) => l.map((o) => (o.klucz === klucz ? { ...o, ...zmiana } : o)));
  const usunOdlozona = (klucz: number) => {
    clearTimeout(timery.current.get(klucz));
    timery.current.delete(klucz);
    setOdlozone((l) => l.filter((o) => o.klucz !== klucz));
  };

  /* `mutateAsync`, nie `mutate`: kilka odłożonych wysyłek bywa w locie naraz,
     a wywołania zwrotne `mutate` dostaje wyłącznie OSTATNIE wywołanie. */
  function wyslijOdlozona(w: Wpis) {
    timery.current.delete(w.klucz);
    zmienOdlozona(w.klucz, { stan: { rodzaj: "wysyla" } });
    wyslijWTle.mutateAsync(w.paczka).then((r) => {
      if (r.status === "sent") {
        zmienOdlozona(w.klucz, { stan: { rodzaj: "wyslana" } });
        setTimeout(() => setOdlozone((l) => l.filter((o) => o.klucz !== w.klucz)), 4000);
      } else {
        zmienOdlozona(w.klucz, { stan: { rodzaj: "blad",
          komunikat: "wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj wątek" } });
      }
    }).catch((e: unknown) => zmienOdlozona(w.klucz, { blad: e, stan: { rodzaj: "blad", komunikat: opisBledu(e) } }));
  }

  /** Powrót do rozmowy z treścią — po „Cofnij" albo po odmowie serwera. */
  function wrocDo(w: Wpis, blad?: unknown) {
    usunOdlozona(w.klucz);
    if (wybranaId === w.rozmowaId && rozmowa.data?.rozmowa.id === w.rozmowaId) {
      /* Agent nie odszedł — efekt zmiany rozmowy się nie odpali. */
      przywroc.current = null;
      setSzkic(w.body);
      zapamietajSzkic(PAMIEC_ODPOWIEDZI, w.rozmowaId, w.body);
      if (blad) zglos(blad);
      return;
    }
    zapamietajSzkic(PAMIEC_ODPOWIEDZI, w.rozmowaId, w.body);
    przywroc.current = { rozmowaId: w.rozmowaId, body: w.body, blad };
    nawiguj(`/obsluga/skrzynka/${w.rozmowaId}`);
  }

  /* Wyjście z ekranu skrzynki w trakcie odliczania to NIE cofnięcie: agent
     kliknął „Wyślij", więc odpowiedź wychodzi od razu, zamiast przepaść.
     Zamknięcie karty to inna sprawa — o nie pyta `beforeunload` niżej. */
  const odlozoneRef = useRef(odlozone);
  odlozoneRef.current = odlozone;
  useEffect(() => () => {
    for (const w of odlozoneRef.current) {
      if (w.stan.rodzaj !== "czeka") continue;
      clearTimeout(timery.current.get(w.klucz));
      void wyslijWTle.mutateAsync(w.paczka).catch(() => {});
    }
  }, []);
  const czekajace = odlozone.some((o) => o.stan.rodzaj === "czeka" || o.stan.rodzaj === "wysyla");
  useEffect(() => {
    if (!czekajace) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [czekajace]);

  /* Po każdym przejściu dalej fokus schodzi na tło strony (@wydanie). Gdy
     następna rozmowa była już w pamięci, fokus zostawał w polu albo na
     przycisku wysyłki: j/k milkły, a drugie Ctrl+Enter trafiało w nietknięty
     szkic NASTĘPNEJ rozmowy. */
  function dalej(nast: number | null) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (nast !== null) nawiguj(`/obsluga/skrzynka/${nast}`);
  }

  function wyslijOdpowiedz(mimoNowejWiadomosci = false, mimoObecnosci = false, zakonczPo = false) {
    if (!rozmowa.data) return;
    /* ── KONFLIKT PRZY KLIKNIĘCIU, NIE DZIESIĘĆ SEKUND PÓŹNIEJ (@wydanie) ───
       Dwie rzeczy, które zatrzymają wysyłkę na serwerze, ekran zna już teraz:
       klient dopisał (szyna zdarzeń, `nowa`) i kolega trzyma rozmowę
       (`oglada` w wierszu kolejki). Do tego wydania wysyłka i tak szła do
       kolejki cofnięć, a czerwony dymek przychodził, gdy agent był dwie
       rozmowy dalej — powrót kosztował wątek myślowy. Tu pytamy od razu,
       tym samym paskiem i tym samym dialogiem co dotąd. */
    if (!mimoNowejWiadomosci && nowa) {
      setNowa(false);
      void rozmowa.refetch();
      setBlad("Klient dopisał wiadomość — przeczytaj ją; odpowiedź czeka w polu.");
      return;
    }
    const trzyma = lista.data?.rozmowy.find((r) => r.id === rozmowa.data?.rozmowa.id)?.oglada ?? null;
    if (!mimoObecnosci && trzyma && trzyma.userId !== (ja.data?.user.userId ?? null)) {
      setPrzyRozmowie(trzyma.name);
      return;
    }
    /* Zwykłe „Wyślij" idzie przez dziesięć sekund na cofnięcie i od razu
       prowadzi do następnej rozmowy. Wysyłka PO JAWNEJ ZGODZIE z dialogu
       konfliktu („odpowiedz mimo to") idzie wprost: agent właśnie tę decyzję
       podjął przy tej rozmowie i czeka na jej wynik tutaj. */
    if (!mimoNowejWiadomosci && !mimoObecnosci) {
      const w: Wpis = {
        klucz: Date.now() + Math.random(), rozmowaId: rozmowa.data.rozmowa.id,
        klient: rozmowa.data.rozmowa.klient, body: szkic,
        stan: { rodzaj: "czeka", doKiedy: Date.now() + OKNO_COFNIECIA_MS },
        paczka: { id: rozmowa.data.rozmowa.id, body: szkic,
          expectedVersion: rozmowa.data.rozmowa.wersja, expectedLastMessageId: ostatniaKlienta,
          zakoncz: zakonczPo, msOdOtwarcia: Date.now() - otwartaOd.current },
      };
      setOdlozone((l) => [...l, w]);
      timery.current.set(w.klucz, setTimeout(() => wyslijOdlozona(w), OKNO_COFNIECIA_MS));
      oznaczDzialanie();
      ustawSzkic("");
      /* NASTĘPNA W TYM, CO WIDAĆ — patrz `nastepnaRozmowa`. */
      dalej(nastepnaRozmowa(widoczne.current, w.rozmowaId));
      return;
    }
    setBladWysylki("");
    oznaczDzialanie();
    wyslij.mutate({
      id: rozmowa.data.rozmowa.id, body: szkic,
      expectedVersion: rozmowa.data.rozmowa.wersja,
      expectedLastMessageId: ostatniaKlienta, mimoNowejWiadomosci, mimoObecnosci, zakoncz: zakonczPo,
    }, {
      onSuccess: (w) => {
        setKonfliktWysylki(null);
        setPrzyRozmowie(null);
        if (w.status === "sent") ustawSzkic("");
        else setBlad("Wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj wątek.");
      },
      onError: (e) => {
        /* Dopisek klienta nie jest błędem do pokazania w pasku: ekran ma
           postawić dialog i poprosić o jawną zgodę. */
        if (e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).nowaWiadomosc !== undefined) {
          setKonfliktWysylki(e.szczegoly as SzczegolyWysylki);
        /* Drugi rodzaj konfliktu: przy rozmowie siedzi kto inny. Pytanie do
           agenta jest inne niż przy dopisku klienta, więc i pasek jest inny —
           a zgoda musi być jawna, tak samo jak tam. */
        } else if (e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).trzymajacyName) {
          setPrzyRozmowie((e.szczegoly as SzczegolyWysylki).trzymajacyName ?? "");
        /* Trzeci rodzaj: rozmowę prowadzi KTO INNY na stałe. Od 0.395.0 to
           jedyne wejście do dialogu przekazania — wcześniej otwierał go
           przegrany wyścig o przycisk „PRZEJMIJ ROZMOWĘ", a przycisk zszedł
           z ekranu. Jedno zdanie w pasku byłoby tu stratą: agent musi
           zobaczyć, KTO prowadzi i mieć drogę poproszenia go o przekazanie. */
        } else if (e instanceof Konflikt
          && (e.szczegoly as SzczegolyKonfliktu).assignedUserId != null) {
          setKonflikt(e.szczegoly as SzczegolyKonfliktu);
        } else if (konfliktWysylki) setBladWysylki((e as Error).message);
        else zglos(e);
      },
    });
  }

  /* JEDEN PRZYCISK (22 września 2026): pusty szkic dostaje treść, pełny
     jest zastępowany — napis przycisku mówi to agentowi PRZED kliknięciem.
     Ocena zostaje zapisana, bo to ona chowa kartę po użyciu; los szkicu
     liczy już wysyłka (`szkic_los`), nie to kliknięcie. */
  function poprawSzkicem() {
    const t = rozmowa.data?.szkicCopilota?.tresc;
    if (!rozmowa.data || !t) return;
    const zastepuje = szkic.trim() !== "";
    ustawSzkic(t);
    setZCopilota(true);
    ocenSzkic.mutate({ rozmowaId: rozmowa.data.rozmowa.id,
      ocena: zastepuje ? "zastapiony" : "wstawiony" });
  }
  function odrzucSzkic() {
    if (!rozmowa.data) return;
    ocenSzkic.mutate({ rozmowaId: rozmowa.data.rozmowa.id, ocena: "odrzucony" });
    /* Odrzucony szkic schodzi też z pola — ale tylko NIETKNIĘTY. Tekst, który
       agent zaczął poprawiać, jest już jego pracą i odrzucenie propozycji
       nie ma prawa go skasować. */
    if (zCopilota && szkic === rozmowa.data.szkicCopilota?.tresc) ustawSzkic("");
    setZCopilota(false);
  }

  /* ── E I R PRZY KARCIE SZKICU (23 września 2026) ────────────────────────
     „Wstaw do odpowiedzi" i „Odrzuć" z klawiatury, ten sam strażnik co
     w kolejce: pole tekstowe wygrywa zawsze, bo „e" w słowie „jest" nie może
     wstawiać szkicu. Klawisze działają tylko przy karcie na ekranie —
     z cudzą rozmową albo bez propozycji nie robią nic. */
  /* SZKIC JUŻ W POLU = KARTA BEZ „WSTAW" (@wydanie). Karta chowa wtedy
     swój przycisk (`!wPolu` w `SzkicCopilota.tsx`), ale klawisz działał dalej:
     poprawiony szkic, klik obok pola, „e" — i poprawki znikały bez cofnięcia,
     a pomiar zapisywał „zastąpiony". Klawisz ma robić to, co widać. */
  const kartaWidoczna = Boolean(rozmowa.data?.szkicCopilota && rozmowa.data.szkicCopilota.ocena === null)
    && !(zCopilota && szkic !== "")
    && !(rozmowa.data?.rozmowa.wlascicielId != null
      && rozmowa.data.rozmowa.wlascicielId !== (ja.data?.user.userId ?? null));
  const skrot = useRef({ popraw: poprawSzkicem, odrzuc: odrzucSzkic, widoczna: kartaWidoczna });
  skrot.current = { popraw: poprawSzkicem, odrzuc: odrzucSzkic, widoczna: kartaWidoczna };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (polePisania(e.target)) return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || !skrot.current.widoczna) return;
      if (e.key === "e" || e.key === "E") { e.preventDefault(); skrot.current.popraw(); }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); skrot.current.odrzuc(); }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  /* Następna rozmowa wczytuje się, gdy agent czyta bieżącą — powód przy
     `usePrzygotujRozmowe`. Zależność od listy widocznych, bo po wysyłce
     „następna" przesuwa się razem z nią. */
  const otwarta = rozmowa.data?.rozmowa.id ?? null;
  useEffect(() => {
    if (otwarta === null) return;
    const nast = nastepnaRozmowa(widoczne.current, otwarta);
    if (nast !== null) przygotuj(nast);
  }, [otwarta, lista.dataUpdatedAt]);

  /* ── ODŁÓŻ DO TERMINU (@wydanie) ─────────────────────────────────────────
     Ten sam kształt co Zakończ: przejście dalej i pasek „Cofnij", bo
     odłożona schodzi z kubełka roboczego i pomyłki na liście nie widać.
     Cofnięcie zdejmuje odłożenie i wraca do rozmowy. */
  function odlozDo(doKiedy: string, opis: string) {
    if (!rozmowa.data) return;
    setBladStatusu("");
    const id = rozmowa.data.rozmowa.id;
    const klient = rozmowa.data.rozmowa.klient;
    odloz.mutate({ id, doKiedy }, {
      onSuccess: () => {
        oznaczDzialanie();
        dalej(nastepnaRozmowa(widoczne.current, id));
        setDoCofniecia({ klucz: Date.now(), opis: <>Odłożono rozmowę z <b>{klient}</b> {opis}</>,
          cofnij: () => {
            odloz.mutate({ id, doKiedy: null }, { onError: (e) => setBladStatusu((e as Error).message) });
            nawiguj(`/obsluga/skrzynka/${id}`);
          } });
      },
      onError: (e) => setBladStatusu((e as Error).message),
    });
  }

  const jestemAdminem = ja.data?.user.role === "admin";
  const alarm = Boolean(zdrowie.data?.allegroInbox.alarm);

  /* Ekran trzyma się okna, a przewijają się kolumny (0.165.0) — ten sam nawyk
     co w zwrotach, bo dwa ekrany obsługi mają mieć jeden, nie dwa.

     Alarm stoi POZA gridem: jako wiersz `col-span-2` byłby wierszem
     warunkowym, a wtedy kolumny wpadałyby w niego przy pustym alarmie
     i blokada by znikała.

     TABELA `StanIntegracji` odeszła stąd w 0.168.0 — za zębatkę, na ekran
     ustawień. Skrzynka jest ekranem pracy, a trzynaście wierszy z
     `/api/health` czyta się raz na tydzień. Alarm ZOSTAJE: zasada 10 projektu
     mówi „awaria integracji musi być widoczna", a §21 żąda trwałego alarmu —
     schowaniu podlegała tabela, nie ostrzeżenie. */
  return <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
    <AlarmSynchronizacji zdrowie={zdrowie.data} trwa={synchronizuj.isPending}
      blad={bladSynchronizacji}
      synchronizuj={() => { setBladSynchronizacji(""); synchronizuj.mutate(undefined,
        { onError: (e) => setBladSynchronizacji((e as Error).message) }); }} />

    {/* Trzy kolumny (§10.1, 0.180.0), wzorcem z ekranu zwrotów: skrajne stałe,
        środek `minmax(0,1fr)`. Samo `1fr` to skrót od `minmax(auto,1fr)` —
        środek rozpychałby się ponad przydział, gdy oś dostanie długi wyraz.
        `lg:grid-rows-[minmax(0,1fr)]` trzyma wysokość: pojedynczy wiersz
        `auto` mierzy się do `max-content` i grid wylewa się poza okno. */}
    <div className={SIATKA_TRZECH_KOLUMN}>
    <Kolejka
      nieswieza={alarm}
      copilot={copilot.data}
      klasyfikacja={{
        trwa: klasyfikuj.isPending,
        wynik: klasyfikuj.data ?? null,
        blad: klasyfikuj.error ? (klasyfikuj.error as Error).message : null,
      }}
      onRozpoznaj={(rozmowyId) => klasyfikuj.mutate({ rozmowyId })}
      rozmowy={lista.data?.rozmowy ?? []}
      stan={lista.data?.stan ?? { ostatniaSynchronizacja: null, bledy: 0 }}
      wybranaId={wybranaId}
      mojeId={ja.data?.user.userId ?? null}
      laduje={lista.isLoading}
      onOdswiez={() => lista.refetch()}
      onWidoczne={(ids) => { widoczne.current = ids; }}
      powiadomienia={sygnaly}
      onWybierz={(x) => nawiguj(`/obsluga/skrzynka/${x}`)} />

    <div className="flex min-h-0 flex-col gap-4">
    {/* Uchwyt kolegi zatrzymuje wysyłkę, ale nigdy po cichu: zgoda jest jawna,
        tak samo jak przy dopisku klienta z 0.110.0. */}
    {przyRozmowie && <div className="card flex shrink-0 flex-wrap items-center gap-3 border-violet-300 bg-violet-50 p-3 text-sm">
      <span><b>{przyRozmowie}</b> siedzi teraz przy tej rozmowie.</span>
      <span className="text-slate-600">Dwie odpowiedzi na jedno pytanie to dwie różne prawdy u klienta.</span>
      <div className="ml-auto flex gap-2">
        <button type="button" className="btn-secondary text-sm"
          onClick={() => setPrzyRozmowie(null)}>Zostaw koledze</button>
        <button type="button" className="btn-primary text-sm" disabled={wyslij.isPending}
          onClick={() => wyslijOdpowiedz(false, true)}>Odpowiedz mimo to</button>
      </div>
    </div>}

    <Rozmowa
      dane={rozmowa.data}
      laduje={wybranaId !== null && rozmowa.isLoading}
      mojeId={ja.data?.user.userId ?? null}
      obecni={obecnosc}
      nowaWiadomosc={nowa}
      szkic={szkic}
      zapisuje={zapisz.isPending}
      zrodloPomiaru={zrodlo}
      wskazowka={wskazowka}
      towar={towar}
      onPokazNowa={() => { setNowa(false); rozmowa.refetch(); }}
      poprawia={poprawKategorie.isPending}
      onPoprawKategorie={(kategoria) => rozmowa.data && poprawKategorie.mutate(
        { rozmowaId: rozmowa.data.rozmowa.id, kategoria })}
      komentarz={komentarz}
      onKomentarz={(v) => { ustawKomentarz(v); zglosPisanie(); }}
      doNotatki={doNotatki}
      komentuje={dodajKomentarz.isPending}
      /* Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to nie
         odpowiedź do klienta. */
      onDodajKomentarz={() => rozmowa.data && dodajKomentarz.mutate(
        { rozmowaId: rozmowa.data.rozmowa.id, body: komentarz, mentionedUserIds: wzmianki },
        { onSuccess: () => { oznaczDzialanie(); ustawKomentarz(""); setWzmianki([]); } })}
      agenci={(agenci.data?.users ?? [])
        .filter((u) => u.userId !== ja.data?.user.userId)
        .map((u) => ({ userId: u.userId, name: u.name }))}
      wzmianki={wzmianki}
      onWzmianki={setWzmianki}
      copilot={{
        stan: copilot.data,
        szkic: rozmowa.data?.szkicCopilota ?? null,
        /* Nieświeży = klient dopisał po tym, jak model czytał wątek. Porównanie
           po identyfikatorze ostatniej wiadomości KLIENTA, tak jak przy wysyłce. */
        nieswiezy: (rozmowa.data?.szkicCopilota?.messageId ?? null) !== ostatniaKlienta,
        doborWersja: rozmowa.data?.dobor.wersja ?? null,
        nowePolaDoboru: propozycjaDoboru(rozmowa.data?.szkicCopilota, rozmowa.data?.dobor.dane)
          .nowe.map((n) => n.nazwa),
        paraPasowania: paraPasowania(rozmowa.data?.szkicCopilota),
        uklada: ulozSzkic.isPending,
        blad: bladSzkicu,
        maSzkicAgenta: szkic.trim() !== "",
        wPolu: zCopilota,
        /* Cudza rozmowa = cudzy szkic: ten sam warunek, którym edytor blokuje pole. */
        wylaczony: rozmowa.data?.rozmowa.wlascicielId != null
          && rozmowa.data.rozmowa.wlascicielId !== (ja.data?.user.userId ?? null),
        /* ZAMÓWIONY SZKIC WCHODZI DO PUSTEGO POLA (@wydanie). Reguła 0.500.0
           („nic nie wchodzi do pola, gdy agent patrzy") chroni przed szkicem
           z TŁA. Ten agent właśnie kliknął „Ułóż odpowiedź" i czekał —
           kazać mu jeszcze wcisnąć E to krok bez decyzji. Pole z tekstem
           zostaje nietknięte, a szkic czeka w karcie jak dotąd. */
        onUloz: () => {
          if (!rozmowa.data) return;
          const id = rozmowa.data.rozmowa.id;
          ulozSzkic.mutate({ rozmowaId: id }, {
            onError: (e) => setBladSzkicu((e as Error).message),
            onSuccess: (r) => {
              setBladSzkicu("");
              if (wybranaIdTeraz.current !== id || szkicTeraz.current !== "" || !r.szkic?.tresc) return;
              wstawione.current.add(`${id}:${r.szkic.at}`);
              ustawSzkic(r.szkic.tresc);
              setZCopilota(true);
            },
          });
        },
        /* JEDEN PRZYCISK (22 września 2026): pusty szkic dostaje treść, pełny
           jest zastępowany — napis przycisku mówi to agentowi PRZED kliknięciem.
           Ocena zostaje zapisana, bo to ona chowa kartę po użyciu; los szkicu
           liczy już wysyłka (`szkic_los`), nie to kliknięcie. */
        onPopraw: poprawSzkicem,
        onOdrzuc: odrzucSzkic,
        /* DOPYTANIE (0.332.0). Bez `onSuccess` czyszczącego szkic czy oś:
           odpowiedź czyta agent, a do klienta nie idzie stąd nic. */
        dopytanie: {
          wymiany: wymiany.data ?? [],
          blad: bladPytania,
          pracuje: zadajPytanie.isPending,
          limitZnakow: LIMIT_PYTANIA,
          onPytaj: (pytanie: string) => rozmowa.data && zadajPytanie.mutate(
            { rozmowaId: rozmowa.data.rozmowa.id, pytanie },
            { onError: (e) => setBladPytania((e as Error).message),
              onSuccess: () => setBladPytania(null) }),
          zapisuje: zapiszPasowanie.isPending,
          onZapiszPasowanie: (wymianaId: number, nr: number) => rozmowa.data && zapiszPasowanie.mutate(
            { rozmowaId: rozmowa.data.rozmowa.id, wymianaId, nr },
            { onError: (e) => setBladPytania((e as Error).message),
              onSuccess: () => setBladPytania(null) }),
        },
      }}
      zalaczniki={zalaczniki.data?.zalaczniki ?? []}
      dodajeZalacznik={dodajZalacznik.isPending}
      bladZalacznika={bladZalacznika}
      /* Plik czytamy TU, nie w komponencie: `Zalaczniki.tsx` jest czysty, jak
         cały katalog `skrzynka/`, a base64 to sprawa klienta HTTP. */
      onDodajZalacznik={(plik) => {
        setBladZalacznika("");
        void naBase64(plik).then((dane) => {
          if (!wybranaId) return;
          dodajZalacznik.mutate(
            { id: wybranaId, nazwa: plik.name, typ: plik.type, dane },
            { onError: (e) => setBladZalacznika(e instanceof Error ? e.message : String(e)) });
        });
      }}
      onUsunZalacznik={(id) => wybranaId && usunZalacznik.mutate(
        { id: wybranaId, zalacznikId: id },
        { onError: (e) => setBladZalacznika(e instanceof Error ? e.message : String(e)) })}
      onSzkic={(v) => { ustawSzkic(v); if (v === "") setZCopilota(false); zglosPisanie(); }}
      onZapiszSzkic={() => {
        if (!rozmowa.data) return;
        const ostatnia = [...rozmowa.data.os].reverse().find((w) => w.messageId)?.messageId ?? null;
        zapisz.mutate({
          id: rozmowa.data.rozmowa.id, body: szkic, expectedLastMessageId: ostatnia,
          expectedVersion: rozmowa.data.szkic?.wersja ?? null,
        }, { onError: zglos, onSuccess: () => setBlad("") });
      }}
      onZrodlo={setZrodlo}
      onWskazowka={setWskazowka}
      onTowar={setTowar}
      wysyla={wyslij.isPending}
      onWyslij={() => wyslijOdpowiedz(false)}
      onZlec={() => {
        if (!rozmowa.data || !zrodlo) return;
        zlec.mutate({
          rozmowaId: rozmowa.data.rozmowa.id, wiadomoscId: zrodlo,
          instrukcja: wskazowka, twId: towar ? towar.id : null,
        }, { onError: zglos, onSuccess: () => { setZrodlo(null); setWskazowka(""); setTowar(null); } });
      }}
      konflikt={konflikt}
      mozeWymusic={jestemAdminem}
      wymusza={przekaz.isPending}
      bladKonfliktu={bladKonfliktu}
      zapisujeOferte={oferta.isPending}
      bladOferty={bladOferty}
      onZamknijKonflikt={() => setKonflikt(null)}
      onPoprosOPrzekazanie={() => {
        /* Prośba o przekazanie to komentarz wewnętrzny, nie osobny mechanizm:
           właściciel czyta go w rozmowie, przy której siedzi. */
        /* Do @wydanie prośba lądowała w polu ODPOWIEDZI DO KLIENTA, wbrew
           zdaniu wyżej — nadpisywała tekst agenta i w cudzej rozmowie nie
           dała się nawet wysłać. Idzie do notatki, a edytor przełącza się
           na nią, żeby agent widział, gdzie pisze. */
        if (!rozmowa.data) return;
        ustawKomentarz(`@${konflikt?.assignedUserName ?? ""} — przejmiesz tę rozmowę?`);
        setDoNotatki((n) => n + 1);
        setKonflikt(null);
      }}
      onWymus={(powod) => {
        if (!rozmowa.data) return;
        setBladKonfliktu("");
        przekaz.mutate({
          id: rozmowa.data.rozmowa.id, doUserId: ja.data?.user.userId ?? null,
          powod, expectedVersion: konflikt?.version ?? rozmowa.data.rozmowa.wersja,
        }, { onSuccess: () => setKonflikt(null),
             onError: (e) => setBladKonfliktu((e as Error).message) });
      }}
      onWskazOferte={(ofertaId) => {
        if (!rozmowa.data) return;
        setBladOferty("");
        oferta.mutate({ id: rozmowa.data.rozmowa.id, ofertaId },
          { onError: (e) => setBladOferty((e as Error).message) });
      }}
      onOtworzRozmowe={(x) => nawiguj(`/obsluga/skrzynka/${x}`)}
      zapisujePriorytet={priorytet.isPending}
      onPriorytet={(nowy) => {
        if (!rozmowa.data) return;
        setBladStatusu("");
        priorytet.mutate({ id: rozmowa.data.rozmowa.id, priorytet: nowy },
          { onError: (e) => setBladStatusu((e as Error).message) });
      }}
      zapisujeReklamacyjna={reklamacyjna.isPending}
      onReklamacyjna={(nowy) => {
        if (!rozmowa.data) return;
        setBladStatusu("");
        reklamacyjna.mutate({ id: rozmowa.data.rozmowa.id, reklamacyjna: nowy },
          { onError: (e) => setBladStatusu((e as Error).message) });
      }}
      /* ── ZAKOŃCZ (23 września 2026) ─────────────────────────────────────
         Po zakończeniu ekran idzie do następnej rozmowy, jak po wysyłce:
         zakończona i tak schodzi z kubełka roboczego, więc zostanie przy
         niej znaczyłoby patrzenie na coś, czego na liście już nie ma. */
      zmieniaStatus={zakoncz.isPending || otworz.isPending || odloz.isPending}
      onZakoncz={(mimoPytania) => {
        if (!rozmowa.data) return;
        setBladStatusu("");
        const id = rozmowa.data.rozmowa.id;
        const klient = rozmowa.data.rozmowa.klient;
        zakoncz.mutate({ id, mimoPytania }, {
          onSuccess: () => {
            oznaczDzialanie();
            dalej(nastepnaRozmowa(widoczne.current, id));
            /* COFNIJ PO ZAKOŃCZENIU (0.500.0): rozmowa właśnie zniknęła
               z listy i z ekranu, więc pomyłki nie widać. Cofnięcie to ta sama
               „Otwórz ponownie", która stoi w nagłówku — plus powrót do niej. */
            setDoCofniecia({ klucz: Date.now(), opis: <>Zakończono rozmowę z <b>{klient}</b></>,
              cofnij: () => {
                otworz.mutate({ id, zCofniecia: true }, { onError: (e) => setBladStatusu((e as Error).message) });
                nawiguj(`/obsluga/skrzynka/${id}`);
              } });
          },
          onError: (e) => setBladStatusu((e as Error).message),
        });
      }}
      onOtworz={() => {
        if (!rozmowa.data) return;
        setBladStatusu("");
        otworz.mutate({ id: rozmowa.data.rozmowa.id },
          { onError: (e) => setBladStatusu((e as Error).message) });
      }}
      onWyslijIZakoncz={() => wyslijOdpowiedz(false, false, true)}
      onOdloz={odlozDo}
      onWrocZOdlozenia={() => rozmowa.data && odloz.mutate({ id: rozmowa.data.rozmowa.id, doKiedy: null },
        { onError: (e) => setBladStatusu((e as Error).message) })}
      bladStatusu={bladStatusu}
      onDopytajOOferte={() => { if (szkic === "") ustawSzkic(
        "Dzień dobry, proszę o numer oferty, której dotyczy pytanie — dobiorę wtedy właściwą część."); }}
    />
    </div>

    {/* Trzecia kolumna. Bez rozmowy nie ma czego pokazać — kolumna znika,
        zamiast stać pusta i zabierać środkowi 340 px. */}
    {rozmowa.data && <Kontekst dane={rozmowa.data}
      onWstawDoSzkicu={(t) => ustawSzkic(szkic ? `${szkic}\n${t}` : t)}
      /* Ta sama droga, co z osi rozmowy: historia klienta prowadzi do rozmowy,
         w której maszynę ustalono. */
      onOtworzRozmowe={(x) => nawiguj(`/obsluga/skrzynka/${x}`)}
      /* „Zleć pomiar" z doboru to ISTNIEJĄCY przepływ: kartoteka wskazana
         z góry, źródłem ostatnia wiadomość klienta — agent widzi formularz
         i sam klika ZLEĆ. Bez wiadomości klienta nie ma z czego zlecać. */
      onZlecPomiar={(t) => {
        const ostatniaKlienta = [...(rozmowa.data?.os ?? [])].reverse()
          .find((w) => w.odKlienta && w.messageId)?.messageId ?? null;
        setTowar(t); setZrodlo(ostatniaKlienta);
      }} />}
    </div>

    {/* Dialog jest `fixed`, ale jako dziecko gridu założyłby niejawny wiersz —
        a wtedy kolumny przestałyby się mieścić w oknie. */}
    {konfliktWysylki && <DialogKonfliktu
      szczegoly={konfliktWysylki} szkic={szkic} wysyla={wyslij.isPending} blad={bladWysylki}
      onWyslijMimoTo={() => wyslijOdpowiedz(true)}
      onPopraw={() => { setKonfliktWysylki(null); rozmowa.refetch(); }} />}

    <div className="shrink-0 space-y-4">
      <Blad>{blad || (lista.error as Error | null)?.message}</Blad>
    </div>

    {/* JEDEN STOS PASKÓW, NAD KOLEJKĄ (@wydanie) — powód stosu w `Cofniecie.tsx`.
        Stał na środku dołu, czyli NA pływającym pasku wysyłki środkowej
        kolumny: przez dziesięć sekund po wysyłce przycisk „Wyślij" następnej
        rozmowy był zasłonięty. Nad dołem kolejki zasłania najwyżej jej
        ostatnie wiersze, a te agent i tak ma pod j/k. Szerokość kolumny
        kolejki przy 1366 px, żeby nie wjeżdżać na środek. */}
    <div className="fixed bottom-4 left-4 z-40 flex w-[min(23rem,calc(100vw-2rem))] flex-col gap-2">
    <Cofniecie wpis={doCofniecia} onZamknij={() => setDoCofniecia(null)} />
    <Odlozone lista={odlozone}
      onCofnij={(k) => {
        const w = odlozone.find((o) => o.klucz === k);
        /* Wpis do pomiaru tarcia (0.500.0) — tylko przy „Cofnij". „Wróć"
           po błędzie wysyłki to nie pomyłka agenta, tylko Allegro. */
        /* Czas od odłożenia do „Cofnij" (@wydanie) — do pytania właściciela,
           czy dziesięć sekund to za długo. Liczony z odliczania na pasku. */
        if (w) {
          const ms = w.stan.rodzaj === "czeka" ? OKNO_COFNIECIA_MS - (w.stan.doKiedy - Date.now()) : undefined;
          zglosCofnietaWysylke(w.rozmowaId, ms);
          wrocDo(w);
        }
      }}
      onWroc={(k) => { const w = odlozone.find((o) => o.klucz === k); if (w) wrocDo(w, w.blad); }}
      onZamknij={usunOdlozona} />
    </div>
  </div>;
}
