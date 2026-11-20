import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/klient";
import { kluczeDostaw, type Wyjatek } from "../api/dostawy";
import { ile } from "../ui";

/* ── ALARM PROBLEMU W DOSTAWIE ───────────────────────────────────────────────
   Decyzja właściciela: problem zgłoszony przez halę ma KRZYCZEĆ w biurze.
   Wyjątek widział dotąd tylko ekran Dostaw, a biuro siedzi w skrzynce albo
   w Subiekcie. Kierowca czeka, towar stoi na rampie, a decyzja zapada
   dopiero wtedy, gdy ktoś przypadkiem wejdzie w zakładkę.

   TRZY KANAŁY, bo każdy łapie inną sytuację:
     1. Czerwony pas nad pracą na każdym ekranie panelu.
     2. Krótki sygnał dźwiękowy przy nowym zgłoszeniu. W skrzynce dźwięku nie
        ma, bo wiadomości przychodzą dziesiątkami. Problem w dostawie zdarza
        się kilka razy w tygodniu i czeka na niego człowiek przy rampie.
     3. Powiadomienie Windows, gdy karta panelu jest w tle.

   KIEDY CICHNIE. Po otwarciu dostawy, której dotyczy, na TYM komputerze.
   Pas bez przycisku zamknięcia: alarm zdejmowany odruchem znika, zanim ktoś
   go przeczyta. Sam wyjątek zostaje otwarty na ekranie Dostaw, dopóki biuro
   go nie rozstrzygnie. Reklamacja u dostawcy trwa dni, a pas przez tyle dni
   uczyłby go nie widzieć.

   Widziane wyjątki trzyma przeglądarka (`localStorage`). Otwarcie ekranu
   niczego nie zapisuje na serwerze, a „widziałem" to fakt stanowiska. */

const KLUCZ = "wertis.alarm-dostaw.widziane";

/* Pół minuty, jak reszta dostaw. Zapytanie biegnie także w tle, bo karta
   w tle to właśnie chwila, w której alarm ma przyjść. */
const RYTM = 30_000;

function czytajWidziane(): Set<number> | null {
  try {
    const surowe = localStorage.getItem(KLUCZ);
    if (surowe === null) return null;
    const lista = JSON.parse(surowe) as unknown;
    return new Set(Array.isArray(lista) ? lista.filter((x): x is number => typeof x === "number") : []);
  } catch { return new Set(); }
}

function zapiszWidziane(ids: Set<number>) {
  try { localStorage.setItem(KLUCZ, JSON.stringify([...ids])); } catch { /* prywatne okno */ }
}

/**
 * Wyjątki, które ten komputer ma jeszcze zobaczyć.
 *
 * PIERWSZY ODCZYT NA NOWYM STANOWISKU TYLKO ZAPAMIĘTUJE. Bez tego wydanie
 * zapaliłoby alarm o każdym starym wyjątku naraz, także o reklamacjach
 * sprzed miesiąca.
 */
export function nowePoWidzianych(wyjatki: Wyjatek[], widziane: Set<number> | null): Wyjatek[] {
  if (widziane === null) return [];
  return wyjatki.filter((w) => !widziane.has(w.id));
}

/** Adres dostawy w panelu. Towar spoza dokumentu ma adres `bez`. */
export const adresDostawy = (w: Wyjatek) => `/obsluga/dostawy/${w.dokId ?? "bez"}`;

/** Krótki, dwutonowy sygnał. Bez pliku dźwięku, więc bez pobierania. */
function zagraj() {
  try {
    const Kontekst = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Kontekst) return;
    const ctx = new Kontekst();
    const glosnosc = ctx.createGain();
    glosnosc.connect(ctx.destination);
    glosnosc.gain.value = 0.25;
    [880, 660, 880, 660].forEach((hz, i) => {
      const ton = ctx.createOscillator();
      ton.type = "square";
      ton.frequency.value = hz;
      ton.connect(glosnosc);
      ton.start(ctx.currentTime + i * 0.18);
      ton.stop(ctx.currentTime + i * 0.18 + 0.15);
    });
    window.setTimeout(() => void ctx.close(), 1500);
  } catch { /* przeglądarka bez dźwięku albo bez zgody na odtwarzanie */ }
}

function powiadom(w: Wyjatek[], otworz: (w: Wyjatek) => void) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const pierwszy = w[0];
  const n = new Notification(w.length > 1
    ? `Problem w dostawie: ${ile(w.length, "zgłoszenie", "zgłoszenia", "zgłoszeń")}`
    : `Problem w dostawie: ${pierwszy.typLabel}`, {
    body: [pierwszy.docNumber, pierwszy.sym, pierwszy.name].filter(Boolean).join(" · "),
    tag: `wertis-dostawa-${pierwszy.id}`,
    requireInteraction: true,
  });
  n.onclick = () => { window.focus(); otworz(pierwszy); n.close(); };
}

export function useAlarmDostaw(otworz: (w: Wyjatek) => void) {
  const zapytanie = useQuery({
    queryKey: kluczeDostaw.wyjatki,
    queryFn: () => api<{ problems: Wyjatek[] }>("/api/problems/unresolved"),
    refetchInterval: RYTM,
    refetchIntervalInBackground: true,
  });
  const [widziane, setWidziane] = useState<Set<number> | null>(czytajWidziane);
  const zaalarmowane = useRef<Set<number>>(new Set());
  const otworzRef = useRef(otworz);
  otworzRef.current = otworz;
  const wyjatki = zapytanie.data?.problems;

  /* Druga karta panelu potwierdza za tę: ten sam komputer, ta sama osoba. */
  useEffect(() => {
    const naZmiane = (e: StorageEvent) => { if (e.key === KLUCZ) setWidziane(czytajWidziane()); };
    window.addEventListener("storage", naZmiane);
    return () => window.removeEventListener("storage", naZmiane);
  }, []);

  /* Linia bazowa tylko z UDANEGO odczytu. Pusty wynik po awarii zapisałby
     „nic nie widziałem", a następny odczyt zapaliłby wszystko naraz. */
  useEffect(() => {
    if (!wyjatki || widziane !== null) return;
    const baza = new Set(wyjatki.map((w) => w.id));
    zapiszWidziane(baza);
    setWidziane(baza);
  }, [wyjatki, widziane]);

  const nowe = wyjatki ? nowePoWidzianych(wyjatki, widziane) : [];

  /* Dźwięk i powiadomienie raz na wyjątek w tej karcie. Pas stoi dalej. */
  const kluczNowych = nowe.map((w) => w.id).join(",");
  useEffect(() => {
    const swieze = nowe.filter((w) => !zaalarmowane.current.has(w.id));
    if (!swieze.length) return;
    for (const w of swieze) zaalarmowane.current.add(w.id);
    zagraj();
    if (document.hidden) powiadom(swieze, (w) => otworzRef.current(w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kluczNowych]);

  /** Wszystkie wyjątki tej dostawy uznaje za widziane na tym stanowisku. */
  const potwierdz = useCallback((dokId: number | null) => {
    if (!wyjatki) return;
    const aktualne = new Set(wyjatki.map((w) => w.id));
    const nastepne = new Set([...(widziane ?? [])].filter((id) => aktualne.has(id)));
    let zmiana = false;
    for (const w of wyjatki) {
      if (w.dokId === dokId && !nastepne.has(w.id)) { nastepne.add(w.id); zmiana = true; }
    }
    if (!zmiana) return;
    zapiszWidziane(nastepne);
    setWidziane(nastepne);
  }, [wyjatki, widziane]);

  return { nowe, potwierdz };
}
