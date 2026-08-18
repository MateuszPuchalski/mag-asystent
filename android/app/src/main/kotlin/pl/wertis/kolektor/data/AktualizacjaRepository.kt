package pl.wertis.kolektor.data

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.core.net.AktualizacjaResponse
import pl.wertis.kolektor.core.update.mozliwaDoPobrania
import pl.wertis.kolektor.core.update.wartoAktualizowac
import pl.wertis.kolektor.core.update.zgodnaSuma
import pl.wertis.kolektor.net.ApiClient
import pl.wertis.kolektor.update.WynikInstalacji
import java.io.File
import java.security.MessageDigest

/* ── Aktualizacja kolektora z serwera (0.48.0) ───────────────────────────────
   Do 0.48.0 nowy APK wgrywał człowiek: pobranie artefaktu z GitHuba i obejście
   wszystkich kolektorów przez MDM albo `adb install`. Pasek na dole ekranu
   mówił „wersje różne" i nie dawał z tym zrobić nic.

   KOLEJNOŚĆ KROKÓW JEST TU CZĘŚCIĄ PROJEKTU, nie szczegółem implementacji:

   1. Najpierw pytamy Androida o zgodę na instalację, DOPIERO POTEM pobieramy.
      Kazać człowiekowi czekać na kilkanaście megabajtów, żeby po wszystkim
      powiedzieć „system i tak nie pozwoli", to najgorsza możliwa kolejność.
   2. Plik jedzie do `filesDir`, nie do `cacheDir`. System czyści cache przy
      braku miejsca — czyli dokładnie wtedy, gdy trwa pobieranie 20 MB.
   3. Suma SHA-256 liczy się W TRAKCIE strumienia, nie po nim: drugie przejście
      przez plik to drugie czytanie kilkunastu megabajtów z dysku.
   4. Plik nosi nazwę tymczasową do chwili zgodnej sumy. Pobranie ucięte
      w połowie nigdy nie zdąży wyglądać na gotowe do instalacji.

   Czego suma NIE robi: nie chroni przed podmianą pliku po drodze, bo idzie tym
   samym kanałem co plik. Przed tym chroni PODPIS — Android odmówi instalacji
   APK podpisanego innym kluczem niż zainstalowana aplikacja.                 */

/** Co się właśnie dzieje z aktualizacją. */
sealed interface StanAktualizacji {
    /** Nie ma nic do zrobienia — i to jest stan normalny. */
    data object Brak : StanAktualizacji

    /** Serwer ma nowszą wersję. */
    data class Dostepna(val info: AktualizacjaResponse) : StanAktualizacji

    data class Pobieranie(val info: AktualizacjaResponse, val procent: Int) : StanAktualizacji

    /** Plik leży na urządzeniu i czeka na potwierdzenie instalacji przez system. */
    data class Gotowa(val info: AktualizacjaResponse) : StanAktualizacji

    /**
     * Android nie pozwala tej aplikacji instalować — osobny stan, nie błąd.
     * Rozwiązaniem jest zgoda w ustawieniach, a nie ponowna próba.
     */
    data class BrakZgody(val info: AktualizacjaResponse) : StanAktualizacji

    data class Blad(val info: AktualizacjaResponse?, val komunikat: String) : StanAktualizacji
}

class AktualizacjaRepository(
    private val context: Context,
    private val apiClient: ApiClient,
) {
    private val _stan = MutableStateFlow<StanAktualizacji>(StanAktualizacji.Brak)
    val stan: StateFlow<StanAktualizacji> = _stan.asStateFlow()

    /** „Nie teraz" żyje do końca procesu i NIE jest zapisywane — patrz `odloz`. */
    private var odlozona = false

    private val katalog: File get() = File(context.filesDir, "aktualizacja")
    private val plikGotowy: File get() = File(katalog, "wertis-kolektor.apk")
    private val plikCzesciowy: File get() = File(katalog, "wertis-kolektor.apk.czesc")

    /**
     * Pytanie do serwera. Cisza przy każdej wątpliwości.
     *
     * Serwer nieosiągalny, stara wersja serwera bez tej trasy, brak pliku,
     * wersja równa albo starsza — wszystko kończy się `Brak`. Kolektor nie ma
     * czym straszyć człowieka, dopóki nie wie na pewno, że jest co instalować.
     */
    suspend fun sprawdz() {
        if (odlozona) return
        val info = try {
            apiClient.service.aktualizacja()
        } catch (_: Exception) {
            return
        }
        if (!wartoAktualizowac(BuildConfig.VERSION_NAME, info.wersja)) return
        if (!mozliwaDoPobrania(info.bajtow, info.sha256)) return
        _stan.value =
            if (wolnoInstalowac()) StanAktualizacji.Dostepna(info)
            else StanAktualizacji.BrakZgody(info)
    }

    /** Czy system pozwoli nam zainstalować plik. */
    fun wolnoInstalowac(): Boolean = context.packageManager.canRequestPackageInstalls()

    /**
     * Ekran zgody Androida na instalowanie z tej aplikacji.
     *
     * `ActivityNotFoundException` jest tu realne, nie teoretyczne: ROM-y
     * kolektorów bywają okrojone, a MDM potrafi ten ekran wyciąć. Wtedy jedyną
     * prawdziwą odpowiedzią jest „aktualizację wgra dział IT".
     */
    fun otworzZgode(): Boolean = try {
        context.startActivity(
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        true
    } catch (_: Exception) {
        false
    }

    /** „Nie teraz" — do końca życia procesu. Zapisane na stałe znaczyłoby flotę, która nigdy się nie zaktualizuje. */
    fun odloz() {
        odlozona = true
        _stan.value = StanAktualizacji.Brak
    }

    /**
     * Pobranie i podanie pliku systemowi.
     *
     * Miejsce sprawdzamy PRZED pobraniem, i to na podwójny rozmiar: obok
     * naszego pliku sesja instalatora robi własną kopię.
     */
    suspend fun pobierzIZainstaluj(info: AktualizacjaResponse) {
        if (!wolnoInstalowac()) {
            _stan.value = StanAktualizacji.BrakZgody(info)
            return
        }
        katalog.mkdirs()
        plikCzesciowy.delete()

        if (katalog.usableSpace < info.bajtow * 2) {
            _stan.value = StanAktualizacji.Blad(info, "Za mało miejsca na kolektorze — zwolnij miejsce i spróbuj ponownie")
            return
        }

        _stan.value = StanAktualizacji.Pobieranie(info, 0)
        val plik = try {
            pobierz(info)
        } catch (e: Exception) {
            plikCzesciowy.delete()
            _stan.value = StanAktualizacji.Blad(info, e.message ?: "Pobieranie przerwane — spróbuj ponownie")
            return
        }
        if (plik == null) return

        _stan.value = StanAktualizacji.Gotowa(info)
        try {
            withContext(Dispatchers.IO) { podajSystemowi(plik) }
        } catch (e: Exception) {
            _stan.value = StanAktualizacji.Blad(info, e.message ?: "Instalacja odrzucona przez system")
        }
    }

    /** Strumień → plik tymczasowy, z sumą liczoną po drodze. `null` = zgłoszony błąd. */
    private suspend fun pobierz(info: AktualizacjaResponse): File? = withContext(Dispatchers.IO) {
        val odp = apiClient.service.apk()
        val cialo = odp.body()
        if (!odp.isSuccessful || cialo == null) {
            _stan.value = StanAktualizacji.Blad(info, "Serwer nie oddał pliku (${odp.code()})")
            return@withContext null
        }

        val skrot = MessageDigest.getInstance("SHA-256")
        var pobrane = 0L
        var ostatniProcent = -1
        cialo.byteStream().use { we ->
            plikCzesciowy.outputStream().use { wy ->
                val bufor = ByteArray(64 * 1024)
                while (true) {
                    val ile = we.read(bufor)
                    if (ile <= 0) break
                    wy.write(bufor, 0, ile)
                    skrot.update(bufor, 0, ile)
                    pobrane += ile
                    // stan podnosimy co pełny procent, nie co bufor: 20 MB to
                    // trzysta odświeżeń ekranu na sekundę i nic więcej
                    val procent = if (info.bajtow > 0) (pobrane * 100 / info.bajtow).toInt() else 0
                    if (procent != ostatniProcent) {
                        ostatniProcent = procent
                        _stan.value = StanAktualizacji.Pobieranie(info, procent)
                    }
                }
            }
        }

        val policzona = skrot.digest().joinToString("") { "%02x".format(it) }
        if (!zgodnaSuma(info.sha256, policzona)) {
            plikCzesciowy.delete()
            _stan.value = StanAktualizacji.Blad(info, "Pobrany plik jest uszkodzony — spróbuj ponownie")
            return@withContext null
        }

        plikGotowy.delete()
        // dopiero teraz plik dostaje właściwą nazwę — połowicznego nie da się
        // pomylić z gotowym, bo nigdy jej nie nosi
        if (!plikCzesciowy.renameTo(plikGotowy)) {
            plikCzesciowy.delete()
            _stan.value = StanAktualizacji.Blad(info, "Nie udało się zapisać pliku aktualizacji")
            return@withContext null
        }
        plikGotowy
    }

    /**
     * Przekazanie pliku instalatorowi systemu.
     *
     * `PackageInstaller`, bo `ACTION_INSTALL_PACKAGE` jest wycofane od API 29,
     * a kolektor celuje w 35. Przy tej drodze FileProvider NIE jest potrzebny:
     * bajty idą do sesji, nie przez adres `content://`.
     */
    private fun podajSystemowi(plik: File) {
        val instalator = context.packageManager.packageInstaller
        val parametry = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        parametry.setAppPackageName(context.packageName)
        val idSesji = instalator.createSession(parametry)
        instalator.openSession(idSesji).use { sesja ->
            sesja.openWrite("wertis", 0, plik.length()).use { wy ->
                plik.inputStream().use { we -> we.copyTo(wy) }
                sesja.fsync(wy)
            }
            sesja.commit(WynikInstalacji.nadawca(context, idSesji).intentSender)
        }
    }

    /** Ślad po przerwanym pobraniu z poprzedniego uruchomienia. */
    fun sprzatnij() {
        runCatching { plikCzesciowy.delete() }
    }
}
