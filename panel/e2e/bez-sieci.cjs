/* ── Mur sieci dla serwera API w przebiegu przeglądarkowym ───────────────────
   Wczytywany przez `--require` do procesu serwera, zanim ruszy jego kod.
   Przepuszcza połączenia wyłącznie na własną maszynę. Każde inne kończy się
   błędem połączenia i wierszem w dzienniku odmów.

   PO CO, skoro tryb `seeded` i tak nie ma sparowanego konta. Bo tę pewność
   daje dziś zbieg okoliczności, a nie bramka: wysyłka odpowiedzi, zwrot
   pieniędzy i werdykt wołają prawdziwego klienta HTTP Allegro w każdym trybie
   i zatrzymuje je dopiero brak tokena w bazie. Test, który kiedyś dostanie
   token albo klucz modelu w środowisku, pisałby do prawdziwych klientów firmy.
   Mur zamienia „nie powinno wyjść" na „nie ma którędy".

   NA GNIEŹDZIE, nie na `fetch`. `fetch`, `http`, `https` i sterownik MSSQL
   schodzą się w `net.Socket.connect`, więc jedna łata obejmuje także
   bibliotekę, której jeszcze tu nie ma.

   To NIE jest atrapa Allegro. Mur niczego nie odpowiada w cudzym imieniu:
   serwer dostaje zwykły błąd sieci i pokazuje go tak, jak pokazałby awarię. */
const fs = require("node:fs");
const net = require("node:net");

const dziennik = process.env.E2E_DZIENNIK_ODMOW;

function wlasnaMaszyna(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || h === "::ffff:127.0.0.1" || /^127\./.test(h);
}

/* `connect` przyjmuje opcje, parę port–host albo ścieżkę gniazda lokalnego.
   Ścieżka to rozmowa procesów na tej samej maszynie, więc przechodzi. */
function cel(args) {
  const a = Array.isArray(args[0]) ? args[0] : args;
  const pierwszy = a[0];
  if (pierwszy && typeof pierwszy === "object") {
    if (pierwszy.path) return null;
    return { host: pierwszy.host || "localhost", port: pierwszy.port };
  }
  if (typeof pierwszy === "string" && !/^\d+$/.test(pierwszy)) return null;
  return { host: typeof a[1] === "string" ? a[1] : "localhost", port: pierwszy };
}

const oryginal = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const c = cel(args);
  if (!c || wlasnaMaszyna(c.host)) return oryginal.apply(this, args);
  const wiersz = `${new Date().toISOString()} ${c.host}:${c.port}\n`;
  /* Zapis synchroniczny: odmowa ma stać w pliku, zanim test zdąży o nią
     zapytać, a proces bywa zabijany zaraz po ostatnim teście. */
  if (dziennik) {
    try { fs.appendFileSync(dziennik, wiersz); } catch { /* brak dziennika nie otwiera muru */ }
  }
  const blad = Object.assign(
    new Error(`Przebieg e2e nie wychodzi do sieci — odmowa połączenia z ${c.host}:${c.port}`),
    { code: "ECONNREFUSED" });
  /* Błąd w następnym obiegu pętli, jak przy prawdziwej odmowie: wołający
     podpina `error` dopiero po powrocie z `connect`. */
  process.nextTick(() => this.destroy(blad));
  return this;
};
