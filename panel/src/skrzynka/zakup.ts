import type { OsRozmowy, StanPrzesylki, WpisOsi, Zamowienie } from "../api/typy";

/* ── CO WIEMY O ZAKUPIE, A CZEGO NIE ─────────────────────────────────────────
   Karta nad rozmową i zdarzenia w osi czytają te same fakty z jednego miejsca,
   żeby pasek statusu i linie w osi nie mogły się rozjechać.

   CZEGO TU NIE MA, I TO JEST CAŁA RÓŻNICA WOBEC MAKIETY:

   „W realizacji" i „wysłane" ze statusu sprzedawcy Allegro. Serwer zapisuje
   `status` zamówienia z formularza zakupu (`BOUGHT`, `READY_FOR_PROCESSING`,
   `CANCELLED`), a pola `fulfillment.status` (`PROCESSING`, `SENT`) nie czyta w
   ogóle. Krok „nadane" bierzemy więc z tego, co mamy naprawdę: z numeru
   przesyłki. Daty też nie zgadujemy. Allegro nie podaje, kiedy sprzedawca
   zmienił status, więc „nadane" stoi bez daty, a „dostarczone" ma ją z
   trackingu przewoźnika.

   PRZESYŁKI NIE SPRAWDZAMY PRZY OTWARCIU. Odpytanie przewoźnika to zapis i
   koszt w limicie Allegro, robione na jawne kliknięcie (`przesylka-zamowienia`).
   „Nieznane" znaczy więc „jeszcze nie pytaliśmy", a nie „nie wysłano". Ekran
   ma tę różnicę powiedzieć, bo to dwa różne następne ruchy agenta.            */

export type KlucKroku = "zlozone" | "oplacone" | "nadane" | "dostarczone";
export type StanKroku = "tak" | "nie" | "nieznane";

export interface KrokZakupu {
  klucz: KlucKroku;
  etykieta: string;
  stan: StanKroku;
  /** ISO, gdy znamy datę. */
  at: string | null;
  /** Zdanie dla `title`, gdy krok jest nieznany albo wymaga wyjaśnienia. */
  uwaga: string | null;
}

export interface StanZakupu {
  kroki: KrokZakupu[];
  anulowane: boolean;
  /** Nikt jeszcze nie sprawdzał przewoźnika dla tego zamówienia. */
  przesylkaNieSprawdzona: boolean;
}

export function stanZakupu(z: Zamowienie, przesylka: StanPrzesylki | null): StanZakupu {
  const anulowane = z.status === "CANCELLED";
  const sprawdzona = Boolean(przesylka?.sprawdzonoAt);
  const pobranie = z.platnoscTyp === "CASH_ON_DELIVERY";

  const oplacone: KrokZakupu = pobranie
    ? { klucz: "oplacone", etykieta: "Za pobraniem", stan: "nieznane", at: null,
        uwaga: "Płatność przy odbiorze — nie ma daty wpłaty." }
    : z.platnoscAt || z.status === "READY_FOR_PROCESSING"
      ? { klucz: "oplacone", etykieta: "Opłacone", stan: "tak", at: z.platnoscAt, uwaga: null }
      : { klucz: "oplacone", etykieta: "Opłacone", stan: "nie", at: null, uwaga: null };

  const nadane: KrokZakupu = przesylka?.waybill
    ? { klucz: "nadane", etykieta: "Nadane", stan: "tak", at: null,
        uwaga: "Jest numer przesyłki. Allegro nie podaje daty nadania." }
    : sprawdzona
      ? { klucz: "nadane", etykieta: "Nadane", stan: "nie", at: null, uwaga: null }
      : { klucz: "nadane", etykieta: "Nadane", stan: "nieznane", at: null,
          uwaga: "Przesyłki jeszcze nie sprawdzano." };

  const dostarczone: KrokZakupu = przesylka?.dostarczonoAt
    ? { klucz: "dostarczone", etykieta: "Dostarczone", stan: "tak", at: przesylka.dostarczonoAt, uwaga: null }
    : przesylka?.waybill
      ? { klucz: "dostarczone", etykieta: "Dostarczone", stan: "nie", at: null, uwaga: null }
      : { klucz: "dostarczone", etykieta: "Dostarczone", stan: sprawdzona ? "nie" : "nieznane", at: null,
          uwaga: sprawdzona ? null : "Przesyłki jeszcze nie sprawdzano." };

  return {
    anulowane,
    przesylkaNieSprawdzona: !sprawdzona,
    kroki: [
      { klucz: "zlozone", etykieta: "Złożone", stan: "tak", at: z.kupionoAt, uwaga: null },
      oplacone, nadane, dostarczone,
    ],
  };
}

const ETYKIETA_DROGI: Record<string, string> = {
  dyskusja: "Dyskusja otwarta", reklamacja: "Reklamacja otwarta",
  zwrot: "Zwrot zgłoszony", rozmowa: "Inna rozmowa o tym zakupie",
};
const SCIEZKA_DROGI: Record<string, string> = {
  dyskusja: "dyskusje", reklamacja: "reklamacje", zwrot: "zwroty", rozmowa: "skrzynka",
};

const wazne = (v: string | null | undefined): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));

/**
 * Zdarzenia zakupu jako wpisy osi: złożone, opłacone, dostarczone oraz zwroty,
 * reklamacje, dyskusje i inne rozmowy o tym zakupie. Nie dokładamy „nadane":
 * nie ma daty, a linia bez miejsca na osi czasu nie ma gdzie stać.
 */
export function zdarzeniaZakupu(dane: Pick<OsRozmowy, "rozmowa" | "zamowienie" | "droga">): WpisOsi[] {
  const wpisy: WpisOsi[] = [];
  const dodaj = (id: string, tresc: string, at: string | null | undefined, adres?: string) => {
    if (!wazne(at)) return;
    wpisy.push({ id: `zakup:${id}`, rodzaj: "zakup", autor: "", odKlienta: false, tresc, at, ofertaId: null,
      ...(adres ? { adres } : {}) });
  };
  const z = dane.zamowienie?.pobrane ?? null;
  if (z) {
    dodaj("zlozone", `Zamówienie ${z.externalId} złożone`, z.kupionoAt);
    if (z.platnoscTyp !== "CASH_ON_DELIVERY") dodaj("oplacone", "Zamówienie opłacone", z.platnoscAt);
    dodaj("dostarczone", "Paczka dostarczona", dane.zamowienie?.przesylka?.dostarczonoAt);
  }
  /* `?? []`: starsza odpowiedź albo atrapa bez drogi zakupu to brak zdarzeń, nie wyjątek
     w ekranie, na którym agent odpisuje klientowi. */
  for (const p of dane.droga ?? []) {
    if (p.rodzaj === "rozmowa" && p.id === dane.rozmowa.id) continue;
    const etykieta = ETYKIETA_DROGI[p.rodzaj] ?? p.rodzaj;
    dodaj(`${p.rodzaj}-${p.id}`, p.opis ? `${etykieta}: ${p.opis}` : etykieta, p.at,
      `/obsluga/${SCIEZKA_DROGI[p.rodzaj] ?? p.rodzaj}/${p.id}`);
  }
  return wpisy;
}

/**
 * Wsuwa zdarzenia do osi w kolejności czasu. Wpisy osi zostają w swojej
 * kolejności (serwer sortuje po identyfikatorze wiadomości), a zdarzenie
 * ląduje przed pierwszym wpisem NOWSZYM od siebie. Stabilne: dwa zdarzenia
 * z tej samej chwili zostają w kolejności, w jakiej przyszły.
 */
export function scalOs(os: WpisOsi[], zdarzenia: WpisOsi[]): WpisOsi[] {
  if (zdarzenia.length === 0) return os;
  const posortowane = [...zdarzenia].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const wynik: WpisOsi[] = [];
  let k = 0;
  for (const w of os) {
    const t = Date.parse(w.at);
    while (k < posortowane.length && Date.parse(posortowane[k].at) <= t) wynik.push(posortowane[k++]);
    wynik.push(w);
  }
  while (k < posortowane.length) wynik.push(posortowane[k++]);
  return wynik;
}
