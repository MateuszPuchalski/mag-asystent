import { db } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Szukanie zgubionego kolektora ───────────────────────────────────────────
   ZGŁOSZENIE WŁAŚCICIELA: magazynier odkłada kolektor „na chwilę" na regale,
   na wózku albo w kartonie i zapomina gdzie. Ktoś inny — biuro z panelu albo
   kolega z własnego kolektora — ma móc kazać mu zadzwonić.

   KANAŁ JEST ODWROTNY, BO INNEGO NIE MA. Serwer nie umie zawołać kolektora:
   aplikacja jedzie po sieci magazynu, bez usług Google i bez gniazda, które
   serwer mógłby otworzyć. Wezwanie czeka więc tutaj, a kolektor sam pyta
   o nie co kilka sekund (`WezwanieRepository` po stronie Androida).

   STAN WEZWANIA ŻYJE W PAMIĘCI PROCESU, nie w SQLite — ten sam kształt co
   obecność w `conversation-realtime.ts`. Powody są dwa:
   - pytanie kolektora co 10 s nie może zapisywać do bazy, bo to jest
     patrzenie („zero zapisu przy patrzeniu"), a potwierdzenie odebrania
     jest skutkiem tego pytania;
   - wezwanie żyje minuty. Zapisane stałoby się stanem, który po restarcie
     usługi kazałby dzwonić kolektorowi odnalezionemu wczoraj.
   Ślad zostaje mimo to: wezwanie, odwołanie i odnalezienie idą do audytu.
   Restart w trakcie szukania gubi wezwanie — wtedy naciska się jeszcze raz. */

/** Jak długo wezwanie czeka i dzwoni. Dłużej hałas przestaje pomagać. */
export const CZAS_WEZWANIA_MS = 5 * 60_000;

/**
 * Po jakim czasie bez pytania kolektor przestaje „słuchać".
 *
 * Kolektor pyta co 10 s. Trzy przegapione pytania to już nie przypadek
 * w sieci, tylko uśpione urządzenie, padnięta bateria albo wylogowanie.
 * Szukający ma to wiedzieć, zanim zacznie nasłuchiwać ciszy.
 */
export const SLUCHA_MS = 35_000;

/**
 * Z jakiego okna lista bierze urządzenia.
 *
 * Kolektor z sesją sprzed miesiąca nie jest zgubiony, tylko wycofany. Jego
 * wiersz byłby szumem przy wyborze — a wybór jest jedyną decyzją tego ekranu.
 */
const OKNO_LISTY_DNI = 30;

interface Wezwanie {
  od: number;
  przez: string;
  doKiedy: number;
  odebrane: number | null;
}

const wezwania = new Map<string, Wezwanie>();
const odzew = new Map<string, number>();

/** Dla testów: stan procesu nie może przeciekać między przypadkami. */
export function wyczyscSzukanie(): void {
  wezwania.clear();
  odzew.clear();
}

/**
 * Krótki znak urządzenia, np. `#A3F9`.
 *
 * `device_id` to UUID z instalacji aplikacji — nikt go nie przeczyta na
 * głos. Cztery ostatnie znaki wystarczą, żeby odróżnić kilka kolektorów
 * w jednej hali, i da się je nakleić na obudowę. Kolektor liczy ten sam
 * znak u siebie (`etykietaKolektora` w `:core`) i obie reguły muszą być
 * identyczne, bo człowiek porównuje napis z ekranu z naklejką.
 */
export function etykietaUrzadzenia(deviceId: string): string {
  const znaki = deviceId.replace(/[^0-9a-z]/gi, "").toUpperCase();
  return "#" + (znaki.slice(-4) || "????");
}

export interface WezwanieWidok {
  przez: string;
  od: string;
  doKiedy: string;
  /** Kolektor zapytał od chwili wezwania, czyli dzwoni. */
  odebrane: boolean;
}

export interface Kolektor {
  deviceId: string;
  etykieta: string;
  /** Kto był zalogowany ostatnio — po tym człowiek poznaje „swój" kolektor. */
  osoba: string | null;
  /** Sesja nadal czynna. Wylogowany kolektor nie pyta o wezwania. */
  zalogowany: boolean;
  ostatnioWidziany: string | null;
  /** Zapytał o wezwanie w ostatnich `SLUCHA_MS`, czyli zadzwoni od razu. */
  slucha: boolean;
  wezwanie: WezwanieWidok | null;
}

/** Wezwanie, które już minęło, znika przy pierwszym dotknięciu. */
function zywe(deviceId: string, teraz: number): Wezwanie | null {
  const w = wezwania.get(deviceId);
  if (!w) return null;
  if (w.doKiedy <= teraz) {
    wezwania.delete(deviceId);
    return null;
  }
  return w;
}

const widok = (w: Wezwanie): WezwanieWidok => ({
  przez: w.przez,
  od: new Date(w.od).toISOString(),
  doKiedy: new Date(w.doKiedy).toISOString(),
  odebrane: w.odebrane != null,
});

/**
 * Kolektory, które da się wezwać — z sesji urządzeń.
 *
 * Osobnej tabeli urządzeń nie ma i tu jej nie zakładamy: `device_session`
 * zna każdy kolektor, na którym ktoś się zalogował, razem z osobą i czasem.
 * Sesje panelu nie niosą `x-device`, więc ich tu nie ma, i to jest dobrze.
 */
export function kolektory(teraz = Date.now()): Kolektor[] {
  const od = new Date(teraz - OKNO_LISTY_DNI * 86_400_000).toISOString();
  const wiersze = db()
    .prepare(
      `SELECT s.device_id AS deviceId, s.last_seen AS lastSeen, s.revoked_at AS revokedAt, u.name AS osoba
         FROM device_session s LEFT JOIN app_user u ON u.user_id = s.user_id
        WHERE s.device_id IS NOT NULL AND s.device_id != '' AND s.last_seen >= ?
        ORDER BY s.last_seen DESC, s.created_at DESC`
    )
    .all(od) as Array<{ deviceId: string; lastSeen: string; revokedAt: string | null; osoba: string | null }>;

  const wynik = new Map<string, Kolektor>();
  for (const r of wiersze) {
    const juz = wynik.get(r.deviceId);
    if (juz) {
      // pierwszy wiersz jest najświeższy; starsza czynna sesja nadal znaczy
      // „zalogowany", bo kolektor pyta z tej sesji, której token trzyma
      if (!r.revokedAt) juz.zalogowany = true;
      continue;
    }
    const w = zywe(r.deviceId, teraz);
    const ostatni = odzew.get(r.deviceId);
    wynik.set(r.deviceId, {
      deviceId: r.deviceId,
      etykieta: etykietaUrzadzenia(r.deviceId),
      osoba: r.osoba,
      zalogowany: !r.revokedAt,
      ostatnioWidziany: r.lastSeen,
      slucha: ostatni != null && teraz - ostatni <= SLUCHA_MS,
      wezwanie: w ? widok(w) : null,
    });
  }
  return [...wynik.values()];
}

/**
 * Każ kolektorowi dzwonić. Ponowne wezwanie przedłuża czas, nie dubluje.
 *
 * Wolno każdemu zalogowanemu, także magazynierowi: kolektora najczęściej
 * szuka kolega z hali, a nie biuro. Nadużycie widać w audycie z nazwiskiem.
 */
export function wezwij(deviceId: string, kto: string, teraz = Date.now()): Kolektor | { error: string } {
  /* Wezwać można tylko to, co stoi na liście. Kolektor spoza okna listy
     dostałby wezwanie, którego żaden ekran by nie pokazał — ani „dzwoni",
     ani przycisku PRZESTAŃ. */
  if (!kolektory(teraz).some((k) => k.deviceId === deviceId)) {
    return { error: "Nie znam takiego kolektora." };
  }
  const bylo = zywe(deviceId, teraz);
  wezwania.set(deviceId, {
    od: bylo?.od ?? teraz,
    przez: kto,
    doKiedy: teraz + CZAS_WEZWANIA_MS,
    odebrane: bylo?.odebrane ?? null,
  });
  logEvent("kolektor_wezwany", kto, null, {
    deviceId,
    etykieta: etykietaUrzadzenia(deviceId),
    ponownie: bylo != null,
  });
  return kolektory(teraz).find((k) => k.deviceId === deviceId)!;
}

/**
 * Koniec szukania — z kolektora („ZNALAZŁEM") albo od szukającego.
 *
 * To dwa różne zdarzenia w audycie, bo odpowiadają na różne pytania:
 * odnalezienie mówi, że hałas zadziałał, odwołanie — że ktoś się poddał
 * albo znalazł kolektor inaczej.
 */
export function zakonczSzukanie(
  deviceId: string,
  kto: string,
  zUrzadzenia: boolean,
  teraz = Date.now()
): { bylo: boolean } {
  const w = zywe(deviceId, teraz);
  if (!w) return { bylo: false };
  wezwania.delete(deviceId);
  logEvent(zUrzadzenia ? "kolektor_odnaleziony" : "kolektor_wezwanie_odwolane", kto, null, {
    deviceId,
    etykieta: etykietaUrzadzenia(deviceId),
    wezwal: w.przez,
    poSekundach: Math.round((teraz - w.od) / 1000),
  });
  return { bylo: true };
}

/**
 * Pytanie kolektora o własne wezwanie. Odnotowuje odzew — w pamięci.
 *
 * Pierwsze pytanie po wezwaniu oznacza je jako odebrane, żeby szukający
 * wiedział, że kolektor naprawdę dzwoni, a nie tylko „powinien".
 */
export function sprawdzWezwanie(deviceId: string, teraz = Date.now()): WezwanieWidok | null {
  odzew.set(deviceId, teraz);
  const w = zywe(deviceId, teraz);
  if (!w) return null;
  if (w.odebrane == null) w.odebrane = teraz;
  return widok(w);
}
