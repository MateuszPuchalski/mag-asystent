import { config } from "./config.js";

/* ── Czas do POKAZANIA człowiekowi ───────────────────────────────────────────
   W bazie każdy znacznik jest w UTC (`nowIso()`, `strftime(…'Z','now')`) i tak
   ma zostać: porównania, progi rekoncyliacji i sortowanie po `created_at`
   działają leksykalnie tylko dlatego, że format jest jeden i bez strefy.

   Do wyświetlenia trzeba jednak czasu LOKALNEGO. Wcześniej robiło to odcięcie
   znaków z ciągu ISO (`.slice(11, 16)`), co jest UTC pokazanym jako godzina
   zegarowa — latem w Polsce dwie godziny wstecz. Objaw był mylący podwójnie:
   zdarzenie sprzed chwili wyglądało na sprzed dwóch godzin, a przy wpisach
   z okolic północy myliła się także data.

   Strefa jest USTAWIENIEM, nie strefą maszyny. Serwer bywa postawiony
   z lokalizacją systemu inną niż magazyn (obraz z chmury, angielski Windows),
   a wtedy zegar na ekranie kolektora rozjeżdżałby się z zegarem na ścianie
   i nikt nie wiedziałby dlaczego.                                            */

/** `Intl` jest kosztowny w konstrukcji — trzymamy po jednym na format. */
const formatery = new Map<string, Intl.DateTimeFormat>();

function formater(opcje: Intl.DateTimeFormatOptions, klucz: string): Intl.DateTimeFormat {
  const pelnyKlucz = `${klucz}|${config.strefaCzasu}`;
  let f = formatery.get(pelnyKlucz);
  if (!f) {
    f = new Intl.DateTimeFormat("pl-PL", { ...opcje, timeZone: config.strefaCzasu });
    formatery.set(pelnyKlucz, f);
  }
  return f;
}

/**
 * `HH:MM` czasu lokalnego z ISO w UTC.
 *
 * Niepoprawne wejście wraca NIEZMIENIONE, zamiast wywracać stronę albo
 * pokazywać „Invalid Date" — wiersz kolejki z popsutym znacznikiem ma dalej
 * nieść etykietę i status, bo to one odpowiadają na pytanie magazyniera.
 */
export function czasLokalny(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formater({ hour: "2-digit", minute: "2-digit" }, "hm").format(d);
}

/** `RRRR-MM-DD` czasu lokalnego — data, nie doba UTC. */
export function dataLokalna(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const cz = formater({ year: "numeric", month: "2-digit", day: "2-digit" }, "ymd").formatToParts(d);
  const p = (typ: string) => cz.find((c) => c.type === typ)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}`;
}

/** `RRRR-MM-DD HH:MM:SS` — pełny stempel do tabel audytu i eksportów. */
export function stempelLokalny(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dataLokalna(iso)} ${formater(
    { hour: "2-digit", minute: "2-digit", second: "2-digit" },
    "hms"
  ).format(d)}`;
}
