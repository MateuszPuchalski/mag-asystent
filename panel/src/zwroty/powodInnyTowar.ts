import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/klient";
import { zagraj } from "../dostawy/alarm";

/* ── ALARM „INNY TOWAR" ──────────────────────────────────────────────────────
   Gdy klient w zwrocie wybierze powód „inny towar", zarzuca nam pomyłkę:
   wysłaliśmy co innego albo odsyła cudzy przedmiot. Biuro ma się o tym
   dowiedzieć od razu, a nie przy otwarciu kolejki, bo od tego zależy, czy
   kartonu nie wpisze się na stan pod zamówioną kartoteką.

   Ten sam wzór co alarm dostaw (`dostawy/alarm.ts`): pas na każdym ekranie,
   krótki sygnał i powiadomienie Windows, gdy karta jest w tle. Widziane zwroty
   trzyma przeglądarka (`localStorage`), bo „widziałem" to fakt stanowiska,
   a otwarcie ekranu niczego nie zapisuje na serwerze.

   PIERWSZY ODCZYT NA NOWYM STANOWISKU TYLKO ZAPAMIĘTUJE — inaczej wydanie
   zapaliłoby alarm o każdym starym zwrocie naraz.                            */

export interface ZwrotInnyTowar {
  id: number;
  numer: string | null;
  utworzono: string;
  pozycje: string[];
  komentarz: string | null;
}

const KLUCZ = "wertis.alarm-inny-towar.widziane";
const RYTM = 30_000;

function czytaj(): Set<number> | null {
  try {
    const surowe = localStorage.getItem(KLUCZ);
    if (surowe === null) return null;
    const lista = JSON.parse(surowe) as unknown;
    return new Set(Array.isArray(lista) ? lista.filter((x): x is number => typeof x === "number") : []);
  } catch { return new Set(); }
}

function zapisz(ids: Set<number>) {
  try { localStorage.setItem(KLUCZ, JSON.stringify([...ids])); } catch { /* prywatne okno */ }
}

/** Zwroty, które ten komputer ma jeszcze zobaczyć. */
export function nowePoWidzianych(zwroty: ZwrotInnyTowar[], widziane: Set<number> | null): ZwrotInnyTowar[] {
  if (widziane === null) return [];
  return zwroty.filter((z) => !widziane.has(z.id));
}

export const adresZwrotu = (z: ZwrotInnyTowar) => `/obsluga/zwroty/${z.id}`;

function powiadom(z: ZwrotInnyTowar[], otworz: (z: ZwrotInnyTowar) => void) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const pierwszy = z[0];
  const n = new Notification(z.length > 1
    ? `Zwrot: ${z.length} zgłoszenia „inny towar”` : "Zwrot: klient wskazał „inny towar”", {
    body: [pierwszy.numer, pierwszy.pozycje[0]].filter(Boolean).join(" · "),
    tag: `wertis-inny-towar-${pierwszy.id}`,
    requireInteraction: true,
  });
  n.onclick = () => { window.focus(); otworz(pierwszy); n.close(); };
}

export function useAlarmInnyTowar(otworz: (z: ZwrotInnyTowar) => void) {
  const zapytanie = useQuery({
    queryKey: ["zwroty", "alarm-inny-towar"] as const,
    queryFn: () => api<{ zwroty: ZwrotInnyTowar[] }>("/api/obsluga/zwroty/alarm-inny-towar"),
    refetchInterval: RYTM,
    refetchIntervalInBackground: true,
    /* Konto bez roli biura dostaje 403; ponawianie tylko hałasuje. */
    retry: false,
  });
  const [widziane, setWidziane] = useState<Set<number> | null>(czytaj);
  const zaalarmowane = useRef<Set<number>>(new Set());
  const otworzRef = useRef(otworz);
  otworzRef.current = otworz;
  const zwroty = zapytanie.data?.zwroty;

  useEffect(() => {
    const naZmiane = (e: StorageEvent) => { if (e.key === KLUCZ) setWidziane(czytaj()); };
    window.addEventListener("storage", naZmiane);
    return () => window.removeEventListener("storage", naZmiane);
  }, []);

  /* Linia bazowa tylko z UDANEGO odczytu: pusty wynik po awarii zapisałby
     „nic nie widziałem" i następny odczyt zapaliłby wszystko naraz. */
  useEffect(() => {
    if (!zwroty || widziane !== null) return;
    const baza = new Set(zwroty.map((z) => z.id));
    zapisz(baza);
    setWidziane(baza);
  }, [zwroty, widziane]);

  const nowe = zwroty ? nowePoWidzianych(zwroty, widziane) : [];

  const kluczNowych = nowe.map((z) => z.id).join(",");
  useEffect(() => {
    const swieze = nowe.filter((z) => !zaalarmowane.current.has(z.id));
    if (!swieze.length) return;
    for (const z of swieze) zaalarmowane.current.add(z.id);
    zagraj();
    if (document.hidden) powiadom(swieze, (z) => otworzRef.current(z));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kluczNowych]);

  /** Uznaje zwrot za widziany na tym stanowisku. */
  const potwierdz = (id: number) => {
    if (!zwroty) return;
    const aktualne = new Set(zwroty.map((z) => z.id));
    const nastepne = new Set([...(widziane ?? [])].filter((x) => aktualne.has(x)));
    if (nastepne.has(id)) return;
    nastepne.add(id);
    zapisz(nastepne);
    setWidziane(nastepne);
  };

  return { nowe, potwierdz };
}
