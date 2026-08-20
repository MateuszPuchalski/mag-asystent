package pl.wertis.kolektor.core.delivery

/* ── Czy stan w systemie zgadza się z ilością z dokumentu ────────────────────
   Ze zgłoszenia: „jeśli ilość z dostawy różni się z ilością na magazynie,
   dodaj jakiś indykator".

   Pytanie, na które to odpowiada, magazynier zadaje sobie z kartonem w ręce:
   „czy to, co niosę, to wszystko, co system tu widzi". Do 0.62.0 stan i ilość
   stały obok siebie jako dwie liczby i porównanie zostawało w głowie.

   Z KTÓRYM stanem porównujemy, rozstrzyga sposób zaksięgowania dostawy:

   • dostawa krajowa idzie wprost na MAG, więc `stanMag` ZAWIERA już niesioną
     partię — nadwyżka ponad dokument to zapas sprzed tej dostawy;
   • kontener stoi na MGP do czasu przesunięcia, więc partia siedzi w `stanMgp`,
     a `stanMag` mówi wyłącznie o tym, co leżało wcześniej.

   Porównanie z niewłaściwym magazynem dawałoby różnicę przy każdej pozycji
   i wskaźnik zrobiłby się tłem, które nikt nie czyta.

   DWA POZIOMY, BO ZNACZĄ CO INNEGO. Nadwyżka jest informacją: przy regale
   leży już zapas i nie zaczynasz od zera. Niedobór jest ostrzeżeniem: system
   widzi MNIEJ, niż mówi dokument, więc towar zszedł, zanim ktokolwiek go
   rozłożył — albo dokument nie jest tym, czym się wydaje. Jedno i drugie
   w tym samym kolorze kazałoby człowiekowi rozstrzygać, co właśnie zobaczył. */

/** Kierunek rozbieżności — nadwyżka informuje, niedobór ostrzega. */
enum class KierunekRozbieznosci { NADWYZKA, NIEDOBOR }

/**
 * @param roznica ZAWSZE dodatnia; kierunek niesie osobne pole, żeby warstwa
 *   rysująca nie musiała pamiętać o znaku przy formatowaniu.
 */
data class RozbieznoscStanu(
    val kierunek: KierunekRozbieznosci,
    val roznica: Double,
)

/**
 * Różnica między stanem w systemie a ilością z dokumentu.
 *
 * `null` = nie ma czego pokazywać: liczby się zgadzają albo pozycja nie ma
 * ilości z dokumentu (wiersz spoza faktury, na przykład artykuł niezamówiony).
 *
 * Zwracamy różnicę, a nie samą flagę, bo „nie zgadza się" bez liczby zmusza
 * do odejmowania w pamięci, stojąc przy regale.
 */
fun rozbieznoscStanu(
    qtyDoc: Double,
    stanMag: Double,
    stanMgp: Double,
    stanZawieraDostawe: Boolean,
): RozbieznoscStanu? {
    if (qtyDoc <= 0.0) return null
    val stan = if (stanZawieraDostawe) stanMag else stanMgp
    val roznica = stan - qtyDoc
    /* Próg zamiast `== 0.0`: ilości bywają ułamkowe (metry, litry), a błąd
       binarny na dwóch dodawaniach potrafi zapalić wskaźnik przy zgodnych
       liczbach. Poniżej tysięcznej nie ma o czym mówić w magazynie. */
    if (kotlin.math.abs(roznica) < 0.001) return null
    return RozbieznoscStanu(
        kierunek = if (roznica > 0) KierunekRozbieznosci.NADWYZKA else KierunekRozbieznosci.NIEDOBOR,
        roznica = kotlin.math.abs(roznica),
    )
}
