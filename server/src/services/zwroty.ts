import { config } from "../config.js";
import { db as defaultDb, type Db, transaction } from "../db/db.js";
import { zaproponujKartoteke, type Dopasowanie } from "./dopasowanie-sku.js";
import { stanRabatu, type StanRabatu } from "./rabaty.js";
import { linkZwrotu } from "./allegro-linki.js";
import { naZamowienie, type Zamowienie } from "./zamowienia.js";
import { logEvent } from "./events.js";
import { wierszCsv, zbudujCsv } from "./csv.js";

/* ── Kubełki zwrotów (0.150.0) ───────────────────────────────────────────────
   Panel zwrotów jest KOLEJKĄ BRAMEK, nie rejestrem. Rejestr każe najpierw
   znaleźć zwrot, potem wybrać akcję z menu — dwa kliknięcia przed
   jakąkolwiek decyzją. Kubełek niesie dokładnie jedno pytanie, więc operator
   nie wybiera, co zrobić, tylko odpowiada.

   KUBEŁKA NIE MA W KOLUMNIE. Wynika z faktów: werdyktu, ocen pozycji, kwoty
   i numeru korekty. Zdenormalizowany rozjechałby się z nimi przy pierwszym
   zapisie, który go zapomni — a wtedy ekran pokazywałby pracę, której nie
   ma, albo chował tę, która jest.

   Kolejność w kubełku bierze się z ZEGARA USTAWOWEGO, nie z daty wpływu.
   To blizna 0.121.0: ustawowy termin jest osobnym bytem i steruje
   kolejnością pracy. Zwrot z dwoma dniami zapasu stoi nad wczorajszym.    */

export type Kubelek = "decyzja" | "ocena" | "zwrot" | "korekta" | "zamkniety" | "odrzucony";

export type Sygnal = "termin" | "brak_dowodu" | "odrzucony_w_allegro";

export interface PozycjaZwrotu {
  id: number;
  offerId: string | null;
  nazwa: string;
  ilosc: number;
  cenaGrosze: number;
  waluta: string;
  powod: string | null;
  powodKomentarz: string | null;
  ocena: string | null;
  /** Odnośnik do oferty — jedyny link udokumentowany w specyfikacji. */
  url: string | null;
  /** Kartoteka POTWIERDZONA przez człowieka; bez niej nie ma zdjęcia. */
  twId: number | null;
  twSymbol: string | null;
  twZrodlo: string | null;
  /** SKU sprzedawcy z pozycji ZAMÓWIENIA — zwrot własnego SKU nie niesie. */
  sku: string | null;
  /** EAN z kartoteki Subiekta. Allegro EAN-u nie podaje przy zwrocie wcale. */
  ean: string | null;
  /** Ile MNIEJ oddajemy za tę pozycję i DLACZEGO (0.170.0). */
  potracenieGrosze: number | null;
  potraceniePowod: string | null;
  /** Propozycja automatu — pokazywana obok, nigdy zamiast potwierdzonej. */
  propozycja: Dopasowanie | null;
  /** Rabat transakcyjny: czy wniosek o zwrot prowizji już jest (0.164.0). */
  rabat: StanRabatu;
}

/* `Zamowienie` i `PozycjaZamowienia` mieszkają od 0.166.0 w `zamowienia.ts`,
   bo to samo zamówienie pokazuje też rozmowa. Re-eksport trzyma stare importy. */
export type { PozycjaZamowienia, Zamowienie } from "./zamowienia.js";

export interface WierszZwrotu {
  id: number;
  externalId: string;
  numer: string | null;
  orderId: string | null;
  utworzono: string;
  paczkaAt: string | null;
  kubelek: Kubelek;
  sygnaly: Sygnal[];
  terminAt: string;
  dniDoTerminu: number;
  sumaPozycjiGrosze: number;
  /**
   * Kwota PEŁNA: pozycje plus koszt dostawy. `null`, dopóki zamówienia nie
   * pobrano — do 0.151.0 ekran nie umiał jej policzyć wcale i mówił o tym
   * wprost, bo koszt dostawy stoi przy zamówieniu, nie przy zwrocie.
   */
  kwotaPelnaGrosze: number | null;
  waluta: string;
  /** Odnośniki do panelu Allegro; `null` = nie ma czego linkować. */
  linkZwrotu: string | null;
  zamowienie: Zamowienie | null;
  werdykt: string | null;
  kwotaGrosze: number | null;
  kwotaWariant: string | null;
  korektaNumer: string | null;
  rejectionCode: string | null;
  /** Login kupującego prosto ze zwrotu — nie wymaga pobranego zamówienia. */
  kupujacyLogin: string | null;
  /** `INPOST`, `DPD`, `UNKNOWN`… — surowo, bo Allegro nie zamyka listy. */
  przewoznik: string | null;
  /** Rozmowy o TYM zakupie; puste znaczy „Allegro nic nie powiązało". */
  rozmowy: RozmowaZwrotu[];
  wersja: number;
  pozycje: PozycjaZwrotu[];
}

/**
 * Rozmowa z klientem o tym samym zakupie (0.169.0).
 *
 * Mostkiem jest `message.related_order_id`, mapowany od 0.166.0 z gałęzi
 * `relatesTo.order`. Nie ma tu ani jednego nowego żądania do Allegro: numer
 * zamówienia zwrot ma od zawsze, a wiadomości leżą już w naszej bazie.
 *
 * Po loginie kupującego dobierać NIE WOLNO — blizna 0.56.6: Allegro maskuje
 * rozmówcę jako `client:44300444`, więc rozmowy szuka się po identyfikatorze,
 * nigdy po loginie. `conversation` identyfikatora zresztą nie trzyma.
 */
export interface RozmowaZwrotu {
  id: number;
  temat: string | null;
  status: string;
  ostatniaAt: string | null;
}

/** Ile dni przed terminem wiersz zapala się na czerwono. */
const PROG_TERMINU_DNI = 3;

type Wiersz = Record<string, unknown>;

/**
 * Termin ustawowy zwrotu pieniędzy.
 *
 * `[WERYFIKUJ]` Liczymy go od `createdAt` zwrotu, bo to najbliższy moment,
 * jaki Allegro nam podaje. Ustawa liczy czternaście dni od OTRZYMANIA
 * oświadczenia o odstąpieniu, a te dwa momenty nie muszą być tym samym.
 * Błąd idzie w stronę bezpieczną — nasz termin wypada nie później niż
 * ustawowy — ale zanim ktoś oprze na tym spór, trzeba to sprawdzić.
 */
export function terminZwrotu(utworzono: string, dni = config.allegro.zwrotTerminDni): string {
  return new Date(Date.parse(utworzono) + dni * 86_400_000).toISOString();
}

/** Pełne dni do terminu; ujemne znaczy „po terminie". */
export function dniDoTerminu(terminAt: string, teraz = Date.now()): number {
  return Math.floor((Date.parse(terminAt) - teraz) / 86_400_000);
}

/**
 * Kubełek wyliczony z faktów.
 *
 * Kolejność warunków jest UMOWĄ: stany końcowe rozstrzygają pierwsze, bo
 * zwrot zamknięty nie ma prawa wrócić do kolejki pracy tylko dlatego, że
 * któraś pozycja została bez oceny.
 */
export function kubelekZwrotu(z: {
  rejectionCode: string | null; werdykt: string | null; zamknietyAt: string | null;
  kwotaGrosze: number | null; korektaNumer: string | null;
  pozycje: Array<{ ocena: string | null }>;
}): Kubelek {
  if (z.zamknietyAt) return "zamkniety";
  if (z.werdykt === "odrzucony" || z.rejectionCode) return "odrzucony";
  if (z.werdykt !== "przyjety") return "decyzja";
  /* Pusta lista pozycji NIE jest „ocenione wszystko": zwrot bez pozycji nie
     ma czego wycenić, więc zostaje przy ocenie, gdzie człowiek to zobaczy. */
  if (!z.pozycje.length || z.pozycje.some((p) => !p.ocena)) return "ocena";
  if (z.kwotaGrosze === null) return "zwrot";
  if (!z.korektaNumer) return "korekta";
  return "zamkniety";
}

/**
 * Sygnały — jedyne trzy rzeczy, które każą przeczytać wiersz.
 *
 * Wszystko inne wiersz mówi bez czytania. Czwartego sygnału z projektu,
 * „rozjazd" (klient zgłosił inną liczbę sztuk, niż wróciła), tu jeszcze
 * nie ma: liczbę zwróconą zna dopiero ocena hali, która wchodzi w 0.151.0.
 * Reguła bez danych zapalałaby się na ślepo albo nigdy — obie wersje uczą
 * operatora ignorować kolor.
 */
export function sygnalyZwrotu(z: {
  kubelek: Kubelek; dni: number; paczkaAt: string | null; rejectionCode: string | null;
}): Sygnal[] {
  const s: Sygnal[] = [];
  /* Stany końcowe nie mają terminu do pilnowania — czerwień na nich uczyłaby
     przewijać czerwone wiersze. */
  const wPracy = z.kubelek !== "zamkniety" && z.kubelek !== "odrzucony";
  if (wPracy && z.dni <= PROG_TERMINU_DNI) s.push("termin");
  if (wPracy && !z.paczkaAt) s.push("brak_dowodu");
  /* Odrzucone w panelu Allegro, nie u nas. Bez tego biuro drugi raz
     rozstrzygałoby sprawę, którą ktoś już zamknął gdzie indziej. */
  if (z.rejectionCode) s.push("odrzucony_w_allegro");
  return s;
}

/**
 * Propozycja kwoty: suma pozycji.
 *
 * To NIE jest jeszcze „kwota pełna". Koszt dostawy nie przyjeżdża ze
 * zwrotem — Allegro trzyma go przy zamówieniu (`/order/checkout-forms`)
 * i przy inicjowaniu zwrotu płatności (`delivery.value`). Do czasu, aż
 * panel zacznie dociągać zamówienie, wariant „bez wysyłki" byłby
 * nieodróżnialny od pełnego, czyli byłby kłamstwem na przycisku.
 */
export function sumaPozycji(pozycje: Array<{ cenaGrosze: number; ilosc: number }>): number {
  return pozycje.reduce((s, p) => s + Math.round(p.cenaGrosze * p.ilosc), 0);
}

function zloz(
  z: Wiersz, pozycje: PozycjaZwrotu[], zamowienie: Zamowienie | null, teraz: number,
  rozmowy: RozmowaZwrotu[] = [],
): WierszZwrotu {
  const utworzono = String(z.created_at);
  const terminAt = terminZwrotu(utworzono);
  const dni = dniDoTerminu(terminAt, teraz);
  const rejectionCode = (z.rejection_code as string) ?? null;
  const kubelek = kubelekZwrotu({
    rejectionCode,
    werdykt: (z.werdykt as string) ?? null,
    zamknietyAt: (z.zamkniety_at as string) ?? null,
    kwotaGrosze: z.kwota_grosze == null ? null : Number(z.kwota_grosze),
    korektaNumer: (z.korekta_numer as string) ?? null,
    pozycje,
  });
  const suma = sumaPozycji(pozycje);
  return {
    id: Number(z.id),
    externalId: String(z.external_id),
    numer: (z.reference_number as string) ?? null,
    orderId: (z.order_id as string) ?? null,
    utworzono,
    paczkaAt: (z.paczka_at as string) ?? null,
    kubelek,
    sygnaly: sygnalyZwrotu({ kubelek, dni, paczkaAt: (z.paczka_at as string) ?? null, rejectionCode }),
    terminAt,
    dniDoTerminu: dni,
    sumaPozycjiGrosze: suma,
    /* Kwota pełna = pozycje + dostawa. Bez zamówienia zostaje `null`, a nie
       suma pozycji udająca całość — do 0.151.0 ekran musiał o tym pisać
       zdanie, bo koszt dostawy stoi przy zamówieniu, nie przy zwrocie. */
    kwotaPelnaGrosze: zamowienie ? suma + (zamowienie.dostawaGrosze ?? 0) : null,
    waluta: pozycje[0]?.waluta ?? zamowienie?.waluta ?? "PLN",
    linkZwrotu: linkZwrotu((z.reference_number as string) ?? (z.external_id as string)),
    zamowienie,
    werdykt: (z.werdykt as string) ?? null,
    kwotaGrosze: z.kwota_grosze == null ? null : Number(z.kwota_grosze),
    kwotaWariant: (z.kwota_wariant as string) ?? null,
    korektaNumer: (z.korekta_numer as string) ?? null,
    rejectionCode,
    kupujacyLogin: (z.kupujacy_login as string) ?? null,
    przewoznik: (z.przewoznik as string) ?? null,
    rozmowy,
    wersja: Number(z.wersja ?? 1),
    pozycje,
  };
}

/**
 * Kolejka jako CSV dla biura.
 *
 * Separator `;`, bo Excel PL otwiera taki plik bez kreatora importu — ta sama
 * reguła co przy analizie i rekoncyliacji (`services/csv.ts`). Jeden wiersz
 * na POZYCJĘ, nie na zwrot: pracownik liczy w Excelu towary, a zwrot
 * wielopozycyjny w jednym wierszu kazałby mu je rozklejać ręcznie.
 *
 * Numeru listu przewozowego tu NIE MA — polityka danych zwrotów z 0.163.0
 * mówi, że nie zapisujemy go w modelu pracy, a plik wynoszony na dysk jest
 * zapisem trwalszym niż baza.
 */
export function csvZwrotow(zwroty: WierszZwrotu[]): string {
  const naglowek = [
    "Numer zwrotu", "Identyfikator", "Zamowienie", "Kupujacy", "Zgloszony",
    "Termin", "Dni do terminu", "Kubelek", "Przewoznik", "Platnosc", "Faktura",
    "Towar", "Symbol", "EAN", "SKU", "Sztuk", "Cena", "Waluta", "Powod",
    "Ocena", "Potracenie", "Powod potracenia", "Werdykt", "Kwota oddana", "Numer korekty",
  ].join(";");

  const wiersze = zwroty.flatMap((z) => {
    const wspolne = [
      z.numer ?? "", z.externalId, z.orderId ?? "", z.kupujacyLogin ?? "",
      z.utworzono, z.terminAt, z.dniDoTerminu, z.kubelek, z.przewoznik ?? "",
      z.zamowienie?.platnoscTyp ?? "",
      z.zamowienie?.fakturaZadana == null ? "" : (z.zamowienie.fakturaZadana ? "faktura" : "paragon"),
    ];
    const ogon = [
      z.werdykt ?? "",
      z.kwotaGrosze == null ? "" : (z.kwotaGrosze / 100).toFixed(2).replace(".", ","),
      z.korektaNumer ?? "",
    ];
    /* Zwrot bez pozycji też dostaje wiersz — inaczej zniknąłby z zestawienia
       i nikt by się nie dowiedział, że w ogóle jest. */
    if (!z.pozycje.length) {
      return [wierszCsv([...wspolne, "", "", "", "", "", "", "", "", "", "", "", ...ogon], ";")];
    }
    return z.pozycje.map((p) => wierszCsv([
      ...wspolne, p.nazwa, p.twSymbol ?? "", p.ean ?? "", p.sku ?? "", p.ilosc,
      (p.cenaGrosze / 100).toFixed(2).replace(".", ","), p.waluta,
      p.powod ?? "", p.ocena ?? "",
      p.potracenieGrosze == null ? "" : (p.potracenieGrosze / 100).toFixed(2).replace(".", ","),
      p.potraceniePowod ?? "", ...ogon,
    ], ";"));
  });

  return zbudujCsv([naglowek, ...wiersze]);
}

/**
 * Cała kolejka, jednym zapytaniem plus jednym na pozycje.
 *
 * Zwrotów w pracy są dziesiątki, nie tysiące, więc stronicowanie po stronie
 * serwera kupiłoby złożoność bez zysku. Panel filtruje kubełkiem u siebie
 * i dzięki temu przełączenie kubełka jest natychmiastowe — a to jest
 * dokładnie ten koszt, który miał zniknąć.
 */
export function listaZwrotow(database: Db = defaultDb(), teraz = Date.now()): WierszZwrotu[] {
  const zwroty = database.prepare(
    "SELECT * FROM zwrot_klienta ORDER BY created_at ASC"
  ).all() as Wiersz[];
  const pozycje = database.prepare(
    "SELECT * FROM zwrot_klienta_pozycja ORDER BY id ASC"
  ).all() as Wiersz[];
  const zamowienia = database.prepare(
    "SELECT * FROM zamowienie_klienta"
  ).all() as Wiersz[];
  const pozZam = database.prepare(
    "SELECT * FROM zamowienie_klienta_pozycja ORDER BY id ASC"
  ).all() as Wiersz[];

  const zamWgKlucza = new Map<string, Wiersz>();
  for (const k of zamowienia) zamWgKlucza.set(`${k.channel_account_id}|${k.external_id}`, k);
  const pozWgZam = new Map<number, Wiersz[]>();
  for (const p of pozZam) {
    const l = pozWgZam.get(Number(p.zamowienie_id)) ?? [];
    l.push(p);
    pozWgZam.set(Number(p.zamowienie_id), l);
  }

  const wgZwrotu = new Map<number, Wiersz[]>();
  for (const p of pozycje) {
    const lista = wgZwrotu.get(Number(p.zwrot_id)) ?? [];
    lista.push(p);
    wgZwrotu.set(Number(p.zwrot_id), lista);
  }

  /* EAN bierze się z KARTOTEKI, bo Allegro go przy zwrocie nie podaje w ogóle
     (jest tylko przy One Fulfillment, którego ta firma nie używa). Jedno
     zapytanie na całą kolejkę, nie jedno na pozycję. */
  const eanWgTw = new Map<number, string>();
  for (const t of database.prepare(
    "SELECT tw_id, ean FROM sgt_towar WHERE ean IS NOT NULL AND ean <> ''",
  ).all() as Wiersz[]) {
    eanWgTw.set(Number(t.tw_id), String(t.ean));
  }

  /* Rozmowy o tym zakupie. Grupujemy po numerze zamówienia, bo jeden zakup
     potrafi mieć kilka wątków — dlatego lista, a nie kolumna `conversation_id`
     przy zwrocie, która mieści jedną. */
  const rozmowyWgZam = new Map<string, RozmowaZwrotu[]>();
  for (const r of database.prepare(`
    SELECT m.related_order_id AS zam, c.id, c.subject, c.status,
           MAX(m.sent_at) AS ostatnia
      FROM message m JOIN conversation c ON c.id = m.conversation_id
     WHERE m.related_order_id IS NOT NULL
     GROUP BY m.related_order_id, c.id
     ORDER BY ostatnia DESC`).all() as Wiersz[]) {
    const klucz = String(r.zam);
    const lista = rozmowyWgZam.get(klucz) ?? [];
    lista.push({
      id: Number(r.id),
      temat: (r.subject as string) ?? null,
      status: String(r.status),
      ostatniaAt: (r.ostatnia as string) ?? null,
    });
    rozmowyWgZam.set(klucz, lista);
  }

  return zwroty
    .map((z) => {
      const surowe = wgZwrotu.get(Number(z.id)) ?? [];
      const zam = zamWgKlucza.get(`${z.channel_account_id}|${z.order_id}`) ?? null;
      const pozZamowienia = zam ? pozWgZam.get(Number(zam.id)) ?? [] : [];
      const wracajace = new Set(
        surowe.map((p) => (p.offer_id as string) ?? "").filter((v) => v !== ""));

      /* SKU sprzedawcy niesie POZYCJA ZAMÓWIENIA — pozycja zwrotu ma w
         specyfikacji samo `offerId`, bez zagnieżdżonej oferty. Dopasowanie
         po obu kolumnach z tego samego powodu co niżej przy plakietce WRACA. */
      const skuWgOferty = new Map<string, string>();
      for (const pz of pozZamowienia) {
        const sku = (pz.sku as string) ?? "";
        if (!sku) continue;
        for (const k of [pz.offer_id, pz.external_id]) {
          if (k) skuWgOferty.set(String(k), sku);
        }
      }

      const zlozone: PozycjaZwrotu[] = surowe.map((p) => {
        const twId = p.tw_id == null ? null : Number(p.tw_id);
        return {
          id: Number(p.id),
          offerId: (p.offer_id as string) ?? null,
          nazwa: String(p.nazwa),
          ilosc: Number(p.ilosc),
          cenaGrosze: Number(p.cena_grosze),
          waluta: String(p.waluta),
          powod: (p.powod as string) ?? null,
          powodKomentarz: (p.powod_komentarz as string) ?? null,
          ocena: (p.ocena as string) ?? null,
          url: (p.url as string) ?? null,
          twId,
          twSymbol: (p.tw_symbol as string) ?? null,
          twZrodlo: (p.tw_zrodlo as string) ?? null,
          sku: skuWgOferty.get(String(p.offer_id ?? "")) ?? null,
          ean: twId === null ? null : eanWgTw.get(twId) ?? null,
          potracenieGrosze: p.potracenie_grosze == null ? null : Number(p.potracenie_grosze),
          potraceniePowod: (p.potracenie_powod as string) ?? null,
          /* Propozycję liczymy TYLKO tam, gdzie kartoteki jeszcze nie ma.
             Podpowiadanie obok potwierdzonego wyboru byłoby podważaniem
             decyzji człowieka, a §4.3 stawia ją wyżej niż wynik automatu. */
          propozycja: twId === null ? zaproponujKartoteke(database, {
            channelAccountId: Number(z.channel_account_id),
            orderId: (z.order_id as string) ?? null,
            offerId: (p.offer_id as string) ?? null,
            nazwa: String(p.nazwa),
          }) : null,
          /* Rabat liczy się dla KAŻDEJ pozycji, także rozstrzygniętej: wniosek
             o prowizję żyje własnym rytmem po stronie Allegro i bywa złożony
             długo po tym, jak zwrot zszedł z biurka. */
          rabat: stanRabatu(database, Number(p.id)),
        };
      });

      /* Które pozycje wracają — to jest cały powód, dla którego panel
         pokazuje CAŁE zamówienie, a nie same zwracane sztuki.

         Sprawdzamy OBIE kolumny z tego samego powodu co złączenie
         w `dopasowanie-sku.ts`: nie wiadomo, czy `offerId` ze zwrotu to
         numer oferty, czy identyfikator pozycji zamówienia. Do 0.153.1
         porównanie szło po jednej i przy rozjeździe ŻADNA pozycja nie
         dostawała plakietki WRACA — co samo w sobie było objawem. */
      const zamowienie = zam ? naZamowienie(zam, pozZamowienia, (p) =>
        wracajace.has((p.offer_id as string) ?? "")
          || wracajace.has((p.external_id as string) ?? "")) : null;

      return zloz(z, zlozone, zamowienie, teraz,
        rozmowyWgZam.get(String(z.order_id ?? "")) ?? []);
    })
    /* Najkrótszy termin na górze — to jest cała reguła kolejności i jedyna,
       jakiej ten ekran potrzebuje. */
    .sort((a, b) => a.dniDoTerminu - b.dniDoTerminu);
}

/**
 * Ile pozycji czeka na kartotekę i z jakiego powodu.
 *
 * Bez tej liczby nie da się powiedzieć, czy problem jest w kodzie, czy
 * w danych po stronie Allegro — a przez trzy wydania nie dało się tego
 * rozstrzygnąć właśnie dlatego, że każde zerwane ogniwo wyglądało tak samo.
 */
export function bilansKartotek(zwroty: WierszZwrotu[]) {
  const powody: Record<string, number> = {};
  let bez = 0;
  let wszystkie = 0;
  for (const z of zwroty) {
    /* Stany końcowe nie są pracą do zrobienia i nie mają prawa zawyżać
       licznika, który ma mówić „ile jeszcze przede mną". */
    if (z.kubelek === "zamkniety" || z.kubelek === "odrzucony") continue;
    for (const p of z.pozycje) {
      wszystkie++;
      if (p.twId !== null) continue;
      bez++;
      const powod = p.propozycja?.powod ?? (p.propozycja?.twId != null ? "do_zatwierdzenia" : "inne");
      powody[powod] = (powody[powod] ?? 0) + 1;
    }
  }
  return { bez, wszystkie, powody };
}

/** Ile pracy stoi w każdym kubełku — liczby przy zakładkach kolejki. */
export function licznikiKubelkow(zwroty: WierszZwrotu[]): Record<Kubelek, number> {
  const puste: Record<Kubelek, number> = {
    decyzja: 0, ocena: 0, zwrot: 0, korekta: 0, zamkniety: 0, odrzucony: 0,
  };
  for (const z of zwroty) puste[z.kubelek]++;
  return puste;
}

/** Oś jednego zwrotu — wpisy wiszą przy źródle (blizna 0.130.0). */
export function osZwrotu(database: Db, zwrotId: number) {
  return database.prepare(
    "SELECT rodzaj, tresc, dane_json, kiedy_at, kto FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY kiedy_at ASC, id ASC"
  ).all(zwrotId);
}

/**
 * Potwierdzenie kartoteki dla pozycji zwrotu.
 *
 * PIERWSZY ZAPIS tego ekranu. Do 0.151.0 zwroty wyłącznie czytały, a licznik
 * tras zapisu w `routes/zwroty.test.ts` stał na zerze i był umową — tak jak
 * licznik `method:` w `biuro.test.ts` dla panelu magazynu.
 *
 * Zapisuje ŹRÓDŁO razem z wyborem. `sku` znaczy „agent zatwierdził propozycję
 * automatu", `reczne` — „wskazał sam". Projekt panelu §4.3 żąda, żeby wybór
 * człowieka nie udawał faktu z Allegro; tu obowiązuje to w obie strony, bo
 * bez źródła nie da się później odróżnić, komu wierzyć.
 *
 * `twId === null` ZDEJMUJE powiązanie — to jest droga wyjścia z błędnego
 * potwierdzenia, a nie brak funkcji.
 *
 * `zapamietaj: false` wiąże pozycję BEZ dopisania do `oferta_kartoteka`.
 * Używa tego automat sygnatur (0.169.0): pamięć niesie zdanie „wskazał to
 * człowiek" i jest w `zaproponujKartoteke` mocniejsza od automatu. Wpisanie
 * tam wyniku automatu podszywałoby go pod decyzję biura, a przy okazji
 * nadpisywało cudze imię w `wskazano_przez`.
 */
export function potwierdzKartoteke(
  database: Db,
  pozycjaId: number,
  twId: number | null,
  zrodlo: "sku" | "reczne",
  /* `id: null` = zrobił to automat, nie człowiek. `zwrot_zdarzenie.kto_user_id`
     ma klucz obcy do `app_user`, więc udawane zero wywróciłoby zapis na
     kluczu — a wpisanie tam cudzego konta byłoby kłamstwem w audycie. */
  kto: { id: number | null; name: string },
  teraz = new Date(),
  zapamietaj = true,
): { twId: number | null; twSymbol: string | null; twZrodlo: string | null } {
  const pozycja = database.prepare(
    `SELECT p.id, p.zwrot_id, p.offer_id, z.channel_account_id
     FROM zwrot_klienta_pozycja p
     JOIN zwrot_klienta z ON z.id = p.zwrot_id
     WHERE p.id=?`
  ).get(pozycjaId) as
    { id: number; zwrot_id: number; offer_id: string | null; channel_account_id: number } | undefined;
  if (!pozycja) throw new Error("Nie znaleziono pozycji zwrotu");

  if (twId === null) {
    database.prepare(`UPDATE zwrot_klienta_pozycja
      SET tw_id=NULL, tw_symbol=NULL, tw_zrodlo=NULL, tw_at=?, tw_przez=? WHERE id=?`)
      .run(teraz.toISOString(), kto.name, pozycjaId);
    /* Pamięć znika RAZEM z powiązaniem. Inaczej zdjęcie kartoteki nic by nie
       dało: następny odczyt zaproponowałby ją z powrotem, a operator
       zobaczyłby, że jego decyzja się nie przyjęła. */
    if (pozycja.offer_id) {
      database.prepare("DELETE FROM oferta_kartoteka WHERE channel_account_id=? AND offer_id=?")
        .run(pozycja.channel_account_id, pozycja.offer_id);
    }
    logEvent("zwrot_kartoteka_zdjeta", kto.name, null,
      { pozycjaId, zwrotId: pozycja.zwrot_id }, undefined, database);
    return { twId: null, twSymbol: null, twZrodlo: null };
  }

  /* Symbol bierzemy z KARTOTEKI, nie z żądania. Panel mógłby przysłać dowolny
     napis, a snapshot ma przeżyć skasowanie read-modelu przy imporcie —
     kłamliwy snapshot byłby gorszy od jego braku. */
  const towar = database.prepare("SELECT tw_id, symbol FROM sgt_towar WHERE tw_id=?")
    .get(twId) as { tw_id: number; symbol: string } | undefined;
  if (!towar) throw new Error("Nie znaleziono towaru");

  database.prepare(`UPDATE zwrot_klienta_pozycja
    SET tw_id=?, tw_symbol=?, tw_zrodlo=?, tw_at=?, tw_przez=? WHERE id=?`)
    .run(towar.tw_id, towar.symbol, zrodlo, teraz.toISOString(), kto.name, pozycjaId);

  /* Audyt idzie tą samą bazą co mutacja — inaczej zdarzenie mogłoby przeżyć
     wycofaną transakcję (wzorzec z `services/wysylka.ts`). */
  logEvent("zwrot_kartoteka", kto.name, towar.tw_id,
    { pozycjaId, zwrotId: pozycja.zwrot_id, symbol: towar.symbol, zrodlo },
    kto.id, database);

  /* PAMIĘĆ POWIĄZAŃ — wzorzec `ean_alias`. Człowiek wskazuje kartotekę RAZ;
     ten sam towar wraca za miesiąc na innym zwrocie i wiąże się sam. Bez tego
     praca powtarza się w nieskończoność, a to jest dokładnie ten koszt, który
     panel zwrotów miał zdejmować.

     Pamięć trzyma się OFERTY, nie pozycji: pozycja żyje jednym zwrotem. */
  if (pozycja.offer_id && zapamietaj) {
    database.prepare(`INSERT INTO oferta_kartoteka
      (channel_account_id,offer_id,tw_id,tw_symbol,sku,wskazano_at,wskazano_przez)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(channel_account_id, offer_id) DO UPDATE SET
        tw_id=excluded.tw_id, tw_symbol=excluded.tw_symbol, sku=excluded.sku,
        wskazano_at=excluded.wskazano_at, wskazano_przez=excluded.wskazano_przez`).run(
      pozycja.channel_account_id, pozycja.offer_id, towar.tw_id, towar.symbol,
      zrodlo === "sku" ? towar.symbol : null, teraz.toISOString(), kto.name);
  }

  database.prepare(`INSERT INTO zwrot_zdarzenie(zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id)
    VALUES (?,?,?,?,?,?,?)`).run(
    pozycja.zwrot_id, "kartoteka",
    `Wskazano kartotekę ${towar.symbol}`,
    JSON.stringify({ pozycjaId, twId: towar.tw_id, zrodlo }),
    teraz.toISOString(), kto.name, kto.id);

  return { twId: towar.tw_id, twSymbol: towar.symbol, twZrodlo: zrodlo };
}

/* ── Decyzje biura (0.156.0) ─────────────────────────────────────────────────
   Do tego wydania kolejka bramek była DEKORACJĄ: `kubelekZwrotu` routuje po
   `werdykt`, ocenie pozycji, `kwota_grosze` i `korekta_numer`, a żadnej z tych
   kolumn nic nie zapisywało. Każdy zwrot stał w DO DECYZJI na zawsze.

   Trzy zapisy domykają trzy pierwsze kubełki. Korekta i zamknięcie zostają
   poza wydaniem: tamto wychodzi do Subiekta i ma własny kontrakt.

   KONTROLA WSPÓŁBIEŻNOŚCI jak przy rozmowie. Kolumna `wersja` stoi w schemacie
   od 0.150.0 z komentarzem „dwóch agentów nie zamyka jednego zwrotu dwiema
   różnymi kwotami" — dopiero teraz ma czego pilnować.                       */

export class ZwrotConflict extends Error {
  constructor(message: string, public readonly szczegoly: Record<string, unknown>) {
    super(message);
  }
}

type StanZwrotu = { id: number; wersja: number; werdykt: string | null; zamkniety_at: string | null };

/** Wczytanie ze sprawdzeniem wersji. Zwraca stan sprzed zmiany. */
function podKlucz(database: Db, zwrotId: number, wersja: number): StanZwrotu {
  const z = database.prepare(
    "SELECT id, wersja, werdykt, zamkniety_at FROM zwrot_klienta WHERE id=?")
    .get(zwrotId) as StanZwrotu | undefined;
  if (!z) throw new Error("Nie znaleziono zwrotu");
  if (Number(z.wersja) !== wersja) {
    throw new ZwrotConflict(
      "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.",
      { wersja: Number(z.wersja), przyslana: wersja });
  }
  if (z.zamkniety_at) throw new Error("Zwrot jest zamknięty");
  return z;
}

const podnies = (database: Db, zwrotId: number) =>
  database.prepare("UPDATE zwrot_klienta SET wersja=wersja+1 WHERE id=?").run(zwrotId);

/**
 * Werdykt biura: przyjęcie albo odmowa.
 *
 * ODMOWA WYMAGA POWODU i to nie jest formalność. §25a.5 stawia ją wśród dwóch
 * rzeczy nieodwracalnych; zwrot odrzucony bez uzasadnienia nie da się później
 * obronić przed klientem ani przed Allegro.
 *
 * Nasza odmowa jest czymś innym niż `rejection_code` z Allegro i dlatego siedzi
 * w osobnych kolumnach — pochodzenie decyzji jest tu informacją, nie
 * szczegółem (patrz komentarz przy tabeli).
 */
export function rozstrzygnijZwrot(
  database: Db, zwrotId: number, decyzja: "przyjety" | "odrzucony",
  powod: string | null, wersja: number, kto: { id: number; name: string },
  teraz = new Date(),
): { werdykt: string; wersja: number } {
  const uzasadnienie = (powod ?? "").trim();
  if (decyzja === "odrzucony" && uzasadnienie === "") {
    throw new Error("Odmowa zwrotu wymaga powodu — bez niego nie ma czego pokazać klientowi.");
  }
  return transaction(database, () => {
    podKlucz(database, zwrotId, wersja);
    database.prepare(`UPDATE zwrot_klienta
      SET werdykt=?, werdykt_at=?, werdykt_przez=?, werdykt_user_id=?, werdykt_powod=?
      WHERE id=?`).run(decyzja, teraz.toISOString(), kto.name, kto.id,
        uzasadnienie === "" ? null : uzasadnienie, zwrotId);
    podnies(database, zwrotId);
    logEvent(`zwrot_werdykt_${decyzja}`, kto.name, null,
      { zwrotId, powod: uzasadnienie || null }, kto.id, database);
    return { werdykt: decyzja, wersja: wersja + 1 };
  })();
}

/** Ocena towaru: na stan, na przecenę albo do utylizacji. `null` cofa ocenę. */
export function ocenPozycje(
  database: Db, pozycjaId: number, ocena: "stan" | "przecena" | "utylizacja" | null,
  wersja: number, kto: { id: number; name: string }, teraz = new Date(),
): { wersja: number } {
  const p = database.prepare("SELECT id, zwrot_id FROM zwrot_klienta_pozycja WHERE id=?")
    .get(pozycjaId) as { id: number; zwrot_id: number } | undefined;
  if (!p) throw new Error("Nie znaleziono pozycji zwrotu");
  return transaction(database, () => {
    const z = podKlucz(database, Number(p.zwrot_id), wersja);
    /* Ocena ma sens dopiero po przyjęciu. Ocenianie towaru ze zwrotu, którego
       nie przyjęliśmy, zostawiałoby w bazie decyzję o czymś, co nie wraca. */
    if (z.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");
    database.prepare(`UPDATE zwrot_klienta_pozycja
      SET ocena=?, ocena_at=?, ocena_przez=? WHERE id=?`)
      .run(ocena, ocena === null ? null : teraz.toISOString(),
        ocena === null ? null : kto.name, pozycjaId);
    podnies(database, Number(p.zwrot_id));
    logEvent(ocena === null ? "zwrot_ocena_cofnieta" : "zwrot_ocena", kto.name, null,
      { zwrotId: Number(p.zwrot_id), pozycjaId, ocena }, kto.id, database);
    return { wersja: wersja + 1 };
  })();
}

/**
 * Potrącenie za utratę wartości pojedynczej pozycji (0.170.0).
 *
 * Do tego wydania kwota była BINARNA per pozycja: cała cena albo nic. Towar
 * wracający używany nie miał jak zjechać w dół, a to codzienność biura.
 *
 * §25a.3 zostaje nienaruszone: panel nadal NIE przysyła kwoty do oddania —
 * przysyła zaznaczenie, a sumę składa `zapiszKwote`. Potrącenie jest osobnym,
 * WALIDOWANYM zapisem przy pozycji, a nie liczbą doklejaną do sumy. Widełki
 * `0…cena × ilość` pilnuje serwer: potrącenie większe niż wartość pozycji
 * znaczyłoby, że klient nam dopłaca.
 *
 * Powód jest OBOWIĄZKOWY, bo to jego treść tłumaczy klientowi, czemu dostał
 * mniej. `null` w kwocie cofa potrącenie razem z powodem — to samo cofnięcie
 * co przy ocenie i korekcie (§25a.5).
 */
export function zapiszPotracenie(
  database: Db, pozycjaId: number, grosze: number | null, powod: string,
  wersja: number, kto: { id: number; name: string }, teraz = new Date(),
): { wersja: number; potracenieGrosze: number | null } {
  const p = database.prepare(
    "SELECT id, zwrot_id, cena_grosze, ilosc FROM zwrot_klienta_pozycja WHERE id=?")
    .get(pozycjaId) as { id: number; zwrot_id: number; cena_grosze: number; ilosc: number } | undefined;
  if (!p) throw new Error("Nie znaleziono pozycji zwrotu");

  const uzasadnienie = (powod ?? "").trim();
  if (grosze !== null) {
    if (!Number.isInteger(grosze) || grosze < 0) {
      throw new Error("Potrącenie to pełne grosze, nie mniej niż zero.");
    }
    const wartosc = Math.round(Number(p.cena_grosze) * Number(p.ilosc));
    if (grosze > wartosc) {
      throw new Error(
        `Potrącenie nie może przekroczyć wartości pozycji (${(wartosc / 100).toFixed(2)}).`);
    }
    if (uzasadnienie === "") {
      throw new Error("Potrącenie wymaga powodu — to jego treść zobaczy klient.");
    }
  }

  return transaction(database, () => {
    const z = podKlucz(database, Number(p.zwrot_id), wersja);
    /* Tak samo jak ocena: potrącenie ma sens dopiero po przyjęciu zwrotu.
       Obniżanie kwoty przy zwrocie, którego nie przyjmujemy, zostawiałoby
       w bazie decyzję o pieniądzach, które i tak nie wyjdą. */
    if (z.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");
    database.prepare(`UPDATE zwrot_klienta_pozycja
      SET potracenie_grosze=?, potracenie_powod=?, potracenie_at=?, potracenie_przez=?
      WHERE id=?`).run(
      grosze, grosze === null ? null : uzasadnienie,
      grosze === null ? null : teraz.toISOString(),
      grosze === null ? null : kto.name, pozycjaId);
    podnies(database, Number(p.zwrot_id));
    logEvent(grosze === null ? "zwrot_potracenie_cofniete" : "zwrot_potracenie",
      kto.name, null,
      { zwrotId: Number(p.zwrot_id), pozycjaId, grosze, powod: uzasadnienie || null },
      kto.id, database);
    return { wersja: wersja + 1, potracenieGrosze: grosze };
  })();
}

/**
 * Kwota do oddania — z ZAZNACZENIA, nie z liczby przysłanej przez panel.
 *
 * §25a.3 mówi wprost: „Liczy ją serwer, panel niczego nie zgaduje". Panel
 * przysyła więc listę zaznaczonych pozycji i informację o dostawie, a sumę
 * składa ta funkcja. Gdyby przyjmowała gotową liczbę, dałoby się zapisać
 * dowolną kwotę żądaniem z pominięciem ekranu — a to są cudze pieniądze.
 *
 * `kwota_wariant` wylicza się z zaznaczenia i jest ETYKIETĄ, nie wyborem:
 * wszystko z dostawą to `pelna`, wszystko bez niej `bez_wysylki`, każde inne
 * zaznaczenie `inna`.
 */
export function zapiszKwote(
  database: Db, zwrotId: number, wybor: { pozycjeIds: number[]; dostawa: boolean },
  wersja: number, kto: { id: number; name: string }, teraz = new Date(),
): { kwotaGrosze: number; dostawaGrosze: number; wariant: string; wersja: number } {
  return transaction(database, () => {
    const z = podKlucz(database, zwrotId, wersja);
    if (z.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");

    const wszystkie = database.prepare(
      `SELECT id, cena_grosze, ilosc, potracenie_grosze
         FROM zwrot_klienta_pozycja WHERE zwrot_id=?`)
      .all(zwrotId) as Array<{ id: number; cena_grosze: number; ilosc: number;
        potracenie_grosze: number | null }>;
    const znane = new Set(wszystkie.map((p) => Number(p.id)));
    /* Obca pozycja ODPADA GŁOŚNO. Ciche pominięcie zapisałoby kwotę niższą,
       niż operator widział na ekranie — a on kliknął to, co widział. */
    const obce = wybor.pozycjeIds.filter((id) => !znane.has(Number(id)));
    if (obce.length) {
      throw new Error(`Pozycje ${obce.join(", ")} nie należą do tego zwrotu.`);
    }
    const wybrane = new Set(wybor.pozycjeIds.map(Number));
    /* Potrącenie odejmuje SERWER, z tego, co zapisano przy pozycji — panel
       nadal nie przysyła ani jednej liczby o pieniądzach. Widełki sprawdziło
       `zapiszPotracenie`, więc suma nie ma prawa zejść poniżej zera. */
    const suma = wszystkie
      .filter((p) => wybrane.has(Number(p.id)))
      .reduce((s, p) => s + Math.round(Number(p.cena_grosze) * Number(p.ilosc))
        - Number(p.potracenie_grosze ?? 0), 0);

    /* Koszt dostawy bierze się z ZAMÓWIENIA, nie ze zwrotu: Allegro nie
       przysyła go przy zwrocie. Dociągamy zamówienia od 0.152.0 i dopiero to
       zdjęło blokadę opisaną przy `sumaPozycji`. Brak zamówienia znaczy zero,
       bo nie ma czego oddać — a nie „oddaj nieznaną kwotę". */
    const dostawa = wybor.dostawa
      ? Number((database.prepare(`SELECT k.dostawa_grosze AS d FROM zamowienie_klienta k
          JOIN zwrot_klienta z ON z.order_id = k.external_id
            AND z.channel_account_id = k.channel_account_id
          WHERE z.id=?`).get(zwrotId) as { d: number | null } | undefined)?.d ?? 0)
      : 0;

    const wariant = wybrane.size === wszystkie.length
      ? (wybor.dostawa ? "pelna" : "bez_wysylki")
      : "inna";

    database.prepare("UPDATE zwrot_klienta_pozycja SET w_zwrocie=0 WHERE zwrot_id=?").run(zwrotId);
    if (wybrane.size) {
      const znaki = [...wybrane].map(() => "?").join(",");
      database.prepare(
        `UPDATE zwrot_klienta_pozycja SET w_zwrocie=1 WHERE id IN (${znaki})`).run(...wybrane);
    }
    database.prepare(`UPDATE zwrot_klienta
      SET kwota_grosze=?, kwota_dostawa_grosze=?, kwota_wariant=?, kwota_at=?, kwota_przez=?
      WHERE id=?`).run(suma + dostawa, dostawa, wariant, teraz.toISOString(), kto.name, zwrotId);
    podnies(database, zwrotId);
    logEvent("zwrot_kwota", kto.name, null,
      { zwrotId, kwotaGrosze: suma + dostawa, dostawaGrosze: dostawa, wariant,
        pozycje: [...wybrane] }, kto.id, database);
    return { kwotaGrosze: suma + dostawa, dostawaGrosze: dostawa, wariant, wersja: wersja + 1 };
  })();
}

/* ── Korekta i zamknięcie (0.162.0) ──────────────────────────────────────────
   Piąty kubełek był ślepym zaułkiem: `kubelekZwrotu` routuje po
   `korekta_numer`, a tej kolumny nic nie zapisywało. Zwrot z ustaloną kwotą
   stał w DO KOREKTY na zawsze, a ekran pisał przy nim „czeka na własne
   wydanie".

   KOREKTĘ WYSTAWIA CZŁOWIEK W SUBIEKCIE, a panel zapisuje jej numer. To nie
   jest półśrodek w drodze do automatu, tylko jedyna droga, jaką dziś widać:
   `korekta_zwrot` w kolejce Sfery potrzebuje `dok_Id` dokumentu SPRZEDAŻY,
   a read-model `sgt_dokument` trzyma wyłącznie FZ i PZ — zakupy. Bez tego
   identyfikatora automat musiałby go zgadywać, a zgadywanie kształtu cudzej
   bazy kosztowało już w tym repo trzy wydania.

   PIENIĄDZE NADAL ODDAJE CZŁOWIEK w panelu Allegro. Zamknięcie znaczy tu
   „nasza część jest zrobiona", nie „klient dostał przelew" — i tak samo mówi
   o tym ekran.                                                              */

/**
 * Numer korekty wystawionej w Subiekcie. Zamyka zwrot.
 *
 * Zamknięcie zapisujemy WPROST w `zamkniety_at`, choć `kubelekZwrotu`
 * wywiódłby je z samego numeru. Godzina zejścia sprawy z biurka jest faktem,
 * którego z obecności napisu nie da się odtworzyć.
 */
export function zapiszKorekte(
  database: Db, zwrotId: number, numer: string, wersja: number,
  kto: { id: number; name: string }, teraz = new Date(),
): { korektaNumer: string; zamknietyAt: string; wersja: number } {
  const dokument = (numer ?? "").trim();
  if (!dokument) {
    throw new Error("Korekta wymaga numeru dokumentu z Subiekta — bez niego nic nie domyka.");
  }
  return transaction(database, () => {
    podKlucz(database, zwrotId, wersja);
    /* Kolejność bramek jest UMOWĄ kolejki. Numer zapisany przed kwotą
       przeskoczyłby zwrot z DO ZWROTU wprost do zamkniętych — czyli zamknąłby
       sprawę pieniędzy, o których nikt nie zdecydował. */
    const stan = database.prepare(
      "SELECT werdykt, kwota_grosze FROM zwrot_klienta WHERE id=?")
      .get(zwrotId) as { werdykt: string | null; kwota_grosze: number | null };
    if (stan.werdykt !== "przyjety") throw new Error("Najpierw przyjmij zwrot");
    if (stan.kwota_grosze === null) throw new Error("Najpierw ustal kwotę do oddania");

    const kiedy = teraz.toISOString();
    database.prepare(`UPDATE zwrot_klienta
      SET korekta_numer=?, zamkniety_at=? WHERE id=?`).run(dokument, kiedy, zwrotId);
    podnies(database, zwrotId);
    zdarzenie(database, zwrotId, "korekta", `Korekta ${dokument}`, { numer: dokument }, kto, kiedy);
    logEvent("zwrot_korekta", kto.name, null, { zwrotId, numer: dokument }, kto.id, database);
    return { korektaNumer: dokument, zamknietyAt: kiedy, wersja: wersja + 1 };
  })();
}

/**
 * Cofnięcie korekty — JEDYNA operacja dozwolona na zamkniętym zwrocie.
 *
 * §25a.5: potwierdzenie dostają dwie rzeczy nieodwracalne (oddanie pieniędzy
 * i odmowa), reszta ma cofnięcie. Numer dokumentu jest tu przepisywany
 * z Subiekta ręką, więc literówka jest zdarzeniem normalnym, nie awarią.
 *
 * Cofamy KOREKTĘ, nie pracę nad zwrotem: werdykt, oceny i kwota zostają, więc
 * zwrot wraca do DO KOREKTY, a nie na początek kolejki.
 */
export function cofnijKorekte(
  database: Db, zwrotId: number, wersja: number, kto: { id: number; name: string },
  teraz = new Date(),
): { wersja: number } {
  return transaction(database, () => {
    /* Z pominięciem `podKlucz`: ta bramka odrzuca zwrot zamknięty, a tu
       zamknięcie jest właśnie tym, co cofamy. Wersji pilnujemy tak samo. */
    const z = database.prepare(
      "SELECT wersja, korekta_numer FROM zwrot_klienta WHERE id=?")
      .get(zwrotId) as { wersja: number; korekta_numer: string | null } | undefined;
    if (!z) throw new Error("Nie znaleziono zwrotu");
    if (Number(z.wersja) !== wersja) {
      throw new ZwrotConflict(
        "Zwrot zmienił się w międzyczasie — odśwież i sprawdź, co zrobił inny agent.",
        { wersja: Number(z.wersja), przyslana: wersja });
    }
    if (!z.korekta_numer) throw new Error("Ten zwrot nie ma zapisanej korekty");

    const kiedy = teraz.toISOString();
    database.prepare(
      "UPDATE zwrot_klienta SET korekta_numer=NULL, zamkniety_at=NULL WHERE id=?").run(zwrotId);
    podnies(database, zwrotId);
    zdarzenie(database, zwrotId, "korekta_cofnieta", `Cofnięto korektę ${z.korekta_numer}`,
      { numer: z.korekta_numer }, kto, kiedy);
    logEvent("zwrot_korekta_cofnieta", kto.name, null,
      { zwrotId, numer: z.korekta_numer }, kto.id, database);
    return { wersja: wersja + 1 };
  })();
}

/* ── Otwarcie zwrotu skanem etykiety zwrotnej (0.163.0) ──────────────────────
   Paczka wraca do biura wcześniej niż wiedza o tym, który to zwrot. Do tego
   wydania operator szukał go oczami; teraz odpowiada za to czytnik.

   TRZY KSZTAŁTY, bo etykiety bywają różne: numer zwrotu doklejony przez
   klienta, identyfikator z panelu i — najczęściej — numer listu kuriera
   (`600000367616070023174201` u InPostu, `AD00R28X72` u DPD).

   DOPASOWANIE WYŁĄCZNIE DOKŁADNE. `routes/products.ts` opisuje, dlaczego
   furtka na literówki jest tam wyłączona: trasa sama otwiera kartę przy jednym
   wyniku, więc przybliżenie prowadzi do CUDZEJ kartoteki. Przy zwrocie
   znaczyłoby to cudzego klienta i cudze pieniądze.

   DWA TRAFIENIA TO BRAK TRAFIENIA — wzorzec `ktoMaTenKod` z `ean-alias.ts`,
   gdzie każde dodatkowe trafienie jest powodem odmowy, nie zachętą do wzięcia
   pierwszego z brzegu. Rozstrzyga człowiek, patrząc na oba.                 */

export type TrafienieSkanu = "numer" | "external" | "waybill";

export interface WynikSkanu {
  trafienie: TrafienieSkanu | "wiele" | null;
  zwrotId: number | null;
  /** Przy „wiele": tyle, ile ekran potrzebuje, żeby dać wybrać. */
  zwroty: Array<{ id: number; numer: string | null; externalId: string }>;
}

const PUSTY: WynikSkanu = { trafienie: null, zwrotId: null, zwroty: [] };

/**
 * Zwrot spod zeskanowanego kodu.
 *
 * NUMER LISTU CZYTAMY Z LĄDOWISKA, nie z modelu pracy — tam go nie ma i nie
 * dokładamy mu kolumny. `ksztalt.ts` nazywa numer listu „daną osobową okrężną
 * drogą" (prowadzi w systemie kuriera do adresu odbiorcy), więc jest tu
 * UŻYTY, a nie ZAPAMIĘTANY: w bazie zostaje dokładnie to, co i tak leży
 * w kopii odpowiedzi Allegro.
 *
 * `transportingWaybill` szukamy razem z `waybill`, bo przy dwóch kurierach na
 * jednej przesyłce na naklejce bywa ten drugi (schemat `CustomerReturnReturnParcel`).
 */
export function znajdzZwrotPoKodzie(kod: string, database: Db = defaultDb()): WynikSkanu {
  const szukane = (kod ?? "").trim();
  if (!szukane) return PUSTY;

  const poKolumnie = (kolumna: "reference_number" | "external_id"): number[] =>
    (database.prepare(`SELECT id FROM zwrot_klienta WHERE ${kolumna} = ?`)
      .all(szukane) as Array<{ id: number }>).map((w) => Number(w.id));

  const kandydaci: Array<[TrafienieSkanu, number[]]> = [
    ["numer", poKolumnie("reference_number")],
    ["external", poKolumnie("external_id")],
    ["waybill", (database.prepare(`
      SELECT z.id FROM zwrot_klienta z
        JOIN allegro_zwrot a ON a.id = z.external_id,
        json_each(json_extract(a.surowe_json, '$.parcels')) p
       WHERE json_extract(p.value, '$.waybill') = ?
          OR json_extract(p.value, '$.transportingWaybill') = ?`)
      .all(szukane, szukane) as Array<{ id: number }>).map((w) => Number(w.id))],
  ];

  for (const [trafienie, idy] of kandydaci) {
    const jedyne = [...new Set(idy)];
    if (jedyne.length === 1) return { trafienie, zwrotId: jedyne[0], zwroty: [] };
    if (jedyne.length > 1) return { trafienie: "wiele", zwrotId: null, zwroty: opisz(database, jedyne) };
  }
  return { ...PUSTY, zwroty: [] };
}

function opisz(database: Db, idy: number[]) {
  const miejsca = idy.map(() => "?").join(",");
  return (database.prepare(
    `SELECT id, reference_number, external_id FROM zwrot_klienta WHERE id IN (${miejsca}) ORDER BY id`
  ).all(...idy) as Wiersz[]).map((w) => ({
    id: Number(w.id),
    numer: (w.reference_number as string) ?? null,
    externalId: String(w.external_id),
  }));
}

function zdarzenie(
  database: Db, zwrotId: number, rodzaj: string, tresc: string,
  dane: Record<string, unknown>, kto: { id: number; name: string }, kiedy: string,
): void {
  database.prepare(`INSERT INTO zwrot_zdarzenie
    (zwrot_id,rodzaj,tresc,dane_json,kiedy_at,kto,kto_user_id) VALUES (?,?,?,?,?,?,?)`)
    .run(zwrotId, rodzaj, tresc, JSON.stringify(dane), kiedy, kto.name, kto.id);
}
