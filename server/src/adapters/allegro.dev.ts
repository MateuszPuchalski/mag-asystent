import type {
  AllegroAdapter,
  DyskusjaAllegro,
  KupujacyRef,
  SzukanieWatku,
  WatekAllegro,
  ZamowienieAllegro,
  ZwrotAllegro,
} from "./allegro.js";
import { normalizujRef } from "./allegro.http.js";

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
      },
      {
        id: "dev-msg-2",
        odKupujacego: false,
        autor: "wertis",
        tresc: "Dzień dobry, przepraszamy za pomyłkę. Prosimy o odesłanie — zwrot środków po sprawdzeniu towaru.",
        at: dniTemu(4),
        zalacznikow: 0,
      },
      {
        id: "dev-msg-3",
        odKupujacego: true,
        autor: "jan_wraca",
        tresc: "Nadane, numer przesyłki DEVWB0001.",
        at: dniTemu(3),
        zalacznikow: 0,
      },
    ],
  },
};

export class DevAllegroAdapter implements AllegroAdapter {
  async szukajZwrotowPoWaybill(waybill: string): Promise<ZwrotAllegro[]> {
    const kod = waybill.trim();
    return zwroty().filter((z) =>
      z.paczki.some((p) => p.waybill === kod || p.transportingWaybill === kod)
    );
  }

  async listaDyskusji(): Promise<DyskusjaAllegro[]> {
    /* Dwie fikcyjne sprawy — rozmowa i formalna reklamacja — żeby sekcja
       w biurze miała oba typy do pokazania. */
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
    ];
  }

  async listaZwrotowKlienta(odKiedy: string | null): Promise<ZwrotAllegro[]> {
    const granica = odKiedy ? Date.parse(odKiedy) : NaN;
    return zwroty().filter(
      (z) => !Number.isFinite(granica) || Date.parse(z.utworzono ?? "") >= granica
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
}
