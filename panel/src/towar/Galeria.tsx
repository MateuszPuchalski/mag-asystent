import React, { createContext, useContext, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { Powiekszenie } from "./Powiekszenie";

/* ── Galeria zdjęć jednej rozmowy ────────────────────────────────────────────
   Klient przysyła usterkę kilkoma zdjęciami, często w kilku wiadomościach.
   Agent porównuje je ze sobą, więc powiększenie przełącza się strzałkami
   po WSZYSTKICH zdjęciach rozmowy, zamiast zamykać się i otwierać przy
   każdym kaflu.

   KAFEL SIĘ ZAPISUJE, GALERIA NIE ZNA ŹRÓDŁA. Obraz każdego kafla wisi na
   jego własnym haku, a haka nie wolno wołać w pętli. Kafel podaje więc
   galerii gotowy adres, a galeria trzyma tylko listę i otwarte zdjęcie.

   KOLEJNOŚĆ BIERZE SIĘ Z DOKUMENTU, nie z kolejności zapisu. Obrazy
   doładowują się w dowolnej kolejności, a strzałka w prawo ma iść tak,
   jak agent czyta rozmowę.

   Kafel bez galerii nad sobą powiększa po staremu, pojedynczo. */

type Wpis = { url: string; nazwa: string; el: React.RefObject<HTMLElement | null> };
type Sterowanie = {
  zapisz: (id: string, wpis: Wpis) => () => void;
  otworz: (id: string) => void;
};

const Kontekst = createContext<Sterowanie | null>(null);

/** Wpisy w kolejności, w jakiej stoją na ekranie. */
function poKolei(wpisy: Map<string, Wpis>): Array<[string, Wpis]> {
  return [...wpisy.entries()].sort(([, a], [, b]) => {
    const ea = a.el.current;
    const eb = b.el.current;
    if (!ea || !eb) return 0;
    return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

export function Galeria({ children }: { children: React.ReactNode }) {
  const wpisy = useRef(new Map<string, Wpis>());
  const [otwarte, setOtwarte] = useState<string | null>(null);
  /* Lista mieszka w refie, bo dzieci zapisują się w efektach. Licznik tylko
     przerysowuje otwarte okno, gdy doładuje się kolejne zdjęcie. */
  const [, odswiez] = useReducer((n: number) => n + 1, 0);

  const sterowanie = useMemo<Sterowanie>(() => ({
    zapisz: (id, wpis) => {
      wpisy.current.set(id, wpis);
      odswiez();
      return () => { wpisy.current.delete(id); odswiez(); };
    },
    otworz: setOtwarte,
  }), []);

  const lista = otwarte === null ? [] : poKolei(wpisy.current);
  const i = lista.findIndex(([id]) => id === otwarte);
  /* Zdjęcie zniknęło spod otwartego okna, na przykład przy zmianie sprawy.
     Okno zamyka się, zamiast pokazywać inne zdjęcie bez słowa. */
  useEffect(() => { if (otwarte !== null && i < 0) setOtwarte(null); }, [otwarte, i]);

  const biezace = i >= 0 ? lista[i][1] : null;
  const skok = (o: number) => setOtwarte(lista[(i + o + lista.length) % lista.length][0]);

  return <Kontekst.Provider value={sterowanie}>
    {children}
    {biezace && <Powiekszenie url={biezace.url} nazwa={biezace.nazwa} symbol={null}
      zamknij={() => setOtwarte(null)}
      galeria={lista.length > 1
        ? { pozycja: i + 1, ile: lista.length, poprzednie: () => skok(-1), nastepne: () => skok(1) }
        : undefined} />}
  </Kontekst.Provider>;
}

/**
 * Zapisuje zdjęcie kafla w galerii rozmowy. Zwraca otwarcie albo `null`,
 * gdy nad kaflem nie ma galerii albo obrazu jeszcze nie ma — wtedy kafel
 * powiększa sam.
 */
export function useWGalerii(url: string | null | undefined, nazwa: string,
  el: React.RefObject<HTMLElement | null>): (() => void) | null {
  const galeria = useContext(Kontekst);
  const id = useId();
  useEffect(() => {
    if (!galeria || !url) return;
    return galeria.zapisz(id, { url, nazwa, el });
  }, [galeria, id, url, nazwa, el]);
  return galeria && url ? () => galeria.otworz(id) : null;
}
