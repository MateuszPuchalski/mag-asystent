package pl.wertis.kolektor.data

import android.content.Context
import android.graphics.BitmapFactory
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
import pl.wertis.kolektor.core.product.doUsuniecia
import pl.wertis.kolektor.net.ApiService
import java.io.File

/* ── Zdjęcia kartotek: trwały cache na urządzeniu ────────────────────────────
   Pliki idą do `filesDir`, NIE do `cacheDir`, i to jest sedno wymagania
   offline: system czyści `cacheDir` pod presją miejsca, czyli dokładnie wtedy,
   gdy zdjęcie ma być na ekranie w martwej strefie przy regale. `PhotoCapture`
   wybrał `cacheDir` z odwrotnego powodu — kadr żyje pięć sekund do zakodowania.

   Świeżość i eviction liczy `core/product/ZdjecieCache.kt` (czysta logika
   z testem JVM); tutaj zostaje samo wejście/wyjście.                         */

class ZdjeciaRepository(context: Context, private val api: ApiService) {
    private val prefs = context.getSharedPreferences("wertis_zdjecia", Context.MODE_PRIVATE)
    private val katalog = File(context.filesDir, "zdjecia").apply { mkdirs() }
    private val mutex = Mutex()
    private var indeks: MutableMap<Long, WpisZdjecia> = load()

    /* Miniatury trzymane w pamięci — powrót z zamiennika ma być natychmiastowy,
       a od kiedy miniatury stoją też w wierszach list, jeden ekran to i 20
       towarów naraz. Pojemność musi mieścić ekran listy PLUS kartę, inaczej
       każda rekompozycja listy mieli LRU od zera. */
    private val wPamieci = LinkedHashMap<Long, ByteArray>()

    private fun plik(twId: Long) = File(katalog, "t$twId.img")

    /**
     * Zdjęcie towaru: z dysku, a gdy trzeba — z serwera.
     *
     * Zwraca surowe bajty (dekodowanie należy do UI, bo zależy od tego, czy
     * rysujemy miniaturę, czy pełny ekran) albo `null`, gdy zdjęcia nie ma.
     * Sieć jest ruszana WYŁĄCZNIE wtedy, gdy `decyzja` tak powie — karta jest
     * odpytywana co 2 s i bez tego zdjęcie jechałoby w kółko.
     *
     * Jeden mutex na całość jest tu funkcją, nie wąskim gardłem: dwa pytania
     * o ten sam towar rozstrzygają się bez drugiego pobrania (drugi trafia
     * w pamięć albo w `UzyjLokalnego`), a lista 20 wierszy pobiera zdjęcia
     * SEKWENCYJNIE — kolektor nie zalewa serwera dwudziestoma GET-ami naraz.
     */
    suspend fun zdjecie(twId: Long): ByteArray? = mutex.withLock {
        wPamieci[twId]?.let { return it }

        val f = plik(twId)
        when (val d = decyzja(indeks[twId], f.exists(), System.currentTimeMillis())) {
            DecyzjaZdjecia.NieMa -> return null
            DecyzjaZdjecia.UzyjLokalnego -> return zDysku(twId, f)
            DecyzjaZdjecia.Pobierz -> pobierz(twId, null, f)
            is DecyzjaZdjecia.Rewaliduj -> pobierz(twId, d.etag, f)
        }
    }

    /**
     * Odczyt pliku LECI NA WĄTEK DYSKOWY, mimo że plik jest lokalny i mały.
     *
     * Przy jednym zdjęciu na karcie towaru nie miało to znaczenia i dlatego
     * przeszło niezauważone. Od kiedy miniatury stoją w wierszach list, jedno
     * wejście na listę to i dwadzieścia odczytów pod rząd — a `zdjecie()` woła
     * się z `LaunchedEffect`, czyli domyślnie z wątku rysującego. Tam widać to
     * jako zacięcie przy przewijaniu.
     *
     * Pobranie z sieci było na `Dispatchers.IO` od początku; brakowało dokładnie
     * tej jednej ścieżki — tej, którą chodzi się NAJCZĘŚCIEJ, bo plik zwykle już
     * jest.
     */
    private suspend fun zDysku(twId: Long, f: File): ByteArray? = runCatching {
        val bajty = withContext(Dispatchers.IO) { f.readBytes() }
        odnotujUzycie(twId)
        zapamietajWPamieci(twId, bajty)
        bajty
    }.getOrNull()

    private suspend fun pobierz(twId: Long, etag: String?, f: File): ByteArray? {
        val teraz = System.currentTimeMillis()
        val odp = runCatching {
            api.zdjecie(twId, etag?.let { "\"$it\"" })
        }.getOrElse {
            /* Offline. Plik na dysku jest wtedy JEDYNĄ odpowiedzią, jaką mamy —
               i po to ten cache w ogóle powstał. */
            return if (f.exists()) zDysku(twId, f) else null
        }

        return when {
            odp.code() == 304 -> {
                zapisz(twId, indeks[twId]?.copy(sprawdzono = teraz, uzyto = teraz) ?: WpisZdjecia(sprawdzono = teraz))
                if (f.exists()) zDysku(twId, f) else null
            }

            odp.code() == 404 -> {
                // potwierdzony brak — pamiętamy przez dobę, żeby nie pytać co wejście
                f.delete()
                zapisz(twId, WpisZdjecia(brak = true, sprawdzono = teraz, uzyto = teraz))
                null
            }

            odp.isSuccessful -> {
                val bajty = withContext(Dispatchers.IO) { odp.body()?.bytes() }
                if (bajty == null || bajty.isEmpty()) return null
                withContext(Dispatchers.IO) { f.writeBytes(bajty) }
                // ETag jedzie w cudzysłowach (RFC 9110); trzymamy samą wartość
                val etagZOdp = odp.headers()["ETag"].orEmpty().removeSurrounding("\"")
                zapisz(
                    twId,
                    WpisZdjecia(etag = etagZOdp, bajtow = bajty.size, sprawdzono = teraz, uzyto = teraz),
                )
                posprzataj()
                zapamietajWPamieci(twId, bajty)
                bajty
            }

            /* 401 i 5xx to stany przejściowe: NIE zapisujemy ich jako „brak
               zdjęcia", bo taki wpis przeżyłby dobę i zamienił awarię serwera
               w trwale pustą kartę. */
            else -> if (f.exists()) zDysku(twId, f) else null
        }
    }

    /**
     * Zapomnij WSZYSTKO o zdjęciu tego towaru (0.88.0).
     *
     * Wołane po dodaniu zdjęcia z kolektora. Bez tego karta rysowałaby stary
     * stan aż do wygaśnięcia negatywu — a negatyw („ta kartoteka zdjęcia nie
     * ma") trzyma się DOBĘ. Magazynier zobaczyłby więc własne zdjęcie nazajutrz.
     *
     * Kasujemy wpis, nie oznaczamy go jako nieświeży: po zapisie serwer ma nowe
     * bajty i nowy ETag, więc rewalidacja i tak skończyłaby się pobraniem.
     */
    suspend fun zapomnij(twId: Long): Unit = mutex.withLock {
        wPamieci.remove(twId)
        indeks.remove(twId)
        withContext(Dispatchers.IO) { plik(twId).delete() }
        store()
    }

    private fun zapamietajWPamieci(twId: Long, bajty: ByteArray) {
        wPamieci[twId] = bajty
        while (wPamieci.size > PAMIEC_SZTUK) {
            wPamieci.remove(wPamieci.keys.first())
        }
    }

    private fun odnotujUzycie(twId: Long) {
        indeks[twId]?.let { zapisz(twId, it.copy(uzyto = System.currentTimeMillis())) }
    }

    private fun zapisz(twId: Long, wpis: WpisZdjecia) {
        indeks[twId] = wpis
        store()
    }

    private fun posprzataj() {
        val doWyrzucenia = doUsuniecia(indeks, LIMIT_BAJTOW, LIMIT_WPISOW)
        if (doWyrzucenia.isEmpty()) return
        for (twId in doWyrzucenia) {
            plik(twId).delete()
            indeks.remove(twId)
            wPamieci.remove(twId)
        }
        store()
    }

    private fun load(): MutableMap<Long, WpisZdjecia> =
        prefs.getString(KEY, null)?.let {
            runCatching { WertisJson.decodeFromString(SERIALIZER, it).toMutableMap() }.getOrNull()
        } ?: mutableMapOf()

    private fun store() {
        runCatching { WertisJson.encodeToString(SERIALIZER, indeks) }
            .getOrNull()
            ?.let { json -> prefs.edit { putString(KEY, json) } }
    }

    private companion object {
        const val KEY = "indeks"
        /** 32 MB albo 300 sztuk, co pierwsze — kolektor to nie galeria. */
        const val LIMIT_BAJTOW = 32 * 1024 * 1024
        const val LIMIT_WPISOW = 300
        /** Ekran listy (~20 wierszy) + karta; ~100 KB/zdjęcie → ~3 MB. */
        const val PAMIEC_SZTUK = 32
        val SERIALIZER = MapSerializer(Long.serializer(), WpisZdjecia.serializer())
    }
}

/**
 * Dekodowanie do rozmiaru, który naprawdę jest rysowany.
 *
 * Bitmapa 1024×1024 w ARGB_8888 to 4 MB — trzy takie naraz na tanim kolektorze
 * kończą się `OutOfMemoryError`. Miniatura w slocie 76 dp nie potrzebuje
 * niczego powyżej ~200 px, więc schodzimy `inSampleSize` (ta sama technika co
 * `PhotoCapture.encode` i `ProblemSheet.thumbOpts`).
 */
suspend fun dekodujDo(bajty: ByteArray, docelowyPx: Int): android.graphics.Bitmap? =
    withContext(Dispatchers.IO) {
        runCatching {
            val wymiary = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bajty, 0, bajty.size, wymiary)
            var probka = 1
            var wiekszyBok = maxOf(wymiary.outWidth, wymiary.outHeight)
            while (wiekszyBok / 2 >= docelowyPx) {
                probka *= 2
                wiekszyBok /= 2
            }
            BitmapFactory.decodeByteArray(bajty, 0, bajty.size, BitmapFactory.Options().apply {
                inSampleSize = probka
            })
        }.getOrNull()
    }
