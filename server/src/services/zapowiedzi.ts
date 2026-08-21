import { db, nowIso } from "../db/db.js";
import { config } from "../config.js";
import { allegroAdapter } from "../adapters/allegro.js";
import { stanPolaczenia } from "./allegro-token.js";
import { logEvent } from "./events.js";
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

/**
 * Ile oczekujących zgłoszeń odświeżamy PO ID w jednym przebiegu.
 *
 * Lista zwrotów filtruje po dacie UTWORZENIA, więc zgłoszenie sprzed miesiąca
 * nigdy nie wraca w oknie przyrostowym — a jego status w Allegro zmienia się
 * dalej. Bez tego kroku zwrot doręczony i rozliczony wisiał u nas jako
 * „w drodze" bez końca (zgłoszenie z produkcji, 29YN/2026). Sufit jest po to,
 * żeby zaległość z wdrożenia rozłożyła się na kilka przebiegów zamiast
 * wystrzelić setką zapytań naraz.
 */
const ODSWIEZ_NA_PRZEBIEG = 25;

/** Po ilu godzinach status oczekującego zgłoszenia uznajemy za nieświeży. */
const SWIEZOSC_H = 1;

/**
 * Co Allegro sądzi o zgłoszeniu — trzy odpowiedzi, bo trzy różne działania.
 *
 *   zamknieta  sprawa skończona ALBO towar pojechał do magazynu Allegro;
 *              nie czekamy na nic i nie ma o czym alarmować
 *   doreczona  przewoźnik dostarczył, a u nas NIKT tego nie zeskanował —
 *              paczka leży gdzieś w firmie nieprzyjęta; alarm natychmiast
 *   w_drodze   jeszcze jedzie (albo status nieznany) — alarm dopiero po progu
 *
 * Statusy własne Allegro (`GET /order/customer-returns`): CREATED, IN_TRANSIT,
 * DELIVERED, FINISHED, FINISHED_APT, REJECTED, COMMISSION_REFUND_CLAIMED,
 * COMMISSION_REFUNDED, WAREHOUSE_DELIVERED, WAREHOUSE_VERIFICATION.
 */
export type StanZgloszenia = "zamknieta" | "doreczona" | "w_drodze";

/* Sprawy, na które nie czekamy. FINISHED/REJECTED mówią to wprost. Statusy
   COMMISSION_* znaczą, że pieniądze już się rozliczyły — na zwrocie 2905/2026
   (10 sierpnia 2026) prowizja wróciła po zakończonym zwrocie i to właśnie taki
   zwrot wisiał u nas jako „brakująca paczka" jedenaście dni. WAREHOUSE_* to
   towar dostarczony do magazynu ALLEGRO, czyli nie do nas — też nie czekamy. */
const STATUSY_ZAMKNIETE = new Set([
  "FINISHED", "FINISHED_APT", "REJECTED",
  "COMMISSION_REFUND_CLAIMED", "COMMISSION_REFUNDED",
  "WAREHOUSE_DELIVERED", "WAREHOUSE_VERIFICATION",
]);

/** Przewoźnik dostarczył do NAS — od tej chwili brak skanu jest alarmem. */
const STATUSY_DORECZONE = new Set(["DELIVERED"]);

/**
 * Stan zgłoszenia z surowego statusu Allegro. Nieznany status (nowa wartość,
 * pusty odczyt) daje `w_drodze` ŚWIADOMIE: lepiej pokazać zgłoszenie, które
 * nie wymaga uwagi, niż ukryć paczkę, która naprawdę zaginęła. Czysta funkcja
 * — eksport dla testów.
 */
export function stanZgloszenia(statusAllegro: string | null): StanZgloszenia {
  const s = (statusAllegro ?? "").trim().toUpperCase();
  if (STATUSY_ZAMKNIETE.has(s)) return "zamknieta";
  if (STATUSY_DORECZONE.has(s)) return "doreczona";
  return "w_drodze";
}

export interface WierszZapowiedzi {
  id: number;
  referencja: string | null;
  kupujacyLogin: string | null;
  zgloszono: string | null;
  waybills: string[];
  dniOdZgloszenia: number | null;
  /** Dlaczego wiersz jest na liście — steruje kolorem i pilnością w biurze. */
  stan: StanZgloszenia;
  /** Surowy status z Allegro — na ekranie obok, żeby dało się zweryfikować regułę. */
  statusAllegro: string | null;
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
                                 utworzono_allegro, waybills, status, status_allegro,
                                 zwrot_id, widziano_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(allegro_return_id) DO UPDATE SET
       referencja=excluded.referencja, kupujacy_login=excluded.kupujacy_login,
       utworzono_allegro=excluded.utworzono_allegro, waybills=excluded.waybills,
       status_allegro=excluded.status_allegro,
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
      /* Status z Allegro nadpisujemy przy KAŻDYM przebiegu — to on decyduje,
         czy zgłoszenie dalej jest alarmem, a zmienia się bez naszego udziału. */
      z.status,
      zwrot?.id ?? null,
      teraz
    );
  }
  return nowych;
}

/**
 * Odświeżenie statusów zgłoszeń, które wciąż czekają na paczkę.
 *
 * Pyta o KAŻDE z osobna (`GET /order/customer-returns/{id}`), bo lista tego
 * nie pokaże: filtruje po dacie utworzenia, a te zgłoszenia są starsze niż
 * okno przyrostowe. Zwrot, którego Allegro już nie zna, dostaje tylko nowy
 * znacznik `widziano_at` — wraca na koniec kolejki zamiast blokować ją co
 * pięć minut. Zwraca liczbę odświeżonych — do logu tickera.
 */
export async function odswiezStatusyOczekujacych(): Promise<number> {
  const d = db();
  const prog = new Date(Date.now() - SWIEZOSC_H * 3_600_000).toISOString();
  const wiersze = d
    .prepare(
      `SELECT id, allegro_return_id FROM zwrot_zapowiedz
        WHERE status='oczekuje' AND widziano_at < ?
        ORDER BY widziano_at LIMIT ?`
    )
    .all(prog, ODSWIEZ_NA_PRZEBIEG) as Array<{ id: number; allegro_return_id: string }>;

  const zapisz = d.prepare(
    "UPDATE zwrot_zapowiedz SET status_allegro=?, waybills=?, widziano_at=? WHERE id=?"
  );
  const tylkoZnacznik = d.prepare("UPDATE zwrot_zapowiedz SET widziano_at=? WHERE id=?");
  let odswiezonych = 0;
  let bledow = 0;
  let ostatniBlad: string | null = null;
  for (const w of wiersze) {
    try {
      const z = await allegroAdapter().zwrot(w.allegro_return_id);
      if (!z) {
        /* Allegro nie zna już tego zwrotu. Znacznik przesuwamy, żeby wrócił
           na koniec kolejki zamiast zajmować miejsce co pięć minut. */
        tylkoZnacznik.run(nowIso(), w.id);
        continue;
      }
      zapisz.run(z.status, JSON.stringify(wszystkieWaybille(z)), nowIso(), w.id);
      odswiezonych++;
    } catch (e) {
      /* JEDNO zgłoszenie nie ma prawa zatrzymać całej partii. Bez tego łapania
         pierwszy zwrot kończący się błędem (403, timeout, awaria Allegro)
         przerywał przebieg i cała reszta NIGDY nie dostawała statusu — a wygląda
         to identycznie jak „ticker nie działa". Znacznika tu NIE ruszamy:
         błąd bywa chwilowy i ten sam wiersz ma wrócić przy kolejnym przebiegu. */
      bledow++;
      ostatniBlad = e instanceof Error ? e.message : String(e);
    }
  }
  stanTickera = {
    at: nowIso(),
    odswiezonych,
    bledow,
    ostatniBlad,
    doOdswiezenia: (
      d
        .prepare(
          "SELECT COUNT(*) AS n FROM zwrot_zapowiedz WHERE status='oczekuje' AND status_allegro IS NULL"
        )
        .get() as { n: number }
    ).n,
  };
  return odswiezonych;
}

/**
 * Ślad ostatniego przebiegu odświeżania — na ekran biura.
 *
 * Bez niego pytanie „czemu ten wiersz wciąż nie ma statusu" nie ma jak dostać
 * odpowiedzi: nie widać ani czy ticker w ogóle chodzi, ani czy Allegro
 * odmawia. `doOdswiezenia` mówi wprost, ile zgłoszeń czeka jeszcze w kolejce.
 */
export interface StanTickera {
  at: string;
  odswiezonych: number;
  bledow: number;
  ostatniBlad: string | null;
  doOdswiezenia: number;
}

let stanTickera: StanTickera | null = null;

export function stanOdswiezania(): StanTickera | null {
  return stanTickera;
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

/** Wszystkie zgłoszenia wciąż oczekujące — z klasyfikacją i wiekiem. */
function oczekujace(): WierszZapowiedzi[] {
  const wiersze = db()
    .prepare(
      `SELECT id, referencja, kupujacy_login, utworzono_allegro, waybills, status_allegro
       FROM zwrot_zapowiedz WHERE status='oczekuje'
       ORDER BY utworzono_allegro LIMIT 200`
    )
    .all() as Array<Record<string, unknown>>;
  return wiersze.map((w) => {
    const zgloszono = (w.utworzono_allegro as string) ?? null;
    const t = zgloszono ? Date.parse(zgloszono) : NaN;
    const statusAllegro = (w.status_allegro as string) ?? null;
    return {
      id: w.id as number,
      referencja: (w.referencja as string) ?? null,
      kupujacyLogin: (w.kupujacy_login as string) ?? null,
      zgloszono,
      waybills: JSON.parse((w.waybills as string) || "[]") as string[],
      dniOdZgloszenia: Number.isFinite(t) ? Math.floor((Date.now() - t) / DZIEN_MS) : null,
      stan: stanZgloszenia(statusAllegro),
      statusAllegro,
    };
  });
}

/**
 * Treść panelu „brakujące paczki" — DWA różne alarmy, nie jeden.
 *
 * Paczka DORĘCZONA, której nikt u nas nie zeskanował, leży gdzieś w firmie
 * nieprzyjęta i jest alarmem od razu — próg dni jej nie dotyczy. Zgłoszenie
 * wciąż w drodze to zwykłe czekanie i alarmem staje się dopiero po progu,
 * bo inaczej lista wypełniłaby się paczkami nadanymi wczoraj.
 *
 * Sprawy, które Allegro uważa za zamknięte, nie trafiają tu wcale: to one
 * zrobiły z tej karty listę fałszywych alarmów zaraz po wdrożeniu (zwroty
 * rozliczone w panelu, zanim aplikacja w ogóle o nich wiedziała).
 */
export function brakujacePaczki(): WierszZapowiedzi[] {
  const prog = Date.now() - config.zwroty.brakujacaDni * DZIEN_MS;
  return oczekujace()
    .filter((w) => {
      if (w.stan === "zamknieta") return false;
      if (w.stan === "doreczona") return true;
      return w.zgloszono === null || Date.parse(w.zgloszono) <= prog;
    })
    /* Doręczone na górze: tam paczka jest już fizycznie u nas, a wiersz niżej
       mówi tylko, że kurier jeszcze jedzie. */
    .sort((a, b) => Number(b.stan === "doreczona") - Number(a.stan === "doreczona"));
}

/**
 * Zdjęcie zgłoszenia z listy ręką — sprawa załatwiona poza aplikacją albo
 * paczka, która nigdy nie dojedzie. Decyzja człowieka, więc zostaje w audycie;
 * zwrot da się mimo to przyjąć skanem, bo szybka ścieżka pyta o numer paczki,
 * nie o status wiersza. `false` = nie ma czego pomijać (wołający robi 404).
 */
export function pominZapowiedz(id: number, autor: string): boolean {
  const w = db()
    .prepare("SELECT allegro_return_id FROM zwrot_zapowiedz WHERE id = ? AND status = 'oczekuje'")
    .get(id) as { allegro_return_id: string } | undefined;
  if (!w) return false;
  db().prepare("UPDATE zwrot_zapowiedz SET status='pominieta' WHERE id=?").run(id);
  logEvent("zapowiedz_pominieta", autor, null, { id, allegroReturnId: w.allegro_return_id });
  return true;
}

/** Liczby do raportu procesu: ile zgłoszeń czeka, ile z nich to już alarm. */
export function liczbyZapowiedzi(): {
  oczekujace: number;
  brakujace: number;
  doreczoneNieprzyjete: number;
} {
  /* „Oczekujące" liczy tylko te, na które NAPRAWDĘ czekamy — zgłoszenie
     zamknięte w panelu Allegro nie jest naszą pracą, choć wiersz jeszcze stoi. */
  const czekajace = oczekujace().filter((w) => w.stan !== "zamknieta");
  const alarmy = brakujacePaczki();
  return {
    oczekujace: czekajace.length,
    brakujace: alarmy.length,
    doreczoneNieprzyjete: alarmy.filter((w) => w.stan === "doreczona").length,
  };
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
      .then(async (nowych) => {
        if (nowych > 0) console.log(`[zapowiedzi] nowych zgłoszeń zwrotu: ${nowych}`);
        /* Po nowych — statusy tych, które wciąż czekają. Kolejność jest bez
           znaczenia, ale jedno `catch` na oba kroki wystarcza. */
        const odswiezonych = await odswiezStatusyOczekujacych();
        if (odswiezonych > 0) console.log(`[zapowiedzi] odświeżonych statusów: ${odswiezonych}`);
      })
      .catch((e) =>
        console.error("[zapowiedzi] przebieg nieudany:", e instanceof Error ? e.message : e)
      );
  };
  przebieg();
  setInterval(przebieg, config.zwroty.pollMs);
}
