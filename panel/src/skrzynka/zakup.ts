import type { StanPrzesylki, Zamowienie } from "../api/typy";

/* ── CO WIEMY O ZAKUPIE, A CZEGO NIE ─────────────────────────────────────────
   Karta nad rozmową czyta fakty zakupu z jednego miejsca. Zdarzeń zakupu
   na osi rozmowy nie ma: złożone, opłacone, doręczone i inne sprawy mówi
   wyłącznie pasek drogi klienta.

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
