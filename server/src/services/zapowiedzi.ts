import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { allegroAdapter } from "../adapters/allegro.js";
import { stanPolaczenia } from "./allegro-token.js";
import type { ZwrotAllegro } from "../adapters/allegro.js";

/* ── Zapowiedzi zwrotów (Etap 4) ─────────────────────────────────────────────
   Klient rejestruje zwrot w Allegro dniami wcześniej, niż paczka dojedzie.
   Do tej pory system dowiadywał się o sprawie dopiero od skanu etykiety —
   ticker odwraca to: zgłoszenia spływają w tle, skan trafia w znane
   zgłoszenie jednym GET-em szczegółu, a zgłoszenie, do którego paczka nie
   dojechała, W OGÓLE ma gdzie być widoczne (panel „brakujące paczki").

   Zapowiedź to drogowskaz, nie kopia zwrotu — pełne dane (pozycje, powody,
   surowy JSON) przynosi jak dotąd skan. Dzięki temu ticker nie utrzymuje
   drugiej prawdy o zwrocie, tylko listę „co ma nadjechać".                  */

const DZIEN_MS = 86_400_000;

/** Pierwszy przebieg bez historii: dwa tygodnie wstecz łapią wszystko, co jeszcze może dojechać. */
const PIERWSZY_PRZEBIEG_DNI = 14;

/** Zakładka okna kolejnego przebiegu — API filtruje po createdAt, nie po zmianach. */
const ZAKLADKA_DNI = 1;

export interface WierszZapowiedzi {
  id: number;
  referencja: string | null;
  kupujacyLogin: string | null;
  zgloszono: string | null;
  waybills: string[];
  dniOdZgloszenia: number | null;
}

function wszystkieWaybille(z: ZwrotAllegro): string[] {
  const kody = new Set<string>();
  for (const p of z.paczki) {
    if (p.waybill) kody.add(p.waybill);
    if (p.transportingWaybill) kody.add(p.transportingWaybill);
  }
  return [...kody];
}

/**
 * Jeden przebieg tickera: pobierz zgłoszenia od ostatniej znanej daty
 * (z zakładką) i upsertuj. Zwraca liczbę NOWYCH zapowiedzi — do logu tickera.
 *
 * Zgłoszenie, którego zwrot już przyjęliśmy skanem (paczka wyprzedziła
 * ticker), od razu rodzi się jako `dotarl` — inaczej wisiałoby wiecznie
 * wśród brakujących, bo odhaczanie dzieje się przy tworzeniu zwrotu.
 */
export async function odswiezZapowiedzi(): Promise<number> {
  const d = db();
  const ostatnia = (
    d.prepare("SELECT MAX(utworzono_allegro) AS m FROM zwrot_zapowiedz").get() as {
      m: string | null;
    }
  ).m;
  const odKiedy = new Date(
    (ostatnia ? Date.parse(ostatnia) - ZAKLADKA_DNI * DZIEN_MS : Date.now() - PIERWSZY_PRZEBIEG_DNI * DZIEN_MS)
  ).toISOString();

  const zgloszenia = await allegroAdapter().listaZwrotowKlienta(odKiedy);
  const teraz = nowIso();
  const upsert = d.prepare(
    `INSERT INTO zwrot_zapowiedz(allegro_return_id, referencja, kupujacy_login,
                                 utworzono_allegro, waybills, status, zwrot_id, widziano_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(allegro_return_id) DO UPDATE SET
       referencja=excluded.referencja, kupujacy_login=excluded.kupujacy_login,
       utworzono_allegro=excluded.utworzono_allegro, waybills=excluded.waybills,
       widziano_at=excluded.widziano_at`
  );
  const znanyZwrot = d.prepare("SELECT id FROM zwrot WHERE allegro_return_id = ?");
  /* Upsert nie mówi, czy wstawił, czy nadpisał (changes=1 w obu razach) —
     nowość rozstrzyga wcześniejsze zajrzenie. Wyścig nie grozi: piszą tu
     tylko ticker (jeden) i odhaczanie, które nowych wierszy nie tworzy. */
  const znanaZapowiedz = d.prepare("SELECT 1 AS j FROM zwrot_zapowiedz WHERE allegro_return_id = ?");

  let nowych = 0;
  for (const z of zgloszenia) {
    if (!z.id) continue;
    const zwrot = znanyZwrot.get(z.id) as { id: number } | undefined;
    if (!znanaZapowiedz.get(z.id)) nowych++;
    upsert.run(
      z.id,
      z.referencja,
      z.kupujacyLogin,
      z.utworzono,
      JSON.stringify(wszystkieWaybille(z)),
      zwrot ? "dotarl" : "oczekuje",
      zwrot?.id ?? null,
      teraz
    );
  }
  return nowych;
}

/**
 * Zgłoszenie, którego którakolwiek paczka nosi ten numer — szybka ścieżka
 * skanu: jeden GET szczegółu zamiast dwóch przeszukiwań listy po polach paczki.
 */
export function zapowiedzDlaWaybilla(waybill: string): { allegroReturnId: string } | null {
  const w = db()
    .prepare(
      `SELECT allegro_return_id FROM zwrot_zapowiedz
       WHERE status='oczekuje'
         AND EXISTS (SELECT 1 FROM json_each(waybills) WHERE json_each.value = ?)
       LIMIT 1`
    )
    .get(waybill) as { allegro_return_id: string } | undefined;
  return w ? { allegroReturnId: w.allegro_return_id } : null;
}

/** Paczka dojechała — zwrot przyjęty skanem odhacza swoje zgłoszenie. */
export function odhaczZapowiedz(allegroReturnId: string, zwrotId: number): void {
  db()
    .prepare("UPDATE zwrot_zapowiedz SET status='dotarl', zwrot_id=? WHERE allegro_return_id=?")
    .run(zwrotId, allegroReturnId);
}

/**
 * Zgłoszenia czekające na paczkę dłużej niż próg — treść panelu „brakujące
 * paczki". Świeże zgłoszenia (paczka pewnie jeszcze jedzie) odsiewa próg,
 * nie lista: alarm o paczce nadanej wczoraj byłby szumem.
 */
export function brakujacePaczki(): WierszZapowiedzi[] {
  const prog = Date.now() - config.zwroty.brakujacaDni * DZIEN_MS;
  const wiersze = db()
    .prepare(
      `SELECT id, referencja, kupujacy_login, utworzono_allegro, waybills
       FROM zwrot_zapowiedz WHERE status='oczekuje'
       ORDER BY utworzono_allegro LIMIT 100`
    )
    .all() as Array<Record<string, unknown>>;
  return wiersze
    .map((w) => {
      const zgloszono = (w.utworzono_allegro as string) ?? null;
      const t = zgloszono ? Date.parse(zgloszono) : NaN;
      return {
        id: w.id as number,
        referencja: (w.referencja as string) ?? null,
        kupujacyLogin: (w.kupujacy_login as string) ?? null,
        zgloszono,
        waybills: JSON.parse((w.waybills as string) || "[]") as string[],
        dniOdZgloszenia: Number.isFinite(t) ? Math.floor((Date.now() - t) / DZIEN_MS) : null,
      };
    })
    .filter((w) => w.zgloszono === null || Date.parse(w.zgloszono) <= prog);
}

/** Liczby do raportu procesu: ile zgłoszeń czeka, ile z nich to już alarm. */
export function liczbyZapowiedzi(): { oczekujace: number; brakujace: number } {
  const oczekujace = (
    db().prepare("SELECT COUNT(*) AS n FROM zwrot_zapowiedz WHERE status='oczekuje'").get() as {
      n: number;
    }
  ).n;
  return { oczekujace, brakujace: brakujacePaczki().length };
}

/**
 * Pętla tickera — wołana z `main()`, nigdy z `buildApp()` (testy tras nie
 * mają prawa strzelać do Allegro). Przebieg tylko przy sensownym stanie
 * konta: dev zawsze, http dopiero po sparowaniu — inaczej log zapełniałby
 * się co pięć minut błędem o brakującym tokenie.
 */
export function uruchomTickerZapowiedzi(): void {
  if (config.zwroty.pollMs <= 0) return;
  const przebieg = () => {
    const stan = stanPolaczenia().stan;
    if (stan !== "dev" && stan !== "polaczone") return;
    odswiezZapowiedzi()
      .then((nowych) => {
        if (nowych > 0) console.log(`[zapowiedzi] nowych zgłoszeń zwrotu: ${nowych}`);
      })
      .catch((e) =>
        console.error("[zapowiedzi] przebieg nieudany:", e instanceof Error ? e.message : e)
      );
  };
  przebieg();
  setInterval(przebieg, config.zwroty.pollMs);
}
