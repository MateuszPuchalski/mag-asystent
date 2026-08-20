using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace WertisSferaWorker;

/* ── Cykl życia zadań dokumentowych — LUSTRO server/src/worker/kolejka.ts ────
   Ten proces obsługuje WYŁĄCZNIE zadania tworzące dokumenty w Subiekcie:
   type='mm' oraz type='korekta_zwrot' (lista TYPY_SFERY w sfera.ts). Statusy, próby, backoff i wpisy
   audytowe odwzorowują workera Node co do wartości — kolektor, biuro, stock.ts
   i rekoncyliacja czytają jedną kolejkę i nie mogą widzieć dwóch dialektów.

   ŻADNYCH NOWYCH STATUSÓW: enum QueueStatus na kolektorze (Dtos.kt) nie ma
   wartości domyślnej i nieznany status wywala deserializację na każdym
   urządzeniu. Całość mieści się w pending|processing|waiting_for_doc|done|error.

   Stałe retry są zaszyte IDENTYCZNIE jak w Node (config.worker w
   server/src/config.ts): backoff 5 s / 30 s / 2 min, trzy próby, ponowienie
   waiting_for_doc co 60 s. Tam też nie są konfigurowalne przez env — duplikacja
   trzech liczb jest tańsza niż kanał konfiguracji, którego Node nie ma.       */

public sealed record Zadanie(
    long Id, string Typ, string Payload, int Proby, long? SourceDocId,
    long? TwId, string CreatedBy, long? CreatedByRef);

public static class Queue
{
    private static readonly int[] BackoffMs = { 5000, 30000, 120000 };
    private const int MaxProb = 3;
    private const int WaitingRetryMs = 60000;

    /// <summary>Pass waiting_for_doc przed pending — jak pickTask() w Node.</summary>
    public static Zadanie? Pick(SqliteConnection db)
        => PickJedno(db, "pick_mm_waiting.sql") ?? PickJedno(db, "pick_mm_pending.sql");

    private static Zadanie? PickJedno(SqliteConnection db, string zasob)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = Db.ZasobSql(zasob);
        cmd.Parameters.AddWithValue("@now", Db.NowIso());
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return new Zadanie(
            r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetInt32(3),
            r.IsDBNull(4) ? null : r.GetInt64(4),
            r.IsDBNull(5) ? null : r.GetInt64(5),
            r.GetString(6),
            r.IsDBNull(7) ? null : r.GetInt64(7));
    }

    private static bool WBuforze(SqliteConnection db, long docId)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT w_buforze FROM sgt_dokument WHERE dok_id = @id";
        cmd.Parameters.AddWithValue("@id", docId);
        return cmd.ExecuteScalar() is long w && w == 1;
    }

    /// <summary>
    /// Dokument źródłowy w buforze → zadanie czeka (spec §8 D8, lustro
    /// czekaNaDokument + gałęzi waiting z pickTask). Zwraca true, gdy odłożone —
    /// wtedy ten tick NIE pracuje, następny weźmie co innego.
    /// </summary>
    public static bool CzekaNaDokument(SqliteConnection db, Zadanie z)
    {
        if (z.SourceDocId is not long docId || !WBuforze(db, docId)) return false;
        Db.Transakcja(db, () => Db.Exec(db,
            "UPDATE sfera_queue SET status='waiting_for_doc', next_attempt_at=@za WHERE id=@id",
            ("@za", Db.IsoZaMs(WaitingRetryMs)), ("@id", z.Id)));
        Console.WriteLine($"[sfera] #{z.Id} czeka na wyjście dok. {docId} z bufora");
        return true;
    }

    /// <summary>Wykonanie jednego zadania. Błędy zamienia na status, nie rzuca dalej.</summary>
    public static void Przetworz(SqliteConnection db, Zadanie z, ISferaAdapter sfera)
    {
        Db.Transakcja(db, () => Db.Exec(db,
            "UPDATE sfera_queue SET status='processing' WHERE id=@id", ("@id", z.Id)));

        try
        {
            var payload = JsonDocument.Parse(z.Payload).RootElement;

            // COM POZA transakcją SQLite — zapis do Subiekta potrafi trwać,
            // a otwarta blokada zapisu wstrzymałaby API i workera Node.
            var (docNo, wynikJson) = z.Typ switch
            {
                "mm" => (RobMm(payload, sfera), (string?)null),
                "korekta_zwrot" => RobKorekte(payload, sfera),
                _ => throw new InvalidOperationException("Nieznany typ zadania: " + z.Typ),
            };

            Db.Transakcja(db, () =>
            {
                Db.Exec(db,
                    "UPDATE sfera_queue SET status='done', sgt_doc_number=@nr, wynik_json=@w, processed_at=@at WHERE id=@id",
                    ("@nr", docNo), ("@w", (object?)wynikJson), ("@at", Db.NowIso()), ("@id", z.Id));
                /* Sukces też jest zdarzeniem: `mm_queued`/`przesuniecie` mówią,
                   że człowiek POPROSIŁ; dopiero to mówi, że dokument naprawdę
                   powstał i pod jakim numerem (lustro kolejka.ts). */
                Zdarzenie(db, z, "queue_applied", $"{{\"docNo\":{Json(docNo)},\"proby\":{z.Proby}}}");
            });
            Console.WriteLine($"[sfera] #{z.Id} OK {z.Typ} · {docNo}");
        }
        catch (Exception e)
        {
            OznaczBlad(db, z, e.Message);
        }
    }

    private static List<MmItem> Pozycje(JsonElement tablica)
        => tablica.EnumerateArray()
            .Select(it => new MmItem(it.GetProperty("twId").GetInt32(), it.GetProperty("qty").GetDouble()))
            .ToList();

    private static string RobMm(JsonElement payload, ISferaAdapter sfera)
        => sfera.CreateMM(
            payload.GetProperty("magFrom").GetInt32(),
            payload.GetProperty("magTo").GetInt32(),
            Pozycje(payload.GetProperty("items")));

    /* Korekta oddaje DWA numery, a kolumna jest jedna: w sgt_doc_number ląduje
       numer korekty (to jego szuka biuro i księgowość), numer MM idzie obok
       w wynik_json. Kształt JSON-a lustrzany do WynikKorekty w sfera.ts —
       karta zwrotu czyta ten sam obiekt bez względu na to, który worker pisał. */
    private static (string, string?) RobKorekte(JsonElement payload, ISferaAdapter sfera)
    {
        /* `pozycjeZniszczone` jest opcjonalne — zadanie sprzed 0.67.0 go nie ma
           i MUSI się wykonać identycznie jak wtedy. */
        var zniszczone = payload.TryGetProperty("pozycjeZniszczone", out var pz)
            ? Pozycje(pz) : new List<MmItem>();
        var w = sfera.CreateKorektaZwrotu(new ZlecenieKorekty(
            payload.GetProperty("dokId").GetInt32(),
            payload.GetProperty("typ").GetString() ?? "FS",
            payload.GetProperty("magZrodlowy").GetInt32(),
            payload.GetProperty("magZwrotow").GetInt32(),
            Pozycje(payload.GetProperty("pozycje")),
            zniszczone));
        /* rwNumer tylko, gdy RW powstało — kształt lustrzany do WynikKorekty
           w sfera.ts, żeby karta zwrotu czytała jeden obiekt od obu workerów. */
        var rw = w.RwNumer.Length > 0 ? $",\"rwNumer\":{Json(w.RwNumer)}" : "";
        var json = $"{{\"korektaNumer\":{Json(w.KorektaNumer)},\"mmNumer\":{Json(w.MmNumer)}{rw}}}";
        return (w.KorektaNumer, json);
    }

    /// <summary>Retry z backoffem; po wyczerpaniu prób terminalny error (lustro oznaczBlad).</summary>
    public static void OznaczBlad(SqliteConnection db, Zadanie z, string blad)
    {
        var proby = z.Proby + 1;
        if (proby < MaxProb)
        {
            var backoff = BackoffMs[Math.Min(proby - 1, BackoffMs.Length - 1)];
            Db.Transakcja(db, () =>
            {
                Db.Exec(db,
                    "UPDATE sfera_queue SET status='pending', attempts=@p, error_msg=@e, next_attempt_at=@za WHERE id=@id",
                    ("@p", proby), ("@e", blad), ("@za", Db.IsoZaMs(backoff)), ("@id", z.Id));
                Zdarzenie(db, z, "queue_retry",
                    $"{{\"proba\":{proby},\"max\":{MaxProb},\"blad\":{Json(blad)}}}");
            });
            Console.WriteLine($"[sfera] #{z.Id} błąd (próba {proby}/{MaxProb}), retry za {backoff}ms: {blad}");
        }
        else
        {
            Db.Transakcja(db, () =>
            {
                Db.Exec(db,
                    "UPDATE sfera_queue SET status='error', attempts=@p, error_msg=@e, processed_at=@at WHERE id=@id",
                    ("@p", proby), ("@e", blad), ("@at", Db.NowIso()), ("@id", z.Id));
                Zdarzenie(db, z, "queue_failed", $"{{\"proby\":{proby},\"blad\":{Json(blad)}}}");
            });
            Console.WriteLine($"[sfera] #{z.Id} ERROR (wyczerpano próby): {blad}");
        }
    }

    /// <summary>
    /// Odzysk po padnięciu w trakcie zapisu: zadanie zastane w 'processing' NIE
    /// wraca automatycznie do pending — COM mógł zdążyć z Zapisz(), a SQLite
    /// nie, i ponowienie zdublowałoby dokument ze skutkiem magazynowym.
    /// Człowiek sprawdza w Subiekcie i decyduje (ścieżka PONÓW już istnieje).
    /// </summary>
    public static void OznaczPrzerwane(SqliteConnection db)
    {
        var przerwane = new List<Zadanie>();
        using (var cmd = db.CreateCommand())
        {
            cmd.CommandText =
                @"SELECT id, type, payload, attempts, source_doc_id, tw_id, created_by, created_by_ref
                  FROM sfera_queue WHERE type IN ('mm', 'korekta_zwrot') AND status='processing' ORDER BY id";
            using var r = cmd.ExecuteReader();
            while (r.Read())
                przerwane.Add(new Zadanie(
                    r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetInt32(3),
                    r.IsDBNull(4) ? null : r.GetInt64(4),
                    r.IsDBNull(5) ? null : r.GetInt64(5),
                    r.GetString(6),
                    r.IsDBNull(7) ? null : r.GetInt64(7)));
        }
        foreach (var z in przerwane)
        {
            const string blad =
                "Worker Sfery przerwany w trakcie zapisu — SPRAWDŹ w Subiekcie, " +
                "czy dokument powstał, zanim klikniesz PONÓW (ryzyko duplikatu)";
            Db.Transakcja(db, () =>
            {
                Db.Exec(db,
                    "UPDATE sfera_queue SET status='error', error_msg=@e, processed_at=@at WHERE id=@id",
                    ("@e", blad), ("@at", Db.NowIso()), ("@id", z.Id));
                Zdarzenie(db, z, "queue_failed", $"{{\"proby\":{z.Proby},\"blad\":{Json(blad)}}}");
            });
            Console.WriteLine($"[sfera] #{z.Id} zastane w 'processing' po restarcie → error (możliwy duplikat dokumentu)");
        }
    }

    /* Zdarzenie audytowe — kształt i klucze payloadu identyczne z
       zdarzenieZadania() w kolejka.ts: {queueId, typ, ...dane}. Autor idzie
       z WIERSZA KOLEJKI (created_by/created_by_ref), bo proces działa poza
       żądaniem; device_id zostaje NULL — zapisu nie wykonał żaden kolektor. */
    private static void Zdarzenie(SqliteConnection db, Zadanie z, string typ, string daneJson)
    {
        var payload = $"{{\"queueId\":{z.Id},\"typ\":{Json(z.Typ)},{daneJson[1..]}";
        Db.Exec(db,
            "INSERT INTO events(type, tw_id, payload, user_id, device_id, user_ref) VALUES (@t,@tw,@p,@u,NULL,@ref)",
            ("@t", typ), ("@tw", z.TwId), ("@p", payload), ("@u", z.CreatedBy), ("@ref", z.CreatedByRef));
    }

    private static string Json(string s) => JsonSerializer.Serialize(s);
}
