import { useEffect, useRef, useState } from "react";
import type { Rozmowa } from "../api/typy";

/* ── SYGNAŁY POZA EKRANEM (23 września 2026) ─────────────────────────────────
   Decyzja właściciela po przeglądzie UX. Agent pracuje też w Subiekcie
   i w panelu Allegro, a skrzynka nie dawała znać, że klient napisał — nic nie
   zmieniało tytułu karty i nie było powiadomień.

   LICZNIK W TYTULE KARTY zawsze: widać go na pasku kart, nie kosztuje uwagi
   i nie wymaga zgody przeglądarki.

   POWIADOMIENIE SYSTEMOWE tylko na zgodę i tylko dla dwóch rzeczy: klient
   prosi o człowieka albo czeka dłużej niż godzinę. Powiadomienie przy każdej
   wiadomości przestaje być czytane pierwszego dnia — a wtedy nie działa także
   to jedno, które było ważne. Żadnego dźwięku: w otwartym biurze przeszkadza
   wszystkim poza adresatem.

   Stan zgody trzyma przeglądarka (`localStorage`), bo to nawyk stanowiska,
   nie ustawienie firmy — ten sam wzór co kolejność listy w kolejce. Serwer
   nie dostaje nic: otwarcie ekranu dalej niczego nie zapisuje. */

const KLUCZ = "wertis.powiadomienia";
const GODZINA = 3_600_000;
const NASZ_RUCH = new Set(["new", "waiting_for_us", "waiting_for_internal"]);

/** Ile rozmów ma nieprzeczytaną wiadomość klienta — liczba do tytułu karty. */
export function licznikTytulu(rozmowy: Rozmowa[]): number {
  return rozmowy.filter((r) => r.nieprzeczytana && r.ostatniaOdKlienta
    && r.status !== "closed" && r.status !== "spam" && r.status !== "resolved").length;
}

/**
 * Powody powiadomienia dla jednej rozmowy, jako klucze „id:powód". Klucz
 * niesie powód, więc rozmowa, która najpierw prosiła o człowieka, a potem
 * przekroczyła godzinę, dostaje dwa powiadomienia — i ani jednego więcej.
 */
export function powodyPowiadomienia(r: Rozmowa): string[] {
  const powody: string[] = [];
  if (r.nieprzeczytana && r.kopilot?.wymagaCzlowieka && !r.kopilot.nieaktualna) powody.push(`${r.id}:czlowiek`);
  if (NASZ_RUCH.has(r.status) && !r.podziekowal && (r.czekaOdMs ?? 0) >= GODZINA) powody.push(`${r.id}:godzina`);
  return powody;
}

export type StanPowiadomien = "brak" | "wylaczone" | "wlaczone" | "zablokowane";

function stanPoczatkowy(): StanPowiadomien {
  if (typeof Notification === "undefined") return "brak";
  if (Notification.permission === "denied") return "zablokowane";
  let chce = false;
  try { chce = localStorage.getItem(KLUCZ) === "1"; } catch { /* prywatne okno */ }
  return chce && Notification.permission === "granted" ? "wlaczone" : "wylaczone";
}

export function useSygnaly(rozmowy: Rozmowa[] | undefined, onOtworz: (id: number) => void) {
  const [stan, setStan] = useState<StanPowiadomien>(stanPoczatkowy);
  const widziane = useRef<Set<string> | null>(null);
  const otworz = useRef(onOtworz);
  otworz.current = onOtworz;

  /* Tytuł karty — i przywrócenie poprzedniego przy wyjściu ze skrzynki, żeby
     licznik nie wisiał nad ekranem, który go nie liczy. */
  const ile = rozmowy ? licznikTytulu(rozmowy) : 0;
  useEffect(() => {
    const poprzedni = document.title;
    return () => { document.title = poprzedni; };
  }, []);
  useEffect(() => {
    document.title = ile > 0 ? `(${ile}) Skrzynka · WERTIS` : "Skrzynka · WERTIS";
  }, [ile]);

  useEffect(() => {
    if (!rozmowy) return;
    const teraz = rozmowy.flatMap(powodyPowiadomienia);
    /* PIERWSZY ODCZYT TYLKO ZAPAMIĘTUJE. Bez tego otwarcie skrzynki rano
       wystrzeliłoby powiadomienie o każdej rozmowie z nocy naraz. */
    if (widziane.current === null) { widziane.current = new Set(teraz); return; }
    const nowe = teraz.filter((k) => !widziane.current!.has(k));
    for (const k of nowe) widziane.current.add(k);
    if (stan !== "wlaczone" || !document.hidden) return;
    for (const k of nowe) {
      const [id, powod] = k.split(":");
      const r = rozmowy.find((x) => x.id === Number(id));
      if (!r) continue;
      const n = new Notification(powod === "czlowiek"
        ? `${r.klient} prosi o człowieka` : `${r.klient} czeka ponad godzinę`, {
        body: r.ostatniaWiadomosc.slice(0, 120), tag: k,
      });
      n.onclick = () => { window.focus(); otworz.current(r.id); n.close(); };
    }
  }, [rozmowy, stan]);

  async function przelacz() {
    if (typeof Notification === "undefined") return;
    if (stan === "wlaczone") {
      try { localStorage.setItem(KLUCZ, "0"); } catch { /* prywatne okno */ }
      setStan("wylaczone");
      return;
    }
    const zgoda = Notification.permission === "granted"
      ? "granted" : await Notification.requestPermission();
    if (zgoda === "granted") {
      try { localStorage.setItem(KLUCZ, "1"); } catch { /* prywatne okno */ }
      setStan("wlaczone");
    } else setStan(zgoda === "denied" ? "zablokowane" : "wylaczone");
  }

  return { stan, przelacz };
}
