import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { makeSubiektAdapter } from "./adapters/index.js";
import { userById } from "./services/users.js";

/** Współdzielony adapter odczytu (Subiekt). Zapis idzie przez kolejkę/worker. */
export const subiekt = makeSubiektAdapter();

function header(req: FastifyRequest, name: string): string | null {
  const h = req.headers[name];
  const val = Array.isArray(h) ? h[0] : h;
  return (val && String(val).trim()) || null;
}

/**
 * Kto wykonuje operację.
 *
 * Pierwszeństwo ma SESJA (skan badge'a zweryfikowany przez serwer). Nagłówek
 * `X-User` zostaje wyłącznie jako podpowiedź dla instalacji, które nie przeszły
 * jeszcze na badge'y — bo dało się go wpisać ręcznie, więc nigdy nie był
 * dowodem tożsamości, tylko deklaracją.
 */
export function userOf(req: FastifyRequest): string {
  return currentUserName() ?? header(req, "x-user") ?? "anonim";
}

export interface Autor {
  /** Do `events.user_id` — tekstowy snapshot. */
  nazwa: string;
  /** Do `events.user_ref`; `null` gdy nie da się wskazać konta. */
  ref: number | null;
  /** Sesja, która FIZYCZNIE wysłała żądanie, gdy to nie ta sama osoba. */
  wyslanePrzez: string | null;
}

/**
 * Autor operacji z uwzględnieniem BUFORA OFFLINE.
 *
 * Bufor przechowuje operacje wykonane bez zasięgu i wysyła je później — czasem
 * po zmianie zmiany. Gdyby autorem był zawsze właściciel bieżącej sesji,
 * dwanaście pozycji odłożonych przez Jana poza zasięgiem dostałoby nazwisko
 * Piotra, który akurat przejął kolektor. To jest dokładnie ta cicha podmiana
 * tożsamości, przed którą broni jawne przejęcie pracy — tylko wejściem od tyłu.
 *
 * Dlatego autor jest z chwili WYKONANIA (`x-buffered-user`, id konta), a fakt
 * wysyłki przez kogoś innego zostaje w payloadzie zdarzenia. Audyt widzi obie
 * osoby, bo obie naprawdę brały udział.
 *
 * Nagłówek jest przyjmowany tylko, gdy wskazuje ISTNIEJĄCE konto — inaczej
 * byłby to powrót do „podaj się za kogo chcesz" z §7.
 */
export function autorOperacji(req: FastifyRequest): Autor {
  const sesyjny = currentUserName();
  const buforowany = Number(header(req, "x-buffered-user"));
  if (Number.isInteger(buforowany) && buforowany > 0) {
    const u = userById(buforowany);
    if (u) {
      return {
        nazwa: u.name,
        ref: u.userId,
        wyslanePrzez: sesyjny && sesyjny !== u.name ? sesyjny : null,
      };
    }
  }
  return { nazwa: userOf(req), ref: currentUserRef(), wyslanePrzez: null };
}

/* ── Kontekst żądania ───────────────────────────────────────────────────────
   `device_id` jest polem DIAGNOSTYCZNYM: przy współdzielonych kolektorach
   pierwsze pytanie przy awarii brzmi „to jedno urządzenie czy wszystkie?",
   a bez zapisu nie da się na nie odpowiedzieć po fakcie.

   Przeciągnięcie go przez ~24 wywołania `logEvent` — w tym przez warstwę
   usług, które o żądaniu nic nie wiedzą — kosztowałoby więcej niż wnosi.
   Dlatego kontekst żyje w AsyncLocalStorage: hook ustawia go raz na żądanie,
   a `logEvent` po prostu go widzi. Poza żądaniem (worker) jest pusty i to
   jest poprawna odpowiedź, nie brak danych.                                  */

interface ReqCtx {
  device: string | null;
  /** Token sesji urządzenia — tożsamość rozstrzyga serwer, nie nagłówek. */
  token: string | null;
  /** Konto ustalone z tokenu; wypełniane leniwie, żeby nie pytać bazy bez potrzeby. */
  userRef?: number | null;
  userName?: string | null;
  /**
   * Sesja rozpoznana przez bramkę — JEDNO rozpoznanie na żądanie.
   *
   * Do 0.23.0 trasy pytające o rolę wołały `sesja(currentToken())` same, każda
   * po swojemu (`sesja(token())`, `sesja(currentToken() ?? "")`). Bramka
   * rozpoznawała sesję chwilę wcześniej i wynik wyrzucała, więc to samo
   * zapytanie do bazy szło dwa razy na żądanie — a „kto pyta" miało osiem
   * niezależnych odpowiedzi zamiast jednej.
   */
  sesja?: SesjaZadania | null;
}

/** Kształt sesji widziany przez trasy; import TYPU, więc nie zamyka cyklu. */
type SesjaZadania = import("./services/auth.js").Sesja;

const store = new AsyncLocalStorage<ReqCtx>();

/** Urządzenie bieżącego żądania; null poza żądaniem albo bez nagłówka. */
export const currentDevice = (): string | null => store.getStore()?.device ?? null;

/** Token sesji bieżącego żądania. */
export const currentToken = (): string | null => store.getStore()?.token ?? null;

/** Konto z sesji — `logEvent` wpisuje je do `events.user_ref`. */
export const currentUserRef = (): number | null => store.getStore()?.userRef ?? null;

/** Ustawiane przez hook uwierzytelnienia po rozpoznaniu tokenu. */
export function setCurrentUser(userId: number, name: string): void {
  const ctx = store.getStore();
  if (ctx) {
    ctx.userRef = userId;
    ctx.userName = name;
  }
}

/** Nazwa z sesji, gdy jest — inaczej nagłówek `X-User` jako podpowiedź. */
export const currentUserName = (): string | null => store.getStore()?.userName ?? null;

/**
 * Sesja bieżącego żądania, rozpoznana raz przez bramkę.
 *
 * Trasy sprawdzające rolę pytają TUTAJ, a nie bazy: bramka i tak musi
 * rozpoznać sesję, żeby zdecydować o 401, więc drugie zapytanie niczego nie
 * ustala, a otwiera możliwość, że dwa miejsca odpowiedzą inaczej na to samo
 * pytanie. Poza żądaniem (worker) `null` i to jest poprawna odpowiedź.
 */
export const sesjaZadania = (): SesjaZadania | null => store.getStore()?.sesja ?? null;

/* ── Bramka sesji ───────────────────────────────────────────────────────────
   Do tej pory token był ROZPOZNAWANY, ale nie WYMAGANY: sesji żądały trzy
   miejsca (logowanie, `/api/users`, zdjęcie cudzego locka), a cała reszta —
   w tym zmiana lokalizacji w Subiekcie i raport wydajności per pracownik —
   przechodziła bez niczego, podpisując operację nagłówkiem `x-user` albo
   słowem „anonim". Bramka jest tutaj, a nie w każdej trasie z osobna, bo
   trasa dopisana jutro ma być domyślnie zamknięta, nie domyślnie otwarta.  */

/**
 * Trasy działające bez sesji. Lista jest jawna, krótka i zamknięta — każda
 * pozycja jest tu dlatego, że BEZ NIEJ NIE DA SIĘ URUCHOMIĆ INSTALACJI.
 *
 * `POST /api/users` wygląda na wyłom, ale nim nie jest: trasa sama wpuszcza
 * bez sesji wyłącznie przy pustej bazie (pierwsze konto biura), a w każdym
 * innym przypadku sprawdza sesję i rolę. Bramka nie ma czego dokładać.
 */
const BEZ_SESJI: ReadonlyArray<[metoda: string, sciezka: string]> = [
  ["GET", "/api/health"],
  ["GET", "/api/setup"],
  ["POST", "/api/auth/login"],
  ["POST", "/api/users"],
];

const otwarta = (metoda: string, sciezka: string): boolean =>
  BEZ_SESJI.some(([m, s]) => m === metoda && s === sciezka);

export function withRequestContext(app: FastifyInstance): void {
  app.addHook("onRequest", (req, _reply, done) => {
    store.run({ device: header(req, "x-device"), token: header(req, "x-session") }, done);
  });
  // Rozpoznanie sesji osobnym hookiem, PO ustawieniu kontekstu: dopiero tu
  // wolno dotknąć bazy, a `services/auth` importuje `context`, więc import
  // musi być leniwy (inaczej cykl).
  app.addHook("preHandler", async (req, reply) => {
    const t = currentToken();
    const { sesja, dotknij } = await import("./services/auth.js");
    const s = t ? sesja(t) : null;

    const ctx = store.getStore();
    if (ctx) ctx.sesja = s;

    if (s) {
      setCurrentUser(s.user.userId, s.user.name);
      dotknij(t!);
    }

    // Bramka dotyczy tylko API; serwer nie serwuje niczego innego, ale ta
    // jedna linia sprawia, że nie zacznie od odrzucania własnych statyk,
    // gdyby kiedyś wróciły.
    const sciezka = req.url.split("?")[0];
    if (!sciezka.startsWith("/api/")) return;
    if (otwarta(req.method, sciezka)) return;

    /* Sesja albo jest, albo jej nie ma — trzeciego stanu nie ma od sierpnia
       2026. Wcześniej bezczynność dłuższa niż 10 minut przełączała sesję
       w `zablokowana`, a zapis z niej dostawał 423, żeby wymusić skan badge'a.
       Razem z ekranem blokady zniknęła i ta bramka. */
    if (!s) {
      /* TRYB SERWISOWY. Brak sesji przestaje znaczyć „odmowa" i zaczyna znaczyć
         „konto serwisowe" — ale TYLKO tutaj, w jednym miejscu, i tylko przy
         jawnym `WERTIS_ADMIN=1`. Bramka zostaje domyślnie zamknięta: trasa
         dopisana jutro dziedziczy to zachowanie razem z 401, bez pamiętania
         o nim.

         Sesja ma pierwszeństwo (gałąź wyżej), więc zalogowany człowiek dalej
         podpisuje pracę swoim nazwiskiem, nie ADMIN-em. */
      if (config.trybSerwisowy) {
        const { kontoSerwisowe } = await import("./services/tryb-serwisowy.js");
        const u = kontoSerwisowe();
        setCurrentUser(u.userId, u.name);
        /* Sesja UDAWANA, nie zapisana. Trasy sprawdzające rolę pytają
           `sesjaZadania()`, więc bez tej linii tryb serwisowy wpuszczałby do
           odczytów, a odbijał od zarządzania kontami i audytu — czyli od tego,
           po co powstał.

           Token jest pusty i nic nie trafia do `device_session`: gdyby trafiło,
           powstałby artefakt PRZEŻYWAJĄCY wyłączenie flagi, czyli trwała tylna
           furtka. Tak wyłączenie odbiera dostęp natychmiast. */
        if (ctx) ctx.sesja = { token: "", user: u };
        return;
      }
      return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
    }
  });

  /* ── Odrzucone żądania ────────────────────────────────────────────────────
     „Skanowałem i się nie zapisało" nie zostawiało po stronie serwera ŻADNEGO
     śladu: 400 za przekroczony limit pola, zły kod półki czy nieznany towar
     wracały do kolektora i znikały. Reklamację dało się wtedy zbyć zdaniem
     „nie widzę takiej operacji" — co jest prawdą i jednocześnie nieprawdą.

     Hook jest `onSend`, nie `onResponse`, bo tam ciała odpowiedzi już nie ma,
     a wpis bez POWODU odrzucenia nie odpowiada na żadne pytanie.             */
  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode < 400) return payload;
    const sciezka = req.url.split("?")[0];
    if (!sciezka.startsWith("/api/")) return payload;

    /* Wygasła sesja przy odpytywaniu karty co 2 s dałaby 30 wierszy na minutę
       z każdego kolektora i utopiła resztę audytu w szumie. Odczyt bez sesji
       jest nudny; PRÓBA ZAPISU bez sesji już nie — i ta zostaje logowana. */
    if (reply.statusCode === 401 && req.method === "GET") return payload;

    const { logEvent } = await import("./services/events.js");
    logEvent("http_rejected", currentUserName() ?? "anonim", null, {
      metoda: req.method,
      sciezka,
      status: reply.statusCode,
      /* WYŁĄCZNIE powód z odpowiedzi. Ciała ŻĄDANIA nie zapisujemy nigdy i to
         jest zasada, nie przeoczenie: przez `POST /api/auth/pin` przechodzi
         PIN, a log audytowy, który wycieka PIN-y, jest gorszy od jego braku. */
      powod: powodOdrzucenia(payload),
    });
    return payload;
  });
}

/** Komunikat błędu z ciała odpowiedzi; `null`, gdy odpowiedź go nie niesie. */
function powodOdrzucenia(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  try {
    const b = JSON.parse(payload) as { error?: unknown };
    return typeof b.error === "string" ? b.error.slice(0, 300) : null;
  } catch {
    return null; // nie-JSON (np. odpowiedź Fastify na 404 trasy) — powodu brak
  }
}

