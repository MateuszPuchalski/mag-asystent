import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { sciezkaZdjecia, zapiszZdjecie } from "./foto.js";

/* ── Zgłoszenia pracowników ──────────────────────────────────────────────────
   Pracownik zgłasza z dowolnego ekranu, co mu przeszkadza, czego brakuje albo
   co nie działa. Kontrakt i decyzje właściciela: `docs/zgloszenia-pracownikow.md`.

   CZYTA TYLKO ADMIN. Bramkę roli trzyma trasa, a serwis rozdziela odczyty:
   `mojeZgloszenia` widzi wyłącznie zgłoszenia autora, `listaZgloszen` wszystkie.

   NIC Z DANYCH KLIENTA. Ekran zapisuje się bez zapytania, bo zapytanie niesie
   to, czego pracownik szukał. Do dziennika idzie numer i rodzaj, nie opis. */

export type RodzajZgloszenia = "pomysl" | "przeszkadza" | "blad";
export type ZrodloZgloszenia = "panel" | "kolektor";
export type StatusZgloszenia = "nowe" | "przyjete" | "zrobione" | "odrzucone";

const RODZAJE: readonly RodzajZgloszenia[] = ["pomysl", "przeszkadza", "blad"];
const ZRODLA: readonly ZrodloZgloszenia[] = ["panel", "kolektor"];
const STATUSY: readonly StatusZgloszenia[] = ["nowe", "przyjete", "zrobione", "odrzucone"];

const OPIS_MAX = 4000;
const EKRAN_MAX = 200;
const WERSJA_MAX = 40;
const ODPOWIEDZ_MAX = 1000;
/* Nagłówek `x-device` przychodzi z zewnątrz, więc długość tniemy sami. */
const URZADZENIE_MAX = 100;
const ZDJEC_MAX = 4;
/* Cztery zdjęcia po 1024 kB to w base64 około 5,4 MiB, więc mieszczą się
   w 6 MiB ciała trasy. Wyższy próg odpadałby na trasie kodem 413. */
const ZDJECIE_MAX_KB = 1024;
const MOJE_LIMIT = 20;

export interface Zgloszenie {
  id: number;
  rodzaj: RodzajZgloszenia;
  opis: string;
  ekran: string;
  zrodlo: ZrodloZgloszenia;
  wersja: string | null;
  urzadzenie: string | null;
  at: string;
  autor: string;
  status: StatusZgloszenia;
  odpowiedz: string | null;
  statusAt: string | null;
  statusPrzez: string | null;
  zdjecia: Array<{ id: number }>;
}

export interface NoweZgloszenie {
  rodzaj?: unknown;
  opis?: unknown;
  ekran?: unknown;
  zrodlo?: unknown;
  wersja?: unknown;
  zdjecia?: unknown;
}

export interface ZmianaStatusu {
  status?: unknown;
  odpowiedz?: unknown;
}

type Autor = { id: number; name: string };
type Wiersz = Record<string, unknown>;

/** Błąd walidacji — trasa oddaje go jako 400 z tym zdaniem. */
export class BladZgloszenia extends Error {}
/** Brak zgłoszenia — trasa oddaje 404. */
export class BrakZgloszenia extends Error {}

const teraz = () => new Date().toISOString();

function tekst(v: unknown, nazwa: string, max: number, wymagany: boolean): string | null {
  if (v == null) {
    if (wymagany) throw new BladZgloszenia(`${nazwa} jest wymagany`);
    return null;
  }
  if (typeof v !== "string") throw new BladZgloszenia(`${nazwa} musi być tekstem`);
  const t = v.trim();
  if (!t) {
    if (wymagany) throw new BladZgloszenia(`${nazwa} jest wymagany`);
    return null;
  }
  if (t.length > max) throw new BladZgloszenia(`${nazwa} może mieć najwyżej ${max} znaków`);
  return t;
}

/**
 * Ścieżka ekranu bez zapytania i kotwicy.
 *
 * Tniemy po stronie serwera, choć klient też powinien. `?szukaj=Kowalski`
 * to dane klienta, a ta kolumna nie ma prawa ich nieść bez względu na front.
 * Z tego samego powodu profil klienta traci login ze ścieżki, bo login
 * Allegro jest kluczem kupującego.
 */
export function ekranBezZapytania(v: unknown): string {
  if (typeof v !== "string") throw new BladZgloszenia("Ekran jest wymagany");
  const sciezka = v.split(/[?#]/)[0].replace(/^(\s*\/obsluga\/klient)\/[^/]+/, "$1/:login");
  return tekst(sciezka, "Ekran", EKRAN_MAX, true)!;
}

/**
 * Zdjęcia po walidacji, jako czysty base64.
 *
 * Rozmiar liczymy z DŁUGOŚCI base64, przed dekodowaniem. Bufor powstaje
 * dopiero po sprawdzeniu, więc zdjęcie ponad limit nie zajmuje pamięci.
 * Białe znaki wypadają, bo `Base64.DEFAULT` w Androidzie łamie wiersze.
 */
function zdjeciaDoZapisu(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new BladZgloszenia("Zdjęcia muszą być listą");
  if (v.length > ZDJEC_MAX) throw new BladZgloszenia(`Można dołożyć najwyżej ${ZDJEC_MAX} zdjęcia`);
  return v.map((z, i) => {
    if (typeof z !== "string") throw new BladZgloszenia(`Zdjęcie ${i + 1} nie jest obrazem`);
    const czysty = z.replace(/^data:image\/[\w.+-]+;base64,/, "").replace(/\s/g, "");
    const dopelnienie = czysty.endsWith("==") ? 2 : czysty.endsWith("=") ? 1 : 0;
    const bajtow = Math.floor((czysty.length * 3) / 4) - dopelnienie;
    if (bajtow > ZDJECIE_MAX_KB * 1024) {
      throw new BladZgloszenia(
        `Zdjęcie ${i + 1} ma ${Math.ceil(bajtow / 1024)} kB, a może mieć najwyżej ${ZDJECIE_MAX_KB} kB`);
    }
    if (!czysty || Buffer.from(czysty, "base64").length === 0) {
      throw new BladZgloszenia(`Zdjęcie ${i + 1} jest puste`);
    }
    /* Trasa oddaje plik jako `image/jpeg`, więc przyjmujemy tylko JPEG.
       `/9j/` to sygnatura FF D8 FF zapisana w base64. Oba fronty kodują
       zdjęcie do JPEG przed wysyłką, więc inny plik to pomyłka albo próba. */
    if (!czysty.startsWith("/9j/")) {
      throw new BladZgloszenia(`Zdjęcie ${i + 1} nie jest plikiem JPEG`);
    }
    return czysty;
  });
}

function usunPlik(ref: string): void {
  const p = sciezkaZdjecia(ref);
  if (!p) return;
  try {
    fs.rmSync(p);
  } catch {
    /* Sierota na dysku nie psuje niczego w bazie, a pierwotny błąd ważniejszy. */
  }
}

function zWiersza(r: Wiersz): Zgloszenie {
  const zdjecia = db()
    .prepare("SELECT id FROM zgloszenie_zdjecie WHERE zgloszenie_id = ? ORDER BY id")
    .all(r.id as number) as Array<{ id: number }>;
  return {
    id: r.id as number,
    rodzaj: r.rodzaj as RodzajZgloszenia,
    opis: r.opis as string,
    ekran: r.ekran as string,
    zrodlo: r.zrodlo as ZrodloZgloszenia,
    wersja: (r.wersja as string | null) ?? null,
    urzadzenie: (r.urzadzenie as string | null) ?? null,
    at: r.at as string,
    autor: r.autor as string,
    status: r.status as StatusZgloszenia,
    odpowiedz: (r.odpowiedz as string | null) ?? null,
    statusAt: (r.status_at as string | null) ?? null,
    statusPrzez: (r.status_przez as string | null) ?? null,
    zdjecia: zdjecia.map((z) => ({ id: Number(z.id) })),
  };
}

export function zgloszenie(id: number): Zgloszenie | null {
  const r = db().prepare("SELECT * FROM zgloszenie_pracownika WHERE id = ?").get(id) as Wiersz | undefined;
  return r ? zWiersza(r) : null;
}

/**
 * Złożenie zgłoszenia ze zdjęciami — wszystko albo nic.
 *
 * Pliki idą na dysk PRZED transakcją, bo zapis pliku nie umie się wycofać.
 * Gdy padnie plik albo baza, kasujemy pliki już zapisane i rzucamy dalej.
 * W bazie nie zostaje wtedy żaden wiersz, bo wszystkie wchodzą jedną transakcją.
 *
 * `zapisz` jest parametrem wyłącznie dla testu awarii w połowie zdjęć.
 */
export function zlozZgloszenie(
  wejscie: NoweZgloszenie | null | undefined,
  autor: Autor,
  urzadzenie: string | null,
  zapisz: (base64: string, prefiks: string) => string = zapiszZdjecie,
): Zgloszenie {
  const w: NoweZgloszenie = wejscie && typeof wejscie === "object" ? wejscie : {};
  if (!RODZAJE.includes(w.rodzaj as RodzajZgloszenia)) {
    throw new BladZgloszenia("Rodzaj zgłoszenia: pomysł, przeszkadza albo błąd");
  }
  if (!ZRODLA.includes(w.zrodlo as ZrodloZgloszenia)) {
    throw new BladZgloszenia("Źródło zgłoszenia: panel albo kolektor");
  }
  const opis = tekst(w.opis, "Opis", OPIS_MAX, true)!;
  const ekran = ekranBezZapytania(w.ekran);
  const wersja = tekst(w.wersja, "Wersja", WERSJA_MAX, false);
  const zdjecia = zdjeciaDoZapisu(w.zdjecia);
  const urz = urzadzenie?.trim().slice(0, URZADZENIE_MAX) || null;

  const zapisane: string[] = [];
  let id: number;
  try {
    /* Losowy człon w nazwie, bo `zapiszZdjecie` nazywa plik milisekundą
       i rozmiarem. Dwa zdjęcia jednej wielkości nadpisałyby się nawzajem. */
    for (const z of zdjecia) zapisane.push(zapisz(z, `zg${randomBytes(4).toString("hex")}-`));
    id = transaction(db(), () => {
      const at = teraz();
      const nowe = Number(db().prepare(
        `INSERT INTO zgloszenie_pracownika(rodzaj, opis, ekran, zrodlo, wersja, urzadzenie, at, autor, autor_user_id)
         VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(w.rodzaj as string, opis, ekran, w.zrodlo as string, wersja, urz, at, autor.name, autor.id)
        .lastInsertRowid);
      const zdjecie = db().prepare("INSERT INTO zgloszenie_zdjecie(zgloszenie_id, foto_ref, at) VALUES (?,?,?)");
      for (const ref of zapisane) zdjecie.run(nowe, ref, at);
      logEvent("zgloszenie_pracownika", autor.name, null, { id: nowe, rodzaj: w.rodzaj, zrodlo: w.zrodlo });
      return nowe;
    })();
  } catch (e) {
    for (const ref of zapisane) usunPlik(ref);
    throw e;
  }
  return zgloszenie(id)!;
}

/** Ostatnie zgłoszenia autora, najnowsze pierwsze — pracownik widzi tu odpowiedź. */
export function mojeZgloszenia(userId: number): Zgloszenie[] {
  const rows = db()
    .prepare("SELECT * FROM zgloszenie_pracownika WHERE autor_user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, MOJE_LIMIT) as Wiersz[];
  return rows.map(zWiersza);
}

/** Lista właściciela z licznikami po statusie; liczniki zawsze ze wszystkich. */
export function listaZgloszen(status?: unknown): {
  zgloszenia: Zgloszenie[];
  liczniki: Record<StatusZgloszenia, number>;
} {
  const filtr = status == null || status === "" ? null : status;
  if (filtr !== null && !STATUSY.includes(filtr as StatusZgloszenia)) {
    throw new BladZgloszenia("Nieznany status zgłoszenia");
  }
  const rows = (filtr === null
    ? db().prepare("SELECT * FROM zgloszenie_pracownika ORDER BY id DESC").all()
    : db().prepare("SELECT * FROM zgloszenie_pracownika WHERE status = ? ORDER BY id DESC").all(filtr as string)
  ) as Wiersz[];
  const liczniki: Record<StatusZgloszenia, number> = { nowe: 0, przyjete: 0, zrobione: 0, odrzucone: 0 };
  const grupy = db()
    .prepare("SELECT status, COUNT(*) AS n FROM zgloszenie_pracownika GROUP BY status")
    .all() as Array<{ status: StatusZgloszenia; n: number }>;
  for (const g of grupy) liczniki[g.status] = Number(g.n);
  return { zgloszenia: rows.map(zWiersza), liczniki };
}

/**
 * Decyzja właściciela.
 *
 * Pominięta `odpowiedz` zostawia poprzednią, pusta ją czyści. Inaczej zmiana
 * samego statusu kasowałaby zdanie, które pracownik już przeczytał.
 */
export function zmienStatus(id: number, wejscie: ZmianaStatusu | null | undefined, admin: Autor): Zgloszenie {
  const w: ZmianaStatusu = wejscie && typeof wejscie === "object" ? wejscie : {};
  if (!STATUSY.includes(w.status as StatusZgloszenia)) {
    throw new BladZgloszenia("Status: nowe, przyjęte, zrobione albo odrzucone");
  }
  const zmienOdpowiedz = w.odpowiedz !== undefined;
  const odpowiedz = zmienOdpowiedz ? tekst(w.odpowiedz, "Odpowiedź", ODPOWIEDZ_MAX, false) : null;
  transaction(db(), () => {
    const r = db().prepare(
      `UPDATE zgloszenie_pracownika
       SET status = ?, status_at = ?, status_przez = ?,
           odpowiedz = CASE WHEN ? THEN ? ELSE odpowiedz END
       WHERE id = ?`)
      .run(w.status as string, teraz(), admin.name, zmienOdpowiedz ? 1 : 0, odpowiedz, id);
    if (!r.changes) throw new BrakZgloszenia("Nie ma takiego zgłoszenia");
    logEvent("zgloszenie_pracownika_status", admin.name, null, { id, status: w.status });
  })();
  return zgloszenie(id)!;
}

/** Ścieżka pliku zdjęcia — `null`, gdy wiersz albo plik nie istnieje. */
export function sciezkaZdjeciaZgloszenia(zgloszenieId: number, zdjecieId: number): string | null {
  const r = db()
    .prepare("SELECT foto_ref FROM zgloszenie_zdjecie WHERE id = ? AND zgloszenie_id = ?")
    .get(zdjecieId, zgloszenieId) as { foto_ref: string } | undefined;
  return r ? sciezkaZdjecia(r.foto_ref) : null;
}

/**
 * Urządzenie zapisane przy logowaniu, gdy żądanie nie niesie `x-device`.
 *
 * Kolektor wysyła nagłówek przy każdym żądaniu, więc to droga zapasowa.
 * Sesja pamięta urządzenie z chwili logowania i to wystarcza do diagnozy.
 */
export function urzadzenieSesji(token: string | null): string | null {
  if (!token) return null;
  const r = db().prepare("SELECT device_id FROM device_session WHERE token = ?").get(token) as
    | { device_id: string | null }
    | undefined;
  return r?.device_id ?? null;
}
