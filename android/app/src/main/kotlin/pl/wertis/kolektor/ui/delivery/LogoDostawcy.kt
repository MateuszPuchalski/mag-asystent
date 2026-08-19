package pl.wertis.kolektor.ui.delivery

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import pl.wertis.kolektor.AppGraph

/* ── Logo dostawcy w wierszu listy dostaw (0.56.0) ───────────────────────────
   Bliźniak `MiniaturaTowaru`, z dwiema różnicami, i obie wynikają z tego, czym
   logo JEST.

   1. `ContentScale.Fit`, nie `Crop`. Zdjęcie towaru wypełnia kwadrat i obcięcie
      brzegów niczego nie psuje — logo bywa wąskim paskiem z nazwą firmy, więc
      przycięte do kwadratu traci dokładnie tę część, po której się je poznaje.
   2. Oddech dookoła. Logo ma zwykle przezroczyste tło i własny margines
      wewnętrzny bliski zeru; bez tej ramki dotykałoby krawędzi kafelka.

   Zastępstwo (`zamiast`) rysuje się TAKŻE w trakcie pobierania, a nie dopiero
   po potwierdzeniu braku — inaczej wiersz mignąłby pustką, zanim cokolwiek się
   pojawi. To ta sama reguła co przy miniaturach towaru.                       */

/** Zdekodowane logo, klucz „khId:px" — patrz `zdekodowane` w `ZdjecieTowaru`. */
private val zdekodowane = android.util.LruCache<String, android.graphics.Bitmap>(24)

@Composable
fun LogoDostawcy(
    graph: AppGraph,
    khId: Long,
    bok: Dp,
    modifier: Modifier = Modifier,
    zamiast: (@Composable () -> Unit)? = null,
) {
    var logo by remember(khId) { mutableStateOf<android.graphics.Bitmap?>(null) }

    // stały mnożnik zamiast LocalDensity — klucz cache'a dekodowania nie może
    // zależeć od ekranu, na którym akurat rysujemy
    val px = bok.value.toInt() * 3

    LaunchedEffect(khId) {
        val bajty = graph.logoRepo.logo(khId)
        logo = bajty?.let { dane ->
            val klucz = "$khId:$px"
            zdekodowane.get(klucz) ?: dekoduj(dane, px)?.also { zdekodowane.put(klucz, it) }
        }
    }

    val bmp = logo
    if (bmp == null) {
        zamiast?.invoke()
        return
    }
    Image(
        bitmap = bmp.asImageBitmap(),
        contentDescription = "Logo dostawcy",
        contentScale = ContentScale.Fit,
        modifier = modifier
            .size(bok)
            .clip(RoundedCornerShape(10.dp))
            .padding(3.dp),
    )
}

/**
 * Dekodowanie z podpróbkowaniem — logo z panelu ma 128 px, ale kolektor rysuje
 * je mniejsze i nie ma powodu trzymać w pamięci więcej, niż widać.
 */
private fun dekoduj(bajty: ByteArray, px: Int): android.graphics.Bitmap? = runCatching {
    val miary = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
    android.graphics.BitmapFactory.decodeByteArray(bajty, 0, bajty.size, miary)
    var probka = 1
    while (miary.outWidth / probka > px * 2 && miary.outHeight / probka > px * 2) probka *= 2
    val opcje = android.graphics.BitmapFactory.Options().apply { inSampleSize = probka }
    android.graphics.BitmapFactory.decodeByteArray(bajty, 0, bajty.size, opcje)
}.getOrNull()
