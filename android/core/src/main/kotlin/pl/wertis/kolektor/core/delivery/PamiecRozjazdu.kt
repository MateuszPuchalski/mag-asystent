package pl.wertis.kolektor.core.delivery

import pl.wertis.kolektor.core.net.LocApplyAction

/* ── Rozjazd lokalizacji: pytać czy powtórzyć poprzednią odpowiedź ──────────
   Kartoteka mówi A01-02-03, magazynier skanuje B02-01-01. Zapis STOI i pyta:
   ZAMIEŃ czy DODAJ. Serwer tego nie zgadnie — nie wie, czy towar przeniesiono,
   czy leży teraz w dwóch miejscach (§4.3). To pytanie zostaje.

   Ale dziesięć pozycji z jednego kartonu jedzie na tę samą „inną" półkę
   i pytanie padało dziesięć razy. Identyczna odpowiedź dziesiąty raz przestaje
   być decyzją, a staje się przeszkodą w rytmie.

   Pamięć jest PER PARA oczekiwana→zeskanowana, nie per dostawa: inny rozjazd
   to inna decyzja i musi zapytać. I UMIERA RAZEM Z DOSTAWĄ — to rozstrzygnięcie
   o TYM kartonie, nie reguła magazynu.

   Zwykła mapa, bez `mutableStateMapOf`: nic nie czyta jej podczas komponowania
   (zapis idzie z callbacku wiersza, odczyt z korutyny zapisu), więc stan
   Compose'a kupowałby tu wyłącznie zależność od Androida — i wypchnięcie tej
   reguły poza zasięg testów.                                                  */

/** Co zrobić z zeskanowanym adresem, zanim pójdzie zapis. */
sealed interface DecyzjaRozjazdu {
    /** Adres się zgadza albo kartoteka go nie zna — zapis idzie bez pytania. */
    data object Zgodna : DecyzjaRozjazdu

    /**
     * Tę parę już rozstrzygnięto w tej dostawie — powtarzamy automatem.
     *
     * Z TOASTEM po stronie ekranu: automat, którego nie widać, jest cichą
     * decyzją za człowieka, a ta pierwsza była jego.
     */
    data class Powtorz(val akcja: LocApplyAction) : DecyzjaRozjazdu

    /** Nowy rozjazd — zapis czeka na człowieka. */
    data object Zapytaj : DecyzjaRozjazdu
}

class PamiecRozjazdu {
    private val decyzje = mutableMapOf<Pair<String, String>, LocApplyAction>()

    /**
     * @param oczekiwana adres z kartoteki; `null` albo pusty = kartoteka nie wie,
     *   a wtedy nie ma z czym się rozjechać
     * @param zeskanowana adres, który magazynier właśnie podał
     */
    fun rozstrzygnij(oczekiwana: String?, zeskanowana: String): DecyzjaRozjazdu = when {
        oczekiwana.isNullOrBlank() || oczekiwana == zeskanowana -> DecyzjaRozjazdu.Zgodna
        else -> decyzje[oczekiwana to zeskanowana]
            ?.let { DecyzjaRozjazdu.Powtorz(it) }
            ?: DecyzjaRozjazdu.Zapytaj
    }

    /** Odpowiedź człowieka — obowiązuje do końca tej dostawy, dla tej pary. */
    fun zapamietaj(oczekiwana: String?, zeskanowana: String, akcja: LocApplyAction) {
        if (oczekiwana.isNullOrBlank()) return
        decyzje[oczekiwana to zeskanowana] = akcja
    }
}
