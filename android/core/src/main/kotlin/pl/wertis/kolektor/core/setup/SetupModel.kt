package pl.wertis.kolektor.core.setup

import pl.wertis.kolektor.core.session.Rola

/* ── Zakładanie kont z kolektora ────────────────────────────────────────────
   Do tej pory konta zakładało się `curl`-em z instrukcji w DEPLOY. Działa, ale
   tylko dla kogoś, kto ma terminal i nie boi się JSON-a — czyli nie dla osoby,
   która w poniedziałek rano rozpakowuje kolektor. Efekt był taki, że wdrożenie
   stawało na kroku, który z kodem nie ma nic wspólnego.

   Ten model jest CZYSTY (bez Androida, bez sieci), bo cała trudność siedzi
   w regułach, nie w rysowaniu:
     • pierwsze konto MUSI być kontem biura z PIN-em — jest jedyną drogą do
       wszystkich następnych, więc konto magazyniera zamurowałoby administrację,
     • brygadzista i biuro bez PIN-u nie wykonają żadnej operacji
       uprzywilejowanej, więc konto bez PIN-u jest kontem wadliwym od urodzenia,
     • dwie osoby o tym samym imieniu i nazwisku to nie jest przypadek
       hipotetyczny, ale to biuro decyduje, czy to pomyłka, czy dwóch Kowalskich.

   Kolejność zakładania nie jest dowolna i to też jest regułą, nie szczegółem
   implementacji: serwer wpuszcza pierwsze konto bez sesji tylko dopóki tabela
   kont jest pusta. Każde następne wymaga zalogowanego biura, więc wiersz
   „biuro" musi pójść pierwszy i po nim trzeba się zalogować.                  */

/** Jedna osoba do założenia. `pin` wymagany dla ról uprzywilejowanych. */
data class Konto(
    val imieNazwisko: String = "",
    val rola: Rola = Rola.MAGAZYNIER,
    val pin: String = "",
)

/** Co jest nie tak z wierszem; `null` = można zakładać. */
enum class BladKonta {
    BRAK_NAZWY,
    PIN_WYMAGANY,
    PIN_ZA_KROTKI,
    PIN_NIE_SAME_CYFRY,
}

/** Minimalna długość PIN-u. Cztery cyfry — tyle, ile ludzie pamiętają z karty. */
const val PIN_MIN = 4

fun bladKonta(k: Konto): BladKonta? {
    if (k.imieNazwisko.isBlank()) return BladKonta.BRAK_NAZWY
    val wymagaPinu = k.rola != Rola.MAGAZYNIER
    if (!wymagaPinu && k.pin.isEmpty()) return null
    if (wymagaPinu && k.pin.isEmpty()) return BladKonta.PIN_WYMAGANY
    if (!k.pin.all { it.isDigit() }) return BladKonta.PIN_NIE_SAME_CYFRY
    if (k.pin.length < PIN_MIN) return BladKonta.PIN_ZA_KROTKI
    return null
}

/** Komunikat dla człowieka — pełnym zdaniem, bo to jedyne, co zobaczy. */
fun opisBledu(b: BladKonta): String = when (b) {
    BladKonta.BRAK_NAZWY -> "Podaj imię i nazwisko"
    BladKonta.PIN_WYMAGANY -> "Brygadzista i biuro muszą mieć PIN — bez niego nic nie zatwierdzą"
    BladKonta.PIN_ZA_KROTKI -> "PIN ma mieć co najmniej $PIN_MIN cyfry"
    BladKonta.PIN_NIE_SAME_CYFRY -> "PIN to same cyfry — wpisuje się go w rękawicach"
}

/**
 * Czy listę można wysłać na serwer.
 *
 * Wymaga CO NAJMNIEJ JEDNEGO konta biura, gdy zakładamy od zera. Lista bez
 * biura przechodzi walidację wiersz po wierszu i mimo to jest bezużyteczna:
 * nikt nie założy kolejnego konta ani nie zresetuje PIN-u. Lepiej powiedzieć
 * to przed wysyłką niż po.
 */
fun mozliwaWysylka(konta: List<Konto>, odZera: Boolean): Boolean {
    if (konta.isEmpty()) return false
    if (konta.any { bladKonta(it) != null }) return false
    return !odZera || konta.any { it.rola == Rola.BIURO }
}

/**
 * Kolejność wysyłki: biuro NAJPIERW.
 *
 * Serwer wpuszcza pierwsze konto bez sesji tylko przy pustej bazie; wszystko
 * dalej wymaga zalogowanego biura. Gdyby wysyłać w kolejności wpisywania,
 * pierwszy magazynier zająłby tę jedyną furtkę i reszta listy odbiłaby się
 * od 401 — z listą kont w połowie założoną.
 */
fun kolejnoscWysylki(konta: List<Konto>, odZera: Boolean): List<Konto> =
    if (!odZera) konta else konta.sortedByDescending { it.rola == Rola.BIURO }

/** Wynik założenia jednego konta — kod badge'a jest tu jedyną nową informacją. */
data class ZalozoneKonto(val imieNazwisko: String, val badgeCode: String, val rola: Rola)
