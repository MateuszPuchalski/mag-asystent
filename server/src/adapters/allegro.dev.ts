import type {
  AllegroAdapter,
  DyskusjaAllegro,
  KupujacyRef,
  OfertaAllegro,
  SzukanieWatku,
  PrzesylkaZamowienia,
  WatekAllegro,
  WatekNaglowek,
  WiadomoscAllegro,
  WiadomoscDyskusji,
  OpiniaAllegro,
  ZamowienieAllegro,
  ZamowienieKupujacego,
  ZdarzenieSledzenia,
  ZwrotAllegro,
} from "./allegro.js";
import { normalizujRef, urlOferty } from "./allegro.http.js";

/* ── DEV — fikcyjne zwroty Allegro (zero sieci) ──────────────────────────────
   Lustro DevSferaAdapter: cały przepływ zwrotów działa end-to-end bez konta
   Allegro i bez MSSQL. Dane są DETERMINISTYCZNE i zestrojone 1:1 z seedem
   scenariuszy (S67–S69, `db/seed-scenariusze.ts` → `sprzedazDemo`): numery
   zamówień, sygnatury i ilości muszą się zgadzać, bo scenariusze mierzą
   właśnie dopasowanie dokumentu.

   Trzy przypadki, każdy czegoś innego:
     dev-ret-1  skan DEVWB0001 — dwie pozycje, zamówienie z sygnaturami,
                FS 30001 niesie numer zamówienia → dopasowanie AUTO
     dev-ret-2  skan DEVTW0002 — etykieta przewoźnika DORĘCZAJĄCEGO (inna niż
                numer nadania DEVWB0002); dwa paragony-kandydaci → wybór ręką
     dev-ret-3  skan DEVWB0003 — sygnatura spoza kartoteki → tw_id NULL,
                bez dopasowania
   Każdy inny kod → zero wyników (ścieżka zwrotu ręcznego).                   */

const DZIEN_MS = 86_400_000;
const dniTemu = (n: number) => new Date(Date.now() - n * DZIEN_MS).toISOString();

function zwroty(): ZwrotAllegro[] {
  const lista: ZwrotAllegro[] = [
    {
      id: "dev-ret-1",
      orderId: "dev-ord-1",
      referencja: "ZW-DEV-0001",
      status: "DELIVERED",
      utworzono: dniTemu(3),
      kupujacyLogin: "jan_wraca",
      kupujacyId: "44300001",
      kupujacyEmail: "jan.wraca@example.com",
      pozycje: [
        {
          offerId: "of-1",
          nazwa: "Pozycja jeszcze nietknięta — oferta Allegro",
          externalId: null, // sygnaturę dokleja zamówienie, jak w prawdziwym API
          ilosc: 1,
          powod: "Niezgodny z opisem",
          powodOpis: "Miała być końcówka 3/8, jest 1/4",
        },
        {
          offerId: "of-2",
          nazwa: "Pozycja odłożona w całości — oferta Allegro",
          externalId: null,
          ilosc: 2,
          powod: "Rezygnacja z zakupu",
          powodOpis: null,
        },
      ],
      paczki: [{ waybill: "DEVWB0001", transportingWaybill: null, przewoznik: "INPOST" }],
      surowe: { dev: true, id: "dev-ret-1" },
    },
    {
      id: "dev-ret-2",
      orderId: "dev-ord-2",
      referencja: "ZW-DEV-0002",
      status: "CREATED",
      utworzono: dniTemu(1),
      kupujacyLogin: "ewa_oddaje",
      kupujacyId: "44300002",
      kupujacyEmail: "ewa.oddaje@example.com",
      pozycje: [
        {
          offerId: "of-3",
          nazwa: "Szybkorotujący poza strefą złotą — oferta Allegro",
          externalId: null,
          ilosc: 1,
          powod: "Uszkodzony",
          powodOpis: "Pęknięta obudowa przy odbiorze",
        },
      ],
      paczki: [
        { waybill: "DEVWB0002", transportingWaybill: "DEVTW0002", przewoznik: "DPD" },
      ],
      surowe: { dev: true, id: "dev-ret-2" },
    },
    {
      id: "dev-ret-3",
      orderId: "dev-ord-3",
      referencja: "ZW-DEV-0003",
      status: "CREATED",
      utworzono: dniTemu(5),
      kupujacyLogin: "firma_x",
      kupujacyId: "44300003",
      kupujacyEmail: null,
      pozycje: [
        {
          offerId: "of-4",
          nazwa: "Artykuł sprzedany poza kartoteką WERTIS",
          externalId: null,
          ilosc: 1,
          powod: "Nie zamawiałem tego",
          powodOpis: null,
        },
      ],
      paczki: [{ waybill: "DEVWB0003", transportingWaybill: null, przewoznik: "POCZTA" }],
      surowe: { dev: true, id: "dev-ret-3" },
    },
  ];
  return lista;
}

/** Sygnatury per zamówienie — to, co w produkcji przynosi checkout-form. */
const ZAMOWIENIA: Record<string, ZamowienieAllegro> = {
  "dev-ord-1": {
    id: "dev-ord-1",
    kupujacyLogin: "jan_wraca",
    kupujacyId: "44300001",
    kupujacyEmail: "jan.wraca@example.com",
    /* Zapłacone i wysłane — najczęstszy układ przy dyskusji „gdzie paczka". */
    kupionoAt: dniTemu(9),
    status: "READY_FOR_PROCESSING",
    wysylka: "SENT",
    dostawaMetoda: "Kurier DPD",
    platnosc: {
      typ: "ONLINE",
      dostawca: "PayU",
      kwota: "249.90",
      waluta: "PLN",
      zaplaconoAt: dniTemu(9),
    },
    pozycje: [
      { offerId: "of-1", nazwa: "Pozycja jeszcze nietknięta — oferta Allegro", externalId: "TEST-LINIA-TODO", ilosc: 1 },
      { offerId: "of-2", nazwa: "Pozycja odłożona w całości — oferta Allegro", externalId: "TEST-LINIA-DONE", ilosc: 2 },
    ],
  },
  "dev-ord-2": {
    id: "dev-ord-2",
    kupujacyLogin: "ewa_oddaje",
    kupujacyId: "44300002",
    kupujacyEmail: "ewa.oddaje@example.com",
    /* Pobranie bez `finishedAt` — demo uczciwego „pieniądze jeszcze nie
       doszły", które przy reklamacji zmienia całą rozmowę. */
    kupionoAt: dniTemu(14),
    status: "READY_FOR_PROCESSING",
    wysylka: "PICKED_UP",
    dostawaMetoda: "Kurier DPD — pobranie",
    platnosc: {
      typ: "CASH_ON_DELIVERY",
      dostawca: null,
      kwota: "129.00",
      waluta: "PLN",
      zaplaconoAt: null,
    },
    pozycje: [
      { offerId: "of-3", nazwa: "Szybkorotujący poza strefą złotą — oferta Allegro", externalId: "TEST-ROTUJACY", ilosc: 1 },
      /* Pozycja, która NIE wraca — sekcja „całe zamówienie" ma pokazywać
         także to, co zostało u klienta (S68). */
      { offerId: "of-9", nazwa: "Pozycja odłożona w całości — oferta Allegro", externalId: "TEST-LINIA-DONE", ilosc: 3 },
    ],
  },
  "dev-ord-3": {
    id: "dev-ord-3",
    kupujacyLogin: "firma_x",
    kupujacyId: "44300003",
    kupujacyEmail: null,
    /* Zamówienie BEZ bloku płatności — ekran ma to znieść bez pustych
       wierszy udających dane. */
    kupionoAt: dniTemu(30),
    status: "READY_FOR_PROCESSING",
    wysylka: "PICKED_UP",
    dostawaMetoda: null,
    platnosc: null,
    pozycje: [
      { offerId: "of-4", nazwa: "Artykuł sprzedany poza kartoteką WERTIS", externalId: "SPOZA-KATALOGU", ilosc: 1 },
    ],
  },
};

/**
 * Fikcyjne wątki Centrum wiadomości — po IDENTYFIKATORZE kupującego, bo tak
 * to działa naprawdę: prawdziwa lista wątków maskuje rozmówcę jako
 * `client:44300444` i loginu z zamówienia w niej nie ma. Klucz po loginie
 * ukryłby właśnie ten błąd. Jeden klient ma rozmowę, dwaj nie — karta zwrotu
 * musi pokazywać oba stany.
 */
const WATKI: Record<string, WatekAllegro> = {
  "44300001": {
    threadId: "dev-thread-1",
    interlokutor: "client:44300001",
    wiadomosci: [
      {
        id: "dev-msg-1",
        odKupujacego: true,
        autor: "jan_wraca",
        tresc: "Dzień dobry, zamówiłem końcówkę 3/8, a w paczce jest 1/4. Odsyłam.",
        at: dniTemu(4),
        zalacznikow: 1,
        ofertaId: null,
      },
      {
        id: "dev-msg-2",
        odKupujacego: false,
        autor: "wertis",
        tresc: "Dzień dobry, przepraszamy za pomyłkę. Prosimy o odesłanie — zwrot środków po sprawdzeniu towaru.",
        at: dniTemu(4),
        zalacznikow: 0,
        ofertaId: null,
      },
      {
        id: "dev-msg-3",
        odKupujacego: true,
        autor: "jan_wraca",
        tresc: "Nadane, numer przesyłki DEVWB0001.",
        at: dniTemu(3),
        zalacznikow: 0,
        ofertaId: null,
      },
    ],
  },
};

/* ── Pytania klientów (0.80.0) ───────────────────────────────────────────────
   Cztery wątki, każdy sprawdza co innego w synchronizacji i w szkicu:
     dev-pyt-1  dobór części, towar JEST w kartotece (TEST-LINIA-TODO)
     dev-pyt-2  dobór części, towaru NIE MA — pytanie o braku w ofercie
     dev-pyt-3  ostatnia wiadomość jest OD NAS → pytanie NIE powstaje
     dev-pyt-4  wysyłka zagraniczna — szkic musi sięgnąć po fakty firmowe,
                bo kosztu wysyłki do Chorwacji nie ma skąd zgadnąć           */

interface WatekPytania {
  naglowek: WatekNaglowek;
  wiadomosci: WiadomoscAllegro[];
}

const WATKI_PYTAN: WatekPytania[] = [
  {
    naglowek: {
      threadId: "dev-pyt-1",
      interlokutor: "client:44300101",
      ostatniaWiadomoscAt: dniTemu(1),
      przeczytany: false,
      ofertaId: "of-1",
      ofertaTytul: "Pozycja jeszcze nietknięta — oferta Allegro",
    },
    wiadomosci: [
      {
        id: "dev-pyt-msg-1",
        odKupujacego: true,
        autor: "client:44300101",
        tresc:
          "Dzień dobry, mam kosiarkę spalinową model T375 i szukam pasującej " +
          "końcówki 3/8. Czy ta pozycja będzie pasować i jaki to symbol?",
        at: dniTemu(1),
        zalacznikow: 0,
        /* Aukcja przy WIADOMOŚCI, nie tylko w nagłówku wątku — tak podpina ją
           Allegro i to jest najmocniejszy trop w pytaniu o dobór części. */
        ofertaId: "of-1",
      },
    ],
  },
  {
    naglowek: {
      threadId: "dev-pyt-2",
      interlokutor: "client:44300102",
      ostatniaWiadomoscAt: dniTemu(2),
      przeczytany: false,
      ofertaId: null,
      ofertaTytul: null,
    },
    wiadomosci: [
      {
        id: "dev-pyt-msg-2",
        odKupujacego: true,
        autor: "client:44300102",
        tresc:
          "Witam, czy mają Państwo cewkę zapłonową do kosiarki marki, której " +
          "nie ma w Państwa ofercie — model ZZZ-9999?",
        at: dniTemu(2),
        zalacznikow: 0,
        ofertaId: null,
      },
    ],
  },
  {
    naglowek: {
      threadId: "dev-pyt-3",
      interlokutor: "client:44300103",
      ostatniaWiadomoscAt: dniTemu(3),
      przeczytany: true,
      ofertaId: "of-3",
      ofertaTytul: "Szybkorotujący poza strefą złotą — oferta Allegro",
    },
    wiadomosci: [
      {
        id: "dev-pyt-msg-3a",
        odKupujacego: true,
        autor: "client:44300103",
        tresc: "Czy towar jest dostępny od ręki?",
        at: dniTemu(4),
        zalacznikow: 0,
        ofertaId: null,
      },
      {
        id: "dev-pyt-msg-3b",
        odKupujacego: false,
        autor: "wertis",
        tresc: "Dzień dobry, tak — wysyłka tego samego dnia roboczego.",
        at: dniTemu(3),
        zalacznikow: 0,
        ofertaId: null,
      },
    ],
  },
  {
    naglowek: {
      threadId: "dev-pyt-4",
      interlokutor: "client:44300104",
      ostatniaWiadomoscAt: dniTemu(1),
      przeczytany: false,
      ofertaId: "of-3",
      ofertaTytul: "Szybkorotujący poza strefą złotą — oferta Allegro",
    },
    wiadomosci: [
      {
        id: "dev-pyt-msg-4",
        odKupujacego: true,
        autor: "client:44300104",
        tresc:
          "witam czy można wysłać do Chorwacji i na kiedy by było i jaki koszt " +
          "wysyłki oczywiście płatność z góry",
        at: dniTemu(1),
        zalacznikow: 0,
        ofertaId: null,
      },
    ],
  },
];

/** Nasze fikcyjne oferty — zestrojone z kartoteką scenariuszy (seed-scenariusze). */
const OFERTY_DEV: Array<Omit<OfertaAllegro, "url">> = [
  {
    offerId: "of-1",
    nazwa: "Pozycja jeszcze nietknięta — oferta Allegro",
    cena: "39,90 PLN",
    externalId: "TEST-LINIA-TODO",
    dostepnych: 10,
  },
  {
    offerId: "of-2",
    nazwa: "Pozycja odłożona w całości — oferta Allegro",
    cena: "19,90 PLN",
    externalId: "TEST-LINIA-DONE",
    dostepnych: 10,
  },
  {
    offerId: "of-3",
    nazwa: "Szybkorotujący poza strefą złotą — oferta Allegro",
    cena: "59,00 PLN",
    externalId: "TEST-ROTUJACY",
    dostepnych: 60,
  },
];

export class DevAllegroAdapter implements AllegroAdapter {
  /**
   * Wiadomości DOPISANE przez `wyslijWiadomosc` i odhaczone wątki.
   *
   * Stan w pamięci instancji, nie w module: testy biorą świeży adapter przez
   * `zresetujAdapterAllegro()`, więc wysyłka z jednego testu nie może
   * wyciekać do następnego. W demo singleton żyje przez proces, czyli
   * dokładnie tak długo, jak trzeba, żeby zobaczyć własną odpowiedź w wątku.
   */
  private dopisane = new Map<string, WiadomoscAllegro[]>();
  private odhaczone = new Set<string>();

  async szukajZwrotowPoWaybill(waybill: string): Promise<ZwrotAllegro[]> {
    const kod = waybill.trim();
    return zwroty().filter((z) =>
      z.paczki.some((p) => p.waybill === kod || p.transportingWaybill === kod)
    );
  }

  async listaDyskusji(): Promise<DyskusjaAllegro[]> {
    /* Trzy fikcyjne sprawy — rozmowa, formalna reklamacja i sprawa już
       zamknięta w panelu. Numery zamówień celowo te same co w `zwroty()`:
       rejestr dyskusji ma pokazać powiązanie ze zwrotem po seedzie, a trzecia
       sprawa ćwiczy auto-zamknięcie po statusie Allegro. */
    return [
      {
        id: "dev-issue-1",
        typ: "DISCUSSION",
        status: "ONGOING",
        temat: "Pytanie o brakującą śrubę w zestawie",
        kupujacyLogin: "jan_wraca",
        orderId: "dev-ord-1",
        utworzono: dniTemu(2),
      },
      {
        id: "dev-issue-2",
        typ: "CLAIM",
        status: "NEW",
        temat: "Reklamacja: pęknięta obudowa po tygodniu",
        kupujacyLogin: "ewa_oddaje",
        orderId: "dev-ord-2",
        utworzono: dniTemu(1),
      },
      {
        id: "dev-issue-3",
        typ: "DISCUSSION",
        status: "CLOSED",
        temat: "Rozstrzygnięte: zwrot kosztów wysyłki",
        kupujacyLogin: "firma_x",
        orderId: "dev-ord-3",
        utworzono: dniTemu(6),
      },
    ];
  }

  async listaZwrotowKlienta(odKiedy: string | null): Promise<ZwrotAllegro[]> {
    const granica = odKiedy ? Date.parse(odKiedy) : NaN;
    return zwroty().filter(
      (z) => !Number.isFinite(granica) || Date.parse(z.utworzono ?? "") >= granica
    );
  }

  async listaOpinii(odKiedy: string | null): Promise<OpiniaAllegro[]> {
    const granica = odKiedy ? Date.parse(odKiedy) : NaN;
    return OPINIE_DEV.filter(
      (o) => Number.isNaN(granica) || !o.utworzono || Date.parse(o.utworzono) >= granica
    );
  }

  async zwrot(id: string): Promise<ZwrotAllegro | null> {
    return zwroty().find((z) => z.id === id) ?? null;
  }

  async zamowienie(orderId: string): Promise<ZamowienieAllegro | null> {
    return ZAMOWIENIA[orderId] ?? null;
  }

  async watekKupujacego(kto: KupujacyRef, _odKiedy: string | null): Promise<SzukanieWatku> {
    const klucze = [normalizujRef(kto.id), normalizujRef(kto.login)].filter(
      (v): v is string => v !== null
    );
    const watek = klucze.map((k) => WATKI[k]).find((w) => w !== undefined) ?? null;
    /* Dev ma stałą, malutką listę — zawsze przechodzimy ją w całości. */
    return {
      watek,
      przejrzanych: Object.keys(WATKI).length,
      najstarszaData: null,
      wyczerpano: true,
    };
  }

  // ── Pytania klientów ───────────────────────────────────────────────────────

  async listaWatkow(odKiedy: string | null, _maxStron = 10): Promise<WatekNaglowek[]> {
    const granica = odKiedy ? Date.parse(odKiedy) : NaN;
    return WATKI_PYTAN.map((w) => this.naglowekZeStanem(w))
      .filter(
        (n) =>
          !Number.isFinite(granica) ||
          Date.parse(n.ostatniaWiadomoscAt ?? "") >= granica
      )
      .sort((a, b) =>
        (b.ostatniaWiadomoscAt ?? "").localeCompare(a.ostatniaWiadomoscAt ?? "")
      );
  }

  /** Nagłówek z naniesionym stanem w pamięci (odhaczenie, data naszej odpowiedzi). */
  private naglowekZeStanem(w: WatekPytania): WatekNaglowek {
    const dopisane = this.dopisane.get(w.naglowek.threadId) ?? [];
    const ostatnia = dopisane[dopisane.length - 1];
    return {
      ...w.naglowek,
      ostatniaWiadomoscAt: ostatnia?.at ?? w.naglowek.ostatniaWiadomoscAt,
      przeczytany: this.odhaczone.has(w.naglowek.threadId) ? true : w.naglowek.przeczytany,
    };
  }

  /* `rozmowca` adapterowi dev jest niepotrzebny: trzyma gotowe `WiadomoscAllegro`
     z ustawionym `odKupujacego` i nie przechodzi przez `mapujWiadomosci`.
     Parametr stoi w sygnaturze dla zgodności z interfejsem — i to właśnie ta
     różnica sprawiła, że usterka z 0.102.1 nie miała jak wyjść w demo. */
  async wiadomosciWatku(threadId: string, _rozmowca?: string | null): Promise<WiadomoscAllegro[]> {
    const watek = WATKI_PYTAN.find((w) => w.naglowek.threadId === threadId);
    const bazowe = watek ? watek.wiadomosci : (WATKI[threadId]?.wiadomosci ?? []);
    return [...bazowe, ...(this.dopisane.get(threadId) ?? [])];
  }

  async wyslijWiadomosc(threadId: string, tekst: string): Promise<void> {
    const lista = this.dopisane.get(threadId) ?? [];
    lista.push({
      id: `dev-wyslana-${threadId}-${lista.length + 1}`,
      odKupujacego: false,
      autor: "wertis",
      tresc: tekst,
      at: new Date().toISOString(),
      zalacznikow: 0,
      ofertaId: null,
    });
    this.dopisane.set(threadId, lista);
  }

  async oznaczPrzeczytany(threadId: string): Promise<void> {
    this.odhaczone.add(threadId);
  }

  async szukajOfert(fraza: string): Promise<OfertaAllegro[]> {
    const szukane = fraza.trim().toLowerCase();
    if (szukane === "") return [];
    return OFERTY_DEV.filter(
      (o) =>
        o.nazwa.toLowerCase().includes(szukane) ||
        (o.externalId ?? "").toLowerCase().includes(szukane)
    ).map((o) => ({ ...o, url: urlOferty(o.offerId, false) }));
  }

  async oferta(offerId: string): Promise<OfertaAllegro | null> {
    const o = OFERTY_DEV.find((x) => x.offerId === offerId);
    return o ? { ...o, url: urlOferty(o.offerId, false) } : null;
  }

  // ── Dyskusje: rozmowa i odpowiedź (0.104.0) ────────────────────────────────

  /* Ten sam wzorzec co `dopisane`: stan w instancji, nie w module, żeby
     wysyłka z jednego testu nie wyciekała do następnego. */
  private dyskusjeDopisane = new Map<string, WiadomoscDyskusji[]>();
  private zalacznikiDyskusji = new Map<string, { nazwa: string; mime: string }>();

  async wiadomosciDyskusji(allegroId: string): Promise<WiadomoscDyskusji[] | null> {
    /* Trzy rozmowy zestrojone z `listaDyskusji()`; nieznane id → null —
       demo ścieżki „rozmowa niedostępna przez API, otwórz panel". */
    const bazowe = ROZMOWY_DYSKUSJI[allegroId];
    if (!bazowe) return null;
    return [...bazowe, ...(this.dyskusjeDopisane.get(allegroId) ?? [])];
  }

  async wyslijWiadomoscDyskusji(
    allegroId: string,
    tekst: string,
    zalacznikId?: string
  ): Promise<void> {
    if (!ROZMOWY_DYSKUSJI[allegroId]) {
      throw new Error(
        "Allegro nie zna tej sprawy pod API dyskusji (404) — odpowiedz w panelu Allegro."
      );
    }
    const lista = this.dyskusjeDopisane.get(allegroId) ?? [];
    const zal = zalacznikId ? this.zalacznikiDyskusji.get(zalacznikId) : undefined;
    lista.push({
      id: `dev-dysk-wyslana-${allegroId}-${lista.length + 1}`,
      odNas: true,
      autorLogin: "wertis",
      autorRola: "SELLER",
      tresc: tekst,
      at: new Date().toISOString(),
      zalacznik: zal ? { nazwa: zal.nazwa, url: null } : null,
    });
    this.dyskusjeDopisane.set(allegroId, lista);
  }

  async dodajZalacznikDyskusji(
    nazwaPliku: string,
    mime: string,
    _daneBase64: string
  ): Promise<string> {
    /* Walidacja rozmiaru i MIME należy do serwisu — adapter dev tylko wydaje
       identyfikator, jak zrobiłby to prawdziwy Allegro. */
    const id = `dev-zal-${this.zalacznikiDyskusji.size + 1}`;
    this.zalacznikiDyskusji.set(id, { nazwa: nazwaPliku, mime });
    return id;
  }

  // ── Przesyłki ostatnich zamówień (0.105.0) ─────────────────────────────────

  async zamowieniaKupujacego(kto: KupujacyRef, limit = 3): Promise<ZamowienieKupujacego[]> {
    const klucze = [normalizujRef(kto.login), normalizujRef(kto.id)].filter(
      (k): k is string => k !== null
    );
    const wpis = ZAMOWIENIA_KUPUJACYCH.find((z) => klucze.includes(z.ref));
    return (wpis?.zamowienia ?? []).slice(0, limit);
  }

  async przesylkiZamowienia(orderId: string): Promise<PrzesylkaZamowienia[]> {
    return PRZESYLKI_DEV[orderId] ?? [];
  }

  async sledzeniePrzesylki(_przewoznikId: string, waybill: string): Promise<ZdarzenieSledzenia[]> {
    return SLEDZENIE_DEV[waybill] ?? [];
  }
}

/* Zamówienia i przesyłki zestrojone z wątkami pytań (`WATKI_PYTAN`):
   44300101 (autor dev-pyt-1) ma zamówienie WYSŁANE ze śledzeniem i starsze
   DORĘCZONE; 44300104 (dev-pyt-4 — pytanie o wysyłkę) ma zamówienie dopiero
   W PRZYGOTOWANIU, bez paczek — demo uczciwego „jeszcze nie nadane". */
const ZAMOWIENIA_KUPUJACYCH: Array<{ ref: string; zamowienia: ZamowienieKupujacego[] }> = [
  {
    ref: "44300101",
    zamowienia: [
      {
        id: "dev-ship-ord-1",
        kupionoAt: dniTemu(2),
        status: "READY_FOR_PROCESSING",
        wysylka: "SENT",
        dostawaMetoda: "InPost Paczkomaty 24/7",
        smart: true,
        dostawaOd: null,
        dostawaDo: null,
        pozycje: [
          { offerId: "of-1", nazwa: "Pozycja jeszcze nietknięta — oferta Allegro", externalId: "TEST-LINIA-TODO", ilosc: 1 },
        ],
      },
      {
        id: "dev-ship-ord-2",
        kupionoAt: dniTemu(12),
        status: "READY_FOR_PROCESSING",
        wysylka: "PICKED_UP",
        dostawaMetoda: "Kurier DPD",
        smart: false,
        dostawaOd: null,
        dostawaDo: null,
        pozycje: [
          { offerId: "of-3", nazwa: "Szybkorotujący poza strefą złotą — oferta Allegro", externalId: "TEST-ROTUJACY", ilosc: 2 },
        ],
      },
    ],
  },
  {
    ref: "44300104",
    zamowienia: [
      {
        id: "dev-ship-ord-3",
        kupionoAt: dniTemu(1),
        status: "READY_FOR_PROCESSING",
        wysylka: "PROCESSING",
        dostawaMetoda: "Kurier InPost",
        smart: false,
        dostawaOd: null,
        dostawaDo: null,
        pozycje: [
          { offerId: "of-2", nazwa: "Pozycja odłożona w całości — oferta Allegro", externalId: "TEST-LINIA-DONE", ilosc: 1 },
        ],
      },
    ],
  },
  {
    ref: "jan_wraca",
    zamowienia: [
      {
        id: "dev-ord-1",
        kupionoAt: dniTemu(3),
        status: "READY_FOR_PROCESSING",
        wysylka: "SENT",
        dostawaMetoda: "InPost Paczkomaty 24/7",
        smart: true,
        dostawaOd: null,
        dostawaDo: null,
        pozycje: [
          { offerId: "of-1", nazwa: "Pozycja jeszcze nietknięta — oferta Allegro", externalId: "TEST-LINIA-TODO", ilosc: 1 },
        ],
      },
    ],
  },
];

const PRZESYLKI_DEV: Record<string, PrzesylkaZamowienia[]> = {
  "dev-ship-ord-1": [
    { waybill: "DEVSHIP0101", przewoznikId: "INPOST", przewoznik: "InPost", nadanoAt: dniTemu(2) },
  ],
  "dev-ship-ord-2": [
    { waybill: "DEVSHIP0102", przewoznikId: "DPD", przewoznik: "DPD", nadanoAt: dniTemu(11) },
  ],
  "dev-ord-1": [
    { waybill: "DEVSHIP0001", przewoznikId: "INPOST", przewoznik: "InPost", nadanoAt: dniTemu(2) },
  ],
};

const SLEDZENIE_DEV: Record<string, ZdarzenieSledzenia[]> = {
  DEVSHIP0101: [
    { kod: "SENT", opis: "Przesyłka nadana", at: dniTemu(2) },
    { kod: "OUT_FOR_DELIVERY", opis: "Przesyłka w doręczeniu", at: dniTemu(0) },
  ],
  DEVSHIP0001: [{ kod: "SENT", opis: "Przesyłka nadana", at: dniTemu(2) }],
};

/* Rozmowy dyskusji zestrojone z `listaDyskusji()`. Druga sprawa niesie głos
   ALLEGRO_ADVISOR (trzecia rola w rozmowie), trzecia — naszą starą odpowiedź
   w sprawie już zamkniętej. */
const ROZMOWY_DYSKUSJI: Record<string, WiadomoscDyskusji[]> = {
  "dev-issue-1": [
    {
      id: "dev-dysk-1-1",
      odNas: false,
      autorLogin: "jan_wraca",
      autorRola: "BUYER",
      tresc: "Dzień dobry, w zestawie brakuje śruby mocującej M6. Czy mogą Państwo dosłać?",
      at: dniTemu(2),
      zalacznik: null,
    },
    {
      id: "dev-dysk-1-2",
      odNas: false,
      autorLogin: "jan_wraca",
      autorRola: "BUYER",
      tresc: "Dodaję zdjęcie zawartości pudełka.",
      at: dniTemu(1),
      zalacznik: { nazwa: "pudelko.jpg", url: null },
    },
  ],
  "dev-issue-2": [
    {
      id: "dev-dysk-2-1",
      odNas: false,
      autorLogin: "ewa_oddaje",
      autorRola: "BUYER",
      tresc: "Obudowa pękła po tygodniu normalnego użytkowania. Żądam wymiany albo zwrotu.",
      at: dniTemu(1),
      zalacznik: null,
    },
    {
      id: "dev-dysk-2-2",
      odNas: false,
      autorLogin: null,
      autorRola: "ALLEGRO_ADVISOR",
      tresc: "Prosimy sprzedawcę o ustosunkowanie się do reklamacji w terminie.",
      at: dniTemu(1),
      zalacznik: null,
    },
  ],
  "dev-issue-3": [
    {
      id: "dev-dysk-3-1",
      odNas: false,
      autorLogin: "firma_x",
      autorRola: "BUYER",
      tresc: "Proszę o zwrot kosztów wysyłki zwrotnej.",
      at: dniTemu(6),
      zalacznik: null,
    },
    {
      id: "dev-dysk-3-2",
      odNas: true,
      autorLogin: "wertis",
      autorRola: "SELLER",
      tresc: "Zwrot kosztów wykonany — przepraszamy za kłopot.",
      at: dniTemu(5),
      zalacznik: null,
    },
  ],
};

/* Opinie demo (0.135.0) — zestrojone z zamówieniami wyżej, żeby sprawa
   sklejała się po numerze zamówienia. Jedna zła (dopina się do dyskusji
   dev-ord-2), jedna dobra i jedna bez zamówienia. */
const OPINIE_DEV: OpiniaAllegro[] = [
  {
    id: "dev-op-1",
    orderId: "dev-ord-2",
    kupujacyLogin: "ewa_oddaje",
    ocena: 1,
    rekomendacja: "NEGATIVE",
    tresc: "Towar przyszedł uszkodzony, a na wiadomość czekałam trzy dni.",
    odpowiedz: null,
    utworzono: dniTemu(1),
    mozliwaOdpowiedz: true,
  },
  {
    id: "dev-op-2",
    orderId: "dev-ord-1",
    kupujacyLogin: "jan_wraca",
    ocena: 5,
    rekomendacja: "POSITIVE",
    tresc: "Szybka wysyłka, wszystko zgodne z opisem.",
    odpowiedz: "Dziękujemy!",
    utworzono: dniTemu(6),
    mozliwaOdpowiedz: false,
  },
  {
    id: "dev-op-3",
    orderId: null,
    kupujacyLogin: "firma_x",
    ocena: 3,
    rekomendacja: "NEUTRAL",
    tresc: null,
    odpowiedz: null,
    utworzono: dniTemu(20),
    mozliwaOdpowiedz: true,
  },
];
