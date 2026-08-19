import type { AllegroAdapter, ZamowienieAllegro, ZwrotAllegro } from "./allegro.js";

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
    kupujacyEmail: "jan.wraca@example.com",
    pozycje: [
      { offerId: "of-1", nazwa: "Pozycja jeszcze nietknięta — oferta Allegro", externalId: "TEST-LINIA-TODO", ilosc: 1 },
      { offerId: "of-2", nazwa: "Pozycja odłożona w całości — oferta Allegro", externalId: "TEST-LINIA-DONE", ilosc: 2 },
    ],
  },
  "dev-ord-2": {
    id: "dev-ord-2",
    kupujacyLogin: "ewa_oddaje",
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
    kupujacyEmail: null,
    pozycje: [
      { offerId: "of-4", nazwa: "Artykuł sprzedany poza kartoteką WERTIS", externalId: "SPOZA-KATALOGU", ilosc: 1 },
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

  async zwrot(id: string): Promise<ZwrotAllegro | null> {
    return zwroty().find((z) => z.id === id) ?? null;
  }

  async zamowienie(orderId: string): Promise<ZamowienieAllegro | null> {
    return ZAMOWIENIA[orderId] ?? null;
  }
}
