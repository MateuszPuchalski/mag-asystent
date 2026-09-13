/* Odbiór potwierdza skan każdej paczki i jawne zamknięcie przekazania kurierowi. */
window.WmsHandoff = (h) => {
  let selected = null,
    current = null,
    queue = null,
    q = "",
    offset = 0,
    batchOffset = 0;
  const root = () => document.getElementById("wms-content"),
    { html, field } = h;
  const date = (v) => (v ? new Date(v).toLocaleString("pl-PL") : "—");
  async function render() {
    if (selected) {
      current = await h.read(`/api/wms/handoffs/${selected}`);
      root().innerHTML = `<div class="wms-toolbar"><button data-handoff="list">← Wydania</button><button data-handoff="refresh">Odśwież</button><button data-handoff="csv">Pobierz listę CSV</button></div>
    <section class="wms-surface"><h2>${html(current.carrier)} · przekazanie #${current.id}</h2><div class="wms-quantity">Paczki: ${current.totals.parcels} · ${h.number(current.totals.weightG / 1000)} kg</div>
    ${current.closed_at ? `<p>Potwierdzony odbiór: ${html(date(current.closed_at))}</p>` : `<form id="wms-handoff-scan" class="wms-toolbar">${field("tracking", "Zeskanuj etykietę paczki")}<button>DODAJ PACZKĘ</button></form><p class="wms-help">Skanuj przy fizycznym przekazywaniu. Inny przewoźnik, wstrzymanie i paczka z innego przekazania zatrzymają skan.</p>`}
    <div class="wms-scroll"><table class="wms-lines wms-handoff-table"><thead><tr><th>Paczka / zamówienie</th><th>Masa</th><th>Skan</th><th>Operacja</th></tr></thead><tbody>${current.entries.map((p) => `<tr><td><strong>${html(p.tracking)}</strong><br>${html(p.reference)}</td><td>${p.weight_g} g</td><td>${html(date(p.scanned_at))}</td><td>${current.closed_at ? "Odebrana" : `<button data-handoff-remove="${p.id}">Usuń z przekazania</button>`}</td></tr>`).join("") || '<tr><td colspan="4">Brak zeskanowanych paczek.</td></tr>'}</tbody></table></div><p class="wms-help">Na ekranie ostatnie 50 skanów. CSV obejmuje całe przekazanie.</p><div id="wms-handoff-exception"></div>
    ${current.closed_at ? "" : `<details><summary>Potwierdzenie odbioru przez kuriera</summary><form id="wms-handoff-close" class="wms-form">${current.totals.parcels ? `<label><input name="confirmed" type="checkbox" required> Kurier odebrał wszystkie paczki z listy (${current.totals.parcels}).</label>` : ""}<p class="wms-help">Usuń paczki pozostawione w magazynie przed potwierdzeniem. Zamówienie stanie się wysłane po odbiorze wszystkich jego paczek.</p><button class="primary">${current.totals.parcels ? `POTWIERDŹ ODBIÓR (${current.totals.parcels})` : "ZAMKNIJ PUSTĄ LISTĘ"}</button></form></details>`}</section>`;
      if (!current.closed_at)
        document.getElementById("wms-handoff-exception").innerHTML =
          `<details><summary>Usuń pozostawioną paczkę, również ze starszych skanów</summary><form id="wms-handoff-remove" class="wms-form">${field("tracking", "Numer paczki do usunięcia")}${field("reason", "Powód usunięcia")}<button>USUŃ Z PRZEKAZANIA</button></form></details>`;
      h.focus(document.querySelector('#wms-handoff-scan [name="tracking"]'));
      return;
    }
    queue = await h.read(
      `/api/wms/handoffs?q=${encodeURIComponent(q)}&offset=${offset}&batchOffset=${batchOffset}`,
    );
    root().innerHTML = `<div class="wms-stats">${h.metric("Czeka na odbiór", queue.summary.waiting, "wszystkie dni i przewoźnicy")}${h.metric("Wstrzymane", queue.summary.held || 0, "wymagają wyjaśnienia")}${h.metric("Najstarsza paczka", date(queue.summary.oldest), "data przygotowania")}</div>
   <section class="wms-surface"><h2>Przekazanie kurierowi</h2><form id="wms-handoff-create" class="wms-toolbar"><label>Przewoźnik<select name="carrier" required>${queue.carriers.map((c) => `<option value="${html(c.carrier)}">${html(c.carrier)} · paczki: ${c.parcels}</option>`).join("")}</select></label><button class="primary" ${queue.carriers.length ? "" : "disabled"}>OTWÓRZ PRZEKAZANIE</button></form><div class="wms-actions">${queue.batches
     .slice(0, 50)
     .filter((b) => !b.closed_at)
     .map(
       (b) =>
         `<button data-handoff-open="${b.id}">${html(b.carrier)} #${b.id} · paczki: ${b.parcels}</button>`,
     )
     .join("")}</div></section>
   <section class="wms-surface"><h2>Paczki oczekujące</h2><form id="wms-handoff-filter" class="wms-toolbar"><label>Numer paczki, zamówienie lub przewoźnik<input name="q" value="${html(q)}"></label><button>SZUKAJ</button></form><div class="wms-scroll"><table class="wms-lines"><thead><tr><th>Paczka / przewoźnik</th><th>Zamówienie</th><th>Przygotowano</th><th>Stan / operacja</th></tr></thead><tbody>${
     queue.rows
       .slice(0, 50)
       .map(
         (p) =>
           `<tr><td><strong>${html(p.tracking)}</strong><br>${html(p.carrier)}</td><td><button data-handoff-order="${p.order_id}">${html(p.reference)}</button></td><td>${html(date(p.created_at))}</td><td>${p.hold_reason ? `Wstrzymane: ${html(p.hold_reason)}` : p.batch_id ? `Na przekazaniu #${p.batch_id}` : "Czeka na skan"}${h.office() ? `<br><button data-handoff-correct="${p.id}">Popraw etykietę</button>` : ""}</td></tr>`,
       )
       .join("") || '<tr><td colspan="4">Brak paczek w tym zakresie.</td></tr>'
   }</tbody></table></div><div class="wms-toolbar"><button data-handoff="prev" ${offset ? "" : "disabled"}>Poprzednie</button><button data-handoff="next" ${queue.rows.length > 50 ? "" : "disabled"}>Następne</button></div><div id="wms-handoff-exception"></div></section>
   <details class="wms-surface"><summary>Zamknięte przekazania</summary>${
     queue.batches
       .slice(0, 50)
       .filter((b) => b.closed_at)
       .map(
         (b) =>
           `<p><button data-handoff-open="${b.id}">${html(b.carrier)} #${b.id} · paczki: ${b.parcels}</button> ${html(date(b.closed_at))}</p>`,
       )
       .join("") || "<p>Brak potwierdzonych odbiorów.</p>"
   }</details><div class="wms-toolbar"><button data-handoff="batch-prev" ${batchOffset ? "" : "disabled"}>Nowsze przekazania</button><button data-handoff="batch-next" ${queue.batches.length > 50 ? "" : "disabled"}>Starsze przekazania</button></div>`;
  }
  async function click(button) {
    if (button.dataset.handoffOpen) {
      selected = Number(button.dataset.handoffOpen);
      await h.refresh();
      return true;
    }
    if (button.dataset.handoffOrder) {
      await h.openOrder(Number(button.dataset.handoffOrder));
      return true;
    }
    if (button.dataset.handoffRemove) {
      const p = current.entries.find(
        (p) => p.id === Number(button.dataset.handoffRemove),
      );
      document.getElementById("wms-handoff-exception").innerHTML =
        `<form id="wms-handoff-remove" class="wms-form">${field("tracking", "Paczka pozostająca w magazynie", "text", p.tracking, "readonly")}${field("reason", "Powód usunięcia")}<button>USUŃ Z PRZEKAZANIA</button></form>`;
      h.focus(document.querySelector('#wms-handoff-remove [name="reason"]'));
      return true;
    }
    if (button.dataset.handoffCorrect) {
      const p = queue.rows.find(
        (p) => p.id === Number(button.dataset.handoffCorrect),
      );
      document.getElementById("wms-handoff-exception").innerHTML =
        `<form id="wms-handoff-correct" data-parcel="${p.id}" data-version="${p.version}" class="wms-form"><h3>Korekta etykiety ${html(p.tracking)}</h3><p class="wms-help">Zdejmij starą etykietę i naklej właściwą. Korekta dotyczy ewidencji WMS; nie kupuje ani nie anuluje etykiety u przewoźnika.</p>${field("carrier", "Przewoźnik", "text", p.carrier)}${field("tracking", "Zeskanuj właściwy numer", "text", p.tracking)}${field("weightG", "Masa w gramach", "number", p.weight_g, 'min="1" max="1000000"')}${field("reason", "Powód korekty")}<button>ZAPISZ KOREKTĘ</button></form>`;
      h.focus(document.querySelector('#wms-handoff-correct [name="tracking"]'));
      return true;
    }
    const action = button.dataset.handoff;
    if (!action) return false;
    if (action === "csv") {
      await h.download(
        `/api/wms/handoffs/${selected}/csv`,
        `przekazanie-${selected}.csv`,
      );
      return true;
    }
    if (action === "list") selected = null;
    if (action === "prev") offset = Math.max(0, offset - 50);
    if (action === "next") offset += 50;
    if (action === "batch-prev") batchOffset = Math.max(0, batchOffset - 50);
    if (action === "batch-next") batchOffset += 50;
    await h.refresh();
    return true;
  }
  async function submit(f, v) {
    if (!f.id.startsWith("wms-handoff-")) return false;
    if (f.id === "wms-handoff-filter") {
      q = v.q;
      offset = 0;
      await h.refresh();
      return true;
    }
    let path, body;
    if (f.id === "wms-handoff-create") {
      path = "/api/wms/handoffs";
      body = { carrier: v.carrier };
    }
    if (f.id === "wms-handoff-scan") {
      path = `/api/wms/handoffs/${selected}/scan`;
      body = { tracking: v.tracking };
    }
    if (f.id === "wms-handoff-remove") {
      path = `/api/wms/handoffs/${selected}/remove`;
      body = {
        tracking: v.tracking,
        version: current.version,
        reason: v.reason,
      };
    }
    if (f.id === "wms-handoff-close") {
      path = `/api/wms/handoffs/${selected}/close`;
      body = { version: current.version, parcels: current.totals.parcels };
    }
    if (f.id === "wms-handoff-correct") {
      path = `/api/wms/parcels/${f.dataset.parcel}/correct`;
      body = {
        version: Number(f.dataset.version),
        carrier: v.carrier,
        tracking: v.tracking,
        weightG: Number(v.weightG),
        reason: v.reason,
      };
    }
    if (f.id === "wms-handoff-repack") {
      path = `/api/wms/orders/${f.dataset.order}/reopen-packing`;
      body = {
        version: Number(f.dataset.version),
        tote: v.tote,
        reason: v.reason,
      };
    }
    const result = await h.mutate(path, body);
    if (result) {
      if (f.id === "wms-handoff-create") selected = result.id;
      if (f.id === "wms-handoff-repack") await h.openOrder(result.id);
      else await h.refresh();
      if (f.id === "wms-handoff-scan")
        h.message(
          result.alreadyScanned
            ? "Ta paczka jest już na liście. Skanuj kolejną."
            : "Dodano paczkę. Skanuj kolejną.",
        );
    }
    return true;
  }
  const repackForm = (o) =>
    h.office()
      ? `<details><summary>Wycofaj paczki do ponownej kontroli</summary><form id="wms-handoff-repack" data-order="${o.id}" data-version="${o.version}" class="wms-form"><p>Usuń etykiety. Wszystkie paczki muszą pozostać w magazynie i być usunięte z przekazania.</p>${field("tote", "Zeskanuj pojemnik poza wózkiem")}${field("reason", "Powód ponownej kontroli")}<button>WYCOFAJ PACZKI I SPRAWDŹ ZAWARTOŚĆ</button></form></details>`
      : "";
  return { render, click, submit, repackForm };
};
