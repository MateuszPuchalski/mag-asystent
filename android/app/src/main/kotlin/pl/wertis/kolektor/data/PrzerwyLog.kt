package pl.wertis.kolektor.data

import java.time.Instant
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.core.net.DziennikCiszy
import pl.wertis.kolektor.device.OpisDrogi
import pl.wertis.kolektor.net.ApiService

/* ── Przerwa w łączności trafia do dziennika serwera (0.326.0) ───────────────
   Decyzja właściciela: „zapis w przerwach łączności powinien być wysyłany do
   jakiegoś logu". Do 0.323.0 dziennik żył wyłącznie w pamięci kolektora —
   odpowiadał tylko temu, kto trzymał to urządzenie w ręce, i znikał przy
   zamknięciu aplikacji. Pytanie „czy to jedno urządzenie, czy wszystkie"
   nie miało wtedy odpowiedzi, a to jest PIERWSZE pytanie przy takiej awarii.

   DROGĄ, KTÓRA JUŻ ISTNIEJE. `POST /api/device/event` wozi od 0.31.0 upadki
   urządzeń i niską baterię, ma listę dozwolonych typów i pisze do `events`.
   Biuro czyta to w zakładce DZIENNIK ZDARZEŃ, z filtrem po urządzeniu.
   Dokładanie własnej trasy dla trzech liczb byłoby drugą drogą do tego samego
   miejsca — a każda droga to osobny strażnik i osobny sposób na pomyłkę.

   PO PRZERWIE, NIE W TRAKCIE. W trakcie nie ma czym wysłać, i to jest cała
   trudność tego zapisu: dziennik zdarzeń zapisuje rzeczy, które da się zgłosić
   dopiero wtedy, gdy już minęły. Zapis idzie więc w chwili, gdy łączność
   wraca — czyli tam, gdzie `DziennikCiszy` domyka przerwę.

   NIEUDANA WYSYŁKA NIE GUBI WPISU. Odhaczenie stoi PO udanej odpowiedzi
   serwera, więc przerwa niewysłana zostaje w kolejce i pojedzie po następnej.
   Zamknięcie aplikacji ją traci — świadomie: to zapis diagnostyczny, a nie
   praca człowieka, i nie warta własnego bufora na dysku.                     */

/** Typ zdarzenia w `events`. Serwer zna go z listy dozwolonych (`routes/device.ts`). */
const val TYP_PRZERWY = "siec_przerwa"

/**
 * Wysyła zaległe przerwy do dziennika serwera. Woła to pętla kolejki zaraz po
 * powrocie łączności — czyli wtedy, gdy żądanie ma szansę dojść.
 *
 * Każda przerwa idzie WŁASNYM żądaniem i własną próbą: jedna odmowa nie ma
 * prawa zabrać pozostałych, a zaległości bywają po dwie–trzy naraz.
 */
suspend fun wyslijPrzerwy(
    dziennik: DziennikCiszy,
    api: ApiService,
    droga: OpisDrogi,
    serwer: String,
) {
    for (p in dziennik.doWyslania()) {
        val koniec = p.doKiedy ?: continue
        val ok = runCatching {
            api.deviceEvent(
                DeviceEventBody(
                    type = TYP_PRZERWY,
                    odKiedy = Instant.ofEpochMilli(p.odKiedy).toString(),
                    trwanieMs = koniec - p.odKiedy,
                    prob = p.prob,
                    powod = p.powod,
                    siec = droga.rodzaj,
                    adres = droga.adres,
                    serwer = serwer,
                ),
            )
        }.isSuccess
        /* Odhaczenie WYŁĄCZNIE po udanej odpowiedzi. Odwrotna kolejność
           zgubiłaby dokładnie te przerwy, które trafiły w chwiejną sieć —
           czyli te, o których biuro najbardziej chce wiedzieć. */
        if (ok) dziennik.oznaczWyslana(p.odKiedy) else return
    }
}
