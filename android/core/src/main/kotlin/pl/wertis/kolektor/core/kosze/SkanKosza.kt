package pl.wertis.kolektor.core.kosze

/* ── Kiedy skan towaru ZNACZY odłożenie ──────────────────────────────────────
   Ze zgłoszenia z hali: „jeśli towar jest wybrany i zeskanuje go drugi raz,
   zatwierdź rozkładanie". Do tej wersji rozłożenie pozycji wymagało DWÓCH
   różnych ruchów — skan towaru wskazywał pozycję, a kończył ją skan REGAŁU
   albo dotknięcie ODŁÓŻ TUTAJ. Przy towarze wracającym na półkę, którą
   aplikacja i tak podała, ten drugi ruch był formalnością wykonywaną
   w rękawicy, z kartonem w drugiej ręce.

   Reguła mieszka w `:core`, a nie w ekranie, bo ma trzy warunki i każdy broni
   przed innym błędem — a takiego zestawu nie sprawdza się wzrokiem.          */

/**
 * Ile MUSI minąć między pierwszym a drugim skanem tego samego towaru.
 *
 * Skaner trzymany na spuście potrafi wysłać ten sam kod dwa razy w kilkaset
 * milisekund. Bez tego progu taki dubel odkładałby towar sam z siebie —
 * 800 ms jest ponad powtórzeniem sprzętowym i poniżej najszybszego skanu,
 * który człowiek wykonuje świadomie.
 */
const val PROG_DRUGIEGO_SKANU = 800L

/**
 * Czy TEN skan towaru kończy odłożenie, czy tylko wskazuje pozycję.
 *
 * @param trafiona pozycja, którą serwer rozpoznał po zeskanowanym kodzie
 * @param uzbrojona pozycja wskazana POPRZEDNIM skanem towaru; `null` = żaden
 *   skan jej nie wskazywał
 * @param adres adres widoczny na ekranie — ten sam, którym odkłada przycisk
 * @param odstepMs ile minęło od poprzedniego skanu towaru
 *
 * UZBRAJA WYŁĄCZNIE SKAN i to jest sedno tej funkcji. Po każdym odłożeniu
 * ekran sam wskazuje następną pozycję, więc reguła oparta na tym, że „pozycja
 * jest wskazana", odkładałaby towar przy PIERWSZYM skanie — czyli zanim
 * człowiek zdążył sprawdzić, czy trzyma to, co trzeba. Automat i dotknięcie
 * palcem rozbrajają; dopiero skan mówi „mam to w ręce".
 *
 * Pusty adres odmawia, bo nie ma czego potwierdzić: towar bez adresu
 * w kartotece wymaga wpisania półki, tak samo jak przy ODŁÓŻ TUTAJ.
 */
fun czyPotwierdzaOdlozenie(
    trafiona: Long,
    uzbrojona: Long?,
    adres: String,
    odstepMs: Long,
    prog: Long = PROG_DRUGIEGO_SKANU,
): Boolean = trafiona == uzbrojona && adres.isNotBlank() && odstepMs >= prog
