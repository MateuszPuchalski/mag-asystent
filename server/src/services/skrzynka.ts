import { db } from "../db/db.js";
import { utworzZadanie } from "./zadania-terenowe.js";
import { uchwyty } from "./conversation-realtime.js";
import { ustawStatus } from "./conversations.js";
import type { StatusRozmowy } from "./conversations.js";
import { sprawaRozmowy, type SprawaRozmowy } from "./sprawy.js";
import { zamowienieRozmowy, type Zamowienie } from "./zamowienia.js";
import { linkZamowienia } from "./allegro-linki.js";

/* Skrzynka CZYTA model kanoniczny (`conversation`/`message`), zasilany przez
   `allegro-inbox-sync`. Nie odpytuje Allegro sama: rytm i limity API pilnuje
   jedno miejsce, a ekran otwiera się także wtedy, gdy Allegro nie odpowiada —
   pokazuje wtedy ostatni znany stan i moment ostatniej udanej synchronizacji.

   Do 0.143.1 czytała surowe lądowisko `allegro_inbox_*`. Przejście na model
   kanoniczny jest tym, co czyni przejmowanie rozmowy, właściciela i szkic
   z 0.143.0 osiągalnymi: tamte trasy przyjmują liczbowe `conversation.id`. */

export interface RozmowaSkrzynki {
  id: number; klient: string; ostatniaWiadomosc: string; ostatniaWiadomoscAt: string;
  /* Czy podgląd to słowa klienta. Fałsz tylko wtedy, gdy rozmowa nie ma ani
     jednej wiadomości przychodzącej — wtedy panel podpisuje podgląd „Biuro". */
  ostatniaOdKlienta: boolean;
  nieprzeczytana: boolean; wlascicielId: number | null; wlasciciel: string | null; wersja: number;
  /** Status WYLICZONY (§7) — odłożenie po terminie wraca tu już jako `open`. */
  status: StatusRozmowy;
  odlozoneDo: string | null;
  /* Odłożenie, którego termin minął. Liczy to SERWER, bo reguła „minął termin"
     ma jedno źródło; panel dwa razy tej samej reguły nie wyprowadza (blizna
     z kubełków zwrotów). Wiersz taki wraca jako `open` i wygląda jak każdy
     inny otwarty — a to właśnie ten, o którym ktoś zapomniał. */
  poTerminie: boolean;
  /* Kto SIEDZI przy rozmowie teraz — przydział tymczasowy, na czas oglądania.
     Nie ma go w bazie i nie ma prawa być (§6.3): po restarcie usługi rozmowa
     nie może zostać zablokowana przez agenta, który dawno wyszedł. */
  oglada: { userId: number; name: string } | null;
}
/** Załącznik wiadomości. `SAFE` znaczy „wolno pobrać"; reszta tylko informuje. */
export interface ZalacznikOsi {
  id: number; nazwa: string; typ: string | null; status: string; doPobrania: boolean;
}
/** Wzmianka w komentarzu — kto ma to przeczytać. */
export interface Wzmianka { userId: number; name: string }

export interface WpisOsi {
  id: string; rodzaj: "wiadomosc" | "wynik_zadania" | "komentarz" | "status" | "sprawa";
  autor: string; odKlienta: boolean; tresc: string; at: string;
  ofertaId: string | null; zadanieId?: number; messageId?: number;
  /* Nazwa towaru przy ofercie — Z ZAMÓWIENIA, nie z oferty (§4.3: każdy fakt
     niesie źródło). Ofert nie pobieramy; nazwę znamy tylko dla oferty, która
     kiedykolwiek przeszła przez pobrane zamówienie. `null` = nie znamy. */
  nazwaOferty?: string | null;
  /* Zamówienie, którego dotyczy wiadomość — gałąź `relatesTo.order` (0.166.0). */
  zamowienieId?: string | null;
  zalaczniki?: ZalacznikOsi[];
  wzmianki?: Wzmianka[];
}
export interface StanSkrzynki { ostatniaSynchronizacja: string | null; bledy: number }

/* Zamówienie przy rozmowie. `pobrane` jest `null`, dopóki ticker
   `uzupelnijZamowienia` go nie dociągnie — numer i odnośnik są od razu. */
export interface ZamowienieRozmowy {
  externalId: string; link: string | null; pobrane: Zamowienie | null;
}

const SKRZYNKA = "skrzynka";

/* PODGLĄD W KOLEJCE TO OSTATNIA WIADOMOŚĆ KLIENTA (0.166.0). Do 0.165.0
   podzapytanie brało ostatnią wiadomość JAKĄKOLWIEK, więc po autoodpowiedzi
   konta Allegro („Dziękujemy za kontakt…" wjeżdża synchronizacją jako zwykłe
   `outgoing`) w kolejce stało nasze zdanie zamiast pytania. W `message` nie
   ma flagi automatu — autoresponder i odpowiedź agenta wyglądają identycznie
   — więc jedynym pewnym filtrem jest kierunek. Rozmowa bez ani jednej
   wiadomości przychodzącej (wątek, który zaczęliśmy my) schodzi na ostatnią
   dowolną, a `ostatniKierunek` mówi panelowi, żeby podpisał ją „Biuro".

   Data idzie Z TEJ SAMEJ wiadomości, nie z `conversation.updated_at`: tamto
   jest datą WĄTKU z Allegro i po autoodpowiedzi mówiło o godzinie naszego
   zdania, nie pytania. `COALESCE` zostaje dla wątku świeżo założonego, bez
   wiadomości — Allegro takie oddaje. Kolejność LISTY dalej niesie
   `updated_at`, czyli tę samą, którą właściciel widzi w panelu sprzedawcy. */
const LISTA = `
  SELECT c.id, c.subject AS klient, c.unread,
         c.assigned_user_id AS wlascicielId, u.name AS wlasciciel, c.version AS wersja,
         c.status, c.snoozed_until AS odlozoneDo,
         o.body AS ostatniaWiadomosc,
         COALESCE(o.sent_at, c.updated_at) AS ostatniaWiadomoscAt,
         o.direction AS ostatniKierunek
    FROM conversation c
    LEFT JOIN app_user u ON u.user_id=c.assigned_user_id
    LEFT JOIN message o ON o.id = (
      SELECT m.id FROM message m WHERE m.conversation_id=c.id
       ORDER BY (m.direction='incoming') DESC, m.id DESC LIMIT 1)`;

const naRozmowe = (
  w: Record<string, unknown>,
  teraz = Date.now(),
  trzymane: Map<number, { userId: number; name: string }> = new Map(),
): RozmowaSkrzynki => {
  const odlozoneDo = w.odlozoneDo === null ? null : String(w.odlozoneDo);
  const minal = Boolean(odlozoneDo && Date.parse(odlozoneDo) <= teraz);
  return {
    id: Number(w.id), klient: String(w.klient ?? "Klient"),
    ostatniaWiadomosc: String(w.ostatniaWiadomosc ?? ""),
    ostatniaWiadomoscAt: String(w.ostatniaWiadomoscAt),
    /* Pusta rozmowa nie dostaje podpisu „Biuro" — nie ma czego podpisywać. */
    ostatniaOdKlienta: String(w.ostatniKierunek ?? "incoming") === "incoming",
    nieprzeczytana: Boolean(Number(w.unread)),
    wlascicielId: w.wlascicielId === null ? null : Number(w.wlascicielId),
    wlasciciel: w.wlasciciel === null ? null : String(w.wlasciciel),
    wersja: Number(w.wersja),
    /* Ta sama reguła co w `statusRozmowy`, liczona tu bez dodatkowego zapytania
       na wiersz: odłożenie kończy się samo, a status zapisany w kolumnie zostaje
       `snoozed` do najbliższej ręcznej zmiany. */
    status: (String(w.status) === "snoozed" && minal ? "open" : String(w.status)) as StatusRozmowy,
    odlozoneDo,
    poTerminie: String(w.status) === "snoozed" && minal,
    oglada: trzymane.get(Number(w.id)) ?? null,
  };
};

export function stanSkrzynki(): StanSkrzynki {
  const s = db().prepare(
    "SELECT last_success_at, error_count FROM allegro_inbox_sync_state WHERE id=1",
  ).get() as { last_success_at: string | null; error_count: number } | undefined;
  return { ostatniaSynchronizacja: s?.last_success_at ?? null, bledy: s?.error_count ?? 0 };
}

/**
 * Liczby obsługi dla `/api/health` (§21).
 *
 * Trasa zdrowia jest publiczna, więc idą tu wyłącznie LICZBY: ile rozmów
 * czeka i jak stare jest najstarsze zadanie. Bez klientów, bez treści i bez
 * numerów ofert — te same reguły, co przy statystykach audytu obok.
 */
export function stanObslugiHealth(teraz = Date.now()) {
  const rozmowy = db().prepare(
    "SELECT count(*) n FROM conversation WHERE assigned_user_id IS NULL").get() as { n: number };
  const zadania = db().prepare(`SELECT count(*) n, min(utworzono_at) najstarsze
    FROM zadanie_terenowe WHERE status IN ('nowe','w_toku')`).get() as
    { n: number; najstarsze: string | null };
  return {
    rozmowyOczekujace: rozmowy.n,
    zadaniaTerenowe: zadania.n,
    najstarszeZadanieMs: zadania.najstarsze
      ? Math.max(0, teraz - Date.parse(zadania.najstarsze)) : null,
    ...stanKolejkiWysylek(),
  };
}

/* ── Kolejka wysyłek melduje PRAWDĘ (0.173.0) ────────────────────────────────
   Do 0.172.0 stała tu stała `"wysyłka wyłączona"`. Zdanie było prawdziwe,
   gdy powstawało — mechanizmu nie było. Wysyłka weszła w 0.148.0 i od tamtej
   pory ekran twierdził coś przeciwnego do tego, co robi kod: agent odpisywał
   klientom, a `/api/health` mówił, że wysyłka jest wyłączona.

   To jest gorszy rodzaj błędu niż brak wskaźnika. Brak każe szukać; napis
   „wyłączona" każe NIE szukać i prowadzi wprost do wniosku „trzeba to
   włączyć", choć włączać nie ma czego.

   `doSprawdzenia` liczy stany, które czekają na człowieka: nieudana wysyłka
   znaczy, że odpowiedź NIE poszła do klienta, a niepewna — że nie wiadomo,
   czy poszła. Oba wołają o ruch, a §21 żąda, żeby awaria integracji była
   widoczna. `sending` bez końca to ta sama sprawa widziana wcześniej:
   proces padł w połowie strzału i nikt tego wiersza już nie domknie.        */
export function stanKolejkiWysylek(database = db()) {
  const w = database.prepare(`SELECT
      SUM(CASE WHEN status='sending' THEN 1 ELSE 0 END)        AS wToku,
      SUM(CASE WHEN status='send_failed' THEN 1 ELSE 0 END)    AS nieudane,
      SUM(CASE WHEN status='send_uncertain' THEN 1 ELSE 0 END) AS niepewne,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END)           AS wyslane
    FROM outbox`).get() as Record<string, number | null>;
  const n = (k: string) => Number(w[k] ?? 0);
  const doSprawdzenia = n("nieudane") + n("niepewne") + n("wToku");

  /* Zdanie składamy z tego, co NIEZEROWE. „0 nieudanych, 0 niepewnych"
     czyta się gorzej niż „12 wysłanych", a mówi dokładnie tyle samo. */
  const czesci = [
    n("wyslane") ? `${n("wyslane")} wysłanych` : "",
    n("wToku") ? `${n("wToku")} w toku` : "",
    n("nieudane") ? `${n("nieudane")} nieudanych` : "",
    n("niepewne") ? `${n("niepewne")} niepewnych` : "",
  ].filter(Boolean);

  return {
    kolejkaWysylek: czesci.length ? czesci.join(" · ") : "pusta — nic jeszcze nie poszło",
    /* Osobna LICZBA, nie kolor w zdaniu: barwę wybiera ekran, a serwer ma
       oddać fakt. Ten sam podział co przy rangach w `StanIntegracji`. */
    wysylkiDoSprawdzenia: doSprawdzenia,
  };
}

export function listaRozmow(): RozmowaSkrzynki[] {
  /* Uchwyty bierzemy RAZ na całą listę, nie po jednym na wiersz: kolejka
     odświeża się przy każdym zdarzeniu, a mapa i tak stoi w pamięci. */
  const trzymane = uchwyty();
  /* Tie-breaker po `id`: dwie rozmowy z tą samą datą wątku stały dotąd
     w kolejności, jaką dał planer zapytań, czyli w żadnej. */
  return (db().prepare(`${LISTA} ORDER BY c.updated_at DESC, c.id DESC`).all() as Array<Record<string, unknown>>)
    .map((w) => naRozmowe(w, Date.now(), trzymane));
}

/** Oś rozmowy: wiadomości kanału przeplecione wynikami zadań z hali. */
export function osRozmowy(id: number): {
  rozmowa: RozmowaSkrzynki; os: WpisOsi[]; szkic: Szkic | null;
  ofertaWskazana: OfertaWskazana | null; sprawa: SprawaRozmowy | null;
  zamowienie: ZamowienieRozmowy | null;
} {
  const wiersz = db().prepare(`${LISTA} WHERE c.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!wiersz) throw new Error("Nie znaleziono rozmowy");
  const rozmowa = naRozmowe(wiersz, Date.now(), uchwyty());

  /* Nazwa towaru przy ofercie bierze się z OSTATNIEJ pozycji zamówienia o tym
     numerze oferty — jedynego miejsca, gdzie mamy tytuły, bo ofert nie
     pobieramy. To nazwa z zamówienia, nie z oferty, i tak ją podpisuje typ.
     Mail Allegro „Wiadomość dotyczy" pokazuje tytuł i zdjęcie; goły numer
     w panelu kazał agentowi szukać towaru drugi raz. */
  const wiadomosci = db().prepare(`
    SELECT m.id, m.direction, m.body, m.sent_at, m.related_object_type AS typ,
           m.related_object_id AS oferta, m.related_order_id AS zamowienie,
           m.channel_account_id AS konto, c.subject AS klient,
           (SELECT p.nazwa FROM zamowienie_klienta_pozycja p
              JOIN zamowienie_klienta k ON k.id = p.zamowienie_id
             WHERE k.channel_account_id = m.channel_account_id
               AND m.related_object_type = 'OFFER' AND p.offer_id = m.related_object_id
             ORDER BY p.id DESC LIMIT 1) AS nazwaOferty
      FROM message m JOIN conversation c ON c.id=m.conversation_id
     WHERE m.conversation_id=? ORDER BY m.id
  `).all(id) as Array<Record<string, unknown>>;

  /* Załączniki jednym zapytaniem dla całej rozmowy, nie po jednym na
     wiadomość: siedem na trzydzieści dziewięć wiadomości to zbyt mało, żeby
     płacić za to osobnym odpytaniem przy każdym wierszu osi. */
  const zalaczniki = new Map<number, ZalacznikOsi[]>();
  for (const z of db().prepare(`
    SELECT a.id, a.message_id, a.file_name, a.mime_type, a.status
      FROM message_attachment a JOIN message m ON m.id=a.message_id
     WHERE m.conversation_id=? ORDER BY a.id
  `).all(id) as Array<Record<string, unknown>>) {
    const lista = zalaczniki.get(Number(z.message_id)) ?? [];
    lista.push({
      id: Number(z.id), nazwa: String(z.file_name),
      typ: z.mime_type == null ? null : String(z.mime_type),
      status: String(z.status),
      /* Pobranie oferujemy WYŁĄCZNIE przy `SAFE`. `UNSAFE` znaczy, że Allegro
         uznało plik za niebezpieczny — nie mamy powodu wiedzieć lepiej, a plik
         i tak wędrowałby przez maszynę biura. `EXPIRED` i `NEW` nie mają czego
         oddać. */
      doPobrania: String(z.status) === "SAFE",
    });
    zalaczniki.set(Number(z.message_id), lista);
  }

  /* Kolejność niesie `message.id`, nie `sent_at`. Do 0.151.0 stało tu
     uzasadnienie „Allegro podaje datę wątku, nie wiadomości" — nieprawdziwe,
     `createdAt` jest per wiadomość. Kolejność po identyfikatorze zostaje, bo
     jest stabilna także przy dwóch wiadomościach z tej samej sekundy. */
  const os: WpisOsi[] = wiadomosci.map((m) => ({
    id: `msg-${m.id}`, rodzaj: "wiadomosc" as const, messageId: Number(m.id),
    autor: String(m.direction) === "incoming" ? String(m.klient ?? "Klient") : "Biuro",
    odKlienta: String(m.direction) === "incoming",
    tresc: String(m.body), at: String(m.sent_at),
    ofertaId: String(m.typ ?? "") === "OFFER" ? String(m.oferta) : null,
    nazwaOferty: m.nazwaOferty == null ? null : String(m.nazwaOferty),
    zamowienieId: m.zamowienie == null ? null : String(m.zamowienie),
    ...(zalaczniki.has(Number(m.id)) ? { zalaczniki: zalaczniki.get(Number(m.id)) } : {}),
  }));

  /* JEDNO zamówienie na rozmowę: numer z najnowszej wiadomości KLIENTA, która
     go niesie (wątek dotyczy jednego zakupu), a gdy klient go nie podał —
     z najnowszej naszej. Treść jest, gdy ticker już dociągnął; odczyt niczego
     nie pobiera („zero zapisu przy patrzeniu"). */
  const zNumerem = [...wiadomosci].reverse();
  const zrodloZamowienia = zNumerem.find((m) => m.zamowienie != null && String(m.direction) === "incoming")
    ?? zNumerem.find((m) => m.zamowienie != null);
  const zamowienie: ZamowienieRozmowy | null = zrodloZamowienia ? {
    externalId: String(zrodloZamowienia.zamowienie),
    link: linkZamowienia(String(zrodloZamowienia.zamowienie)),
    pobrane: zamowienieRozmowy(Number(zrodloZamowienia.konto), String(zrodloZamowienia.zamowienie)),
  } : null;

  /* Wynik z hali jest osobnym wpisem osi, nigdy podmianą treści klienta —
     to zasada z docs/obsluga-klienta.md i ona decyduje o tym kształcie. */
  const zadania = db().prepare(`
    SELECT id, wynik, wykonano_at, wykonano_przez FROM zadanie_terenowe
     WHERE conversation_id=? AND status='wykonane' AND wynik IS NOT NULL ORDER BY wykonano_at
  `).all(id) as Array<Record<string, unknown>>;
  for (const z of zadania) {
    os.push({
      id: `zadanie-${z.id}`, rodzaj: "wynik_zadania",
      autor: String(z.wykonano_przez ?? "magazyn"), odKlienta: false,
      tresc: String(z.wynik), at: String(z.wykonano_at), ofertaId: null, zadanieId: Number(z.id),
    });
  }
  /* KOMENTARZE WEWNĘTRZNE (0.157.0). Do tego wydania `conversation_comment`
     miała w całym serwerze jeden INSERT i zero odczytów — notatka agenta
     wpadała do tabeli i nie wracała do nikogo. §10.3 wymienia ją wśród rzeczy,
     które ma nieść oś, a §6.4 każe odróżnić ją wizualnie od treści klienta;
     tu dajemy do tego `rodzaj`, a wygląd robi panel. */
  const komentarze = db().prepare(`
    SELECT k.id, k.body, k.created_at, u.name AS autor
      FROM conversation_comment k JOIN app_user u ON u.user_id = k.author_user_id
     WHERE k.conversation_id=? ORDER BY k.created_at, k.id
  `).all(id) as Array<Record<string, unknown>>;
  const wzmianki = new Map<number, Wzmianka[]>();
  for (const w of db().prepare(`
    SELECT m.comment_id, m.user_id, u.name
      FROM conversation_mention m
      JOIN conversation_comment k ON k.id = m.comment_id
      JOIN app_user u ON u.user_id = m.user_id
     WHERE k.conversation_id=? ORDER BY u.name
  `).all(id) as Array<Record<string, unknown>>) {
    const lista = wzmianki.get(Number(w.comment_id)) ?? [];
    lista.push({ userId: Number(w.user_id), name: String(w.name) });
    wzmianki.set(Number(w.comment_id), lista);
  }
  for (const k of komentarze) {
    os.push({
      id: `komentarz-${k.id}`, rodzaj: "komentarz", autor: String(k.autor),
      /* `odKlienta` zostaje FAŁSZEM i to nie jest szczegół: na tym polu stoi
         cały wygląd wpisu klienta. Komentarz, który je zapala, wyglądałby jak
         cudza wiadomość — a §6.4 żąda dokładnie odwrotnego. */
      odKlienta: false, tresc: String(k.body), at: String(k.created_at), ofertaId: null,
      ...(wzmianki.has(Number(k.id)) ? { wzmianki: wzmianki.get(Number(k.id)) } : {}),
    });
  }

  /* ZMIANY STATUSU (0.158.0). §10.3 wymienia je wprost wśród rzeczy, które
     ma nieść oś. Nie są ozdobą: „dlaczego ta rozmowa wróciła na wierzch"
     odpowiada wyłącznie wpis mówiący, że klient dopisał do sprawy uznanej za
     rozwiązaną. Autor bywa KLIENTEM, nie agentem — patrz `obudzPrzychodzaca`.

     `created_at` bierzemy z wiersza zdarzenia, bo oś sortuje się po czasie
     i wpis bez daty wylądowałby na samej górze, przed pierwszym pytaniem. */
  for (const z of db().prepare(`
    SELECT id, payload, created_at FROM conversation_event
     WHERE conversation_id=? AND event_type='status_changed' ORDER BY id
  `).all(id) as Array<Record<string, unknown>>) {
    const p = JSON.parse(String(z.payload ?? "{}")) as
      { przed?: string; po?: string; autor?: string };
    os.push({
      id: `status-${z.id}`, rodzaj: "status", autor: String(p.autor ?? "system"),
      odKlienta: false, tresc: `${p.przed ?? "?"} → ${p.po ?? "?"}`,
      at: String(z.created_at), ofertaId: null,
    });
  }

  /* SKLEJENIE I ROZKLEJENIE SPRAWY (0.161.0) na osi ROZMOWY, nie sprawy.
     Blizna 0.130.0: „historia sprawy ginęła przy scalaniu", bo wisiała przy
     sprawie. Wpis przy źródle zostaje także wtedy, gdy klamra zniknie. */
  for (const z of db().prepare(`
    SELECT id, event_type, payload, created_at FROM conversation_event
     WHERE conversation_id=? AND event_type IN ('sprawa_dolaczona','sprawa_odlaczona')
     ORDER BY id
  `).all(id) as Array<Record<string, unknown>>) {
    const p = JSON.parse(String(z.payload ?? "{}")) as { tytul?: string; autor?: string };
    os.push({
      id: `sprawa-${z.id}`, rodzaj: "sprawa", autor: String(p.autor ?? "system"),
      odKlienta: false,
      tresc: `${String(z.event_type) === "sprawa_dolaczona" ? "dołączono do sprawy" : "odłączono od sprawy"} „${p.tytul ?? "?"}"`,
      at: String(z.created_at), ofertaId: null,
    });
  }

  /* OŚ JEST CHRONOLOGICZNA (0.157.0). Do tego wydania wyniki zadań doklejały
     się za wszystkimi wiadomościami bez względu na czas — przy dwóch źródłach
     znośne, przy trzech oś przestawała opowiadać przebieg sprawy.

     Sortowanie jest STABILNE, więc wiadomości z tą samą datą zostają
     w kolejności identyfikatorów. To ważne: Allegro potrafi oddać dwie
     wiadomości z jedną sekundą, a wtedy porządek niesie `message.id`. */
  os.sort((a, b) => a.at.localeCompare(b.at));

  return {
    rozmowa, os, szkic: szkicRozmowy(id), ofertaWskazana: ofertaWskazana(id),
    /* Sprawa jedzie razem z rozmową, bo agent ma zobaczyć rodzeństwo ZANIM
       zacznie pisać: druga rozmowa o tym samym problemie bywa tą, w której
       padła już odpowiedź. */
    sprawa: sprawaRozmowy(id),
    zamowienie,
  };
}

export interface Szkic { body: string; wersja: number; expectedLastMessageId: number | null }

/** Oferta wskazana RĘCZNIE przez agenta — wybór człowieka, nie fakt z Allegro. */
export interface OfertaWskazana { ofertaId: string; autor: string }

export function ofertaWskazana(id: number): OfertaWskazana | null {
  const w = db().prepare(`SELECT payload FROM conversation_event
    WHERE conversation_id=? AND event_type='offer_linked_manually'
    ORDER BY id DESC LIMIT 1`).get(id) as { payload: string | null } | undefined;
  if (!w?.payload) return null;
  const p = JSON.parse(w.payload) as { ofertaId?: string; autor?: string };
  return p.ofertaId ? { ofertaId: p.ofertaId, autor: p.autor ?? "agent" } : null;
}

export function szkicRozmowy(id: number): Szkic | null {
  const s = db().prepare(
    "SELECT body, version, expected_last_message_id AS oczekiwana FROM conversation_draft WHERE conversation_id=?",
  ).get(id) as { body: string; version: number; oczekiwana: number | null } | undefined;
  return s ? { body: s.body, wersja: s.version, expectedLastMessageId: s.oczekiwana } : null;
}

/**
 * Zleca pomiar z konkretnej wiadomości.
 *
 * Kontekst składa SERWER z zapisanego wiersza, nie klient. Agent podaje
 * wyłącznie identyfikatory; treść pytania i numer oferty biorą się z bazy.
 * Dzięki temu nie da się wysłać na halę zadania wskazującego na cudzą ofertę.
 */
export function zlecPomiar(
  rozmowaId: number, messageId: number, instrukcja: string, autor: { id: number; name: string },
  twId: number | null = null,
) {
  const m = db().prepare(`
    SELECT m.body, m.related_object_type AS typ, m.related_object_id AS oferta, c.subject AS klient
      FROM message m JOIN conversation c ON c.id=m.conversation_id
     WHERE m.id=? AND m.conversation_id=?
  `).get(messageId, rozmowaId) as Record<string, unknown> | undefined;
  if (!m) throw new Error("Wiadomość źródłowa nie należy do tej rozmowy");

  const oferta = String(m.typ ?? "") === "OFFER" ? String(m.oferta) : null;
  const dodatkowa = (instrukcja ?? "").trim();

  /* Kartoteka WSKAZANA przez agenta to co innego niż WYWIEDZIONA z oferty.
     Pierwsza jest jego wyborem i tak ma być podpisana; druga będzie faktem
     z Allegro, gdy dojdzie pobieranie ofert. Hala i audyt muszą widzieć
     różnicę — projekt panelu §4.3 zabrania mieszać fakty z różnych źródeł
     bez pokazania pochodzenia. Dziś synchronizator ofert nie pobiera, więc
     bez wskazania agenta `tw_id` zostaje puste; zgadywanie byłoby gorsze
     niż uczciwy brak. */
  const kontekst = [
    `Pytanie klienta: ${String(m.body)}`,
    oferta ? `Oferta Allegro: ${oferta}` : "Brak powiązania z ofertą Allegro.",
    twId != null ? `Kartotekę wskazał(a) ${autor.name}, nie wynika z oferty.` : "",
    dodatkowa ? `Wskazówka biura: ${dodatkowa}` : "",
  ].filter(Boolean).join("\n");

  const zadanie = utworzZadanie({
    rodzaj: "pomiar",
    tytul: `Pomiar z rozmowy — ${String(m.klient ?? "klient")}`,
    instrukcja: kontekst, twId, zrodlo: SKRZYNKA, zrodloRef: String(rozmowaId),
  }, autor);

  /* Powiązanie idzie kluczami obcymi modelu kanonicznego (0.144.0), a nie samym
     `zrodlo_ref` — dzięki temu wynik wraca na oś TEJ rozmowy i tej wiadomości. */
  db().prepare("UPDATE zadanie_terenowe SET conversation_id=?, message_id=? WHERE id=?")
    .run(rozmowaId, messageId, zadanie.id);
  /* ZLECONY POMIAR PRZESTAWIA STATUS (0.159.0). Bez tego `waiting_for_internal`
     z §7 stał w liście dopuszczonych wartości i nie miał ani jednego nadawcy:
     agent musiałby wybrać go ręcznie z listy, choć fakt już się wydarzył.
     Wyjście z tego stanu jest równie automatyczne — zdejmuje go wynik z hali
     (`dopiszZdarzenieWyniku`). */
  ustawStatus(db(), rozmowaId, "waiting_for_internal", autor.id, null);
  return { ...zadanie, conversationId: rozmowaId, messageId };
}
