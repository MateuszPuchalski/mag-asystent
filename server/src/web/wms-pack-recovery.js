/* Przy stanowisku zostaje dobra zawartość. Wymiana prowadzi wyłącznie brakujące sztuki do tej samej skrzynki. */
window.WmsPackRecovery = (h) => {
  const { html, field, read, mutate, office, focus } = h;
  let selected = null,
    task = null,
    query = "",
    offset = 0;
  const content = () => document.getElementById("wms-content");
  const sources = () => [...new Set((task?.picks || []).map((p) => p.bin))];
  function shortage(o) {
    if (!office())
      return '<p class="wms-muted">Brakuje części lub jest inna? Wstrzymaj zamówienie z opisem i przekaż je do biura. Nie zapisuj nieobecnych sztuk jako zwrotu lub kwarantanny.</p>';
    const parcels = [
      ...new Set(o.packingContents.map((c) => Number(c.parcel_no))),
    ].sort((a, b) => a - b);
    return `<details class="wms-shortage-correction"><summary>Potwierdzony brak — rozlicz po przeliczeniu</summary><p>Sprawdź skrzynkę, stanowisko i pomyłkę przy odkładaniu. Wybierz brakującą część; nie trzeba skanować nieobecnej sztuki. Zapis potwierdzi ubytek przy pakowaniu i zleci zamiennik.</p><form id="wms-packing-shortage" data-order="${o.id}" data-version="${o.version}" class="wms-form">${field("box", "Skan skrzynki po sprawdzeniu")}<label>Część do rozliczenia<select name="lineId">${o.lines.map((l) => `<option value="${l.id}">${html(l.sku)} · ${html(l.name)}</option>`).join("")}</select></label><label>Sprawdzana zawartość<select name="fromParcel"><option value="0">Niesprawdzone sztuki poza paczkami</option>${parcels.map((n) => `<option value="${n}">Paczka ${n}</option>`).join("")}</select></label>${field("observedQuantity", "Faktycznie obecne sztuki tej części w wybranej zawartości", "number", "", 'min="0" max="1000000"')}${field("reason", "Wynik wyjaśnienia braku")}<p>Przelicz tylko wybraną zawartość. Zero oznacza brak wszystkich jej sztuk. Dobre potwierdzenia zostają; brak nie tworzy przyjęcia na półkę ani kwarantannę.</p><button>POTWIERDŹ BRAK I ZLEĆ ZAMIENNIK</button></form></details>`;
  }
  function damage(o) {
    const waiting = o.packingRecovery;
    return `${waiting ? `<aside class="wms-message"><strong>Czeka na wymianę: ${waiting.remaining} szt.</strong><p>Dobre sztuki możesz dalej sprawdzać. Zamienniki wymagają osobnej kontroli po dostarczeniu.</p><button data-recovery-open="${waiting.id}">OTWÓRZ WYMIANĘ</button></aside>` : ""}<details class="wms-damage-correction"><summary>Uszkodzona część — odłóż do kwarantanny</summary><p>Odłóż tylko uszkodzone sztuki do oznaczonej kwarantanny. Pozostała zawartość zostaje przy stanowisku.</p><form id="wms-packing-damage" data-order="${o.id}" data-version="${o.version}" class="wms-form">${field("box", "Skan skrzynki zamówienia")}${field("barcode", "Skan uszkodzonej części")}${field("quantity", "Uszkodzone sztuki", "number", "", 'min="1" max="1000000"')}<label>Skąd pochodzi część<select name="fromParcel"><option value="0">Jeszcze niesprawdzona przy stanowisku</option>${[
      ...new Set(o.packingContents.map((c) => Number(c.parcel_no))),
    ]
      .sort((a, b) => a - b)
      .map((n) => `<option value="${n}">Sprawdzona w paczce ${n}</option>`)
      .join(
        "",
      )}</select></label>${field("quarantine", "Skan kwarantanny po odłożeniu")}${field("reason", "Opis uszkodzenia")}<button>POTWIERDŹ KWARANTANNĘ I ZLEĆ WYMIANĘ</button></form></details>${shortage(o)}`;
  }
  async function render() {
    if (!selected) {
      const data = await read(
        `/api/wms/packing-recovery?q=${encodeURIComponent(query)}&offset=${offset}`,
      );
      content().innerHTML = `<section class="wms-surface"><h2>Wymiany do pakowania</h2><p>Dobre sztuki zostają przy stanowisku. Podejmij wymianę, pobierz tylko zamienniki i dostarcz je do wskazanej skrzynki.</p><form id="wms-recovery-filter" class="wms-toolbar">${field("q", "Zamówienie lub skrzynka", "text", query)}<button>SZUKAJ</button></form>${data.rows.map((r) => `<article class="wms-stock-task"><strong>${html(r.reference)} · ${r.remaining} szt.</strong><p>Skrzynka ${html(r.box)} · ${r.user_id ? "Podjęta" : "Czeka na podjęcie"}${r.hold_reason ? ` · ${html(r.hold_reason)}` : ""}</p><button data-recovery-open="${r.id}">OTWÓRZ WYMIANĘ</button></article>`).join("") || "<p>Brak oczekujących wymian.</p>"}<div class="wms-toolbar"><button data-recovery-page="-1" ${offset === 0 ? "disabled" : ""}>POPRZEDNIE</button><span>${data.total} zadań</span><button data-recovery-page="1" ${offset + 50 >= data.total ? "disabled" : ""}>NASTĘPNE</button></div></section>`;
      return;
    }
    task = await read(`/api/wms/packing-recovery/${selected}`);
    const ended = task.completed_at || task.cancelled_at;
    content().innerHTML = `<section class="wms-surface"><button data-recovery-list>KOLEJKA WYMIAN</button><h2>${html(task.reference)}</h2><p><strong>Skrzynka: ${html(task.box)}</strong></p>${task.lines.map((l) => `<p>${html(l.sku)} · wymieniono ${l.replaced} / ${l.quantity} szt. · ${l.kind === "shortage" ? "brak potwierdzony po przeliczeniu" : "kwarantanna " + html(l.quarantine)}</p>`).join("")}${task.hold_reason ? `<p class="wms-message error">${html(task.hold_reason)}</p>` : ""}${
      ended
        ? `<p>${task.completed_at ? "Zamienniki dostarczone. Pakujący musi je jeszcze sprawdzić." : "Wymiana przerwana. Zamówienie wymaga wyjaśnienia w biurze."}</p>`
        : task.user_id === null
          ? `<p>Podjęcie zarezerwuje brakujące części. Rozliczona rozbieżność pozostaje zapisana także przy braku zapasu.</p><button data-recovery-claim ${task.hold_reason ? "disabled" : ""}>PODEJMIJ WYMIANĘ</button>${office() ? `<details><summary>Przerwij wymianę i rozlicz całe zamówienie</summary><p>Biuro wstrzyma zamówienie i wyzeruje kontrolę pakowania. Dobre pobrania trzeba zwrócić przed anulowaniem zamówienia.</p><form id="wms-recovery-abort" class="wms-form">${field("reason", "Powód przerwania")}<button>PRZERWIJ WYMIANĘ</button></form></details>` : ""}`
          : task.user_id !== h.userId()
            ? `<p>Wymianę prowadzi inny operator. Poczekaj na dostarczenie zamienników.</p>`
            : `<p>Po powrocie lub odświeżeniu odłóż niepotwierdzone sztuki na źródło, zanim zaczniesz skany od nowa.</p>${task.picks.map((p, i) => `<article class="wms-stock-task"><h3>${html(p.bin)} → ${html(task.box)}</h3><p><strong>${html(p.sku)} · ${p.quantity} szt.</strong><br>${html(p.name)}</p>${p.blocked ? `<p class="wms-message error">${html(p.blocked)}</p>` : `<form class="wms-form wms-recovery-pick" data-pick="${i}">${field("source", "1. Skan półki źródłowej")}${field("barcode", "2. Skan części")}${field("quantity", "3. Faktycznie pobrane sztuki", "number", "", `min="1" max="${p.quantity}"`)}${field("box", "4. Skan skrzynki po dostarczeniu")}<button>POTWIERDŹ DOSTARCZENIE</button></form>`}</article>`).join("")}<details><summary>Zwróć niepotwierdzone pobrania i zwolnij zadanie</summary><p>Zwróć tylko sztuki, których dostarczenia jeszcze nie potwierdzono. Potwierdzone zamienniki zostają przy pakowaniu.</p><form id="wms-recovery-release" class="wms-form">${sources()
                .map((s, i) =>
                  field("source" + i, "Skan źródła po zwrocie: " + s),
                )
                .join(
                  "",
                )}${field("reason", "Powód zwolnienia")}<button>ZWOLNIJ WYMIANĘ</button></form></details>`
    }<button data-recovery-order="${task.order_id}">OTWÓRZ ZAMÓWIENIE</button></section>`;
    focus(content().querySelector('.wms-recovery-pick [name="source"]'));
  }
  async function click(button) {
    if (button.dataset.recoveryOpen) {
      selected = Number(button.dataset.recoveryOpen);
      await h.openView();
      return true;
    }
    if (button.hasAttribute("data-recovery-list")) {
      selected = null;
      await render();
      return true;
    }
    if (button.dataset.recoveryPage) {
      offset = Math.max(0, offset + Number(button.dataset.recoveryPage) * 50);
      await render();
      return true;
    }
    if (button.dataset.recoveryOrder) {
      await h.openOrder(Number(button.dataset.recoveryOrder));
      return true;
    }
    if (button.hasAttribute("data-recovery-claim")) {
      const result = await mutate(
        `/api/wms/packing-recovery/${selected}/claim`,
        { version: task.version },
      );
      if (result) await render();
      return true;
    }
    return false;
  }
  async function submit(form, values) {
    if (form.id === "wms-packing-shortage") {
      const result = await mutate("/api/wms/packing-shortage", {
        orderId: Number(form.dataset.order),
        version: Number(form.dataset.version),
        box: values.box.trim(),
        lineId: Number(values.lineId),
        parcelNo: Number(values.fromParcel),
        observedQuantity: Number(values.observedQuantity),
        reason: values.reason,
      });
      if (result) await h.refresh();
      return true;
    }
    if (form.id === "wms-recovery-filter") {
      query = values.q;
      offset = 0;
      await render();
      return true;
    }
    if (form.id === "wms-packing-damage") {
      const body = {
        ...values,
        orderId: Number(form.dataset.order),
        version: Number(form.dataset.version),
        quantity: Number(values.quantity),
        parcelNo: Number(values.fromParcel),
      };
      delete body.fromParcel;
      const result = await mutate("/api/wms/packing-damage", body);
      if (result) await h.refresh();
      return true;
    }
    let action, body;
    if (form.classList.contains("wms-recovery-pick")) {
      const p = task.picks[Number(form.dataset.pick)];
      action = "pick";
      body = {
        ...values,
        version: task.version,
        allocationId: p.allocation_id,
        sourceVersion: p.stock_version,
        quantity: Number(values.quantity),
      };
    }
    if (form.id === "wms-recovery-release") {
      action = "release";
      body = {
        version: task.version,
        sources: sources().map((_, i) => values["source" + i]),
        reason: values.reason,
      };
    }
    if (form.id === "wms-recovery-abort") {
      action = "abort";
      body = { version: task.version, reason: values.reason };
    }
    if (!action) return false;
    const result = await mutate(
      `/api/wms/packing-recovery/${selected}/${action}`,
      body,
    );
    if (result) await render();
    return true;
  }
  function keydown(event) {
    const form = event.target.form;
    if (event.key !== "Enter" || !form) return false;
    // Skaner nie może wysłać pobrania przed jawną ilością i skanem docelowej skrzynki.
    const sequence = form.classList.contains("wms-recovery-pick")
      ? { source: "barcode", barcode: "quantity", quantity: "box" }
      : form.id === "wms-packing-damage"
        ? {
            box: "barcode",
            barcode: "quantity",
            quantity: "fromParcel",
            quarantine: "reason",
          }
        : {};
    const next = sequence[event.target.name];
    if (!next) return false;
    event.preventDefault();
    form.elements.namedItem(next).focus();
    return true;
  }
  return { render, click, submit, damage, keydown };
};
