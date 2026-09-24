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

/**
 * Godzina zegara na ścianie magazynu (0–23). Nocna kopia pyta o nią, bo okno
 * „w nocy" liczone w UTC przesuwałoby się o godzinę przy każdej zmianie czasu.
 */
export function godzinaLokalna(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return Number.NaN;
  const cz = formater({ hour: "2-digit", hourCycle: "h23" }, "h").formatToParts(d);
  return Number(cz.find((c) => c.type === "hour")?.value ?? Number.NaN);
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

/* ── Tydzień na zegarze magazynu (@wydanie, raport tygodnia) ────────────────
   Raport tygodnia ma granice STAŁE: od poniedziałku 00:00 do następnego
   poniedziałku 00:00 czasu lokalnego. Okna analizy liczą „ostatnie N dni od
   teraz", więc ten sam raport otwarty we wtorek i w piątek dawał różne liczby.
   Raport, który się zmienia przy każdym otwarciu, nie nadaje się do porównania
   tydzień do tygodnia — a po to go robimy.

   Arytmetyka dat idzie na KALENDARZU (RRRR-MM-DD w UTC), a dopiero granica
   przechodzi przez strefę. Doba ze zmianą czasu ma 23 albo 25 godzin, więc
   „poniedziałek plus 7 × 24 h" raz w roku trafiałby w niedzielę 23:00. */

/** Data kalendarzowa przesunięta o `dni` — bez strefy, bez godzin. */
export function dodajDni(data: string, dni: number): string {
  const [r, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(r, m - 1, d + dni)).toISOString().slice(0, 10);
}

/** Różnica zegara lokalnego i UTC w chwili `t` (ms). Latem w Polsce +2 h. */
function przesuniecieStrefy(t: number): number {
  const cz = formater({
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }, "pelny").formatToParts(new Date(t));
  const p = (typ: string) => Number(cz.find((c) => c.type === typ)?.value);
  return Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second")) - t;
}

/**
 * Północ lokalna dnia `data` jako ISO w UTC — granica doby w bazie.
 *
 * Dwa przybliżenia, nie jedno: przesunięcie strefy liczone dla UTC-owej
 * północy bywa już innym przesunięciem niż dla lokalnej. W Polsce zmiana
 * czasu wypada o 2:00 i 3:00, więc północ istnieje zawsze i drugi krok
 * wystarcza.
 */
export function polnocLokalna(data: string): string {
  const [r, m, d] = data.split("-").map(Number);
  const zegar = Date.UTC(r, m - 1, d);
  const t = zegar - przesuniecieStrefy(zegar - przesuniecieStrefy(zegar));
  return new Date(t).toISOString();
}

/**
 * Tydzień ISO 8601 dnia `data`: etykieta `RRRR-Www` i jego poniedziałek.
 *
 * Rok tygodnia to rok jego czwartku, nie rok daty — 29 grudnia 2025 należy
 * do tygodnia 2026-W01. Etykieta ma ten sam kształt co `tygodnie`
 * w analizie dostaw, żeby oba ekrany mówiły o tygodniu tym samym słowem.
 */
export function tydzienIso(data: string): { tydzien: string; poniedzialek: string } {
  const [r, m, d] = data.split("-").map(Number);
  const dzienTygodnia = (new Date(Date.UTC(r, m - 1, d)).getUTCDay() + 6) % 7;
  const poniedzialek = dodajDni(data, -dzienTygodnia);
  const czwartek = dodajDni(poniedzialek, 3);
  const rok = Number(czwartek.slice(0, 4));
  const numer = Math.floor(
    (Date.parse(czwartek) - Date.UTC(rok, 0, 1)) / (7 * 86_400_000)) + 1;
  return { tydzien: `${rok}-W${String(numer).padStart(2, "0")}`, poniedzialek };
}
