/* ── Restart po zmianie konfiguracji (0.491.0) ───────────────────────────────
   Konfigurację czyta się raz, przy starcie procesu. Zapis `wertis.env`
   z panelu działa więc dopiero po restarcie usług, a restart robił dotąd
   człowiek przy serwerze — dokładnie ta czynność, którą panel ma zdjąć.

   Mechanizm jest najprostszy możliwy: proces kończy się sam, a NSSM podnosi
   go z powrotem (`AppExit Default Restart`, instalator). Worker Node dowiaduje
   się o zmianie z dziennika (`konfiguracja_zmieniona`) i robi to samo.

   TYLKO POD NSSM. Poza usługą nikt procesu nie podniesie: `npm run dev`
   zostałby martwy, a `node server\dist\index.js` uruchomione ręcznie przy
   diagnozie (DEPLOY §7) zniknęłoby człowiekowi spod ręki. Usługę rozpoznaje
   się po trzech rzeczach naraz: Windows, brak sesji interaktywnej
   (`SESSIONNAME` istnieje wyłącznie w sesji zalogowanego człowieka) i brak
   npm w roli rodzica. Pomyłka w tę stronę kosztuje zdanie „zrestartuj usługi"
   zamiast samoczynnego restartu — nigdy martwy serwer.

   Odczyt przez nawias, nie przez kropkę, celowo: to nie są klucze
   `wertis.env`, a rejestr kluczy (`konfiguracja-rejestr.ts`) liczy wyłącznie
   odczyty z kropką. Wpisane tam udawałyby ustawienie w panelu.            */

export function podNssm(
  env: NodeJS.ProcessEnv = process.env,
  platforma: NodeJS.Platform = process.platform,
): boolean {
  return platforma === "win32" && !env["SESSIONNAME"] && !env["npm_lifecycle_event"];
}

let restart: (() => void) | null = null;

/** Woła wyłącznie `main()` — `buildApp()` w testach tras nie ma prawa kończyć procesu. */
export function ustawRestart(fn: (() => void) | null): void {
  restart = fn;
}

/**
 * „sam" — proces zakończy się za chwilę i wstanie z nowym plikiem;
 * „reczny" — restart usług zostaje człowiekowi.
 *
 * Sekunda zwłoki, żeby odpowiedź HTTP zdążyła wyjść do panelu.
 */
export function zaplanujRestart(): "sam" | "reczny" {
  if (!restart) return "reczny";
  const fn = restart;
  setTimeout(fn, 1000).unref?.();
  return "sam";
}
