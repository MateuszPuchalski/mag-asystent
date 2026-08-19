import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { allegroTryb, allegroUserAgent } from "../adapters/allegro.js";
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
  const json = (await odp.json().catch(() => ({}))) as Record<string, unknown>;
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
    throw new Error("Konto Allegro niepołączone — /biuro → ZWROTY → KONTO ALLEGRO → POŁĄCZ.");
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
              " — sparuj konto ponownie: /biuro → ZWROTY → KONTO ALLEGRO."
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
  /** Minimalny odstęp między odpytaniami [ms] — z odpowiedzi Allegro. */
  interwalMs: number;
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
    throw new Error("Zwroty Allegro są wyłączone — ustaw ALLEGRO_CLIENT_ID w wertis.env.");
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
  if (!odp.ok) {
    throw new Error(
      odp.status === 401
        ? "Allegro odrzuciło poświadczenia aplikacji (401) — sprawdź ALLEGRO_CLIENT_ID/SECRET."
        : `Allegro auth odpowiedziało ${odp.status}.`
    );
  }
  const json = (await odp.json()) as Record<string, unknown>;
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
    interwalMs: (typeof json.interval === "number" ? json.interval : 5) * 1000,
    wygasaMs: Date.now() + expiresS * 1000,
    ostatniPollMs: 0,
  };
  return { userCode, link, wygasaZaS: expiresS };
}

export type StanParowania =
  | { stan: "brak" }
  | { stan: "czekam"; userCode: string; link: string }
  | { stan: "polaczone" }
  | { stan: "odmowa" }
  | { stan: "wygaslo" };

/**
 * Odpytanie stanu parowania. Front może pytać co 2–3 s jak wszędzie w /biuro —
 * throttling do `interval` Allegro siedzi TUTAJ, żeby limit nie zależał od
 * dyscypliny przeglądarki.
 */
export async function sprawdzParowanie(autor: string): Promise<StanParowania> {
  const p = parowanie;
  if (!p) return { stan: "brak" };
  if (Date.now() > p.wygasaMs) {
    parowanie = null;
    return { stan: "wygaslo" };
  }
  if (Date.now() - p.ostatniPollMs < p.interwalMs) {
    return { stan: "czekam", userCode: p.userCode, link: p.link };
  }
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
  if (blad === "authorization_pending") return { stan: "czekam", userCode: p.userCode, link: p.link };
  if (blad === "slow_down") {
    p.interwalMs += 5000;
    return { stan: "czekam", userCode: p.userCode, link: p.link };
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
      "ALLEGRO_CLIENT_ID ustawione, ale konto niepołączone — /biuro → ZWROTY → " +
      "KONTO ALLEGRO → POŁĄCZ (rola admin)."
    );
  }
  if (s.stan === "zle_srodowisko") {
    return (
      "Token Allegro pochodzi z innego środowiska niż ALLEGRO_SANDBOX wskazuje — " +
      "sparuj konto ponownie w /biuro → ZWROTY → KONTO ALLEGRO."
    );
  }
  return null;
}
