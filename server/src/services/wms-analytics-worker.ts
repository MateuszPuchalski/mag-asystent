import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { analytics } from "./wms-analytics.js";

// Raport nie migruje bazy ani nie konkuruje ze skanerem o główny wątek API.
const database = new DatabaseSync(workerData.dbPath, { readOnly: true });
database.exec("PRAGMA busy_timeout=2000; PRAGMA query_only=ON");
parentPort!.on("message", ({ id, days }: { id: number; days: number }) => {
  try {
    parentPort!.postMessage({ id, result: analytics({ days }, database) });
  } catch {
    parentPort!.postMessage({ id, error: true });
  }
});
