package pl.wertis.kolektor.core.setup

import pl.wertis.kolektor.core.session.Rola

/* ── Zakładanie kont z kolektora ────────────────────────────────────────────
   Do tej pory konta zakładało się `curl`-em z instrukcji w DEPLOY. Działa, ale
   tylko dla kogoś, kto ma terminal i nie boi się JSON-a — czyli nie dla osoby,
   która w poniedziałek rano rozpakowuje kolektor. Efekt był taki, że wdrożenie
   stawało na kroku, który z kodem nie ma nic wspólnego.

   Ten model jest CZYSTY (bez Androida, bez sieci), bo cała trudność siedzi
   w regułach, nie w rysowaniu:
     • pierwsze konto MUSI być kontem biura — jest jedyną drogą do wszystkich
       następnych, więc konto magazyniera zamurowałoby administrację,
     • konto bez hasła nie zaloguje się nigdy, więc jest kontem wadliwym od
       urodzenia — hasło jest wymagane dla każdej roli,
     • dwie osoby o tym samym imieniu i nazwisku to nie jest przypadek
       hipotetyczny, ale to biuro decyduje, czy to pomyłka, czy dwóch Kowalskich.

   Kolejność zakładania nie jest dowolna i to też jest regułą, nie szczegółem
   implementacji: serwer wpuszcza pierwsze konto bez sesji tylko dopóki tabela
   kont jest pusta i NADAJE MU ROLĘ `admin`, cokolwiek przyszło w żądaniu.
   Każde następne wymaga sesji, a konto biura umie założyć wyłącznie admin —
   więc wiersz admina musi pójść pierwszy i po nim trzeba się zalogować.

   Do 0.24.0 pierwszym kontem było biuro. Zmiana wygląda na kosmetyczną, a nie
   jest: biuro po niej nie zakłada już kont biura, więc lista zaczynająca się
   od biura zatrzymałaby się na drugim wierszu z rolą `biuro`.                 */

/** Jedna osoba do założenia. Login i hasło są wymagane dla każdej roli. */
data class Konto(
    val imieNazwisko: String = "",
    val login: String = "",
    val haslo: String = "",
    val rola: Rola = Rola.MAGAZYNIER,
)

/** Co jest nie tak z wierszem; `null` = można zakładać. */
enum class BladKonta {
    BRAK_NAZWY,
    BRAK_LOGINU,
    LOGIN_ZLY_KSZTALT,
    BRAK_HASLA,
    HASLO_ZA_KROTKIE,
}

/** Minimalna długość hasła — lustro `HASLO_MIN` z serwera. */
const val HASLO_MIN = 8

/* Kształt loginu jest tu SPRAWDZANY, nie NADAWANY: serwer zna tę samą regułę
   i to on rozstrzyga. Kopia po tej stronie istnieje wyłącznie po to, żeby
   literówka nie kosztowała podróży przez sieć i komunikatu po angielsku. */
private val LOGIN_RE = Regex("""^[a-z0-9][a-z0-9._-]{2,31}$""")

fun bladKonta(k: Konto): BladKonta? {
    if (k.imieNazwisko.isBlank()) return BladKonta.BRAK_NAZWY
    if (k.login.isBlank()) return BladKonta.BRAK_LOGINU
    if (!LOGIN_RE.matches(k.login.trim().lowercase())) return BladKonta.LOGIN_ZLY_KSZTALT
    if (k.haslo.isEmpty()) return BladKonta.BRAK_HASLA
    if (k.haslo.length < HASLO_MIN) return BladKonta.HASLO_ZA_KROTKIE
    return null
}

/** Komunikat dla człowieka — pełnym zdaniem, bo to jedyne, co zobaczy. */
fun opisBledu(b: BladKonta): String = when (b) {
    BladKonta.BRAK_NAZWY -> "Podaj imię i nazwisko"
    BladKonta.BRAK_LOGINU -> "Podaj login — bez niego nie ma czym się zalogować"
    BladKonta.LOGIN_ZLY_KSZTALT -> "Login: 3-32 znaki, małe litery, cyfry oraz . _ -"
    BladKonta.BRAK_HASLA -> "Podaj hasło — konto bez hasła nie zaloguje się nigdy"
    BladKonta.HASLO_ZA_KROTKIE -> "Hasło ma mieć co najmniej $HASLO_MIN znaków"
}

/**
 * Czy listę można wysłać na serwer.
 *
 * Wymaga CO NAJMNIEJ JEDNEGO konta admina, gdy zakładamy od zera. Lista bez
 * admina przechodzi walidację wiersz po wierszu i mimo to jest bezużyteczna:
 * nikt nie założy kolejnego konta biura ani nie zmieni komuś hasła. Lepiej
 * powiedzieć to przed wysyłką niż po.
 */
fun mozliwaWysylka(konta: List<Konto>, odZera: Boolean): Boolean {
    if (konta.isEmpty()) return false
    if (konta.any { bladKonta(it) != null }) return false
    return !odZera || konta.any { it.rola == Rola.ADMIN }
}

/**
 * Kolejność wysyłki: admin NAJPIERW.
 *
 * Serwer wpuszcza pierwsze konto bez sesji tylko przy pustej bazie; wszystko
 * dalej wymaga sesji, a konta biura i adminów zakłada wyłącznie admin. Gdyby
 * wysyłać w kolejności wpisywania, pierwszy magazynier zająłby tę jedyną
 * furtkę i reszta listy odbiłaby się od 401 — z listą kont w połowie założoną.
 */
fun kolejnoscWysylki(konta: List<Konto>, odZera: Boolean): List<Konto> =
    if (!odZera) konta else konta.sortedByDescending { it.rola == Rola.ADMIN }

/** Wynik założenia jednego konta — login potwierdza, czym się zalogować. */
data class ZalozoneKonto(val imieNazwisko: String, val login: String, val rola: Rola)
