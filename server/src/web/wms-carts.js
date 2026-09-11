/* Stałe pozycje skrzynek i wspólna trasa: operator widzi następny odkład,
   a identyfikację skanów oraz blokadę powtórek współdzieli z modułem WMS. */
window.WmsCarts = (h) => {
  const { html, field, mutate, focus, message, lock, office, number } = h;
  let run = null,
    cart = null,
    stations = [],
    verifiedStop = null;
  const target = () => document.getElementById("wms-content");
  const memoryKey = () => `wertis.wms.cart.${h.userId()}`;
  const remember = (id) =>
    id
      ? sessionStorage.setItem(memoryKey(), String(id))
      : sessionStorage.removeItem(memoryKey());
  const panel = (body) => {
    document.getElementById("widokWms").classList.remove("wms-cart-focus");
    target().innerHTML = `<section class="wms-surface wms-cart">${body}</section>`;
  };
  const read = async (path) => {
    try {
      return await h.read(path);
    } catch (error) {
      verifiedStop = null;
      panel(
        '<p>Nie udało się odczytać aktualnego stanu. Ponów odczyt przed kolejnym skanem.</p><button data-do-wms="refresh">PONÓW ODCZYT</button>',
      );
      throw error;
    }
  };
  const stationSelect = (kind) =>
    `<label>Stanowisko<select name="station">${stations
      .filter((s) => s.active && s.kind === kind)
      .map(
        (s) =>
          `<option value="${html(s.code)}">${html(s.code)} · ${html(s.name)}</option>`,
      )
      .join("")}</select></label>`;
  const exceptionNames = {
    missing: "Brak na półce",
    damaged: "Uszkodzony towar",
    box_full: "Pełna skrzynka",
  };
  async function renderPacking() {
    const saved =
      sessionStorage.getItem(`wertis.wms.station.${h.userId()}`) || "";
    panel(
      `<h2>Pakowanie · skan skrzynki</h2><p>Wskaż stanowisko i zeskanuj przekazaną skrzynkę. WMS otworzy jej zamówienie oraz kontrolę towarów.</p><form id="wms-cart-pack" class="wms-form">${field("station", "Skan stanowiska pakowania", "text", saved, 'autocomplete="off"')}${field("box", "Skan skrzynki", "text", "", 'autocomplete="off"')}<button class="primary">OTWÓRZ PAKOWANIE</button></form>`,
    );
    focus(
      document
        .getElementById("wms-cart-pack")
        ?.elements.namedItem(saved ? "box" : "station"),
    );
  }
  async function render() {
    verifiedStop = null;
    run = null;
    cart = null;
    const result = await read("/api/wms/carts");
    if (!h.active()) return;
    stations = result.stations;
    const saved = Number(sessionStorage.getItem(memoryKey()));
    if (
      result.rows.some(
        (c) => c.run_id === saved && (c.picker_id === h.userId() || office()),
      )
    ) {
      await loadRun(saved);
      return;
    }
    remember(null);
    panel(`<h2>Zeskanuj wózek</h2><p class="wms-help">WMS przypisze gotowe zamówienia do pustych skrzynek. Jedno zamówienie na stałej pozycji. Ponowny skan wznawia rozpoczętą trasę.</p>
      <form id="wms-cart-start" class="wms-form">${field("barcode", "Kod wózka", "text", "", 'autocomplete="off"')}<button class="primary">ROZPOCZNIJ / WZNÓW ZBIÓRKĘ</button></form>
      <div class="wms-cart-list">${
        result.rows
          .map(
            (
              c,
            ) => `<article><div><strong>${html(c.name)}</strong><p>${html(c.code)} · ${c.capacity} pozycji · ${c.bound_boxes} skrzynek</p><p>${c.run_id ? `${c.assigned_count} zamówień · ${c.arrived_at ? "przy pakowaniu" : "w zbiórce"}` : c.active ? "Gotowy do przydziału" : "Wyłączony"}</p></div>
        ${c.run_id ? (c.picker_id === h.userId() || office() ? `<button data-cart-run="${c.run_id}">OTWÓRZ TRASĘ</button>` : "<span>Zajęty przez inną osobę</span>") : `<button data-cart-config="${html(c.code)}">SKRZYNKI I POZYCJE</button>`}</article>`,
          )
          .join("") ||
        "<p>Biuro musi najpierw zarejestrować wózki i kody ich skrzynek.</p>"
      }</div>
      ${office() ? '<div class="wms-actions"><button data-cart-new="20">DODAJ WÓZEK 20</button><button data-cart-new="30">DODAJ WÓZEK 30</button><button data-cart-action="stations">STANOWISKA</button><button data-cart-action="route">KOLEJNOŚĆ LOKALIZACJI</button><button data-cart-action="analytics">ANALITYKA WÓZKÓW</button></div>' : ""}`);
    focus(
      document.getElementById("wms-cart-start")?.elements.namedItem("barcode"),
    );
  }
  async function loadRun(id) {
    lock(true);
    try {
      const result = await read(`/api/wms/cart-runs/${id}`);
      if (!h.active()) return;
      run = result;
      remember(run.closed_at ? null : run.id);
      drawRun();
    } finally {
      lock(false);
    }
  }
  function drawRun() {
    const task = run.tasks.find(
      (t) => !t.hold_reason && !t.stock_blocked && t.picker_id === h.userId(),
    );
    const key = task ? `${run.id}/${task.bin}/${task.sku}` : null;
    const verified = key && verifiedStop?.key === key;
    const own = run.picker_id === h.userId();
    const outstanding = run.orders.some(
      (o) => o.status === "picking" && !o.hold_reason,
    );
    const slots = run.assignments
      .map((a) => {
        const o = run.orders.find((o) => o.id === a.order_id);
        return `<button class="wms-cart-slot ${a.order_id === task?.order_id ? "current" : ""} ${o?.hold_reason ? "held" : ""}" data-cart-position="${a.position}" ${a.order_id === task?.order_id ? 'aria-current="step"' : ""}><strong>${a.position}</strong><span>${html(a.box_barcode)}</span><small>${a.released_at ? "Przekazana" : o?.hold_reason ? "Wyjątek" : o?.status === "picked" ? "Zebrana" : o?.status === "shipped" ? "Wysłana" : "W trasie"}</small></button>`;
      })
      .join("");
    panel(`<div class="wms-actions"><button data-cart-action="list">WSZYSTKIE WÓZKI</button><button data-cart-action="reload">ODŚWIEŻ TRASĘ</button></div><h2>${html(run.cart_code)} · ${run.assigned_count}/${run.capacity} pozycji</h2>
      ${
        task && !run.closed_at
          ? `<div class="wms-cart-next"><div><span class="wms-eyebrow">POZYCJA SKRZYNKI</span><strong class="wms-cart-position">${task.position}</strong><span>${html(task.tote)}</span></div><div class="wms-cart-product"><span class="wms-eyebrow">LOKALIZACJA</span><strong class="wms-location">${html(task.bin)}</strong><strong>${html(task.sku)}</strong><p>${html(task.name)}</p><p>Łącznie na przystanku: <strong>${task.stop_quantity} szt.</strong><br>Do tej skrzynki: <strong>${task.remaining} szt.</strong></p></div>${h.photo(task)}</div>
      <form id="wms-cart-pick" class="wms-form">${verified ? `<input type="hidden" name="bin" value="${html(verifiedStop.bin)}"><input type="hidden" name="barcode" value="${html(verifiedStop.barcode)}"><p class="wms-help">Lokalizacja i towar potwierdzone na tym przystanku. Zeskanuj skrzynkę ${task.position}.</p>` : `${field("bin", "1. Lokalizacja", "text", "", 'autocomplete="off"')}${field("barcode", "2. Towar", "text", "", 'autocomplete="off"')}`}
        <div class="wms-fields">${field("quantity", "Sztuki", "number", task.remaining, `min="1" max="${task.remaining}"`)}${field("tote", `Skrzynka ${task.position}`, "text", "", 'autocomplete="off"')}</div><button class="primary">POTWIERDŹ ODŁOŻENIE</button></form>
      <button data-cart-exception="${task.order_id}">BRAK / USZKODZENIE / PEŁNA SKRZYNKA</button>`
          : `<p class="wms-message">${run.closed_at ? "Trasa zamknięta. Historia skrzynek pozostaje dostępna." : outstanding ? "Pozostałe pobrania należą do innej osoby." : run.arrived_at ? `Wózek przekazany: ${html(run.station_code)}. Pakowanie rozpoczyna się skanem skrzynki.` : "Gotowe zamówienia zebrane. Wyjątki pozostają wstrzymane."}</p>`
      }
      ${run.tasks.some((t) => t.stock_blocked) ? '<p class="wms-message error">Część pobrań czeka na przeliczenie zgłoszonej półki. Otwórz Zadania zapasu.</p>' : ""}
      ${!run.closed_at && own && !outstanding && !run.arrived_at ? `<form id="wms-cart-handoff" class="wms-form"><h3>Przekaż wózek do pakowania</h3>${field("cart", "Skan wózka")}${field("station", "Skan stanowiska pakowania")}<button class="primary">POTWIERDŹ PRZEKAZANIE</button></form>` : ""}
      <details ${task ? "" : "open"}><summary>Stałe pozycje · ${run.assignments.length} skrzynek</summary><div class="wms-cart-grid">${slots}</div></details>
      ${!run.closed_at ? `<details><summary>Zwolnij pusty wózek</summary><p>Potwierdź, że wózek jest pusty. Niezakończone zamówienia muszą być wcześniej przekazane w skrzynkach na stanowiska.</p><form id="wms-cart-release" class="wms-form">${field("cart", "Skan pustego wózka")}<button>ZWOLNIJ WÓZEK</button></form></details>` : ""}
      ${office() && !own && !run.closed_at ? `<form id="wms-cart-takeover" class="wms-form"><h3>Przejmij zbiórkę</h3>${field("cart", "Skan wózka")}${field("reason", "Powód przejęcia")}<button>PRZEJMIJ CAŁĄ TRASĘ</button></form>` : ""}`);
    target()._cartTask = task;
    document
      .getElementById("widokWms")
      .classList.toggle("wms-cart-focus", !!task);
    if (task) message("");
    focus(
      document
        .getElementById("wms-cart-pick")
        ?.elements.namedItem(verified ? "tote" : "bin"),
    );
  }
  function positionDetail(position) {
    const a = run.assignments.find((a) => a.position === position),
      o = run.orders.find((o) => o.id === a.order_id);
    panel(`<button data-cart-action="reload">WRÓĆ DO TRASY</button><h2>Pozycja ${a.position} · ${html(a.box_barcode)}</h2><p>${html(o.reference)}${o.hold_reason ? ` · ${html(o.hold_reason)}` : ""}</p><button data-cart-order="${o.id}">SZCZEGÓŁY ZAMÓWIENIA</button>
      ${!a.released_at && !a.ended_at ? `<details><summary>Przekaż samą skrzynkę</summary><p>Po przekazaniu ta pozycja będzie pusta. Skrzynka zachowa przypisane zamówienie.</p><form id="wms-cart-detach" data-position="${position}" class="wms-form">${field("box", "Skan skrzynki")}${field("station", o.hold_reason ? "Skan stanowiska wyjątków" : "Skan stanowiska pakowania")}<button>PRZEKAŻ SKRZYNKĘ</button></form></details>` : ""}
      ${!a.handed_at && !a.ended_at ? `<details><summary>Wymień pełną skrzynkę</summary><form id="wms-cart-replace" data-position="${position}" class="wms-form">${field("oldBox", "Skan obecnej skrzynki")}${field("newBox", "Skan pustej, większej skrzynki")}${field("reason", "Powód wymiany")}<label><input type="checkbox" name="transferConfirmed" required> Cała zawartość została przełożona na tę samą pozycję wózka.</label><button>POTWIERDŹ WYMIANĘ</button></form></details>` : ""}
      ${office() && o.hold_reason ? `<details><summary>Rozwiąż zgłoszenie zbiórki</summary><p>Kontynuacja wymaga sprawdzenia towaru na półce. Usunięcie z trasy wymaga wcześniejszego odłożenia wszystkich pobrań.</p><form id="wms-cart-resolve" data-position="${position}" class="wms-form">${field("box", "Skan skrzynki")}<label>Rozstrzygnięcie<select name="action"><option value="continue">Towar odnaleziony / sprawdzony — kontynuuj</option><option value="remove">Pobrania odłożone — anuluj zamówienie</option></select></label>${field("reason", "Uzasadnienie rozstrzygnięcia")}<button>ROZWIĄŻ ZGŁOSZENIE</button></form></details>` : ""}`);
  }
  function configure(capacity = 20) {
    const c = cart;
    if (!office()) {
      panel(
        `<h2>${html(c.code)} · przypisz pustą skrzynkę</h2><button data-cart-action="list">WÓZKI</button><form id="wms-cart-bind" class="wms-form">${field("position", "Stała pozycja", "number", 1, `min="1" max="${c.capacity}"`)}${field("box", "Skan pustej skrzynki")}<button class="primary">PRZYPISZ SKRZYNKĘ</button></form><ol>${c.slots.map((s) => `<li>${html(s.box_barcode || "Brak skrzynki")}</li>`).join("")}</ol>`,
      );
      return;
    }
    panel(
      `<button data-cart-action="list">WÓZKI</button><h2>${c ? "Konfiguracja" : "Nowy wózek"} · ${capacity} pozycji</h2><form id="wms-cart-configure" data-capacity="${capacity}" class="wms-form">${field("code", "Kod wózka", "text", c?.code || "", c ? "readonly" : "")}${field("name", "Nazwa", "text", c?.name || "")}<label>Zamówienia<select name="selection"><option value="all" ${c?.selection === "all" ? "selected" : ""}>Wszystkie</option><option value="single" ${c?.selection === "single" ? "selected" : ""}>Jedno SKU</option><option value="multi" ${c?.selection === "multi" ? "selected" : ""}>Wiele SKU</option></select></label>${field("maxUnits", "Maksymalnie sztuk w zamówieniu", "number", c?.max_units || 1000000, 'min="1" max="1000000"')}<p class="wms-help">Limit sztuk nie sprawdza wymiarów ani udźwigu. Pozostaw puste pole tylko przy pozycji bez skrzynki.</p><ol class="wms-cart-box-config">${Array.from({ length: capacity }, (_, i) => `<li><label>Pozycja ${i + 1}<input name="box-${i + 1}" value="${html(c?.slots[i]?.box_barcode || "")}" autocomplete="off" maxlength="30"></label></li>`).join("")}</ol><label><input type="checkbox" name="active" ${!c || c.active ? "checked" : ""}> Wózek aktywny</label><button class="primary">ZAPISZ STAŁE POZYCJE</button></form>`,
    );
  }
  async function click(button) {
    if (button.dataset.cartRun) {
      verifiedStop = null;
      await loadRun(Number(button.dataset.cartRun));
      return true;
    }
    if (button.dataset.cartPosition) {
      verifiedStop = null;
      positionDetail(Number(button.dataset.cartPosition));
      return true;
    }
    if (button.dataset.cartOrder) {
      await h.openOrder(Number(button.dataset.cartOrder));
      return true;
    }
    if (button.dataset.cartNew) {
      cart = null;
      configure(Number(button.dataset.cartNew));
      return true;
    }
    if (button.dataset.cartConfig) {
      lock(true);
      try {
        cart = await read(
          `/api/wms/carts/${encodeURIComponent(button.dataset.cartConfig)}`,
        );
        configure(cart.capacity);
      } finally {
        lock(false);
      }
      return true;
    }
    if (button.dataset.cartException) {
      const t = target()._cartTask;
      panel(
        `<button data-cart-action="reload">WRÓĆ DO ZBIÓRKI</button><h2>Zgłoś wyjątek · pozycja ${t.position}</h2><p>${html(t.bin)} · ${html(t.sku)} · ${html(t.tote)}</p><form id="wms-cart-exception" class="wms-form"><label>Problem<select name="kind">${Object.entries(
          exceptionNames,
        )
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join(
            "",
          )}</select></label>${field("box", "Skan skrzynki")}${field("reason", "Co się wydarzyło?")}<p>Zamówienie zostanie wstrzymane. Pozostałe skrzynki można zbierać dalej. Zgłoszenie nie zmienia stanu półki.</p><button class="primary">ZGŁOŚ I KONTYNUUJ TRASĘ</button></form>`,
      );
      target()._cartTask = t;
      verifiedStop = null;
      return true;
    }
    const action = button.dataset.cartAction;
    if (!action) return false;
    if (action === "list") {
      remember(null);
      lock(true);
      try {
        await render();
      } finally {
        lock(false);
      }
    }
    if (action === "reload") {
      verifiedStop = null;
      await loadRun(run.id);
    }
    if (action === "stations")
      panel(
        `<button data-cart-action="list">WÓZKI</button><h2>Stanowiska</h2><p>${stations.map((s) => `${html(s.code)} · ${html(s.name)}`).join("<br>")}</p><form id="wms-cart-station" class="wms-form">${field("code", "Kod stanowiska")}${field("name", "Nazwa")}<label>Typ<select name="kind"><option value="pack">Pakowanie</option><option value="exception">Wyjaśnienie wyjątków</option></select></label><button>DODAJ STANOWISKO</button></form>`,
      );
    if (action === "route") {
      lock(true);
      try {
        const r = await read("/api/wms/pick-route");
        panel(
          `<button data-cart-action="list">WÓZKI</button><h2>Kolejność przejścia</h2><p>Wiersz: lokalizacja; kolejność. Nieskonfigurowane lokalizacje trafiają na koniec trasy.</p><form id="wms-cart-route" class="wms-form"><label>Lokalizacje<textarea name="rows" rows="14" required>${r.rows.map((b) => `${html(b.bin)};${b.sequence}`).join("\n")}</textarea></label><button>ZAPISZ KOLEJNOŚĆ</button></form>`,
        );
        target()._route = r.rows;
      } finally {
        lock(false);
      }
    }
    if (action === "analytics") {
      lock(true);
      try {
        const r = await read("/api/wms/cart-analytics?days=30"),
          s = r.summary;
        panel(
          `<button data-cart-action="list">WÓZKI</button><h2>Wózki · ostatnie 30 dni</h2><div class="wms-stats">${h.metric("Trasy", number(s.runs), "Utworzone przydziały")}${h.metric("Wypełnienie", s.positions ? `${number((s.orders / s.positions) * 100)}%` : "—", "Przypisane zamówienia / pozycje")}${h.metric("Czas do przekazania", s.elapsed_seconds === null ? "—" : `${number(s.elapsed_seconds / 60)} min`, "Średnia dla przekazanych tras")}</div><p>${html(r.note)}</p><div class="wms-scroll"><table><thead><tr><th>Wózek</th><th>Trasy</th><th>Zamówienia</th><th>Średni czas do przekazania</th></tr></thead><tbody>${r.carts.map((c) => `<tr><td>${html(c.cart_code)} (${c.capacity})</td><td>${c.runs}</td><td>${c.orders}</td><td>${c.elapsed_seconds === null ? "—" : `${number(c.elapsed_seconds / 60)} min`}</td></tr>`).join("")}</tbody></table></div><h3>Wyjątki</h3>${r.exceptions.map((e) => `<p>${html(exceptionNames[e.kind])}: ${e.count}, otwarte: ${e.unresolved}</p>`).join("") || "<p>Brak zgłoszeń w tym okresie.</p>"}`,
        );
        target()
          .querySelector(".wms-cart")
          .insertAdjacentHTML(
            "beforeend",
            `<h3>Potwierdzone pobrania</h3><p>Sztuki obejmują ponowne pobrania po zwrocie. Przystanek oznacza parę lokalizacja/SKU odwiedzoną na jednej trasie.</p><div class="wms-scroll"><table><thead><tr><th>Wózek</th><th>Przystanki</th><th>Potwierdzenia</th><th>Pobrane sztuki</th></tr></thead><tbody>${r.activity.map((a) => `<tr><td>${html(a.cart_code)}</td><td>${a.stops}</td><td>${a.confirmations}</td><td>${a.picked_units}</td></tr>`).join("")}</tbody></table></div>`,
          );
      } finally {
        lock(false);
      }
    }
    return true;
  }
  async function submit(form, values) {
    if (!form.id.startsWith("wms-cart-")) return false;
    let path, body, result;
    if (form.id === "wms-cart-pack") {
      result = await mutate("/api/wms/cart-box-pack", values);
      if (result) {
        sessionStorage.setItem(
          `wertis.wms.station.${h.userId()}`,
          values.station,
        );
        await h.openOrder(result.id);
      }
      return true;
    }
    if (form.id === "wms-cart-start") {
      result = await mutate("/api/wms/cart-start", values);
      if (result?.run) {
        verifiedStop = null;
        await loadRun(result.run.id);
      } else if (result)
        message(
          "Brak gotowych zamówień spełniających profil wózka. Wózek pozostaje wolny.",
        );
      return true;
    }
    if (form.id === "wms-cart-pick") {
      const t = target()._cartTask;
      result = await mutate(`/api/wms/waves/${run.id}/pick`, {
        ...values,
        quantity: Number(values.quantity),
        orderId: t.order_id,
        version: t.version,
        allocationId: t.allocation_id,
      });
      if (result) {
        verifiedStop = {
          key: `${run.id}/${t.bin}/${t.sku}`,
          bin: values.bin,
          barcode: values.barcode,
        };
        await loadRun(run.id);
      }
      return true;
    }
    if (form.id === "wms-cart-configure") {
      const capacity = Number(form.dataset.capacity);
      result = await mutate("/api/wms/carts", {
        code: values.code,
        name: values.name,
        capacity,
        selection: values.selection,
        maxUnits: Number(values.maxUnits),
        version: cart?.version || 0,
        active: values.active === "on",
        boxes: Array.from({ length: capacity }, (_, i) => ({
          position: i + 1,
          barcode: values[`box-${i + 1}`].trim() || null,
        })),
      });
      if (result) {
        remember(null);
        await h.refresh();
      }
      return true;
    }
    if (form.id === "wms-cart-bind") {
      result = await mutate("/api/wms/cart-box-bind", {
        ...values,
        cart: cart.code,
        version: cart.version,
        position: Number(values.position),
      });
      if (result) {
        cart = result;
        configure(cart.capacity);
      }
      return true;
    }
    if (form.id === "wms-cart-station") {
      result = await mutate("/api/wms/stations", {
        ...values,
        version: 0,
        active: true,
      });
      if (result) await h.refresh();
      return true;
    }
    if (form.id === "wms-cart-route") {
      const bins = values.rows
        .split(/\r?\n/)
        .filter((s) => s.trim())
        .map((line) => {
          const parts = line.split(";");
          if (parts.length !== 2 || !parts[1].trim())
            throw new Error(
              "Wpisz lokalizację i kolejność rozdzielone średnikiem.",
            );
          const bin = parts[0].trim().toUpperCase();
          return {
            bin,
            sequence: Number(parts[1]),
            version: target()._route.find((b) => b.bin === bin)?.version || 0,
          };
        });
      result = await mutate("/api/wms/pick-route", { bins });
      if (result) await h.refresh();
      return true;
    }
    if (form.id === "wms-cart-exception") {
      const t = target()._cartTask;
      path = "/api/wms/pick-exceptions";
      body = {
        ...values,
        orderId: t.order_id,
        allocationId: t.allocation_id,
        version: t.version,
      };
    } else if (
      ["wms-cart-detach", "wms-cart-replace", "wms-cart-resolve"].includes(
        form.id,
      )
    ) {
      const a = run.assignments.find(
          (a) => a.position === Number(form.dataset.position),
        ),
        o = run.orders.find((o) => o.id === a.order_id);
      body = { ...values, version: o.version };
      if (form.id === "wms-cart-resolve") {
        path = "/api/wms/pick-exceptions/resolve";
        body.orderId = o.id;
      } else {
        path = `/api/wms/cart-runs/${run.id}/${form.id === "wms-cart-detach" ? "detach" : "replace"}`;
        if (form.id === "wms-cart-replace")
          body.transferConfirmed = values.transferConfirmed === "on";
      }
    } else {
      path = `/api/wms/cart-runs/${run.id}/${form.id.slice("wms-cart-".length)}`;
      body = values;
    }
    result = await mutate(path, body);
    if (result) {
      verifiedStop = null;
      if (form.id === "wms-cart-release") {
        remember(null);
        await h.refresh();
      } else await loadRun(run.id);
    }
    return true;
  }
  return { render, renderPacking, click, submit, stationSelect };
};
