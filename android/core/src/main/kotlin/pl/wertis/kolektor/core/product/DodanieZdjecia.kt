package pl.wertis.kolektor.core.product

/* ── Dodanie zdjęcia kartoteki z kolektora (0.88.0) ──────────────────────────
   POWSTAŁO Z SYTUACJI PRZY REGALE, tak jak nadanie kodu kreskowego: magazynier
   trzyma towar w ręku, na karcie widzi pusty slot i nie ma czym tego naprawić.
   Jedyną drogą było „powiedz biuru".

   Reguła mieszka poza Androidem, bo jej stany prowadzą w RÓŻNE strony, a zielony
   build `:app` nie odróżni ich od siebie. Dwa miejsca są tu naprawdę groźne:

     1. PRZYCISK „+" MA SIĘ POJAWIAĆ PO POTWIERDZONYM BRAKU, nie w trakcie
        pobierania. `ZdjeciaRepository.zdjecie()` zwraca `null` w obu
        przypadkach, więc bez tego rozróżnienia „+" mignąłby przy KAŻDYM
        wejściu na kartę — także tam, gdzie zdjęcie jest. Migające cele dotyku
        pod kciukiem to ta sama wpadka, przed którą broni stały rozmiar slotu.

     2. „ZOSTAW TŁO" MUSI ISTNIEĆ TYLKO WTEDY, GDY TŁO USUNIĘTO. Przycisk
        proponujący wybór między dwiema identycznymi wersjami zdjęcia jest
        gorszy niż jego brak — człowiek szuka różnicy, której nie ma.          */

/** Co widać w slocie zdjęcia na karcie towaru. */
enum class StanSlotu {
    /** Pytamy serwer — nie wiadomo jeszcze, czy zdjęcie jest. */
    LADOWANIE,

    /** Zdjęcie jest i się rysuje. */
    ZDJECIE,

    /** Potwierdzony brak — dopiero TERAZ wolno zaproponować dodanie. */
    BRAK,
}

/** Krok arkusza dodawania zdjęcia. */
enum class KrokZdjecia {
    /** Wybór źródła: aparat albo galeria. */
    WYBOR,

    /** Zdjęcie jedzie na serwer i czeka na wycięcie tła. */
    WYSYLANIE,

    /** Podgląd wyniku — człowiek decyduje. */
    PODGLAD,

    /** Zapisane; arkusz się zamyka. */
    ZAPISANO,
}

/**
 * Czy w slocie ma stać przycisk dodania zdjęcia.
 *
 * @param stan co slot pokazuje w tej chwili
 * @param dodawanieDostepne czy serwer tej instalacji w ogóle przyjmuje zdjęcia
 */
fun pokazacDodanie(stan: StanSlotu, dodawanieDostepne: Boolean): Boolean =
    dodawanieDostepne && stan == StanSlotu.BRAK

/**
 * Napis na przycisku zatwierdzenia w podglądzie.
 *
 * Rozróżnienie jest tu treścią, nie ozdobą: człowiek ma wiedzieć, CO zapisuje,
 * zanim to zapisze. Zdjęcie z tłem i bez tła wyglądają na małym ekranie
 * podobniej, niż się wydaje przy biurku.
 */
fun napisZapisu(tloUsuniete: Boolean): String =
    if (tloUsuniete) "ZAPISZ BEZ TŁA" else "ZAPISZ"

/**
 * Czy pokazać przycisk „ZOSTAW TŁO".
 *
 * Wyłącznie wtedy, gdy tło NAPRAWDĘ usunięto. Gdy usługa tła nie działa albo
 * odmówiła, podgląd pokazuje oryginał i jedyną sensowną decyzją jest zapisać
 * go albo powtórzyć kadr.
 */
fun pokazacZostawTlo(tloUsuniete: Boolean): Boolean = tloUsuniete
