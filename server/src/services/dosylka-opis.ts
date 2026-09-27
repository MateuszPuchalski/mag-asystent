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

/**
 * Kody odmowy wypłaty, które znaczą „wysłaliśmy towar jeszcze raz”.
 * `NEW_ITEM_SENT` podał właściciel 27 września 2026 (zły towar).
 * `MISSING_PART_SENT` doszedł w 0.536.0, bo brakująca część jedzie tak samo,
 * drugą paczką — to do oceny właściciela, nie jego fakt.
 */
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
  /** Zwrot, z którego odmowy wyszła dosyłka; `null` przy numerze wpisanym bez odmowy. */
  zwrotId: number | null;
  /** `null`, dopóki Allegro go nie pokaże albo agent go nie wpisze. */
  waybill: string | null;
  /** `carrierId` z Allegro, np. „INPOST”, „DPD”, „OTHER”. */
  przewoznik: string | null;
  /** Przewoźnik PIERWSZEJ paczki zamówienia — domyślny wybór w formularzu numeru. */
  przewoznikZamowienia: string | null;
  /**
   * Skąd numer. `null` DOKŁADNIE wtedy, gdy numeru nie ma — każdy zapis
   * serwera stawia i czyści oba pola razem. Historia klienta przy źródle
   * dostaje `waybill: null` zawsze (`zeSprawa`), więc brak numeru poznaje
   * po tym polu.
   */
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
 * Po ilu dniach roboczych brak numeru woła o ruch.
 *
 * ZAŁOŻENIE, nie fakt: etykieta powstaje w Sellasist w dniu odmowy, a Allegro
 * pokazuje numer przy zamówieniu w ciągu doby. Właściciel tego nie podał, a na
 * żywym koncie nikt nie mierzył. Sprawdzi to miara z S6 — czas od odmowy do
 * numeru. Przy tym założeniu drugi dzień roboczy bez numeru znaczy, że numer
 * trafił na inne zamówienie albo nie trafił wcale.
 */
export const DNI_BEZ_NUMERU = 2;

/**
 * Domyślny termin kroku „dosłać”: trzy dni robocze.
 *
 * ZAŁOŻENIE, nie fakt: dzień na etykietę i nadanie, jeden do dwóch dni
 * kuriera. Sprawdzi je ta sama miara z S6 co `DNI_BEZ_NUMERU`, a obok niej
 * `domyslny: true` w `klient_sprawa_krok`. Wcześniejszy termin stawiałby krok
 * „po terminie” w dniu, w którym paczka jeszcze jedzie — i uczyłby ignorować
 * czerwień. Późniejszy chowałby dosyłkę, która utknęła.
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
  /* Pytaliśmy, a przewoźnik nie podał ani jednego statusu. To bywa paczka
     jeszcze nienadana, ale bywa też numer z literówką — „w drodze” ukryłoby
     ten drugi przypadek, więc zdanie mówi, co wiemy, i dostaje ton uwagi. */
  if (d.status === null) {
    return { bezNumeru: false, ton: "uwaga",
      opis: `Przewoźnik nie zna jeszcze tej paczki (stan z ${stanZ(d.sprawdzonoAt, teraz)})` };
  }
  return { bezNumeru: false, ton: null, opis: `Dosyłka w drodze (stan z ${stanZ(d.sprawdzonoAt, teraz)})` };
}

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Wiersz `klient_dosylka` z przewoźnikiem pierwszej paczki i stanem sprawy.
 * JEDNO zapytanie dla każdego czytelnika dosyłek, żeby „przewoźnik
 * zamówienia” i „sprawa w toku” znaczyły wszędzie to samo. Numer zamówienia
 * jest unikalny na koncie sprzedawcy, więc złączenie idzie po obu kolumnach.
 */
export const DOSYLKI_SQL = `SELECT d.*, o.przesylka_przewoznik AS przewoznik_zamowienia,
    p.login AS sprawa_login, p.zakonczono_at AS sprawa_zakonczono_at
  FROM klient_dosylka d
  JOIN klient_prowadzenie p ON p.id = d.sprawa_id
  LEFT JOIN zamowienie_klienta o ON o.channel_account_id = d.konto AND o.external_id = d.zamowienie`;

/**
 * Dosyłka, która należy do zwrotu (`?1` — id zwrotu, `?2` — konto, `?3` —
 * numer zamówienia). JEDNA reguła dla ekranu zwrotu, „Śledź dosyłkę”,
 * propozycji na profilu i przejęcia wiersza przy odmowie: przycisk, trasa
 * i ekran nie mogą się różnić zdaniem, czy dosyłka tego zwrotu już jest.
 *
 * Należy do zwrotu wiersz założony z jego odmowy. Poza nim wiersz tego samego
 * zamówienia, gdy:
 *   - agent wpisał numer bez odmowy w bieżącym epizodzie sprawy — odmowa
 *     tylko nazywa dosyłkę, którą biuro już wysłało i śledzi;
 *   - wiersz powstał albo dostał numer PO zgłoszeniu tego zwrotu według
 *     Allegro — dosyłka wysłana po zwrocie jest odpowiedzią na niego, nie na
 *     wcześniejszy. Numer liczy się osobno (0.536.1): trzecia paczka wpisana
 *     do wiersza z pierwszej odmowy ginęła przy odmowie drugiego zwrotu.
 * Wiersz starszy od zwrotu to poprzednia dosyłka: nowa odmowa ją zastępuje.
 * Bez daty zgłoszenia w lądowisku drugi warunek milczy — `julianday(NULL)`.
 */
export const DOSYLKA_ZWROTU_SQL = `${DOSYLKI_SQL}
  WHERE d.zwrot_id = ?1
     OR (d.konto = ?2 AND d.zamowienie = ?3 AND (
          (d.zwrot_id IS NULL AND d.archiwalna = 0 AND p.zakonczono_at IS NULL)
          OR julianday(COALESCE(d.numer_at, d.zalozono_at)) >= julianday((SELECT json_extract(a.surowe_json, '$.createdAt')
               FROM zwrot_klienta z JOIN allegro_zwrot a ON a.id = z.external_id WHERE z.id = ?1))))
  ORDER BY d.zwrot_id IS ?1 DESC, julianday(d.zalozono_at) DESC
  LIMIT 1`;

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
    zwrotId: w.zwrot_id == null ? null : Number(w.zwrot_id),
    ...stan,
    przewoznikZamowienia: tekst(w.przewoznik_zamowienia),
    zrodlo: zrodlo === "allegro" || zrodlo === "recznie" ? zrodlo : null,
    ...opisDosylki(stan, teraz),
  };
}

/** Kłopot u przewoźnika albo brak numeru za długo — wiersz „Moje” staje na dziś. */
export const pilnaDosylka = (d: DosylkaSprawy): boolean => d.bezNumeru || d.ton === "zle";

/**
 * Doręczenie po chwili `widzianeDo` — ostatnim ruchu człowieka przy sprawie.
 *
 * Liczy się chwila ZAPISU doręczenia na serwerze (`sprawdzonoAt`), nie data
 * kuriera (0.536.1). Ticker nie pyta o doręczoną, więc jej `sprawdzonoAt` to
 * moment zapisu. Numer wpisany po czasie do paczki już doręczonej dawał inaczej
 * doręczenie „sprzed” wpisania i gasił podpowiedź „Zakończ sprawę?”.
 */
const doreczonaPo = (d: DosylkaSprawy, widzianeDo: string | null): boolean => {
  if (d.dostarczonoAt === null) return false;
  const t = chwilaUtc(d.sprawdzonoAt ?? d.dostarczonoAt);
  return Number.isFinite(t) && (widzianeDo === null || !(t <= chwilaUtc(widzianeDo)));
};

/**
 * Dosyłka, o której mówi wiersz „Moje”: kłopot, potem brak numeru, potem
 * w drodze, na końcu doręczona. Wiersz ma jedno zdanie, więc wygrywa to,
 * co woła o ruch; doręczona tylko wtedy, gdy nic innego nie czeka.
 *
 * Doręczona SPRZED ostatniego ruchu człowieka (`widzianeDo`) odpada: agent
 * postawił krok, widząc ją, więc „czeka do …” jego nowego kroku mówi więcej
 * niż stare doręczenie. Kłopot i brak numeru liczą się zawsze.
 */
export function najwazniejszaDosylka(
  dosylki: DosylkaSprawy[], widzianeDo: string | null = null,
): DosylkaSprawy | null {
  const waga = (d: DosylkaSprawy): number =>
    d.ton === "zle" ? 0 : d.waybill === null ? 1 : d.dostarczonoAt === null ? 2 : 3;
  return [...dosylki].filter((d) => d.dostarczonoAt === null || doreczonaPo(d, widzianeDo))
    .sort((a, b) => waga(a) - waga(b))[0] ?? null;
}

/**
 * Doręczona dosyłka, po której profil pyta „Zakończ sprawę?” — albo `null`.
 *
 * Każda śledzona dosyłka sprawy doszła, co najmniej jedna jest, a ostatnie
 * doręczenie przyszło PO ostatnim ruchu człowieka. Ruch po doręczeniu, np.
 * nowy krok, znaczy, że agent je widział i sprawa ma jeszcze coś do zrobienia
 * — podpowiedź pchałaby wtedy do zamknięcia wbrew jego decyzji. `OTHER`
 * nie wchodzi do „każdej”: Allegro go nie śledzi, więc nie dojdzie nigdy.
 */
export function doreczonaDoZakonczenia(dosylki: DosylkaSprawy[], zmienionoAt: string): DosylkaSprawy | null {
  const sledzone = dosylki.filter((d) => d.przewoznik !== "OTHER");
  if (sledzone.length === 0 || sledzone.some((d) => d.dostarczonoAt === null)) return null;
  /* Ostatnia według chwili ZAPISU, tej samej, którą sprawdza `doreczonaPo`. */
  const zapis = (d: DosylkaSprawy) => chwilaUtc(d.sprawdzonoAt ?? d.dostarczonoAt);
  const ostatnia = sledzone.reduce((a, b) => (zapis(b) > zapis(a) ? b : a));
  return doreczonaPo(ostatnia, zmienionoAt) ? ostatnia : null;
}

/**
 * Ile dni śledzimy dosyłkę od założenia albo od numeru — i ile dni wstecz
 * patrzy propozycja na profilu. Numer wpisany po czasie dostaje własne okno
 * (`numer_at`), bo dopiero od niego jest o co pytać przewoźnika.
 */
export const DNI_SLEDZENIA = 30;
export const OKNO_SLEDZENIA_MS = DNI_SLEDZENIA * DZIEN;

/** Pola wiersza, z których wynika, czy jego stan jest „teraz”. */
export interface ZycieDosylki {
  wToku: boolean;
  archiwalna: boolean;
  dostarczonoAt: string | null;
  numerAt: string | null;
  zalozonoAt: string;
}

/**
 * Czy ticker dalej pyta o tę dosyłkę — czyli czy jej zdanie mówi o „teraz”.
 * Sprawa w toku, bieżący epizod i okno śledzenia. Doręczona zostaje „teraz”
 * na zawsze: doręczenie jest ostateczne, więc jej zdanie się nie starzeje.
 */
export function dosylkaSledzona(d: ZycieDosylki, teraz: Date): boolean {
  if (!d.wToku || d.archiwalna) return false;
  if (d.dostarczonoAt) return true;
  return teraz.getTime() - chwilaUtc(d.numerAt ?? d.zalozonoAt) <= OKNO_SLEDZENIA_MS;
}

/** Pola życia dosyłki z wiersza `DOSYLKI_SQL`. */
export const zycieWiersza = (w: Record<string, unknown>): ZycieDosylki => ({
  wToku: w.sprawa_zakonczono_at == null,
  archiwalna: Number(w.archiwalna) === 1,
  dostarczonoAt: tekst(w.dostarczono_at),
  numerAt: tekst(w.numer_at),
  zalozonoAt: String(w.zalozono_at),
});

/**
 * Zdanie dosyłki, której już nie śledzimy: sprawa zakończona, epizod minął
 * albo skończyło się okno. Stan takiej dosyłki to zatrzymany zegar, więc
 * mówimy tylko fakt z datą — doręczenie — albo wprost, że nie śledzimy.
 * Nigdy „wpisz go z Sellasist”: do takiego wiersza numeru się nie wpisze.
 */
export function opisZamrozonej(dostarczonoAt: string | null): { opis: string; ton: TonDosylki } {
  return dostarczonoAt ? { opis: `Dosyłka doręczona ${dzienMiesiac(dostarczonoAt)}`, ton: "ok" }
    : { opis: "Dosyłki już nie śledzimy.", ton: null };
}
