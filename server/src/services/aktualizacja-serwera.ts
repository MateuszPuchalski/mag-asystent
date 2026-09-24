import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { config } from "../config.js";
import { WERSJA } from "../wersja.js";

/* ── Aktualizacja serwera z panelu (0.492.0) ─────────────────────────────────
   Dotąd nowa wersja docierała do magazynu wtedy, gdy ktoś miał czas wejść
   pulpitem zdalnym na maszynę z Subiektem i uruchomić `-Aktualizuj`. Przy
   kilkudziesięciu wersjach dziennie serwer stał zwykle kilka wersji z tyłu.

   Serwer SAM SIĘ NIE AKTUALIZUJE i to jest cała konstrukcja. Aktualizacja
   zatrzymuje usługę `wertis-api`, a NSSM kończy przy tym całe drzewo procesów
   usługi — zginęłaby w połowie, razem z serwerem. Serwer robi więc dwie
   rzeczy: kładzie ZLECENIE (dane: numer wersji i kto) i woła zadanie
   Harmonogramu „WERTIS aktualizacja", które zakłada instalator. Resztę —
   pobranie paczki, rozpakowanie obok, zamianę, zdrowie, wycofanie — robi
   `instalator/zlecenie.ps1` z `paczka.ps1`, poza procesem serwera.

   Wersje do wyboru to WYŁĄCZNIE wydania z paczką, wyższe niż bieżąca. Nie
   czubek `main`: auto-scalanie wpuszcza tam zmiany kilka razy dziennie, a tu
   administrator ma wgrać to, czego opis właśnie przeczytał.               */

/** Repozytorium wydań — to samo, z którego instalator bierze paczkę i APK. */
export const REPO_WYDAN = "MateuszPuchalski/mag-asystent";

/** Katalog zleceń: ten sam, który czyta `zlecenie.ps1` (`server\data\aktualizacja`). */
export const katalogAktualizacji = () => path.join(path.dirname(config.dbPath), "aktualizacja");

export interface Wydanie {
  wersja: string;
  opublikowano: string | null;
  /** Czy wydanie ma paczkę i jej sumę — bez nich instalator nie ma czego wgrać. */
  maPaczke: boolean;
}

export interface SekcjaZmian {
  wersja: string;
  tytul: string;
  tresc: string;
  /** Wpis zawiera „[wymaga działania" — administrator ma to przeczytać przed kliknięciem. */
  wymagaDzialania: boolean;
}

export interface StanZadania {
  etap: "trwa" | "gotowe" | "blad";
  wersja: string;
  kto?: string;
  od?: string;
  do?: string;
  kod?: number;
  komunikat?: string;
}

/** Porównanie numerów `a.b.c` liczbowo; ujemne = `a` starsza. */
export function porownajWersje(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const r = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (r !== 0) return r;
  }
  return 0;
}

const WZOR_WERSJI = /^\d{1,4}\.\d{1,5}\.\d{1,6}$/;

/** Wydania GitHuba → wersje wyższe niż bieżąca, od najnowszej. */
export function wydaniaNowsze(
  surowe: Array<{ tag_name?: string; published_at?: string | null; assets?: Array<{ name?: string }> }>,
  obecna: string,
): Wydanie[] {
  return surowe
    .map((r) => {
      const wersja = (r.tag_name ?? "").replace(/^v/, "");
      const nazwy = new Set((r.assets ?? []).map((a) => a.name));
      return {
        wersja,
        opublikowano: r.published_at ?? null,
        maPaczke: nazwy.has(`wertis-${wersja}.zip`) && nazwy.has(`wertis-${wersja}.zip.sha256`),
      };
    })
    .filter((w) => WZOR_WERSJI.test(w.wersja) && porownajWersje(w.wersja, obecna) > 0)
    .sort((a, b) => porownajWersje(b.wersja, a.wersja));
}

/**
 * Sekcje CHANGELOG.md z wersji wyższych niż `obecna` i nie wyższych niż `do`,
 * od najnowszej. To jest opis, który administrator czyta przed kliknięciem.
 */
export function sekcjeZmian(changelog: string, obecna: string, doWersji: string): SekcjaZmian[] {
  const wynik: SekcjaZmian[] = [];
  const czesci = changelog.split(/^## /m).slice(1);
  for (const c of czesci) {
    const m = /^(\d+\.\d+\.\d+)\s*[—-]?\s*(.*)\n([\s\S]*)$/.exec(c);
    if (!m) continue;
    const [, wersja, tytul, tresc] = m as unknown as [string, string, string, string];
    if (porownajWersje(wersja, obecna) <= 0 || porownajWersje(wersja, doWersji) > 0) continue;
    const czysta = tresc.replace(/\n---\s*$/, "").trim();
    wynik.push({ wersja, tytul: tytul.trim(), tresc: czysta, wymagaDzialania: /\[wymaga działania/i.test(czysta) });
  }
  return wynik.sort((a, b) => porownajWersje(b.wersja, a.wersja));
}

/* ── Pamięć wydań ─────────────────────────────────────────────────────────
   Wypełnia ją takt w `main()` i przycisk „Sprawdź teraz". Samo otwarcie
   karty jej nie odświeża: patrzenie ma nie wychodzić do sieci za każdym
   razem, a lista wydań zmienia się co kilkadziesiąt minut. */

interface Pamiec {
  sprawdzono: string | null;
  wydania: Wydanie[];
  zmiany: SekcjaZmian[];
  blad: string | null;
}

let pamiec: Pamiec = { sprawdzono: null, wydania: [], zmiany: [], blad: null };

export type Pobieracz = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const pobierzDomyslnie: Pobieracz = (url) =>
  fetch(url, { headers: { "User-Agent": `WERTIS/${WERSJA}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000) });

export async function sprawdzWydania(
  pobierz: Pobieracz = pobierzDomyslnie,
  obecna: string = WERSJA,
  teraz: string = new Date().toISOString(),
): Promise<void> {
  try {
    const r = await pobierz(`https://api.github.com/repos/${REPO_WYDAN}/releases?per_page=30`);
    if (!r.ok) throw new Error(`GitHub odpowiedział ${r.status}`);
    const wydania = wydaniaNowsze(JSON.parse(await r.text()), obecna);
    let zmiany: SekcjaZmian[] = [];
    const najnowsza = wydania[0];
    if (najnowsza) {
      /* CHANGELOG z tagu NAJNOWSZEJ wersji: zawiera wpisy wszystkich
         pośrednich, a paczka CHANGELOG-u nie niesie. */
      const c = await pobierz(`https://raw.githubusercontent.com/${REPO_WYDAN}/v${najnowsza.wersja}/CHANGELOG.md`);
      if (c.ok) zmiany = sekcjeZmian(await c.text(), obecna, najnowsza.wersja);
    }
    pamiec = { sprawdzono: teraz, wydania, zmiany, blad: null };
  } catch (e) {
    /* Stara lista zostaje: chwilowy brak sieci nie ma kasować tego, co już
       wiadomo, a zdanie o błędzie stoi obok niej. */
    pamiec = { ...pamiec, sprawdzono: teraz, blad: e instanceof Error ? e.message : String(e) };
  }
}

/** Tylko do testów: stan pamięci wydań od zera. */
export function _wyczyscPamiec(): void {
  pamiec = { sprawdzono: null, wydania: [], zmiany: [], blad: null };
}

/* ── Zadanie Harmonogramu ─────────────────────────────────────────────────
   Uruchamiacz ustawia wyłącznie `main()` i tylko pod NSSM (`podNssm`), tak
   samo jak restart po zmianie konfiguracji. Test trasy albo `npm run dev`
   nie mają prawa uruchamiać aktualizacji systemu, na którym biegną. */

export type Uruchamiacz = (nazwaZadania: string) => Promise<void>;
let uruchamiacz: Uruchamiacz | null = null;

export function ustawUruchamiacz(fn: Uruchamiacz | null): void {
  uruchamiacz = fn;
}

export const uruchomSchtasks: Uruchamiacz = (nazwa) =>
  new Promise((ok, zle) => {
    execFile("schtasks.exe", ["/run", "/tn", nazwa], { timeout: 15_000 }, (blad, _out, err) => {
      if (blad) zle(new Error(`schtasks: ${(err || blad.message).trim()}`));
      else ok();
    });
  });

/** Nazwa zadania — z sufiksem instancji, tak jak rejestruje je instalator. */
export const nazwaZadania = () => `WERTIS aktualizacja${config.srodowisko === "dev" ? "-dev" : ""}`;

function czytajJson<T>(plik: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(plik, "utf8").replace(/^﻿/, "")) as T;
  } catch {
    return null;
  }
}

/** Stan ostatniej aktualizacji z `stan.json`, który pisze `zlecenie.ps1`. */
export function stanZadania(katalog: string = katalogAktualizacji()): StanZadania | null {
  return czytajJson<StanZadania>(path.join(katalog, "stan.json"));
}

/* Zadanie ma w Harmonogramie limit 30 minut. „Trwa" starsze niż 45 to
   aktualizacja przerwana w sposób, którego skrypt nie zdążył zapisać. */
const TRWA_NAJDLUZEJ_MS = 45 * 60_000;

export function trwaAktualizacja(stan: StanZadania | null, teraz = Date.now()): boolean {
  return !!stan && stan.etap === "trwa" && !!stan.od && teraz - Date.parse(stan.od) < TRWA_NAJDLUZEJ_MS;
}

export interface StanAktualizacji {
  obecna: string;
  sprawdzono: string | null;
  bladSprawdzenia: string | null;
  wydania: Wydanie[];
  zmiany: SekcjaZmian[];
  ostatnia: StanZadania | null;
  czekaZlecenie: boolean;
  /** `null` = wolno kliknąć; inaczej zdanie, dlaczego nie. */
  blokada: string | null;
}

export function stanAktualizacji(katalog: string = katalogAktualizacji()): StanAktualizacji {
  const ostatnia = stanZadania(katalog);
  const czekaZlecenie = fs.existsSync(path.join(katalog, "zlecenie.json"));
  const blokada = !uruchamiacz
    ? "Aktualizacja z panelu działa na serwerze uruchomionym jako usługa Windows (instalator). Tu zostaje -Aktualizuj."
    : trwaAktualizacja(ostatnia) || czekaZlecenie
      ? "Aktualizacja już trwa."
      : null;
  return { obecna: WERSJA, sprawdzono: pamiec.sprawdzono, bladSprawdzenia: pamiec.blad,
    wydania: pamiec.wydania, zmiany: pamiec.zmiany, ostatnia, czekaZlecenie, blokada };
}

export class BladZlecenia extends Error {
  constructor(message: string, readonly kod = 400) { super(message); }
}

/**
 * Zleca aktualizację do `wersja`. Rzuca `BladZlecenia` z gotowym zdaniem.
 * Hasło i rolę sprawdza trasa, zanim tu wejdzie.
 */
export async function zlecAktualizacje(
  wersja: string,
  kto: string,
  katalog: string = katalogAktualizacji(),
  teraz: string = new Date().toISOString(),
): Promise<void> {
  const s = stanAktualizacji(katalog);
  if (s.blokada) throw new BladZlecenia(s.blokada, 409);
  const w = s.wydania.find((x) => x.wersja === wersja);
  if (!w) throw new BladZlecenia(`Wersji ${wersja} nie ma wśród wydań nowszych niż ${s.obecna}. Odśwież listę.`);
  if (!w.maPaczke) throw new BladZlecenia(`Wydanie ${wersja} nie ma jeszcze paczki — CI dokłada ją kilka minut po scaleniu.`);

  fs.mkdirSync(katalog, { recursive: true });
  const plik = path.join(katalog, "zlecenie.json");
  fs.writeFileSync(plik, JSON.stringify({ wersja, kto, at: teraz }), "utf8");
  try {
    await uruchamiacz!(nazwaZadania());
  } catch (e) {
    /* Zlecenie bez wykonawcy wisiałoby jako „trwa" i blokowało przycisk.
       Najczęstsza przyczyna: instalacja sprzed 0.492.0 bez zadania. */
    fs.rmSync(plik, { force: true });
    throw new BladZlecenia(
      `Nie udało się uruchomić zadania „${nazwaZadania()}" (${e instanceof Error ? e.message : e}). `
        + "Zadanie zakłada instalator: uruchom raz -Aktualizuj na serwerze.", 500);
  }
}

/**
 * Wynik aktualizacji do dziennika biura — raz, przy pierwszym starcie po niej.
 * `zlecenie.ps1` nie ma dostępu do bazy, więc wpis robi serwer, który po
 * aktualizacji i tak wstaje (albo wstaje stary, po wycofaniu).
 */
export function wynikDoDziennika(
  zaloguj: (stan: StanZadania) => void,
  katalog: string = katalogAktualizacji(),
): StanZadania | null {
  const stan = stanZadania(katalog);
  if (!stan || stan.etap === "trwa" || !stan.od) return null;
  const znacznik = path.join(katalog, "zalogowano.txt");
  let byl = "";
  try { byl = fs.readFileSync(znacznik, "utf8").trim(); } catch { /* pierwszy raz */ }
  if (byl === stan.od) return null;
  zaloguj(stan);
  fs.writeFileSync(znacznik, stan.od, "utf8");
  return stan;
}

/**
 * Zdanie do `/api/health`, gdy ostatnia aktualizacja się nie udała (24 h).
 * Po wycofaniu serwer działa na starej wersji i wygląda zdrowo — bez tego
 * zdania nikt by nie wiedział, że nowa wersja nie weszła.
 */
export function problemAktualizacji(stan: StanZadania | null, teraz = Date.now()): string | null {
  if (!stan || stan.etap !== "blad") return null;
  const kiedy = Date.parse(stan.do ?? stan.od ?? "");
  if (!Number.isFinite(kiedy) || teraz - kiedy > 24 * 3_600_000) return null;
  return `Aktualizacja do ${stan.wersja} nie powiodła się; serwer pracuje na ${WERSJA}. `
    + `Dziennik: server\\data\\aktualizacja\\ostatnia.log.${stan.komunikat ? ` ${stan.komunikat}` : ""}`;
}
