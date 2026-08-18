package pl.wertis.kolektor.ui.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.core.update.rozmiarMb
import pl.wertis.kolektor.data.StanAktualizacji
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Paper

/* ── Propozycja aktualizacji (0.48.0) ────────────────────────────────────────
   Arkusz od dołu, wołany z `AppRoot` NA POZIOMIE EKRANU — nigdy z wnętrza
   cudzego `?.let`. Ta reguła kosztowała już raz widoczność dwóch arkuszy naraz
   (0.44.1): kod był poprawny, kompilował się, przechodził bramki i po prostu
   nic nie rysował.

   PYTANIE NIE BLOKUJE PRACY. Da się je zamknąć, a pod spodem zostaje ekran
   logowania albo lista dostaw. Kolektor z kartonem w ręce nie może stanąć
   przez okno, którego nie da się ominąć — a nieudana aktualizacja nie ma
   prawa zamienić się w nieudaną zmianę.                                      */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AktualizacjaSheet(graph: AppGraph) {
    val stan by graph.aktualizacja.stan.collectAsStateWithLifecycle()
    if (stan is StanAktualizacji.Brak) return
    val scope = rememberCoroutineScope()

    ModalBottomSheet(onDismissRequest = { graph.aktualizacja.odloz() }, containerColor = Paper) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "NOWA WERSJA KOLEKTORA",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )

            when (val s = stan) {
                is StanAktualizacji.Dostepna -> {
                    Naglowek(s.info.wersja, s.info.bajtow)
                    Text(
                        "Praca zapisana na kolektorze nie przepadnie — aktualizacja " +
                            "wchodzi po wierzchu.",
                        fontSize = 12.sp,
                        color = InkSoft,
                    )
                    PrimaryButton("POBIERZ I ZAINSTALUJ", modifier = Modifier.fillMaxWidth()) {
                        scope.launch { graph.aktualizacja.pobierzIZainstaluj(s.info) }
                    }
                    OutlineButton("NIE TERAZ", modifier = Modifier.fillMaxWidth()) {
                        graph.aktualizacja.odloz()
                    }
                }

                is StanAktualizacji.Pobieranie -> {
                    Naglowek(s.info.wersja, s.info.bajtow)
                    Text("Pobieram… ${s.procent}%", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Ink)
                    LinearProgressIndicator(
                        progress = { s.procent / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "Nie wyłączaj kolektora i zostań w zasięgu Wi-Fi.",
                        fontSize = 12.sp,
                        color = InkSoft,
                    )
                }

                is StanAktualizacji.Gotowa -> {
                    Naglowek(s.info.wersja, s.info.bajtow)
                    // od tej chwili pyta Android, nie my — i to on zamknie aplikację
                    Text(
                        "Za chwilę Android zapyta o zgodę na instalację. Potwierdź ją, " +
                            "a aplikacja uruchomi się od nowa.",
                        fontSize = 13.sp,
                        color = Ink,
                    )
                }

                is StanAktualizacji.BrakZgody -> {
                    Naglowek(s.info.wersja, s.info.bajtow)
                    Text(
                        "Android nie pozwala tej aplikacji instalować aktualizacji. " +
                            "Włącz dla WERTIS „Instalowanie nieznanych aplikacji”.",
                        fontSize = 13.sp,
                        color = AmberInk,
                    )
                    PrimaryButton("OTWÓRZ USTAWIENIA ANDROIDA", modifier = Modifier.fillMaxWidth()) {
                        // ROM kolektora bywa okrojony, a MDM potrafi ten ekran wyciąć
                        if (!graph.aktualizacja.otworzZgode()) {
                            graph.effects.toast("Ten kolektor ma zablokowaną instalację — aktualizację wgra dział IT")
                        }
                    }
                    OutlineButton("NIE TERAZ", modifier = Modifier.fillMaxWidth()) {
                        graph.aktualizacja.odloz()
                    }
                }

                is StanAktualizacji.Blad -> {
                    Text(s.komunikat, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Destructive)
                    s.info?.let { info ->
                        PrimaryButton("SPRÓBUJ PONOWNIE", modifier = Modifier.fillMaxWidth()) {
                            scope.launch { graph.aktualizacja.pobierzIZainstaluj(info) }
                        }
                    }
                    OutlineButton("ZAMKNIJ", modifier = Modifier.fillMaxWidth()) {
                        graph.aktualizacja.odloz()
                    }
                }

                StanAktualizacji.Brak -> {}
            }
        }
    }
}

/** Numer nowej wersji obok zainstalowanej — bez tego „nowa wersja" nie mówi nic. */
@Composable
private fun Naglowek(wersja: String?, bajtow: Long) {
    Text(
        "${wersja.orEmpty()} · masz ${BuildConfig.VERSION_NAME}",
        fontFamily = BarlowCond,
        fontWeight = FontWeight.Bold,
        fontSize = 17.sp,
        color = Ink,
    )
    Text("Do pobrania: ${rozmiarMb(bajtow)}", fontSize = 12.sp, color = InkMute)
}
