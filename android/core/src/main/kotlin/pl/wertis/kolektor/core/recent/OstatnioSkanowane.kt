package pl.wertis.kolektor.core.recent

import kotlinx.serialization.Serializable

/* ── „Ostatnio skanowane" na ekranie głównym ────────────────────────────────
   Cztery pozycje, do których wraca się po chwili — „ten towar sprzed dwóch
   minut". Lista jest MIGAWKĄ: wpis powstaje przy otwarciu karty i zapisuje
   adres, jaki towar miał WTEDY.

   I dokładnie tam się psuła. Magazynier wyszukiwał towar, wchodził na kartę,
   skanował półkę — adres na karcie się zmieniał — po czym wracał na ekran
   główny i widział pod „Ostatnio skanowane" adres SPRZED zmiany. Karta mówiła
   jedno, lista drugie, i nic na ekranie nie tłumaczyło, które jest prawdą.
   Wpis dożywał tak do czterech kolejnych otwarć.

   Reguły siedzą tutaj, a nie w `RecentStore`, bo tamten ma `Context`
   i `SharedPreferences`, czyli nie da się go uruchomić w teście JVM — a moduł
   `:app` nie ma żadnych testów. `RecentStore` zostaje wyłącznie zapisem
   do preferencji.                                                            */

/** Ile pozycji trzyma lista. Cztery mieszczą się na ekranie bez przewijania. */
const val OSTATNIE_SZTUK = 4

/**
 * Etykieta adresu dla towaru, który go nie ma.
 *
 * Stała, nie literał w pięciu miejscach: pusty adres pisał się dotąd z ręki
 * przy każdym wywołaniu i wystarczyła jedna literówka, żeby ta sama sytuacja
 * nazywała się na ekranie dwiema różnymi rzeczami.
 */
const val BRAK_ADRESU = "brak lokalizacji"

/** `name` z domyślną wartością — wpisy zapisane przed jej dodaniem wciąż się wczytują. */
@Serializable
data class RecentEntry(val id: Long, val sym: String, val loc: String, val name: String = "")

/** Adres na listę: pusty kod to nie pusty tekst, tylko zdanie „nie ma adresu". */
fun etykietaAdresu(kod: String?): String = kod?.takeIf { it.isNotBlank() } ?: BRAK_ADRESU

/**
 * Nowe otwarcie na wierzch listy; ten sam towar nie dubluje się, tylko wraca
 * na pierwsze miejsce ze świeżymi danymi.
 */
fun dopisz(lista: List<RecentEntry>, wpis: RecentEntry): List<RecentEntry> =
    (listOf(wpis) + lista.filter { it.id != wpis.id }).take(OSTATNIE_SZTUK)

/**
 * Odświeża wpis, który JUŻ jest na liście — po zmianie adresu na karcie.
 *
 * Nie dodaje i nie przestawia kolejności. Kolejność mówi „co trzymałem
 * w ręku, licząc od najświeższego" i samo zaglądanie na kartę nie ma jej
 * przestawiać — inaczej lista przeskakiwałaby pod kciukiem magazynierowi,
 * który dopiero celuje w drugą pozycję. Towar spoza listy też się na nią nie
 * wprosi: ekran, który świadomie nie zapisał otwarcia (na przykład wejście
 * w zamiennik z cudzej karty), nie ma tego robić tylnymi drzwiami.
 *
 * Pusta nazwa NIE nadpisuje znanej: to znaczy „nie wiem", a nie „nazwa
 * zniknęła" — kliknięcie w pozycję listy przekazuje dalej tylko tyle, ile sama
 * pozycja niesie.
 *
 * Zwraca TĘ SAMĄ listę, gdy nic się nie zmieniło. Karta odpytuje serwer co 2 s,
 * więc bez tego każde odpytanie pisałoby do `SharedPreferences` to samo.
 */
fun odswiez(lista: List<RecentEntry>, id: Long, loc: String, name: String): List<RecentEntry> {
    if (lista.none { it.id == id }) return lista
    val next = lista.map {
        if (it.id == id) it.copy(loc = loc, name = name.ifBlank { it.name }) else it
    }
    return if (next == lista) lista else next
}
