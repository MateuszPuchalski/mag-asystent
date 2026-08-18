package pl.wertis.kolektor.core.product

import pl.wertis.kolektor.core.net.MagazynStan
import pl.wertis.kolektor.core.net.MovementEntry
import pl.wertis.kolektor.core.net.PendingLocChange
import pl.wertis.kolektor.core.net.WDostawie
import pl.wertis.kolektor.core.net.Zamienniki
import pl.wertis.kolektor.core.net.ZamowioneUDostawcy
import pl.wertis.kolektor.core.net.ZlotaStrefa
import pl.wertis.kolektor.core.text.formatQty
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/* ── Teksty i reguły karty towaru ───────────────────────────────────────────
   Karta towaru jest jednym ekranem bez przewijania: fakt mieści się w JEDNEJ
   linii, a sekcja rzadko potrzebna jest zwinięta i musi powiedzieć wszystko
   podsumowaniem w nagłówku. Obie te rzeczy to reguły „co pokazać, gdy danych
   brak albo jest ich osiem" — psują się po cichu, a moduł `:app` nie ma
   żadnych testów. Dlatego siedzą tutaj, a nie w composable.                  */

/** Dopisek za ilością; `null` gdy nie ma nic do dodania ponad sam fakt dostawy. */
fun opisStatusu(d: WDostawie): String? = when {
    d.status == "problem" -> "zgłoszony problem"
    d.status == "skipped" -> "pominięte przy rozkładaniu"
    d.status != null -> "w toku"
    d.wBuforze -> "dokument w buforze"
    else -> null
}

/**
 * Jedna dostawa, jedna linia: „W dostawie 6 szt — FZ 214/07/2026 · OGRÓD-POL
 * · w toku".
 *
 * Data wystawienia wypadła — numer dokumentu niesie miesiąc i rok, a linia ma
 * się zmieścić na 360 px razem ze statusem. Status zostaje, bo mówi, czy ktoś
 * już się o tę pozycję potknął; bez niego magazynier szuka towaru, którego
 * ktoś inny właśnie zgłosił jako uszkodzony.
 *
 * Dostawca stoi MIĘDZY numerem a statusem, i to jest ta kolejność, nie inna.
 * Numer dokumentu identyfikuje dostawę w Subiekcie, ale w strefie przyjęć nie
 * jest napisany nigdzie — na palecie i na kartonach widać dostawcę, więc to on
 * prowadzi rękę do towaru i należy do części „gdzie to jest". Status zostaje
 * na końcu, bo tam go szuka `FaktLinia` przy zawijaniu do dwóch linii.
 *
 * Puste pole = dokument bez kontrahenta; wtedy członu nie ma wcale, zamiast
 * kropki wiodącej donikąd.
 */
fun liniaWDostawie(d: WDostawie, unit: String): String = buildString {
    append("W dostawie ").append(formatQty(d.ilosc))
    if (unit.isNotEmpty()) append(" ").append(unit)
    append(" — ").append(d.nrPelny)
    if (d.dostawca.isNotEmpty()) append(" · ").append(d.dostawca)
    opisStatusu(d)?.let { append(" · ").append(it) }
}

/**
 * Jedno zamówienie, jedna linia: „Zamówione 10 szt — 04.08 · OGRÓD-POL".
 *
 * Termin przed dostawcą: „kiedy" jest pytaniem, „od kogo" dopowiedzeniem. Bez
 * terminu mówimy to wprost, zamiast podstawiać datę wystawienia w miejsce
 * obietnicy dostawy.
 */
fun liniaZamowione(z: ZamowioneUDostawcy, unit: String): String = buildString {
    append("Zamówione ").append(formatQty(z.ilosc))
    if (unit.isNotEmpty()) append(" ").append(unit)
    append(" — ").append(z.termin?.takeIf { it.isNotBlank() } ?: "termin nieznany")
    if (z.dostawca.isNotEmpty()) append(" · ").append(z.dostawca)
}

/**
 * Podpowiedź przeslotowania, jedna linia: „Zbierany 12×/dzień — przenieś do
 * strefy złotej (poziom 2 albo 3)".
 *
 * Częstość PRZED poleceniem, bo to ona jest argumentem — samo „przenieś"
 * z karty towaru brzmiałoby jak rozkaz bez powodu. Poziomy w nawiasie mogą
 * być puste (towar bez adresu regałowego): wtedy nawiasu nie ma wcale.
 */
fun liniaZlotaStrefa(z: ZlotaStrefa): String = buildString {
    append("Zbierany ").append(formatQty(z.zbiorekNaDzien)).append("×/dzień — przenieś do strefy złotej")
    if (z.poziomy.isNotEmpty()) append(" (poziom ").append(z.poziomy).append(")")
}

/* ── Czas na karcie: UTC z serwera, godzina lokalna na ekranie ───────────────
   Serwer zapisuje znaczniki w UTC (`2026-07-28T09:14:03.123Z`) i tak ma
   zostać. Kolektor pokazywał je jednak przez ODCIĘCIE ZNAKÓW z ciągu, czyli
   UTC udające godzinę zegarową — latem w Polsce dwie godziny wstecz. Zmiana
   sprzed chwili wyglądała na sprzed dwóch godzin, a przy wpisach z okolic
   północy myliła się także data.

   Znacznik BEZ strefy (starszy format, `2026-07-28 09:14:03`) nie daje się
   przeliczyć — wtedy wracamy do odczytu pozycyjnego i pokazujemy to, co
   przyszło. Zgadywanie strefy dla takiego wpisu byłoby gorsze niż jego
   dosłowne powtórzenie.                                                       */

private fun lokalnie(at: String, strefa: ZoneId): LocalDateTime? =
    runCatching { Instant.parse(at).atZone(strefa).toLocalDateTime() }.getOrNull()

/** `07-28` czasu lokalnego — rok na karcie nie niesie niczego. */
fun dataKrotka(at: String, strefa: ZoneId = ZoneId.systemDefault()): String =
    lokalnie(at, strefa)?.let { "%02d-%02d".format(it.monthValue, it.dayOfMonth) }
        ?: at.drop(5).take(5)

/** `09:14` czasu lokalnego. */
fun czasKrotki(at: String, strefa: ZoneId = ZoneId.systemDefault()): String =
    lokalnie(at, strefa)?.let { "%02d:%02d".format(it.hour, it.minute) }
        ?: at.drop(11).take(5)

/**
 * Podsumowanie zwiniętej HISTORII: „ost. Jan K · 07-28".
 *
 * Trzy stany, nie dwa. `null` na wejściu znaczy „jeszcze nie wiem" — historia
 * dochodzi osobnym żądaniem, więc pusta lista przed odpowiedzią i pusta lista
 * po odpowiedzi to różne rzeczy. Bez tego rozróżnienia wiersz wskakiwałby po
 * chwili i przesuwał cele dotyku pod kciukiem.
 *
 * `null` na wyjściu = sekcji nie ma czego pokazać, wiersz się nie rysuje.
 */
fun podsumowanieHistorii(h: List<MovementEntry>?): String? = when {
    h == null -> "wczytuję…"
    h.isEmpty() -> null
    else -> h.first().let { "ost. ${it.user} · ${dataKrotka(it.at)}" }
}

/**
 * Podsumowanie zwiniętych POZOSTAŁYCH MAGAZYNÓW: „SKLEP 3 · SERWIS 0".
 *
 * Skraca się do dwóch pozycji i „+N", bo nagłówek ma jeden wiersz na 360 px,
 * a magazynów bywa osiem. Zwroty od klientów idą PIERWSZE i tylko wtedy, gdy
 * coś na nich leży: to jedyna pozycja tej listy, która niesie czynność.
 */
fun podsumowanieMagazynow(magazyny: List<MagazynStan>, zwroty: Double = 0.0): String? {
    val czlony = buildList {
        if (zwroty > 0) add("ZWROTY ${formatQty(zwroty)}")
        magazyny.forEach { add("${it.kod} ${formatQty(it.stan)}") }
    }
    if (czlony.isEmpty()) return null
    val widoczne = czlony.take(2)
    val reszta = czlony.size - widoczne.size
    return widoczne.joinToString(" · ") + if (reszta > 0) " · +$reszta" else ""
}

/**
 * Podsumowanie zwiniętych ZAMIENNIKÓW I OPISU: „24-04003 · MAG 4".
 *
 * Bez liczebników („2 numery", „5 numerów") — polska odmiana to własny silnik,
 * a repozytorium potknęło się już na niej raz („5 błędy" w pastylce Sfery).
 * Brak liczby nic tu nie kosztuje: sekcja i tak otwiera się jednym dotknięciem.
 */
fun podsumowanieZamiennikow(z: Zamienniki, desc: String): String? {
    val pierwszy = z.znane.firstOrNull()
    val czlony = buildList {
        if (pierwszy != null) {
            add(pierwszy.sym)
            add("MAG ${formatQty(pierwszy.mag)}")
            if (z.znane.size > 1) add("+${z.znane.size - 1}")
        } else if (z.obce.isNotEmpty()) {
            add("numery obce")
        }
        if (pierwszy == null && z.obce.isEmpty() && desc.isNotBlank()) add("opis")
    }
    return czlony.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/**
 * Adres pokazywany w pastylce nagłówka.
 *
 * `kod` pusty = towar nie ma adresu i nic po nim nie jedzie. `zmiana` niesie
 * stan zapisu w Subiekcie, bo pastylka rysuje go tak samo jak chipy niżej
 * (przekreślenie, ⏳, puls przy błędzie).
 */
data class AdresHero(val kod: String, val zmiana: PendingLocChange?)

/**
 * Pierwszy adres to adres pickingowy — on trafia do pastylki.
 *
 * Gdy `locs` jest puste, ale w kolejce czeka DOCHODZĄCY adres, pastylka
 * pokazuje jego: bez tego skan półki na towarze bez adresu wyglądałby, jakby
 * nie zrobił nic. To jedyne miejsce, w którym pastylka bierze pozycję
 * z `pendingLocs` — przy niepustym `locs` chip dochodzący zostaje w rzędzie
 * pod spodem, obok adresów, które już są.
 */
fun adresHero(locs: List<String>, pending: List<PendingLocChange>): AdresHero {
    val kod = locs.firstOrNull()
    if (kod != null) return AdresHero(kod, pending.find { it.code == kod })
    val dochodzi = pending.firstOrNull { it.kind == "add" }
    return if (dochodzi != null) AdresHero(dochodzi.code, dochodzi) else AdresHero("", null)
}
