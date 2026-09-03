import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { klucze } from "./rozmowy";
import type { Rozmowa } from "./typy";
import { token } from "./klient";

export type ZdarzenieRozmowy = {
  id: number;
  type: "presence" | "message.created" | "assignment.changed" | "warehouse.result";
  conversationId: number;
  [k: string]: unknown;
};

export type Obecnosc = { userId: number; name: string; typing: boolean };

/**
 * Jedna szyna zdarzeń dla całego panelu.
 *
 * Czytamy ją `fetch`em, nie `EventSource`: sesja jedzie nagłówkiem `x-session`,
 * a `EventSource` nagłówków nie ustawia. Wariant z tokenem w adresie działałby,
 * ale token lądowałby w logach żądań serwera.
 *
 * Strumień jest NIEFILTROWANY, choć serwer przyjmuje `?conversationId`. Filtr
 * obsłużyłby otwartą rozmowę, ale uciszyłby kolejkę — a to właśnie w kolejce
 * nowe pytanie ma się pojawić samo. Jedno połączenie kosztuje mniej niż dwa.
 */
export function useSzynaZdarzen(
  wybrana: number | null,
  onNowaWiadomosc: (conversationId: number) => void,
) {
  const qc = useQueryClient();
  const [obecnosc, setObecnosc] = useState<Obecnosc[]>([]);

  /* Referencje, a nie zależności efektu: inaczej każda zmiana wybranej rozmowy
     zrywałaby strumień i zaczynała go od nowa. */
  const wybranaRef = useRef(wybrana);
  const onNowa = useRef(onNowaWiadomosc);
  wybranaRef.current = wybrana;
  onNowa.current = onNowaWiadomosc;

  useEffect(() => {
    const przerwij = new AbortController();
    let zywy = true;
    let przerwa = 1000;

    async function polacz() {
      const odp = await fetch("/api/conversations/events", {
        headers: { "x-session": token() },
        signal: przerwij.signal,
      });
      if (!odp.ok || !odp.body) throw new Error(`szyna zdarzeń: ${odp.status}`);
      przerwa = 1000;                                  // udane połączenie zeruje odczekiwanie

      const czytnik = odp.body.getReader();
      const dekoder = new TextDecoder();
      let bufor = "";
      for (;;) {
        const { done, value } = await czytnik.read();
        if (done) break;
        bufor += dekoder.decode(value, { stream: true });
        const ramki = bufor.split("\n\n");
        bufor = ramki.pop() ?? "";
        for (const ramka of ramki) {
          const linia = ramka.split("\n").find((l) => l.startsWith("data: "));
          if (!linia) continue;                        // komentarz `: keep-alive`
          obsluz(JSON.parse(linia.slice(6)) as ZdarzenieRozmowy);
        }
      }
      throw new Error("szyna zdarzeń zamknięta przez serwer");
    }

    function obsluz(z: ZdarzenieRozmowy) {
      if (z.type === "presence") {
        setObecnosc((z.obecni as Obecnosc[] | undefined) ?? []);
        /* ── OBECNOŚĆ ŁATA CACHE, NIE ŚCIĄGA LISTY (0.196.0) ─────────────────
           Wiersz kolejki pokazuje od 0.158.0, kto siedzi przy rozmowie, więc
           zdarzenie obecności musi go zmienić. Do 0.195.0 robiło to przez
           `invalidateQueries`, czyli PONOWNE POBRANIE CAŁEJ LISTY.

           Rachunek, dla którego to się zmienia: `listaRozmow()` nie ma
           `LIMIT`-u i oddaje każdą zsynchronizowaną rozmowę z 21 kolumnami.
           Pomiar na tym repo: 100 rozmów to 54 kB, 1000 — 537 kB, 5000 —
           2688 kB. Obecność leci przy wejściu, wyjściu i przy PISANIU
           (dławione co 5 s), więc kolega redagujący odpowiedź ściągał u
           wszystkich całą listę co pięć sekund.

           `staleTime` by tego NIE załatwił i to sprawdzone, nie założone:
           `invalidateQueries` znaczy rozmowę stałą niezależnie od niego
           i odświeża aktywne zapytania tak samo (pomiar: 2 pobrania z
           `staleTime` i 2 bez).

           Zamiast pobierać, ŁATAMY wiersz w cache'u. Reguła „kto trzyma"
           nie powstaje tu drugi raz: serwer oddaje `obecni` posortowanych po
           czasie wejścia, a `uchwyty()` bierze z nich pierwszego — więc
           bierzemy pierwszy element, nie wyprowadzamy porządku od nowa.

           Efekt uboczny jest dodatni: znacznik pojawia się od razu, bez
           czekania na odpowiedź serwera. */
        const obecniTeraz = (z.obecni as Obecnosc[] | undefined) ?? [];
        const trzyma = obecniTeraz[0]
          ? { userId: obecniTeraz[0].userId, name: obecniTeraz[0].name }
          : null;
        qc.setQueryData(klucze.rozmowy, (stare: { rozmowy: Rozmowa[] } | undefined) =>
          !stare ? stare : {
            ...stare,
            rozmowy: stare.rozmowy.map((r) =>
              r.id === z.conversationId ? { ...r, oglada: trzyma } : r),
          });
        return;
      }
      /* Kolejka reaguje na KAŻDE zdarzenie: nowa wiadomość zmienia kolejność,
         przejęcie zmienia właściciela, wynik z hali zdejmuje oczekiwanie. */
      qc.invalidateQueries({ queryKey: klucze.rozmowy });

      if (z.conversationId !== wybranaRef.current) return;
      /* Nowa wiadomość klienta w OTWARTEJ rozmowie nie przeładowuje jej sama:
         agent może być w połowie szkicu. Ekran mówi o dopisku i czeka na
         kliknięcie — blizna 0.110.0 zabrania cichego nadpisania. */
      if (z.type === "message.created") onNowa.current(z.conversationId);
      else qc.invalidateQueries({ queryKey: klucze.rozmowa(z.conversationId) });
    }

    (async () => {
      while (zywy) {
        try {
          await polacz();
        } catch (e) {
          if (przerwij.signal.aborted) return;
          /* Zerwany strumień bez ponowienia znaczyłby ekran, który wygląda
             na żywy i milczy do końca zmiany. Odczekiwanie rośnie, żeby
             padnięty serwer nie dostał pętli żądań. */
          await new Promise((r) => setTimeout(r, przerwa));
          przerwa = Math.min(przerwa * 2, 30_000);
        }
      }
    })();

    return () => { zywy = false; przerwij.abort(); };
  }, [qc]);

  return { obecnosc };
}
