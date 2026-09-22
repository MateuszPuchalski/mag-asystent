import type { Wyjatek } from "../api/dostawy";
import { dataLokalna } from "../ui";

/* ── Szablony protokołu dla dostawcy (0.435.0) ─────────────────────────────
   Przeniesione z `biuro.html` ZNAK W ZNAK co do treści druku. To są wierne
   kopie cudzych formularzy (GEKO, PARTNER) — ich kształt ustalił dostawca,
   nie my, i każda „poprawka" zrobiłaby z nich druk, którego serwis dostawcy
   nie rozpozna. Zmieniło się wyłącznie opakowanie: zamiast `window.open`
   z `document.write` druk ma własny adres w panelu (`/obsluga/druk/...`),
   więc da się go odświeżyć i wkleić koledze.

   Czyste funkcje na tekst, a nie komponenty: szablon to HTML dostawcy
   z własnym arkuszem stylów, a przepisanie go na JSX zmieniłoby druk przy
   pierwszym przeoczonym `<br>`. Każda wartość z bazy przechodzi przez `esc`. */

export interface DokumentDruku { nrPelny: string; dostawca: string; dataWyst: string }

/** Dane zgłaszającego z ustawień — patrz `druk/firma.ts`. */
export type Firma = Partial<Record<"Nazwa" | "Nip" | "Adres" | "Miejscowosc" | "Osoba" | "Telefon", string>>;

export interface Druk { tytul: string; styl: string; tresc: string }

export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* Wartość albo pusto do ręcznego wypełnienia — druk ma wyglądać jak oryginał
   dostawcy także wtedy, gdy dane firmy nie są jeszcze zapisane. */
const albo = (v: string | undefined) => (v ? esc(v) : "");

/* Data LOKALNA, nie doba UTC. Protokół idzie do dostawcy z datą sporządzenia —
   wystawiony po północy czasu polskiego nosiłby datę dnia poprzedniego. */
const dzis = () => dataLokalna(new Date().toISOString());

/* ── Szablon domyślny: protokół rozbieżności WERTIS ─────────────────────────── */
function formularzWertis(dok: DokumentDruku, problemy: Wyjatek[]): Druk {
  const wiersze = problemy.map((p, i) => `<tr>
    <td>${i + 1}</td><td>${esc(p.sym || "")}<br><small>${esc(p.name || "")}</small></td>
    <td>${esc(p.typLabel || p.typ)}</td><td>${p.qty ?? "—"}</td>
    <td>${esc(p.opis || "")}</td><td>${esc(p.createdBy || "")}<br><small>${esc(p.createdAt ? dataLokalna(p.createdAt) : "")}</small></td>
    <td>${p.resolvedAt ? "rozwiązany" : "OTWARTY"}</td>
  </tr>`).join("");
  return {
    tytul: `Protokół rozbieżności · ${dok.nrPelny}`,
    styl: `
      body{font:13px/1.5 system-ui,sans-serif;color:#222;max-width:820px;margin:24px auto;padding:0 16px}
      h1{font-size:18px} h1 small{color:#888;font-weight:400}
      table{width:100%;border-collapse:collapse;margin:14px 0}
      th,td{border:1px solid #999;padding:5px 7px;text-align:left;font-size:12px}
      th{background:#eee}
      .podpisy{display:flex;gap:60px;margin-top:50px}
      .podpisy div{flex:1;border-top:1px solid #222;padding-top:4px;font-size:11px;color:#555;text-align:center}`,
    tresc: `
    <h1>Protokół rozbieżności w dostawie <small>WERTIS</small></h1>
    <p><b>Dokument:</b> ${esc(dok.nrPelny)} &nbsp; <b>Dostawca:</b> ${esc(dok.dostawca || "—")}
       &nbsp; <b>Data dostawy:</b> ${esc(dok.dataWyst || "—")}
       &nbsp; <b>Sporządzono:</b> ${dzis()}</p>
    <table><tr><th>Lp</th><th>Towar</th><th>Rozbieżność</th><th>Policzone</th><th>Opis</th><th>Zgłosił</th><th>Stan</th></tr>
    ${wiersze}</table>
    <div class="podpisy"><div>sporządził</div><div>zatwierdził (dostawca)</div></div>`,
  };
}

/* ── Szablon GEKO: „Protokół zgłoszenia reklamacji B2B" ───────────────────────
   Wierna kopia druku serwisu GEKO (tabela poziomo, checkboxy do ręki, przypisy
   1–4 i klauzula RODO). Wypełniamy to, co system wie: numer FZ, kod i nazwę
   towaru, ilość, opis usterki oraz dane firmy z ustawień. Rodzaj usterki
   i dowód zakupu zaznacza biuro — o tym system wiedzieć nie może. */
function formularzGeko(dok: DokumentDruku, problemy: Wyjatek[], f: Firma): Druk {
  const nrDok = dok.nrPelny;
  const dealer = [f.Nazwa, f.Nip && `NIP ${f.Nip}`, f.Adres].filter(Boolean).map(esc).join("<br>");
  const wiersze = problemy.map((p) => `
    <tr>
      <td class="wask">${esc(nrDok)}</td>
      <td><b>${esc(p.symObcy || p.sym || "")}</b><br><small>${esc(p.name || "")}</small></td>
      <td class="wask">${p.qty ?? ""}</td>
      <td class="check">☐ Mechaniczny&nbsp;&nbsp;☐ Elektryczny</td>
      <td class="check">☐ Faktura&nbsp;&nbsp;☐ Paragon&nbsp;&nbsp;☐ Brak*</td>
      <td rowspan="2" class="osoba">Imię i nazwisko: ${albo(f.Osoba)}<br><br>Nr telefonu: ${albo(f.Telefon)}<br><br>Podpis*:</td>
      <td rowspan="2" class="osoba">${dealer}</td>
    </tr>
    <tr><td colspan="5" class="usterka">Opis usterki: <b>${esc(p.typLabel || p.typ)}</b>${p.opis ? " — " + esc(p.opis) : ""}${p.typ === "qty_mismatch" && p.qtyDok != null ? ` (na dokumencie: ${p.qtyDok}, policzone: ${p.qty})` : ""}</td></tr>`).join("");
  return {
    tytul: `Reklamacja GEKO · ${nrDok}`,
    styl: `
      @page{size:A4 landscape;margin:10mm}
      body{font:11px/1.4 system-ui,sans-serif;color:#111;margin:0 auto;padding:0 8px}
      .naglowek{display:flex;justify-content:space-between;align-items:flex-start;margin:4px 0 10px}
      .naglowek h1{font-size:12px;font-weight:400;flex:1;text-align:center;margin:0}
      .adres{font-size:9px;text-align:right;line-height:1.35}
      .adres b{font-size:13px}
      h2{font-size:11px;text-decoration:underline;font-weight:700;margin:8px 0 4px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #000;padding:4px 6px;text-align:left;vertical-align:top}
      th{font-size:9px;text-align:center;font-weight:700}
      th small{font-weight:400}
      td.wask{white-space:nowrap}
      td.check{white-space:nowrap;text-align:center;vertical-align:middle}
      td.usterka{min-height:40px;height:44px}
      td.osoba{font-size:10px;min-width:130px}
      .przypisy{font-size:8px;line-height:1.35;margin-top:10px}
      .przypisy p{margin:1px 0}
      .rodo{font-size:7px;line-height:1.3;margin-top:6px;color:#222}`,
    tresc: `
    <div class="naglowek">
      <h1>Protokół zgłoszenia reklamacji B2B</h1>
      <div class="adres"><b>GEKO</b><br>GEKO Sp. z o.o. Sp. K<br>97-500 Kietlin, Spacerowa 3<br>NIP 7722420459<br>serwis@geko.pl<br>698 642 358</div>
    </div>
    <h2>Dane dotyczące reklamowanego towaru:</h2>
    <table>
      <tr>
        <th>Nr faktury zakupu<br>[w GEKO]*</th>
        <th>Produkt – kod GEKO<br><small>[KOD konieczny w przypadku produktu,<br>którego ciężko zidentyfikować]</small></th>
        <th>Ilość<br>[szt]</th>
        <th>Rodzaj usterki<br><small>[zaznaczyć odpowiednie]</small></th>
        <th>Kopia dowodu zakupu klienta<br>ostatecznego dołożona do reklamacji<br><small>[zaznaczyć odpowiednie]*</small></th>
        <th>Osoba kontaktowa<br><small>[będąca w temacie reklamacji]<br>*akceptacja poniższych informacji</small></th>
        <th>Nazwa Dealera / NIP (pieczątka)<br><small>[w przypadku oddziału wpisać adres filii]</small></th>
      </tr>
      ${wiersze}
    </table>
    <div class="przypisy">
      <p><b>* akceptacja poniższych informacji</b></p>
      <p>1) Wyrażam zgodę na wystawienie korekty w przypadku uznania słuszności reklamacji w przypadku podjęcia takiej decyzji przez Serwis GEKO.</p>
      <p>2) Przyjmuję do wiadomości, że brak uzupełnionej kolumny „NR FAKTURY ZAKUPU" powoduje wystawienie ewentualnej korekty do faktury wybranej przez Księgowość GEKO. Nie ma możliwości naniesienia zmian w późniejszym terminie do wystawionego dokumentu.</p>
      <p>3) Gwarancja nie obejmuje wad powstałych w czasie transportu lub z winy kupującego. Odpowiednie zabezpieczenie produktu na czas transportu leży po stronie zgłaszającego reklamację.</p>
      <p>4) W przypadku braku dowodu zakupu, reklamacja będzie rozpatrywana jako pogwarancyjna (płatna). Wycena zostanie podana Osobie podanej w formularzu reklamacyjnym. Serwis oczekuje odpowiedzi Klienta i decyzji dotyczącej kosztów naprawy w ciągu 48 godzin od daty wysłania wiadomości e-mail. Po upływie określonego czasu serwis odsyła urządzenie do nadawcy.</p>
      <p class="rodo"><b>Klauzula RODO:</b> Administratorem Twoich danych osobowych jest GEKO Sp. z o.o. Sp.k z siedzibą 97-500 Kietlin, Spacerowa 3 (dalej GEKO). Przekazane przez Państwa dane osobowe będą przetwarzane przez GEKO w celach związanych z wykonaniem Państwa reklamacji na zasadach zgodnie z art. 6. ust. 1 lit. B lub F „RODO". Dane mogą być archiwizowane w razie konieczności obrony przed ewentualnymi roszczeniami wobec GEKO jednak nie dłużej niż moment przedawnienia. Podanie danych jest dobrowolne, ale konieczne do rozpatrzenia reklamacji. Przysługuje Państwu prawo do żądania od GEKO dostępu do swoich danych, ich sprostowania, usunięcia lub ograniczenia przetwarzania, lub sprzeciwu wobec przetwarzania, a także prawo wniesienia skargi do organu nadzorczego.</p>
    </div>`,
  };
}

/* ── Szablon PARTNER: „Protokół zgłoszenia reklamacji" ────────────────────────
   Druk PARTNER opisuje JEDEN towar, więc każdy wyjątek dostaje własną stronę.
   Kropkowane linie zostają tam, gdzie system nie zna odpowiedzi (proponowane
   rozwiązanie to decyzja biura, nie zapis magazyniera). */
function formularzPartner(dok: DokumentDruku, problemy: Wyjatek[], f: Firma): Druk {
  const nrDok = dok.nrPelny;
  const linia = (v: string | undefined, min?: number) => v
    ? `<span class="wpis">${esc(v)}</span>`
    : `<span class="kropki" style="min-width:${min || 320}px"></span>`;
  const strony = problemy.map((p) => {
    const towar = [p.name, p.symObcy || p.sym].filter(Boolean).join(", ");
    const wada = [
      p.typLabel || p.typ,
      p.opis,
      p.qty != null ? `policzone: ${p.qty}` : null,
      p.typ === "qty_mismatch" && p.qtyDok != null ? `na dokumencie: ${p.qtyDok}` : null,
      p.typ === "wrong_item" && p.zamiastIlosc != null ? `zamówiono: ${p.zamiastIlosc}` : null,
    ].filter(Boolean).join(" — ");
    return `
    <section class="strona">
      <h1>PROTOKÓŁ ZGŁOSZENIA REKLAMACJI</h1>
      <p class="data">${f.Miejscowosc ? esc(f.Miejscowosc) + ", " : ""}${dzis()}<br><small>miejscowość, data</small></p>
      <p class="etykieta">DANE KUPUJĄCEGO:</p>
      <p>NAZWA FIRMY: ${linia(f.Nazwa)}</p>
      <p>NIP: ${linia(f.Nip)}</p>
      <p>ADRES: ${linia(f.Adres)}</p>
      <br>
      <p>NR DOKUMENTU ZAKUPU*: <b>${esc(nrDok)}</b></p>
      <p>DATA ZAKUPU: <b>${esc(dok.dataWyst || "")}</b></p>
      <p class="mala">*(warunkiem rozpatrzenia reklamacji jest załączenie kopii dokumentu)</p>
      <br>
      <p class="etykieta">OPIS TOWARU (nazwa, numer katalogowy, producent):</p>
      <p><b>${esc(towar)}</b></p>
      <p class="etykieta">DOKŁADNY OPIS WADY:</p>
      <p><b>${esc(wada)}</b></p>
      <br>
      <p class="etykieta">PROPONOWANE ROZWIĄZANIE (naprawa, faktura korygująca, wymiana):</p>
      <p><span class="kropki" style="min-width:100%"></span></p>
      <p class="oswiadczenie">✓&nbsp; <i>Oświadczam, że zapoznałem się z Informacją o przetwarzaniu danych
        osobowych, która jest dostępna na stronie internetowej
        http://partner-parts.com/polityka-prywatnosci-2/ w Polityce prywatności lub pod adresem
        e-mail: partner@partner-parts.pl.</i></p>
      <p class="podpis"><span class="kropki" style="min-width:220px"></span><br><small>(podpis)</small></p>
    </section>`;
  }).join("");
  return {
    tytul: `Reklamacja PARTNER · ${nrDok}`,
    styl: `
      @page{size:A4;margin:18mm}
      body{font:13px/1.7 system-ui,sans-serif;color:#111;max-width:700px;margin:0 auto;padding:0 8px}
      .strona{page-break-after:always}
      .strona:last-of-type{page-break-after:auto}
      h1{font-size:19px;text-align:center;margin:18px 0 6px;letter-spacing:.5px}
      .data{text-align:right;margin:0 0 18px} .data small{color:#555}
      .etykieta{font-weight:700;margin:14px 0 4px}
      .mala{font-size:11px;color:#333}
      .kropki{display:inline-block;border-bottom:1px dotted #333;height:1.1em;vertical-align:bottom}
      .wpis{font-weight:700;border-bottom:1px dotted #999;padding:0 4px}
      .oswiadczenie{font-size:11px;margin-top:34px;color:#222}
      .podpis{text-align:right;margin-top:40px} .podpis small{color:#555}`,
    tresc: strony,
  };
}

/* Dopasowanie druku do dostawcy — po nazwie z dokumentu FZ. Fragment, nie
   równość: w Subiekcie dostawca to pełna nazwa rejestrowa („GEKO Sp. z o.o.
   Sp. K"), a wzorzec ma przeżyć jej korekty. Bez dopasowania zostaje
   protokół WERTIS. */
const SZABLONY_DOSTAWCOW: Array<{ wzorzec: RegExp; render: typeof formularzGeko }> = [
  { wzorzec: /\bgeko\b/i, render: formularzGeko },
  { wzorzec: /\bpartner\b/i, render: formularzPartner },
];

export function protokol(dok: DokumentDruku, problemy: Wyjatek[], firma: Firma): Druk {
  const szablon = SZABLONY_DOSTAWCOW.find((s) => s.wzorzec.test(dok.dostawca || ""));
  return szablon ? szablon.render(dok, problemy, firma) : formularzWertis(dok, problemy);
}

/** Aneks ze zdjęciami — wspólny dla wszystkich szablonów, jak w biurze. */
export const STYL_ANEKSU = `
  /* Kartka jest biała. Druk rysuje się wewnątrz panelu, a panel ma szare tło
     strony — okno z \`document.write\` w biurze zaczynało od czystej bieli. */
  html,body{background:#fff}
  .aneks{page-break-before:always}
  .aneks h1{font-size:16px}
  figure{margin:14px 0;page-break-inside:avoid}
  figure img{max-width:100%;max-height:420px;border:1px solid #ccc}
  figcaption{font-size:11px;color:#555}
  button.drukuj{position:fixed;top:8px;right:8px;padding:6px 14px}
  @media print { button.drukuj{display:none} }`;
