package pl.wertis.kolektor.wms

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

// Zwykła Application nie uruchamia grafu z domyślnym adresem hali przed ustawieniem lokalnego HTTP testu.
class WmsTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application =
        super.newApplication(cl, Application::class.java.name, context)
}
