import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { logEvent } from "./events.js";
import { linkZamowienia } from "./allegro-linki.js";
import { historiaPoLoginie, type MaszynaKlienta, type WpisHistorii } from "./klient-historia.js";
import { przesylkaZamowienia, stanPrzesylkiKrotko } from "./przesylka-zamowienia.js";
import { sprawaOtwarta } from "./statusy-spraw.js";
import { statusRozmowy } from "./conversations.js";

/* ── Profil klienta: wszystko, co z nim związane, w jednym widoku ────────────
   (24 września 2026, zgłoszenie właściciela). Historia klienta istniała od S2
   spoiwa, ale zawsze PRZY sprawie — w zakładce KLIENT rozmowy albo w szufladzie
   zwrotu. Klient jako byt nie miał adresu: nie dało się do niego wejść
   z szukania ani wkleić koledze linku „zobacz, kto to”.

   ODCZYT Z ISTNIEJĄCYCH TABEL, poza notatką. Liczby, sygnały i sprawy otwarte
   liczą się przy otwarciu z zamówień, zwrotów, spraw i rozmów. Piątej tabeli
   ze wspólnym statusem nad kolejkami nie ma — klient nie ma własnego statusu,
   ma tylko sumę swoich spraw (`CLAUDE.md`).

   TOŻSAMOŚĆ TO LOGIN, BEZ WIELKOŚCI LITER, na wszystkich kontach kanału naraz.
   Login rozmówcy to login kupującego — zweryfikował to właściciel 24 września
   2026 (`docs/allegro-ksztalt.md`). Adresu dostawy profil nie pokazuje:
   tożsamością jest login, a dokładanie pól z adresu wymaga uzasadnienia
   w `docs/obsluga-klienta.md`.

   SYGNAŁY SĄ WYLICZANE, NIE ZAPISYWANE. Sygnał zapisany trzeba by gasić przy
   każdej zmianie sprawy, a wyliczony gaśnie razem z przyczyną — ta sama zasada
   co lista „Do decyzji”. */

export type RodzajSprawyKlienta = "rozmowa" | "zwrot" | "reklamacja" | "dyskusja";

export interface SygnalKlienta {
  /** `zle` woła o ruch dziś, `uwaga` każe wiedzieć przed odpowiedzią. */
  ton: "zle" | "uwaga";
  tekst: string;
  /** Ekran, na którym przyczynę się załatwia; `null`, gdy przyczyna jest zbiorcza. */
  cel: string | null;
}

export interface OtwartaSprawa {
  rodzaj: RodzajSprawyKlienta;
  id: number;
  opis: string;
  /** Od kiedy sprawa istnieje albo ostatni ruch — do sortowania i wieku. */
  od: string;
  /** Stan jednym słowem: „czeka na nas”, „termin 25.09”… */
  stan: string;
  cel: string;
}

export interface ZamowienieKlienta {
  id: string;
  kupionoAt: string | null;
  status: string | null;
  sumaGrosze: number | null;
  waluta: string | null;
  pozycje: Array<{ nazwa: string; ilosc: number; cenaGrosze: number }>;
  /** Stan paczki kilkoma słowami; `null`, gdy nigdy nie pytaliśmy. */
  przesylka: string | null;
  link: string | null;
}

export interface NotatkaKlienta {
  tresc: string;
  at: string;
  przez: string;
  /** Czy da się cofnąć do poprzedniego brzmienia. */
  cofalna: boolean;
}

export interface ProfilKlienta {
  login: string;
  liczby: {
    zamowien: number;
    /** Suma zamówień bez anulowanych, w walucie `waluta`. */
    wydanoGrosze: number;
    waluta: string | null;
    zwrotow: number;
    reklamacji: number;
    dyskusji: number;
    rozmow: number;
    pierwszyZakup: string | null;
    ostatniZakup: string | null;
  };
  sygnaly: SygnalKlienta[];
  otwarte: OtwartaSprawa[];
  zamowienia: ZamowienieKlienta[];
  maszyny: MaszynaKlienta[];
  os: WpisHistorii[];
  notatka: NotatkaKlienta | null;
}

type Wiersz = Record<string, unknown>;
const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};
const DZIEN = 86_400_000;
const data = (at: string) => at.slice(0, 10).split("-").reverse().join(".");

const SCIEZKA: Record<RodzajSprawyKlienta, string> = {
  rozmowa: "/obsluga/skrzynka", zwrot: "/obsluga/zwroty",
  reklamacja: "/obsluga/reklamacje", dyskusja: "/obsluga/dyskusje",
};

/** Stan rozmowy dla człowieka — tylko te, które znaczą „sprawa trwa”. */
const STAN_ROZMOWY: Record<string, string> = {
  new: "nowa", open: "otwarta", waiting_for_us: "czeka na nas",
  waiting_for_customer: "czeka na klienta", waiting_for_warehouse: "czeka na halę",
  snoozed: "odłożona",
};

/**
 * Profil klienta po loginie. `null`, gdy login nie występuje nigdzie —
 * ekran mówi wtedy „nie znamy”, zamiast rysować pusty profil jak prawdziwy.
 */
export function profilKlienta(
  loginWpisany: string, teraz = new Date(), database: DatabaseSync = defaultDb(),
): ProfilKlienta | null {
  const q = loginWpisany.trim();
  if (!q) return null;

  /* Konta, na których ten login coś ma. Zwykle jedno, ale login jest unikalny
     w obrębie konta sprzedawcy, nie globalnie — historia składa się per konto. */
  const konta = (database.prepare(`
    SELECT channel_account_id AS k, kupujacy_login AS l FROM zamowienie_klienta WHERE kupujacy_login = ? COLLATE NOCASE
    UNION SELECT channel_account_id, kupujacy_login FROM zwrot_klienta WHERE kupujacy_login = ? COLLATE NOCASE
    UNION SELECT channel_account_id, kupujacy_login FROM reklamacja_klienta WHERE kupujacy_login = ? COLLATE NOCASE
    UNION SELECT c.channel_account_id, t.interlocutor_login FROM conversation c
      JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE t.interlocutor_login = ? COLLATE NOCASE`).all(q, q, q, q) as Wiersz[]);
  if (konta.length === 0) return null;
  /* Login do nagłówka tak, jak zapisało go Allegro, nie jak wpisał agent. */
  const login = String(konta[0].l);

  const maszyny: MaszynaKlienta[] = [];
  const os: WpisHistorii[] = [];
  for (const k of new Set(konta.map((w) => Number(w.k)))) {
    const h = historiaPoLoginie(k, q, database);
    maszyny.push(...h.maszyny);
    os.push(...h.wpisy);
  }
  os.sort((a, b) => b.at.localeCompare(a.at));

  const zamowienia = (database.prepare(`
    SELECT id, external_id, kupiono_at, status, suma_grosze, waluta
      FROM zamowienie_klienta WHERE kupujacy_login = ? COLLATE NOCASE
     ORDER BY kupiono_at DESC`).all(q) as Wiersz[]).map((z): ZamowienieKlienta => ({
    id: String(z.external_id),
    kupionoAt: tekst(z.kupiono_at),
    status: tekst(z.status),
    sumaGrosze: z.suma_grosze == null ? null : Number(z.suma_grosze),
    waluta: tekst(z.waluta),
    pozycje: (database.prepare(`SELECT nazwa, ilosc, cena_grosze FROM zamowienie_klienta_pozycja
        WHERE zamowienie_id = ? ORDER BY id`).all(Number(z.id)) as Wiersz[])
      .map((p) => ({ nazwa: String(p.nazwa), ilosc: Number(p.ilosc), cenaGrosze: Number(p.cena_grosze) })),
    przesylka: stanPrzesylkiKrotko(przesylkaZamowienia(database, Number(z.id))),
    link: linkZamowienia(String(z.external_id)),
  }));

  /* Anulowane NIE wchodzą do sumy: klient ich nie zapłacił, a kwota
     „wydał u nas” ma mówić o pieniądzach, które naprawdę przyszły. */
  const zaplacone = zamowienia.filter((z) => z.status !== "CANCELLED");
  const daty = zaplacone.map((z) => z.kupionoAt).filter((d): d is string => d !== null).sort();

  const otwarte: OtwartaSprawa[] = [];
  const sygnaly: SygnalKlienta[] = [];

  /* Rozmowy: każda niezakończona, ze stanem liczonym tą samą regułą co
     skrzynka (`statusRozmowy`) — dwa pojęcia „zakończona” rozjechałyby się. */
  let czekaNaNas = 0;
  for (const w of os.filter((x) => x.rodzaj === "rozmowa" && x.rozmowaId !== null)) {
    const st = statusRozmowy(database, w.rozmowaId!, teraz.getTime());
    if (st === "resolved" || st === "closed" || st === "spam") continue;
    if (st === "waiting_for_us") czekaNaNas++;
    otwarte.push({ rodzaj: "rozmowa", id: w.rozmowaId!, opis: w.tresc, od: w.at,
      stan: STAN_ROZMOWY[st] ?? st, cel: `${SCIEZKA.rozmowa}/${w.rozmowaId}` });
  }

  for (const z of database.prepare(`SELECT id, reference_number, created_at FROM zwrot_klienta
      WHERE kupujacy_login = ? COLLATE NOCASE AND zamkniety_at IS NULL`).all(q) as Wiersz[]) {
    otwarte.push({ rodzaj: "zwrot", id: Number(z.id), opis: tekst(z.reference_number) ?? "Zwrot bez numeru",
      od: String(z.created_at), stan: "w toku", cel: `${SCIEZKA.zwrot}/${z.id}` });
  }

  for (const r of database.prepare(`SELECT id, typ, reference_number, temat, status_allegro, decyzja_do,
      otwarto_at FROM reklamacja_klienta WHERE kupujacy_login = ? COLLATE NOCASE`).all(q) as Wiersz[]) {
    if (!sprawaOtwarta(tekst(r.status_allegro))) continue;
    const rodzaj = String(r.typ) === "DISPUTE" ? "dyskusja" as const : "reklamacja" as const;
    const termin = tekst(r.decyzja_do);
    const opis = tekst(r.temat) ?? tekst(r.reference_number) ?? "Sprawa bez tematu";
    const cel = `${SCIEZKA[rodzaj]}/${r.id}`;
    otwarte.push({ rodzaj, id: Number(r.id), opis, od: String(r.otwarto_at),
      stan: termin ? `termin ${data(termin)}` : "otwarta", cel });
    /* Otwarta reklamacja i dyskusja to sygnał ZŁY: każda odpowiedź klientowi
       w innej sprawie może ją pogorszyć, a termin biegnie. */
    sygnaly.push({ ton: "zle", cel,
      tekst: rodzaj === "reklamacja"
        ? `Otwarta reklamacja${termin ? `, termin ${data(termin)}` : ""}`
        : "Otwarta dyskusja w Allegro" });
  }
  otwarte.sort((a, b) => b.od.localeCompare(a.od));

  if (czekaNaNas > 0) {
    sygnaly.push({ ton: "uwaga", cel: null,
      tekst: czekaNaNas === 1 ? "Rozmowa czeka na naszą odpowiedź" : `${czekaNaNas} rozmowy czekają na naszą odpowiedź` });
  }

  /* Seria zwrotów: dwa w sześćdziesiąt dni. Jeden zwrot to zwykły handel;
     drugi w krótkim czasie każe przed odpowiedzią sprawdzić, co wraca i czemu. */
  const od60 = new Date(teraz.getTime() - 60 * DZIEN).toISOString();
  const zwrotow60 = Number((database.prepare(`SELECT count(*) n FROM zwrot_klienta
      WHERE kupujacy_login = ? COLLATE NOCASE AND created_at >= ?`).get(q, od60) as { n: number }).n);
  if (zwrotow60 >= 2) sygnaly.push({ ton: "uwaga", cel: null, tekst: `${zwrotow60} zwroty w 60 dni` });

  /* Paczka niedoręczona tydzień po zakupie — tylko gdy PYTALIŚMY przewoźnika.
     Brak daty doręczenia bez pytania znaczy „nie wiemy”, nie „nie doszła”. */
  const od7 = new Date(teraz.getTime() - 7 * DZIEN).toISOString();
  for (const z of database.prepare(`SELECT external_id, kupiono_at FROM zamowienie_klienta
      WHERE kupujacy_login = ? COLLATE NOCASE AND status = 'READY_FOR_PROCESSING'
        AND przesylka_sprawdzono_at IS NOT NULL AND przesylka_dostarczono_at IS NULL
        AND kupiono_at < ? AND kupiono_at >= ?`).all(q, od7, od60) as Wiersz[]) {
    const dni = Math.floor((teraz.getTime() - Date.parse(String(z.kupiono_at))) / DZIEN);
    sygnaly.push({ ton: "uwaga", cel: linkZamowienia(String(z.external_id)),
      tekst: `Zamówienie z ${data(String(z.kupiono_at))} niedoręczone od ${dni} dni` });
  }

  const n = database.prepare(`SELECT tresc, poprzednia, at, przez FROM klient_notatka
      WHERE login = ? COLLATE NOCASE`).get(q) as Wiersz | undefined;

  const ile = (r: WpisHistorii["rodzaj"]) => os.filter((w) => w.rodzaj === r).length;
  return {
    login,
    liczby: {
      zamowien: zamowienia.length,
      wydanoGrosze: zaplacone.reduce((s, z) => s + (z.sumaGrosze ?? 0), 0),
      waluta: zaplacone.find((z) => z.waluta)?.waluta ?? null,
      zwrotow: ile("zwrot"), reklamacji: ile("reklamacja"), dyskusji: ile("dyskusja"),
      rozmow: ile("rozmowa"),
      pierwszyZakup: daty[0] ?? null, ostatniZakup: daty[daty.length - 1] ?? null,
    },
    sygnaly, otwarte, zamowienia, maszyny, os,
    notatka: n && tekst(n.tresc)
      ? { tresc: String(n.tresc), at: String(n.at), przez: String(n.przez), cofalna: n.poprzednia != null }
      : null,
  };
}

/** Najdłuższa notatka. Jedno spojrzenie przed odpowiedzią, nie akta sprawy. */
export const LIMIT_NOTATKI = 1000;

/**
 * Zapis albo zdjęcie notatki o kliencie (`tresc` pusta = zdjęcie). Poprzednie
 * brzmienie zostaje do jednego cofnięcia. Do dziennika idzie DŁUGOŚĆ, nigdy
 * treść — `events` nie ma retencji, a notatka bywa zdaniem o człowieku
 * (ten sam wzór co notatka reklamacji).
 */
export function zapiszNotatkeKlienta(
  login: string, tresc: string | null, autor: { id: number; name: string },
  teraz = new Date(), database: DatabaseSync = defaultDb(),
): NotatkaKlienta | null {
  const l = login.trim();
  if (!l) throw new Error("Brak loginu klienta");
  const wartosc = tresc?.trim() || null;
  if (wartosc && wartosc.length > LIMIT_NOTATKI) {
    throw new Error(`Notatka ma najwyżej ${LIMIT_NOTATKI} znaków`);
  }
  const bylo = database.prepare("SELECT tresc FROM klient_notatka WHERE login = ? COLLATE NOCASE")
    .get(l) as { tresc: string | null } | undefined;
  database.prepare(`INSERT INTO klient_notatka(login, tresc, poprzednia, at, przez, przez_user_id)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(login) DO UPDATE SET tresc=excluded.tresc, poprzednia=klient_notatka.tresc,
        at=excluded.at, przez=excluded.przez, przez_user_id=excluded.przez_user_id`)
    .run(l, wartosc, bylo?.tresc ?? null, teraz.toISOString(), autor.name, autor.id);
  logEvent(wartosc === null ? "klient_notatka_zdjeta" : "klient_notatka", autor.name, null,
    { znakow: wartosc?.length ?? 0 }, autor.id, database);
  return wartosc === null ? null
    : { tresc: wartosc, at: teraz.toISOString(), przez: autor.name, cofalna: bylo?.tresc != null };
}

/** Cofa notatkę do poprzedniego brzmienia; `false`, gdy nie ma do czego. */
export function cofnijNotatkeKlienta(
  login: string, autor: { id: number; name: string },
  teraz = new Date(), database: DatabaseSync = defaultDb(),
): boolean {
  const w = database.prepare("SELECT tresc, poprzednia FROM klient_notatka WHERE login = ? COLLATE NOCASE")
    .get(login.trim()) as { tresc: string | null; poprzednia: string | null } | undefined;
  if (!w || w.poprzednia === null) return false;
  database.prepare(`UPDATE klient_notatka SET tresc=?, poprzednia=?, at=?, przez=?, przez_user_id=?
      WHERE login = ? COLLATE NOCASE`)
    .run(w.poprzednia, w.tresc, teraz.toISOString(), autor.name, autor.id, login.trim());
  logEvent("klient_notatka_cofnieta", autor.name, null, { znakow: w.poprzednia.length }, autor.id, database);
  return true;
}
