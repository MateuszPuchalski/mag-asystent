package pl.wertis.kolektor.core.cache

import pl.wertis.kolektor.core.net.DeliveryDocumentsResponse
import pl.wertis.kolektor.core.net.DeliveryView
import pl.wertis.kolektor.core.net.MovementEntry
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.net.ProductRow

/* ── Ostatnie znane odpowiedzi odczytów — stale-while-revalidate ────────────
   Ekrany nie mają stosu ani ViewModeli: wyjście niszczy kompozycję razem ze
   wszystkim, co pobrała. Powrót na kartę oglądaną sekundę temu zaczynał się
   od „Wczytywanie…", a skan — mimo że odpowiedź /scan NIESIE całą kartę —
   czekał na drugie żądanie o to samo.

   To repozytorium trzyma ostatnią znaną odpowiedź per klucz, żeby ekran mógł
   ją narysować OD RAZU, podczas gdy jego zwykłe odpytywanie (pollFlow co 2 s)
   dociąga świeżą. Wpis stąd nigdy nie jest końcem — zawsze jest posiewem
   pod trwającą rewalidację, więc stany magazynowe nie są starsze niż jeden
   cykl odpytywania.

   CELOWO tylko w pamięci: liczby sztuk nie mają przeżyć restartu aplikacji
   (trwały zapas na offline ma wyłącznie słownik lokalizacji, który nie
   kłamie po godzinie). Czyszczone przy zmianie adresu serwera.              */

class CardsRepository {
    private val cards = lru<Long, ProductCard>(30)
    private val locations = lru<String, List<ProductRow>>(30)
    private val history = lru<Long, List<MovementEntry>>(30)
    private val deliveries = lru<Long, DeliveryView>(10)
    private var documents: DeliveryDocumentsResponse? = null

    @Synchronized fun putCard(card: ProductCard) { cards[card.id] = card }
    @Synchronized fun peekCard(id: Long): ProductCard? = cards[id]

    @Synchronized fun putLocation(code: String, rows: List<ProductRow>) { locations[norm(code)] = rows }
    @Synchronized fun peekLocation(code: String): List<ProductRow>? = locations[norm(code)]

    @Synchronized fun putHistory(id: Long, entries: List<MovementEntry>) { history[id] = entries }
    @Synchronized fun peekHistory(id: Long): List<MovementEntry>? = history[id]

    @Synchronized fun putDelivery(id: Long, view: DeliveryView) { deliveries[id] = view }
    @Synchronized fun peekDelivery(id: Long): DeliveryView? = deliveries[id]

    @Synchronized fun putDocuments(docs: DeliveryDocumentsResponse) { documents = docs }
    @Synchronized fun peekDocuments(): DeliveryDocumentsResponse? = documents

    /** Inny serwer = inny magazyn; stara odpowiedź to odpowiedź o czymś innym. */
    @Synchronized fun clear() {
        cards.clear()
        locations.clear()
        history.clear()
        deliveries.clear()
        documents = null
    }

    // ten sam kształt klucza co w nawigacji (AppNavState.openLocation)
    private fun norm(code: String) = code.trim().uppercase()

    private fun <K, V> lru(max: Int): LinkedHashMap<K, V> =
        object : LinkedHashMap<K, V>(16, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>): Boolean = size > max
        }
}
