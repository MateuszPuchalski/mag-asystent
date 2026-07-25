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

   Kolor bierzemy z SENSU stanu, nie z dopasowania do konkretnego napisu — nazwy
   flag są konfigurowalne (config.docFlag), więc dopasowanie do literalnych
   stringów rozsypałoby się przy pierwszej zmianie słownictwa w firmie.        */

private enum class FlagTone { DONE, ERROR, WORK }

private fun toneOf(flaga: String): FlagTone {
    val f = flaga.lowercase()
    return when {
        f.contains("błęd") || f.contains("blad") || f.contains("błąd") -> FlagTone.ERROR
        f.startsWith("sprawdzone") || f.startsWith("sprawdzona") -> FlagTone.DONE
        else -> FlagTone.WORK
    }
}

@Composable
fun FlagBadge(flaga: String?, modifier: Modifier = Modifier) {
    if (flaga.isNullOrBlank()) return
    val tone = toneOf(flaga)
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
fun flagColor(flaga: String?): Color = when (flaga?.let(::toneOf)) {
    FlagTone.DONE -> Success
    FlagTone.ERROR -> Destructive
    else -> AmberInk
}
