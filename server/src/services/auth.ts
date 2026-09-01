import { randomBytes } from "node:crypto";
import { db, nowIso } from "../db/db.js";
import { logEvent } from "./events.js";
import {
  hashSekret,
  HASLO_MIN,
  haszHasla,
  normalizujLogin,
  setHaslo,
  sprawdzSekret,
  userByLogin,
  userById,
  type Rola,
  type Uzytkownik,
} from "./users.js";

/* ── Sesja urządzenia (plan §7) ─────────────────────────────────────────────
   Login i hasło = zalogowanie. Zmiana osoby przy kolektorze to wylogowanie
   i zalogowanie — nic po cichu.

   SESJA NIE WYGASA SAMA. Trwa do jawnej decyzji człowieka: wylogowania
   z Ustawień. Bezczynność nie robi nic.

   Do sierpnia 2026 sesja blokowała się po 10 minutach bez ruchu, a kolektor
   pokazywał wtedy ekran „Sesja zablokowana". Blokada nigdy nie gubiła pracy,
   ale kosztowała skan przy każdym powrocie do odłożonego kolektora — i to był
   jej całkowity efekt, bo urządzenia nie opuszczają hali.

   Nagłówek `X-User` przestaje być tożsamością. Dało się go wpisać ręcznie,
   więc każdy mógł podać się za kogokolwiek — zostaje najwyżej jako podpowiedź
   dla instalacji, które nie przeszły jeszcze na konta.                       */

export interface Sesja {
  token: string;
  user: Uzytkownik;
}

interface SessionRow {
  token: string;
  user_id: number;
  device_id: string | null;
  last_seen: string;
  revoked_at: string | null;
}

const minut = (od: string, doKiedy = Date.now()): number =>
  (doKiedy - new Date(od).getTime()) / 60000;

/* ── Dławienie prób ─────────────────────────────────────────────────────────
   Plakietka była przedmiotem: żeby jej użyć, trzeba było ją mieć. Hasło się
   zgaduje, a serwer stoi w tej samej sieci co kolektory, więc bez licznika
   jedno urządzenie z pętlą przechodzi cały słownik przez noc.

   Licznik żyje w PAMIĘCI PROCESU, nie w bazie: restart usługi zwalnia blokadę
   i to jest w porządku, bo atak przez restart wymaga dostępu do serwera, czyli
   czegoś znacznie gorszego niż zgadywanie haseł.                             */

const PROG_PROB = 5;
const KARA_MS = 60_000;
const proby = new Map<string, { ile: number; do: number }>();

/** Ile milisekund zostało do końca kary; 0 = można próbować. */
export function karaLogowania(login: string, teraz = Date.now()): number {
  const p = proby.get(normalizujLogin(login));
  return p && p.do > teraz ? p.do - teraz : 0;
}

function odnotujBlad(login: string, teraz = Date.now()): void {
  const k = normalizujLogin(login);
  const p = proby.get(k);
  const ile = p && p.do > teraz - KARA_MS ? p.ile + 1 : 1;
  proby.set(k, { ile, do: ile >= PROG_PROB ? teraz + KARA_MS : teraz });
}

/* Atrapa hasza dla nieistniejącego loginu. Bez niej odpowiedź dla nieznanego
   konta wraca natychmiast, a dla znanego po kilkudziesięciu milisekundach
   scrypta — czyli czas odpowiedzi mówi, które konta istnieją, i cała
   ostrożność w jednym komunikacie błędu idzie na marne. */
const HASZ_ATRAPA = hashSekret(randomBytes(16).toString("hex"));

/** Login i hasło → nowa sesja urządzenia. */
export function zaloguj(login: string, haslo: string, deviceId: string | null): Sesja | null {
  if (karaLogowania(login) > 0) return null;
  const user = userByLogin(login);
  // konto bez hasła nie loguje się nigdy, choćby ktoś zgadł login
  const hash = user ? haszHasla(user.userId) : null;
  const zgadza = sprawdzSekret(haslo ?? "", hash ?? HASZ_ATRAPA);
  if (!user || !hash || !zgadza) {
    odnotujBlad(login);
    logEvent("login_failed", normalizujLogin(login), null, { login: normalizujLogin(login) });
    return null;
  }
  proby.delete(normalizujLogin(login));
  const token = randomBytes(24).toString("hex");
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, user.userId, deviceId, nowIso(), nowIso());
  logEvent("login", user.name, null, { login: user.login, role: user.role });
  return { token, user };
}

/** Zmiana własnego hasła — stare musi się zgadzać, nowe ma minimalną długość. */
export function zmienHaslo(user: Uzytkownik, stare: string, nowe: string): { error?: string } {
  if (!sprawdzSekret(stare, haszHasla(user.userId))) return { error: "Błędne hasło" };
  if ((nowe ?? "").length < HASLO_MIN) {
    return { error: `Nowe hasło musi mieć co najmniej ${HASLO_MIN} znaków` };
  }
  setHaslo(user.userId, nowe);
  logEvent("user_haslo_changed", user.name, null, { userId: user.userId, wlasne: true });
  return {};
}

/** Sesja po tokenie; `null` gdy nie istnieje albo została unieważniona. */
export function sesja(token: string | null): Sesja | null {
  if (!token) return null;
  const r = db()
    .prepare("SELECT * FROM device_session WHERE token = ? AND revoked_at IS NULL")
    .get(token) as SessionRow | undefined;
  if (!r) return null;
  const user = userById(r.user_id);
  if (!user || !user.active) return null;
  return { token, user };
}

/**
 * Odnotowanie aktywności sesji.
 *
 * Od czasu usunięcia blokady po bezczynności `last_seen` NICZEGO NIE BRAMKUJE
 * — jest jedynym śladem, kiedy dany kolektor ostatnio się odezwał, i tyle.
 * Przy awarii pierwsze pytanie brzmi „to jedno urządzenie czy wszystkie?",
 * a bez tego pola nie da się na nie odpowiedzieć.
 *
 * Zapis zostaje DŁAWIONY, bo `dotknij` woła się z każdego żądania, a kolektor
 * odpytuje serwer co 2 s z czterech ekranów. Dokładność minutowa w zupełności
 * wystarcza do diagnozy.
 */
const DLAWIENIE_MS = 60_000;

export function dotknij(token: string): void {
  const r = db().prepare("SELECT last_seen FROM device_session WHERE token = ?").get(token) as
    | { last_seen: string }
    | undefined;
  if (r && minut(r.last_seen) * 60_000 < DLAWIENIE_MS) return;
  db().prepare("UPDATE device_session SET last_seen = ? WHERE token = ?").run(nowIso(), token);
}

/* Przejęcie pracy cudzym badge'em (`przejmij`) wyszło razem z plakietkami
   w 0.20.0. Miało sens, dopóki zmiana osoby kosztowała jeden skan: wtedy warto
   było pytać „przejąć pracę?", zamiast przełączać po cichu. Przy haśle nie ma
   czego przejmować — kto siada do kolektora, ten się loguje, a poprzednik
   wylogowuje. Zdarzenia `session_handover` zostają w audycie jako historia. */

export function wyloguj(token: string): void {
  db().prepare("UPDATE device_session SET revoked_at = ? WHERE token = ?").run(nowIso(), token);
}

/* ── Sesje konta — wgląd i cięcie (0.111.0) ──────────────────────────────────
   `last_seen` było zbierane od zawsze i nigdzie nie pokazywane, a jedyną
   drogą unieważnienia sesji zgubionego kolektora był curl na `:id/active`.
   Karta KONTA I SESJE w panelu czyta stąd; „wyloguj wszędzie" tnie wszystkie
   naraz — sesje się nie kasują (revoked_at, jak przy zwykłym wylogowaniu),
   żeby ślad „co było zalogowane" przetrwał decyzję.                          */

export interface SesjaKonta {
  deviceId: string | null;
  createdAt: string;
  lastSeen: string | null;
}

export function sesjeUzytkownika(userId: number): SesjaKonta[] {
  const rows = db()
    .prepare(
      `SELECT device_id, created_at, last_seen FROM device_session
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY last_seen DESC, created_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    deviceId: (r.device_id as string) ?? null,
    createdAt: r.created_at as string,
    lastSeen: (r.last_seen as string) ?? null,
  }));
}

/** Zwraca liczbę uciętych sesji — panel ma powiedzieć ILE, nie tylko „ok". */
export function wylogujWszedzie(userId: number): number {
  return Number(
    db()
      .prepare("UPDATE device_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .run(nowIso(), userId).changes
  );
}

/* ── Operacje uprzywilejowane ───────────────────────────────────────────────
   Rozstrzyga sama ROLA zalogowanego konta. Do sierpnia 2026 dochodził PIN,
   bo plakietkę dawało się pożyczyć („weź moją, mam ręce w oleju") — hasła się
   nie pożycza tak samo łatwo, więc drugi sekret wyszedł razem z badge'em.

   Cena jest jawna: porzucony zalogowany kolektor pozwala obcej osobie na
   wszystko, co może jego właściciel. Dlatego wylogowanie po zmianie jest
   jedynym zabezpieczeniem, jakie tu zostało.                                 */

/**
 * Operacje zastrzeżone dla ról.
 *
 * Plan §7 wymieniał cztery: korektę zatwierdzonego ruchu, domknięcie dostawy
 * z nierozwiązanymi wyjątkami, zdjęcie cudzej blokady pozycji i zmianę ustawień
 * serwera. Zostały dwie: korekta lokalizacji okazała się ścieżką codzienną, nie
 * wyjątkiem, a blokady pozycji wyszły w 0.47.0 razem z rolą brygadzisty, więc
 * nie ma już czego odbierać. Wartości enuma bez trasy byłyby martwym kodem
 * udającym zabezpieczenie, więc dochodzą razem ze swoimi trasami.
 */
export type OperacjaUprzywilejowana =
  /**
   * Zamknięcie dostawy jako rozłożonej POZA WERTIS (0.40.0).
   *
   * Jedyna operacja w aplikacji, która zdejmuje pracę z listy bez ani jednego
   * skanu — a więc jedyna, którą da się „rozłożyć" całą dostawę, nie ruszając
   * się z krzesła. Dlatego siedzi za rolą i za powodem wpisanym z ręki.
   */
  | "domkniecie_dostawy"
  /** Zakładanie kont magazynierów, migracja historii. */
  | "zarzadzanie_kontami"
  /**
   * Odebranie rozmowy agentowi, który ją prowadzi (0.147.0).
   *
   * Przejęcie wolnej rozmowy robi każdy z biura i to nie jest ta operacja.
   * Ta zdejmuje sprawę komuś Z RĄK — a więc, jak domknięcie dostawy, siedzi
   * za rolą i za powodem wpisanym z ręki. Powód idzie do dziennika razem
   * z wersją rozmowy przed i po; §19 wymienia wymuszone przejęcie osobno.
   */
  | "wymuszone_przekazanie"
  /**
   * To, czego biuru NIE wolno: konta o roli `biuro` albo `admin`, wyłączanie
   * kont i odbieranie haseł.
   *
   * Osobna operacja, bo „zarządzanie kontami" było jedną nazwą na dwie różne
   * rzeczy. Kto zakłada konto biura z własnym hasłem, ten obchodzi każdą regułę
   * wyżej — a do 0.24.0 biuro potrafiło to zrobić samo sobie. To była realna
   * dziura, nie hipoteza: rola strzegąca tożsamości sama sobie tożsamość
   * rozdawała.
   */
  | "zarzadzanie_biurem"
  /**
   * Ukrywanie magazynów na karcie towaru.
   *
   * Osobna operacja, a nie „zarządzanie kontami" pod inną nazwą: wpis
   * `privileged` w audycie niesie nazwę operacji, więc wrzucenie tego do
   * wspólnego worka znaczyłoby, że „biuro zmieniło widoczność magazynów"
   * i „biuro założyło konto" wyglądają w historii identycznie.
   */
  | "widocznosc_magazynow"
  /**
   * Podmiana adresów CAŁEJ listy kartotek z arkusza (0.138.0).
   *
   * Jedyna operacja, która zapisuje do bazy firmy SETKI kartotek jednym
   * kliknięciem — reszta dróg do `tw_Lokalizacja` przestawia jeden towar
   * i wymaga stania przy regale. Pomyłka w kolumnie arkusza rozsypuje adresy
   * całego regału, a jedynym odwrotem jest drugi arkusz z poprzednim stanem.
   * Dlatego admin, a nie biuro: to nie jest praca biurowa, tylko przebudowa
   * magazynu wykonana z zewnątrz.
   */
  | "masowa_lokalizacja";

/**
 * Kto może.
 *
 * Zakładanie kont tworzy TOŻSAMOŚĆ, więc hala go nie dotyka: magazynier, który
 * może założyć konto, może założyć konto biura z własnym hasłem — i cała reszta
 * reguł przestaje cokolwiek znaczyć. Ten sam argument obowiązuje o piętro
 * wyżej i stąd `zarzadzanie_biurem` wyłącznie dla admina.
 *
 * Admin NIE dostaje audytu ani raportu wydajności JAKO UPRAWNIENIA PONAD
 * biuro — dostaje dokładnie tyle, co biuro, żeby konto z instalatora nadawało
 * się do pracy. Rozróżnienie jest nieoczywiste i dlatego zapisane: admin jest
 * rolą wąską, od kont, a raport o pracy ludzi zostaje tam, gdzie był.
 */
const WYMAGANA_ROLA: Record<OperacjaUprzywilejowana, readonly Rola[]> = {
  /* ORZEKA, że dostawy nie trzeba rozkładać — a takie orzeczenie należy do tej
     roli, która czyta protokoły rozbieżności i odpowiada za zgodność
     z dokumentem, nie do człowieka przy palecie. */
  domkniecie_dostawy: ["biuro", "admin"],
  zarzadzanie_kontami: ["biuro", "admin"],
  /* §5 projektu panelu daje wymuszone przekazanie administratorowi. Biuro
     prowadzi własne rozmowy; odbieranie cudzych to inna decyzja. */
  wymuszone_przekazanie: ["admin"],
  zarzadzanie_biurem: ["admin"],
  // widoczność magazynów jest wspólna dla wszystkich kolektorów, więc ustawia
  // ją ta sama rola, która odpowiada za konfigurację — nie pojedynczy magazynier
  widocznosc_magazynow: ["biuro", "admin"],
  // Setki kartotek jednym kliknięciem — patrz uzasadnienie przy nazwie operacji.
  masowa_lokalizacja: ["admin"],
};

const NAZWA_ROL: Record<Rola, string> = {
  magazynier: "magazyniera",
  biuro: "biura",
  admin: "administratora",
};

export interface WynikAutoryzacji {
  ok: boolean;
  powod?: string;
}

/** Czy ta osoba może wykonać operację uprzywilejowaną. */
export function autoryzuj(
  user: Uzytkownik,
  operacja: OperacjaUprzywilejowana
): WynikAutoryzacji {
  const dozwolone = WYMAGANA_ROLA[operacja];
  if (!dozwolone.includes(user.role)) {
    const kto = dozwolone.map((r) => NAZWA_ROL[r]).join(" albo ");
    return { ok: false, powod: `Operacja „${operacja}" wymaga uprawnień ${kto}` };
  }
  logEvent("privileged", user.name, null, { operacja });
  return { ok: true };
}
