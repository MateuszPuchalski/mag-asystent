package pl.wertis.kolektor.core.delivery

import pl.wertis.kolektor.core.net.DeliveryDocument

/* ── Kolejność faktur na liście rozkładania ─────────────────────────────────
   Sama data wystawienia nie odpowiada na pytanie, z którym człowiek wchodzi na
   ten ekran: „co mam dokończyć". Dokument zaczęty i porzucony przy zmianie
   albo przy przerwie leżał tam, gdzie wypadł z daty — a to on jest jedyną
   pozycją na tej liście, która czeka na konkretną osobę i blokuje pozycje
   lockiem.

   Stąd trzy kubełki zamiast jednego sortowania. W obrębie kubełka kolejność
   zostaje TAKA, JAK PRZYSZŁA Z SERWERA (malejąco po dacie) — `sortedBy`
   w Kotlinie jest stabilne, więc nie trzeba tego powtarzać po stronie
   kolektora ani utrzymywać w dwóch miejscach.

   Reguła mieszka tutaj, a nie w ekranie, bo rozstrzyga DWIE rzeczy naraz:
   kolejność listy i wygląd wiersza (ptaszek, wyszarzenie). Rozdzielone
   rozjechałyby się przy pierwszej zmianie — dokument sortowany na dół, ale
   rysowany jako aktywny, to najgorszy z możliwych stanów pośrednich.        */

enum class StanDokumentu {
    /** Zaczęty i nieskończony — pozycja, która czeka na konkretną osobę. */
    W_TOKU,

    /**
     * Wszystkie pozycje rozstrzygnięte, ale dostawa NADAL OTWARTA (0.44.1).
     *
     * Do notatek biura (0.43.0) ten stan był przelotny: `closeIfComplete`
     * zamykał dostawę w tej samej sekundzie, w której ostatnia pozycja stawała
     * się terminalna, więc lista praktycznie nigdy go nie widziała. Odkąd
     * nieodpowiedziana notatka trzyma dostawę otwartą, stan jest TRWAŁY —
     * a rysowany jak ukończony mówił „zrobione" o fakturze, której nikt nie
     * zamknął. Dokładnie to zgłoszono z magazynu: „wszystko zeskanowane, a jest
     * na zielono".
     *
     * Jedna nazwa na dwie przyczyny (czeka notatka albo nikt nie nacisnął
     * ZAKOŃCZ), bo czynność jest ta sama: wejdź i dokończ. Rozróżnienie widać
     * dopiero w środku, gdzie i tak trzeba wejść.
     */
    DO_ZAMKNIECIA,

    /** Jeszcze nietknięty. */
    NOWY,

    /** Dostawa zamknięta — `delivery.status = done`. */
    UKONCZONY,
}

/**
 * Kubełek dokumentu.
 *
 * `linesTotal == 0` znaczy „nie otwierano" — postęp liczy się z pozycji
 * zapisanych przy otwarciu, więc przed nim nie ma czego liczyć. `status`
 * pochodzi z tabeli `delivery`: `null` = nigdy nieotwierany, `open` = otwarta,
 * `done` = zamknięta.
 *
 * UKOŃCZONA JEST WYŁĄCZNIE DOSTAWA ZE STATUSEM `done`, i to jest sedno tej
 * reguły. Do 0.44.1 komplet rozstrzygniętych pozycji też liczył się jako
 * ukończenie — zgadzało się to z rzeczywistością dopóty, dopóki dostawa
 * zamykała się sama w tej samej chwili. Notatka biura bez odpowiedzi zerwała
 * tę równość: pozycje są zrobione, a faktura otwarta. Zielony wiersz mówił
 * wtedy „zrobione" o czymś, co czeka na człowieka.
 */
fun stanDokumentu(d: DeliveryDocument): StanDokumentu = when {
    d.status == "done" -> StanDokumentu.UKONCZONY
    d.linesTotal > 0 && d.linesDone >= d.linesTotal -> StanDokumentu.DO_ZAMKNIECIA
    // otwarty ALBO z jakimkolwiek postępem — drugi warunek łapie dostawę
    // otwartą przez kogoś innego i porzuconą przed zamknięciem
    d.status != null || d.linesDone > 0 -> StanDokumentu.W_TOKU
    else -> StanDokumentu.NOWY
}

/** Do dokończenia na górze, ukończone na dole; wewnątrz — kolejność z serwera. */
fun uporzadkujDokumenty(documents: List<DeliveryDocument>): List<DeliveryDocument> =
    documents.sortedBy { stanDokumentu(it).ordinal }
