import { chwilaUtc, czasLokalny, dataLokalna, dodajDni, polnocLokalna } from "../czas.js";

/* ── Dosyłka: zdanie, ton i dni robocze (0.536.0, S6) ───────────────────────
   Drugi przyrost sprawy klienta: krok „dosłać” dostaje numer przesyłki,
   przewoźnika i śledzenie. Ten plik to CZYSTA część — zdanie o dosyłce,
   jej ton i rachunek dni roboczych. Bez bazy i bez sieci.

   CZYSTY, BO CZYTA GO PIĘĆ MIEJSC. Sprawa klienta, oś zwrotu pieniędzy,
   przesyłka zamówienia, profil i sam serwis dosyłki mówią o niej tym samym
   zdaniem. Każde z nich czyta `klient_dosylka` własnym zapytaniem, a zdanie
   składa stąd. Import serwisu `dosylka.ts` z tamtych plików zamknąłby cykl
   (`prowadzenie-klienta.ts` ← `dosylka.ts`), a pętla importów przy stałej
   liczonej w chwili ładowania bywa pustym zbiorem — blizna w `statusy-spraw.ts`.

   ZDANIE SKŁADA SERWER, panel tylko je drukuje. Jedno brzmienie na profilu,
   w „Moje”, przy zwrocie i w historii klienta — cztery kopie w panelu
   rozjechałyby się przy pierwszej poprawce jednej z nich.

   DOBA I DZIEŃ ROBOCZY LICZĄ SIĘ NA ZEGARZE MAGAZYNU, nie w UTC. Dosyłka
   założona w piątek o 23:30 to w UTC jeszcze piątek, a w magazynie sobota —
   i „dwa dni robocze” wypadałyby o dzień za wcześnie. */

/** Kody odmowy wypłaty, które znaczą „wysłaliśmy towar jeszcze raz”. */
export const KODY_DOSYLKI = ["NEW_ITEM_SENT", "MISSING_PART_SENT"] as const;
export type KodDosylki = (typeof KODY_DOSYLKI)[number];

export const jestKodemDosylki = (kod: unknown): kod is KodDosylki =>
  typeof kod === "string" && (KODY_DOSYLKI as readonly string[]).includes(kod);

/** Ton dla koloru na ekranie: doręczona, bez numeru, kłopot u przewoźnika. */
export type TonDosylki = "ok" | "uwaga" | "zle" | null;

/** Jedna dosyłka sprawy klienta — wiersz `klient_dosylka` tak, jak widzi go ekran. */
export interface DosylkaSprawy {
  /** Numer zamówienia w Allegro (`checkoutForm.id`). */
  zamowienie: string;
  /** `null`, dopóki Allegro go nie pokaże albo agent go nie wpisze. */
  waybill: string | null;
  /** `carrierId` z Allegro, np. „INPOST”, „DPD”, „OTHER”. */
  przewoznik: string | null;
  /** Przewoźnik PIERWSZEJ paczki zamówienia — domyślny wybór w formularzu numeru. */
  przewoznikZamowienia: string | null;
  zrodlo: "allegro" | "recznie" | null;
  /** Ostatni kod przewoźnika. */
  status: string | null;
  /** Pierwsze DELIVERED; zapisane raz, nigdy nadpisane. */
  dostarczonoAt: string | null;
  /** Kiedy ostatnio pytaliśmy Allegro; `null` — jeszcze nigdy. */
  sprawdzonoAt: string | null;
  zalozonoAt: string;
  /** Bez numeru od co najmniej dwóch dni roboczych — agent wpisuje go z Sellasist. */
  bezNumeru: boolean;
  /** Zdanie złożone na serwerze: daty DD.MM i godziny HH:MM lokalnie. */
  opis: string;
  ton: TonDosylki;
}

/** Pola wiersza, z których wynika zdanie. */
export interface StanDosylki {
  waybill: string | null;
  przewoznik: string | null;
  status: string | null;
  dostarczonoAt: string | null;
  sprawdzonoAt: string | null;
  zalozonoAt: string;
}

/**
 * Po ilu dniach roboczych brak numeru woła o ruch. Etykieta powstaje
 * w Sellasist zwykle w dniu odmowy, a Allegro pokazuje numer przy zamówieniu
 * w ciągu doby. Drugi dzień roboczy bez numeru znaczy więc, że numer trafił
 * na inne zamówienie albo nie trafił wcale — i sam już nie przyjdzie.
 */
export const DNI_BEZ_NUMERU = 2;

/**
 * Domyślny termin kroku „dosłać”: trzy dni robocze. Dzień na etykietę
 * i nadanie, jeden do dwóch dni kuriera. Wcześniejszy termin stawiałby krok
 * „po terminie” w dniu, w którym paczka jeszcze jedzie — i uczyłby
 * ignorować czerwień. Późniejszy chowałby dosyłkę, która utknęła.
 */
export const DNI_KROKU_DOSYLKI = 3;

/* Godzina 8:00, nie „za 72 godziny” — ta sama decyzja co przy odłożeniu
   rozmowy w panelu (`terminOdlozenia.ts`): termin wraca na początek pracy
   biura, a nie w środek dnia, w którym ktoś kliknął odmowę. */
const GODZINA_TERMINU = 8;

const DZIEN = 86_400_000;

/** Dzień tygodnia daty kalendarzowej (0 = niedziela) — bez strefy, bez godzin. */
const dzienTygodnia = (data: string): number => {
  const [r, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(r, m - 1, d)).getUTCDay();
};
const roboczy = (data: string): boolean => {
  const dzien = dzienTygodnia(data);
  return dzien !== 0 && dzien !== 6;
};

/** Data lokalna chwili; napis bez strefy czyta się jako UTC, jak w SQLite. */
const dataChwili = (at: string | Date): string | null => {
  const t = at instanceof Date ? at.getTime() : chwilaUtc(at);
  return Number.isFinite(t) ? dataLokalna(new Date(t).toISOString()) : null;
};

/**
 * Początek pracy (8:00 lokalnie) `ile` dni roboczych po dniu `od`.
 *
 * Weekend się przeskakuje, świąt nie — kalendarza świąt serwer nie ma,
 * a błąd jest bezpieczny: termin wypada dzień za wcześnie, nie za późno.
 *
 * 8:00 liczy się od lokalnej północy tego dnia. Zmiana czasu wypada
 * w niedzielę o 2:00 albo 3:00, a termin nigdy nie trafia na niedzielę —
 * więc „północ plus osiem godzin” jest w dzień roboczy zawsze 8:00.
 */
export function poDniachRoboczych(od: Date, ile: number): Date {
  let data = dataLokalna(od.toISOString());
  let zostalo = ile;
  while (zostalo > 0) {
    data = dodajDni(data, 1);
    if (roboczy(data)) zostalo--;
  }
  return new Date(Date.parse(polnocLokalna(data)) + GODZINA_TERMINU * 3_600_000);
}

/**
 * Ile dni roboczych minęło od dnia `od` do dziś, na dobie magazynu. Dzień
 * założenia się nie liczy: dosyłka z poniedziałku ma w środę dwa dni.
 * Niepoprawna data to zero — lepiej milczeć niż wołać „brak numeru” bez powodu.
 */
export function dniRoboczeOd(od: string, teraz: Date): number {
  const start = dataChwili(od);
  const koniec = dataChwili(teraz);
  if (!start || !koniec || koniec <= start) return 0;
  let dni = 0;
  /* Bezpiecznik: dosyłka żyje w śledzeniu trzydzieści dni, a pętla po
     kalendarzu bez granicy wisiałaby na zepsutej dacie z roku 1970. */
  for (let data = dodajDni(start, 1), i = 0; data <= koniec && i < 400; data = dodajDni(data, 1), i++) {
    if (roboczy(data)) dni++;
  }
  return dni;
}

/** `DD.MM` na zegarze magazynu. */
export const dzienMiesiac = (at: string): string => {
  const t = chwilaUtc(at);
  if (!Number.isFinite(t)) return at;
  return dataLokalna(new Date(t).toISOString()).split("-").reverse().slice(0, 2).join(".");
};

/**
 * „14:10” dla stanu z dziś, „29.09 14:10” dla starszego. Sama godzina przy
 * wczorajszym stanie udawałaby świeżość, której nie ma.
 */
function stanZ(at: string, teraz: Date): string {
  const t = chwilaUtc(at);
  if (!Number.isFinite(t)) return at;
  const iso = new Date(t).toISOString();
  const godzina = czasLokalny(iso);
  return dataChwili(iso) === dataChwili(teraz) ? godzina : `${dzienMiesiac(iso)} ${godzina}`;
}

/**
 * Zdanie, ton i „bez numeru” jednej dosyłki. Kolejność warunków to
 * kolejność ważności: doręczenie rozstrzyga, kłopot u przewoźnika woła,
 * a przewoźnik spoza Allegro mówi, czemu dalej nic się nie zmieni.
 */
export function opisDosylki(
  d: StanDosylki, teraz: Date,
): { opis: string; ton: TonDosylki; bezNumeru: boolean } {
  if (d.waybill === null) {
    const dni = dniRoboczeOd(d.zalozonoAt, teraz);
    if (dni >= DNI_BEZ_NUMERU) {
      return { bezNumeru: true, ton: "uwaga",
        opis: `Allegro nie ma numeru dosyłki od ${dni} dni roboczych — wpisz go z Sellasist` };
    }
    if (d.sprawdzonoAt === null) return { bezNumeru: false, ton: null, opis: "Czekamy na numer dosyłki z Allegro" };
    return { bezNumeru: false, ton: null,
      opis: `Allegro nie ma jeszcze numeru dosyłki (stan z ${stanZ(d.sprawdzonoAt, teraz)})` };
  }
  if (d.dostarczonoAt) return { bezNumeru: false, ton: "ok", opis: `Dosyłka doręczona ${dzienMiesiac(d.dostarczonoAt)}` };
  if (d.status === "RETURNED") return { bezNumeru: false, ton: "zle", opis: "Dosyłka wraca do nadawcy" };
  if (d.status === "ISSUE") return { bezNumeru: false, ton: "zle", opis: "Przewoźnik zgłosił problem z dosyłką" };
  /* `OTHER` to przewoźnik, którego Allegro nie śledzi (`OrdersShippingCarrier`
     w specyfikacji). Ticker go nie pyta, więc zdanie mówi, czemu stan stoi. */
  if (d.przewoznik === "OTHER") return { bezNumeru: false, ton: null, opis: "Przewoźnik spoza Allegro — nie śledzimy" };
  if (d.sprawdzonoAt === null) return { bezNumeru: false, ton: null, opis: "Dosyłka nadana — czekamy na pierwszy stan" };
  return { bezNumeru: false, ton: null, opis: `Dosyłka w drodze (stan z ${stanZ(d.sprawdzonoAt, teraz)})` };
}

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Wiersz `klient_dosylka` z przewoźnikiem pierwszej paczki. JEDNO zapytanie
 * dla każdego czytelnika dosyłek, żeby „przewoźnik zamówienia” znaczył
 * wszędzie to samo. Numer zamówienia jest unikalny na koncie sprzedawcy,
 * więc złączenie idzie po obu kolumnach.
 */
export const DOSYLKI_SQL = `SELECT d.*, o.przesylka_przewoznik AS przewoznik_zamowienia
  FROM klient_dosylka d
  LEFT JOIN zamowienie_klienta o ON o.channel_account_id = d.konto AND o.external_id = d.zamowienie`;

/** Wiersz z `DOSYLKI_SQL` jako dosyłka ekranu. */
export function naDosylkeSprawy(w: Record<string, unknown>, teraz: Date): DosylkaSprawy {
  const zrodlo = tekst(w.zrodlo);
  const stan: StanDosylki = {
    waybill: tekst(w.waybill), przewoznik: tekst(w.przewoznik), status: tekst(w.status),
    dostarczonoAt: tekst(w.dostarczono_at), sprawdzonoAt: tekst(w.sprawdzono_at),
    zalozonoAt: String(w.zalozono_at),
  };
  return {
    zamowienie: String(w.zamowienie),
    ...stan,
    przewoznikZamowienia: tekst(w.przewoznik_zamowienia),
    zrodlo: zrodlo === "allegro" || zrodlo === "recznie" ? zrodlo : null,
    ...opisDosylki(stan, teraz),
  };
}

/** Kłopot u przewoźnika albo brak numeru za długo — wiersz „Moje” staje na dziś. */
export const pilnaDosylka = (d: DosylkaSprawy): boolean => d.bezNumeru || d.ton === "zle";

/**
 * Dosyłka, o której mówi wiersz „Moje”: kłopot, potem brak numeru, potem
 * w drodze, na końcu doręczona. Wiersz ma jedno zdanie, więc wygrywa to,
 * co woła o ruch; doręczona tylko wtedy, gdy nic innego nie czeka.
 */
export function najwazniejszaDosylka(dosylki: DosylkaSprawy[]): DosylkaSprawy | null {
  const waga = (d: DosylkaSprawy): number =>
    d.ton === "zle" ? 0 : d.waybill === null ? 1 : d.dostarczonoAt === null ? 2 : 3;
  return [...dosylki].sort((a, b) => waga(a) - waga(b))[0] ?? null;
}

/** Ile dni śledzimy dosyłkę od założenia — i ile dni wstecz patrzy propozycja na profilu. */
export const DNI_SLEDZENIA = 30;
export const OKNO_SLEDZENIA_MS = DNI_SLEDZENIA * DZIEN;
