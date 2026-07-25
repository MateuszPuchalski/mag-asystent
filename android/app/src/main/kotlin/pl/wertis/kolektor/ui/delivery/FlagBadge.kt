package pl.wertis.kolektor.ui.delivery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Success

/* ── Flaga sprawdzenia faktury na kolektorze ─────────────────────────────────
   Magazynier widzi dokładnie to, co biuro widzi w Subiekcie. To nie ozdoba:
   zanim aplikacja zaczęła tę flagę ustawiać, jedynym sposobem uzgodnienia stanu
   było zapytanie przez halę.

   Kolor bierzemy z KLUCZA stanu przysyłanego przez serwer, a nie z parsowania
   polskiej nazwy: nazwy flag są konfigurowalne po stronie Subiekta, więc
   dopasowanie do literalnych napisów rozsypałoby się przy pierwszej zmianie
   słownictwa w firmie. Napis pokazujemy taki, jaki widzi biuro.               */

private enum class FlagTone { DONE, ERROR, WORK }

private fun toneOf(key: String?): FlagTone = when (key) {
    "done" -> FlagTone.DONE
    "done_with_errors" -> FlagTone.ERROR
    else -> FlagTone.WORK
}

@Composable
fun FlagBadge(flaga: String?, flagaKey: String? = null, modifier: Modifier = Modifier) {
    if (flaga.isNullOrBlank()) return
    val tone = toneOf(flagaKey)
    val bg = when (tone) {
        FlagTone.DONE -> Success.copy(alpha = 0.15f)
        FlagTone.ERROR -> Destructive.copy(alpha = 0.15f)
        FlagTone.WORK -> AmberBg
    }
    val fg = when (tone) {
        FlagTone.DONE -> Success
        FlagTone.ERROR -> Destructive
        FlagTone.WORK -> AmberInk
    }
    Box(modifier.clip(RoundedCornerShape(6.dp)).background(bg).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Text(
            flaga,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            color = fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Kolor akcentu flagi — do kropki/paska poza samą plakietką. */
@Composable
fun flagColor(flagaKey: String?): Color = when (toneOf(flagaKey)) {
    FlagTone.DONE -> Success
    FlagTone.ERROR -> Destructive
    FlagTone.WORK -> AmberInk
}
