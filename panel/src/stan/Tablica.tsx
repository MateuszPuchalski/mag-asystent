import React from "react";
import { useAlarmWymiany, useKolejka, useKolizje, useRekoncyliacja, useSonda, useStanAllegro } from "../api/stan";
import { useKolektory } from "../api/kolektory";
import type { Zdrowie } from "../api/typy";
import { godzina, ile } from "../ui";

/* ── Tablica stanu: jeden kafelek na obszar (@wydanie) ──────────────────
   Decyzja właściciela z 27 września 2026, wariant A z makiet. Stan systemu
   był dziesięcioma kartami jedna pod drugą, a zdrowe zajmowały tyle miejsca
   co te, które czegoś od biura chcą. Kolejka niosła dwadzieścia wierszy
   „zapisane", integracja dziewięć wierszy mówiących „działa".

   Kafelek odpowiada na jedno pytanie: czy ten obszar czegoś ode mnie chce.
   Barwa i jedno zdanie, a cała karta dopiero pod nim. Dekalog p. 1 i 5:
   najpierw to, co wymaga ruchu, reszta jest jednym kliknięciem dalej.

   KAFELEK CZYTA TO SAMO ZAPYTANIE CO JEGO KARTA, a nie własną trasę
   podsumowań. Pamięć zapytań jest wspólna, więc tablica nie dokłada ani
   jednego żądania, a kafelek nie może powiedzieć czegoś innego niż karta.
   Rekoncyliacja jest wyjątkiem z definicji: liczy się wyłącznie na żądanie,
   więc kafelek pokazuje wynik tylko wtedy, gdy ktoś ją już uruchomił. */

/** `zle` — coś nie działa; `uwaga` — czeka na biuro; `ok` — działa; `nic` — na żądanie albo bez oceny. */
export type TonObszaru = "zle" | "uwaga" | "ok" | "nic";

export interface Obszar {
  /** Człon kotwicy `#karta-<id>` i wartości `?karta=` — te same nazwy co w kartach. */
  id: string;
  nazwa: string;
  stan: string;
  ton: TonObszaru;
}

/** Obszar do pokazania bez pytania: coś nie działa albo czeka na biuro. */
export const doUwagi = (o: Obszar) => o.ton === "zle" || o.ton === "uwaga";

const CZEKA = "…";

/**
 * Stan każdego obszaru jednym zdaniem. Kolejność jest kolejnością kart
 * z 0.427.0 — kafelki i karty pod nimi czyta się w tym samym porządku.
 */
export function useObszary(admin: boolean, zdrowie: Zdrowie | undefined): Obszar[] {
  const kolejka = useKolejka().data;
  const kolizje = useKolizje().data;
  const rekon = useRekoncyliacja().data;
  const kolektory = useKolektory().data?.kolektory;
  const alarm = useAlarmWymiany().data;
  const allegro = useStanAllegro().data;
  const sonda = useSonda().data;

  const obszary: Obszar[] = [];
  const s = kolejka?.summary;
  obszary.push({ id: "kolejka", nazwa: "Zapisy do Subiekta", ...(!s ? { stan: CZEKA, ton: "nic" as const }
    : s.error > 0 ? { stan: `${s.error} w błędzie`, ton: "zle" as const }
      : s.pending > 0 ? { stan: `${s.pending} czeka na workera`, ton: "nic" as const }
        : { stan: "wszystko zapisane", ton: "ok" as const }) });

  if (admin) obszary.push({ id: "arkusz", nazwa: "Masowa zmiana lokalizacji", stan: "na żądanie", ton: "nic" });

  /* Nierozstrzygnięta kolizja i poprawka, po której kod dalej trafia, to
     ta sama praca biura: kartoteki trzeba ruszyć jeszcze raz. */
  const doDecyzji = (kolizje ?? []).filter((k) => !k.rozstrzygniecie
    || (k.rozstrzygniecie.rodzaj === "poprawione" && k.trafienPoDecyzji > 0)).length;
  obszary.push({ id: "kody", nazwa: "Kody kreskowe", ...(!kolizje ? { stan: CZEKA, ton: "nic" as const }
    : doDecyzji > 0 ? { stan: `${doDecyzji} do decyzji`, ton: "uwaga" as const }
      : { stan: kolizje.length ? "rozstrzygnięte" : "brak kolizji", ton: "ok" as const }) });

  obszary.push({ id: "rekoncyliacja", nazwa: "Rekoncyliacja", ...(!rekon ? { stan: "na żądanie", ton: "nic" as const }
    : rekon.rozjazdy.length ? { stan: ile(rekon.rozjazdy.length, "rozjazd", "rozjazdy", "rozjazdów"), ton: "uwaga" as const }
      : { stan: "bez rozjazdów", ton: "ok" as const }) });

  /* Trwające wezwanie to jedyny stan kolektorów, przy którym ktoś czeka na
     ekran: przycisk „Przestań" ma być pod ręką. Cisza kolektora to zwykły
     stan urządzenia na noc, nie problem. */
  const dzwoni = (kolektory ?? []).filter((k) => k.wezwanie).length;
  obszary.push({ id: "kolektory", nazwa: "Zgubiony kolektor", ...(!kolektory ? { stan: CZEKA, ton: "nic" as const }
    : dzwoni > 0 ? { stan: `${dzwoni} wezwany`, ton: "uwaga" as const }
      : { stan: ile(kolektory.length, "kolektor", "kolektory", "kolektorów"), ton: "nic" as const }) });

  obszary.push({ id: "wymiana", nazwa: "Wymiana z halą", ...(!alarm ? { stan: CZEKA, ton: "nic" as const }
    : alarm.spoznionychRazem > 0 ? { stan: `${alarm.spoznionychRazem} stoi dłużej niż zwykle`, ton: "uwaga" as const }
      : { stan: "nic nie stoi dłużej", ton: "ok" as const }) });

  obszary.push({ id: "allegro", nazwa: "Konto Allegro", ...(!allegro ? { stan: CZEKA, ton: "nic" as const }
    : allegro.stan === "polaczone" ? { stan: `połączone · ${allegro.srodowisko}`, ton: "ok" as const }
      : allegro.stan === "dev" ? { stan: "tryb demo", ton: "nic" as const }
        : allegro.stan === "wylaczone" ? { stan: "wyłączone", ton: "nic" as const }
          : { stan: allegro.stan === "zle_srodowisko" ? "token z innego środowiska" : "niepołączone", ton: "zle" as const }) });

  const i = zdrowie?.allegroInbox;
  const o = zdrowie?.obsluga;
  obszary.push({ id: "integracje", nazwa: "Stan integracji", ...(!i || !o ? { stan: CZEKA, ton: "nic" as const }
    : i.status !== "current" && i.status !== "delayed" ? { stan: i.status, ton: "zle" as const }
      : o.wysylkiDoSprawdzenia > 0 ? { stan: `${o.wysylkiDoSprawdzenia} wysyłek do sprawdzenia`, ton: "uwaga" as const }
        : i.status === "delayed" || i.watkiZBledem > 0
          ? { stan: i.watkiZBledem > 0 ? `${i.watkiZBledem} wątków z błędem` : "opóźniona", ton: "uwaga" as const }
          : !i.ostatniaUdanaSynchronizacja ? { stan: "jeszcze nie synchronizowała", ton: "nic" as const }
            : { stan: `działa · ${godzina(i.ostatniaUdanaSynchronizacja)}`, ton: "ok" as const }) });

  const zlych = (sonda?.kroki ?? []).filter((k) => k.wynik === "blad").length;
  obszary.push({ id: "sonda", nazwa: "Test na żywym Allegro", ...(!sonda ? { stan: CZEKA, ton: "nic" as const }
    : zlych > 0 ? { stan: `${ile(zlych, "krok", "kroki", "kroków")} z błędem`, ton: "zle" as const }
      : sonda.przebieg === null ? { stan: "jeszcze nie szedł", ton: "nic" as const }
        : { stan: "działa", ton: "ok" as const }) });

  const problemy = zdrowie?.problemy ?? [];
  obszary.push({ id: "serwer", nazwa: "Serwer", ...(!zdrowie ? { stan: CZEKA, ton: "nic" as const }
    : zdrowie.worker && !zdrowie.worker.zyje ? { stan: "worker nie żyje", ton: "zle" as const }
      : problemy.length > 0 ? { stan: ile(problemy.length, "uwaga", "uwagi", "uwag"), ton: "uwaga" as const }
        : { stan: `wersja ${zdrowie.wersja ?? "—"}`, ton: "ok" as const }) });

  return obszary;
}

/* Barwy tonu w JEDNYM słowniku: ta sama para dla kropki, ramki i zdania,
   więc kafelek nie może mieć zielonej kropki przy czerwonym zdaniu. */
const TON: Record<TonObszaru, { ramka: string; kropka: string; tekst: string }> = {
  zle: { ramka: "border-red-300 bg-red-50", kropka: "bg-red-500", tekst: "text-ranga-zle" },
  uwaga: { ramka: "border-amber-400 bg-amber-50", kropka: "bg-amber-500", tekst: "text-ranga-uwaga" },
  ok: { ramka: "border-slate-200 bg-white", kropka: "bg-emerald-500", tekst: "text-ranga-ok" },
  nic: { ramka: "border-slate-200 bg-white", kropka: "bg-slate-400", tekst: "text-ranga-nic" },
};

/**
 * Rząd kafelków. Klik otwiera albo zamyka kartę obszaru pod spodem;
 * `aria-expanded` mówi czytnikowi to samo, co pierścień mówi oku.
 */
export function Kafelki({ obszary, otwarte, przelacz }: {
  obszary: Obszar[]; otwarte: (id: string) => boolean; przelacz: (id: string) => void;
}) {
  return <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
    {obszary.map((o) => {
      const t = TON[o.ton];
      const rozwiniety = otwarte(o.id);
      return <button key={o.id} type="button" onClick={() => przelacz(o.id)}
        aria-expanded={rozwiniety} aria-controls={`karta-${o.id}`}
        /* Otwarta karta dostaje pierścień grafitu, nie bursztyn: bursztyn
           na tym ekranie znaczy „czeka na biuro" (ustalenie 02). */
        className={`flex min-h-16 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left hover:border-slate-400 ${t.ramka} ${
          rozwiniety ? "ring-2 ring-wertis-ink/60" : ""}`}>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${t.kropka}`} />{o.nazwa}</span>
        {/* Spacja rozdziela nazwę i stan dla czytnika; we flexie jej nie widać. */}
        {" "}<span className={`text-sm font-bold ${t.tekst}`}>{o.stan}</span>
      </button>;
    })}
  </div>;
}
