import React from "react";
import { MemoryRouter } from "react-router-dom";
import type { SzczegolReklamacji } from "../api/typy";
import { FaktySprawy } from "../reklamacje/Fakty";
import { kartotekaKolumny } from "../reklamacje/Glowica";

/* Pas faktów reklamacji do testów. Fakty stoją w głowicy, a test patrzy na sam
   pas, w ramie routera, bo „Ten zakup u nas" niesie odnośniki do kolejek.
   Jeden pomocnik zamiast kopii w każdym pliku, bo kopie rozjeżdżają się przy
   pierwszej zmianie propsów pasa. */
export const Fakty = ({ szczegol, onSprawdzPrzesylke, sprawdzaPrzesylke, bladPrzesylki }: {
  szczegol: SzczegolReklamacji; onSprawdzPrzesylke?: () => void;
  sprawdzaPrzesylke?: boolean; bladPrzesylki?: string;
}) => <MemoryRouter><FaktySprawy szczegol={szczegol} towar={kartotekaKolumny(szczegol)}
  onSprawdzPrzesylke={onSprawdzPrzesylke} sprawdzaPrzesylke={sprawdzaPrzesylke}
  bladPrzesylki={bladPrzesylki} /></MemoryRouter>;
