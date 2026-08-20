# Worker Sfery — dokumenty w Subiekcie (C#/.NET)

Trzeci proces WERTIS, obok `wertis-api` i `wertis-worker`. Czyta tę samą
tabelę `sfera_queue` w SQLite i wykonuje **zadania dokumentowe** przez COM
Sfery Subiekta GT:

| typ zadania | co powstaje |
|---|---|
| `mm` | dokument przesunięcia magazynowego |
| `korekta_zwrot` | korekta sprzedaży, MM na magazyn zwrotów oraz (0.66.0) RW dla pozycji zniszczonych — atomowo |

`set_location` zostaje w workerze Node (bezpośredni UPDATE jednej kolumny,
Sfera do niego niepotrzebna).

**Atomowo** znaczy: gdy któreś ogniwo padnie, wszystko przed nim zostaje
usunięte — pad RW wycofuje MM i korektę, pad MM wycofuje korektę. Subiekt nie
ma transakcji obejmującej kilka dokumentów, więc wycofanie robi ten kod ręką.
Gdy nie uda się i wycofanie, zadanie kończy się błędem wymieniającym Z IMIENIA
dokumenty do ręcznego usunięcia w Subiekcie przed ponowieniem.

Dlaczego MM nie da się zrobić SQL-em i dlaczego to osobny proces — spec §9
oraz [`docs/architektura.md`](../docs/architektura.md). Kontrakt wywołań,
z którego wynika ten kod: [`server/src/adapters/sfera.ts`](../server/src/adapters/sfera.ts).

## Wymagania

| co | po co |
|---|---|
| Windows z zainstalowanym Subiektem GT | COM Sfery jest biblioteką lokalną |
| **licencja Sfery** do Subiekta GT | bez niej COM nie wystartuje |
| konto operatora Subiekta z prawem wystawiania MM i korekt | to użytkownik Subiekta, nie login SQL |
| dostęp do `C:\wertis\server\data\wertis.db` | wspólna kolejka z API i workerem Node |
| `SFERA_WORKER=1` w `wertis.env` | inaczej zadania dokumentowe bierze worker Node — proces odmawia startu, żeby nie było dwóch wykonawców |

## Budowa i wdrożenie

```powershell
# maszyna z .NET 8 SDK (deweloper — NIE serwer firmy):
powershell -File sfera-worker\build.ps1
# → sfera-worker\publish\wertis-sfera-worker.exe (samowystarczalny, win-x64)

# serwer firmy:
#  1. skopiuj exe do C:\wertis\sfera-worker\
#  2. dopisz do C:\wertis\wertis.env:  SFERA_WORKER=1, SFERA_OPERATOR, SFERA_OPERATOR_HASLO
#  3. uruchom instalator (zarejestruje usługę wertis-sfera) albo ręcznie:
nssm install wertis-sfera C:\wertis\sfera-worker\wertis-sfera-worker.exe
#  4. zrestartuj WSZYSTKIE usługi (wszystkie czytają wertis.env)
```

Kolejność i bramki wdrożenia — [`DEPLOY.md`](../DEPLOY.md) §6, etap 2 oraz
[`docs/wdrozenie.md`](../docs/wdrozenie.md). Najkrócej: najpierw `--dry-run`
na kopii bazy, potem **jedno** MM na kartotece próbnej, dopiero potem produkcja.

## Konfiguracja — ten sam `wertis.env` co API i worker

Szuka pliku: `WERTIS_ENV_FILE` → katalog exe → katalog wyżej (`C:\wertis`) →
bieżący. Zmienna środowiskowa wygrywa z plikiem (semantyka jak w Node).
Czytane klucze: `DB_PATH`, `SGT_MODE` (wymagane `mssql`), `WORKER_POLL_MS`,
`MSSQL_SERVER`, `MSSQL_DATABASE`, `SFERA_WORKER`, `SFERA_OPERATOR`,
`SFERA_OPERATOR_HASLO`.

Stałe retry (backoff 5 s / 30 s / 2 min, trzy próby, ponowienie bufora co
60 s) są zaszyte identycznie jak w workerze Node — źródłem jest
`config.worker` w [`server/src/config.ts`](../server/src/config.ts).

## Flagi

| flaga | działanie |
|---|---|
| `--dry-run` | pełny cykl pick → done **bez Sfery**; numer `MM DRY-RUN/n` w `sgt_doc_number`, `sfera_mode='dry-run'` w heartbeacie. Działa też na Linuksie. |
| `--once` | jeden tick pętli i wyjście — do testów |

## `[WERYFIKUJ]` — do ustalenia na maszynie ze Sferą

Wszystko, co dotyczy COM, siedzi w **jednym pliku**
[`src/SferaComAdapter.cs`](src/SferaComAdapter.cs) i jest oznaczone
`[WERYFIKUJ]` (konwencja repo — wartość do potwierdzenia na własnym systemie):

1. ProgID obiektu GT (`"InsERT.GT"`) i wartość `gtaProduktSubiekt`.
2. Mechanizm logowania operatora (`Autentykacja`, `Operator`, `OperatorHaslo`
   — możliwa autoryzacja Windows; od tego zależą ostateczne nazwy kluczy
   `SFERA_OPERATOR*`).
3. Tryb `Uruchom(...)` (dopasowanie wersji, praca w tle bez okna).
4. Manager i metoda dodania MM (`DokumentyMagazynoweManager.DodajMM()`),
   nazwy właściwości magazynów i pozycji.
5. Czy `Zapisz()` wystawia dokument **wykonany**, czy odkłada do bufora —
   decyzja domyślna: wykonany (sens operacji to „towar sprzedawalny").
6. Wystawienie korekty do istniejącego dokumentu
   (`DokumentyHandloweManager.DodajKorekte(dokId)`), sposób adresowania
   pozycji (`Pozycje.SzukajTowar`) i pole ilości po korekcie.
7. Usunięcie dokumentu (`Usun()`) — na nim stoi wycofanie łańcucha, gdy
   dalsze ogniwo padnie.
8. RW dla pozycji zniszczonych (`DokumentyMagazynoweManager.DodajRW()`,
   właściwość magazynu) — pierwsze RW na kopii bazy, na zwrocie próbnym.

Po ustaleniach poprawia się wyłącznie ten plik i buduje exe od nowa.

## Niezmienniki, których pilnuje ten proces

- **Adres przed sprzedawalnością** — zapytania wyboru zadania
  ([`sql/pick_mm_pending.sql`](sql/pick_mm_pending.sql)) pomijają MM, dopóki
  wcześniejsze niewykonane `set_location` tego samego towaru nie wejdzie.
  Te same pliki SQL wykonuje test po stronie Node
  (`server/src/worker/sfera-pick.test.ts`) — zmiana guardu jest mierzona w CI.
- **Dokument w buforze** → `waiting_for_doc`, ponawiane co 60 s.
- **Audyt**: `queue_retry` / `queue_applied` / `queue_failed` z autorem
  z wiersza kolejki — te same typy i klucze co worker Node.
- **Padnięcie w trakcie zapisu** → zadanie w `error` z ostrzeżeniem
  o możliwym duplikacie; wznowienie to decyzja człowieka (PONÓW), nie automatu.
- **Heartbeat** co tick do `process_state` (`name='sfera'`) — brak meldunku
  przez 30 s widzi `/api/health` (przy `SFERA_WORKER=1`).
