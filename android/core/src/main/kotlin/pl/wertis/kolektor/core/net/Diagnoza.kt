package pl.wertis.kolektor.core.net

import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/* ── Diagnoza łączności kolektora ────────────────────────────────────────────
   Zgłoszenie właściciela: „czasem kolektor traci połączenie z aplikacją, choć
   jest w tej samej sieci co serwer — może chodzi o przeskok między punktami
   dostępowymi?".

   Pytanie zostaje BEZ ODPOWIEDZI, i to jest cała ta usterka. Aplikacja od
   0.60.4 radzi sobie z jednym skutkiem przeskoku (porzuca gniazda otwarte do
   poprzedniego AP), ale nie zapisuje NICZEGO o tym, co się działo. Po fakcie
   nie da się odróżnić czterech różnych rzeczy, które na ekranie wyglądają
   identycznie: dziury w zasięgu, drugiej podsieci, izolacji klientów na AP
   i zapory. `DEPLOY.md` opisuje rozpoznanie każdej z nich — ręcznie, z ustawień
   Androida, czyli wtedy, gdy magazynier stoi przy regale i nie ma na to czasu.

   REGUŁY MIESZKAJĄ W `:core`, bo moduł `:app` nie kompiluje się poza CI.
   Zdanie, które źle nazywa przyczynę, jest GORSZE niż brak zdania: wysyła
   człowieka do sprawdzania nie tej rzeczy. Test jednostkowy jest jedynym
   miejscem, które to wyłapie przed wydaniem.                                 */

/** Adres IPv4 rozbity na cztery liczby; `null` dla nazwy hosta i IPv6. */
private fun oktety(adres: String): List<Int>? {
    val czesci = adres.trim().split(".")
    if (czesci.size != 4) return null
    val liczby = czesci.map { it.toIntOrNull() ?: return null }
    return if (liczby.all { it in 0..255 }) liczby else null
}

/**
 * Host z adresu serwera — bez schematu, portu i ścieżki.
 *
 * Własne cięcie zamiast `URI`, bo adres bywa wpisany ręcznie w Ustawieniach
 * i przychodzi tu w każdej postaci, także niepoprawnej. `URI` rzuciłby wtedy
 * wyjątkiem z ekranu diagnostyki — czyli ekran mający tłumaczyć awarię sam
 * stałby się drugą awarią.
 */
fun hostSerwera(url: String): String? {
    val bezSchematu = url.trim().substringAfter("://", url.trim())
    val host = bezSchematu.substringBefore('/').substringBefore('?').substringBeforeLast(':')
    return host.ifBlank { null }
}

/**
 * Czy urządzenie i serwer stoją w tej samej podsieci /24.
 *
 * `null` znaczy NIE WIADOMO i tak ma być pokazane. Serwer bywa podany nazwą
 * (`mag.wertis.local`), a wtedy porównanie adresów nie istnieje — udawanie
 * odpowiedzi wysłałoby człowieka do przestawiania sieci, która jest dobra.
 *
 * Maska /24 jest UPROSZCZENIEM i to uproszczenie jest świadome. Instalacja
 * opisana w `DEPLOY.md` ma jedną podsieć klasy C na halę; sieć z inną maską
 * pokaże tu „inna podsieć" i najwyżej każe sprawdzić rzecz, która jest dobra.
 * Odwrotna pomyłka — cisza przy naprawdę rozdzielonych sieciach — kosztuje
 * godziny szukania, bo to jest najczęstsza przyczyna z całej listy.
 */
fun tasamaPodsiec(urzadzenie: String?, serwer: String?): Boolean? {
    val a = urzadzenie?.let { oktety(it) } ?: return null
    val b = serwer?.let { oktety(it) } ?: return null
    return a.take(3) == b.take(3)
}

/**
 * Dlaczego żądanie nie doszło — jednym zdaniem, po polsku.
 *
 * Rozróżnienie jest treścią, nie ozdobą: KAŻDY z tych wyjątków prowadzi do
 * innej czynności. Cisza po nawiązanym połączeniu to zapora albo izolacja
 * klientów; odmowa to zły port albo zgaszony serwer; nieznana nazwa to DNS;
 * brak trasy to druga podsieć. Jedno wspólne „błąd sieci" kazałoby sprawdzać
 * wszystkie cztery po kolei.
 */
fun powodOdmowy(e: Throwable): String = when (e) {
    is SocketTimeoutException ->
        "serwer nie odpowiedział w czasie — tak wygląda dziura w zasięgu, zapora albo izolacja klientów na AP"
    is ConnectException ->
        "serwer odrzucił połączenie — pod tym adresem i portem nic nie nasłuchuje"
    is UnknownHostException ->
        "nie rozpoznano nazwy serwera — pyta o nią DNS sieci, w której stoi kolektor"
    is NoRouteToHostException ->
        "nie ma drogi do serwera — kolektor jest w innej sieci niż on"
    is ApiError ->
        "serwer odpowiedział błędem ${e.status}"
    is IOException ->
        "połączenie urwało się w trakcie (${e.javaClass.simpleName})"
    else ->
        "nieoczekiwany błąd (${e.javaClass.simpleName})"
}

/**
 * Jedna przerwa w łączności: od pierwszej nieudanej próby do pierwszej udanej.
 *
 * `doKiedy == null` znaczy „trwa". Tak też ma się pokazywać, bo przerwa
 * zakończona i przerwa trwająca prowadzą do dwóch różnych pytań.
 */
data class PrzerwaCiszy(
    val odKiedy: Long,
    val doKiedy: Long?,
    val prob: Int,
    /** Powód PIERWSZEJ próby — kolejne zwykle powtarzają ten sam. */
    val powod: String,
)

/**
 * Dziennik przerw w łączności — zasilany pętlą kolejki, nie osobnym ruchem.
 *
 * TO JEST WŁAŚCIWA ODPOWIEDŹ NA PYTANIE WŁAŚCICIELA. Pytanie „czy wraca sama,
 * czy trzeba przełączyć Wi-Fi" zadaje się magazynierowi po fakcie, a on ma
 * wtedy w pamięci co innego i pełne ręce roboty. Zapis odpowiada za niego:
 * przerwa, która skończyła się sama po sześciu sekundach, to dziura w zasięgu;
 * przerwa trwająca do chwili, gdy ktoś ruszył Wi-Fi, to co innego.
 *
 * Pętla kolejki chodzi co 1,5 s na każdym ekranie, więc jest naturalnym
 * biciem serca serwera i nie trzeba dokładać ani jednego żądania.
 *
 * TRZYMANE W PAMIĘCI, nie na dysku. Dziennik ma odpowiadać na pytanie o TĘ
 * zmianę; zapis na dysk znaczyłby politykę przechowywania, czyszczenie
 * i pytanie, czy to dane osobowe (kto pracował, kiedy i gdzie stał).
 */
class DziennikCiszy(private val maks: Int = 20) {
    private val wpisy = ArrayDeque<PrzerwaCiszy>()

    /** Przerwy od najnowszej. Kopia, żeby ekran nie czytał zmieniającej się listy. */
    fun przerwy(): List<PrzerwaCiszy> = wpisy.toList().asReversed()

    /** Czy przerwa trwa w tej chwili. */
    fun trwaPrzerwa(): Boolean = wpisy.lastOrNull()?.doKiedy == null

    fun porazka(teraz: Long, powod: String) {
        val ostatnia = wpisy.lastOrNull()
        /* Kolejna porażka DOPISUJE SIĘ do trwającej przerwy, zamiast zakładać
           nową. Inaczej dwudziestosekundowa cisza zostawiłaby trzynaście
           wpisów po 1,5 s i zepchnęła z listy wszystko, co było przedtem —
           czyli dziennik gubiłby historię dokładnie wtedy, gdy jest potrzebna. */
        if (ostatnia != null && ostatnia.doKiedy == null) {
            wpisy[wpisy.size - 1] = ostatnia.copy(prob = ostatnia.prob + 1)
            return
        }
        wpisy.addLast(PrzerwaCiszy(odKiedy = teraz, doKiedy = null, prob = 1, powod = powod))
        while (wpisy.size > maks) wpisy.removeFirst()
    }

    fun sukces(teraz: Long) {
        val ostatnia = wpisy.lastOrNull() ?: return
        if (ostatnia.doKiedy != null) return
        wpisy[wpisy.size - 1] = ostatnia.copy(doKiedy = teraz)
    }
}
