package pl.wertis.kolektor.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.R

/* Barlow (tekst) + Barlow Condensed (nagłówki, plakietki, duże liczby) —
   jak --font-sans / --font-cond w web/src/index.css. */

val Barlow = FontFamily(
    Font(R.font.barlow_regular, FontWeight.Normal),
    Font(R.font.barlow_medium, FontWeight.Medium),
    Font(R.font.barlow_semibold, FontWeight.SemiBold),
    Font(R.font.barlow_bold, FontWeight.Bold),
)

val BarlowCond = FontFamily(
    Font(R.font.barlowcondensed_semibold, FontWeight.SemiBold),
    Font(R.font.barlowcondensed_bold, FontWeight.Bold),
    Font(R.font.barlowcondensed_extrabold, FontWeight.ExtraBold),
)

val WertisTypography = Typography(
    bodyLarge = TextStyle(fontFamily = Barlow, fontSize = 16.sp),
    bodyMedium = TextStyle(fontFamily = Barlow, fontSize = 14.sp),
    bodySmall = TextStyle(fontFamily = Barlow, fontSize = 12.sp),
    titleLarge = TextStyle(fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 22.sp),
    titleMedium = TextStyle(fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 18.sp),
    titleSmall = TextStyle(fontFamily = BarlowCond, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    labelLarge = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
    labelMedium = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 12.sp),
    labelSmall = TextStyle(fontFamily = Barlow, fontWeight = FontWeight.Medium, fontSize = 11.sp),
    headlineMedium = TextStyle(fontFamily = BarlowCond, fontWeight = FontWeight.ExtraBold, fontSize = 30.sp),
)
