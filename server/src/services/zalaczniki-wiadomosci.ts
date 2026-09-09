import type { DatabaseSync } from "node:sqlite";
import { odkodujEncje } from "../tekst.js";

/* ── Zapis załączników wiadomości Centrum Wiadomości ─────────────────────────
   Jedno miejsce dla trzech dróg: synchronizacji (każdy przebieg), dociągu
   wątków ze stanem `NEW` i dosypki z lądowiska przy starcie (`db.ts`).
   Osobny moduł bez `db.js`, żeby migracja mogła go wołać bez cyklu importów.

   KLUCZ TO `(message_id, file_name)`. `url` bywa pusty (`EXPIRED`), a `fileName`
   jest jedynym WYMAGANYM polem identyfikującym w `MessageAttachmentInfo`.
   Dwie pozycje o tej samej nazwie w jednej wiadomości zlewamy — dla agenta
   i tak byłyby nierozróżnialne, ostatnia wygrywa.

   UPSERT, nie „tylko z nową wiadomością" (blizna tego wydania): do 0.242.0
   załączniki wchodziły wyłącznie razem z pierwszym wstawieniem wiadomości,
   więc `NEW` („Allegro jeszcze sprawdza") zostawało zamrożone na zawsze,
   a wiadomości sprzed 0.155.0 nigdy nie dostały swoich zdjęć.              */

export interface ZalacznikAllegro {
  fileName: string;
  mimeType?: string | null;
  url?: string | null;
  status: string;
}

/** Zapisuje listę załączników wiadomości; oddaje liczbę wierszy, które dotknął. */
export function zapiszZalaczniki(
  database: DatabaseSync, messageId: number, lista: ZalacznikAllegro[] | null | undefined,
): number {
  if (!lista?.length) return 0;
  const poNazwie = new Map<string, ZalacznikAllegro>();
  for (const z of lista) {
    if (typeof z?.fileName !== "string" || typeof z?.status !== "string") continue;
    poNazwie.set(odkodujEncje(z.fileName), z);
  }
  const ins = database.prepare(`INSERT INTO message_attachment(message_id, file_name, mime_type, url, status)
    VALUES (?,?,?,?,?)
    ON CONFLICT(message_id, file_name) DO UPDATE SET
      mime_type=excluded.mime_type, url=excluded.url, status=excluded.status`);
  let n = 0;
  for (const [nazwa, z] of poNazwie) {
    n += Number(ins.run(messageId, nazwa, z.mimeType ?? null, z.url ?? null, z.status).changes);
  }
  return n;
}
