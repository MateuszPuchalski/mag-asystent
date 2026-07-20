package pl.wertis.kolektor.ui.theme

import androidx.compose.ui.graphics.Color

/* Tokeny kolorów WERTIS — lustro web/src/index.css (:root). */

val Amber = Color(0xFFF7A600)
val AmberDark = Color(0xFFD98E00)
val AmberInk = Color(0xFFB87C00)
val AmberBg = Color(0xFFFFF3D6)
val AmberBgSoft = Color(0xFFFFF6E3)
val AmberLine = Color(0xFFF0D9A6)

val Ink = Color(0xFF2A2A2C)
// Ramp przyciemniony do WCAG AA na papierze (#F6F5F2):
//   InkSoft  #55555B ≈ 6.1:1  ·  InkMute #6B6B71 ≈ 4.7:1  (były 6E6E73 / 8A8A8E)
// InkFaint tylko do dużego tekstu / dekoracji (nie przechodzi AA dla drobnego).
val InkSoft = Color(0xFF55555B)
val InkMute = Color(0xFF6B6B71)
val InkFaint = Color(0xFF8A8A8E)

val Paper = Color(0xFFF6F5F2)
val CardWhite = Color(0xFFFFFFFF)
val Secondary = Color(0xFFEDEBE4)
val Muted = Color(0xFFEFEDE7)
val BorderCol = Color(0xFFE7E4DC)
/** Delikatniejszy obrys karty pod cieniem (mockup: #EDEBE4). */
val CardBorder = Color(0xFFEDEBE4)
/** Tinta cienia kart/przycisków (alfa dobiera elewacja). */
val ShadowInk = Color(0xFF2A2A2C)
/** Uniesiona powierzchnia pastylki Sfery na ciemnym pasku (spoczynek). */
val PillRest = Color(0xFF3B3B41)

val Destructive = Color(0xFFB33A3A)
val Success = Color(0xFF4C9A52)
