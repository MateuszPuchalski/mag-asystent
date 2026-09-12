/* Przyjęcie zapisuje skan i zapas razem; podgląd dokumentu nie przyjmuje towaru. */
window.WmsInbound = (h) => {
  const putaway = window.WmsPutaway(h);
  let queue = false,
    receivingMode = "direct";
  let selected = null,
    document = null,
    line = null,
    q = "",
    closed = "0",
    offset = 0,
    historyOffset = 0,
    historyOpen = false;
  const target = () => window.document.getElementById("wms-content");
  const form = () => window.document.getElementById("wms-inbound-putaway");
  const { html, field } = h;
  const date = (value) =>
    value ? new Date(value).toLocaleString("pl-PL") : "—";
  async function render() {
    window.document
      .getElementById("widokWms")
      .classList.remove("wms-inbound-focus", "wms-putaway-focus");
    line = null;
    if (queue) return putaway.render();
    if (selected) {
      document = await h.read(
        `/api/wms/inbound/${selected}?historyOffset=${historyOffset}`,
      );
      const remaining = document.lines.reduce(
        (n, l) => n + Math.max(0, l.expected - l.received),
        0,
      );
      target().innerHTML = `<div class="wms-toolbar"><button data-inbound="list">← Przyjęcia</button><button data-inbound="refresh">Odśwież</button><button data-inbound="putaway">Odkładanie z bufora</button></div>
        <section class="wms-surface"><h2>${html(document.reference)}</h2><p>${html(document.supplier)} · ${document.lines.reduce((n, l) => n + (l.awaiting_putaway || 0), 0)} szt. w buforze · ${document.closed_at ? "Zamknięte" : `${remaining} szt. do rozliczenia`}</p>
        ${document.closed_at ? `<p>Zamknięto: ${html(date(document.closed_at))}. ${html(document.close_reason)}</p>` : `<label class="wms-receiving-mode">Sposób przyjęcia<select id="wms-receiving-mode"><option value="direct">Od razu na półkę</option><option value="buffer" ${receivingMode === "buffer" ? "selected" : ""}>Do bufora — odkładanie później</option></select></label><form id="wms-inbound-scan" class="wms-toolbar">${field("barcode", "Zeskanuj towar / SKU")}<button>OTWÓRZ POZYCJĘ</button></form>`}
        <div id="wms-inbound-task"></div><details><summary>Pozycje dokumentu (${document.lines.length})</summary><p class="wms-help">Pokazano pierwsze 50 pozycji. Skan wyszukuje w całym dokumencie.</p><div class="wms-scroll"><table class="wms-lines"><thead><tr><th>SKU / część</th><th>Oczekiwane</th><th>Policzone</th><th>Uszkodzone</th></tr></thead><tbody>${document.lines
          .slice(0, 50)
          .map(
            (l) =>
              `<tr><td>${document.closed_at ? html(l.sku) : `<button data-inbound-line="${l.id}">${html(l.sku)}</button>`}<br>${html(l.name)}</td><td>${l.expected}</td><td>${l.received}</td><td>${l.damaged}</td></tr>`,
          )
          .join("")}</tbody></table></div></details>
        ${document.closed_at ? "" : `<details><summary>Zakończenie dostawy</summary><p>${remaining ? `Brakuje ${remaining} szt. Możesz pozostawić dokument otwarty na kolejną partię. Zamknięcie z brakiem wymaga biura i uzasadnienia.` : "Wszystkie oczekiwane sztuki zostały rozliczone."}</p><form id="wms-inbound-close" class="wms-form"><label>Uzasadnienie / uwagi<textarea name="reason" maxlength="500" ${remaining ? "required minlength=3" : ""}></textarea></label><button ${remaining && !h.office() ? "disabled" : ""}>ZAMKNIJ PRZYJĘCIE</button></form></details>`}</section>
        <details class="wms-surface"><summary>Ostatnie odłożenia</summary>${document.putaways.map((p) => `<p>${html(p.sku)} · ${p.quantity} szt. → <strong>${html(p.bin)}</strong>${p.work_id ? ` · Bufor: ${p.remaining} szt. do odłożenia` : ""} · ${p.disposition === "damaged" ? "Uszkodzone" : "Pełnowartościowe"} · ${html(date(p.created_at))}${p.reason ? ` · ${html(p.reason)}` : ""}${p.reversed_at ? ` · Wycofano: ${html(p.reversal_reason)}` : !p.work_id && !document.closed_at && h.office() ? ` <button data-inbound-reverse="${p.id}">Korekta odłożenia</button>` : ""}</p>`).join("") || "<p>Brak odłożeń. Sam dokument nie dodaje zapasu.</p>"}<div id="wms-inbound-correction"></div></details>
        ${document.closed_at && h.office() ? `<details class="wms-surface"><summary>Ponowne otwarcie — korekta lub kolejna partia</summary><form id="wms-inbound-reopen" class="wms-form">${field("reason", "Powód ponownego otwarcia")}<button>OTWÓRZ PONOWNIE</button></form></details>` : ""}`;
      const mode = window.document.getElementById("wms-receiving-mode");
      mode?.addEventListener("change", () => {
        receivingMode = mode.value;
      });
      const history = window.document.getElementById(
        "wms-inbound-correction",
      ).parentElement;
      history.open = historyOpen;
      history.insertAdjacentHTML(
        "beforeend",
        `<div class="wms-toolbar"><button data-inbound="history-prev" ${historyOffset === 0 ? "disabled" : ""}>Nowsze</button><span>${Math.min(historyOffset + 1, document.putawayCount)}–${Math.min(historyOffset + 100, document.putawayCount)} z ${document.putawayCount}</span><button data-inbound="history-next" ${historyOffset + 100 >= document.putawayCount ? "disabled" : ""}>Starsze</button></div>`,
      );
      h.focus(
        window.document.querySelector('#wms-inbound-scan [name="barcode"]'),
      );
      return;
    }
    const data = await h.read(
      `/api/wms/inbound?q=${encodeURIComponent(q)}&closed=${closed}&offset=${offset}`,
    );
    target().innerHTML = `<div class="wms-toolbar"><button data-inbound="putaway">ODKŁADANIE Z BUFORA</button></div><form id="wms-inbound-filter" class="wms-toolbar">${field("q", "Dokument lub dostawca", "text", q)}<label>Zakres<select name="closed"><option value="0">Otwarte</option><option value="1" ${closed === "1" ? "selected" : ""}>Zamknięte</option></select></label><button>SZUKAJ</button></form>
      <section class="wms-surface"><h2>Przyjęcia dostaw</h2><p class="wms-help">Skan towaru → ilość → lokalizacja. Przyjmij od razu na półkę albo do bufora zaplecza i odłóż później. Nie przyjmuj tego dokumentu ponownie w Zapasach.</p>
      <div class="wms-scroll"><table class="wms-lines"><thead><tr><th>Dokument / dostawca</th><th>Policzone / oczekiwane</th><th>Brakujące</th><th>Utworzono</th></tr></thead><tbody>${data.rows.map((d) => `<tr><td><button data-inbound-open="${d.id}">${html(d.reference)}</button><br>${html(d.supplier)}</td><td>${d.received} / ${d.expected}${d.damaged ? `<br>${d.damaged} uszkodzonych` : ""}</td><td>${d.remaining}</td><td>${html(date(d.created_at))}</td></tr>`).join("") || '<tr><td colspan="4">Brak dokumentów w tym zakresie.</td></tr>'}</tbody></table></div><div class="wms-toolbar"><button data-inbound="prev" ${offset === 0 ? "disabled" : ""}>Poprzednie</button><span>${data.total} dokumentów</span><button data-inbound="next" ${offset + 50 >= data.total ? "disabled" : ""}>Następne</button></div></section>
      ${h.office() ? `<details class="wms-surface"><summary>Nowa dostawa</summary><form id="wms-inbound-create" class="wms-form">${field("reference", "Unikalny numer przyjęcia / dokumentu")}${field("supplier", "Dostawca")}<label>Oczekiwane pozycje — SKU;ilość<textarea name="lines" required placeholder="WMS-0030;10" maxlength="600000"></textarea></label><p class="wms-help">Do 5000 SKU. Wklej kolumny z arkusza bez nagłówka. Numer musi być unikalny również między dostawcami, np. DOSTAWCA/2026/123. Utworzenie dokumentu nie zmienia zapasu.</p><button class="primary">OTWÓRZ PRZYJĘCIE</button></form></details>` : ""}`;
    window.document.querySelector('#wms-inbound-filter [name="q"]').required =
      false;
  }
  function openLine(id, scanned = "") {
    line = document.lines.find((l) => l.id === id);
    if (!line || document.closed_at) return;
    window.document
      .getElementById("widokWms")
      .classList.add("wms-inbound-focus");
    window.document.getElementById("wms-inbound-task").innerHTML =
      `<section class="wms-surface"><div class="wms-inbound-product">${h.photo(line)}<div><h3>${html(line.sku)}</h3><p>${html(line.name)}</p><p>Policzono ${line.received} / ${line.expected} szt. · Pozostało ${Math.max(0, line.expected - line.received)}</p><p class="wms-help">${line.bins.length ? `Miejsca według ostatniego odczytu: ${line.bins.map((b) => `${html(b.bin)} (${b.mode === "pick" ? "kompletacja" : "zaplecze"}, ${b.room == null ? "sprawdź miejsce" : `do ${b.room} szt.`})`).join(", ")}` : "Brak podpowiedzi miejsca. Zeskanuj zarejestrowaną lokalizację po odłożeniu."}</p></div></div>
      <form id="wms-inbound-putaway" class="wms-form"><input type="hidden" name="mode" value="${receivingMode}">${field("barcode", "Kod towaru / SKU", "text", scanned)}<div class="wms-fields">${field("quantity", "Przeliczona ilość", "number", "", 'min="1" max="1000000" step="1"')}<label>Stan towaru<select name="disposition"><option value="good">Pełnowartościowy</option><option value="damaged">Uszkodzony → kwarantanna</option></select></label></div>${field("bin", "Zeskanuj półkę lub bufor zaplecza")}<details><summary>Uszkodzenie / nadwyżka — uzasadnienie</summary><label>Co stwierdzono?<textarea name="reason" maxlength="500"></textarea></label><p class="wms-help">Uszkodzenie wymaga opisu i kwarantanny. Nadwyżkę zatwierdza biuro z uzasadnieniem.</p></details><button class="primary">POTWIERDŹ ODŁOŻENIE</button></form></section>`;
    const task = window.document.getElementById("wms-inbound-task");
    task.querySelector("section").classList.remove("wms-surface");
    task.insertAdjacentHTML(
      "afterbegin",
      `<div class="wms-toolbar"><button data-inbound="refresh">← Inny towar</button><strong>${html(document.reference)}</strong></div>`,
    );
    if (scanned) {
      const barcode = form().elements.namedItem("barcode");
      barcode.type = "hidden";
      barcode.parentElement.hidden = true;
    }
    const exception = form().querySelector("details"),
      notes = form().elements.namedItem("reason");
    const updateException = () => {
      const required =
        form().elements.namedItem("disposition").value === "damaged" ||
        Number(form().elements.namedItem("quantity").value) + line.received >
          line.expected;
      notes.required = required;
      notes.minLength = required ? 3 : 0;
      if (required) exception.open = true;
    };
    form().addEventListener("input", updateException);
    form().addEventListener("change", updateException);
    updateException();
    const mode = form().elements.namedItem("mode");
    const updateMode = () => {
      mode.value =
        form().elements.namedItem("disposition").value === "damaged"
          ? "direct"
          : receivingMode;
      form().querySelector("button.primary").textContent =
        mode.value === "buffer"
          ? "POTWIERDŹ PRZYJĘCIE DO BUFORA"
          : "POTWIERDŹ ODŁOŻENIE";
    };
    form()
      .elements.namedItem("disposition")
      .addEventListener("change", () => {
        // Uszkodzone sztuki trzeba policzyć osobno i potwierdzić ich rzeczywistą kwarantannę.
        form().elements.namedItem("quantity").value = "";
        form().elements.namedItem("bin").value = "";
        updateMode();
        updateException();
      });
    updateMode();
    h.mountPhotos();
    h.focus(form().elements.namedItem(scanned ? "quantity" : "barcode"));
  }
  async function click(button) {
    if (await putaway.click(button)) return true;
    if (button.dataset.inboundOpen) {
      historyOffset = 0;
      historyOpen = false;
      selected = Number(button.dataset.inboundOpen);
      await h.refresh();
      return true;
    }
    if (button.dataset.inboundLine) {
      openLine(Number(button.dataset.inboundLine));
      return true;
    }
    if (button.dataset.inboundReverse) {
      const p = document.putaways.find(
        (p) => p.id === Number(button.dataset.inboundReverse),
      );
      window.document.getElementById("wms-inbound-correction").innerHTML =
        `<form id="wms-inbound-reverse" data-putaway="${p.id}" class="wms-form"><h3>Korekta ${html(p.sku)} · ${p.quantity} szt.</h3><p>Wycofasz całe odłożenie z ${html(p.bin)}. Następnie przyjmij poprawną ilość. Towar zarezerwowany lub pobrany wymaga wcześniejszego wyjaśnienia zamówienia.</p>${field("barcode", "Zeskanuj towar / SKU")}${field("bin", "Zeskanuj pierwotną lokalizację")}${field("reason", "Powód korekty")}<button>WYCOFAJ TO ODŁOŻENIE</button></form>`;
      h.focus(
        window.document.querySelector('#wms-inbound-reverse [name="barcode"]'),
      );
      return true;
    }
    const action = button.dataset.inbound;
    if (!action) return false;
    if (action === "putaway") queue = true;
    if (action === "receiving") queue = false;
    if (action === "history-prev") {
      historyOffset = Math.max(0, historyOffset - 100);
      historyOpen = true;
    }
    if (action === "history-next") {
      historyOffset += 100;
      historyOpen = true;
    }
    if (action === "list") selected = null;
    if (action === "prev") offset = Math.max(0, offset - 50);
    if (action === "next") offset += 50;
    await h.refresh();
    return true;
  }
  async function submit(f, v) {
    if (await putaway.submit(f, v)) return true;
    if (!f.id.startsWith("wms-inbound-")) return false;
    if (f.id === "wms-inbound-filter") {
      q = v.q;
      closed = v.closed;
      offset = 0;
      await h.refresh();
    }
    if (f.id === "wms-inbound-create") {
      const lines = v.lines
        .trim()
        .split(/\r?\n/)
        .filter((r) => r.trim())
        .map((r, i) => {
          const cols = r.split(/[;\t]/).map((c) => c.trim());
          if (
            cols.length !== 2 ||
            !cols[0] ||
            !/^\d+$/.test(cols[1]) ||
            Number(cols[1]) < 1
          )
            throw Error(
              `Wiersz ${i + 1}: wpisz SKU i dodatnią ilość całkowitą`,
            );
          return { sku: cols[0], quantity: Number(cols[1]) };
        });
      const result = await h.mutate("/api/wms/inbound", {
        reference: v.reference,
        supplier: v.supplier,
        lines,
      });
      if (result) {
        selected = result.id;
        historyOffset = 0;
        historyOpen = false;
        await h.refresh();
      }
    }
    if (f.id === "wms-inbound-scan") {
      const scan = v.barcode.trim(),
        exact = document.lines.filter(
          (l) => l.sku.toUpperCase() === scan.toUpperCase(),
        );
      const matches = exact.length
        ? exact
        : document.lines.filter((l) => l.barcode === scan);
      if (matches.length !== 1)
        throw Error(
          matches.length
            ? "Kod pasuje do kilku części. Zeskanuj SKU"
            : "Tego towaru nie ma w dokumencie. Sprawdź dostawę i kod",
        );
      openLine(matches[0].id, scan);
    }
    if (f.id === "wms-inbound-putaway") {
      const result = await h.mutate(`/api/wms/inbound/${selected}/putaway`, {
        lineId: line.id,
        version: line.version,
        barcode: v.barcode,
        bin: v.bin,
        quantity: Number(v.quantity),
        disposition: v.disposition,
        ...(v.mode === "buffer" ? { staged: true } : {}),
        reason: v.reason,
      });
      if (result) {
        await h.refresh();
        h.message(
          v.mode === "buffer"
            ? `Policzono ${v.quantity} szt. w buforze. Zadanie odkładania czeka w kolejce.`
            : `Odłożono ${v.quantity} szt. na ${v.bin.toUpperCase()}. Skanuj kolejny towar.`,
        );
      }
    }
    if (f.id === "wms-inbound-close") {
      const result = await h.mutate(`/api/wms/inbound/${selected}/close`, {
        version: document.version,
        reason: v.reason,
      });
      if (result) {
        await h.refresh();
        h.message("Zamknięto przyjęcie.");
      }
    }
    if (f.id === "wms-inbound-reopen") {
      const result = await h.mutate(`/api/wms/inbound/${selected}/reopen`, {
        version: document.version,
        reason: v.reason,
      });
      if (result) {
        await h.refresh();
        h.message("Ponownie otwarto przyjęcie.");
      }
    }
    if (f.id === "wms-inbound-reverse") {
      const result = await h.mutate(`/api/wms/inbound/${selected}/reverse`, {
        putawayId: Number(f.dataset.putaway),
        version: document.version,
        barcode: v.barcode,
        bin: v.bin,
        reason: v.reason,
      });
      if (result) {
        await h.refresh();
        h.message("Wycofano odłożenie. Przyjmij poprawną ilość.");
      }
    }
    return true;
  }
  function keydown(event) {
    if (putaway.keydown(event)) return true;
    if (
      event.key !== "Enter" ||
      !["wms-inbound-putaway", "wms-inbound-reverse"].includes(
        event.target.form?.id,
      )
    )
      return false;
    const next = (
      event.target.form.id === "wms-inbound-putaway"
        ? { barcode: "quantity", quantity: "bin" }
        : { barcode: "bin", bin: "reason" }
    )[event.target.name];
    if (next) {
      h.advanceScan(event, next);
    }
    // Kolejność przyjęcia kończy się półką; ogólny handler zbiórki wracał stąd do SKU.
    return true;
  }
  function openQueue(buffer) {
    queue = buffer;
    selected = null;
    q = "";
    offset = 0;
    closed = "0";
    if (buffer) putaway.openQueue();
  }
  return { render, click, submit, keydown, openQueue };
};
