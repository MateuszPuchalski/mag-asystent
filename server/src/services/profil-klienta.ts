import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "../db/db.js";
import { logEvent } from "./events.js";
import { linkZamowienia } from "./allegro-linki.js";
import { historiaPoLoginie, kontaLoginu, type MaszynaKlienta, type WpisHistorii } from "./klient-historia.js";
import { przesylkaZamowienia, stanPrzesylkiKrotko } from "./przesylka-zamowienia.js";
import { sprawaOtwarta } from "./statusy-spraw.js";
import { statusRozmowy } from "./conversations.js";
import { sprawaKlienta, type SprawaKlienta } from "./prowadzenie-klienta.js";
import { chwilaUtc } from "../czas.js";
import { jestKodemDosylki, OKNO_SLEDZENIA_MS, type KodDosylki } from "./dosylka-opis.js";

/* ── Profil klienta: wszystko, co z nim związane, w jednym widoku ────────────
   (24 września 2026, zgłoszenie właściciela). Historia klienta istniała od S2
   spoiwa, ale zawsze PRZY sprawie — w zakładce KLIENT rozmowy albo w szufladzie
   zwrotu. Klient jako byt nie miał adresu: nie dało się do niego wejść
   z szukania ani wkleić koledze linku „zobacz, kto to”.

   ODCZYT Z ISTNIEJĄCYCH TABEL, poza notatką i sprawą klienta. Liczby, sygnały
   i sprawy otwarte liczą się przy otwarciu z zamówień, zwrotów, spraw
   i rozmów. Piątej tabeli ze wspólnym statusem nad kolejkami nie ma i nie
   będzie. Sprawa klienta (0.535.0, S6) nim nie jest: nie zbiera statusów
   kolejek, tylko niesie NASZ następny krok z terminem i prowadzącego — to,
   czego żadna kolejka nie wie, bo „czekamy na zwrot, potem dosyłamy”
   przechodzi przez kilka z nich. Powód i granice w `prowadzenie-klienta.ts`.

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
  /** Sprawa klienta (S6): krok, termin, prowadzący; `null`, gdy nikt jej nie założył. */
  sprawa: SprawaKlienta | null;
  /**
   * Podpowiedź „Zakończ sprawę?”: sprawa w toku, w kolejkach nic otwartego,
   * a termin kroku nadszedł. Wcześniej podpowiedź pchałaby do zamknięcia
   * sprawy, na której krok jeszcze się nie spełnił.
   */
  podpowiedzZakonczenia: boolean;
  /**
   * Czemu podpowiedź stoi (@wydanie). „dosylka”: poprawny towar doszedł, więc
   * wymiana się spełniła, choć termin kroku jeszcze nie nadszedł. Boolean
   * obok zostaje, bo czytają go ekran i testy sprzed tego wydania.
   */
  podpowiedzPowod: "termin" | "dosylka" | null;
  /**
   * Odmowa wypłaty z kodem dosyłki, której nikt nie śledzi — droga ponowienia,
   * gdy założenie przy odmowie nie doszło, i kodów odmowy z panelu Allegro.
   */
  propozycjaDosylki: { zwrotId: number; zamowienie: string; kod: KodDosylki; odmowaAt: string | null } | null;
  /** Przewoźnicy znani z naszej bazy, bez powtórzeń i po kolei — opcje formularza numeru dosyłki. */
  przewoznicy: string[];
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

  /* Konta, na których ten login coś ma — wspólne ze sprawą klienta
     (`kontaLoginu`), żeby obie strony znały tego samego klienta. */
  const konta = kontaLoginu(database, q);
  if (konta.length === 0) return null;
  /* Login do nagłówka tak, jak zapisało go Allegro, nie jak wpisał agent. */
  const login = konta[0].login;

  const maszyny: MaszynaKlienta[] = [];
  const os: WpisHistorii[] = [];
  for (const k of new Set(konta.map((w) => w.konto))) {
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
     Brak daty doręczenia bez pytania znaczy „nie wiemy”, nie „nie doszła”.
     Zamówienie z dosyłką (@wydanie) odpada: sygnał mówi o PIERWSZEJ paczce,
     a los towaru tego zamówienia niesie już dosyłka na karcie sprawy.
     Zdanie „niedoręczone” obok „Dosyłka doręczona” przeczyłoby samo sobie. */
  const od7 = new Date(teraz.getTime() - 7 * DZIEN).toISOString();
  for (const z of database.prepare(`SELECT o.external_id, o.kupiono_at FROM zamowienie_klienta o
      WHERE o.kupujacy_login = ? COLLATE NOCASE AND o.status = 'READY_FOR_PROCESSING'
        AND o.przesylka_sprawdzono_at IS NOT NULL AND o.przesylka_dostarczono_at IS NULL
        AND o.kupiono_at < ? AND o.kupiono_at >= ?
        AND NOT EXISTS (SELECT 1 FROM klient_dosylka d
                         WHERE d.konto = o.channel_account_id AND d.zamowienie = o.external_id)`)
    .all(q, od7, od60) as Wiersz[]) {
    const dni = Math.floor((teraz.getTime() - Date.parse(String(z.kupiono_at))) / DZIEN);
    sygnaly.push({ ton: "uwaga", cel: linkZamowienia(String(z.external_id)),
      tekst: `Zamówienie z ${data(String(z.kupiono_at))} niedoręczone od ${dni} dni` });
  }

  const n = database.prepare(`SELECT tresc, poprzednia, at, przez FROM klient_notatka
      WHERE login = ? COLLATE NOCASE`).get(q) as Wiersz | undefined;

  const ile = (r: WpisHistorii["rodzaj"]) => os.filter((w) => w.rodzaj === r).length;
  const sprawa = sprawaKlienta(q, teraz, database);
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
    sprawa,
    ...podpowiedz(database, sprawa, otwarte),
    propozycjaDosylki: propozycjaDosylki(database, q, sprawa, teraz),
    przewoznicy: przewoznicy(database),
  };
}

/**
 * Podpowiedź „Zakończ sprawę?” i jej powód.
 *
 * „dosylka” wygrywa z „termin”, gdy obie zachodzą: doręczenie mówi, CZEMU
 * krok się spełnił, a termin tylko, że minął czas.
 *
 * Otwarty zwrot z TEGO SAMEGO zamówienia nie gasi podpowiedzi dosyłki.
 * Zwrot przy wymianie nie dostaje korekty, bo pieniędzy się nie oddaje,
 * więc stoi otwarty na zawsze — i gasiłby podpowiedź na zawsze. Każda inna
 * sprawa w kolejkach gasi ją jak przy terminie.
 */
function podpowiedz(
  database: DatabaseSync, sprawa: SprawaKlienta | null, otwarte: OtwartaSprawa[],
): { podpowiedzZakonczenia: boolean; podpowiedzPowod: "termin" | "dosylka" | null } {
  const nic = { podpowiedzZakonczenia: false, podpowiedzPowod: null };
  if (!sprawa || sprawa.stan !== "w_toku") return nic;
  const doreczone = new Set(sprawa.dosylki.filter((d) => d.dostarczonoAt).map((d) => d.zamowienie));
  if (doreczone.size > 0) {
    const zwrotyWymiany = new Set((database.prepare(`SELECT id, order_id FROM zwrot_klienta
        WHERE kupujacy_login = ? COLLATE NOCASE AND zamkniety_at IS NULL`).all(sprawa.login) as Wiersz[])
      .filter((z) => doreczone.has(String(z.order_id))).map((z) => Number(z.id)));
    if (otwarte.every((o) => o.rodzaj === "zwrot" && zwrotyWymiany.has(o.id))) {
      return { podpowiedzZakonczenia: true, podpowiedzPowod: "dosylka" };
    }
  }
  if (otwarte.length === 0 && (sprawa.dzis || sprawa.poTerminie)) {
    return { podpowiedzZakonczenia: true, podpowiedzPowod: "termin" };
  }
  return nic;
}

/**
 * Odmowa wypłaty z kodem dosyłki, której nikt nie śledzi — najnowsza
 * z trzydziestu dni. ODCZYT: przycisk przy propozycji zakłada dosyłkę
 * dopiero kliknięciem (`POST …/sprawa/dosylka`).
 *
 * Wiek odmowy liczy się od NASZEJ odmowy, a przy kodzie z panelu Allegro od
 * daty odmowy w lądowisku, w ostateczności od zgłoszenia zwrotu. Nigdy od
 * `zwrot_klienta.created_at`: mapowanie podstawia tam czas synchronizacji,
 * gdy Allegro daty nie poda — i stara odmowa udawałaby świeżą.
 */
function propozycjaDosylki(
  database: DatabaseSync, login: string, sprawa: SprawaKlienta | null, teraz: Date,
): ProfilKlienta["propozycjaDosylki"] {
  const kandydaci = database.prepare(`
    SELECT z.id, z.order_id, z.channel_account_id, z.odmowa_kod, z.rejection_code, z.odmowa_at,
           json_extract(a.surowe_json, '$.rejection.createdAt') AS odrzucono_allegro,
           json_extract(a.surowe_json, '$.createdAt') AS zgloszono_allegro
      FROM zwrot_klienta z LEFT JOIN allegro_zwrot a ON a.id = z.external_id
     WHERE z.kupujacy_login = ? COLLATE NOCASE AND z.order_id IS NOT NULL
       AND (z.odmowa_kod IN ('NEW_ITEM_SENT','MISSING_PART_SENT')
            OR z.rejection_code IN ('NEW_ITEM_SENT','MISSING_PART_SENT'))`).all(login) as Wiersz[];
  const granica = teraz.getTime() - OKNO_SLEDZENIA_MS;
  const propozycje = kandydaci.map((z) => {
    const kod = jestKodemDosylki(z.odmowa_kod) ? z.odmowa_kod : z.rejection_code as KodDosylki;
    const kiedy = [z.odmowa_at, z.odrzucono_allegro, z.zgloszono_allegro]
      .map((v) => (v == null ? null : String(v))).find((v) => v !== null && Number.isFinite(chwilaUtc(v))) ?? null;
    return { z, kod, kiedy, t: kiedy === null ? Number.NaN : chwilaUtc(kiedy) };
  })
    /* Bez żadnej daty Allegro odmowy nie da się umieścić w oknie — a stara
       odmowa podana jako świeża namawiałaby do śledzenia paczki sprzed miesięcy. */
    .filter((x) => Number.isFinite(x.t) && x.t >= granica)
    .filter((x) => !(sprawa && database.prepare(`SELECT 1 FROM klient_dosylka WHERE sprawa_id = ? AND zamowienie = ?`)
      .get(sprawa.id, String(x.z.order_id))))
    .sort((a, b) => b.t - a.t);
  const p = propozycje[0];
  return p ? {
    zwrotId: Number(p.z.id), zamowienie: String(p.z.order_id), kod: p.kod,
    odmowaAt: p.z.odmowa_at == null ? tekst(p.z.odrzucono_allegro) : String(p.z.odmowa_at),
  } : null;
}

/**
 * Przewoźnicy, których już widzieliśmy — przy zamówieniach, zwrotach
 * i dosyłkach. Lista zamiast pola tekstowego, bo `carrierId` trafia do
 * adresu trackingu i literówka dałaby dosyłkę, o którą nikt nie umie spytać.
 */
function przewoznicy(database: DatabaseSync): string[] {
  return (database.prepare(`
    SELECT przesylka_przewoznik AS p FROM zamowienie_klienta WHERE przesylka_przewoznik IS NOT NULL
    UNION SELECT przewoznik FROM zwrot_klienta WHERE przewoznik IS NOT NULL
    UNION SELECT przewoznik FROM klient_dosylka WHERE przewoznik IS NOT NULL`).all() as Wiersz[])
    .map((w) => String(w.p).trim()).filter((p) => p !== "")
    .filter((p, i, t) => t.indexOf(p) === i)
    .sort((a, b) => a.localeCompare(b));
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
