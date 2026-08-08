using Microsoft.Data.Sqlite;

namespace WertisSferaWorker;

/* Meldunek procesu — lustro zamelduj() z server/src/services/process-state.ts.
   /api/health czyta wiersz 'sfera' i porównuje sgt_mode z własnym: rozjazd
   („C# czyta inny wertis.env niż Node") jest awarią bez innego objawu.
   Brak meldunku przez 30 s = proces uznany za martwy (MARTWY_PO_S), więc
   meldunek idzie co tick pętli (domyślnie 1,2 s), jak w workerze Node. */
public static class Heartbeat
{
    public static void Zamelduj(SqliteConnection db, string sgtMode, bool dryRun)
    {
        Db.Transakcja(db, () => Db.Exec(db,
            @"INSERT INTO process_state (name, pid, sgt_mode, sfera_mode, at)
              VALUES ('sfera', @pid, @mode, @sf, @at)
              ON CONFLICT(name) DO UPDATE SET
                pid = excluded.pid, sgt_mode = excluded.sgt_mode,
                sfera_mode = excluded.sfera_mode, at = excluded.at",
            ("@pid", Environment.ProcessId),
            ("@mode", sgtMode),
            // 'dry-run' widoczne w /api/health — przebieg próbny nie może
            // udawać gotowości do prawdziwych dokumentów
            ("@sf", dryRun ? "dry-run" : "com"),
            ("@at", Db.NowIso())));
    }
}
