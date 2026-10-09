import { useState } from "react";

/* ── Zwinięcie paska bocznego ──────────────────────────────────────────────
   Pasek zwija się do samych ikon i liczników, żeby kolejka dostała całą
   szerokość okna. Wybór leży w przeglądarce, nie na serwerze: zależy od
   monitora i od tego, jak wysoko ktoś trzyma okno obok Subiekta, więc jedno
   biuro ma prawo mieć dwa różne ustawienia na dwóch komputerach.

   Pamięć przeglądarki bywa niedostępna (tryb prywatny, zablokowane dane
   witryn). Wtedy pasek działa dalej i tylko zapomina wybór po odświeżeniu —
   dlatego każdy odczyt i zapis siedzi w `try`. */
export const KLUCZ_ZWINIETEGO = "wertis.pasek.zwiniety";

function czytaj(): boolean {
  try { return localStorage.getItem(KLUCZ_ZWINIETEGO) === "1"; } catch { return false; }
}

export function useZwinietyPasek(): [boolean, () => void] {
  const [zwiniety, ustaw] = useState(czytaj);
  const przelacz = () => ustaw((z) => {
    const nowy = !z;
    try { localStorage.setItem(KLUCZ_ZWINIETEGO, nowy ? "1" : "0"); } catch { /* bez pamięci wybór ginie po odświeżeniu */ }
    return nowy;
  });
  return [zwiniety, przelacz];
}
