import { useEffect, useRef } from "react";

/* ── Czytnik kodów jako klawiatura (0.163.0) ─────────────────────────────────
   Czytnik USB wpisuje znaki jak klawiatura i kończy Enterem. Panel musi
   odróżnić taką serię od człowieka stukającego w skróty — a na ekranie zwrotów
   cyfry 1–6 przełączają kubełki i litery `j`/`k` chodzą po kolejce.

   To nie jest ryzyko teoretyczne: przykładowa etykieta InPostu ma numer
   `600000367616070023174201`, więc bez zabezpieczenia jeden skan przerzuciłby
   kubełek sześć razy, zanim doleciałby Enter.

   Wzorzec jest przeniesiony z kolektora (`android/.../scan/WedgeKeySource.kt`),
   razem z jego uzasadnieniami: przerwa resetuje bufor, Enter kończy serię,
   krótka seria nie jest skanem, a gdy kursor stoi w polu tekstowym — hook
   milczy, bo pole obsługuje Enter samo.                                     */

/** Dłuższa przerwa niż ta znaczy, że to człowiek, a nie czytnik. */
export const PRZERWA_MS = 300;
/** Krótsza seria to nie kod — żaden numer listu ani zwrotu nie jest tak krótki. */
export const MIN_DLUGOSC = 6;
/**
 * Ile czeka PIERWSZY znak serii, zanim trafi do skrótów klawiszowych.
 *
 * Bez tego opóźnienia pierwsza cyfra kodu i tak przełączyłaby kubełek: w chwili
 * jej naciśnięcia nikt jeszcze nie wie, czy to skan, czy skrót. Człowiek nie
 * wciska dwóch klawiszy w czterdzieści milisekund, a czytnik wysyła znak co
 * kilka — więc drugi znak w tym oknie rozstrzyga sprawę na korzyść skanu.
 */
export const ZWLOKA_MS = 40;

/**
 * Odstęp, poniżej którego seria W POLU TEKSTOWYM jest czytnikiem (0.468.0).
 *
 * Sześć razy ostrzej niż `PRZERWA_MS`, bo tu pomyłka kosztuje więcej: poza
 * polem zbyt gorliwy nasłuch przełączy najwyżej kubełek, a w polu ZJADŁBY
 * wpisaną notatkę. Czytnik wysyła znak co kilka milisekund. Człowiek
 * piszący 50 ms na znak pisałby 240 słów na minutę, i to przez sześć znaków
 * bez jednej zwłoki.
 */
export const PRZERWA_W_POLU_MS = 50;

export interface OpcjeSkanera {
  /**
   * Słuchaj także w polach tekstowych (0.468.0). Seria czytnika w zwykłym
   * polu nie zostaje w nim — pole wraca do treści sprzed serii, a kod idzie
   * do `onSkan`. Pole, które skan obsługuje samo, nosi `data-skan-wlasny`.
   */
  wPolach?: boolean;
}

/** Typy pól, w których czytnik pisze jak klawiatura. Hasło — nigdy. */
const POLE_TEKSTOWE = /^(text|search|number|tel|email|url)$/;

/**
 * Przywraca treść pola TĄ DROGĄ, którą React widzi jako pisanie.
 *
 * Samo `value = …` React by zignorował: pole kontrolowane ma swój stan
 * i przy następnym przerysowaniu wstawiłoby z powrotem cyfry czytnika.
 * Setter z prototypu plus zdarzenie `input` trafia do `onChange`.
 */
function ustawTresc(pole: HTMLInputElement | HTMLTextAreaElement, tresc: string) {
  const proto = pole instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(pole, tresc);
  pole.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Nasłuch czytnika. `onSkan` dostaje gotowy kod, `onZnak` — pojedynczy klawisz,
 * który okazał się NIE być częścią serii (czyli zwykły skrót).
 *
 * Ekran oddaje obsługę skrótów temu hookowi zamiast trzymać własny `keydown`:
 * dwa niezależne nasłuchy nie umiałyby się dogadać, który klawisz jest czyj.
 */
export function useSkaner(
  onSkan: (kod: string) => void,
  onZnak?: (e: KeyboardEvent) => void,
  opcje?: OpcjeSkanera,
) {
  const naSkan = useRef(onSkan);
  const naZnak = useRef(onZnak);
  const wPolach = useRef(Boolean(opcje?.wPolach));
  naSkan.current = onSkan;
  naZnak.current = onZnak;
  wPolach.current = Boolean(opcje?.wPolach);

  /* ── SKAN W POLU (0.468.0) ───────────────────────────────────────────────
     Zgłoszenie właściciela: „zakładka zwrotów powinna CAŁY CZAS nasłuchiwać
     skanu etykiety". Nasłuch niżej milczy, gdy kursor stoi w polu — więc
     etykieta zeskanowana przy kursorze w notatce albo w kwocie wpisywała się
     tam jak tekst, a Enter czytnika zapisywał tę kwotę.

     Osobny nasłuch w FAZIE PRZECHWYTYWANIA, na oknie. Tylko ta faza jest
     przed obsługą pola w Reakcie, więc Enter czytnika nie dociera do pola
     wcale. Znaki serii już w polu stoją — przy Enterze pole wraca do treści
     sprzed serii.

     Nasłuch niżej zostaje BEZ ZMIAN. Działa w fazie bąbelkowej i ma swoje
     zwłoki pod skróty — przestawienie go dotknęłoby każdego klawisza ekranu. */
  useEffect(() => {
    let pole: HTMLInputElement | HTMLTextAreaElement | null = null;
    let seria = "";
    let przedSeria = "";
    let ostatni = 0;
    const zeruj = () => { pole = null; seria = ""; przedSeria = ""; };

    const naKlawiszWPolu = (e: KeyboardEvent) => {
      if (!wPolach.current) return;
      const cel = e.target;
      const tekstowe = cel instanceof HTMLTextAreaElement
        || (cel instanceof HTMLInputElement && POLE_TEKSTOWE.test(cel.type));
      if (!tekstowe) return;
      if (cel.closest("[data-skan-wlasny]")) return;
      /* Przytrzymany klawisz powtarza się co ~30 ms — gęściej niż próg. To nie
         czytnik, więc przerywa serię, zamiast ją budować. */
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) { zeruj(); return; }

      const teraz = Date.now();
      const wSerii = cel === pole && teraz - ostatni <= PRZERWA_W_POLU_MS;
      ostatni = teraz;

      if (e.key === "Enter" || e.key === "Tab") {
        const kod = wSerii ? seria : "";
        const bylo = przedSeria;
        zeruj();
        if (kod.length < MIN_DLUGOSC) return;
        e.preventDefault();
        e.stopPropagation();
        ustawTresc(cel, bylo);
        naSkan.current(kod);
        return;
      }
      if (e.key.length !== 1) { zeruj(); return; }
      if (!wSerii) {
        /* `keydown` przychodzi PRZED wstawieniem znaku — to jest treść,
           do której pole wróci, jeśli seria okaże się skanem. */
        pole = cel;
        seria = e.key;
        przedSeria = cel.value;
        return;
      }
      seria += e.key;
    };

    window.addEventListener("keydown", naKlawiszWPolu, true);
    return () => window.removeEventListener("keydown", naKlawiszWPolu, true);
  }, []);

  useEffect(() => {
    let bufor = "";
    let ostatni = 0;
    let odlozony: { e: KeyboardEvent; zegar: ReturnType<typeof setTimeout> } | null = null;

    const wypusc = () => {
      if (!odlozony) return;
      clearTimeout(odlozony.zegar);
      const e = odlozony.e;
      odlozony = null;
      naZnak.current?.(e);
    };

    const naKlawisz = (e: KeyboardEvent) => {
      /* Pole tekstowe obsługuje wpisywanie samo — tak samo jak licznik fokusów
         w kolektorze. Bez tego skan wpisywany ręcznie do pola leciałby dwiema
         drogami naraz. */
      const cel = e.target as HTMLElement | null;
      if (cel && (/^(INPUT|TEXTAREA|SELECT)$/.test(cel.tagName) || cel.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const teraz = Date.now();
      const seria = teraz - ostatni <= PRZERWA_MS;
      if (!seria) bufor = "";
      ostatni = teraz;

      if (e.key === "Enter" || e.key === "Tab") {
        const kod = bufor;
        bufor = "";
        if (kod.length >= MIN_DLUGOSC) {
          /* Odłożony pierwszy znak NIE leci do skrótów: należał do kodu. */
          if (odlozony) { clearTimeout(odlozony.zegar); odlozony = null; }
          e.preventDefault();
          naSkan.current(kod);
          return;
        }
        wypusc();
        naZnak.current?.(e);
        return;
      }

      if (e.key.length !== 1) { wypusc(); naZnak.current?.(e); return; }

      bufor += e.key;
      if (bufor.length === 1) {
        /* Pierwszy znak czeka: dopiero drugi w oknie mówi, że to czytnik. */
        odlozony = { e, zegar: setTimeout(() => { odlozony = null; naZnak.current?.(e); }, ZWLOKA_MS) };
        return;
      }
      /* Druga litera w serii przesądza — pierwszy znak zostaje przy kodzie. */
      if (odlozony) { clearTimeout(odlozony.zegar); odlozony = null; }
    };

    window.addEventListener("keydown", naKlawisz);
    return () => {
      if (odlozony) clearTimeout(odlozony.zegar);
      window.removeEventListener("keydown", naKlawisz);
    };
  }, []);
}

/* ── Czytnik W POLU TEKSTOWYM (0.329.0) ─────────────────────────────────────
   Zgłoszenie właściciela: „skan powinien najpierw wyczyścić pole szukania,
   a nie dopisywać się na końcu tego, co już w nim stoi".

   Hook wyżej celowo MILCZY, gdy kursor stoi w polu — pole obsługuje Enter samo
   i dwie drogi naraz wpisywałyby kod podwójnie. Skutek uboczny tej decyzji jest
   jednak taki, że znaki czytnika lecą do pola jak pisanie: przy niepustym polu
   doklejają się do poprzedniej treści. Operator, który zeskanował jedną
   etykietę, a potem drugą, szuka po sklejonych dwóch numerach i nie znajduje
   nic. Wygląda to na zepsuty czytnik, a jest zwykłym dopisaniem.

   ROZSTRZYGA SERIA, NIE POJEDYNCZY ZNAK. Ten sam podpis czytnika co wyżej:
   znaki lecą gęściej niż `PRZERWA_MS`, a kod jest dłuższy niż `MIN_DLUGOSC`.
   Podmiana następuje dopiero przy SZÓSTYM znaku serii i tylko wtedy, gdy przed
   serią coś w polu stało — człowiek piszący numer od pustego pola nie traci
   nic, a poprawka Backspace'em przerywa serię i też nic nie kasuje.

   PRÓG SZEŚCIU ZNAKÓW, nie dwóch: człowiek bywa wraca do pola po namyśle
   i dopisuje dwa znaki szybciej niż w trzysta milisekund. Sześć znaków bez
   ani jednej przerwy po pauzie to już nie namysł, tylko czytnik.

   KLASA, NIE HOOK, i to jest cała różnica dla testu: reguła jest zależna od
   ZEGARA, a zegar wstrzykuje się w konstruktorze wywołania. Test hooka musiałby
   udawać czas Reacta, a ten sam błąd — zbyt gorliwa podmiana — kasowałby biuru
   wpisany numer i wyszedłby dopiero na produkcji.                            */

export interface WynikKlawisza {
  /** Ustaw pole na tę wartość i zjedz zdarzenie: seria okazała się skanem. */
  podmien: string | null;
  /** Kod gotowy do wyszukania — Enter zakończył dość długą serię. */
  kod: string | null;
}

const NIC: WynikKlawisza = { podmien: null, kod: null };

export class SeriaWPolu {
  private ostatni = 0;
  private seria = "";
  /** Co stało w polu, zanim zaczęła się ta seria. */
  private przedSeria = "";

  /** Przerwanie serii: poprawka ręką, klawisz funkcyjny, koniec skanu. */
  przerwij(): void {
    this.ostatni = 0;
    this.seria = "";
    this.przedSeria = "";
  }

  /**
   * @param e klawisz z pola (`key` plus modyfikatory)
   * @param wPolu bieżąca treść pola — przed wstawieniem tego znaku
   */
  klawisz(
    e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
    wPolu: string,
    teraz: number = Date.now(),
  ): WynikKlawisza {
    if (e.metaKey || e.ctrlKey || e.altKey) { this.przerwij(); return NIC; }

    if (e.key === "Enter" || e.key === "Tab") {
      /* Enter jest tu OSTATNIĄ szansą na poprawienie pola: gdy podmiana nie
         zaszła (czytnik krótszy niż próg albo pole było puste), a seria mimo
         to jest kodem, szukamy po NIEJ, nie po sklejeniu. */
      const kod = this.seria.length >= MIN_DLUGOSC ? this.seria : null;
      this.przerwij();
      return { podmien: null, kod };
    }

    /* Backspace, strzałki, Delete — to poprawia człowiek, nie czytnik. */
    if (e.key.length !== 1) { this.przerwij(); return NIC; }

    const wSerii = teraz - this.ostatni <= PRZERWA_MS;
    this.ostatni = teraz;
    if (!wSerii) {
      this.seria = e.key;
      this.przedSeria = wPolu;
      return NIC;
    }
    this.seria += e.key;

    /* DOKŁADNIE przy progu, nie po nim: siódmy znak dopisuje się już do pola
       podmienionego i drugie czyszczenie zjadłoby szósty. */
    if (this.seria.length === MIN_DLUGOSC && this.przedSeria !== "") {
      this.przedSeria = "";
      return { podmien: this.seria, kod: null };
    }
    return NIC;
  }
}
