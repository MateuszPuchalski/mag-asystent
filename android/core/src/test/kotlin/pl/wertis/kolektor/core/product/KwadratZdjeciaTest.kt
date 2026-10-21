package pl.wertis.kolektor.core.product

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* Reguła ta sama co w `panel/src/zdjecia/obrobka.ts`. Rozjazd znaczy, że ten
   sam towar dostaje w Subiekcie inny kadr zależnie od tego, czy zdjęcie
   zrobił kolektor, czy biuro. */

class KwadratZdjeciaTest {

    private fun obraz(szer: Int, wys: Int, tresc: Prostokat?, alfaTla: Int = 0): IntArray =
        IntArray(szer * wys) { i ->
            val x = i % szer
            val y = i / szer
            val wTresci = tresc != null && x in tresc.x until tresc.x + tresc.szer &&
                y in tresc.y until tresc.y + tresc.wys
            if (wTresci) 0xFF336699.toInt() else (alfaTla shl 24) or 0xFFFFFF
        }

    @Test
    fun `ramka obejmuje dokladnie piksele tresci`() {
        val t = Prostokat(3, 5, 4, 2)
        assertEquals(t, ramkaAlfy(obraz(10, 10, t), 10, 10))
    }

    @Test
    fun `szum alfy do progu liczy sie jako tlo`() {
        val t = Prostokat(2, 2, 3, 3)
        assertEquals(t, ramkaAlfy(obraz(8, 8, t, alfaTla = PROG_ALFY), 8, 8))
        assertEquals(Prostokat(0, 0, 8, 8), ramkaAlfy(obraz(8, 8, t, alfaTla = PROG_ALFY + 1), 8, 8))
    }

    @Test
    fun `puste wyciecie nie ma ramki`() {
        assertNull(ramkaAlfy(obraz(6, 4, null), 6, 4))
    }

    @Test
    fun `JPEG bez wyciecia zostaje caly`() {
        assertEquals(Prostokat(0, 0, 5, 3), ramkaAlfy(IntArray(15) { 0xFF808080.toInt() }, 5, 3))
    }

    @Test
    fun `duza tresc schodzi do 800 z marginesem i jest wysrodkowana`() {
        val k = kwadratWokol(1600, 800)
        assertEquals(800, k.bok)
        // naturalny bok 1600 + 2·80 = 1760, skala 800/1760
        assertEquals(Prostokat(36, 218, 727, 364), k.tresc)
    }

    @Test
    fun `mala tresc nie jest powiekszana`() {
        val k = kwadratWokol(200, 100)
        assertEquals(220, k.bok)
        assertEquals(Prostokat(10, 60, 200, 100), k.tresc)
    }

    @Test
    fun `pionowa tresc staje posrodku w poziomie`() {
        val k = kwadratWokol(300, 600)
        assertEquals(660, k.bok)
        assertEquals(Prostokat(180, 30, 300, 600), k.tresc)
    }

    @Test
    fun `zerowy wymiar nie dzieli przez zero`() {
        val k = kwadratWokol(0, 0)
        assertEquals(1, k.bok)
        assertEquals(1, k.tresc.szer)
    }

    @Test
    fun `bierze pierwsza jakosc mieszczaca sie w celu`() {
        val proby = mutableListOf<Int>()
        val w = zakodujJakNajlzej { q -> proby += q; ByteArray(if (q <= 68) 50 * 1024 else 90 * 1024) }
        assertEquals(68, w.jakosc)
        assertTrue(w.miesciSie)
        assertEquals(listOf(82, 75, 68), proby)
    }

    @Test
    fun `gdy cel nieosiagalny bierze najlzejsza probe w limicie`() {
        val w = zakodujJakNajlzej { q -> ByteArray(100 * 1024 + q) }
        assertEquals(52, w.jakosc)
        assertTrue(w.miesciSie)
    }

    @Test
    fun `ponad twardy limit nie miesci sie`() {
        val w = zakodujJakNajlzej { ByteArray(LIMIT_BAJTOW + 1) }
        assertFalse(w.miesciSie)
    }
}
