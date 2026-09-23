import type { Kategoria } from "./klasyfikacja-slownik.js";

/* ── Wzorzec odpowiedzi dla rozpoznanej kategorii (23 września 2026) ────────
   Zgłoszenie właściciela: „gdy pytanie jest sklasyfikowane, ułóż odpowiedź
   odpowiednio do tego". Szkic dostawał rozpoznanie od 22 września, ale
   z jedną ogólną regułą: „odpowiadaj na tę prośbę". Model sam zgadywał, jak
   wygląda dobra odpowiedź o fakturę albo zaginioną paczkę — i przy każdej
   kategorii zgadywał inaczej.

   JEDEN WZORZEC NA KATEGORIĘ, W FAKCIE ROZPOZNANIA, nie piętnaście w instrukcji.
   Model czyta tylko ten, który dotyczy bieżącej prośby. Czternaście obcych
   wzorców w instrukcji byłoby czternastoma okazjami, żeby odpowiedź o paczkę
   zapożyczyła zdanie z odpowiedzi o reklamację. Instrukcja zostaje stała,
   więc jej prefiks dalej trafia w cache dostawcy.

   `Record<Kategoria, string>`: kategoria dopisana do słownika bez wzorca się
   nie skompiluje. To ta sama zasada co przy polskich nazwach w panelu.

   Wzorzec NIE ROZSTRZYGA SPRAWY. Zwrot pieniędzy, wymianę, uznanie reklamacji
   i anulowanie robi człowiek, więc każdy wzorzec, który o nie zahacza, mówi
   „nie obiecuj". Terminów, kosztów i kwot z siebie też nie podaje — polityka
   sklepu nie stoi w faktach, a zmyślona byłaby zobowiązaniem. */

export const WZORCE_ODPOWIEDZI: Record<Kategoria, string> = {
  ORDER_STATUS:
    "podaj stan zamówienia i przesyłki z faktów (status, przewoźnik, numer listu); "
    + "gdy faktu o przesyłce nie ma, napisz, że sprawdzamy, bez daty; o maszynę ani część nie pytaj",
  DELIVERY_DELAY:
    "powiedz, gdzie jest paczka według faktu o przesyłce, i krótko przeproś za zwłokę; "
    + "daty doręczenia nie obiecuj i nie obwiniaj przewoźnika z siebie; "
    + "gdy paczka stoi bez ruchu, napisz, że sprawdzimy to u przewoźnika",
  DELIVERY_LOST:
    "zaginięcia nie potwierdzaj z siebie — podaj ostatni stan przesyłki z faktów "
    + "i napisz, że wyjaśniamy to z przewoźnikiem; ponownej wysyłki ani zwrotu pieniędzy nie obiecuj",
  DELIVERY_DAMAGED:
    "przeproś i poproś o zdjęcia paczki oraz uszkodzonej części, jeśli ich nie ma w rozmowie, "
    + "a także o protokół szkody, gdy był spisany przy kurierze; wymiany ani zwrotu pieniędzy nie obiecuj",
  PRODUCT_COMPATIBILITY:
    "odpowiedz wprost, czy część pasuje, z faktów doboru, kartoteki i listy zgodności oferty; "
    + "gdy fakty nie rozstrzygają, zapytaj tylko o to, co rozstrzyga (model, tabliczka, numer starej części)",
  PRODUCT_QUESTION:
    "odpowiedz na pytanie o parametr, wymiar albo zawartość z kartoteki i oferty; "
    + "czego nie ma w faktach, nie zgaduj — napisz, że sprawdzimy",
  PRODUCT_AVAILABILITY:
    "podaj dostępność na dziś tak, jak stoi w fakcie o stanie, bez terminu przyszłej dostawy; "
    + "gdy części nie ma, zaproponuj kandydata z faktów, jeśli jest",
  WRONG_PRODUCT:
    "przeproś i poproś o zdjęcie otrzymanej części i etykiety z paczki, jeśli ich nie ma; "
    + "porównaj z tym, co zamówiono, według faktów; wymiany ani zwrotu nie obiecuj",
  MISSING_PRODUCT:
    "poproś o zdjęcie zawartości paczki, jeśli go nie ma, i wymień, czego według zamówienia brakuje; "
    + "dosyłki nie obiecuj, zanim sprawdzi to magazyn",
  DAMAGED_PRODUCT:
    "poproś o zdjęcia uszkodzenia i zapytaj jednym zdaniem, czy było przy odbiorze, "
    + "czy powstało przy montażu albo pracy; sposobu naprawy ani zwrotu pieniędzy nie obiecuj",
  RETURN:
    "wskaż zwrot przez Allegro, w „Moje zakupy” przy tym zamówieniu; terminów, kosztu odesłania "
    + "ani kwoty zwrotu nie podawaj z siebie; gdy klient chce wymiany, zapytaj, na jaką część",
  COMPLAINT:
    "przyjmij zgłoszenie rzeczowo i poproś o opis usterki oraz zdjęcia, jeśli ich nie ma; "
    + "reklamacji nie uznawaj ani nie odrzucaj w wiadomości — werdykt wydaje człowiek",
  CANCEL_ORDER:
    "sprawdź w faktach, czy paczka już wyszła: gdy nie, napisz, że przekazujemy prośbę "
    + "o anulowanie i potwierdzimy; gdy wyszła, wyjaśnij, że anulować się nie da, i wskaż zwrot "
    + "po odbiorze; samego anulowania nie potwierdzaj",
  INVOICE:
    "gdy klient prosi o fakturę, poproś tylko o te dane, których brakuje w rozmowie (nazwa firmy, "
    + "NIP, adres); terminu wystawienia ani korekty nie obiecuj",
  OTHER:
    "odpowiedz krótko na to, o co klient pyta; gdy nie wiadomo, o co chodzi, zadaj jedno pytanie "
    + "doprecyzowujące",
};

/** Wzorzec dla kategorii z bazy; spoza słownika — `null`, bo wzorca nie zgadujemy. */
export function wzorzecOdpowiedzi(kategoria: string): string | null {
  /* `hasOwn`, nie samo indeksowanie: „toString" z prototypu nie jest kategorią. */
  return Object.hasOwn(WZORCE_ODPOWIEDZI, kategoria)
    ? (WZORCE_ODPOWIEDZI as Record<string, string>)[kategoria] : null;
}
