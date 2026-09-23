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

   ZAMIEŃ PAMIĘTA SIĘ PER TOWAR, DODAJ — PER PARA (audyt z 22 września 2026).
   Do tej wersji obie decyzje szły per para adresów, bez towaru. ZAMIEŃ
   podjęte dla towaru X zastępowało więc adres towaru Y z tą samą parą półek,
   a jedynym śladem był toast na 2,6 s. ZAMIEŃ kasuje adres pickingowy, więc
   powtórzone za człowieka o CUDZYM towarze jest cichą pomyłką adresową.
   DODAJ niczego nie kasuje — najgorszy skutek to adres nadmiarowy — i ono
   dalej oszczędza dziesięć pytań przy dziesięciu pozycjach z kartonu.
   Cena jest jawna: przeprowadzka całej półki pyta ZAMIEŃ raz na towar.

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
    /** ZAMIEŃ — per towar i para adresów; kasuje adres, więc nie przechodzi na inny towar. */
    private val zamien = mutableSetOf<Triple<Long, String, String>>()

    /** DODAJ — per para adresów, dla każdego towaru z tego kartonu. */
    private val dodaj = mutableSetOf<Pair<String, String>>()

    /**
     * @param twId towar, którego dotyczy zapis — patrz nagłówek pliku
     * @param oczekiwana adres z kartoteki; `null` albo pusty = kartoteka nie wie,
     *   a wtedy nie ma z czym się rozjechać
     * @param zeskanowana adres, który magazynier właśnie podał
     */
    fun rozstrzygnij(twId: Long, oczekiwana: String?, zeskanowana: String): DecyzjaRozjazdu = when {
        oczekiwana.isNullOrBlank() || oczekiwana == zeskanowana -> DecyzjaRozjazdu.Zgodna
        Triple(twId, oczekiwana, zeskanowana) in zamien -> DecyzjaRozjazdu.Powtorz(LocApplyAction.REPLACE)
        (oczekiwana to zeskanowana) in dodaj -> DecyzjaRozjazdu.Powtorz(LocApplyAction.ADD)
        else -> DecyzjaRozjazdu.Zapytaj
    }

    /** Odpowiedź człowieka — obowiązuje do końca tej dostawy, w zakresie z nagłówka. */
    fun zapamietaj(twId: Long, oczekiwana: String?, zeskanowana: String, akcja: LocApplyAction) {
        if (oczekiwana.isNullOrBlank()) return
        val klucz = Triple(twId, oczekiwana, zeskanowana)
        when (akcja) {
            LocApplyAction.REPLACE -> zamien.add(klucz)
            // zmiana zdania dla TEGO towaru: DODAJ zdejmuje jego ZAMIEŃ
            LocApplyAction.ADD -> {
                zamien.remove(klucz)
                dodaj.add(oczekiwana to zeskanowana)
            }
        }
    }
}
