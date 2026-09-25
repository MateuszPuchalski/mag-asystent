import { db as defaultDb, type Db } from "../db/db.js";
import { linkZamowienia } from "./allegro-linki.js";
import { ROZMOWA_ZAMOWIENIA } from "./droga-klienta.js";

/* ── Jedno szukanie ponad kolejkami, Ctrl+K (23 września 2026) ────────────────
   Każdy ekran panelu miał własne pole szukania i trzeba było wiedzieć, które
   wybrać. Agent z numerem przesyłki w ręku nie wie, czy to zwrot, czy dostawa.
   To jest ten sam punkt 1 dekalogu co droga klienta: podział na kolejki jest
   NASZ, więc pytanie „gdzie to jest" nie może go wymagać.

   CZYSTY ODCZYT. Nie woła Allegro, nie pisze do dziennika — nawet wyszukiwarka
   kartotek pisze zdarzenie `search`, ale to jest miara braków w kartotece,
   a tu szukamy spraw, nie towaru do zamówienia.

   LOGIN SZUKA SIĘ PO KAWAŁKU, nie w całości (24 września 2026). Zgłoszenie
   właściciela ze zrzutem: „chrzanowski" nie znajdowało „Chrzanowski1234".
   Agent pamięta nazwisko z loginu, nie cyfry dopisane przez Allegro. Pełny
   login stoi w wynikach pierwszy, reszta po nim.

   LOGIN TRAFIA TEŻ W ROZMOWY od 24 września 2026. Login rozmówcy z wątku
   to login kupującego — zweryfikował to właściciel (`docs/allegro-ksztalt.md`).
   Do tej daty rozmowy dochodziły wyłącznie numerem zamówienia, więc pytanie
   sprzed zakupu po loginie się nie znajdowało. Numer zamówienia zostaje
   drugim mostkiem, tym samym co w `droga-klienta.ts`. Login porównuje się
   bez wielkości liter. */

export type RodzajTrafienia =
  | "klient" | "rozmowa" | "zwrot" | "reklamacja" | "dyskusja" | "dostawa" | "towar" | "zamowienie";

export interface Trafienie {
  rodzaj: RodzajTrafienia;
  /** Identyfikator u nas; przy zamówieniu — numer Allegro, przy towarze — `tw_id`. */
  id: string;
  tytul: string;
  /** Po czym trafiło — ekran pisze to obok, bo trafienie bez powodu budzi nieufność. */
  dlaczego: string;
  /** Adres w panelu; `null`, gdy panel nie ma ekranu dla tego bytu. */
  cel: string | null;
  /** Adres zewnętrzny (zamówienie w Allegro). */
  link: string | null;
}

type Wiersz = Record<string, unknown>;
const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/** Znaki specjalne LIKE jako zwykłe — agent wkleja numery z ukośnikami i podkreślnikami. */
const naLike = (s: string) => s.replace(/[\\%_]/g, (z) => `\\${z}`);

/** Ile trafień jednego rodzaju. Lista ma się zmieścić w oknie bez przewijania. */
const NA_RODZAJ = 8;

/** Towar z Subiekta — wstrzyknięty, żeby test nie potrzebował kartoteki. */
export type SzukajTowaru = (q: string) => Array<{ id: number; sym: string; name: string; ean: string | null }>;

/**
 * Wszystko, co pasuje do frazy: numer zamówienia, login kupującego, numer
 * zwrotu albo sprawy, list przewozowy, końcówka telefonu, numer dokumentu
 * dostawy, symbol i EAN towaru.
 *
 * Fraza krótsza niż trzy znaki nie szuka niczego: „12" trafiłoby w połowę
 * bazy, a lista setek trafień nie odpowiada na pytanie „gdzie to jest".
 */
export function szukajWszedzie(
  fraza: string, szukajTowaru: SzukajTowaru | null = null, database: Db = defaultDb(),
): Trafienie[] {
  const q = fraza.trim();
  if (q.length < 3) return [];
  const like = `%${naLike(q)}%`;
  const cyfry = q.replace(/\D/g, "");
  /* Telefon szuka się po KOŃCÓWCE, bo tak ją podaje klient i kurier; kolumna
     z samymi cyframi istnieje od 0.422.0 właśnie po to. Sześć cyfr to próg,
     poniżej którego końcówka trafia w przypadkowe numery. */
  const jakTelefon = cyfry.length >= 6 && cyfry.length >= q.replace(/[\s+\-()]/g, "").length;

  const wynik = new Map<string, Trafienie>();
  const dodaj = (t: Trafienie) => {
    const klucz = `${t.rodzaj}:${t.id}`;
    if (!wynik.has(klucz)) wynik.set(klucz, t);
  };

  /* KLIENCI na górze (24 września 2026): login pasujący do frazy prowadzi do
     profilu klienta, gdzie stoi wszystko naraz. Jeden wiersz na login, bez
     wielkości liter — „Chips20" i „chips20" to jeden klient. */
  for (const w of database.prepare(`
    SELECT login FROM (
      SELECT kupujacy_login AS login FROM zamowienie_klienta WHERE kupujacy_login LIKE ? ESCAPE '\\'
      UNION SELECT kupujacy_login FROM zwrot_klienta WHERE kupujacy_login LIKE ? ESCAPE '\\'
      UNION SELECT kupujacy_login FROM reklamacja_klienta WHERE kupujacy_login LIKE ? ESCAPE '\\'
      UNION SELECT interlocutor_login FROM allegro_inbox_thread WHERE interlocutor_login LIKE ? ESCAPE '\\')
     GROUP BY lower(login)
     ORDER BY (login = ? COLLATE NOCASE) DESC, login LIMIT 5`).all(like, like, like, like, q) as Wiersz[]) {
    const login = String(w.login);
    dodaj({ rodzaj: "klient", id: login.toLowerCase(), tytul: login, dlaczego: "login",
      cel: `/obsluga/klient/${encodeURIComponent(login)}`, link: null });
  }

  /* ZAMÓWIENIA: po numerze (początek — agent wkleja kawałek), po liście
     przewozowym, po końcówce telefonu i po loginie. Z każdego idzie się dalej
     jego numerem do rozmów, zwrotów i spraw. */
  const zamowienia = database.prepare(`
    SELECT external_id, kupujacy_login, kupiono_at,
           CASE
             WHEN external_id LIKE ? ESCAPE '\\' THEN 'numer zamówienia'
             WHEN przesylka_waybill LIKE ? ESCAPE '\\' THEN 'list przewozowy'
             WHEN kupujacy_login LIKE ? ESCAPE '\\' THEN 'login kupującego'
             ELSE 'telefon odbiorcy' END AS dlaczego
      FROM zamowienie_klienta
     WHERE (length(?) >= 6 AND external_id LIKE ? ESCAPE '\\')
        OR (length(?) >= 6 AND przesylka_waybill LIKE ? ESCAPE '\\')
        OR kupujacy_login LIKE ? ESCAPE '\\'
        OR (? AND odbiorca_telefon_cyfry LIKE ?)
     ORDER BY (kupujacy_login = ? COLLATE NOCASE) DESC, kupiono_at DESC LIMIT ?`).all(
    `${naLike(q)}%`, like, like,
    q, `${naLike(q)}%`, q, like, like, jakTelefon ? 1 : 0, `%${cyfry}`, q, NA_RODZAJ,
  ) as Wiersz[];

  for (const z of zamowienia) {
    const id = String(z.external_id);
    dodaj({
      rodzaj: "zamowienie", id,
      tytul: `Zamówienie ${tekst(z.kupujacy_login) ?? ""}`.trim(),
      dlaczego: String(z.dlaczego), cel: null, link: linkZamowienia(id),
    });
  }
  const numery = zamowienia.map((z) => String(z.external_id));
  /* Numer wpisany wprost też jest mostkiem, choćby zamówienia nie było w naszej
     kopii — zwrot i sprawa niosą `order_id` od siebie. */
  if (q.length >= 6 && !/\s/.test(q)) numery.push(q);
  const dlaczegoNumeru = (orderId: string) =>
    zamowienia.find((z) => String(z.external_id) === orderId)?.dlaczego ?? "numer zamówienia";

  /* Rozmowy po loginie rozmówcy PRZED rozmowami po numerze: trafienie wprost
     w login ma nieść powód „login kupującego", nie „numer zamówienia". */
  for (const w of database.prepare(`
    SELECT c.id, c.subject
      FROM conversation c JOIN allegro_inbox_thread t ON t.id = c.external_conversation_id
     WHERE t.interlocutor_login LIKE ? ESCAPE '\\'
     ORDER BY (t.interlocutor_login = ? COLLATE NOCASE) DESC, c.updated_at DESC LIMIT ?`)
    .all(like, q, NA_RODZAJ) as Wiersz[]) {
    dodaj({
      rodzaj: "rozmowa", id: String(w.id), tytul: tekst(w.subject) ?? "Rozmowa bez tematu",
      dlaczego: "login kupującego", cel: `/obsluga/skrzynka/${w.id}`, link: null,
    });
  }

  if (numery.length > 0) {
    const miejsca = numery.map(() => "?").join(",");
    for (const w of database.prepare(`
      SELECT c.id, c.subject, rz.numer AS zam, MAX(rz.at) AS ostatnia
        FROM ${ROZMOWA_ZAMOWIENIA} rz JOIN conversation c ON c.id = rz.conversation_id
       WHERE rz.numer IN (${miejsca})
       GROUP BY c.id ORDER BY ostatnia DESC LIMIT ?`).all(...numery, NA_RODZAJ) as Wiersz[]) {
      dodaj({
        rodzaj: "rozmowa", id: String(w.id), tytul: tekst(w.subject) ?? "Rozmowa bez tematu",
        dlaczego: String(dlaczegoNumeru(String(w.zam))), cel: `/obsluga/skrzynka/${w.id}`, link: null,
      });
    }
  }

  /* ZWROTY: numer zwrotu, list przewozowy, login kupującego i numer zamówienia. */
  const zamLista = numery.length ? numery : [""];
  for (const w of database.prepare(`
    SELECT id, reference_number, kupujacy_login, order_id,
           CASE
             WHEN reference_number LIKE ? ESCAPE '\\' THEN 'numer zwrotu'
             WHEN waybill LIKE ? ESCAPE '\\' THEN 'list przewozowy'
             WHEN kupujacy_login LIKE ? ESCAPE '\\' THEN 'login kupującego'
             ELSE 'zamówienie' END AS dlaczego
      FROM zwrot_klienta
     WHERE reference_number LIKE ? ESCAPE '\\'
        OR (length(?) >= 6 AND waybill LIKE ? ESCAPE '\\')
        OR kupujacy_login LIKE ? ESCAPE '\\'
        OR order_id IN (${zamLista.map(() => "?").join(",")})
     ORDER BY (kupujacy_login = ? COLLATE NOCASE) DESC, created_at DESC LIMIT ?`).all(
    like, like, like, like, q, like, like, ...zamLista, q, NA_RODZAJ) as Wiersz[]) {
    const dl = String(w.dlaczego) === "zamówienie" ? String(dlaczegoNumeru(String(w.order_id))) : String(w.dlaczego);
    dodaj({
      rodzaj: "zwrot", id: String(w.id),
      tytul: `Zwrot ${tekst(w.reference_number) ?? ""} ${tekst(w.kupujacy_login) ?? ""}`.replace(/\s+/g, " ").trim(),
      dlaczego: dl, cel: `/obsluga/zwroty/${w.id}`, link: null,
    });
  }

  /* bez typu: reklamacje i dyskusje jednym zapytaniem, bo fraza nie zna
     rodzaju sprawy — rozdziela je kolumna `typ` przy budowie trafienia. */
  for (const w of database.prepare(`
    SELECT id, typ, reference_number, temat, kupujacy_login, order_id,
           CASE
             WHEN reference_number LIKE ? ESCAPE '\\' THEN 'numer sprawy'
             WHEN kupujacy_login LIKE ? ESCAPE '\\' THEN 'login kupującego'
             ELSE 'zamówienie' END AS dlaczego
      FROM reklamacja_klienta
     WHERE reference_number LIKE ? ESCAPE '\\'
        OR kupujacy_login LIKE ? ESCAPE '\\'
        OR order_id IN (${zamLista.map(() => "?").join(",")})
     ORDER BY (kupujacy_login = ? COLLATE NOCASE) DESC, otwarto_at DESC LIMIT ?`)
    .all(like, like, like, like, ...zamLista, q, NA_RODZAJ) as Wiersz[]) {
    const dyskusja = String(w.typ) === "DISPUTE";
    const dl = String(w.dlaczego) === "zamówienie" ? String(dlaczegoNumeru(String(w.order_id))) : String(w.dlaczego);
    dodaj({
      rodzaj: dyskusja ? "dyskusja" : "reklamacja", id: String(w.id),
      tytul: tekst(w.temat) ?? tekst(w.reference_number) ?? "Sprawa bez tematu",
      dlaczego: dl, cel: `/obsluga/${dyskusja ? "dyskusje" : "reklamacje"}/${w.id}`, link: null,
    });
  }

  /* DOSTAWY: numer dokumentu z Subiekta, dostawca i list przewozowy. Adres
     ekranu niesie `sgt_dok_id` — powód przy nagłówku `ekrany/Dostawy.tsx`.
     Szukamy wyłącznie dostaw już otwartych u nas; dokument, którego nikt
     nie ruszył, zna tylko Subiekt i jego lista na ekranie dostaw. */
  for (const w of database.prepare(`
    SELECT sgt_dok_id, sgt_dok_numer, dostawca,
           CASE WHEN sgt_dok_numer LIKE ? ESCAPE '\\' THEN 'numer dokumentu'
                WHEN nr_przesylki LIKE ? ESCAPE '\\' THEN 'list przewozowy'
                ELSE 'dostawca' END AS dlaczego
      FROM delivery
     WHERE sgt_dok_numer LIKE ? ESCAPE '\\'
        OR (length(?) >= 6 AND nr_przesylki LIKE ? ESCAPE '\\')
        OR (length(?) >= 4 AND dostawca LIKE ? ESCAPE '\\')
     ORDER BY data_dok DESC LIMIT ?`).all(like, like, like, q, like, q, like, NA_RODZAJ) as Wiersz[]) {
    dodaj({
      rodzaj: "dostawa", id: String(w.sgt_dok_id),
      tytul: `${tekst(w.sgt_dok_numer) ?? "Dokument"} · ${tekst(w.dostawca) ?? ""}`.replace(/ · $/, ""),
      dlaczego: String(w.dlaczego), cel: `/obsluga/dostawy/${w.sgt_dok_id}`, link: null,
    });
  }

  /* TOWAR na końcu: nazwa trafia prawie zawsze w coś, a sprawa jest tym,
     po co agent zwykle przychodzi. Ekranu karty w panelu nie ma — podgląd
     rysuje się w samym oknie szukania. */
  if (szukajTowaru) {
    for (const t of szukajTowaru(q).slice(0, NA_RODZAJ)) {
      const ean = tekst(t.ean);
      dodaj({
        rodzaj: "towar", id: String(t.id), tytul: `${t.sym} · ${t.name}`,
        dlaczego: ean && cyfry.length >= 5 && ean.includes(cyfry) ? "EAN" : "symbol lub nazwa",
        cel: null, link: null,
      });
    }
  }

  return [...wynik.values()];
}
