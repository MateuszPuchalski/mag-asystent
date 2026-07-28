import { randomBytes } from "node:crypto";
import { db, nowIso } from "../db/db.js";
import { logEvent } from "./events.js";
import { userByBadge, userById, sprawdzPin, type Rola, type Uzytkownik } from "./users.js";

/* ── Sesja urządzenia (plan §7) ─────────────────────────────────────────────
   Skan badge'a = zalogowanie I szybka zmiana zmiany. Jeden skan, ~1 s, bez
   PIN-u na ścieżce codziennej.

   SESJA NIE WYGASA SAMA. Trwa do jawnej decyzji człowieka: wylogowania
   z Ustawień albo przejęcia pracy cudzym badge'em. Bezczynność nie robi nic.

   Do sierpnia 2026 sesja blokowała się po 10 minutach bez ruchu, a kolektor
   pokazywał wtedy ekran „Sesja zablokowana". Blokada nigdy nie gubiła pracy,
   ale kosztowała skan przy każdym powrocie do odłożonego kolektora — i to był
   jej całkowity efekt, bo urządzenia nie opuszczają hali.

   Tożsamość pilnuje dziś jedno miejsce: skan CUDZEGO badge'a. Nigdy nie
   przełącza po cichu — pyta człowieka i zapisuje przejęcie w `events`.

   Nagłówek `X-User` przestaje być tożsamością. Dało się go wpisać ręcznie,
   więc każdy mógł podać się za kogokolwiek — zostaje najwyżej jako podpowiedź
   dla instalacji, które nie przeszły jeszcze na badge'y.                     */

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

/** Skan badge'a → nowa sesja urządzenia. */
export function zaloguj(badge: string, deviceId: string | null): Sesja | null {
  const user = userByBadge(badge);
  if (!user) return null;
  const token = randomBytes(24).toString("hex");
  db()
    .prepare("INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)")
    .run(token, user.userId, deviceId, nowIso(), nowIso());
  logEvent("login", user.name, null, { badge: user.badgeCode, role: user.role });
  return { token, user };
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
  | "zarzadzanie_kontami"
  /**
   * Ukrywanie magazynów na karcie towaru.
   *
   * Osobna operacja, a nie „zarządzanie kontami" pod inną nazwą: wpis
   * `privileged` w audycie niesie nazwę operacji, więc wrzucenie tego do
   * wspólnego worka znaczyłoby, że „biuro zmieniło widoczność magazynów"
   * i „biuro założyło konto" wyglądają w historii identycznie.
   */
  | "widocznosc_magazynow";

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
  // widoczność magazynów jest wspólna dla wszystkich kolektorów, więc ustawia
  // ją ta sama rola, która odpowiada za konfigurację — nie pojedynczy magazynier
  widocznosc_magazynow: ["biuro"],
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
