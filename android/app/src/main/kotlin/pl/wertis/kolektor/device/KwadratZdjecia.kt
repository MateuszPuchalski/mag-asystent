package pl.wertis.kolektor.device

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import pl.wertis.kolektor.core.product.BRAK_TRESCI
import pl.wertis.kolektor.core.product.ZA_DUZY
import pl.wertis.kolektor.core.product.kwadratWokol
import pl.wertis.kolektor.core.product.ramkaAlfy
import pl.wertis.kolektor.core.product.zakodujJakNajlzej
import java.io.ByteArrayOutputStream

/* ── Rysowanie gotowego kwadratu ─────────────────────────────────────────────
   Rachunek (ramka, kwadrat, jakość) mieszka w `core/product/KwadratZdjecia.kt`
   razem z testem. Tu zostaje tylko to, czego bez Androida nie da się zrobić:
   dekodowanie, płótno i kompresja.

   Biel zamiast przezroczystości, bo gotowy plik jest JPEG-iem. JPEG nie zna
   przezroczystości, a jest kilka razy mniejszy od PNG. Przycięcie liczy alfę,
   więc zdjęcie z tłem zostaje całe, tylko wpisane w kwadrat.                  */

/** Gotowy plik albo zdanie, dlaczego go nie ma. */
sealed interface GotowyKwadrat {
    class Plik(val jpeg: ByteArray, val bok: Int) : GotowyKwadrat
    class Blad(val zdanie: String) : GotowyKwadrat
}

object KwadratZdjecia {

    /**
     * Składa gotowy kwadrat z obrazu podglądu (PNG bez tła albo JPEG z tłem).
     * Woła się poza wątkiem UI: dekodowanie i pięć kompresji to kilkaset ms.
     */
    fun zlozKwadrat(obraz: ByteArray): GotowyKwadrat {
        val zrodlo = BitmapFactory.decodeByteArray(obraz, 0, obraz.size)
            ?: return GotowyKwadrat.Blad("Nie udało się odczytać podglądu. Spróbuj jeszcze raz.")
        try {
            val sz = zrodlo.width
            val wy = zrodlo.height
            val piksele = IntArray(sz * wy)
            zrodlo.getPixels(piksele, 0, sz, 0, 0, sz, wy)
            val ramka = ramkaAlfy(piksele, sz, wy) ?: return GotowyKwadrat.Blad(BRAK_TRESCI)
            val k = kwadratWokol(ramka.szer, ramka.wys)

            val plotno = Bitmap.createBitmap(k.bok, k.bok, Bitmap.Config.ARGB_8888)
            try {
                Canvas(plotno).apply {
                    drawColor(Color.WHITE)
                    drawBitmap(
                        zrodlo,
                        Rect(ramka.x, ramka.y, ramka.x + ramka.szer, ramka.y + ramka.wys),
                        Rect(k.tresc.x, k.tresc.y, k.tresc.x + k.tresc.szer, k.tresc.y + k.tresc.wys),
                        // filtr, bo zmniejszenie z 1600 do 800 bez niego daje schodki na krawędziach
                        Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG),
                    )
                }
                val w = zakodujJakNajlzej { q ->
                    ByteArrayOutputStream().also { plotno.compress(Bitmap.CompressFormat.JPEG, q, it) }
                        .toByteArray()
                }
                if (!w.miesciSie) return GotowyKwadrat.Blad(ZA_DUZY)
                return GotowyKwadrat.Plik(w.bajty, k.bok)
            } finally {
                plotno.recycle()
            }
        } finally {
            zrodlo.recycle()
        }
    }
}
