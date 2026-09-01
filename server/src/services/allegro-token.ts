import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { BladLimituAllegro, allegroTryb, allegroUserAgent, retryAfterMs } from "../adapters/allegro.js";
import { logEvent } from "./events.js";

/* ── Token OAuth konta Allegro — persystencja, odświeżanie, parowanie ────────
   Jedno konto sprzedawcy = jeden wiersz `allegro_token` (id=1). Refresh token
   jest STANEM: Allegro wydaje nową parę przy każdym odświeżeniu, więc env nie
   ma tu czego trzymać — zmiana wartości co 12 godzin to nie jest konfiguracja.

   Parowanie idzie DEVICE FLOW: serwer stoi w firmie bez publicznego URL-a,
   więc authorization code z redirectem nie ma dokąd wrócić. Pracownik dostaje
   kod i link (verification_uri_complete), potwierdza na SWOIM zalogowanym
   koncie Allegro, a serwer odpytuje endpoint tokena do skutku. Stan parowania
   mieszka w pamięci procesu API — restart w trakcie parowania po prostu każe
   zacząć od nowa, a to operacja raz na kwartał, nie codzienna.

   Godziny w Allegro: access token żyje ~12 h, refresh ~3 miesiące i odnawia
   się przy każdym użyciu — wygasa więc dopiero po kwartale NIEUŻYWANIA.      */

const ZAPAS_MS = 5 * 60_000; // odświeżamy 5 min przed wygaśnięciem
const TIMEOUT_MS = 10_000;

/* ── Rytm parowania a anti-bot Allegro (0.106.0) ─────────────────────────────
   Endpointy OAuth stoją na APEKSIE `allegro.pl`, czyli za tym samym edge'em,
   co sklep — nie na `api.allegro.pl`. Odpytywanie stanu parowania jest więc
   jedynym ruchem tej aplikacji o dużej częstotliwości, który widzi anti-bot
   sklepu. Zostawiona zakładka potrafiła wysyłać żądanie co ~6 sekund przez
   całe życie kodu (godzina), równym, nieludzkim rytmem z jednego adresu IP —
   i tak właśnie wygląda robot. Stąd podłoga odstępu i zwalnianie z czasem. */

/** Minimalny odstęp między odpytaniami, także gdyby Allegro podało mniej. */
const PODLOGA_PAROWANIA_MS = 5000;

/** Zdanie dla człowieka, gdy zamiast danych przyszła strona blokady. */
const KOMUNIKAT_BLOKADY =
  "Allegro odpowiedziało stroną, nie danymi — najpewniej blokada anti-bot dla " +
  "tego adresu IP. Przerwij parowanie na kilkanaście minut, a link potwierdzenia " +
  "otwórz z innej sieci (np. z telefonu po danych komórkowych).";

/**
 * Odstęp między odpytaniami stanu parowania — rośnie z czasem czekania.
 *
 * Człowiek potwierdza kod w kilkanaście sekund. Cisza po trzech minutach
 * znaczy, że odszedł od komputera albo utknął — pytanie co pięć sekund przez
 * kolejne pół godziny niczego wtedy nie przyspiesza, a buduje dokładnie ten
 * ślad, który anti-bot liczy jako maszynę.
 */
export function interwalParowania(czekaMs: number, bazaMs: number): number {
  const baza = Math.max(bazaMs, PODLOGA_PAROWANIA_MS);
  if (czekaMs < 60_000) return baza;
  if (czekaMs < 180_000) return Math.max(baza, 10_000);
  return Math.max(baza, 20_000);
}

/**
 * Czy odpowiedź jest STRONĄ (anti-bot), a nie danymi.
 *
 * Zablokowany adres IP dostaje z apexu HTML „Zostałeś zablokowany" zamiast
 * JSON-a. Bez tego rozpoznania parsowanie kończyło się błędem składni — czyli
 * komunikatem, z którego nikt przy panelu nie odczyta, co się stało.
 */
export function czyStronaBlokady(contentType: string | null, tresc: string): boolean {
  if ((contentType ?? "").includes("json")) return false;
  const t = tresc.trim();
  if (t === "") return false;
  return !t.startsWith("{") && !t.startsWith("[");
}

interface WierszTokena {
  access_token: string;
  refresh_token: string;
  wygasa_at: string;
  srodowisko: string;
}

const srodowisko = () => (config.allegro.sandbox ? "sandbox" : "prod");

const basic = () =>
  "Basic " +
  Buffer.from(`${config.allegro.clientId}:${config.allegro.clientSecret}`).toString("base64");

function wiersz(): WierszTokena | null {
  return (
    (db()
      .prepare(
        "SELECT access_token, refresh_token, wygasa_at, srodowisko FROM allegro_token WHERE id = 1"
      )
      .get() as WierszTokena | undefined) ?? null
  );
}

function zapisz(t: { access: string; refresh: string; wygasaMs: number; scope: string | null }, autor: string): void {
  db()
    .prepare(
      `INSERT INTO allegro_token(id, access_token, refresh_token, wygasa_at, scope, srodowisko, polaczono_at, polaczono_przez)
       VALUES (1,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         access_token=excluded.access_token, refresh_token=excluded.refresh_token,
         wygasa_at=excluded.wygasa_at, scope=excluded.scope, srodowisko=excluded.srodowisko`
    )
    .run(
      t.access,
      t.refresh,
      new Date(Date.now() + t.wygasaMs).toISOString(),
      t.scope,
      srodowisko(),
      nowIso(),
      autor
    );
}

/**
 * Czy token wymaga odświeżenia — czysta funkcja, jedyna logika czasu w tym
 * pliku i dlatego wyciągnięta pod test.
 */
export function czyOdswiezyc(wygasaAt: string, terazMs: number): boolean {
  const w = Date.parse(wygasaAt);
  return !Number.isFinite(w) || w - terazMs < ZAPAS_MS;
}

async function endpointTokena(params: URLSearchParams): Promise<Record<string, unknown>> {
  let odp: Response;
  try {
    odp = await fetch(`${config.allegro.authUrl}/token?${params}`, {
      method: "POST",
      // User-Agent obowiązkowy wg Allegro także na endpointach auth
      headers: { authorization: basic(), "user-agent": allegroUserAgent() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(
      `Brak połączenia z ${config.allegro.authUrl} — sprawdź internet na serwerze. ` +
        `(${e instanceof Error ? e.message : e})`
    );
  }
  /* Tekstem, nie `odp.json()`: strona blokady ma być rozpoznana ZANIM
     parsowanie wywali się na „<" z HTML-a. */
  const surowa = await odp.text();
  if (czyStronaBlokady(odp.headers.get("content-type"), surowa)) {
    throw new Error(KOMUNIKAT_BLOKADY);
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(surowa) as Record<string, unknown>;
  } catch {
    /* Pusty obiekt znaczy „nie wiem" — rozstrzyga status niżej. */
  }
  if (odp.status === 429) {
    /* Limit na apeksie auth — najgroźniejsze miejsce, bo za tym samym
       edge'em siedzi anti-bot sklepu. Zdanie mówi też co robić: przerwać. */
    const poIluMs = retryAfterMs(odp.headers.get("retry-after"), Date.now());
    throw new BladLimituAllegro(
      "Allegro prosi o przerwę (429) na logowaniu — przerwij i odczekaj" +
        (poIluMs !== null ? ` co najmniej ${Math.ceil(poIluMs / 1000)} s.` : " kilka minut."),
      poIluMs
    );
  }
  if (!odp.ok && typeof json.error !== "string") {
    throw new Error(`Allegro auth odpowiedziało ${odp.status}`);
  }
  return json;
}

/* Single-flight: dwa równoległe żądania biura nie mogą odświeżać naraz —
   drugie użyłoby refresh tokena już zużytego przez pierwsze i oba konta
   skończyłyby rozparowane. Worker Node tokena nie dotyka, więc jedna obietnica
   w procesie API wystarcza. */
let odswiezanie: Promise<string> | null = null;

/**
 * Ważny access token — z odświeżeniem, gdy trzeba.
 * Rzuca zdaniem po polsku, gdy konto niepołączone albo z innego środowiska.
 */
export async function wazneBearer(): Promise<string> {
  const t = wiersz();
  if (!t) {
    throw new Error("Konto Allegro niepołączone — /biuro → STAN SYSTEMU → KONTO ALLEGRO → POŁĄCZ.");
  }
  if (t.srodowisko !== srodowisko()) {
    throw new Error(
      `Token pochodzi ze środowiska ${t.srodowisko}, a konfiguracja wskazuje ${srodowisko()} ` +
        "(ALLEGRO_SANDBOX) — sparuj konto ponownie."
    );
  }
  if (!czyOdswiezyc(t.wygasa_at, Date.now())) return t.access_token;

  if (!odswiezanie) {
    odswiezanie = (async () => {
      try {
        const json = await endpointTokena(
          new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token })
        );
        if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string") {
          /* invalid_grant = refresh token zużyty/wygasły — jedyna droga to
             ponowne parowanie i komunikat ma to mówić wprost. */
          throw new Error(
            "Allegro odmówiło odświeżenia tokena" +
              (typeof json.error === "string" ? ` (${json.error})` : "") +
              " — sparuj konto ponownie: /biuro → STAN SYSTEMU → KONTO ALLEGRO."
          );
        }
        zapisz(
          {
            access: json.access_token,
            refresh: json.refresh_token,
            wygasaMs: (typeof json.expires_in === "number" ? json.expires_in : 43_200) * 1000,
            scope: typeof json.scope === "string" ? json.scope : null,
          },
          "odświeżenie"
        );
        return json.access_token;
      } finally {
        odswiezanie = null;
      }
    })();
  }
  return odswiezanie;
}

// ── Parowanie device flow ───────────────────────────────────────────────────

interface Parowanie {
  deviceCode: string;
  userCode: string;
  link: string;
  /** Bazowy odstęp [ms]: z odpowiedzi Allegro (+ `slow_down`), z podłogą. */
  interwalMs: number;
  /** Od kiedy czekamy — po tym rośnie odstęp (`interwalParowania`). */
  startMs: number;
  wygasaMs: number;
  ostatniPollMs: number;
}

let parowanie: Parowanie | null = null;

export interface StartParowania {
  userCode: string;
  link: string;
  wygasaZaS: number;
}

/** Start parowania: kod dla człowieka + link do potwierdzenia. */
export async function rozpocznijParowanie(): Promise<StartParowania> {
  if (!config.allegro.clientId) {
    throw new Error("Połączenie z Allegro jest wyłączone — ustaw ALLEGRO_CLIENT_ID w wertis.env.");
  }
  /* Powtórne kliknięcie POŁĄCZ oddaje TĘ SAMĄ sesję. Kod z poprzedniej próby
     jest wciąż ważny, a każde `POST /device` to kolejny strzał w apex
     allegro.pl i — po stronie przeglądarki — kolejna równoległa pętla
     odpytywania. Nowy kod DOPIERO po wygaśnięciu sesji: PRZERWIJ w panelu
     jest wyłącznie frontowy (0.106.0) i tej sesji świadomie NIE czyści —
     dodatkowa trasa czyszcząca to dodatkowy ruch bez zysku, bo kod i tak
     wygasa sam. */
  const trwajace = parowanie;
  if (trwajace && Date.now() < trwajace.wygasaMs) {
    return {
      userCode: trwajace.userCode,
      link: trwajace.link,
      wygasaZaS: Math.max(0, Math.round((trwajace.wygasaMs - Date.now()) / 1000)),
    };
  }
  let odp: Response;
  try {
    odp = await fetch(`${config.allegro.authUrl}/device`, {
      method: "POST",
      headers: {
        authorization: basic(),
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": allegroUserAgent(),
      },
      body: new URLSearchParams({ client_id: config.allegro.clientId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(
      `Brak połączenia z ${config.allegro.authUrl} — sprawdź internet na serwerze. ` +
        `(${e instanceof Error ? e.message : e})`
    );
  }
  const surowa = await odp.text();
  /* Blokada anti-bot przychodzi jako HTML z kodem 4xx — rozpoznajemy ją PRZED
     statusem, bo „403" nie mówi nikomu, że to WAF, a nie złe poświadczenia. */
  if (czyStronaBlokady(odp.headers.get("content-type"), surowa)) {
    throw new Error(KOMUNIKAT_BLOKADY);
  }
  if (!odp.ok) {
    throw new Error(
      odp.status === 401
        ? "Allegro odrzuciło poświadczenia aplikacji (401) — sprawdź ALLEGRO_CLIENT_ID/SECRET."
        : `Allegro auth odpowiedziało ${odp.status}.`
    );
  }
  const json = JSON.parse(surowa) as Record<string, unknown>;
  const deviceCode = typeof json.device_code === "string" ? json.device_code : "";
  const userCode = typeof json.user_code === "string" ? json.user_code : "";
  const link =
    typeof json.verification_uri_complete === "string"
      ? json.verification_uri_complete
      : typeof json.verification_uri === "string"
        ? json.verification_uri
        : "";
  if (!deviceCode || !userCode) throw new Error("Odpowiedź Allegro bez device_code/user_code.");
  const expiresS = typeof json.expires_in === "number" ? json.expires_in : 3600;
  parowanie = {
    deviceCode,
    userCode,
    link,
    interwalMs: Math.max(
      (typeof json.interval === "number" ? json.interval : 5) * 1000,
      PODLOGA_PAROWANIA_MS
    ),
    startMs: Date.now(),
    wygasaMs: Date.now() + expiresS * 1000,
    ostatniPollMs: 0,
  };
  return { userCode, link, wygasaZaS: expiresS };
}

export type StanParowania =
  | { stan: "brak" }
  /** `nastepnyPollMs` — kiedy przeglądarka ma wrócić; rytm dyktuje serwer. */
  | { stan: "czekam"; userCode: string; link: string; nastepnyPollMs: number }
  | { stan: "polaczone" }
  | { stan: "odmowa" }
  | { stan: "wygaslo" };

const czekam = (p: Parowanie, zaMs: number): StanParowania => ({
  stan: "czekam",
  userCode: p.userCode,
  link: p.link,
  nastepnyPollMs: Math.max(1000, Math.round(zaMs)),
});

/**
 * Odpytanie stanu parowania. Throttling siedzi TUTAJ, żeby rytm nie zależał
 * od dyscypliny przeglądarki — a od 0.106.0 serwer sam mówi, kiedy wrócić
 * (`nastepnyPollMs`), i z czasem czekania zwalnia.
 */
export async function sprawdzParowanie(autor: string): Promise<StanParowania> {
  const p = parowanie;
  if (!p) return { stan: "brak" };
  if (Date.now() > p.wygasaMs) {
    parowanie = null;
    return { stan: "wygaslo" };
  }
  const odstep = interwalParowania(Date.now() - p.startMs, p.interwalMs);
  const odOstatniego = Date.now() - p.ostatniPollMs;
  if (odOstatniego < odstep) return czekam(p, odstep - odOstatniego);
  p.ostatniPollMs = Date.now();

  const json = await endpointTokena(
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: p.deviceCode,
    })
  );

  if (typeof json.access_token === "string" && typeof json.refresh_token === "string") {
    zapisz(
      {
        access: json.access_token,
        refresh: json.refresh_token,
        wygasaMs: (typeof json.expires_in === "number" ? json.expires_in : 43_200) * 1000,
        scope: typeof json.scope === "string" ? json.scope : null,
      },
      autor
    );
    parowanie = null;
    logEvent("allegro_polaczono", autor, null, { srodowisko: srodowisko() });
    return { stan: "polaczone" };
  }

  const blad = typeof json.error === "string" ? json.error : "";
  if (blad === "authorization_pending") return czekam(p, odstep);
  if (blad === "slow_down") {
    /* Allegro prosi o zwolnienie — baza rośnie na stałe dla tej sesji
       i kumuluje się z naszym własnym zwalnianiem z czasem. */
    p.interwalMs += 5000;
    return czekam(p, interwalParowania(Date.now() - p.startMs, p.interwalMs));
  }
  if (blad === "access_denied") {
    parowanie = null;
    return { stan: "odmowa" };
  }
  parowanie = null;
  return { stan: "wygaslo" };
}

/** Rozłączenie konta — kasuje token; parowanie od nowa w każdej chwili. */
export function rozlacz(autor: string): void {
  db().prepare("DELETE FROM allegro_token WHERE id = 1").run();
  parowanie = null;
  logEvent("allegro_rozlaczono", autor);
}

// ── Stan dla UI i /api/health ───────────────────────────────────────────────

export interface StanPolaczenia {
  /** dev = adapter fikcyjny (demo); wylaczone = brak ALLEGRO_CLIENT_ID. */
  stan: "dev" | "wylaczone" | "niepolaczone" | "zle_srodowisko" | "polaczone";
  srodowisko: string;
  wygasa?: string;
}

export function stanPolaczenia(): StanPolaczenia {
  if (allegroTryb() === "dev") return { stan: "dev", srodowisko: "dev" };
  if (!config.allegro.clientId) return { stan: "wylaczone", srodowisko: srodowisko() };
  const t = wiersz();
  if (!t) return { stan: "niepolaczone", srodowisko: srodowisko() };
  if (t.srodowisko !== srodowisko()) return { stan: "zle_srodowisko", srodowisko: srodowisko() };
  return { stan: "polaczone", srodowisko: srodowisko(), wygasa: t.wygasa_at };
}

/**
 * Zdanie do /api/health albo `null`. Client_id bez sparowanego konta to stan,
 * w którym każdy skan etykiety skończy się błędem — a wygląda jak „zwroty nie
 * działają", nie jak brak parowania.
 */
export function problemAllegro(): string | null {
  const s = stanPolaczenia();
  if (s.stan === "niepolaczone") {
    return (
      "ALLEGRO_CLIENT_ID ustawione, ale konto niepołączone — /biuro → STAN SYSTEMU → " +
      "KONTO ALLEGRO → POŁĄCZ (rola admin)."
    );
  }
  if (s.stan === "zle_srodowisko") {
    return (
      "Token Allegro pochodzi z innego środowiska niż ALLEGRO_SANDBOX wskazuje — " +
      "sparuj konto ponownie w /biuro → STAN SYSTEMU → KONTO ALLEGRO."
    );
  }
  return null;
}

/* ── Dlaczego narzędzie z konsoli nie ma czego czytać (0.153.0) ──────────────
   `npm run sonda` odmawiał jednym zdaniem dla wszystkich pięciu stanów:
   „konto nie jest sparowane — sparuj w panelu". Dwa razy wprowadzało to
   w błąd. Po pierwsze, `dev` NIE ZNACZY braku parowania: w trybie demo nie ma
   czego parować i panel mówi to wprost, więc odesłanie do niego kończyło się
   kartą bez przycisku POŁĄCZ. Po drugie, zdanie prowadziło do zakładki
   REJESTRY, skasowanej w 0.140.0 razem z obsługą klienta — karta KONTO
   ALLEGRO stoi od tamtej pory w STANIE SYSTEMU.

   Prawdziwym powodem bywa przy tym coś trzeciego: proces konsoli nie znalazł
   `wertis.env` i pracuje na domyślnych wartościach, choć usługa obok czyta
   plik i konto ma sparowane. Dlatego zdanie o konfiguracji NAZYWA PLIK, na
   którym ten proces stoi — bez tego jedynym objawem różnicy między procesami
   jest słowo „dev", z którego nikt niczego nie odczyta.                      */

/** Skąd ten proces wziął ustawienia — zdanie doklejane do powodu. */
const zrodloKonfiguracji = (plikEnv: string | null): string =>
  plikEnv === null
    ? "Ten proces nie znalazł wertis.env i pracuje na samych zmiennych środowiskowych — " +
      "usługa czyta plik z katalogu instalacji, więc może widzieć co innego."
    : `Ten proces czyta ustawienia z ${plikEnv}.`;

/**
 * Powód, dla którego narzędzie konsolowe nie dostanie danych z Allegro —
 * zdanie dla człowieka przy klawiaturze, z drogą wyjścia dla KAŻDEGO stanu.
 *
 * Stan `polaczone` jest wykluczony w typie: gdyby wchodził, funkcja musiałaby
 * zmyślać zdanie dla sytuacji, w której nie ma problemu.
 */
export function powodBrakuKonta(
  stan: Exclude<StanPolaczenia["stan"], "polaczone">,
  plikEnv: string | null
): string {
  switch (stan) {
    case "dev":
      return (
        "Tryb dev — połączenia z Allegro nie ma i NIE MA CZEGO PAROWAĆ; panel " +
        "mówi w tym stanie dokładnie to samo. Żywe konto wymaga SGT_MODE=mssql " +
        "albo ALLEGRO_MODE=http w wertis.env. " +
        zrodloKonfiguracji(plikEnv)
      );
    case "wylaczone":
      return (
        "Brak ALLEGRO_CLIENT_ID — połączenie z Allegro jest wyłączone. Poświadczenia " +
        "aplikacji (typ „urządzenie”, developer.allegro.pl) wpisuje się do wertis.env " +
        "razem z ALLEGRO_CLIENT_SECRET. " +
        zrodloKonfiguracji(plikEnv)
      );
    case "niepolaczone":
      return (
        "Konto Allegro niepołączone — sparuj je w panelu: /biuro → STAN SYSTEMU → " +
        "KONTO ALLEGRO → POŁĄCZ (rola admin). " +
        zrodloKonfiguracji(plikEnv)
      );
    case "zle_srodowisko":
      return (
        "Token pochodzi z innego środowiska, niż wskazuje ALLEGRO_SANDBOX — sparuj " +
        "konto ponownie: /biuro → STAN SYSTEMU → KONTO ALLEGRO. " +
        zrodloKonfiguracji(plikEnv)
      );
  }
}

/**
 * Brak własnego nagłówka User-Agent — osobne zdanie do /api/health.
 *
 * Nie doklejamy tego do `problemAllegro()`, bo tamto mówi o STANIE TOKENA,
 * a to o konfiguracji. Allegro wymaga nagłówka wygenerowanego przy
 * rejestracji aplikacji i ostrzega wprost, że jego brak grozi zablokowaniem
 * klucza — a dotąd aplikacja nie mówiła o tym ani słowa, aż do blokady.
 */
export function problemUserAgenta(): string | null {
  if (allegroTryb() !== "http") return null;
  if (config.allegro.userAgent.trim() !== "") return null;
  return (
    "Brak ALLEGRO_USER_AGENT — Allegro wymaga własnego nagłówka i ostrzega, że " +
    "jego brak grozi zablokowaniem klucza. Wygeneruj go na developer.allegro.pl, " +
    "wpisz do wertis.env i zrestartuj wertis-api."
  );
}
