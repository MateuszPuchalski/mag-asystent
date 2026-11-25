/* ── Udawane Allegro dla przebiegu przeglądarkowego ──────────────────────────
   Lokalny serwer HTTP, z którym rozmawia PRAWDZIWY klient Allegro naszego
   serwera. Kod wysyłki, wypłaty i werdyktu idzie więc swoją zwykłą drogą:
   token, negocjacja wersji zasobu, nagłówki, ciało, odczyt odpowiedzi.
   Podmieniony jest wyłącznie adres, pod którym stoi druga strona.

   SUROWY, NIE UPRZEJMY. Atrapa, która przyjmuje wszystko, dowodzi tylko tego,
   że nasz serwer coś wysłał. Ta ma odmawiać tam, gdzie odmówiłoby Allegro,
   bo każda z tych odmów ma u nas znany, cichy skutek:

   - 401 bez właściwego tokena. Żądanie bez `authorization` znaczy, że klient
     ominął drogę, która token dokłada.
   - 406 na wersję zasobu, której końcówka nie zna. Sprawy posprzedażowe
     i zwroty klienckie żyją wyłącznie w `beta.v1`. Serwer przyjmujący każdy
     `accept` ukryłby zły nagłówek aż do pierwszej reklamacji na produkcji.
   - 415, gdy ciało nie niesie wersji zasobu w `content-type`. Allegro odrzuca
     wtedy zapis, a w panelu widać z tego tylko „nie udało się”.
   - 422 na ciało bez pól wymaganych przez schemat.
   - 501 na ścieżkę, której tu nie ma. NIE 404: przy odmowie zwrotu wpłaty
     nasz serwer czyta 404 jako „już załatwione”, więc brak końcówki
     w atrapie wyglądałby jak sukces.

   Kształty ciał i odpowiedzi pochodzą ze schematów `docs/allegro/swagger.yaml`
   (`NewMessageInThread`, `Message`, `InitializeRefund`, `RefundDetails`,
   `ClaimStatusChangeRequest`). Wątki, wiadomości i sprawę oddaje w kształcie,
   w jakim zasiał je seed scenariuszy, czytanym z lądowisk bazy.

   KAŻDE żądanie trafia do dziennika razem z kodem odpowiedzi. Test liczy
   żądania PRZYJĘTE, bo negocjacja wersji potrafi wysłać ten sam zapis dwa
   razy: pierwszy odrzucony kodem 406, drugi przyjęty. */
import http from "node:http";
import { randomUUID } from "node:crypto";

const PUBLIC = "application/vnd.allegro.public.v1+json";
const BETA = "application/vnd.allegro.beta.v1+json";

/** Jedenaście wartości `ClaimStatusChangeRequest.status` ze schematu. */
const WERDYKTY = [
  "ACCEPTED_REPAIR", "ACCEPTED_REFUND", "ACCEPTED_EXCHANGE", "ACCEPTED_PARTIAL_REFUND",
  "REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED", "REJECTED_PRODUCT_NOT_RETURNED",
  "REJECTED_PRODUCT_DAMAGED_BY_USER", "REJECTED_PRODUCT_CONFORMS_TO_CONTRACT",
  "REJECTED_MINOR_DEFECT", "REJECTED_OTHER", "REJECTED_CLAIM_WITHDRAWN_BY_BUYER",
];
const POWODY_WYPLATY = [
  "REFUND", "COMPLAINT", "PRODUCT_NOT_AVAILABLE", "PAID_VALUE_TOO_LOW", "OVERPAID",
  "CANCELLED_BY_BUYER", "NOT_COLLECTED",
];

const blad = (kod, opis) => ({ errors: [{ code: kod, message: opis }] });

/**
 * @param {{ port: number, token: string,
 *   watki: object[], wiadomosci: Record<string, object[]>, sprawy: object[] }} opcje
 *   Wątki, wiadomości i sprawy w kształcie Allegro, wzięte z bazy po seedzie.
 */
export function uruchomUdawaneAllegro({ port, token, watki, wiadomosci, sprawy }) {
  const stanWatkow = new Map(watki.map((w) => [w.id, structuredClone(w)]));
  const stanWiadomosci = new Map(Object.entries(wiadomosci).map(([id, l]) => [id, structuredClone(l)]));
  const stanSpraw = new Map(sprawy.map((s) => [s.id, structuredClone(s)]));
  /** @type {object[]} */
  const dziennik = [];

  const serwer = http.createServer((zadanie, odpowiedz) => {
    let surowe = "";
    zadanie.on("data", (c) => { surowe += c; });
    zadanie.on("end", () => {
      const adres = new URL(zadanie.url ?? "/", "http://udawane");
      const sciezka = adres.pathname;
      const metoda = zadanie.method ?? "GET";
      const json = (kod, tresc, typ = "application/json") => {
        odpowiedz.writeHead(kod, tresc === undefined ? {} : { "content-type": typ });
        odpowiedz.end(tresc === undefined ? undefined : JSON.stringify(tresc));
      };

      /* ── Sterowanie testem ─────────────────────────────────────────────────
         Poza dziennikiem i poza bramkami: to nie są końcówki Allegro, tylko
         uchwyty testu. Przedrostek, którego Allegro nie ma, żeby nasz serwer
         nie mógł trafić w nie przez pomyłkę w adresie. */
      if (sciezka === "/__e2e/zdrowie") return json(200, { ok: true });
      if (sciezka === "/__e2e/dziennik") return json(200, dziennik);
      if (sciezka === "/__e2e/dopisz" && metoda === "POST") {
        /* Klient dopisuje w wątku. Wiadomości z seeda zostają z TYMI SAMYMI
           numerami, bo synchronizacja rozpoznaje je po numerze: nowy numer
           starej wiadomości dałby jej drugi egzemplarz na osi. */
        const { watek, tekst } = JSON.parse(surowe);
        const w = stanWatkow.get(watek);
        if (!w) return json(404, blad("BRAK_WATKU", watek));
        const kiedy = new Date().toISOString();
        const nowa = {
          id: `scenariusz-dopisek-${randomUUID()}`, status: "DELIVERED", type: "MESSAGE_CENTER",
          createdAt: kiedy, thread: { id: watek },
          author: { login: w.interlocutor.login, isInterlocutor: true },
          text: tekst, subject: null, relatesTo: {}, hasAdditionalAttachments: false, attachments: [],
        };
        stanWiadomosci.set(watek, [nowa, ...(stanWiadomosci.get(watek) ?? [])]);
        w.lastMessageDateTime = kiedy;
        w.read = false;
        return json(200, { id: nowa.id });
      }

      const accept = zadanie.headers.accept ?? "";
      const typTresci = zadanie.headers["content-type"] ?? null;
      let cialo = null;
      let zleCialo = false;
      if (surowe !== "") {
        try { cialo = JSON.parse(surowe); } catch { zleCialo = true; }
      }
      const wpis = {
        metoda, sciezka, zapytanie: adres.search, accept, contentType: typTresci,
        autoryzacja: Boolean(zadanie.headers.authorization), cialo, kod: 0, przyjete: false,
        odpowiedz: null,
      };
      const odp = (kod, tresc) => {
        wpis.kod = kod;
        wpis.przyjete = kod >= 200 && kod < 300;
        /* Odpowiedź w dzienniku, bo test porównuje numer nadany tutaj z tym,
           co nasz serwer zapisał i pokazał: sam fakt wysłania nie mówi, że
           odpowiedź została przeczytana. */
        wpis.odpowiedz = tresc ?? null;
        dziennik.push(wpis);
        json(kod, tresc, kod < 300 ? accept : "application/json");
      };

      if (zadanie.headers.authorization !== `Bearer ${token}`) {
        return odp(401, blad("UNAUTHORIZED", "Brak albo zły token dostępu"));
      }

      /* Wersja zasobu per rodzina, jak w specyfikacji. Wiadomości znają też
         `beta.v1`, ale z INNYM kształtem wątku, którego ta atrapa nie umie.
         Oddanie kształtu `public.v1` pod nagłówkiem bety byłoby kłamstwem,
         więc beta dostaje tu 406 i klient ma przy niej nie zostać. */
      const tylkoBeta = sciezka.startsWith("/sale/issues") || sciezka.startsWith("/order/customer-returns");
      const wersja = tylkoBeta ? BETA : PUBLIC;
      if (accept !== wersja) {
        return odp(406, blad("NotAcceptableException", `Ta końcówka zna wyłącznie ${wersja}`));
      }
      if (surowe !== "" && typTresci !== wersja) {
        return odp(415, blad("UnsupportedMediaTypeException", `Ciało musi nieść ${wersja}`));
      }
      if (zleCialo) return odp(400, blad("BAD_REQUEST", "Ciało nie jest poprawnym JSON-em"));

      let m;

      /* ── Centrum wiadomości ─────────────────────────────────────────────── */
      if (metoda === "GET" && sciezka === "/messaging/threads") {
        const offset = Number(adres.searchParams.get("offset") ?? 0);
        const limit = Number(adres.searchParams.get("limit") ?? 20);
        const lista = [...stanWatkow.values()]
          .sort((a, b) => String(b.lastMessageDateTime).localeCompare(String(a.lastMessageDateTime)));
        return odp(200, { threads: lista.slice(offset, offset + limit), offset, limit });
      }
      if ((m = /^\/messaging\/threads\/([^/]+)\/messages$/.exec(sciezka))) {
        const watek = decodeURIComponent(m[1]);
        const w = stanWatkow.get(watek);
        if (!w) return odp(404, blad("NOT_FOUND", `Nie ma wątku ${watek}`));
        if (metoda === "GET") {
          const offset = Number(adres.searchParams.get("offset") ?? 0);
          const limit = Number(adres.searchParams.get("limit") ?? 20);
          const lista = stanWiadomosci.get(watek) ?? [];
          return odp(200, { messages: lista.slice(offset, offset + limit), offset, limit });
        }
        if (metoda === "POST") {
          /* `NewMessageInThread`: `text` wymagany, najwyżej 2000 znaków. */
          if (typeof cialo?.text !== "string" || cialo.text === "" || cialo.text.length > 2000) {
            return odp(422, blad("VALIDATION_ERROR", "Pole text jest wymagane i ma najwyżej 2000 znaków"));
          }
          const kiedy = new Date().toISOString();
          const nowa = {
            id: randomUUID(), status: "DELIVERED", type: "MESSAGE_CENTER", createdAt: kiedy,
            thread: { id: watek }, author: { login: "sprzedawca.scenariuszy", isInterlocutor: false },
            text: cialo.text, subject: null, relatesTo: {}, hasAdditionalAttachments: false, attachments: [],
          };
          stanWiadomosci.set(watek, [nowa, ...(stanWiadomosci.get(watek) ?? [])]);
          w.lastMessageDateTime = kiedy;
          return odp(201, nowa);
        }
      }

      /* ── Zwrot płatności ────────────────────────────────────────────────── */
      if (metoda === "POST" && sciezka === "/payments/refunds") {
        /* `InitializeRefund`: cztery pola wymagane, `reason` z wyliczenia. */
        const brak = ["payment", "order", "commandId", "reason"].filter((p) => cialo?.[p] == null || cialo[p] === "");
        if (brak.length > 0 || !cialo.payment.id || !cialo.order.id || !POWODY_WYPLATY.includes(cialo.reason)) {
          return odp(422, blad("VALIDATION_ERROR", `Niepełne polecenie zwrotu płatności: ${brak.join(", ") || "payment.id, order.id albo reason"}`));
        }
        /* `RefundLineItem`: `id` i `type` wymagane, a przy `QUANTITY` liczba
           sztuk. Linia bez nich oddałaby u Allegro co innego, niż policzył
           nasz serwer, więc nie może tu przejść jako poprawna. */
        const zlaLinia = (cialo.lineItems ?? []).find((l) => !l?.id
          || !["AMOUNT", "QUANTITY"].includes(l.type)
          || (l.type === "QUANTITY" && !(Number(l.quantity) > 0))
          || (l.type === "AMOUNT" && !(l.value?.amount && l.value?.currency)));
        if (!Array.isArray(cialo.lineItems ?? []) || zlaLinia) {
          return odp(422, blad("VALIDATION_ERROR", "Linia zwrotu płatności niezgodna ze schematem RefundLineItem"));
        }
        return odp(200, {
          id: randomUUID(), payment: { id: cialo.payment.id }, order: { id: cialo.order.id },
          reason: cialo.reason, status: "IN_PROGRESS", createdAt: new Date().toISOString(),
          totalValue: { amount: "0.00", currency: "PLN" },
          ...(cialo.lineItems ? { lineItems: cialo.lineItems } : {}),
          ...(cialo.delivery ? { delivery: cialo.delivery } : {}),
        });
      }

      /* ── Sprawy posprzedażowe ───────────────────────────────────────────── */
      if ((m = /^\/sale\/issues\/([^/]+)\/status$/.exec(sciezka)) && metoda === "POST") {
        const sprawa = stanSpraw.get(decodeURIComponent(m[1]));
        if (!sprawa) return odp(404, blad("NOT_FOUND", "Nie ma takiej sprawy"));
        /* `ClaimStatusChangeRequest`: `status` z wyliczenia i `message`. */
        if (!WERDYKTY.includes(cialo?.status) || typeof cialo?.message !== "string" || cialo.message === "") {
          return odp(400, blad("BAD_REQUEST", "Werdykt wymaga status z wyliczenia i message"));
        }
        /* Zmienia się WYŁĄCZNIE status sprawy. Czat zostaje, jak był: werdykt
           nie jest wiadomością czatu, a dopisanie jej tutaj przestawiłoby
           sprawę w kolejce na miejsce, którego Allegro jej nie daje. */
        sprawa.currentState = {
          ...sprawa.currentState,
          status: cialo.status.startsWith("ACCEPTED") ? "CLAIM_ACCEPTED" : "CLAIM_REJECTED",
        };
        return odp(200, undefined);
      }
      if ((m = /^\/sale\/issues\/([^/]+)\/chat$/.exec(sciezka)) && metoda === "GET") {
        if (!stanSpraw.has(decodeURIComponent(m[1]))) return odp(404, blad("NOT_FOUND", "Nie ma takiej sprawy"));
        return odp(200, { chat: [] });
      }
      if ((m = /^\/sale\/issues\/([^/]+)$/.exec(sciezka)) && metoda === "GET") {
        /* PEŁNY ładunek sprawy. Nasz serwer nadpisuje nim wiersz, więc pole
           pominięte tutaj wróciłoby do bazy jako puste. */
        const sprawa = stanSpraw.get(decodeURIComponent(m[1]));
        return sprawa ? odp(200, sprawa) : odp(404, blad("NOT_FOUND", "Nie ma takiej sprawy"));
      }

      return odp(501, blad("BRAK_W_UDAWANYM_ALLEGRO", `${metoda} ${sciezka} nie ma tu obsługi`));
    });
  });

  return new Promise((gotowe, nieudane) => {
    serwer.once("error", nieudane);
    serwer.listen(port, "127.0.0.1", () => gotowe(serwer));
  });
}
