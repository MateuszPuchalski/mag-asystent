using System.Reflection;
using Microsoft.Data.Sqlite;

namespace WertisSferaWorker;

/* ── Dyscyplina SQLite — LUSTRO server/src/db/db.ts ──────────────────────────
   Bazę otwierają teraz TRZY procesy piszące: api, worker i ten. WAL rozdziela
   czytających od piszących, ale nie piszących między sobą — stąd:

   1. `busy_timeout = 5000` jawnie po otwarciu; bez niego kolizja kończy się
      natychmiastowym SQLITE_BUSY.
   2. Każdy zapis w jawnym `BEGIN IMMEDIATE` przez ExecuteNonQuery — NIE przez
      connection.BeginTransaction(), bo Microsoft.Data.Sqlite otwiera
      transakcję ODROCZONĄ: blokadę zapisu bierze dopiero pierwszy INSERT,
      a podniesienie odczytu do zapisu przy cudzym zapisie w międzyczasie
      zwraca SQLITE_BUSY natychmiast i WBREW busy_timeout (uzasadnienie:
      komentarz przy transaction() w db.ts).

   Migracje robi WYŁĄCZNIE serwer Node — ten proces tylko sprawdza, że schemat
   istnieje, i odmawia startu, gdy go nie ma.                                 */

public static class Db
{
    public static SqliteConnection Open(string sciezka)
    {
        if (!File.Exists(sciezka))
            throw new InvalidOperationException(
                $"Nie ma bazy {sciezka} — uruchom najpierw serwer WERTIS (to on tworzy schemat).");

        var conn = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = sciezka,
            Mode = SqliteOpenMode.ReadWrite, // nie tworzymy bazy — patrz wyżej
        }.ToString());
        conn.Open();
        Exec(conn, "PRAGMA busy_timeout = 5000");

        foreach (var tabela in new[] { "sfera_queue", "process_state", "events", "sgt_dokument" })
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type='table' AND name=@t";
            cmd.Parameters.AddWithValue("@t", tabela);
            if (cmd.ExecuteScalar() is null)
                throw new InvalidOperationException(
                    $"W bazie brakuje tabeli {tabela} — uruchom najpierw serwer WERTIS " +
                    "(migracje schematu robi wyłącznie on).");
        }
        return conn;
    }

    /// <summary>Transakcja zapisu: BEGIN IMMEDIATE + COMMIT/ROLLBACK.</summary>
    public static void Transakcja(SqliteConnection conn, Action fn)
    {
        Exec(conn, "BEGIN IMMEDIATE");
        try
        {
            fn();
            Exec(conn, "COMMIT");
        }
        catch
        {
            Exec(conn, "ROLLBACK");
            throw;
        }
    }

    public static void Exec(SqliteConnection conn, string sql, params (string, object?)[] parametry)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (nazwa, wartosc) in parametry)
            cmd.Parameters.AddWithValue(nazwa, wartosc ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    /// <summary>Znacznik czasu w formacie Node'owego nowIso() — porównywalny leksykalnie.</summary>
    public static string NowIso() => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    public static string IsoZaMs(int ms) =>
        DateTime.UtcNow.AddMilliseconds(ms).ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    /// <summary>
    /// Zapytanie z zasobu wbudowanego (sfera-worker/sql/*.sql) — te same pliki
    /// wykonuje test sfera-pick.test.ts po stronie Node.
    /// </summary>
    public static string ZasobSql(string nazwa)
    {
        var asm = Assembly.GetExecutingAssembly();
        // logiczna nazwa zasobu: <RootNamespace>.sql.<plik>
        var pelna = asm.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("." + nazwa, StringComparison.Ordinal))
            ?? throw new InvalidOperationException($"Brak zasobu SQL {nazwa} w exe.");
        using var strumien = asm.GetManifestResourceStream(pelna)!;
        using var czytnik = new StreamReader(strumien);
        return czytnik.ReadToEnd();
    }
}
