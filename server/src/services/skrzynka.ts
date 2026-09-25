import { db } from "../db/db.js";
import { utworzZadanie } from "./zadania-terenowe.js";
import { uchwyty } from "./conversation-realtime.js";
import { klientPodziekowal, ustawStatus, wyliczStatus, type ZrodloZakonczenia } from "./conversations.js";
import type { StatusRozmowy } from "./conversations.js";
import { zamowienieRozmowy, type Zamowienie } from "./zamowienia.js";
import {
  kandydaciZamowien, numerZamowieniaRozmowy, type KandydatZamowienia,
} from "./zamowienia-kandydaci.js";
import { listaZwrotow, type WierszZwrotu } from "./zwroty.js";
import {
  idZamowienia, przesylkaZamowienia, type StanPrzesylkiZamowienia,
} from "./przesylka-zamowienia.js";
import { drogaZakupu, sprawyZakupu, type PrzystanekDrogi, type SprawaZakupu }
  from "./droga-klienta.js";
import { linkOferty, linkZamowienia } from "./allegro-linki.js";
import { kartotekaOferty, type Dopasowanie } from "./dopasowanie-sku.js";
import { stanZdjeciaOferty, type StanZdjeciaOferty } from "./zdjecia-ofert.js";
import { doborRozmowy, type Dobor, type StatusDoboru } from "./dobor.js";
import { zgodnoscOferty, type ZgodnoscOferty } from "./zgodnosc-oferty.js";
import { szkicCopilota, type SzkicCopilota } from "./copilot-szkic.js";
import { AKTYWNA_DECYZJA, CEL_KLASYFIKACJI } from "./copilot-klasyfikacja.js";
import type {
  Akcja, Kategoria, Pewnosc, StatusDecyzji, Zrodlo,
} from "./klasyfikacja-slownik.js";
import { podzielStopke } from "./stopka.js";
import { czyObrazZNazwy } from "./reklamacje.js";
import { zdarzeniaZwrotowRozmowy } from "./zwrot-na-osi.js";

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
   * Ręczny znacznik „to sprawa reklamacyjna" (0.390.0).
   *
   * NASZ, nie Allegro: sprawy posprzedażowej sprzedawca nie może założyć
   * (`/sale/issues` ma wyłącznie GET). Mówi, że rozmowę prowadzimy jak
   * reklamację, i nic poza tym — zegara ustawowego rozmowa nie dostaje.
   */
  reklamacyjna: boolean;
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
  /* Ostatnia wiadomość klienta to podziękowanie po naszej odpowiedzi
     (22 września 2026). Od 23 września rozmowa jest wtedy ZAKOŃCZONA, a
     znacznik mówi dlaczego — inaczej wiersz z wiadomością klienta na
     podglądzie wyglądałby jak pytanie, które ktoś przeoczył. Liczy SERWER,
     regułą `klientPodziekowal`, tą samą co przy jednej rozmowie. */
  podziekowal: boolean;
  /** Skąd zakończenie, gdy `status` to `resolved`; inaczej `null` (patrz `wyliczStatus`). */
  zakonczenie: ZrodloZakonczenia | null;
  /* Rozpoznanie Copilota (§14, etap F). `null` znaczy „nierozpoznana" i liczy
     się PRZY ODCZYCIE — brak wiersza w `decyzja_klasyfikacji` niczego nie
     wstawia, więc otwarcie kolejki dalej nic nie mutuje.

     `nieaktualna` liczy SERWER, tak samo jak `poTerminie`: reguła „klient
     dopisał po rozpoznaniu" ma jedno źródło, a panel drugi raz jej nie
     wyprowadza (blizna z kubełków zwrotów). Wyszarzona plakietka mówi
     agentowi, że etykieta dotyczy starszej wiadomości — milczenie o tym
     byłoby gorsze niż brak etykiety. */
  kopilot: {
    kategoria: Kategoria;
    dodatkowe: Kategoria[];
    akcja: Akcja;
    /** Akcja modelu, gdy polityka zamieniła ją na przegląd. `null` = bez zmian. */
    akcjaModelu: Akcja | null;
    wymagaCzlowieka: boolean;
    brakDanychZamowienia: boolean;
    brakDanychProduktu: boolean;
    /** Pewność ZGŁOSZONA przez model; `null` przy decyzji bez modelu. */
    pewnosc: Pewnosc | null;
    zrodlo: Zrodlo;
    status: StatusDecyzji;
    kody: string[];
    uzasadnienie: string | null;
    nieaktualna: boolean;
    /** Kategoria, którą człowiek JAWNIE potwierdził albo wskazał. */
    kategoriaCzlowieka: Kategoria | null;
    /** Kategoria modelu — zostaje obok poprawki, żeby było widać, co poprawiono. */
    kategoriaModelu: Kategoria | null;
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
  id: string;
  /* `odeslanie_zadania` (0.352.0) to ODPOWIEDŹ HALI BEZ WYNIKU. Osobny rodzaj,
     nie `wynik_zadania` z treścią „nie da się": agent czytający oś ma widzieć,
     że pomiaru NIE MA, a nie że pomiar brzmi jak wymówka. */
  rodzaj: "wiadomosc" | "zlecenie" | "wynik_zadania" | "odeslanie_zadania" | "komentarz" | "status" | "dobor"
    /* Kamień milowy zwrotu tego zamówienia (@wydanie) — `zwrot-na-osi.ts`. */
    | "zwrot";
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
  /**
   * Zdarzenie w postaci KLUCZY (0.243.0) — przy `status` i `dobor`.
   * `tresc` zostaje zdaniem dla podpowiedzi, a to pole niesie
   * to samo rozłożone na części, żeby pasek zdarzeń mógł pokazać krótką
   * etykietę po polsku. Słownik polszczyzny stoi w panelu — angielskie klucze
   * zostają w bazie i w API. Panel nie ma prawa rozbierać `tresc` z powrotem:
   * to jest zdanie dla człowieka, a nie format.
   */
  zdarzenie?:
    | { rodzaj: "status" | "dobor"; po: string | null }
    | { rodzaj: "dobor_wybor"; wybrano: boolean; symbol: string | null }
    | { rodzaj: "zwrot"; co: string; zwrotId: number; numer: string | null };
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
  /** Co wiemy o paczce — `null`, dopóki zamówienia nie ma w bazie (nie ma czego pytać). */
  przesylka: StanPrzesylkiZamowienia | null;
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
  /**
   * Lista „Pasuje do" z oferty i trafienia maszyny z doboru (23 września
   * 2026). `null`, gdy treści oferty jeszcze nie pobrano albo lista jest
   * pusta — dociąga ją układanie szkicu, nie otwarcie rozmowy.
   */
  zgodnosc: ZgodnoscOferty | null;
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
         c.priorytet, c.reklamacyjna,
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
         -- PO CZASIE, NIE PO id (23 września 2026): synchronizacja wpisywała
         -- paczkę od najnowszej, więc id nie rośnie z czasem. Ta sama reguła
         -- co kontrola świeżości wysyłki i klasyfikator.
         (SELECT m.direction FROM message m
           WHERE m.conversation_id=c.id AND m.auto_odpowiedz=0
           ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS ostatniRuch,
         -- Chwila tego ruchu i stan wątku u Allegro: z nich zakończenie
         -- liczy się samo (23 września 2026, reguła w wyliczStatus).
         (SELECT m.sent_at FROM message m
           WHERE m.conversation_id=c.id AND m.auto_odpowiedz=0
           ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS ostatniRuchAt,
         (SELECT t.watek_status FROM allegro_inbox_thread t
           WHERE t.id = c.external_conversation_id) AS watekStatus,
         c.otwarta_recznie_at AS otwartaRecznieAt,
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
         kop.kategorie_dodatkowe AS kopDodatkowe, kop.akcja AS kopAkcja,
         kop.akcja_modelu AS kopAkcjaModelu, kop.wymaga_czlowieka AS kopWymaga,
         kop.brak_danych_zamowienia AS kopBrakZam, kop.brak_danych_produktu AS kopBrakProd,
         kop.zrodlo AS kopZrodlo, kop.status AS kopStatus, kop.kody_polityki AS kopKody,
         kop.uzasadnienie AS kopUzasadnienie, kop.kategoria_czlowieka AS kopCzlowiek,
         kop.kategoria_modelu AS kopModel,
         -- Etykieta starzeje się sama: liczono ją na kop.message_id, a klient
         -- dopisał nowszą. Wiadomość-cel bierze się ze WSPÓLNEGO fragmentu
         -- CEL_KLASYFIKACJI (bez odwrotnych apostrofów: to wnętrze szablonu SQL)
         -- — do 0.426 stała tu kopia „co do znaku", a rozjazd
         -- dawał rozmowę wiecznie nieaktualną, płaconą przy każdym kliknięciu.
         (kop.message_id IS NOT NULL AND kop.message_id <> ${CEL_KLASYFIKACJI}) AS kopNieaktualna,
         -- Nasza PRAWDZIWA odpowiedź w wątku — warunek podziękowania: bez niej
         -- „dziękuję" nie jest podziękowaniem ZA nic. Autoodpowiedź się nie
         -- liczy, z tego samego powodu co przy ostatnim ruchu wyżej.
         EXISTS(SELECT 1 FROM message n WHERE n.conversation_id=c.id
                  AND n.direction='outgoing' AND n.auto_odpowiedz=0) AS naszaOdpowiedz
    FROM conversation c
    LEFT JOIN app_user u ON u.user_id=c.assigned_user_id
    LEFT JOIN dobor_rozmowy d ON d.conversation_id=c.id
    LEFT JOIN decyzja_klasyfikacji kop ON kop.id = ${AKTYWNA_DECYZJA}
    LEFT JOIN message o ON o.id = (
      SELECT m.id FROM message m WHERE m.conversation_id=c.id
       ORDER BY (m.direction='incoming') DESC, m.sent_at DESC, m.id DESC LIMIT 1)`;

const naRozmowe = (
  w: Record<string, unknown>,
  teraz = Date.now(),
  trzymane: Map<number, { userId: number; name: string }> = new Map(),
): RozmowaSkrzynki => {
  const odlozoneDo = w.odlozoneDo === null ? null : String(w.odlozoneDo);
  const minal = Boolean(odlozoneDo && Date.parse(odlozoneDo) <= teraz);
  const ostatniRuch = w.ostatniRuch == null ? null : String(w.ostatniRuch);
  const podziekowal = ostatniRuch === "incoming" && w.kopKategoria != null && klientPodziekowal({
    kategoria: String(w.kopKategoria), akcja: String(w.kopAkcja), status: String(w.kopStatus),
    pewnosc: w.kopPewnosc == null ? null : String(w.kopPewnosc),
    wymagaCzlowieka: Boolean(Number(w.kopWymaga ?? 0)),
    nieaktualna: Boolean(Number(w.kopNieaktualna ?? 0)),
  }, Boolean(Number(w.naszaOdpowiedz ?? 0)));
  /* Te same reguły co w `statusRozmowy`, liczone tu bez dodatkowego
     zapytania na wiersz — kierunek, chwila ostatniego ruchu i stan wątku
     jadą już w `LISTA`. Najpierw wygasa odłożenie (kolumna zostaje
     `snoozed`), potem `wyliczStatus` mówi, kto ma ruch i czy sprawa się
     skończyła. Gdyby kolejka liczyła to po swojemu, mówiłaby co innego niż
     otwarta rozmowa. */
  const { status, zakonczenie } = wyliczStatus({
    zapisany: (String(w.status) === "snoozed" && minal ? "open" : String(w.status)) as StatusRozmowy,
    ostatniKierunek: ostatniRuch, podziekowal,
    ostatniRuchAt: w.ostatniRuchAt == null ? null : String(w.ostatniRuchAt),
    watekZamkniety: w.watekStatus === "CLOSED",
    otwartaRecznieAt: w.otwartaRecznieAt == null ? null : String(w.otwartaRecznieAt),
    teraz,
  });
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
    status,
    priorytet: String(w.priorytet ?? "normalny") === "pilny" ? "pilny" : "normalny",
    reklamacyjna: Boolean(Number(w.reklamacyjna ?? 0)),
    czekaOdMs: w.pytanieAt == null ? null : Math.max(0, teraz - Date.parse(String(w.pytanieAt))),
    nowychOdOdpowiedzi: Number(w.nowych ?? 0),
    zadanieWToku: Boolean(Number(w.zadanie ?? 0)),
    dobor: String(w.dobor ?? "not_started") as StatusDoboru,
    odlozoneDo,
    poTerminie: String(w.status) === "snoozed" && minal,
    /* Znacznik tylko tam, gdzie reguła naprawdę zmieniła stan: przy
       werdykcie zapisanym ręką przed 22 września status jej nie słucha,
       a „Czeka na klienta" po wiadomości klienta daje wyłącznie ona. */
    podziekowal: zakonczenie === "podziekowanie",
    zakonczenie,
    kopilot: w.kopKategoria == null ? null : {
      kategoria: String(w.kopKategoria) as Kategoria,
      dodatkowe: JSON.parse(String(w.kopDodatkowe ?? "[]")) as Kategoria[],
      akcja: String(w.kopAkcja) as Akcja,
      akcjaModelu: w.kopAkcjaModelu == null || w.kopAkcjaModelu === w.kopAkcja
        ? null : String(w.kopAkcjaModelu) as Akcja,
      wymagaCzlowieka: Boolean(Number(w.kopWymaga ?? 0)),
      brakDanychZamowienia: Boolean(Number(w.kopBrakZam ?? 0)),
      brakDanychProduktu: Boolean(Number(w.kopBrakProd ?? 0)),
      pewnosc: w.kopPewnosc == null ? null : String(w.kopPewnosc) as Pewnosc,
      zrodlo: String(w.kopZrodlo) as Zrodlo,
      status: String(w.kopStatus) as StatusDecyzji,
      kody: JSON.parse(String(w.kopKody ?? "[]")) as string[],
      uzasadnienie: w.kopUzasadnienie == null ? null : String(w.kopUzasadnienie),
      nieaktualna: Boolean(Number(w.kopNieaktualna ?? 0)),
      kategoriaCzlowieka: w.kopCzlowiek == null ? null : String(w.kopCzlowiek) as Kategoria,
      kategoriaModelu: w.kopModel == null ? null : String(w.kopModel) as Kategoria,
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

/* Stan paczki przy zamówieniu rozmowy (23 września 2026). Czysty odczyt tego,
   co zapisało ostatnie sprawdzenie — pytanie Allegro wisi na kliknięciu
   „sprawdź" i na układaniu szkicu, nigdy na otwarciu rozmowy. */
function przesylkaRozmowy(konto: number, externalId: string): StanPrzesylkiZamowienia | null {
  const id = idZamowienia(db(), konto, externalId);
  return id === null ? null : przesylkaZamowienia(db(), id);
}

/** Oś rozmowy: wiadomości kanału przeplecione wynikami zadań z hali. */
export function osRozmowy(id: number): {
  rozmowa: RozmowaSkrzynki; os: WpisOsi[]; szkic: Szkic | null;
  ofertaWskazana: OfertaWskazana | null;
  zamowienie: ZamowienieRozmowy | null; oferta: OfertaRozmowy | null;
  /**
   * Zakupy tego kupującego — kandydaci do powiązania (0.397.0).
   *
   * Lista jedzie ZAWSZE, także gdy zamówienie już jest: klient bywa u nas
   * z kilkoma paczkami i pytanie „nie o tę chodzi" pada częściej niż raz.
   * Ekran pokazuje ją mocno, dopóki nic nie jest powiązane, a potem chowa
   * pod przyciskiem — patrz `skrzynka/ZamowienieRozmowy.tsx`.
   */
  kandydaciZamowien: KandydatZamowienia[];
  /**
   * Zwroty TEGO zamówienia (0.221.0). Właściciel: „klienci często pytają
   * pod zamówieniem o zwrot, którego dokonali" — agent szedł po stan zwrotu
   * do ekranu Zwroty i szukał go ręcznie. Mostkiem jest numer zamówienia,
   * ten sam, którym zwrot znajduje swoje rozmowy od 0.169.0; po loginie
   * dobierać nie wolno (blizna 0.56.6). Bez zamówienia lista jest pusta.
   */
  zwroty: WierszZwrotu[];
  /**
   * Reklamacje i dyskusje TEGO zamówienia (S1 spoiwa,
   * `docs/obsluga-klienta-calosc.md`). Ten sam mostek co przy zwrotach i ten
   * sam powód, tylko mocniejszy: agent pisał odpowiedź, nie wiedząc, że
   * klient ma u nas otwartą reklamację o ten sam towar. Odpowiedź udająca
   * pierwszy kontakt w sprawie z zegarem ustawowym kosztuje zaufanie.
   */
  sprawy: SprawaZakupu[];
  /**
   * Droga tego zakupu przez kolejki (S3 spoiwa) — pytanie, dyskusja,
   * reklamacja, zwrot w kolejności czasu. ODCZYT, nie zapis: przeskok wylicza
   * się z momentów, które i tak leżą w bazie.
   */
  droga: PrzystanekDrogi[];
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
     WHERE m.conversation_id=? ORDER BY m.sent_at, m.id
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

         `mimeType` jest w schemacie Allegro OPCJONALNE i bywa kłamliwe:
         telefony przysyłają `image/jpg`, `application/octet-stream` albo pusty
         ciąg przy `IMG_….jpg`. O UKŁADZIE decyduje więc typ ALBO nazwa pliku
         (jak w reklamacjach od 0.223.0), a o WYDANIU — sygnatura bajtów na
         trasie podglądu; plik nazwany `usterka.jpg` bez sygnatury obrazu
         dostaje 415, panel to zapamiętuje i zostaje przy nazwie z pobraniem.
         0.244.0 patrzyło na nazwę tylko przy PUSTYM polu, więc `image/jpg`
         zostawiało zdjęcie samą nazwą i trasa z bajtami nie była pytana. */
      podglad: String(z.status) === "SAFE" && z.url != null
        && (typPodgladu(z.mime_type as string | null) !== null
          || czyObrazZNazwy(String(z.file_name))),
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
  /* ── WSKAZANIE RĘCZNE JAKO ZAPASOWA DROGA (0.397.0) ─────────────────────────
     Zgłoszenie właściciela: klient napisał pod OFERTĄ o braku w paczce, a
     rozmowa nie miała zamówienia wcale. Ładunek wątku niesie JEDEN obiekt
     powiązany — pytanie spod oferty numeru zakupu nie ma i mieć nie będzie.

     WIADOMOŚĆ BIJE WSKAZANIE, nie odwrotnie: numer z Allegro jest faktem,
     a wskazanie wnioskiem człowieka. Gdy klient dopisze wiadomość niosącą
     numer, ekran ma pokazać właśnie ten, choćby ktoś wcześniej wskazał inny.
     Reguła ma jeden zapis w `numerZamowieniaRozmowy`, bo czyta ją też szkic
     Copilota, pytając o przesyłkę tego samego zamówienia. */
  const numer = numerZamowieniaRozmowy(id);
  const numerZamowienia = numer?.externalId ?? null;
  const kontoZamowienia = numer?.konto ?? 0;
  const zamowienie: ZamowienieRozmowy | null = numerZamowienia ? {
    externalId: numerZamowienia,
    link: linkZamowienia(numerZamowienia),
    pobrane: zamowienieRozmowy(kontoZamowienia, numerZamowienia),
    przesylka: przesylkaRozmowy(kontoZamowienia, numerZamowienia),
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
  /* Dobór czytany RAZ, przed ofertą: maszyna z jego danych podświetla listę
     zgodności, a ten sam wiersz jedzie niżej do zakładki doboru. */
  const dobor = doborRozmowy(id);
  const zOferty = (konto: number, ofertaId: string, zrodlo: OfertaRozmowy["zrodlo"]): OfertaRozmowy => {
    const pobrana = snapshotOferty(konto, ofertaId);
    const skuZapas = skuZPozycji(ofertaId);
    return {
      externalId: ofertaId,
      link: linkOferty(ofertaId),
      zrodlo,
      zgodnosc: zgodnoscOferty(db(), konto, ofertaId, dobor.dane),
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

  /* ODESŁANIE Z HALI (0.352.0) — ten sam kształt co wynik, bo dla osi to ten
     sam moment: hala odpowiedziała. Różnica jest w treści odpowiedzi, więc
     w rodzaju wpisu, a nie w tym, czy wpis w ogóle jest. Przed tą wersją hala
     nie miała jak odpowiedzieć „nie da się", więc oś kończyła się zleceniem
     i rozmowa czekała na pomiar, którego nikt nie robił. */
  /* Czytamy z KSIĘGI ZDARZEŃ, nie ze stanu zadania. Pierwsza wersja tej
     zmiany brała wiersze `WHERE status='odeslane'` — i wtedy ponowienie
     zadania przez biuro kasowało odesłanie z osi rozmowy, bo status wracał na
     `nowe`. Oś jest historią: „hala odesłała, biuro ponowiło" to dwa fakty,
     a nie jeden stan. Ta sama droga co przy zmianach statusu i sprawach. */
  const odeslane = db().prepare(`
    SELECT e.id, e.payload, e.created_at, z.odeslano_przez
      FROM conversation_event e
      LEFT JOIN zadanie_terenowe z
        ON z.id = CAST(json_extract(e.payload,'$.taskId') AS INTEGER)
     WHERE e.conversation_id=? AND e.event_type='field_task_returned' ORDER BY e.id
  `).all(id) as Array<Record<string, unknown>>;
  for (const w of odeslane) {
    const p = JSON.parse(String(w.payload ?? "{}")) as
      { taskId?: number; reasonCode?: string; reason?: string | null };
    const z = {
      id: p.taskId ?? 0, powod_kod: p.reasonCode ?? "", powod: p.reason ?? null,
      odeslano_at: w.created_at, odeslano_przez: w.odeslano_przez,
    };
    const kod = String(z.powod_kod ?? "");
    /* Zdanie po polsku składa SERWER, bo oś czyta je także eksport do PDF-u
       i podpowiedź w kolejce — a te nie mają słownika panelu pod ręką.
       Sam kod jedzie osobnym polem dla tych, którzy chcą go rozstrzygnąć. */
    const nazwa = kod === "brak_towaru" ? "brak towaru" : "nie da się wykonać";
    os.push({
      id: `odeslanie-${w.id}`, rodzaj: "odeslanie_zadania",
      autor: String(z.odeslano_przez ?? "magazyn"), odKlienta: false,
      tresc: z.powod ? `${nazwa}: ${String(z.powod)}` : nazwa,
      at: String(z.odeslano_at), ofertaId: null, zadanieId: Number(z.id),
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
      /* KLUCZ, NIE ZDANIE (0.243.0). `tresc` zostaje dla podpowiedzi, ale pasek
         zdarzeń potrzebuje krótkiej etykiety PO POLSKU, a słownik polszczyzny
         stoi w panelu (`skrzynka/statusy.ts`) — tak jak wszędzie indziej:
         angielskie klucze w bazie i w API, polszczyzna na ekranie. Panel nie
         ma parsować `tresc`, bo to jest zdanie dla człowieka, nie format. */
      zdarzenie: { rodzaj: "status", po: p.po ?? null },
    });
  }

  /* ZNACZNIK REKLAMACYJNY NA OSI (0.390.0). Nadanie i zdjęcie są tak samo
     ważne: „czemu ta rozmowa wypadła z sita reklamacyjnego" ma mieć
     odpowiedź, a `events` nie ma retencji. */
  for (const z of db().prepare(`
    SELECT id, payload, created_at FROM conversation_event
     WHERE conversation_id=? AND event_type='reklamacyjna_changed' ORDER BY id
  `).all(id) as Array<Record<string, unknown>>) {
    const p = JSON.parse(String(z.payload ?? "{}")) as { na?: number; autor?: string };
    const nadano = Number(p.na ?? 0) === 1;
    os.push({
      id: `reklamacyjna-${z.id}`, rodzaj: "status", autor: String(p.autor ?? "system"),
      odKlienta: false,
      tresc: nadano ? "oznaczono jako sprawę reklamacyjną" : "zdjęto znacznik reklamacyjny",
      at: String(z.created_at), ofertaId: null,
      zdarzenie: { rodzaj: "status", po: nadano ? "reklamacyjna" : "nie_reklamacyjna" },
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
      zdarzenie: typ === "dobor_status_changed"
        ? { rodzaj: "dobor", po: p.po ?? null }
        : { rodzaj: "dobor_wybor", wybrano: typ === "dobor_wybrano", symbol: p.symbol ?? null },
    });
  }

  /* ZWROT NA OSI (@wydanie) — decyzja, korekta i pieniądze zwrotu tego
     zamówienia jako zdarzenia, jak status i dobór. Powód i zakres
     w `services/zwrot-na-osi.ts`. */
  for (const z of zdarzeniaZwrotowRozmowy(db(), id)) {
    os.push({
      id: `zwrot-${z.id}`, rodzaj: "zwrot", autor: z.kto ?? "system", odKlienta: false,
      tresc: `zwrot${z.numer ? ` ${z.numer}` : ""}: ${z.tresc ?? z.rodzaj}`,
      at: z.kiedy, ofertaId: null,
      zdarzenie: { rodzaj: "zwrot", co: z.rodzaj, zwrotId: z.zwrotId, numer: z.numer },
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
    zamowienie, oferta, kandydaciZamowien: kandydaciZamowien(id),
    zwroty: zamowienie
      ? listaZwrotow(db(), Date.now(), { channelAccountId: kontoRozmowy, orderId: zamowienie.externalId })
      : [],
    sprawy: sprawyZakupu(db(), kontoRozmowy, zamowienie?.externalId ?? null),
    droga: drogaZakupu(db(), kontoRozmowy, zamowienie?.externalId ?? null),
    /* Dobór jedzie z rozmową, bo jest lekki (jeden wiersz); KANDYDACI nie —
       to wyszukiwarka i parser opisu, a ten odczyt odświeża się na każde
       zdarzenie szyny. */
    dobor,
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

  /* ── HALA DOSTAJE ZDANIE, NIE DOSSIER (0.408.0) ─────────────────────────
     Zgłoszenie właściciela: „zadania zlecane dla magazynu mają za dużo
     informacji; powinno być tylko, jakiego produktu dotyczy zadanie — lub bez
     produktu — i co ma zrobić".

     Do 0.407.0 `instrukcja` szła na kolektor jako CZTERY sklejone linie: całe
     pytanie kupującego, numer oferty Allegro, zdanie o tym, kto wskazał
     kartotekę, i dopiero pod nimi wskazówka biura. Magazynier w rękawicy
     czytał więc reklamację klienta, żeby znaleźć jedno zdanie mówiące, co ma
     zmierzyć. Dekalog ergonomii, punkt 2: pierwszeństwo ma to, co rozstrzyga
     bieżącą czynność.

     WSKAZÓWKA JEST ODTĄD OBOWIĄZKOWA. Była opcjonalna dokładnie dlatego, że
     kontekst służył za treść zastępczą — a zadanie bez zdania „co zrobić" to
     zadanie, którego nie da się wykonać. Tłumaczenie pytania klienta na
     polecenie dla hali jest pracą agenta, nie magazyniera.                 */
  if (!dodatkowa) {
    throw new Error("Napisz, co ma zrobić hala — bez tego zadanie jest nie do wykonania");
  }

  /* Kartoteka WSKAZANA przez agenta to co innego niż WYWIEDZIONA z oferty.
     Pierwsza jest jego wyborem i tak ma być podpisana; druga będzie faktem
     z Allegro, gdy dojdzie pobieranie ofert. Biuro i audyt muszą widzieć
     różnicę — projekt panelu §4.3 zabrania mieszać fakty z różnych źródeł
     bez pokazania pochodzenia. Dziś synchronizator ofert nie pobiera, więc
     bez wskazania agenta `tw_id` zostaje puste; zgadywanie byłoby gorsze
     niż uczciwy brak.

     Te trzy zdania zostają w `kontekst`, czyli przy karcie zadania W BIURZE.
     Nie kasujemy ich: karta zadania nie ma odnośnika do rozmowy, więc byłby
     to jedyny ślad po tym, skąd zlecenie się wzięło. */
  const kontekst = [
    `Pytanie klienta: ${String(m.body)}`,
    oferta ? `Oferta Allegro: ${oferta}` : "Brak powiązania z ofertą Allegro.",
    twId != null ? `Kartotekę wskazał(a) ${autor.name}, nie wynika z oferty.` : "",
  ].filter(Boolean).join("\n");

  const zadanie = utworzZadanie({
    rodzaj: "pomiar",
    /* Tytuł jest etykietą DLA BIURA — po nim odnajduje się zadanie na liście
       wśród kilkunastu innych. Kolektor go nie pokazuje: na halę idzie towar
       i polecenie, a „Pomiar z rozmowy — Client:128497280" nie jest ani
       jednym, ani drugim. */
    tytul: `Pomiar z rozmowy — ${String(m.klient ?? "klient")}`,
    instrukcja: dodatkowa, kontekst,
    twId, zrodlo: SKRZYNKA, zrodloRef: String(rozmowaId),
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
