package pl.wertis.kolektor.core.wymiary

import java.math.BigDecimal
import java.math.RoundingMode
import pl.wertis.kolektor.core.net.PomiarBody
import pl.wertis.kolektor.core.net.PozycjaBezWymiarow
import pl.wertis.kolektor.core.net.TowarDoPomiaru

/* ── Pomiar wagi i wymiarów z kolektora ─────────────────────────────────────
   Reguły formularza mieszkają tutaj, bo tylko tu mają testy. Ekran `:app`
   rysuje pola i woła te funkcje; sam niczego nie liczy.

   WALIDACJA JEST LUSTREM SERWERA (`server/src/services/wymiary.ts`), tak jak
   `bladKoduEan` przy kodzie kreskowym. Serwer i tak sprawdza po swojemu i jego
   odmowa rozstrzyga. Kopia istnieje po to, żeby magazynier zobaczył pomyłkę
   od razu, przy wadze, bez czekania na sieć. Komunikaty są te same słowo
   w słowo, żeby kolektor i serwer nie mówiły o jednym błędzie dwoma zdaniami.

   PUSTE POLE ZNACZY „NIE MIERZYŁEM", nie „zero". Klucz takiego pola nie jedzie
   w ogóle, a Subiekt zostaje przy swojej wartości. Dzięki temu człowiek mierzy
   wyłącznie braki i nie musi przepisywać tego, co kartoteka już ma.          */

/** Granice serwera: sito na pomyłkę rzędu wielkości, nie fizyka. */
const val MASA_MAX_KG = 2000
const val WYMIAR_MAX_CM = 1000

/** Najdłuższy wpis w polu — dłuższy to palec, który utknął na klawiszu. */
const val MAKS_ZNAKOW_POMIARU = 9

/**
 * Pola formularza w kolejności, w jakiej ręka je wypełnia: najpierw waga
 * (towar leży na wadze), potem miarka. `klucz` to nazwa pola w ciele żądania.
 */
enum class PolePomiaru(val klucz: String, val etykieta: String, val jednostka: String, val waga: Boolean) {
    BRUTTO("bruttoKg", "Waga brutto", "kg", true),
    NETTO("nettoKg", "Waga netto", "kg", true),
    DLUGOSC("dlugosc", "Długość", "cm", false),
    SZEROKOSC("szerokosc", "Szerokość", "cm", false),
    WYSOKOSC("wysokosc", "Wysokość", "cm", false),
}

/** Wiersz listy → kartoteka do formularza. Formularz zna tylko ten jeden kształt. */
fun PozycjaBezWymiarow.doPomiaru(): TowarDoPomiaru = TowarDoPomiaru(
    twId = twId,
    symbol = symbol,
    nazwa = nazwa,
    ean = ean,
    lokalizacja = lokalizacja,
    brutto = brutto,
    netto = netto,
    dlugosc = dlugosc,
    szerokosc = szerokosc,
    wysokosc = wysokosc,
)

/**
 * Kilogramy po polsku: przecinek, najwyżej trzy miejsca, bez zer na końcu.
 * Tak samo jak w panelu, żeby biuro i hala czytały tę samą liczbę.
 */
fun formatKg(v: Double): String =
    BigDecimal.valueOf(v).setScale(3, RoundingMode.HALF_UP).stripTrailingZeros()
        .toPlainString().replace('.', ',')

/** Wymiar z Subiekta: pusty tekst to brak, tak jak `null`. */
private fun wymiar(tekst: String?): String? = tekst?.trim()?.takeIf { it.isNotEmpty() }

/**
 * Co kartoteka DZIŚ ma w danym polu, jako tekst do podpisu „W Subiekcie";
 * `null` = brak. Wymiar idzie surowo, bo tak go widzi biuro w Subiekcie.
 */
fun obecne(t: TowarDoPomiaru, pole: PolePomiaru): String? = when (pole) {
    PolePomiaru.BRUTTO -> t.brutto?.let(::formatKg)
    PolePomiaru.NETTO -> t.netto?.let(::formatKg)
    PolePomiaru.DLUGOSC -> wymiar(t.dlugosc)
    PolePomiaru.SZEROKOSC -> wymiar(t.szerokosc)
    PolePomiaru.WYSOKOSC -> wymiar(t.wysokosc)
}

/** Podpis pod polem: „W Subiekcie: 1,25 kg" albo „W Subiekcie: brak". */
fun podpisObecnego(t: TowarDoPomiaru, pole: PolePomiaru): String =
    obecne(t, pole)?.let { "W Subiekcie: $it ${pole.jednostka}" } ?: "W Subiekcie: brak"

/**
 * Czego brakuje, krótko. Ta sama reguła co `braki()` w panelu: „waga"
 * i „wymiary" zastępują pojedyncze nazwy, gdy brak całej grupy.
 */
fun braki(t: TowarDoPomiaru): String {
    val czesci = mutableListOf<String>()
    when {
        t.brutto == null && t.netto == null -> czesci += "waga"
        t.brutto == null -> czesci += "brutto"
        t.netto == null -> czesci += "netto"
    }
    val wymiary = listOf(
        PolePomiaru.DLUGOSC to "długość",
        PolePomiaru.SZEROKOSC to "szerokość",
        PolePomiaru.WYSOKOSC to "wysokość",
    ).filter { (pole, _) -> obecne(t, pole) == null }
    if (wymiary.size == 3) czesci += "wymiary" else czesci += wymiary.map { it.second }
    return czesci.joinToString(", ")
}

/**
 * Pole, w którym startuje kursor: pierwsze, którego kartoteka nie ma.
 * Przy pełnej kartotece pierwsze w ogóle — wtedy człowiek coś poprawia.
 */
fun poleStartowe(t: TowarDoPomiaru): PolePomiaru =
    PolePomiaru.entries.firstOrNull { obecne(t, it) == null } ?: PolePomiaru.BRUTTO

/** Pole po podanym; `null` za ostatnim, czyli „Gotowe" zapisuje. */
fun nastepnePole(pole: PolePomiaru): PolePomiaru? =
    PolePomiaru.entries.getOrNull(pole.ordinal + 1)

/**
 * Filtr wpisu z klawiatury: cyfry i JEDEN separator, zawsze jako przecinek.
 *
 * Klawiatura liczbowa kolektora podaje raz kropkę, raz przecinek, zależnie od
 * producenta. Człowiek ma widzieć jeden zapis, polski. Drugi separator i inne
 * znaki odpadają już przy pisaniu, więc pole nie przyjmie „12,5,3" ani „1e3".
 */
fun wpisLiczby(tekst: String): String {
    val wynik = StringBuilder()
    var separator = false
    for (z in tekst) {
        when {
            z.isDigit() && z in '0'..'9' -> wynik.append(z)
            (z == ',' || z == '.') && !separator -> {
                separator = true
                // „,5" to dla człowieka pół, a dla serwera nie-liczba
                if (wynik.isEmpty()) wynik.append('0')
                wynik.append(',')
            }
        }
        if (wynik.length >= MAKS_ZNAKOW_POMIARU) break
    }
    return wynik.toString()
}

/** Liczba z pola albo `null`, gdy tekst nie jest liczbą. Pusty tekst też daje `null`. */
fun liczbaPomiaru(tekst: String): Double? {
    val t = tekst.trim().replace(Regex("\\s"), "").replace(',', '.')
    if (!Regex("^\\d+(\\.\\d+)?$").matches(t)) return null
    return t.toDoubleOrNull()
}

/**
 * Zaokrąglenie jak na serwerze: wagi do grama, wymiary do milimetra.
 * `Math.round` zaokrągla połówki w górę, tak jak `Math.round` w JS.
 */
private fun zaokraglij(pole: PolePomiaru, n: Double): Double =
    if (pole.waga) Math.round(n * 1000) / 1000.0 else Math.round(n * 10) / 10.0

/** Błąd jednego pola albo `null`. Puste pole jest poprawne — nie jedzie. */
fun bladPola(pole: PolePomiaru, tekst: String): String? {
    if (tekst.isBlank()) return null
    val n = liczbaPomiaru(tekst) ?: return "${pole.etykieta}: wpisz liczbę, np. 12,5."
    val r = zaokraglij(pole, n)
    /* Zaokrąglamy PRZED progiem zera, jak serwer: „0,04" cm to po zaokrągleniu
       zero, a zero w polu Subiekta znaczy „nie zmierzono". */
    if (r <= 0.0) return "${pole.etykieta} musi być większa od zera."
    val max = if (pole.waga) MASA_MAX_KG else WYMIAR_MAX_CM
    if (r > max) return "${pole.etykieta} ponad $max ${pole.jednostka} — sprawdź jednostkę."
    return null
}

/** Czy cokolwiek wpisano. Przycisk zapisu bez tego jest nieaktywny. */
fun cokolwiekWpisane(wpisy: Map<PolePomiaru, String>): Boolean =
    wpisy.values.any { it.isNotBlank() }

/**
 * Pierwszy błąd formularza albo `null`, gdy można wysyłać.
 *
 * Netto ponad brutto sprawdzamy także względem kartoteki: człowiek może wpisać
 * samo netto obok brutto, które już stoi w Subiekcie. Serwer robi to samo.
 */
fun bladPomiaru(wpisy: Map<PolePomiaru, String>, towar: TowarDoPomiaru): String? {
    for (pole in PolePomiaru.entries) {
        bladPola(pole, wpisy[pole].orEmpty())?.let { return it }
    }
    if (!cokolwiekWpisane(wpisy)) return "Wpisz co najmniej jedną wartość pomiaru."
    val brutto = wpisy[PolePomiaru.BRUTTO]?.let(::liczbaPomiaru)?.let { zaokraglij(PolePomiaru.BRUTTO, it) }
        ?: towar.brutto
    val netto = wpisy[PolePomiaru.NETTO]?.let(::liczbaPomiaru)?.let { zaokraglij(PolePomiaru.NETTO, it) }
        ?: towar.netto
    if (brutto != null && netto != null && netto > brutto) {
        return "Waga netto (${formatKg(netto)} kg) większa od brutto (${formatKg(brutto)} kg)" +
            " — sprawdź, czy pola nie są zamienione."
    }
    return null
}

/**
 * Ciało żądania: tekst tak, jak wpisał człowiek, bez spacji na brzegach.
 * Puste pole zostaje `null`, czyli jego klucz w ogóle nie jedzie.
 */
fun cialoPomiaru(wpisy: Map<PolePomiaru, String>): PomiarBody {
    fun v(p: PolePomiaru) = wpisy[p]?.trim()?.takeIf { it.isNotEmpty() }
    return PomiarBody(
        bruttoKg = v(PolePomiaru.BRUTTO),
        nettoKg = v(PolePomiaru.NETTO),
        dlugosc = v(PolePomiaru.DLUGOSC),
        szerokosc = v(PolePomiaru.SZEROKOSC),
        wysokosc = v(PolePomiaru.WYSOKOSC),
    )
}

/* ── Lista „Do zmierzenia" ───────────────────────────────────────────────── */

/** Liczba wierszy jednej strony. Serwer przyjmuje ją jako `limit`. */
const val WYMIARY_NA_STRONIE = 50

/** Adresy półek z pola lokalizacji: kilka kodów rozdzielonych spacją. */
fun adresy(lokalizacja: String?): List<String> =
    lokalizacja?.trim()?.split(Regex("\\s+"))?.filter { it.isNotEmpty() }.orEmpty()

/**
 * Doklejenie następnej strony bez duplikatów.
 *
 * Lista żyje w trakcie pracy: zmierzony towar znika z niej po zapisie
 * w Subiekcie, więc przesunięcie `offset` potrafi oddać wiersz z poprzedniej
 * strony drugi raz. Ten sam towar dwa razy na liście to dwa pomiary jednej
 * rzeczy, stąd odsiew po `twId`.
 */
fun dolaczStrone(
    dotad: List<PozycjaBezWymiarow>,
    strona: List<PozycjaBezWymiarow>,
): List<PozycjaBezWymiarow> {
    val znane = dotad.mapTo(HashSet()) { it.twId }
    return dotad + strona.filter { znane.add(it.twId) }
}

/**
 * Czy wiersz da się mierzyć. Pomiar w kolejce, z serwera albo zapisany przed
 * chwilą z tego kolektora, wyłącza wiersz: drugi pomiar tego samego towaru
 * przed zapisem pierwszego byłby wyścigiem dwóch wartości o jedno pole.
 */
fun wolny(p: PozycjaBezWymiarow, zapisane: Set<Long>): Boolean =
    !p.oczekuje && p.twId !in zapisane

/**
 * Następny wolny towar PO zapisanym, w kolejności obchodu. Gdy zapisanego
 * nie ma na liście, pierwszy wolny od góry. `null`, gdy nie ma żadnego.
 */
fun nastepnyWolny(
    pozycje: List<PozycjaBezWymiarow>,
    poTwId: Long?,
    zapisane: Set<Long>,
): PozycjaBezWymiarow? {
    val od = pozycje.indexOfFirst { it.twId == poTwId }
    return pozycje.drop(od + 1).firstOrNull { wolny(it, zapisane) }
        ?: pozycje.take(od + 1).firstOrNull { wolny(it, zapisane) }
}

/**
 * Indeks wiersza leżącego na zeskanowanym regale albo -1. Pierwszeństwo ma
 * wiersz wolny, bo po niego człowiek przyszedł; zajęty tylko wtedy, gdy na tym
 * regale nic innego nie ma — żeby skan i tak pokazał, że regał jest na liście.
 * Skan etykiety półki na tej liście znaczy „pokaż, co tu jest do zmierzenia".
 */
fun indeksRegalu(pozycje: List<PozycjaBezWymiarow>, kod: String, zapisane: Set<Long> = emptySet()): Int {
    val k = kod.trim().uppercase()
    if (k.isEmpty()) return -1
    val naRegale = pozycje.indices.filter { i -> adresy(pozycje[i].lokalizacja).any { it.uppercase() == k } }
    return naRegale.firstOrNull { wolny(pozycje[it], zapisane) } ?: naRegale.firstOrNull() ?: -1
}

/**
 * Czy pobrać jeszcze stronę. `razem` liczy serwer, `wczytane` to przesunięcie
 * następnej strony, czyli suma wierszy oddanych przez serwer, nie po odsiewie.
 */
fun jestWiecej(wczytane: Int, razem: Int): Boolean = wczytane < razem
