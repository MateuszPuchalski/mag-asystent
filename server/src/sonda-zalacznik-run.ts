import { config, envFile } from "./config.js";
import { bezMigracji, db } from "./db/db.js";
import { powodBrakuKonta, stanPolaczenia } from "./services/allegro-token.js";
import { sondujZalacznik } from "./adapters/allegro.http.js";
import { tabelaSondy, werdyktSondy } from "./services/sonda-zalacznik.js";

/* ── Sonda JEDNEGO załącznika Centrum Wiadomości (`npm run sonda:zalacznik`) ──
   Skrzynka nie pokazuje zdjęć, bo `upload.allegro.pl` odmawia 403, a droga
   API z tutorialu Allegro jest wnioskiem z pamięci ([WERYFIKUJ] w
   `docs/allegro-ksztalt.md`). Ta sonda odpowiada na to pytanie w minutę,
   na żywym koncie, bez oglądania zdjęcia: kody, typy i liczby bajtów.

   Nie `/api/health`: trasa bez sesji, która przy każdym otwarciu biłaby
   w Allegro, byłaby tickerem w przebraniu.

   Argument: numer wiersza `message_attachment`; bez niego — najnowszy `SAFE`
   z adresem. Załącznik nazywany numerem i rozszerzeniem, nigdy adresem.   */

bezMigracji();

async function main(): Promise<void> {
  const stan = stanPolaczenia();
  if (stan.stan !== "polaczone") {
    console.error(
      "Sonda czyta ŻYWE konto Allegro i bez połączenia nie ma czego oglądać.\n" +
        powodBrakuKonta(stan.stan, envFile.path) + `\n(stan połączenia: ${stan.stan})`);
    process.exitCode = 1;
    return;
  }
  const id = process.argv[2] ? Number(process.argv[2]) : null;
  const w = (id
    ? db().prepare("SELECT id, file_name, url, status FROM message_attachment WHERE id=?").get(id)
    : db().prepare(`SELECT id, file_name, url, status FROM message_attachment
        WHERE status='SAFE' AND url IS NOT NULL ORDER BY id DESC LIMIT 1`).get()
  ) as { id: number; file_name: string; url: string | null; status: string } | undefined;
  if (!w || !w.url) {
    console.error(id
      ? `Załącznik #${id} nie istnieje albo nie ma adresu.`
      : "W bazie nie ma żadnego załącznika SAFE z adresem — zsynchronizuj skrzynkę i spróbuj znowu.");
    process.exitCode = 1;
    return;
  }
  const rozszerzenie = (w.file_name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "?").toLowerCase();
  console.log(`# Sonda załącznika #${w.id} (${rozszerzenie}, stan ${w.status}), środowisko \`${config.allegro.apiUrl}\`\n`);
  const wyniki = await sondujZalacznik(config.allegro.apiUrl, w.url);
  console.log(tabelaSondy(wyniki));
  console.log(`\n${werdyktSondy(wyniki)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
