---
rodzaj: minor
tytul: ważenie i mierzenie z kolektora — lista „Do zmierzenia”
---

**Ważenie i mierzenie z kolektora.** Nowy ekran „Do zmierzenia” pokazuje
towary bez wagi albo wymiaru w kolejności regałów, więc obchodzi się halę po
kolei. Dotknięcie albo skan otwiera formularz: brutto, netto, długość,
szerokość i wysokość, „Dalej” prowadzi przez pola. Ten sam formularz otwiera
przycisk „Zważ i zmierz” na karcie towaru.

**Panel: obchód regałów.** Zakładka „Wymiary” ma nowy porządek
„Lokalizacja”, a lista pokazuje adres półki.

Trasy `/api/wymiary/*` wymagają już tylko sesji, bez roli biura: mierzy ten,
kto stoi przy wadze. Doszedł odczyt jednego towaru `GET /api/wymiary/:twId`
dla karty w kolektorze. Zapis idzie tą samą kolejką `set_wymiary` co z panelu.
