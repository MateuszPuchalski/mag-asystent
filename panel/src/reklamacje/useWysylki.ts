import { useEffect, useState } from "react";
import { useOdpowiedz, useOdswiez, useWerdykt, useZwrotTowaru } from "../api/reklamacje";
import { Konflikt } from "../api/klient";
import type { SzczegolReklamacji, SzczegolyWysylki, WiadomoscReklamacji } from "../api/typy";
import { useBledy } from "../sprawy/useBledy";
import type { DecyzjaOTowarze, ZadanieWerdyktu } from "./Werdykt";

/* ── Trzy wysyłki do Allegro z jednej sprawy ────────────────────────────────
   Odpowiedź w czacie, werdykt i stanowisko o towarze. Mieszkają w jednym
   haku, bo dzielą triage 409 i jeden dialog zgody. Ekran dostaje gotowe
   zdania i przyciski, a sam zostaje układem kolumn.

   TRZY RODZAJE 409 i każdy każe co innego zrobić. Dopisek klienta albo
   doradcy otwiera dialog z jawną zgodą. Zamknięta rozmowa i rozjazd wersji
   to zdanie serwera pod polem. Rozróżnia je ten hak, nie klient HTTP, bo
   ten sam podział ma skrzynka.

   STANOWISKO O TOWARZE dostaje TEN SAM dialog co odpowiedź. To ta sama
   rozmowa i ten sam rodzaj konfliktu, więc drugiego okna nie ma. Dialog
   niesie decyzję i treść, żeby „wyślij mimo to” poszło z tym samym zamiarem.

   ZDANIA NALEŻĄ DO PRÓBY, nie do sprawy: zmiana sprawy czyści je razem
   z otwartym konfliktem (`useBledy`). Szkic odpowiedzi przeżywa zmianę,
   bo trzyma go `useSzkicSprawy` pod numerem sprawy. */

/* Niepewny los stanowiska o towarze. Serwer drugiego nie wyśle, a nic
   w panelu tej próby nie rozstrzyga, więc zdanie wskazuje Centrum Sprzedaży
   zamiast synchronizacji, która blokady nie zdejmie. */
export const TOWAR_NIEPEWNY = "Stanowisko o towarze mogło nie dojść do kupującego. "
  + "Sprawdź w Centrum Sprzedaży, czy je dostał — panel drugiego nie wyśle.";

/**
 * Dopisek klienta albo doradcy w chwili wysyłki — jedyny 409, który wymaga
 * DECYZJI agenta, więc jedyny z własnym dialogiem.
 */
const dopisek = (e: unknown): SzczegolyWysylki | null =>
  e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).nowaWiadomosc !== undefined
    ? (e.szczegoly as SzczegolyWysylki) : null;

/**
 * Ostatnia NIE nasza wiadomość — punkt odniesienia dla kontroli świeżości.
 *
 * Liczy go panel z osi, a serwer sprawdza po swojemu i to on rozstrzyga.
 * Panel musi mieć CO wysłać, zanim serwer powie, czy się zgadza.
 */
export const ostatniaNieNasza = (czat: WiadomoscReklamacji[]): number | null => {
  for (let i = czat.length - 1; i >= 0; i -= 1) {
    if (czat[i].autorRola !== "SELLER") return czat[i].id;
  }
  return null;
};

type Czynnosc = "wysylka" | "werdykt" | "towar";

/** Dopisek, który czeka na decyzję agenta — przy odpowiedzi albo przy towarze. */
type Zatrzymana =
  | { rodzaj: "odpowiedz"; szczegoly: SzczegolyWysylki }
  | { rodzaj: "towar"; szczegoly: SzczegolyWysylki; decyzja: DecyzjaOTowarze; tresc: string };

export function useWysylki({ szczegol, tresc, onWyslano }: {
  szczegol: SzczegolReklamacji | undefined;
  /** Szkic odpowiedzi z edytora. */
  tresc: string;
  /** Odpowiedź na pewno wyszła — ekran czyści szkic. */
  onWyslano: () => void;
}) {
  const id = szczegol?.reklamacja.id ?? null;
  const odpowiedz = useOdpowiedz();
  const werdykt = useWerdykt();
  const zwrotTowaru = useZwrotTowaru();
  const odswiez = useOdswiez();
  const { blad, ustaw } = useBledy<Czynnosc>(id);
  const [zatrzymana, setZatrzymana] = useState<Zatrzymana | null>(null);
  useEffect(() => { setZatrzymana(null); }, [id]);

  const wyslij = (mimoNowejWiadomosci = false) => {
    const d = szczegol;
    if (!d) return;
    ustaw("wysylka", "");
    odpowiedz.mutate({
      id: d.reklamacja.id,
      tresc,
      expectedWersja: d.reklamacja.wersja,
      expectedLastMessageId: ostatniaNieNasza(d.czat),
      mimoNowejWiadomosci,
    }, {
      onSuccess: (w) => {
        setZatrzymana(null);
        if (w.status === "sent") onWyslano();
        else ustaw("wysylka",
          "Wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj sprawę, zanim spróbujesz znowu.");
        /* Stan sprawy u Allegro zmienił się przed chwilą, a takt przyjdzie za
           trzy minuty. Przy wyniku niejednoznacznym to jedno żądanie
           rozstrzyga, czy wiadomość poszła. */
        odswiez.mutate({ id: d.reklamacja.id });
      },
      onError: (e) => {
        const k = dopisek(e);
        if (k) setZatrzymana({ rodzaj: "odpowiedz", szczegoly: k });
        else ustaw("wysylka", (e as Error).message);
      },
    });
  };

  const wyslijTowar = (decyzja: DecyzjaOTowarze, trescTowaru: string, mimoNowejWiadomosci = false) => {
    const d = szczegol;
    if (!d) return;
    ustaw("towar", "");
    zwrotTowaru.mutate({
      id: d.reklamacja.id, decyzja, tresc: trescTowaru,
      expectedWersja: d.reklamacja.wersja,
      expectedLastMessageId: ostatniaNieNasza(d.czat),
      mimoNowejWiadomosci,
    }, {
      onSuccess: (w) => {
        setZatrzymana(null);
        if (w.status !== "sent") ustaw("towar", TOWAR_NIEPEWNY);
      },
      onError: (e) => {
        const k = dopisek(e);
        if (k) setZatrzymana({ rodzaj: "towar", szczegoly: k, decyzja, tresc: trescTowaru });
        else ustaw("towar", (e as Error).message);
      },
    });
  };

  /* Werdykt: los próby przychodzi w odpowiedzi, a po `onSettled` sprawa
     dociąga się z kolumnami `werdykt_*`. Tu zostaje tylko zdanie o porażce.
     Stanowisko o towarze jedzie tym samym żądaniem, a jego los w polu
     `towar`. Werdykt wyszedł nieodwracalnie, więc porażka towaru nie jest
     porażką werdyktu: dopisek otwiera dialog, reszta to zdanie. */
  const wyslijWerdykt = (z: ZadanieWerdyktu) => {
    const d = szczegol;
    if (!d) return;
    ustaw("werdykt", "");
    ustaw("towar", "");
    setZatrzymana(null);
    const { towar, ...werdyktSam } = z;
    werdykt.mutate({
      id: d.reklamacja.id, ...werdyktSam, wersja: d.reklamacja.wersja,
      ...(towar ? { towar: { ...towar, expectedLastMessageId: ostatniaNieNasza(d.czat) } } : {}),
    }, {
      onSuccess: (w) => {
        if (w.status === "send_failed") ustaw("werdykt", w.blad ?? "Allegro odmówiło");
        const los = w.towar;
        if (towar && los) {
          if ("konflikt" in los) {
            if (los.konflikt.nowaWiadomosc !== undefined) {
              setZatrzymana({ rodzaj: "towar", szczegoly: los.konflikt, decyzja: towar.decyzja, tresc: towar.tresc });
            } else ustaw("towar", los.konflikt.error ?? "Stanowisko o towarze nie wyszło — wyślij je jeszcze raz.");
          } else if ("blad" in los) ustaw("towar", los.blad);
          else if ("pominiety" in los) ustaw("towar", los.pominiety);
          else if (los.status !== "sent") ustaw("towar", TOWAR_NIEPEWNY);
        }
        /* Zieleń „potwierdzony przez Allegro” należy się dopiero statusowi
           z synchronizacji, więc dociągamy go od razu, zamiast czekać na takt. */
        odswiez.mutate({ id: d.reklamacja.id });
      },
      onError: (e) => ustaw("werdykt", (e as Error).message),
    });
  };

  /* Dialog zgody: ten sam kształt dla obu wysyłek. Autora nazywa
     `ktoDopisal`, bo przy reklamacji bywa nim doradca Allegro. */
  const konflikt = zatrzymana === null ? null : {
    /* Klucz okna: zgoda dana przy odpowiedzi nie przechodzi na towar. */
    rodzaj: zatrzymana.rodzaj,
    szczegoly: zatrzymana.szczegoly,
    szkic: zatrzymana.rodzaj === "towar" ? zatrzymana.tresc : tresc,
    wysyla: zatrzymana.rodzaj === "towar" ? zwrotTowaru.isPending : odpowiedz.isPending,
    blad: blad(zatrzymana.rodzaj === "towar" ? "towar" : "wysylka"),
    ktoDopisal: zatrzymana.szczegoly.nowaWiadomosc?.rola === "ADMIN" ? "doradca Allegro" : "klient",
    wyslijMimoTo: () => (zatrzymana.rodzaj === "towar"
      ? wyslijTowar(zatrzymana.decyzja, zatrzymana.tresc, true) : wyslij(true)),
    popraw: () => setZatrzymana(null),
  };

  return {
    odpowiedz: { wyslij: () => wyslij(), trwa: odpowiedz.isPending, blad: blad("wysylka") },
    werdykt: { wyslij: wyslijWerdykt, trwa: werdykt.isPending, blad: blad("werdykt"), bladTowaru: blad("towar") },
    konflikt,
  };
}
