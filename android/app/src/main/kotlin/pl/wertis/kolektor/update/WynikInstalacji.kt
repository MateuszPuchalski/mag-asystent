package pl.wertis.kolektor.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/* ── Wynik sesji instalatora (0.52.0) ────────────────────────────────────────
   ODBIORNIK JEST W MANIFEŚCIE, nie rejestrowany w kodzie, i to nie jest wybór
   stylu. Instalacja aktualizacji ZABIJA nasz proces — odbiornik zarejestrowany
   w locie nie dożyłby momentu, w którym system ma coś do powiedzenia.

   Dwie pułapki, obie ciche, obie kosztują cały mechanizm:

   1. `FLAG_MUTABLE` jest WYMAGANY od API 31. System dopisuje do tego zamiaru
      własne dodatkowe pola, więc `FLAG_IMMUTABLE` nie wywala niczego — po
      prostu nic się nie dzieje i wygląda to jak zignorowany przycisk.
   2. `STATUS_PENDING_USER_ACTION` to DROGA NORMALNA, nie błąd. Android nie
      instaluje nic po cichu bez trybu właściciela urządzenia, więc każda
      aktualizacja przechodzi przez to pytanie. Ekran zgody trzeba wystawić
      SAMEMU, biorąc zamiar z dodatkowych pól.                                */

class WynikInstalacji : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val pytanie = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
            // z odbiornika nie ma zadania na wierzchu, więc własne jest konieczne
            pytanie.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(pytanie) }
        }
        /* Sukcesu NIE OBSŁUGUJEMY i nie ma czego obsługiwać: przy powodzeniu
           proces jest już zabity, a aplikacja podmieniona. Kod, który czeka
           tutaj na potwierdzenie, czeka na coś, co nigdy nie przyjdzie. */
    }

    companion object {
        private const val AKCJA = "pl.wertis.kolektor.INSTALACJA"

        /** Adres zwrotny dla `PackageInstaller.Session.commit`. */
        fun nadawca(context: Context, idSesji: Int): PendingIntent = PendingIntent.getBroadcast(
            context,
            idSesji,
            Intent(AKCJA).setPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }
}
