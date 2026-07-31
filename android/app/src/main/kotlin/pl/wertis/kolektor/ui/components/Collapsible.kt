package pl.wertis.kolektor.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Sekcja zwijana ─────────────────────────────────────────────────────────
   Osobny plik, a nie kolejny klocek w Common.kt: tamten ma już 400 wierszy
   i jest workiem na wszystko, a ta konstrukcja niesie własne uzasadnienie.

   DLACZEGO PODSUMOWANIE JEST OBOWIĄZKOWE. Zwinięta sekcja bez podsumowania
   zmusza do dotknięcia, żeby dowiedzieć się, czy jest tam cokolwiek — czyli
   zamienia jedno spojrzenie w trzy dotknięcia na każdej karcie. Nagłówek ma
   powiedzieć tyle, żeby w typowym dniu nie trzeba było go otwierać wcale.   */

/**
 * Bezstanowa: stan trzyma ekran.
 *
 * Nie `remember` w środku, bo karta towaru musi umieć zwinąć wszystko przy
 * wejściu w kolejny towar (zamiennik otwiera INNĄ kartę i inne pytanie).
 */
@Composable
fun CollapsibleSection(
    label: String,
    summary: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .cardSurface(background = CardWhite, borderColor = CardBorder)
                .heightIn(min = MinTap)
                .clickable(onClick = onToggle)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label.uppercase(),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.sp,
                color = InkSoft,
            )
            Text(
                summary,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkMute,
                textAlign = TextAlign.End,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
            )
            /* Rozwijanie nie jest animowane. Ta sama reguła, co przy chipie
               lokalizacji: ruch na ekranie trzymanym otwartym cały dzień
               kosztuje baterię i po godzinie staje się tłem, więc zostaje
               zarezerwowany dla stanu wymagającego reakcji. Obrót strzałki
               to potwierdzenie dotknięcia, nie ozdoba — i tylko on animuje. */
            val obrot by animateFloatAsState(if (expanded) 0f else -90f, label = "chevron")
            Icon(
                WIcons.Chevron,
                contentDescription = null,
                tint = InkMute,
                modifier = Modifier.size(16.dp).rotate(obrot),
            )
        }
        if (expanded) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
                content = content,
            )
        }
    }
}
