import { db } from "../db/db.js";
import { utworzZadanie } from "./zadania-terenowe.js";
import { uchwyty } from "./conversation-realtime.js";
import { statusZKierunku, ustawStatus } from "./conversations.js";
import type { StatusRozmowy } from "./conversations.js";
import { sprawaRozmowy, type SprawaRozmowy } from "./sprawy.js";
import { zamowienieRozmowy, type Zamowienie } from "./zamowienia.js";
import { listaZwrotow, type WierszZwrotu } from "./zwroty.js";
import { linkOferty, linkZamowienia } from "./allegro-linki.js";
import { kartotekaOferty, type Dopasowanie } from "./dopasowanie-sku.js";
import { stanZdjeciaOferty, type StanZdjeciaOferty } from "./zdjecia-ofert.js";
import { doborRozmowy, type Dobor, type StatusDoboru } from "./dobor.js";
import { szkicCopilota, type SzkicCopilota } from "./copilot-szkic.js";
import type { Kategoria, Pewnosc } from "./copilot-klasyfikacja.js";
import { podzielStopke } from "./stopka.js";
import { czyObrazZNazwy } from "./reklamacje.js";

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
  /** Ręczna flaga „pilne" (§10.2, 0.181.0). */
  priorytet: "normalny" | "pilny";
  /**
   * Ile czeka pytanie klienta, w milisekundach. `null`, gdy klient nie napisał
   * nic — wątek zaczęty przez nas nie ma na co czekać, a zegar liczony od
   * NASZEJ wiadomości kłamałby o cudzej cierpliwości.
   */
  czekaOdMs: number | null;
  /**
   * Wiadomości klienta od NASZEJ ostatniej odpowiedzi.
   *
   * To NIE jest „nieprzeczytane przez agenta" i ekran tak tego nie podpisuje.
   * Tamtego policzyć się nie da: `conversation.unread` to flaga 0/1 z Allegro
   * (`thread.read`), a `message` nie ma znacznika odczytu. Ta liczba mówi, ile
   * klient dopisał, odkąd ostatnio odpisaliśmy — i to jest pytanie, które ma
   * agent, patrząc na kolejkę.
   */
  nowychOdOdpowiedzi: number;
  /** Czy przy rozmowie stoi niezamknięte zadanie terenowe (§10.2). */
  zadanieWToku: boolean;
  /* Status doboru (§7, §10.2, etap E1). Brak wiersza `dobor_rozmowy` to
     `not_started` — liczone tu, w SQL, żeby lista nie robiła zapytania na
     wiersz i żeby otwarcie ekranu niczego nie wstawiało. */
  dobor: StatusDoboru;
  odlozoneDo: string | null;
  /* Odłożenie, którego termin minął. Liczy to SERWER, bo reguła „minął termin"
     ma jedno źródło; panel dwa razy tej samej reguły nie wyprowadza (blizna
     z kubełków zwrotów). Wiersz taki wraca jako `open` i wygląda jak każdy
     inny otwarty — a to właśnie ten, o którym ktoś zapomniał. */
  poTerminie: boolean;
  /* Rozpoznanie Copilota (§14, etap F). `null` znaczy „nierozpoznana" i liczy
     się PRZY ODCZYCIE — brak wiersza w `klasyfikacja_rozmowy` niczego nie
     wstawia, więc otwarcie kolejki dalej nic nie mutuje.

     `nieaktualna` liczy SERWER, tak samo jak `poTerminie`: reguła „klient
     dopisał po rozpoznaniu" ma jedno źródło, a panel drugi raz jej nie
     wyprowadza (blizna z kubełków zwrotów). Wyszarzona plakietka mówi
     agentowi, że etykieta dotyczy starszej wiadomości — milczenie o tym
     byłoby gorsze niż brak etykiety. */
  kopilot: {
    kategoria: Kategoria; pewnosc: Pewnosc; nieaktualna: boolean;
    ocena: "trafna" | "nietrafna" | null;
  } | null;
  /* Kto SIEDZI przy rozmowie teraz — przydział tymczasowy, na czas oglądania.
     Nie ma go w bazie i nie ma prawa być (§6.3): po restarcie usługi rozmowa
     nie może zostać zablokowana przez agenta, który dawno wyszedł. */
  oglada: { userId: number; name: string } | null;
}
/** Załącznik wiadomości. `SAFE` znaczy „wolno pobrać"; reszta tylko informuje. */
export interface ZalacznikOsi {
  id: number; nazwa: string; typ: string | null; status: string; doPobrania: boolean;
  /* Czy pokazać obraz WPROST na osi (0.218.0). Decyduje SERWER, bo to on zna
     listę typów, które trasa podglądu odda — panel zgadujący po `typ`
     rysowałby zepsuty obrazek przy każdym rozjeździe tych dwóch list. */
  podglad: boolean;
}
/**
 * Typy obrazu, które oś rysuje WPROST, bez klikania (0.218.0).
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * W sklepie z częściami do maszyn ogrodniczych zdjęcie pękniętego elementu
 * bywa CAŁĄ treścią pytania — 0.155.0 zapisało to zdanie, dokładając nazwę
 * pliku na oś, i zatrzymało się w pół drogi. Agent i tak musiał kliknąć,
 * ściągnąć plik na dysk i otworzyć go w przeglądarce zdjęć, żeby zobaczyć,
 * o co klient pyta. Właściciel: „wyświetlaj w czacie, nie każ mi w nie klikać".
 *
 * ── DLACZEGO LISTA, A NIE `image/*` ───────────────────────────────────────
 * `image/svg+xml` JEST obrazem i JEST dokumentem ze skryptem. Wpuszczony do
 * `<img>` skryptu nie odpali, ale ta lista broni się sama, bez polegania na
 * tym, gdzie dokładnie przeglądarka stawia granicę — plik przychodzi od obcego
 * i leci przez nasz origin. To ta sama ostrożność, którą 0.155.0 zapisało
 * w nagłówku `content-disposition: attachment` przy pobieraniu.
 *
 * Cztery formaty rastrowe pokrywają wszystko, co wychodzi z telefonu.
 */
export const TYPY_PODGLADU = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/**
 * Typ do odesłania w podglądzie albo `null`, gdy plik nie jest obrazem z listy.
 *
 * ZWRACAMY WARTOŚĆ Z LISTY, nie z bazy. `mime_type` przyszedł od Allegro,
 * a nagłówek `content-type` przepisany z cudzego pola to cudzy tekst
 * w naszej odpowiedzi.
 */
export function typPodgladu(mime: string | null | undefined): string | null {
  if (mime == null) return null;
  /* Sam typ, bez parametrów w rodzaju `; charset=` — i bez wielkości liter,
     bo RFC 2045 mówi, że typ jest nieczuły na wielkość, a nadawcy bywają różni. */
  const czysty = String(mime).split(";")[0]!.trim().toLowerCase();
  return TYPY_PODGLADU.find((t) => t === czysty) ?? null;
}

/** Wzmianka w komentarzu — kto ma to przeczytać. */
export interface Wzmianka { userId: number; name: string }

export interface WpisOsi {
  id: string; rodzaj: "wiadomosc" | "zlecenie" | "wynik_zadania" | "komentarz" | "status" | "sprawa" | "dobor";
  autor: string; odKlienta: boolean; tresc: string; at: string;
  ofertaId: string | null; zadanieId?: number; messageId?: number;
  /**
   * Szczegóły ZLECENIA dla hali (0.226.0) — tylko przy `rodzaj: "zlecenie"`.
   *
   * Osobne pole, nie doklejka do `tresc`: panel rysuje z tego blok ze
   * statusem, priorytetem i kartoteką, a sklejanie tego w jeden łańcuch
   * kazałoby frontowi rozbierać tekst z powrotem na części.
   */
  zlecenie?: {
    rodzaj: string; tytul: string; status: string; priorytet: string;
    /** Kto wziął zadanie na kolektorze. `null` = jeszcze nikt. */
    przypisanoPrzez: string | null;
    twId: number | null; symbol: string | null; nazwaTowaru: string | null;
  };
  /* Nazwa towaru przy ofercie — Z ZAMÓWIENIA, nie z oferty (§4.3: każdy fakt
     niesie źródło). Ofert nie pobieramy; nazwę znamy tylko dla oferty, która
     kiedykolwiek przeszła przez pobrane zamówienie. `null` = nie znamy. */
  nazwaOferty?: string | null;
  /* Zamówienie, którego dotyczy wiadomość — gałąź `relatesTo.order` (0.166.0). */
  zamowienieId?: string | null;
  zalaczniki?: ZalacznikOsi[];
  wzmianki?: Wzmianka[];
  /* Nasze automatyczne potwierdzenie „Dziękujemy za kontakt" (0.218.0). Panel
     zwija taki wpis do jednej linijki. Flaga stoi wyłącznie przy wiadomościach
     WYCHODZĄCYCH — uzasadnienie w `czyAutoresponder`. */
  automatyczna?: boolean;
  /* Blok firmowy odcięty od treści (0.219.1): nazwa spółki, adres, NIP, KRS,
     REGON, telefon. `tresc` jest wtedy BEZ niego, a panel chowa go pod
     przyciskiem. Też tylko przy wychodzących — patrz `podzielStopke`. */
  stopka?: string;
}
export interface StanSkrzynki { ostatniaSynchronizacja: string | null; bledy: number }

/* Zamówienie przy rozmowie. `pobrane` jest `null`, dopóki ticker
   `uzupelnijZamowienia` go nie dociągnie — numer i odnośnik są od razu. */
export interface ZamowienieRozmowy {
  externalId: string; link: string | null; pobrane: Zamowienie | null;
}

/* Oferta, pod którą padło pytanie (0.178.0). `pobrana` jest `null`, dopóki
   ticker nie dociągnie snapshotu — numer i odnośnik są od razu, jak przy
   zamówieniu. Cena jest ze snapshotu, więc opisuje CHWILĘ pytania (§15.2),
   a nie dzisiejszy cennik. */
export interface OfertaRozmowy {
  externalId: string; link: string | null;
  /**
   * Skąd numer oferty (0.215.0): wskazanie agenta bije numer z wiadomości,
   * a gdy nie ma żadnego z nich — JEDYNA pozycja zamówienia. Do 0.213.0
   * ręczne wskazanie zapisywało się w zdarzeniu, a blok oferty go nie czytał;
   * rozmowa z samym zamówieniem stała bez oferty i bez kartoteki, choć
   * zamówienie nazywa towar dokładniej niż oferta.
   */
  zrodlo: "wiadomosc" | "reczne" | "zamowienie";
  pobrana: {
    nazwa: string; sku: string | null; cenaGrosze: number | null;
    waluta: string | null; status: string | null; syncedAt: string;
    /* Co wiadomo o zdjęciu listingowym (0.214.0; do 0.213.0 `maZdjecie: boolean`).
       Adres NIE jedzie do panelu i to jest cała różnica: gdyby jechał, front
       miałby w ręku `https://a.allegroimg.com/…` i prędzej czy później ktoś
       wstawiłby go w `src`, czyli wyprowadził przeglądarkę biura poza własną
       sieć. Jedzie sam STAN — a stany są trzy, bo „czekam na Allegro" i „tej
       oferty Allegro nie ma z czym pokazać" to dwa różne zdania na ekranie. */
    zdjecie: StanZdjeciaOferty;
  } | null;
  /* Kartoteka Subiekta wywiedziona z SKU oferty (0.179.0). Od 0.219.0 jedno
     trafienie po sygnaturze jest POWIĄZANIEM (decyzja właściciela), a zdanie
     źródła mówi, że stoi za nim sygnatura, nie człowiek — §4.3 nie pozwala,
     żeby wynik automatu udawał daną z Allegro. Ciężkich danych towaru tu NIE MA: stan, półki i zamienniki
     panel bierze z `GET /api/products/:twId`, bo `osRozmowy` odświeża się
     przy każdym zdarzeniu szyny, a karta towaru ciągnie kolejkę MM. */
  kartoteka: Dopasowanie;
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
  SELECT c.id, c.unread,
         -- KLIENT TO LOGIN, NIE TEMAT (0.228.0). 0.219.2 naprawiło to na OSI
         -- rozmowy i zatrzymało się w pół drogi: nagłówek rozmowy i wiersz
         -- kolejki dalej brały c.subject. Na koncie właściciela temat bywa
         -- równy loginowi, więc wyglądało poprawnie — aż do wątku o temacie
         -- „Zaworek zwrotny", który podpisywał klienta nazwą części.
         -- Złączenie po identyfikatorze wątku, jak w klient-historia.ts.
         COALESCE(
           (SELECT t.interlocutor_login FROM allegro_inbox_thread t
             WHERE t.id = c.external_conversation_id),
           c.subject, 'Klient') AS klient,
         c.assigned_user_id AS wlascicielId, u.name AS wlasciciel, c.version AS wersja,
         c.status, c.snoozed_until AS odlozoneDo,
         c.priorytet,
         o.body AS ostatniaWiadomosc,
         COALESCE(o.sent_at, c.updated_at) AS ostatniaWiadomoscAt,
         o.direction AS ostatniKierunek,
         -- KTO PISAŁ NAPRAWDĘ OSTATNI (0.225.0). Kolumna ostatniKierunek wyżej
         -- NIE nadaje się do wyliczenia stanu: złączenie o celowo preferuje
         -- ostatnią wiadomość KLIENTA, bo podgląd w kolejce ma pokazywać jego
         -- słowa, nie nasze. Użycie go tutaj dawało „czeka na nas" także tuż
         -- po naszej odpowiedzi.
         -- AUTOODPOWIEDŹ NIE JEST NASZYM RUCHEM (0.227.0): „Dziękujemy za
         -- kontakt" wychodzi samo, w sekundę po pytaniu, i nie odpowiada na
         -- nic. Liczona jako nasza wiadomość zdejmowała rozmowę z listy tych,
         -- które czekają na odpowiedź.
         (SELECT m.direction FROM message m
           WHERE m.conversation_id=c.id AND m.auto_odpowiedz=0
           ORDER BY m.id DESC LIMIT 1) AS ostatniRuch,
         -- Czas oczekiwania liczy się od ostatniej wiadomości KLIENTA, nie od
         -- ostatniaWiadomoscAt: tamto ma COALESCE na updated_at, więc wątek
         -- zaczęty przez nas dostałby zegar, którego nikt nie odmierza.
         (SELECT MAX(k.sent_at) FROM message k
           WHERE k.conversation_id=c.id AND k.direction='incoming') AS pytanieAt,
         -- Licznik dopisków liczy się OD NASZEJ PRAWDZIWEJ ODPOWIEDZI
         -- (0.227.0). Autoodpowiedź stojąca po pytaniu zerowała go, więc
         -- wiersz kolejki mówił „zero dopisków" o rozmowie, w której klient
         -- napisał i nikt mu nie odpowiedział.
         (SELECT COUNT(*) FROM message k
           WHERE k.conversation_id=c.id AND k.direction='incoming'
             AND k.id > COALESCE((SELECT MAX(n.id) FROM message n
                                   WHERE n.conversation_id=c.id
                                     AND n.direction='outgoing' AND n.auto_odpowiedz=0), 0)
         ) AS nowych,
         EXISTS(SELECT 1 FROM zadanie_terenowe z
                 WHERE z.conversation_id=c.id AND z.status IN ('nowe','w_toku')) AS zadanie,
         COALESCE(d.status, 'not_started') AS dobor,
         kop.kategoria AS kopKategoria, kop.pewnosc AS kopPewnosc,
         kop.ocena AS kopOcena,
         -- Etykieta starzeje się sama: liczono ją na kop.message_id, a klient
         -- dopisał nowszą. Podzapytanie jest CO DO ZNAKU tym samym, co WIERSZ
         -- w copilot-klasyfikacja.ts. Rozejście się tych dwóch kwalifikacji
         -- dałoby rozmowę wiecznie nieaktualną, klasyfikowaną w kółko przy
         -- każdym kliknięciu i płaconą za każdym razem.
         (kop.message_id IS NOT NULL AND kop.message_id <> (
            SELECT m.id FROM message m WHERE m.conversation_id=c.id
              AND m.direction='incoming' ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
         )) AS kopNieaktualna
    FROM conversation c
    LEFT JOIN app_user u ON u.user_id=c.assigned_user_id
    LEFT JOIN dobor_rozmowy d ON d.conversation_id=c.id
    LEFT JOIN klasyfikacja_rozmowy kop ON kop.conversation_id=c.id
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
    /* Te same DWIE reguły co w `statusRozmowy`, liczone tu bez dodatkowego
       zapytania na wiersz — kierunek ostatniej wiadomości niesie już `LISTA`.
       Najpierw wygasa odłożenie (kolumna zostaje `snoozed` do ręcznej zmiany),
       potem rozmowa mówi, kto ma następny ruch. Regułę drugą trzyma
       `statusZKierunku`: gdyby kolejka liczyła ją po swojemu, mówiłaby co
       innego niż otwarta rozmowa. */
    status: statusZKierunku(
      (String(w.status) === "snoozed" && minal ? "open" : String(w.status)) as StatusRozmowy,
      w.ostatniRuch == null ? null : String(w.ostatniRuch)),
    priorytet: String(w.priorytet ?? "normalny") === "pilny" ? "pilny" : "normalny",
    czekaOdMs: w.pytanieAt == null ? null : Math.max(0, teraz - Date.parse(String(w.pytanieAt))),
    nowychOdOdpowiedzi: Number(w.nowych ?? 0),
    zadanieWToku: Boolean(Number(w.zadanie ?? 0)),
    dobor: String(w.dobor ?? "not_started") as StatusDoboru,
    odlozoneDo,
    poTerminie: String(w.status) === "snoozed" && minal,
    kopilot: w.kopKategoria == null ? null : {
      kategoria: String(w.kopKategoria) as Kategoria,
      pewnosc: String(w.kopPewnosc) as Pewnosc,
      nieaktualna: Boolean(Number(w.kopNieaktualna ?? 0)),
      ocena: w.kopOcena == null ? null : (String(w.kopOcena) as "trafna" | "nietrafna"),
    },
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
  /* PILNE na górze, potem najdłużej czekające pytanie (0.181.0).
     Właściciel wybrał obie drogi naraz: ręczna flaga przebija automatyczną
     kolejność. Terminu odpowiedzi nie ma (§26 zostaje bez rozstrzygnięcia),
     więc automatyczną kolejność niesie CZAS OCZEKIWANIA — najstarsze pytanie
     klienta stoi wyżej. Rozmowa bez pytania klienta idzie na koniec: nie ma
     tam nikogo, kto czeka.

     Data wątku zostaje ostatnim rozstrzygnięciem, a `id` tie-breakerem: dwie
     rozmowy z tą samą datą stały dotąd w kolejności, jaką dał planer zapytań,
     czyli w żadnej. */
  return (db().prepare(`${LISTA}
    ORDER BY CASE c.priorytet WHEN 'pilny' THEN 0 ELSE 1 END,
             pytanieAt IS NULL, pytanieAt ASC,
             c.updated_at DESC, c.id DESC`).all() as Array<Record<string, unknown>>)
    .map((w) => naRozmowe(w, Date.now(), trzymane));
}

/**
 * Snapshot oferty dla rozmowy. `null` znaczy „ticker jeszcze nie dociągnął”,
 * a nie „oferta nie istnieje” — panel ma powiedzieć różnicę, bo cisza w tym
 * miejscu wygląda jak usterka.
 */
function snapshotOferty(konto: number, ofertaId: string): OfertaRozmowy["pobrana"] {
  const w = db().prepare(`SELECT nazwa, sku, cena_grosze, waluta, status, synced_at,
        primary_image_url
      FROM offer_snapshot WHERE channel_account_id=? AND external_id=?`)
    .get(konto, ofertaId) as Record<string, unknown> | undefined;
  if (!w) return null;
  return {
    nazwa: String(w.nazwa),
    sku: w.sku == null ? null : String(w.sku),
    cenaGrosze: w.cena_grosze == null ? null : Number(w.cena_grosze),
    waluta: w.waluta == null ? null : String(w.waluta),
    status: w.status == null ? null : String(w.status),
    syncedAt: String(w.synced_at),
    zdjecie: stanZdjeciaOferty(w.primary_image_url as string | null),
  };
}

/** Oś rozmowy: wiadomości kanału przeplecione wynikami zadań z hali. */
export function osRozmowy(id: number): {
  rozmowa: RozmowaSkrzynki; os: WpisOsi[]; szkic: Szkic | null;
  ofertaWskazana: OfertaWskazana | null; sprawa: SprawaRozmowy | null;
  zamowienie: ZamowienieRozmowy | null; oferta: OfertaRozmowy | null;
  /**
   * Zwroty TEGO zamówienia (0.221.0). Właściciel: „klienci często pytają
   * pod zamówieniem o zwrot, którego dokonali" — agent szedł po stan zwrotu
   * do ekranu Zwroty i szukał go ręcznie. Mostkiem jest numer zamówienia,
   * ten sam, którym zwrot znajduje swoje rozmowy od 0.169.0; po loginie
   * dobierać nie wolno (blizna 0.56.6). Bez zamówienia lista jest pusta.
   */
  zwroty: WierszZwrotu[];
  dobor: Dobor;
  /** Propozycja Copilota (§14.6) — osobny wiersz, nie szkic agenta. `null` = nikt nie prosił. */
  szkicCopilota: SzkicCopilota | null;
} {
  const wiersz = db().prepare(`${LISTA} WHERE c.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!wiersz) throw new Error("Nie znaleziono rozmowy");
  const rozmowa = naRozmowe(wiersz, Date.now(), uchwyty());

  /* Nazwa towaru przy ofercie: NAJPIERW snapshot oferty (0.178.0), a gdy go
     jeszcze nie ma — ostatnia pozycja zamówienia o tym numerze oferty.
     Kolejność nie jest obojętna: snapshot to tytuł SAMEJ oferty, a pozycja
     zamówienia opisuje ten towar tak, jak nazywał się w chwili zakupu.
     Do 0.177.1 stała tu wyłącznie druga droga, więc pytanie SPRZED zakupu —
     czyli każde zadane pod ofertą — zostawało z gołym numerem. */
  const wiadomosci = db().prepare(`
    SELECT m.id, m.direction, m.body, m.sent_at, m.auto_odpowiedz AS auto,
           m.related_object_type AS typ,
           m.related_object_id AS oferta, m.related_order_id AS zamowienie,
           m.channel_account_id AS konto,
           /* ── PODPIS TO LOGIN, NIE TEMAT (0.219.2) ────────────────────────
              Do 0.219.1 stała tu kolumna c.subject i przez to podpis
              wiadomości niósł TEMAT WĄTKU. Na koncie właściciela temat bywa
              równy loginowi, więc wyglądało to poprawnie — i dokładnie dlatego
              było groźne: przy wątku o temacie „Zaworek zwrotny" wiadomość
              klienta podpisywała się nazwą części.

              Login stoi w allegro_inbox_thread, złączony po identyfikatorze
              wątku, tak samo jak w klient-historia.ts (§4.3: jedno źródło na
              jeden fakt). COALESCE zostawia temat jako drugą drogę i słowo
              „Klient" jako trzecią — wątek bez rozmówcy istnieje. */
           COALESCE(
             (SELECT t.interlocutor_login FROM allegro_inbox_thread t
               WHERE t.id = c.external_conversation_id),
             c.subject, 'Klient') AS klient,
           COALESCE(
             (SELECT o.nazwa FROM offer_snapshot o
               WHERE o.channel_account_id = m.channel_account_id
                 AND m.related_object_type = 'OFFER' AND o.external_id = m.related_object_id),
             (SELECT p.nazwa FROM zamowienie_klienta_pozycja p
                JOIN zamowienie_klienta k ON k.id = p.zamowienie_id
               WHERE k.channel_account_id = m.channel_account_id
                 AND m.related_object_type = 'OFFER' AND p.offer_id = m.related_object_id
               ORDER BY p.id DESC LIMIT 1)) AS nazwaOferty
      FROM message m JOIN conversation c ON c.id=m.conversation_id
     WHERE m.conversation_id=? ORDER BY m.id
  `).all(id) as Array<Record<string, unknown>>;

  /* Załączniki jednym zapytaniem dla całej rozmowy, nie po jednym na
     wiadomość: siedem na trzydzieści dziewięć wiadomości to zbyt mało, żeby
     płacić za to osobnym odpytaniem przy każdym wierszu osi. */
  const zalaczniki = new Map<number, ZalacznikOsi[]>();
  for (const z of db().prepare(`
    SELECT a.id, a.message_id, a.file_name, a.mime_type, a.status, a.url
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
      /* Podgląd wymaga OBU warunków: obrazu i zgody Allegro. Sam obraz nie
         wystarcza — `UNSAFE` znaczy, że plik jest podejrzany, a rysowanie go
         na osi byłoby wpuszczeniem go do biura tylnymi drzwiami.

         `mimeType` jest w schemacie Allegro OPCJONALNE. Gdy go nie ma, o UKŁADZIE
         decyduje nazwa pliku (jak w reklamacjach od 0.223.0), a o WYDANIU —
         sygnatura bajtów na trasie podglądu; plik nazwany `usterka.jpg` bez
         sygnatury obrazu dostaje 415 i spada na przycisk pobrania. Do tego
         wydania brak pola znaczył „nie obraz" i zdjęcie z telefonu zostawało
         samą nazwą, bez zdania dlaczego. */
      podglad: String(z.status) === "SAFE" && z.url != null
        && (typPodgladu(z.mime_type as string | null) !== null
          || (z.mime_type == null && czyObrazZNazwy(String(z.file_name)))),
    });
    zalaczniki.set(Number(z.message_id), lista);
  }

  /* Kolejność niesie `message.id`, nie `sent_at`. Do 0.151.0 stało tu
     uzasadnienie „Allegro podaje datę wątku, nie wiadomości" — nieprawdziwe,
     `createdAt` jest per wiadomość. Kolejność po identyfikatorze zostaje, bo
     jest stabilna także przy dwóch wiadomościach z tej samej sekundy. */
  const os: WpisOsi[] = wiadomosci.map((m) => {
    /* Stopkę odcinamy TYLKO od naszych wiadomości: cytat naszej odpowiedzi
       w liście klienta niesie ją w środku, a cięcie „do końca" zabrałoby to,
       co klient dopisał pod spodem. */
    const wychodzaca = String(m.direction) === "outgoing";
    const { tresc, stopka } = wychodzaca
      ? podzielStopke(String(m.body))
      : { tresc: String(m.body), stopka: null };
    return {
    id: `msg-${m.id}`, rodzaj: "wiadomosc" as const, messageId: Number(m.id),
    autor: String(m.direction) === "incoming" ? String(m.klient ?? "Klient") : "Biuro",
    odKlienta: String(m.direction) === "incoming",
    tresc, at: String(m.sent_at),
    ofertaId: String(m.typ ?? "") === "OFFER" ? String(m.oferta) : null,
    nazwaOferty: m.nazwaOferty == null ? null : String(m.nazwaOferty),
    zamowienieId: m.zamowienie == null ? null : String(m.zamowienie),
    ...(zalaczniki.has(Number(m.id)) ? { zalaczniki: zalaczniki.get(Number(m.id)) } : {}),
    /* Znacznik z KOLUMNY, nie liczony drugi raz (0.227.0): tę samą wartość
       czyta kolejka przy wyliczaniu, kto ma ruch, a jedno źródło znaczy, że
       oba miejsca nie mogą się rozejść. */
    ...(Number(m.auto ?? 0) ? { automatyczna: true } : {}),
    ...(stopka == null ? {} : { stopka }),
    };
  });

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

  /* JEDNA oferta na rozmowę, tą samą regułą co zamówienie: numer z najnowszej
     wiadomości KLIENTA, która go niesie. Snapshot doczytujemy, gdy ticker już
     go zapisał — odczyt niczego nie pobiera („zero zapisu przy patrzeniu”). */
  const zrodloOferty = zNumerem.find((m) => String(m.typ ?? "") === "OFFER" && m.oferta != null
      && String(m.direction) === "incoming")
    ?? zNumerem.find((m) => String(m.typ ?? "") === "OFFER" && m.oferta != null);
  const kontoRozmowy = Number((db().prepare("SELECT channel_account_id AS konto FROM conversation WHERE id=?")
    .get(id) as { konto: number }).konto);
  /* SKU z pozycji zamówienia o tym numerze oferty — zapas na czas, gdy
     snapshotu jeszcze nie ma. Pozycja ma SKU od razu, z formularza zakupu,
     więc kartoteka nie musi czekać na takt ofert; dotyczy każdej z trzech
     dróg, bo wskazanie ręczne bywa właśnie kliknięciem przy pozycji. */
  const skuZPozycji = (ofertaId: string) =>
    zamowienie?.pobrane?.pozycje.find((p) => p.offerId === ofertaId)?.sku ?? null;
  const zOferty = (konto: number, ofertaId: string, zrodlo: OfertaRozmowy["zrodlo"]): OfertaRozmowy => {
    const pobrana = snapshotOferty(konto, ofertaId);
    const skuZapas = skuZPozycji(ofertaId);
    return {
      externalId: ofertaId,
      link: linkOferty(ofertaId),
      zrodlo,
      pobrana,
      /* `undefined` zamiast `null`, gdy snapshotu nie ma wcale: mostek odróżnia
         „oferty jeszcze nie pobrano" od „oferta nie ma sygnatury", a to dwa
         różne zdania na ekranie i dwie różne rzeczy do zrobienia. Oferta
         z zamówienia ma zapas: SKU pozycji z formularza zakupu jest od razu. */
      kartoteka: kartotekaOferty(db(), konto, ofertaId, pobrana ? pobrana.sku : (skuZapas ?? undefined)),
    };
  };
  /* Kolejność jak w doborze (`kandydaci.ts`): ręczne wskazanie bije numer
     z wiadomości. Trzecia droga jest nowa (0.215.0): zamówienie z JEDNĄ
     pozycją nie ma czego mylić, więc jego oferta jest ofertą rozmowy. Przy
     kilku pozycjach rozstrzyga człowiek — przyciskiem przy pozycji. */
  const reczna = ofertaWskazana(id);
  const jedynaPozycja = zamowienie?.pobrane?.pozycje.length === 1 && zamowienie.pobrane.pozycje[0].offerId
    ? zamowienie.pobrane.pozycje[0] : null;
  const oferta: OfertaRozmowy | null = reczna ? zOferty(kontoRozmowy, reczna.ofertaId, "reczne")
    : zrodloOferty ? zOferty(Number(zrodloOferty.konto), String(zrodloOferty.oferta), "wiadomosc")
    : jedynaPozycja ? zOferty(kontoRozmowy, String(jedynaPozycja.offerId), "zamowienie")
    : null;

  /* ── ZLECENIE I WYNIK TO DWA WPISY (0.226.0) ────────────────────────────
     Do 0.224.0 oś pokazywała sam WYNIK z hali. Zlecenie — czyli moment,
     w którym agent poprosił magazyn o pomiar — nie zostawiało po sobie nic
     poza kreskami zmian statusu rozmowy, z których nie da się odczytać, o co
     kto prosił. Zgłoszenie właściciela: „zlecenie zmierzenia też powinno
     zostać pokazane jako blok w wiadomości".

     Rozdzielenie na dwa wpisy, a nie jeden blok „zlecenie z wynikiem", bo to
     dwa różne momenty i oś jest chronologiczna: między prośbą a odpowiedzią
     hali mija czas, a w nim bywają wiadomości klienta. Sklejenie ich w jeden
     kafelek przesunęłoby prośbę do godziny odpowiedzi i skłamało o kolejności.

     Zlecenie jedzie w KAŻDYM statusie, także niewykonane — to jest cała jego
     wartość przy otwartej rozmowie: „poprosiłem halę i czekam" widać dopiero
     wtedy, gdy prośba ma swój wpis. Wynik dalej wymaga `wykonane` i treści. */
  const zlecenia = db().prepare(`
    SELECT z.id, z.rodzaj, z.tytul, z.instrukcja, z.status, z.priorytet,
           z.utworzono_at, z.utworzono_przez, z.przypisano_przez, z.tw_id AS twId,
           t.symbol, t.nazwa AS nazwaTowaru
      FROM zadanie_terenowe z
      LEFT JOIN sgt_towar t ON t.tw_id = z.tw_id
     WHERE z.conversation_id=? ORDER BY z.utworzono_at, z.id
  `).all(id) as Array<Record<string, unknown>>;
  for (const z of zlecenia) {
    os.push({
      id: `zlecenie-${z.id}`, rodzaj: "zlecenie",
      autor: String(z.utworzono_przez ?? "biuro"), odKlienta: false,
      /* Treścią wpisu jest INSTRUKCJA, nie tytuł: to ona mówi, o co dokładnie
         poproszono halę, a tytuł jest etykietą i jedzie osobnym polem. */
      tresc: String(z.instrukcja ?? ""), at: String(z.utworzono_at),
      ofertaId: null, zadanieId: Number(z.id),
      zlecenie: {
        rodzaj: String(z.rodzaj), tytul: String(z.tytul), status: String(z.status),
        priorytet: String(z.priorytet ?? "normalny"),
        przypisanoPrzez: z.przypisano_przez == null ? null : String(z.przypisano_przez),
        twId: z.twId == null ? null : Number(z.twId),
        symbol: z.symbol == null ? null : String(z.symbol),
        nazwaTowaru: z.nazwaTowaru == null ? null : String(z.nazwaTowaru),
      },
    });
  }

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

  /* DOBÓR NA OSI (etap E1): zmiana statusu, wybór i zdjęcie wyboru — kreską,
     jak status rozmowy. Bez tych wpisów „dlaczego dobór stoi na
     `missing_information`" byłoby pytaniem do kolegi, nie do ekranu. */
  for (const z of db().prepare(`
    SELECT id, event_type, payload, created_at FROM conversation_event
     WHERE conversation_id=? AND event_type IN ('dobor_status_changed','dobor_wybrano','dobor_wybor_zdjety')
     ORDER BY id
  `).all(id) as Array<Record<string, unknown>>) {
    const p = JSON.parse(String(z.payload ?? "{}")) as
      { przed?: string; po?: string; brakuje?: string; symbol?: string; droga?: string; autor?: string };
    const typ = String(z.event_type);
    const tresc = typ === "dobor_status_changed"
      ? `dobór: ${p.przed ?? "?"} → ${p.po ?? "?"}${p.brakuje ? ` (brakuje: ${p.brakuje})` : ""}`
      : typ === "dobor_wybrano"
      ? `dobór: wybrano ${p.symbol ?? "?"} (droga: ${p.droga ?? "?"})`
      : `dobór: zdjęto wybór ${p.symbol ?? "?"}`;
    os.push({
      id: `dobor-${z.id}`, rodzaj: "dobor", autor: String(p.autor ?? "system"),
      odKlienta: false, tresc, at: String(z.created_at), ofertaId: null,
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
    zamowienie, oferta,
    zwroty: zamowienie
      ? listaZwrotow(db(), Date.now(), { channelAccountId: kontoRozmowy, orderId: zamowienie.externalId })
      : [],
    /* Dobór jedzie z rozmową, bo jest lekki (jeden wiersz); KANDYDACI nie —
       to wyszukiwarka i parser opisu, a ten odczyt odświeża się na każde
       zdarzenie szyny. */
    dobor: doborRozmowy(id),
    szkicCopilota: szkicCopilota(id),
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
