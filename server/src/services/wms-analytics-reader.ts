import { Worker } from "node:worker_threads";
import { config } from "../config.js";
import { analyticsInput, type analytics } from "./wms-analytics.js";
import { WmsError } from "./wms.js";

type Report = ReturnType<typeof analytics>;
type Pending = {
  days: number;
  promise: Promise<Report>;
  resolve: (r: Report) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function analyticsReader(dbPath = config.dbPath, timeoutMs = 45_000) {
  let worker: Worker | null = null,
    sequence = 0,
    closed = false;
  let stopping: Promise<number> | null = null;
  const pending = new Map<number, Pending>();
  function failure(message: string) {
    return new WmsError(503, message);
  }
  function reset(message: string) {
    const old = worker;
    worker = null;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(failure(message));
    }
    pending.clear();
    // SQLite może kończyć natywne zapytanie po terminate; nie uruchamiamy wtedy drugiego czytnika.
    if (old) {
      const termination = old.terminate();
      stopping = termination;
      void termination.finally(() => {
        if (stopping === termination) stopping = null;
      });
    }
    return stopping;
  }
  function start() {
    const source = import.meta.url.endsWith(".ts");
    const moduleUrl = new URL(
      `./wms-analytics-worker.${source ? "ts" : "js"}`,
      import.meta.url,
    );
    // Źródła wymagają resolvera tsx; wydanie uruchamia zwykły skompilowany moduł.
    const next = source
      ? new Worker(
          `const { workerData } = require('node:worker_threads'); import('tsx/esm/api').then(({ tsImport }) => tsImport(workerData.moduleUrl, workerData.moduleUrl));`,
          {
            eval: true,
            workerData: { dbPath, moduleUrl: moduleUrl.href },
            execArgv: [],
          },
        )
      : new Worker(moduleUrl, { workerData: { dbPath }, execArgv: [] });
    worker = next;
    next.on(
      "message",
      (message: { id: number; result?: Report; error?: boolean }) => {
        if (worker !== next) return;
        const p = pending.get(message.id);
        if (!p) return;
        pending.delete(message.id);
        clearTimeout(p.timer);
        if (message.error || !message.result)
          p.reject(
            failure("Nie udało się odczytać raportu. Odśwież analitykę."),
          );
        else p.resolve(message.result);
        if (!pending.size) next.unref();
      },
    );
    next.on("error", () => {
      if (worker === next)
        void reset("Raport jest chwilowo niedostępny. Odśwież analitykę.");
    });
    next.on("exit", () => {
      if (worker === next)
        void reset("Obliczanie raportu zostało przerwane. Odśwież analitykę.");
    });
    return next;
  }
  function get(raw: unknown): Promise<Report> {
    const { days } = analyticsInput.parse(raw);
    if (closed) return Promise.reject(failure("Raport jest zamknięty."));
    if (stopping) return stopping.then(() => get({ days }));
    // Wspólny odczyt dla równoległych eksportów; wynik nie jest cache'em stanu magazynu.
    for (const p of pending.values()) if (p.days === days) return p.promise;
    if (pending.size >= 4)
      return Promise.reject(
        failure("Trwają inne raporty. Spróbuj ponownie za chwilę."),
      );
    const next = worker ?? start(),
      id = ++sequence;
    let resolve!: Pending["resolve"], reject!: Pending["reject"];
    const promise = new Promise<Report>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => {
      void reset(
        "Przekroczono czas raportu. Zmniejsz okres lub spróbuj ponownie.",
      );
    }, timeoutMs);
    pending.set(id, { days, promise, resolve, reject, timer });
    next.ref();
    next.postMessage({ id, days });
    return promise;
  }
  async function close() {
    closed = true;
    await reset("Raport został zamknięty.");
  }
  return { get, close };
}
