import { db } from "../db/db.js";
import { config } from "../config.js";
import { createUser, userById, type Uzytkownik } from "./users.js";
import { logEvent } from "./events.js";

/* ── Tryb serwisowy: logowanie wyłączone ─────────────────────────────────────
   Świeża baza nie ma konta i nie da się go założyć inaczej niż kreatorem na
   kolektorze albo `curl`-em z DEPLOY §5a. Przy bazie kasowanej kilka razy
   dziennie to piąty krok w czterokrokowej procedurze, wykonywany DWA RAZY —
   bo podgląd biura ma własne logowanie i na pustej bazie jest ślepym zaułkiem.

   Przy `WERTIS_ADMIN=1` bramka wpuszcza żądania bez sesji, podpisując je
   kontem serwisowym. To jest tylna furtka i tak ma być nazywana; cała reszta
   tego pliku istnieje po to, żeby była furtką, której nie da się zostawić
   otwartej po cichu.                                                          */

/** Nazwa krzyczy, bo historia z tego okresu ma być odróżnialna od pracy ludzi. */
export const NAZWA_SERWISOWA = "ADMIN (TRYB SERWISOWY)";

let konto: Uzytkownik | null = null;

/**
 * Konto serwisowe — PRAWDZIWY wiersz `app_user`, bo `events.user_ref`
 * i `sfera_queue.created_by_ref` to klucze obce, a operacja bez autora nie ma
 * się gdzie zapisać.
 *
 * Powstaje z **`login = NULL` i `haslo_hash = NULL`**, i to jest sedno, nie
 * szczegół:
 *
 *   - nie da się nim zalogować ŻADNĄ drogą. `zaloguj` szuka po loginie
 *     (`WHERE login = ?`), a NULL-a tak się nie trafia; brak hasza domyka
 *     drugą stronę. W całym serwerze nie ma `UPDATE app_user SET login`, więc
 *     nawet nadanie hasła niczego nie otwiera;
 *   - nie ma domyślnego hasła do wycieku — `DEPLOY.md` żąda tego wprost;
 *   - nie da się mu wystawić tokenu, bo jedyny INSERT do `device_session`
 *     siedzi w `zaloguj`. Wyłączenie flagi odbiera dostęp NATYCHMIAST: nie ma
 *     czego unieważniać.
 *
 * Rola `biuro`, bo bez niej tryb nie robi tego, po co powstał — zarządzanie
 * kontami i widoczność magazynów są zastrzeżone dla biura.
 */
export function kontoSerwisowe(): Uzytkownik {
  if (konto) return konto;
  const istniejace = db()
    .prepare("SELECT user_id FROM app_user WHERE name = ? AND login IS NULL")
    .get(NAZWA_SERWISOWA) as { user_id: number } | undefined;
  konto = istniejace
    ? (userById(istniejace.user_id) as Uzytkownik)
    : createUser(NAZWA_SERWISOWA, "biuro", null, null);
  return konto;
}

/** Czy dany identyfikator to konto serwisowe — do zakazów w trasach kont. */
export const toKontoSerwisowe = (userId: number): boolean =>
  config.trybSerwisowy && kontoSerwisowe().userId === userId;

/**
 * Założenie konta i wpis do dziennika — WOŁANE RAZ, przy budowie aplikacji.
 *
 * Nie na ścieżce żądania: `login TEXT UNIQUE` w SQLite przepuszcza wiele
 * NULL-i, więc dwa równoległe pierwsze żądania założyłyby dwa wiersze i audyt
 * rozjechałby się na dwie tożsamości.
 *
 * Konto powstaje WYŁĄCZNIE przy włączonej fladze. Dzięki temu sam wiersz
 * w `app_user` jest dowodem, że tryb kiedykolwiek na tej instalacji chodził —
 * najtańszy możliwy ślad dla kogoś, kto będzie to badał po fakcie.
 */
export function przygotujTrybSerwisowy(): void {
  if (!config.trybSerwisowy) return;
  const u = kontoSerwisowe();
  logEvent("tryb_serwisowy_start", NAZWA_SERWISOWA, null, {
    userId: u.userId,
    sgtMode: config.sgtMode,
  }, u.userId);
}

/**
 * Ostrzeżenia do `problemy` w `/api/health`.
 *
 * Instalacja bez logowania unieważnia wszystko, co niżej na tej liście, więc
 * stoi na niej PIERWSZA — tak samo jak przykryta konfiguracja.
 */
export function ostrzezenieTrybuSerwisowego(): string | null {
  if (!config.trybSerwisowy) return null;
  const bazowe =
    "TRYB SERWISOWY: logowanie jest WYŁĄCZONE (WERTIS_ADMIN=1). " +
    `Każdy w sieci ma uprawnienia biura, a operacje podpisuje „${NAZWA_SERWISOWA}".`;
  /* Przy prawdziwej bazie Subiekta to samo zdanie waży więcej, więc mówimy je
     ostrzej. Twardej blokady nie ma świadomie: Subiekt edu też jest trybem
     `mssql`, a z poziomu serwera „edu czy produkcja" jest nie do odróżnienia —
     blokada trafiłaby w jedyne środowisko, dla którego ten tryb powstał. */
  return config.sgtMode === "mssql"
    ? `${bazowe} Instalacja pracuje na PRAWDZIWEJ bazie Subiekta — wyłącz tryb i zrestartuj usługi.`
    : bazowe;
}
