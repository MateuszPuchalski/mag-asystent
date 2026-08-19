package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.product.DecyzjaZdjecia
import pl.wertis.kolektor.core.product.WpisZdjecia
import pl.wertis.kolektor.core.product.decyzja
import pl.wertis.kolektor.net.ApiService
import java.io.File

/* ── Logo dostawców: cache na urządzeniu (0.56.0) ────────────────────────────
   Bliźniak `ZdjeciaRepository`, ale świadomie CHUDSZY — bo problem jest inny.

   Zdjęć kartotek są tysiące, ważą megabajty i trzeba je wypierać po ostatnim
   użyciu. Logo jest kilkadziesiąt, każde po kilka kilobajtów, i komplet mieści
   się na dysku bez rachunku bajtów. Dlatego tu nie ma budżetu rozmiaru — jest
   sam limit sztuk, jako bezpiecznik przed katalogiem rosnącym bez końca.

   REGUŁY ŚWIEŻOŚCI SĄ TE SAME i nie robimy ich drugi raz: `decyzja()` z `:core`
   nie wie nic o towarze poza nazwą swojego pliku, a odpowiada dokładnie na to
   pytanie, które mamy tutaj — czy wolno użyć pliku z dysku, czy trzeba
   zapytać serwera. Druga kopia tych progów rozjechałaby się przy pierwszej
   zmianie jednej z nich.

   Warstwa wyżej i tak nie pyta o logo bez potrzeby: wiersz listy dostaw ma
   z serwera flagę `maLogo` i bez niej nie woła tego repozytorium w ogóle. */

class LogoRepository(context: Context, private val api: ApiService) {
    private val prefs = context.getSharedPreferences("wertis_logo", Context.MODE_PRIVATE)
    private val katalog = File(context.filesDir, "logo").apply { mkdirs() }
    private val mutex = Mutex()
    private var indeks: MutableMap<Long, WpisZdjecia> = load()

    /* Lista dostaw pokazuje kilkanaście wierszy naraz, a wracamy na nią po
       każdej dostawie — komplet widocznych logo ma siedzieć w pamięci. */
    private val wPamieci = LinkedHashMap<Long, ByteArray>()

    private fun plik(khId: Long) = File(katalog, "kh$khId.png")

    /**
     * Logo dostawcy: z pamięci, z dysku, a gdy trzeba — z serwera.
     *
     * Zwraca surowe bajty albo `null`. Jeden mutex na całość jest tu funkcją,
     * nie wąskim gardłem: kilkanaście wierszy listy pobiera SEKWENCYJNIE,
     * zamiast zalewać serwer garścią żądań naraz.
     */
    suspend fun logo(khId: Long): ByteArray? = mutex.withLock {
        wPamieci[khId]?.let { return it }

        val f = plik(khId)
        when (val d = decyzja(indeks[khId], f.exists(), System.currentTimeMillis())) {
            DecyzjaZdjecia.NieMa -> return null
            DecyzjaZdjecia.UzyjLokalnego -> return zDysku(khId, f)
            DecyzjaZdjecia.Pobierz -> pobierz(khId, null, f)
            is DecyzjaZdjecia.Rewaliduj -> pobierz(khId, d.etag, f)
        }
    }

    /** Odczyt idzie na wątek dyskowy — `logo()` woła się z rysowania listy. */
    private suspend fun zDysku(khId: Long, f: File): ByteArray? = runCatching {
        val bajty = withContext(Dispatchers.IO) { f.readBytes() }
        zapamietaj(khId, bajty)
        bajty
    }.getOrNull()

    private suspend fun pobierz(khId: Long, etag: String?, f: File): ByteArray? {
        val teraz = System.currentTimeMillis()
        val odp = runCatching {
            api.logoDostawcy(khId, etag?.let { "\"$it\"" })
        }.getOrElse {
            /* Offline. Plik na dysku jest wtedy jedyną odpowiedzią — i po to
               ten cache powstał. */
            return if (f.exists()) zDysku(khId, f) else null
        }

        return when {
            odp.code() == 304 -> {
                zapisz(khId, indeks[khId]?.copy(sprawdzono = teraz, uzyto = teraz) ?: WpisZdjecia(sprawdzono = teraz))
                if (f.exists()) zDysku(khId, f) else null
            }

            odp.code() == 404 -> {
                // biuro skasowało logo — pamiętamy brak, żeby nie pytać co wejście
                f.delete()
                zapisz(khId, WpisZdjecia(brak = true, sprawdzono = teraz, uzyto = teraz))
                null
            }

            odp.isSuccessful -> {
                val bajty = withContext(Dispatchers.IO) { odp.body()?.bytes() }
                if (bajty == null || bajty.isEmpty()) return null
                withContext(Dispatchers.IO) { f.writeBytes(bajty) }
                // ETag jedzie w cudzysłowach (RFC 9110); trzymamy samą wartość
                val etagZOdp = odp.headers()["ETag"].orEmpty().removeSurrounding("\"")
                zapisz(khId, WpisZdjecia(etag = etagZOdp, bajtow = bajty.size, sprawdzono = teraz, uzyto = teraz))
                posprzataj()
                zapamietaj(khId, bajty)
                bajty
            }

            /* 401 i 5xx są przejściowe: zapisane jako „brak" przeżyłyby dobę
               i zamieniły awarię serwera w trwale pusty wiersz. */
            else -> if (f.exists()) zDysku(khId, f) else null
        }
    }

    private fun zapamietaj(khId: Long, bajty: ByteArray) {
        wPamieci[khId] = bajty
        while (wPamieci.size > PAMIEC_SZTUK) wPamieci.remove(wPamieci.keys.first())
    }

    private fun zapisz(khId: Long, wpis: WpisZdjecia) {
        indeks[khId] = wpis
        save()
    }

    /**
     * Bezpiecznik na katalog rosnący bez końca — po ostatnim użyciu.
     *
     * Bez budżetu bajtów, w odróżnieniu od zdjęć: przy limicie sztuk i logo
     * ważącym kilka kilobajtów cały katalog to ułamek megabajta.
     */
    private fun posprzataj() {
        if (indeks.size <= LIMIT_SZTUK) return
        val kolejka = indeks.entries.sortedBy { it.value.uzyto }
        var zostalo = indeks.size
        for ((khId, _) in kolejka) {
            if (zostalo <= LIMIT_SZTUK) break
            plik(khId).delete()
            indeks.remove(khId)
            wPamieci.remove(khId)
            zostalo--
        }
        save()
    }

    private fun load(): MutableMap<Long, WpisZdjecia> = runCatching {
        val raw = prefs.getString(KLUCZ, null) ?: return@runCatching mutableMapOf()
        WertisJson
            .decodeFromString(MapSerializer(Long.serializer(), WpisZdjecia.serializer()), raw)
            .toMutableMap()
    }.getOrDefault(mutableMapOf())

    private fun save() {
        runCatching {
            val raw = WertisJson.encodeToString(
                MapSerializer(Long.serializer(), WpisZdjecia.serializer()),
                indeks,
            )
            prefs.edit { putString(KLUCZ, raw) }
        }
    }

    private companion object {
        const val KLUCZ = "indeks"
        const val PAMIEC_SZTUK = 24
        const val LIMIT_SZTUK = 200
    }
}
