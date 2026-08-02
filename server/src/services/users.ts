import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db/db.js";

/* ── Konta pracowników (plan §7) ────────────────────────────────────────────
   Dotąd tożsamością był dowolny łańcuch wpisany na kolektorze i wysłany
   w nagłówku `X-User`. Trzy skutki, wszystkie realne:
     • `events.user_id` zbiera warianty tej samej osoby (Jan, jan, Jan K),
       więc audyt nadaje się do czytania oczami i do niczego więcej,
     • każdy może podać się za kogokolwiek jednym wpisem,
     • firma chce kont imiennych — czego ten model nie realizuje.

   Wejściem jest LOGIN I HASŁO. Do sierpnia 2026 był nim skan plakietki
   `PRC-0007-3` — jedna sekunda zamiast wpisywania, ale własny, osobny wzorzec
   w firmie, która wszędzie indziej loguje się loginem i hasłem.              */

export type Rola = "magazynier" | "brygadzista" | "biuro";

export interface Uzytkownik {
  userId: number;
  /** `null` = konto-ślad: audyt ma na co wskazywać, zalogować się nie da. */
  login: string | null;
  name: string;
  role: Rola;
  active: boolean;
  /** Czy konto ma ustawione hasło — samego hasza nigdy nie wystawiamy. */
  maHaslo: boolean;
}

interface UserRow {
  user_id: number;
  login: string | null;
  haslo_hash: string | null;
  name: string;
  role: string;
  active: number;
}

const widok = (r: UserRow): Uzytkownik => ({
  userId: r.user_id,
  login: r.login,
  name: r.name,
  role: r.role as Rola,
  active: r.active === 1,
  maHaslo: !!r.haslo_hash,
});

/* ── Login ──────────────────────────────────────────────────────────────────
   Wpisuje go biuro, więc kształt jest wąski celowo: login ma być czymś, co da
   się bez pomyłki podyktować przez halę i wpisać w rękawicach. Wielkość liter
   nie rozróżnia — „Kowalski" i „kowalski" to jedno konto, inaczej dwie osoby
   z tym samym loginem byłyby jednym żądaniem od pomyłki.                     */

const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Postać kanoniczna loginu — TA SAMA przy zapisie i przy szukaniu. */
export const normalizujLogin = (raw: string): string => (raw ?? "").trim().toLowerCase();

export const poprawnyLogin = (raw: string): boolean => LOGIN_RE.test(normalizujLogin(raw));

/** Minimalna długość hasła. Długość chroni lepiej niż wymuszona wielka litera. */
export const HASLO_MIN = 8;

/* ── Sekrety ────────────────────────────────────────────────────────────────
   scrypt z solą per konto. Hasło bywa krótkie i słownikowe, bo wpisuje się je
   w rękawicach, więc funkcja MUSI być kosztowna — inaczej wyciek bazy oznacza
   natychmiastowe odtworzenie wszystkich haseł.                               */

export function hashSekret(sekret: string): string {
  const sol = randomBytes(16);
  return `${sol.toString("hex")}:${scryptSync(sekret, sol, 32).toString("hex")}`;
}

export function sprawdzSekret(sekret: string, hash: string | null): boolean {
  if (!hash) return false;
  const [solHex, oczekiwany] = hash.split(":");
  if (!solHex || !oczekiwany) return false;
  const wyliczony = scryptSync(sekret, Buffer.from(solHex, "hex"), 32);
  const bufOczekiwany = Buffer.from(oczekiwany, "hex");
  // porównanie stałoczasowe — inaczej czas odpowiedzi zdradza prefiks hasła
  return (
    wyliczony.length === bufOczekiwany.length && timingSafeEqual(wyliczony, bufOczekiwany)
  );
}

/* ── Konta ──────────────────────────────────────────────────────────────── */

export function listUsers(): Uzytkownik[] {
  return (db().prepare("SELECT * FROM app_user ORDER BY name").all() as unknown as UserRow[]).map(widok);
}

/** Konto po loginie — wyłącznie czynne i wyłącznie takie, które ma hasło. */
export function userByLogin(login: string): Uzytkownik | null {
  const r = db()
    .prepare("SELECT * FROM app_user WHERE login = ? AND active = 1")
    .get(normalizujLogin(login)) as UserRow | undefined;
  return r ? widok(r) : null;
}

export function userById(userId: number): Uzytkownik | null {
  const r = db().prepare("SELECT * FROM app_user WHERE user_id = ?").get(userId) as
    | UserRow
    | undefined;
  return r ? widok(r) : null;
}

/** Hasz hasła do porównania — nigdy nie wychodzi poza warstwę serwisów. */
export function haszHasla(userId: number): string | null {
  const r = db().prepare("SELECT haslo_hash FROM app_user WHERE user_id = ?").get(userId) as
    | { haslo_hash: string | null }
    | undefined;
  return r?.haslo_hash ?? null;
}

/**
 * Nowe konto.
 *
 * `login` i `haslo` są opcjonalne, bo konto-ślad z migracji historii nie ma
 * ani jednego, ani drugiego — i nie ma mieć. Konto bez hasła nie zaloguje się
 * nigdy, choćby ktoś zgadł login.
 */
export function createUser(
  name: string,
  role: Rola = "magazynier",
  login?: string | null,
  haslo?: string | null
): Uzytkownik {
  const id = db()
    .prepare(
      "INSERT INTO app_user(login, haslo_hash, name, role, created_at) VALUES (?,?,?,?,?)"
    )
    .run(
      login ? normalizujLogin(login) : null,
      haslo ? hashSekret(haslo) : null,
      name.trim(),
      role,
      nowIso()
    ).lastInsertRowid;
  return userById(Number(id))!;
}

export function setHaslo(userId: number, haslo: string | null): void {
  db()
    .prepare("UPDATE app_user SET haslo_hash = ? WHERE user_id = ?")
    .run(haslo ? hashSekret(haslo) : null, userId);
}

export function setActive(userId: number, active: boolean): void {
  // konta się NIE kasuje — historia w `events` musi mieć na co wskazywać
  db().prepare("UPDATE app_user SET active = ? WHERE user_id = ?").run(active ? 1 : 0, userId);
}

/**
 * Czy w bazie nie ma jeszcze konta, którym DA SIĘ SIĘ ZALOGOWAĆ.
 *
 * Jedyny moment, w którym wolno założyć konto bez sesji biura — inaczej
 * pierwszego konta nie dałoby się utworzyć niczym. Ta furtka zamyka się sama
 * w chwili, gdy powstanie pierwsze takie konto, i dlatego pierwsze konto MUSI
 * być kontem biura: gdyby było magazynierem, nikt nie mógłby założyć kolejnych
 * i trzeba by ruszać bazę ręcznie.
 *
 * Warunek liczy KONTA Z LOGINEM, nie wszystkie wiersze, i to nie jest
 * kosmetyka. Konta-ślady (migracja historii, przejście z plakietek) zostają
 * w tabeli na zawsze. Gdyby liczyły się do tego warunku, furtka byłaby na
 * każdej istniejącej instalacji zamknięta na głucho: żeby założyć konto,
 * trzeba sesji, a żeby mieć sesję, trzeba konta.
 */
export function brakKont(): boolean {
  return (
    db()
      .prepare("SELECT COUNT(*) n FROM app_user WHERE login IS NOT NULL AND active = 1")
      .get() as { n: number }
  ).n === 0;
}

/* ── Migracja historii ──────────────────────────────────────────────────────
   Historii NIE kasujemy i nie nadpisujemy. `events.user_id` zostaje jako
   tekstowy snapshot tego, co aplikacja wtedy wiedziała; obok dochodzi
   `user_ref`. Zdarzenie, którego nie da się przypisać, zostaje z `NULL` —
   to jest uczciwe, w odróżnieniu od zgadywania po podobieństwie.             */

export interface MigracjaWynik {
  zalozonychKont: number;
  przypisanychZdarzen: number;
  nieprzypisanych: number;
  nazwy: string[];
}

/** Znormalizowana nazwa do dopasowania (trim + bez wielkości liter). */
const klucz = (s: string) => s.trim().toLowerCase();

export function migrujHistorie(): MigracjaWynik {
  const d = db();
  const nazwy = (
    d
      .prepare(
        `SELECT DISTINCT user_id FROM events
          WHERE user_ref IS NULL AND user_id IS NOT NULL AND TRIM(user_id) <> ''`
      )
      .all() as Array<{ user_id: string }>
  ).map((r) => r.user_id);

  const istniejace = new Map(listUsers().map((u) => [klucz(u.name), u]));
  let zalozonych = 0;

  // Warianty tej samej osoby (Jan, jan, „Jan ") schodzą się w JEDNO konto —
  // to jest cały powód, dla którego audyt dotąd był bezużyteczny.
  for (const n of nazwy) {
    if (!klucz(n)) continue;
    if (istniejace.has(klucz(n))) continue;
    const u = createUser(n.trim());
    istniejace.set(klucz(n), u);
    zalozonych++;
  }

  const przypisz = d.prepare("UPDATE events SET user_ref = ? WHERE user_ref IS NULL AND user_id = ?");
  let przypisanych = 0;
  for (const n of nazwy) {
    const u = istniejace.get(klucz(n));
    if (!u) continue;
    przypisanych += Number(przypisz.run(u.userId, n).changes);
  }

  const nieprzypisanych = (
    d.prepare("SELECT COUNT(*) n FROM events WHERE user_ref IS NULL").get() as { n: number }
  ).n;

  return {
    zalozonychKont: zalozonych,
    przypisanychZdarzen: przypisanych,
    nieprzypisanych,
    nazwy: [...new Set(nazwy.map((n) => n.trim()))].sort(),
  };
}
