import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";

/* ── ETag dla odczytów API ──────────────────────────────────────────────────
   Kolektor odpytuje kartę i półkę co 2 s, a kolejkę co 1,5 s — i w ogromnej
   większości cykli odpowiedź jest bajt w bajt ta sama. ETag liczony z ciała
   pozwala mu wysłać `If-None-Match` i dostać puste 304 zamiast pełnego
   JSON-a; po stronie OkHttp dzieje się to samo z siebie, gdy klient ma
   włączony cache dyskowy.

   `Cache-Control: no-cache` to nie zakaz cache'owania, tylko przymus
   rewalidacji: klient MUSI zapytać serwera, zanim użyje kopii. Stany
   magazynowe nigdy nie są przez to serwowane z dysku bez potwierdzenia,
   a offline OkHttp takiej odpowiedzi nie poda wcale — bufor offline
   pozostaje jedynym właścicielem zachowania bez sieci.

   Hash liczony z FAKTYCZNEGO ciała odpowiedzi nie może skłamać — nie ma tu
   żadnego unieważniania, które dałoby się przeoczyć. Warunek `typeof payload
   === "string"` omija strumienie (zdjęcia) i wszystko, co nie jest gotowym
   JSON-em/CSV. Bez `Vary` po nagłówkach tożsamości: odpowiedzi różnych kont
   różnią się ciałem, więc i ETagiem, a `Vary` po `x-session` zabiłby cache
   OkHttp kluczowany po URL-u. */
export function withEtag(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.method !== "GET" || reply.statusCode !== 200) return payload;
    if (typeof payload !== "string" || payload.length === 0) return payload;
    if (!req.url.startsWith("/api/")) return payload;
    // trasa, która sama ustawiła politykę cache (zdjęcia), zna ją lepiej
    if (reply.getHeader("cache-control")) return payload;

    const etag = `"${crypto.createHash("sha1").update(payload).digest("base64url")}"`;
    reply.header("etag", etag);
    reply.header("cache-control", "no-cache");
    if (req.headers["if-none-match"] === etag) {
      reply.code(304);
      return "";
    }
    return payload;
  });
}
