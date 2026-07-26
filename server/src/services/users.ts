import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db/db.js";

/* ── Konta pracowników (plan §7) ────────────────────────────────────────────
   Dotąd tożsamością był dowolny łańcuch wpisany na kolektorze i wysłany
   w nagłówku `X-User`. Trzy skutki, wszystkie realne:
     • `events.user_id` zbiera warianty tej samej osoby (Jan, jan, Jan K),
       więc audyt nadaje się do czytania oczami i do niczego więcej,
     • każdy może podać się za kogokolwiek jednym wpisem,
     • firma ma badge'y i chce kont imiennych — czego ten model nie realizuje.

   Badge to JEDEN skan (~1 s) na ścieżce codziennej, bez PIN-u. PIN wchodzi
   dopiero tam, gdzie badge nie wystarcza, bo badge'e bywają pożyczane.       */

export type Rola = "magazynier" | "brygadzista" | "biuro";

export interface Uzytkownik {
  userId: number;
  badgeCode: string;
  name: string;
  role: Rola;
  active: boolean;
  /** Czy konto ma ustawiony PIN — samego hasza nigdy nie wystawiamy. */
  maPin: boolean;
}

interface UserRow {
  user_id: number;
  badge_code: string;
  name: string;
  pin_hash: string | null;
  role: string;
  active: number;
}

const widok = (r: UserRow): Uzytkownik => ({
  userId: r.user_id,
  badgeCode: r.badge_code,
  name: r.name,
  role: r.role as Rola,
  active: r.active === 1,
  maPin: !!r.pin_hash,
});

/* ── Kod badge'a: prefiks + numer + cyfra kontrolna ─────────────────────────
   Lustro `core/badge/Badge.kt`. Cyfra kontrolna wyklucza rozpoznanie
   USZKODZONEJ etykiety jako CUDZEGO badge'a — bez niej starty znak zamienia
   Jana w Piotra, a audyt wskazuje niewinnego.                                */

const BADGE_RE = /^PRC-(\d{4})-(\d)$/;

export function cyfraKontrolna(numer: number): number {
  const cyfry = String(numer).padStart(4, "0").split("").map(Number);
  const suma = cyfry.reduce((s, c, i) => s + c * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10;
}

export function badgeCode(numer: number): string {
  return `PRC-${String(numer).padStart(4, "0")}-${cyfraKontrolna(numer)}`;
}

/** Numer pracownika z kodu; `null` gdy to nie badge ALBO zła cyfra kontrolna. */
export function parseBadge(raw: string): number | null {
  const m = BADGE_RE.exec((raw ?? "").trim().toUpperCase());
  if (!m) return null;
  const numer = Number(m[1]);
  return Number(m[2]) === cyfraKontrolna(numer) ? numer : null;
}

/* ── PIN ────────────────────────────────────────────────────────────────────
   scrypt z solą per konto. PIN jest krótki z natury (ludzie wpisują go
   w rękawicach), więc funkcja MUSI być kosztowna — inaczej wyciek bazy oznacza
   natychmiastowe odtworzenie wszystkich PIN-ów.                              */

export function hashPin(pin: string): string {
  const sol = randomBytes(16);
  return `${sol.toString("hex")}:${scryptSync(pin, sol, 32).toString("hex")}`;
}

export function sprawdzPin(pin: string, hash: string | null): boolean {
  if (!hash) return false;
  const [solHex, oczekiwany] = hash.split(":");
  if (!solHex || !oczekiwany) return false;
  const wyliczony = scryptSync(pin, Buffer.from(solHex, "hex"), 32);
  const bufOczekiwany = Buffer.from(oczekiwany, "hex");
  // porównanie stałoczasowe — inaczej czas odpowiedzi zdradza prefiks PIN-u
  return (
    wyliczony.length === bufOczekiwany.length && timingSafeEqual(wyliczony, bufOczekiwany)
  );
}

/* ── Konta ──────────────────────────────────────────────────────────────── */

export function listUsers(): Uzytkownik[] {
  return (db().prepare("SELECT * FROM app_user ORDER BY name").all() as UserRow[]).map(widok);
}

export function userByBadge(kod: string): Uzytkownik | null {
  const numer = parseBadge(kod);
  if (numer === null) return null;
  const r = db()
    .prepare("SELECT * FROM app_user WHERE badge_code = ? AND active = 1")
    .get(badgeCode(numer)) as UserRow | undefined;
  return r ? widok(r) : null;
}

export function userById(userId: number): Uzytkownik | null {
  const r = db().prepare("SELECT * FROM app_user WHERE user_id = ?").get(userId) as
    | UserRow
    | undefined;
  return r ? widok(r) : null;
}

/** Numer nadawany kolejno — badge drukuje się raz i zostaje na całe zatrudnienie. */
function nastepnyNumer(): number {
  const r = db().prepare("SELECT badge_code FROM app_user").all() as Array<{ badge_code: string }>;
  const numery = r.map((x) => parseBadge(x.badge_code) ?? 0);
  return Math.max(0, ...numery) + 1;
}

export function createUser(name: string, role: Rola = "magazynier", pin?: string): Uzytkownik {
  const kod = badgeCode(nastepnyNumer());
  const id = db()
    .prepare(
      "INSERT INTO app_user(badge_code, name, pin_hash, role, created_at) VALUES (?,?,?,?,?)"
    )
    .run(kod, name.trim(), pin ? hashPin(pin) : null, role, nowIso()).lastInsertRowid;
  return userById(Number(id))!;
}

export function setPin(userId: number, pin: string | null): void {
  db()
    .prepare("UPDATE app_user SET pin_hash = ? WHERE user_id = ?")
    .run(pin ? hashPin(pin) : null, userId);
}

export function setActive(userId: number, active: boolean): void {
  // konta się NIE kasuje — historia w `events` musi mieć na co wskazywać
  db().prepare("UPDATE app_user SET active = ? WHERE user_id = ?").run(active ? 1 : 0, userId);
}

/** Czy rola wymaga PIN-u przy operacjach uprzywilejowanych. */
export function rolaUprzywilejowana(u: Uzytkownik): boolean {
  return u.role === "brygadzista" || u.role === "biuro";
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
    przypisanych += przypisz.run(u.userId, n).changes;
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
