import { AsyncLocalStorage } from "node:async_hooks";
import { odnotujRuch } from "./services/ruch.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SeededSubiektAdapter } from "./adapters/subiekt.seeded.js";
import { userById } from "./services/users.js";

/** Współdzielony adapter odczytu (Subiekt). Zapis idzie przez kolejkę/worker. */
export const subiekt = new SeededSubiektAdapter();

function header(req: FastifyRequest, name: string): string | null {
  const h = req.headers[name];
  const val = Array.isArray(h) ? h[0] : h;
  return (val && String(val).trim()) || null;
}

/**
 * Kto wykonuje operację.
 *
 * Pierwszeństwo ma SESJA zweryfikowana przez serwer. Nagłówek `X-User` jest
 * wyłącznie podpowiedzią — dało się go wpisać ręcznie, więc nie jest
 * dowodem tożsamości, tylko deklaracją.
 */
export function userOf(req: FastifyRequest): string {
  return currentUserName() ?? dekodujNazwe(header(req, "x-user")) ?? "anonim";
}

/**
 * Nazwa z nagłówka — kodowana procentowo.
 *
 * Kolektor musi ją kodować, bo OkHttp odmawia wysłania nagłówka z jakimkolwiek
 * znakiem spoza ` `–`~` i robi to WYJĄTKIEM. Kodowanie procentowe UTF-8 wybrano zamiast okrajania
 * ogonków, bo ta wartość ląduje w `events.user_id`, czyli w dzienniku audytu.
 *
 * Trzy rzeczy, których to celowo NIE robi:
 *
 * 1. Nie dekoduje wszystkiego w `header()` — ten czyta też `x-session`
 *    i `x-device`, których nikt nie koduje, a hurtowe dekodowanie procentów
 *    tworzyłoby nową klasę niespodzianek.
 * 2. Nie wywraca żądania przy uszkodzonej sekwencji (`%zz` to `URIError`),
 *    bo wartość przychodzi z zewnątrz.
 * 3. Nie wymaga kodowania: stara nazwa ASCII nie zawiera procentu, więc
 *    przechodzi tędy bez zmian. Starszy APK działa z nowym serwerem.
 */
function dekodujNazwe(surowa: string | null): string | null {
  if (surowa == null || !surowa.includes("%")) return surowa;
  try {
    return decodeURIComponent(surowa);
  } catch {
    return surowa;
  }
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
  /** Sesja rozpoznana przez bramkę — JEDNO rozpoznanie na żądanie. */
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
   Bramka jest tutaj, a nie w każdej trasie z osobna, bo trasa dopisana jutro
   ma być domyślnie zamknięta, nie domyślnie otwarta.                        */

/**
 * Trasy działające bez sesji. Lista jest jawna, krótka i zamknięta.
 *
 * Reguła wpuszczenia brzmi: BEZ TEJ TRASY KOLEKTORA NIE DA SIĘ DOPROWADZIĆ DO
 * STANU, W KTÓRYM DA SIĘ ZALOGOWAĆ: pierwsze uruchomienie instalacji
 * i aktualizacja kolektora.
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
  /* Aktualizacja kolektora — jedyne pozycje NIE dotyczące uruchomienia
     instalacji. Powód jest inny i równie twardy: kolektor pyta o nową wersję
     przy otwarciu aplikacji, więc także wtedy, gdy sesji nie ma. Bez tego
     urządzenie z zepsutą albo przestarzałą aplikacją da się naprawić dopiero
     po zalogowaniu, czyli po użyciu tego, co właśnie nie działa. */
  ["GET", "/api/aktualizacja"],
  ["GET", "/api/aktualizacja/apk"],
];

const otwarta = (metoda: string, sciezka: string): boolean =>
  BEZ_SESJI.some(([m, s]) => m === metoda && s === sciezka);

/**
 * Odczyty, których 404 nie idzie do audytu.
 *
 * Wpisuje się tu trasa spełniająca OBA warunki naraz: kolektor pyta o nią
 * z częstotliwością rysowania ekranu, a odpowiedź „nie ma" jest normalna.
 * Sam brak czegoś nie wystarcza — inaczej lista zjadłaby cały audyt odrzuceń.
 */
const BEZ_AUDYTU_404: ReadonlyArray<RegExp> = [
  /^\/api\/products\/\d+\/zdjecie$/,
  // Logo dostawcy — ten sam profil: wiersz listy dostaw pyta o nie
  // przy każdym rysowaniu, a większość dostawców logo nie ma i mieć nie musi.
  /^\/api\/dostawcy\/\d+\/logo$/,
];

const odczytBezAudytu = (sciezka: string): boolean =>
  BEZ_AUDYTU_404.some((wzorzec) => wzorzec.test(sciezka));

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
      /* Zapis z sesją to „ktoś pracuje" — aktualizacja nocna na niego czeka. */
      if (req.method !== "GET" && req.method !== "HEAD") odnotujRuch();
    }

    // Bramka dotyczy tylko API; serwer nie serwuje niczego innego, ale ta
    // jedna linia sprawia, że nie zacznie od odrzucania własnych statyk,
    // gdyby kiedyś wróciły.
    const sciezka = req.url.split("?")[0];
    if (!sciezka.startsWith("/api/")) return;
    if (otwarta(req.method, sciezka)) return;

    if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  });

  /* ── Odrzucone żądania ────────────────────────────────────────────────────
     „Skanowałem i się nie zapisało" ma zostawić ślad po stronie serwera:
     400 za limit pola, zły kod półki czy nieznany towar.

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

    /* To samo przy miniaturach: kolektor pyta o zdjęcie KAŻDEGO rysowanego
       wiersza, a instalacja bez `ZDJECIA_*` odpowiada 404 za każdym razem.

       Brak zdjęcia jest ODPOWIEDZIĄ, nie odmową: nikomu niczego nie odebrano,
       więc nie ma czego dochodzić w reklamacji. Lista jest wąska i jawna —
       404 na każdej innej trasie zostaje w audycie, bo tam znaczy „pytałeś
       o coś, czego nie ma", a to bywa tropem.                                */
    if (reply.statusCode === 404 && req.method === "GET" && odczytBezAudytu(sciezka)) {
      return payload;
    }

    const { logEvent } = await import("./services/events.js");
    logEvent("http_rejected", currentUserName() ?? "anonim", null, {
      metoda: req.method,
      sciezka: sciezkaDoAudytu(req, sciezka),
      status: reply.statusCode,
      /* WYŁĄCZNIE powód z odpowiedzi. Ciała ŻĄDANIA nie zapisujemy nigdy i to
         jest zasada, nie przeoczenie: przez logowanie przechodzi hasło, a log
         audytowy, który wycieka hasła, jest gorszy od jego braku. */
      powod: powodOdrzucenia(payload),
    });
    return payload;
  });
}

/**
 * Ścieżka do wpisu odrzucenia — pod profilem klienta WZORZEC TRASY, nie adres.
 *
 * Adres `/api/obsluga/klient/<login>/…` niesie login kupującego, a `events`
 * nie ma retencji. Sprawa klienta pilnuje, żeby jej zdarzenia niosły numer
 * sprawy zamiast loginu, a adres z loginem w odrzuceniu zniweczyłby to.
 *
 * Tylko ten przedrostek: gdzie indziej adres niesie nasze numery, a te są
 * tropem przy reklamacji odrzuconego skanu. Bez dopasowanej trasy (404
 * Fastify) wzorca nie ma, więc zostaje stały napis zamiast adresu.
 */
function sciezkaDoAudytu(req: FastifyRequest, sciezka: string): string {
  if (!sciezka.startsWith("/api/obsluga/klient/")) return sciezka;
  return req.routeOptions.url ?? "/api/obsluga/klient/*";
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

