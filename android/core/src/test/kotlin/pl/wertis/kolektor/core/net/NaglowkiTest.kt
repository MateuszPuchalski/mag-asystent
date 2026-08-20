package pl.wertis.kolektor.core.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/* -- Wartosc naglowka HTTP --------------------------------------------------
   Test istnieje z powodu wywrotki, nie z upodobania do kodowania: „Blazej"
   (przez l z kreska) w naglowku `x-user` zabijal kolektor przy pierwszym
   zadaniu po zalogowaniu. Regula OkHttp jest twarda i nie ma od niej
   odwolania — wartosc musi sie zmiescic w ' '..'~'.

   Testy siedza w `:core`, bo to jedyna warstwa kolektora, ktorej testy
   wykonuja sie poza CI. Gdyby ta sama pulapka wrocila, ma pasc tutaj.       */

class NaglowkiTest {

    @Test fun `polskie znaki wychodza jako procenty UTF-8`() {
        assertEquals("B%C5%82a%C5%BCej", naglowekHttp("B\u0142a\u017Cej"))
    }

    @Test fun `czyste ASCII przechodzi bez zmian`() {
        // wstecz: stare instalacje wysylaja dokladnie to i maja dzialac dalej
        assertEquals("Jan Kowalski", naglowekHttp("Jan Kowalski"))
        assertEquals("anonim", naglowekHttp("anonim"))
    }

    @Test fun `procent jest kodowany, zeby dekodowanie bylo jednoznaczne`() {
        assertEquals("50%25", naglowekHttp("50%"))
    }

    @Test fun `wynik zawsze miesci sie w tym, co przepuszcza OkHttp`() {
        val trudne = listOf(
            "B\u0142a\u017Cej", "Za\u017C\u00F3\u0142\u0107 g\u0119\u015Bl\u0105 ja\u017A\u0144",
            "\u0141\u00D3D\u0179", "tabulator\ttu", "nowa\nlinia", "emoji \uD83E\uDDF0",
            "", "%%%", " ",
        )
        for (t in trudne) {
            val w = naglowekHttp(t)
            assertTrue("wpadlo cos spoza zakresu: $w", w.all { it in ' '..'~' })
        }
    }

    @Test fun `pusty tekst nie wybucha`() {
        assertEquals("", naglowekHttp(""))
    }

    @Test fun `kodowanie da sie odwrocic`() {
        // lustro dekodowania z serwera — nazwisko ma wrocic w calosci
        val nazwy = listOf(
            "B\u0142a\u017Cej",
            "Za\u017C\u00F3\u0142\u0107 g\u0119\u015Bl\u0105 ja\u017A\u0144",
            "Jan Kowalski",
            "50%",
        )
        for (t in nazwy) {
            assertEquals(t, java.net.URLDecoder.decode(naglowekHttp(t), "UTF-8"))
        }
    }
}
