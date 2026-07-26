import { randomBytes } from "node:crypto";
import { db, nowIso } from "../db/db.js";
import { logEvent } from "./events.js";
import { userByBadge, userById, sprawdzPin, type Rola, type Uzytkownik } from "./users.js";

/* ── Sesja urządzenia (plan §7) ─────────────────────────────────────────────
   Skan badge'a = zalogowanie I szybka zmiana zmiany. Jeden skan, ~1 s, bez
   PIN-u na ścieżce codziennej.

   BLOKADA PO BEZCZYNNOŚCI, NIGDY WYLOGOWANIE. To nie jest niuans: wylogowanie
   gubiące 30 rozłożonych pozycji to najprostszy sposób na aplikację, która
   leży w szufladzie. Sesja po TTL nie znika — przechodzi w stan `zablokowana`,
   zachowuje otwartą dostawę i kontekst, a odblokowanie to jeden skan badge'a.

   Nagłówek `X-User` przestaje być tożsamością. Dało się go wpisać ręcznie,
   więc każdy mógł podać się za kogokolwiek — zostaje najwyżej jako podpowiedź
   dla instalacji, które nie przeszły jeszcze na badge'y.                     */

/** Po tylu minutach bez ruchu sesja jest zablokowana (nie: usunięta). */
export const BLOKADA_MIN = 10;

export interface Sesja {
  token: string;
  user: Uzytkownik;
  /** Bezczynna dłużej niż TTL — wymaga skanu badge'a, ale nic nie utraciła. */
  zablokowana: boolean;
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

/** Skan badge'a → nowa sesja urządzenia. */
export function zaloguj(badge: string, deviceId: string | null): Sesja | null {
  const user = userByBadge(badge);
  if (!user) return null;
  const token = randomBytes(24).toString("hex");
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, user.userId, deviceId, nowIso(), nowIso());
  logEvent("login", user.name, null, { badge: user.badgeCode, role: user.role });
  return { token, user, zablokowana: false };
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
  return { token, user, zablokowana: minut(r.last_seen) >= BLOKADA_MIN };
}

/**
 * Odnotowanie aktywności — odsuwa blokadę.
 *
 * Zapis jest DŁAWIONY, bo `dotknij` woła się z każdego żądania, a kolektor
 * odpytuje serwer co 2 s z czterech ekranów. Bez dławienia każdy odczyt
 * pociągałby UPDATE do bazy dla pola, którego dokładność ma sens najwyżej
 * minutowy: blokada zapada po 10 minutach, więc odświeżanie częściej niż raz
 * na minutę nie zmienia niczego poza liczbą zapisów.
 */
const DLAWIENIE_MS = 60_000;

export function dotknij(token: string, force = false): void {
  const r = db().prepare("SELECT last_seen FROM device_session WHERE token = ?").get(token) as
    | { last_seen: string }
    | undefined;
  if (!force && r && minut(r.last_seen) * 60_000 < DLAWIENIE_MS) return;
  db().prepare("UPDATE device_session SET last_seen = ? WHERE token = ?").run(nowIso(), token);
}

/**
 * Odblokowanie zablokowanej sesji skanem badge'a.
 *
 * Cudzy badge NIE odblokowuje cudzej sesji po cichu — to jest przejęcie pracy
 * i idzie osobną drogą (`przejmij`), z jawnym potwierdzeniem człowieka.
 */
export function odblokuj(token: string, badge: string): Sesja | null {
  const s = sesja(token);
  if (!s) return null;
  const kto = userByBadge(badge);
  if (!kto || kto.userId !== s.user.userId) return null;
  dotknij(token, true); // odblokowanie MUSI zapisać, niezależnie od dławienia
  return { ...s, zablokowana: false };
}

/**
 * Przejęcie pracy przez inną osobę.
 *
 * Ciche przełączenie niszczyłoby audyt dokładnie wtedy, gdy jest potrzebny —
 * przy dostawie zaczętej przez kogoś innego. Dlatego stara sesja jest jawnie
 * unieważniana, powstaje nowa, a fakt przejęcia ląduje w `events`.
 */
export function przejmij(
  token: string,
  badge: string,
  deviceId: string | null,
  kontekst?: string
): Sesja | null {
  const stara = sesja(token);
  const nowy = userByBadge(badge);
  if (!nowy) return null;
  if (stara) {
    db().prepare("UPDATE device_session SET revoked_at = ? WHERE token = ?").run(nowIso(), token);
    logEvent("session_handover", nowy.name, null, {
      od: stara.user.name,
      odBadge: stara.user.badgeCode,
      doBadge: nowy.badgeCode,
      kontekst: kontekst ?? null,
    });
  }
  return zaloguj(badge, deviceId);
}

export function wyloguj(token: string): void {
  db().prepare("UPDATE device_session SET revoked_at = ? WHERE token = ?").run(nowIso(), token);
}

/* ── Operacje uprzywilejowane ───────────────────────────────────────────────
   Badge'e bywają pożyczane („podaj mi swój, mam ręce w oleju"), więc dla
   operacji, których nie da się cofnąć albo które omijają cudzą pracę, sam
   badge nie wystarcza. PIN sprawia, że „ktoś użył mojego badge'a" jest
   kłamstwem, a nie wymówką.                                                  */

/**
 * Operacje wymagające PIN-u.
 *
 * Plan §7 wymienia cztery: korektę zatwierdzonego ruchu, domknięcie dostawy
 * z nierozwiązanymi wyjątkami, zdjęcie cudzego locka i zmianę ustawień serwera.
 * Trasy istnieją dziś dla dwóch — pozostałe nie mają w aplikacji żadnego
 * wejścia (nie ma domykania dostawy, a korekta lokalizacji jest ścieżką
 * codzienną, nie wyjątkiem). Wartości enuma bez trasy byłyby martwym kodem
 * udającym zabezpieczenie, więc dochodzą razem ze swoimi trasami.
 */
export type OperacjaUprzywilejowana =
  /** Zdjęcie cudzej blokady linii przed wygaśnięciem TTL. */
  | "zdjecie_cudzego_locka"
  /** Zakładanie kont, PIN-y, wyłączanie kont, migracja historii. */
  | "zarzadzanie_kontami";

/**
 * Kto MOŻE — zanim PIN rozstrzygnie, czy to naprawdę ta osoba.
 *
 * Zarządzanie kontami jest tylko dla biura, bo to jedyna operacja, która
 * tworzy TOŻSAMOŚĆ. Brygadzista, który może założyć konto, może założyć konto
 * biura z własnym PIN-em — i cała reszta reguł przestaje cokolwiek znaczyć.
 */
const WYMAGANA_ROLA: Record<OperacjaUprzywilejowana, readonly Rola[]> = {
  zdjecie_cudzego_locka: ["brygadzista", "biuro"],
  zarzadzanie_kontami: ["biuro"],
};

const NAZWA_ROL: Record<Rola, string> = {
  magazynier: "magazyniera",
  brygadzista: "brygadzisty",
  biuro: "biura",
};

export interface WynikAutoryzacji {
  ok: boolean;
  powod?: string;
}

/**
 * Czy ta osoba może wykonać operację uprzywilejowaną.
 *
 * `pin` jest wymagany zawsze, gdy konto ma go ustawiony — także dla roli
 * `biuro`. Rola mówi, KTO może; PIN dowodzi, że to naprawdę ta osoba.
 */
export function autoryzuj(
  user: Uzytkownik,
  operacja: OperacjaUprzywilejowana,
  pin: string | null
): WynikAutoryzacji {
  const dozwolone = WYMAGANA_ROLA[operacja];
  if (!dozwolone.includes(user.role)) {
    const kto = dozwolone.map((r) => NAZWA_ROL[r]).join(" albo ");
    return { ok: false, powod: `Operacja „${operacja}" wymaga uprawnień ${kto}` };
  }
  if (!user.maPin) {
    // Konto uprzywilejowane bez PIN-u to konto, którego nie da się przypisać
    // do człowieka — lepiej odmówić, niż wpisać do audytu coś niepewnego.
    return { ok: false, powod: "Konto uprzywilejowane bez ustawionego PIN-u" };
  }
  const row = db().prepare("SELECT pin_hash FROM app_user WHERE user_id = ?").get(user.userId) as
    | { pin_hash: string | null }
    | undefined;
  if (!pin || !sprawdzPin(pin, row?.pin_hash ?? null)) {
    return { ok: false, powod: "Błędny PIN" };
  }
  logEvent("privileged", user.name, null, { operacja });
  return { ok: true };
}
