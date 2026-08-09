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
    /** Zaczęty i nieskończony — jedyna pozycja, która na kogoś czeka. */
    W_TOKU,

    /** Jeszcze nietknięty. */
    NOWY,

    /** Wszystkie pozycje rozłożone (albo pominięte / zgłoszone jako wyjątek). */
    UKONCZONY,
}

/**
 * Kubełek dokumentu.
 *
 * `linesTotal == 0` znaczy „nie otwierano" — postęp liczy się z pozycji
 * zapisanych przy otwarciu, więc przed nim nie ma czego liczyć. `status`
 * pochodzi z tabeli `delivery`: `null` = nigdy nieotwierany, `open` = w toku,
 * `done` = zamknięty ręcznie. Zamknięcie ręczne wygrywa z liczeniem pozycji,
 * bo dostawę da się zamknąć z pozycjami pominiętymi.
 */
fun stanDokumentu(d: DeliveryDocument): StanDokumentu = when {
    d.status == "done" -> StanDokumentu.UKONCZONY
    d.linesTotal > 0 && d.linesDone >= d.linesTotal -> StanDokumentu.UKONCZONY
    // otwarty ALBO z jakimkolwiek postępem — drugi warunek łapie dostawę
    // otwartą przez kogoś innego i porzuconą przed zamknięciem
    d.status != null || d.linesDone > 0 -> StanDokumentu.W_TOKU
    else -> StanDokumentu.NOWY
}

/** Do dokończenia na górze, ukończone na dole; wewnątrz — kolejność z serwera. */
fun uporzadkujDokumenty(documents: List<DeliveryDocument>): List<DeliveryDocument> =
    documents.sortedBy { stanDokumentu(it).ordinal }
