import fs from "node:fs";
import { DZIENNIK_ODMOW_SIECI } from "./srodowisko";

/* ── Po przebiegu: czy serwer próbował wyjść do sieci ────────────────────────
   Mur z `bez-sieci.cjs` zatrzymuje każde połączenie poza własną maszynę
   i zapisuje je w dzienniku. Zatrzymanie nie wystarcza: test, który doprowadził
   serwer do strzału w Allegro albo w dostawcę modelu, jest zły także wtedy,
   gdy strzał nie doleciał. Na maszynie bez muru doleciałby.

   Dlatego próba wyjścia KOŃCZY PRZEBIEG BŁĘDEM, a nie ostrzeżeniem.

   Jedyny wyjątek to lista wydań. Serwer pyta o nią GitHuba w każdej
   instalacji, w losowej chwili pierwszych dwudziestu minut po starcie
   (`uruchomTakt("wydania", …)` w `server/src/index.ts`). To odczyt publicznej
   listy, nie zależy od żadnego testu, a mur i tak go zatrzymuje. Bez wyjątku
   przebieg padałby raz na kilkanaście uruchomień bez związku z kodem. */
const LISTA_WYDAN = ["api.github.com", "raw.githubusercontent.com"];

export default function strazSieci() {
  let dziennik: string;
  try {
    dziennik = fs.readFileSync(DZIENNIK_ODMOW_SIECI, "utf8");
  } catch {
    /* Brak pliku znaczy, że mur nie odmówił ani razu. */
    return;
  }
  const proby = dziennik.split("\n").filter((w) => w.trim() !== "")
    .filter((w) => !LISTA_WYDAN.some((h) => w.includes(` ${h}:`)));
  if (proby.length > 0) {
    throw new Error(
      "Serwer API próbował wyjść do sieci w trakcie przebiegu e2e. Mur zatrzymał połączenia, " +
      `ale test, który je wywołał, trzeba poprawić:\n${proby.join("\n")}`);
  }
}
