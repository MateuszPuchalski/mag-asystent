package pl.wertis.kolektor.net

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import pl.wertis.kolektor.core.net.ZnalezionySerwer
import pl.wertis.kolektor.core.net.zinterpretujOdpowiedz

/* ── Szukanie serwera rozgłoszeniem UDP ─────────────────────────────────────
   Kolektor pyta cały LAN „gdzie jest serwer WERTIS?", serwer odpowiada
   adresem. Lustro `server/src/services/odkrywanie.ts`.

   ZNALEZIONY ADRES NIE JEST USTAWIANY SAM. Odpowiedź przychodzi zwykłym UDP
   po sieci bez TLS-a, więc nic nie odróżnia serwera od cudzego urządzenia
   w tej samej sieci, które odpowiedziało szybciej. Ta funkcja zwraca WYNIK
   WYSZUKIWANIA; związanie kolektora z adresem jest decyzją człowieka na
   ekranie startowym (DEPLOY.md §4).                                          */

/** Napis rozpoznawczy — musi zgadzać się z `PYTANIE` po stronie serwera. */
private const val PYTANIE = "WERTIS-GDZIE-SERWER-1"

/**
 * Rozgłoszenie jest dopychane do 256 bajtów, bo serwer krótszych nie słucha.
 *
 * To nie jest wymóg formatu, tylko blokada wzmocnienia po tamtej stronie:
 * usługa odpowiadająca dłużej, niż ją pytano, jest wzmacniaczem do ataku na
 * kogoś trzeciego. Kolektora ten dopych nic nie kosztuje.
 */
private const val ROZMIAR_PYTANIA = 256

private const val PORT_ODKRYWANIA = 3002

/** Ile czekamy na odpowiedzi. Serwer w LAN odpowiada w kilkanaście ms. */
private const val NASLUCH_MS = 1500

/** Adresy rozgłoszeniowe wszystkich działających kart sieciowych. */
private fun adresyRozgloszeniowe(): List<InetAddress> {
    val wynik = mutableListOf<InetAddress>()
    runCatching {
        for (karta in NetworkInterface.getNetworkInterfaces()) {
            if (!karta.isUp || karta.isLoopback) continue
            for (adres in karta.interfaceAddresses) {
                adres.broadcast?.let { wynik.add(it) }
            }
        }
    }
    /* 255.255.255.255 jako ostatnia deska ratunku, a nie jako jedyny adres:
       część punktów dostępowych przepuszcza rozgłoszenie skierowane do
       podsieci, a odrzuca to ograniczone. Wysyłamy oba i nie zgadujemy, który
       zadziała w tej hali. */
    runCatching { wynik.add(InetAddress.getByName("255.255.255.255")) }
    return wynik.distinct()
}

/**
 * Rozgłoszenie i zebranie odpowiedzi.
 *
 * Zwraca listę BEZ POWTÓRZEŃ, posortowaną kolejnością odpowiedzi — pierwszy
 * odpowiada zwykle ten, który jest naprawdę w tej samej podsieci. Pusta lista
 * znaczy „nie znalazłem", nie „nie ma": rozgłoszenia bywają odrzucane przez
 * punkt dostępowy i wtedy zostaje kod QR albo wpisanie adresu.
 */
suspend fun szukajSerwerow(
    nasluchMs: Int = NASLUCH_MS,
    port: Int = PORT_ODKRYWANIA,
): List<ZnalezionySerwer> = withContext(Dispatchers.IO) {
    val pytanie = ByteArray(ROZMIAR_PYTANIA)
    PYTANIE.toByteArray(Charsets.ISO_8859_1).copyInto(pytanie)

    val znalezione = LinkedHashMap<String, ZnalezionySerwer>()

    runCatching {
        DatagramSocket().use { gniazdo ->
            gniazdo.broadcast = true
            gniazdo.soTimeout = 250

            for (cel in adresyRozgloszeniowe()) {
                runCatching { gniazdo.send(DatagramPacket(pytanie, pytanie.size, cel, port)) }
            }

            val koniec = System.currentTimeMillis() + nasluchMs
            val bufor = ByteArray(1024)
            while (System.currentTimeMillis() < koniec) {
                val pakiet = DatagramPacket(bufor, bufor.size)
                try {
                    gniazdo.receive(pakiet)
                } catch (_: SocketTimeoutException) {
                    continue // cisza w tym okienku — czekamy do końca nasłuchu
                }
                // treść odpowiedzi rozbiera `core/net/Parowanie.kt` — tam też jest jej test
                val serwer = zinterpretujOdpowiedz(String(pakiet.data, 0, pakiet.length)) ?: continue
                znalezione.putIfAbsent(serwer.url, serwer)
            }
        }
    }

    znalezione.values.toList()
}
