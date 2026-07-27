import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
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
}

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

/* ── Bramka sesji ───────────────────────────────────────────────────────────
   Do tej pory token był ROZPOZNAWANY, ale nie WYMAGANY: sesji żądały trzy
   miejsca (logowanie, `/api/users`, zdjęcie cudzego locka), a cała reszta —
   w tym zmiana lokalizacji w Subiekcie i raport wydajności per pracownik —
   przechodziła bez niczego, podpisując operację nagłówkiem `x-user` albo
   słowem „anonim". Bramka jest tutaj, a nie w każdej trasie z osobna, bo
   trasa dopisana jutro ma być domyślnie zamknięta, nie domyślnie otwarta.  */

/** Metody zmieniające stan. GET i HEAD tylko czytają. */
const zapis = (metoda: string): boolean => !["GET", "HEAD", "OPTIONS"].includes(metoda);

/**
 * Trasy działające bez sesji. Lista jest jawna, krótka i zamknięta — każda
 * pozycja jest tu dlatego, że BEZ NIEJ NIE DA SIĘ URUCHOMIĆ INSTALACJI.
 *
 * `POST /api/users` wygląda na wyłom, ale nim nie jest: trasa sama wpuszcza
 * bez sesji wyłącznie przy pustej bazie (pierwsze konto biura), a w każdym
 * innym przypadku sprawdza sesję i PIN. Bramka nie ma czego dokładać.
 */
const BEZ_SESJI: ReadonlyArray<[metoda: string, sciezka: string]> = [
  ["GET", "/api/health"],
  ["GET", "/api/setup"],
  ["POST", "/api/auth/badge"],
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

    if (s) {
      setCurrentUser(s.user.userId, s.user.name);
      if (!s.zablokowana) dotknij(t!);
    }

    // Bramka dotyczy tylko API; serwer nie serwuje niczego innego, ale ta
    // jedna linia sprawia, że nie zacznie od odrzucania własnych statyk,
    // gdyby kiedyś wróciły.
    const sciezka = req.url.split("?")[0];
    if (!sciezka.startsWith("/api/")) return;
    if (otwarta(req.method, sciezka)) return;

    if (!s) {
      return reply.code(401).send({ error: "Brak sesji — zeskanuj badge" });
    }

    /* Sesja zablokowana po bezczynności NIE jest wylogowaniem (§7): zachowuje
       otwartą dostawę i kontekst, żeby nie zgubić trzydziestu rozłożonych
       pozycji. Odczyty przechodzą, bo z nich składa się ekran blokady.

       Zapis wymaga odblokowania — Z JEDNYM WYJĄTKIEM, i ten wyjątek jest
       konieczny, nie wygodny. Kolektor opróżnia bufor offline z tykera co 15 s,
       niezależnie od tego, czy ktoś trzyma urządzenie w ręku. Gdyby wysyłka
       z zablokowanej sesji dostawała odmowę, `OfflineQueue.flush()` uznałby ją
       za błąd serwera i SKASOWAŁ operację z bufora — praca wykonana poza
       zasięgiem znikałaby po dziesięciu minutach leżenia kolektora na regale.

       Rozróżnia je `x-buffered-user`: niesie konto autora Z CHWILI WYKONANIA
       i jest przyjmowany tylko, gdy wskazuje istniejące konto (`autorOperacji`).
       Operacja interaktywna go nie ma, więc dalej wymaga skanu badge'a.       */
    if (s.zablokowana && zapis(req.method) && !zBufora(req)) {
      return reply.code(423).send({ error: "Sesja zablokowana — zeskanuj badge" });
    }
  });
}

/** Czy żądanie niesie operację z bufora offline wskazującą istniejące konto. */
function zBufora(req: FastifyRequest): boolean {
  const id = Number(header(req, "x-buffered-user"));
  return Number.isInteger(id) && id > 0 && userById(id) !== null;
}

