import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { WERSJA } from "../wersja.js";
import { SCHEMAT_PAROWANIA, adresyLan, hostOgloszeniowy } from "../services/parowanie.js";
import { qrSvg } from "../services/qr.js";

/* ── Strona parowania — kod QR z adresem serwera ─────────────────────────────
   Do wydrukowania i naklejenia przy ładowarce kolektorów. Magazynier skanuje
   ją tym samym skanerem, którym skanuje półki, i kolektor zna adres serwera.

   Strona jest POZA `/api/`, więc nie dotyczy jej bramka sesji — i tak musi
   być, bo służy urządzeniu, które jeszcze nie umie się zalogować (nie wie
   dokąd). Nie wynosi to niczego na zewnątrz: jedyne, co pokazuje, to adres
   IP maszyny, którą trzeba już umieć znaleźć, żeby tę stronę otworzyć.

   Bez `<script>` i bez pobierania czegokolwiek — kod QR jest wygenerowanym
   po stronie serwera SVG-iem wklejonym w treść. Strona ma działać wydrukowana,
   a wydruk nie wykonuje JavaScriptu.                                          */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Jeden adres: kod QR, adres do przepisania i podpis. */
function kafelek(ip: string, glowny: boolean): string {
  const kod = `${SCHEMAT_PAROWANIA}${ip}:${config.port}`;
  return `
    <figure class="kafelek${glowny ? " glowny" : ""}">
      ${qrSvg(kod, { opis: `Adres serwera WERTIS ${ip} port ${config.port}` })}
      <figcaption>
        <strong>http://${esc(ip)}:${config.port}</strong>
        ${glowny ? "" : '<span class="uwaga">druga karta sieciowa</span>'}
      </figcaption>
    </figure>`;
}

function strona(): string {
  const glowny = hostOgloszeniowy();
  const pozostale = adresyLan().filter((a) => a !== glowny);

  const tresc = glowny
    ? `${kafelek(glowny, true)}${pozostale.map((a) => kafelek(a, false)).join("")}`
    : `<p class="pusto">Ten serwer nie widzi żadnej karty sieciowej z adresem w LAN,
         więc nie ma czego pokazać kolektorowi. Sprawdź połączenie sieciowe maszyny,
         a przy dwóch kartach ustaw <code>HOST</code> w <code>wertis.env</code>.</p>`;

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WERTIS — parowanie kolektora</title>
<style>
  :root { --amber:#F7A600; --grafit:#2A2A2C; --papier:#F6F5F2; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 20px; background:var(--papier); color:var(--grafit);
         font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size:28px; margin:0 0 4px; letter-spacing:-.01em; }
  h1 span { color:var(--amber); }
  .pod { color:#6b6b70; margin:0 0 28px; }
  .kafelki { display:flex; flex-wrap:wrap; gap:24px; }
  .kafelek { margin:0; background:#fff; border:1px solid #e3e1dc; border-radius:12px;
             padding:16px; text-align:center; flex:0 0 auto; }
  .kafelek svg { width:200px; height:200px; display:block; }
  .kafelek.glowny svg { width:280px; height:280px; }
  figcaption { margin-top:10px; font-size:14px; }
  figcaption strong { display:block; font-family:ui-monospace,"Cascadia Code",monospace; }
  .uwaga { color:#8a8a90; font-size:12px; }
  ol { padding-left:20px; margin:28px 0 0; }
  li { margin:6px 0; }
  .ostrzezenie { margin-top:28px; padding:14px 16px; border-left:4px solid var(--amber);
                 background:#fff; border-radius:0 8px 8px 0; font-size:14px; }
  code { background:#eeece7; padding:1px 5px; border-radius:4px; font-size:.92em; }
  footer { margin-top:32px; color:#8a8a90; font-size:12px; }
  .pusto { background:#fff; border-radius:12px; padding:20px; }
  @media print {
    body { background:#fff; padding:0; }
    .kafelek { border-color:#bbb; break-inside:avoid; }
    ol, .ostrzezenie, footer { font-size:12px; }
  }
</style>
</head>
<body>
<main>
  <h1>WERTIS · <span>parowanie kolektora</span></h1>
  <p class="pod">Zeskanuj ten kod skanerem kolektora, żeby ustawić adres serwera bez wpisywania.</p>

  <div class="kafelki">${tresc}</div>

  <ol>
    <li>Na kolektorze otwórz ekran startowy i naciśnij <strong>POŁĄCZ Z SERWEREM</strong>.</li>
    <li>Zeskanuj kod powyżej — tym samym skanerem, którym skanujesz półki.</li>
    <li>Kolektor pokaże adres do potwierdzenia. Sprawdź, czy zgadza się z napisem pod kodem.</li>
  </ol>

  <p class="ostrzezenie">
    <strong>Wydrukuj i powieś przy ładowarce kolektorów.</strong>
    Kod przestaje być aktualny, gdy maszyna dostanie inny adres IP — dlatego adres
    powinien być zarezerwowany na routerze (rezerwacja DHCP, <code>DEPLOY.md</code> §4).
    Po zmianie adresu odśwież tę stronę i wydrukuj ją ponownie.
  </p>

  <footer>serwer ${esc(WERSJA)} · port ${config.port}</footer>
</main>
</body>
</html>`;
}

export async function parowanieRoutes(app: FastifyInstance) {
  /* Strona jest budowana PER ŻĄDANIE, inaczej niż `/biuro`, i to jest różnica
     z powodem: adres IP maszyny zmienia się bez restartu usługi (nowa dzierżawa
     DHCP, przepięty kabel). Strona parowania z nieaktualnym adresem byłaby
     gorsza od jej braku — wysyłałaby magazyniera do serwera, którego tam nie ma.
     Koszt to jeden kod QR na wejście, czyli ułamek milisekundy raz na wdrożenie. */
  app.get("/parowanie", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(strona())
  );

  /* Ten sam adres maszynowo — do skryptowego wypełnienia konfiguracji MDM.

     ZOSTAJE ZA BRAMKĄ SESJI, mimo że strona obok jest otwarta, i nie jest to
     niekonsekwencja. Strony `/parowanie` potrzebuje urządzenie, które NIE MA
     jeszcze jak się zalogować; tej trasy potrzebuje administrator, który konto
     ma dawno. Lista tras bez sesji w `context.ts` jest krótka dlatego, że
     każda pozycja musi być konieczna — a ta nie jest. */
  app.get("/api/parowanie", async () => ({
    adres: hostOgloszeniowy() ? `http://${hostOgloszeniowy()}:${config.port}` : null,
    kod: hostOgloszeniowy() ? `${SCHEMAT_PAROWANIA}${hostOgloszeniowy()}:${config.port}` : null,
    pozostaleAdresy: adresyLan().filter((a) => a !== hostOgloszeniowy()),
    wersja: WERSJA,
  }));
}
