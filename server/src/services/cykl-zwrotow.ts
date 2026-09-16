import { db, type Db } from "../db/db.js";
import { numerKosza } from "./przyjecia.js";
import { OKNO, PRZERWA_MIN, czasAktywny, mediana } from "./raporty.js";

/* ── Cykl zwrotu: gdzie naprawdę schodzi czas ────────────────────────────────
   Raport powstał po rozmowie o przyspieszeniu rozkładania zwrotów. Pytanie
   brzmiało „jak skrócić pracę hali", a kod odpowiadał, że praca hali jest już
   ścięta do dwóch skanów na pozycję (`SkanKosza.kt`). Podejrzenie padło więc na
   CZEKANIE — odcinki, w których nikt niczego nie robi, bo karton czeka na
   papier. Podejrzenie to nie pomiar; ten plik zamienia je w liczby.

   DZIAŁA WSTECZ, bo nie potrzebuje ani jednego nowego zapisu. Znaczniki czasu
   są w tabelach od dawna: `kosz` wie, kiedy powstał, kiedy go zamknięto
   i rozłożono, a `sfera_queue` — kiedy zadanie MM powstało i kiedy dokument
   wszedł do Subiekta. Z dziennika bierzemy wyłącznie to, czego w tabelach nie
   ma: chwile poszczególnych odłożeń.

   ── Dlaczego to zszywa DWA kosze ─────────────────────────────────────────
   Jeden karton nosi dziś dwa imiona. Obsługa napełnia koszyk „Z-7" w panelu,
   a hala rozkłada kosz z jego dokumentu — „1209" (0.350.0). Liczone osobno,
   pierwszy nie ma ani jednego odłożenia, a drugi nie ma zamknięcia; odcinek
   między nimi, czyli właśnie czekanie, nie istniałby w żadnym z nich.

   Zszywamy po NUMERZE DOKUMENTU: kosz z przyjęcia dostaje jako kod samą liczbę
   z numeru MM (`otworzPrzyjecie`), a koszyk z panelu zna ten numer z kolejki.
   Kod kosza wraca po rozłożeniu do obiegu, a numery MM powtarzają się co rok,
   więc bierzemy wyłącznie kosz OTWARTY PO zamknięciu koszyka — i najbliższy
   w czasie. Bez tego warunku raport skleiłby zeszłoroczny karton z dzisiejszym.

   ── Dwie zasady, na których ten raport stoi ──────────────────────────────
   MEDIANA, NIE ŚREDNIA. Jeden kosz zamknięty w piątek i rozłożony w poniedziałek
   podnosi średnią o kilkadziesiąt godzin i zamazuje resztę. Mediana mówi, jak
   wygląda dzień zwykły; ogon widać w kolumnie „najdłuższy".

   BRAK DANYCH TO NIE ZERO. Odcinek bez próbki oddaje `null` i tak też się go
   wypisuje. Karton zamknięty przed oknem raportu nie ma początku odcinka i nie
   ma prawa udawać, że przeszedł go w mgnieniu oka.                            */

/** Zdarzenia odłożeń — jedyne, czego nie da się odczytać z tabel. */
const ZDARZENIA_HALI = [
  "kosz_putaway",
  "kosz_putaway_poprawka",
  "kosz_pozycja_pominieta",
] as const;

/** Rodzaje koszy, które w ogóle są pracą hali (odpad i karton nie są). */
const RODZAJ_ZWROTY = "zwroty";

export interface SprawaKartonu {
  /** Koszyk z panelu — tam, gdzie karton się zaczyna. */
  koszId: number;
  kod: string;
  /** Kosz z dokumentu MM, jeśli to on jest jednostką pracy hali. */
  koszHaliId: number | null;
  kodHali: string | null;
  /** Kiedy do koszyka wpadła pierwsza pozycja. */
  poczatek: string;
  zamkniecie: string | null;
  /** Kiedy zadanie MM trafiło do kolejki — czyli kiedy doszła ostatnia korekta. */
  mmZamowione: string | null;
  /** Kiedy dokument MM naprawdę wszedł do Subiekta. */
  mmWSubiekcie: string | null;
  pierwszeOdlozenie: string | null;
  ostatnieOdlozenie: string | null;
  /** Kiedy zamówiono MM powrotne — od tej chwili towar wraca do sprzedaży. */
  powrot: string | null;
  odlozen: number;
  poprawek: number;
  pominiec: number;
  /** Adresy potwierdzone WPISEM z klawiatury — miara czytelności etykiet. */
  wpisow: number;
  /** Odłożenia pod innym adresem, niż mówiła kartoteka. */
  rozjazdow: number;
  /** Minuty pracy aktywnej przy tym kartonie (odstępy ≤ PRZERWA_MIN). */
  minutyAktywne: number;
}

export interface OdcinekCyklu {
  nazwa: string;
  opis: string;
  /** Czyja to praca — raport ma wskazywać biurko, a nie tylko liczbę. */
  czyja: string;
  medianaMin: number | null;
  najdluzszyMin: number | null;
  probka: number;
}

export interface CyklZwrotow {
  dni: number;
  kartonow: number;
  odcinki: OdcinekCyklu[];
  odlozen: number;
  poprawek: number;
  pominiec: number;
  wpisow: number;
  rozjazdow: number;
  /** Sekundy na jedno odłożenie, liczone z czasu AKTYWNEGO. `null` bez próbki. */
  sekundNaPozycje: number | null;
  sprawy: SprawaKartonu[];
}

interface WierszKosza {
  id: number;
  kod: string;
  utworzono_at: string;
  zamknieto_at: string | null;
  mm_dok_id: number | null;
  mm_numer: string | null;
  mm_zamowione: string | null;
  mm_w_subiekcie: string | null;
  powrot_zamowiony: string | null;
}

/** Payload zdarzenia albo `null` — uszkodzony JSON nie ma prawa zabrać raportu. */
function ladunek(payload: string | null): Record<string, unknown> | null {
  /* `json_extract` w SQL nie zwraca NULL na uciętym payloadzie: wywala CAŁE
     zapytanie. Na tym wyłożyły się kiedyś metryki i analiza (`raporty.ts`).
     Czytamy więc w JS i pomijamy wiersz, którego nie da się odczytać. */
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as unknown;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const minuty = (od: string | null, do_: string | null): number | null => {
  if (!od || !do_) return null;
  const ms = Date.parse(do_) - Date.parse(od);
  /* Odcinek ujemny znaczy zdarzenia nie po kolei — cofnięte zakończenie,
     poprawiony kosz. Nie liczymy go, bo „minus dwie godziny" nie jest czasem. */
  return Number.isFinite(ms) && ms >= 0 ? ms / 60_000 : null;
};

/** Kosze zwrotowe z okna raportu, wraz ze znacznikami z kolejki. */
function koszeZOkna(database: Db, dni: number): WierszKosza[] {
  return database
    .prepare(
      `SELECT k.id, k.kod, k.utworzono_at, k.zamknieto_at, k.mm_dok_id,
              COALESCE(k.mm_numer, q.sgt_doc_number) AS mm_numer,
              q.created_at   AS mm_zamowione,
              q.processed_at AS mm_w_subiekcie,
              p.created_at   AS powrot_zamowiony
         FROM kosz k
         LEFT JOIN sfera_queue q ON q.id = k.mm_queue_id
         LEFT JOIN sfera_queue p ON p.id = k.powrot_queue_id
        WHERE COALESCE(k.rodzaj, ?) = ?
          AND k.utworzono_at >= datetime('now', ?)
        ORDER BY k.id`
    )
    .all(RODZAJ_ZWROTY, RODZAJ_ZWROTY, OKNO(dni)) as unknown as WierszKosza[];
}

/**
 * Oś każdego kartonu i mediany odcinków między nimi.
 *
 * Okno liczy się po dacie POWSTANIA koszyka, nie po dacie zdarzeń: karton jest
 * jednostką tego raportu i albo wchodzi cały, albo wcale.
 */
export function cyklZwrotow(dni = 90, database: Db = db()): CyklZwrotow {
  const kosze = koszeZOkna(database, dni);
  /* Kosze z dokumentu (`mm_dok_id`) są drugą połową cudzej sprawy, nie własną.
     Trzymamy je pod kodem, bo tym kodem jest liczba z numeru MM koszyka. */
  const zDokumentu = new Map<string, WierszKosza[]>();
  for (const k of kosze) {
    if (k.mm_dok_id === null) continue;
    const lista = zDokumentu.get(k.kod) ?? [];
    lista.push(k);
    zDokumentu.set(k.kod, lista);
  }

  const sprawy: SprawaKartonu[] = [];
  const halaDlaSprawy = new Map<number, SprawaKartonu>();
  for (const k of kosze) {
    if (k.mm_dok_id !== null) continue;
    /* Kosz hali szukamy PO ZAMKNIĘCIU koszyka i najbliższy w czasie: kod wraca
       do obiegu, a numery MM powtarzają się co rok. */
    const kandydaci = (zDokumentu.get(numerKosza(k.mm_numer ?? "")) ?? [])
      .filter((d) => !k.zamknieto_at || d.utworzono_at >= k.zamknieto_at)
      .sort((a, b) => a.utworzono_at.localeCompare(b.utworzono_at));
    const hala = kandydaci[0];
    const sprawa: SprawaKartonu = {
      koszId: k.id, kod: k.kod,
      koszHaliId: hala?.id ?? null, kodHali: hala?.kod ?? null,
      poczatek: k.utworzono_at,
      zamkniecie: k.zamknieto_at,
      mmZamowione: k.mm_zamowione,
      mmWSubiekcie: k.mm_w_subiekcie,
      pierwszeOdlozenie: null, ostatnieOdlozenie: null,
      /* Powrót zamawia ten kosz, na którym pracowała hala. */
      powrot: (hala ?? k).powrot_zamowiony,
      odlozen: 0, poprawek: 0, pominiec: 0, wpisow: 0, rozjazdow: 0, minutyAktywne: 0,
    };
    sprawy.push(sprawa);
    halaDlaSprawy.set(hala?.id ?? k.id, sprawa);
  }

  const czasyOdlozen = new Map<number, number[]>();
  const zdarzenia = database
    .prepare(
      `SELECT type, payload, created_at FROM events
        WHERE type IN (${ZDARZENIA_HALI.map(() => "?").join(",")})
          AND created_at >= datetime('now', ?)
        ORDER BY created_at, id`
    )
    .all(...ZDARZENIA_HALI, OKNO(dni)) as Array<{
    type: string; payload: string | null; created_at: string;
  }>;

  for (const w of zdarzenia) {
    const p = ladunek(w.payload);
    const s = halaDlaSprawy.get(Number(p?.koszId ?? 0));
    if (!s) continue;
    if (w.type === "kosz_pozycja_pominieta") {
      s.pominiec++;
      continue;
    }
    if (w.type === "kosz_putaway_poprawka") s.poprawek++;
    else s.odlozen++;
    s.pierwszeOdlozenie ??= w.created_at;
    s.ostatnieOdlozenie = w.created_at;
    const czasy = czasyOdlozen.get(s.koszId) ?? [];
    czasy.push(Date.parse(w.created_at));
    czasyOdlozen.set(s.koszId, czasy);
    if (p?.potwierdzenie === "wpis") s.wpisow++;
    /* Rozjazd liczymy z TEGO zdarzenia, a nie z `location_mismatch`: tamto nie
       niesie kosza, więc nie dałoby się go przypisać do kartonu. */
    if (typeof p?.expected === "string" && p.expected && p.expected !== p.location) {
      s.rozjazdow++;
    }
  }
  for (const s of sprawy) s.minutyAktywne = czasAktywny(czasyOdlozen.get(s.koszId) ?? []);

  const odcinek = (
    nazwa: string, czyja: string, opis: string,
    od: (s: SprawaKartonu) => string | null, do_: (s: SprawaKartonu) => string | null,
  ): OdcinekCyklu => {
    const proby = sprawy.map((s) => minuty(od(s), do_(s)))
      .filter((m): m is number => m !== null);
    return {
      nazwa, czyja, opis,
      medianaMin: mediana(proby),
      najdluzszyMin: proby.length ? Math.max(...proby) : null,
      probka: proby.length,
    };
  };

  /* Odstępów jest o jeden mniej niż odłożeń w każdej serii — dlatego tempo
     liczymy z liczby PRZEJŚĆ, nie z liczby pozycji. Inaczej karton
     jednopozycyjny dokładałby zero minut i zaniżał sekundy każdemu. */
  const przejsc = sprawy.reduce((n, s) => n + Math.max(0, s.odlozen + s.poprawek - 1), 0);
  const minutyRazem = sprawy.reduce((n, s) => n + s.minutyAktywne, 0);

  return {
    dni,
    kartonow: sprawy.length,
    odcinki: [
      odcinek("napełnianie", "obsługa", "pierwsza pozycja w koszyku → zamknięcie",
        (s) => s.poczatek, (s) => s.zamkniecie),
      odcinek("korekty", "biuro", "zamknięcie → zamówienie MM (ostatni numer korekty)",
        (s) => s.zamkniecie, (s) => s.mmZamowione),
      odcinek("dokument", "worker Sfery", "zamówienie MM → dokument w Subiekcie",
        (s) => s.mmZamowione, (s) => s.mmWSubiekcie),
      odcinek("czekanie hali", "nikt", "zamknięcie koszyka → pierwsze odłożenie",
        (s) => s.zamkniecie, (s) => s.pierwszeOdlozenie),
      odcinek("rozkładanie", "hala", "pierwsze → ostatnie odłożenie",
        (s) => s.pierwszeOdlozenie, (s) => s.ostatnieOdlozenie),
      odcinek("domknięcie", "automat", "ostatnie odłożenie → MM powrotne w kolejce",
        (s) => s.ostatnieOdlozenie, (s) => s.powrot),
      odcinek("cały cykl", "—", "zamknięcie koszyka → MM powrotne (towar sprzedawalny)",
        (s) => s.zamkniecie, (s) => s.powrot),
    ],
    odlozen: sprawy.reduce((n, s) => n + s.odlozen + s.poprawek, 0),
    poprawek: sprawy.reduce((n, s) => n + s.poprawek, 0),
    pominiec: sprawy.reduce((n, s) => n + s.pominiec, 0),
    wpisow: sprawy.reduce((n, s) => n + s.wpisow, 0),
    rozjazdow: sprawy.reduce((n, s) => n + s.rozjazdow, 0),
    sekundNaPozycje: przejsc > 0 ? (minutyRazem * 60) / przejsc : null,
    sprawy: sprawy.sort((a, b) => b.koszId - a.koszId),
  };
}

/** Ile minut z tej liczby czyta się jako zdanie. `null` = brak próbki. */
export function poLudzku(min: number | null): string {
  if (min === null) return "brak danych";
  if (min < 1) return `${Math.round(min * 60)} s`;
  if (min < 90) return `${min.toFixed(1)} min`;
  const godzin = min / 60;
  if (godzin < 48) return `${godzin.toFixed(1)} h`;
  return `${(godzin / 24).toFixed(1)} dni`;
}

/** Próg, poniżej którego mediana odcinka jest szumem, a nie wynikiem. */
export const PROG_PROBKI = 5;

export { PRZERWA_MIN };
