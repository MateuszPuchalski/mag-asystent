---
rodzaj: minor
tytul: integracja z Sellasist
---

**Numer dosyłki sam z Sellasist.** Etykieta dosyłki wydrukowana w Sellasist
staje przy sprawie klienta bez przepisywania numeru, także gdy poszła na kopię
zamówienia. Numer wpisany ręcznie zostaje drogą zapasową.

**Zbiórki do strefy złotej bez wgrywania pliku.** Pozycje zebranych zamówień
płyną z Sellasist same. Analiza → Strefa złota pokazuje też liczbę zebranych
i spakowanych paczek z ostatnich siedmiu dni. CSV zostaje drogą zapasową.

**„Czy wyjdzie dziś" wie, co jest w Sellasist.** Szkic odpowiedzi widzi status
zamówienia w Sellasist, braki do skompletowania i etykietę. Etykieta
wydrukowana dziś znaczy „wyślemy dziś".

**Notatka do zamówienia w Sellasist z profilu klienta.** Rozwinięte zamówienie
pokazuje status, etykiety i notatki z Sellasist. Notatkę dla magazynu dodasz
tam jednym kliknięciem, z podpisem autora.

Serwer czyta zamówienia z dziennika zmian Sellasist. Jedyny zapis do Sellasist
to notatka agenta. Z kupującego przechodzi wyłącznie login. Szczegóły
i decyzje: `docs/sellasist.md`. Kopia specyfikacji API leży
w `docs/sellasist/api.yaml`, a `tools/docs_check.py` pilnuje jej sumy.

**[wymaga działania]** Integracja jest wyłączona, dopóki w `wertis.env` nie
staną `SELLASIST_KONTO` i `SELLASIST_API_KEY`. Po ich wpisaniu i restarcie
uruchom `npm --prefix server run sellasist:sonda` (DEPLOY.md, sekcja
„Sellasist") i wpisz numery statusu „zebrane" do `SELLASIST_STATUSY_ZEBRANE`.
