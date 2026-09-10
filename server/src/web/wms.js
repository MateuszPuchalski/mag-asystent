/* Moduł istniejącego biura. Skan zatwierdza ruch dopiero po odpowiedzi API;
   niedostarczoną odpowiedź odtwarzamy z tym samym kluczem po ponowieniu. */
window.Wms = (() => {
  let view = "orders",
    selected = null,
    current = null,
    user = null,
    busy = false;
  let query = "",
    status = "open",
    offset = 0,
    days = 30,
    low = false,
    generation = 0;
  let selectedWave = null;
  const root = () => document.getElementById("widokWms");
  const el = (id) => document.getElementById(id);
  const html = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const states = {
    open: "Otwarte",
    new: "Nowe",
    allocated: "Do zebrania",
    picking: "W zbiórce",
    picked: "Do pakowania",
    packing: "W pakowaniu",
    packed: "Do wysłania",
    shipped: "Wysłane",
    cancelled: "Anulowane",
    held: "Wstrzymane",
  };
  const number = (n) =>
    new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(n ?? 0);
  const date = (value) =>
    value
      ? new Date(value).toLocaleString("pl-PL", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  const office = () => user && ["admin", "biuro"].includes(user.role);
  const binModes = {
    pick: "Kompletacja",
    reserve: "Zapas zaplecza",
    quarantine: "Kwarantanna",
  };
  const badge = (o) =>
    `<span class="wms-status ${o.hold_reason ? "held" : html(o.status)}">${o.hold_reason ? "Wstrzymane" : states[o.status]}</span>`;
  const pendingKey = () => `wertis.wms.pending.${user?.userId}`;
  const uuid = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  function pending() {
    try {
      const p = JSON.parse(sessionStorage.getItem(pendingKey()));
      return p?.userId === user?.userId ? p : null;
    } catch {
      return null;
    }
  }
  function message(text, error = false) {
    const box = el("wms-message");
    if (box) {
      box.textContent = text;
      box.className = `wms-message${error ? " error" : ""}`;
      box.setAttribute("role", error ? "alert" : "status");
    }
  }
  async function read(path) {
    return (await api(path)).json();
  }
  function lock(value) {
    busy = value;
    root()
      .querySelectorAll("button,input,select,textarea")
      .forEach((e) => {
        if (value) {
          e.dataset.wasDisabled = String(e.disabled);
          e.disabled = true;
        } else {
          e.disabled = e.dataset.wasDisabled === "true";
          delete e.dataset.wasDisabled;
        }
      });
  }
  async function mutate(path, body, retry = null) {
    if (busy) return null;
    const old = pending();
    if (old && !retry) {
      message(
        "Najpierw sprawdź wynik poprzedniej operacji przyciskiem PONÓW.",
        true,
      );
      showRetry();
      return null;
    }
    const job = retry || { path, body, key: uuid(), userId: user.userId };
    const storageKey = `wertis.wms.pending.${job.userId}`;
    // Zapis przed wysłaniem: odświeżenie strony nie może zgubić klucza ruchu.
    sessionStorage.setItem(storageKey, JSON.stringify(job));
    lock(true);
    try {
      const response = await fetch(job.path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session": token,
          "idempotency-key": job.key,
        },
        body: JSON.stringify(job.body),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500 && response.status !== 401)
          sessionStorage.removeItem(storageKey);
        if (response.status === 401) wyloguj();
        throw new Error([result.error, ...(result.details || [])].join(" · "));
      }
      sessionStorage.removeItem(storageKey);
      return result;
    } catch (e) {
      message(
        pending()
          ? "Nie znamy wyniku zapisu. Ponów tę samą operację; zapas zostanie zmieniony tylko raz."
          : e.message,
        true,
      );
      return null;
    } finally {
      lock(false);
      showRetry();
    }
  }
  function showRetry() {
    const box = el("wms-retry");
    if (box)
      box.innerHTML = pending()
        ? '<button class="primary" data-do-wms="retry">PONÓW POPRZEDNIĄ OPERACJĘ</button>'
        : "";
  }
  async function open() {
    try {
      user = (await read("/api/auth/me")).user;
      if (!office() && ["analytics", "import"].includes(view)) view = "orders";
      shell();
      await refresh();
    } catch (e) {
      root().textContent = e.message;
    }
  }
  function shell() {
    const tabs = [
      ["orders", "Zamówienia"],
      ["stock", "Zapasy"],
      ["waves", "Zbiórka wózkiem"],
      ["bins", "Lokalizacje"],
      ...(office()
        ? [
            ["analytics", "Analityka"],
            ["import", "Nowe zamówienie"],
          ]
        : []),
    ];
    root().innerHTML = `<header class="wms-head"><div><div class="wms-eyebrow">Magazyn · realizacja zamówień</div><h1>Od półki do paczki</h1></div>
      <nav class="wms-tabs" aria-label="Obszary WMS">${tabs.map(([v, t]) => `<button data-tab-wms="${v}" aria-selected="${view === v}">${t}</button>`).join("")}</nav></header>
      <div id="wms-message" class="wms-message" role="status" aria-live="polite"></div><div id="wms-retry"></div><div id="wms-content"></div>`;
    showRetry();
  }
  async function refresh() {
    const turn = ++generation;
    try {
      if (view === "orders") await orders(turn);
      if (view === "waves") await waves(turn);
      if (view === "stock") await stocks(turn);
      if (view === "bins") await bins(turn);
      if (view === "analytics") await report(turn);
      if (view === "import") importForm();
    } catch (e) {
      if (turn === generation) message(e.message, true);
    }
  }
  function pager(total) {
    return `<div class="wms-footer"><span class="wms-muted">${total ? `${offset + 1}–${Math.min(offset + 50, total)} z ${number(total)}` : "0 pozycji"}</span><div class="wms-actions"><button data-do-wms="prev" ${offset === 0 ? "disabled" : ""} aria-label="Poprzednia strona">←</button><button data-do-wms="next" ${offset + 50 >= total ? "disabled" : ""} aria-label="Następna strona">→</button></div></div>`;
  }
  async function orders(turn) {
    const result = await read(
      `/api/wms/orders?status=${status}&q=${encodeURIComponent(query)}&offset=${offset}`,
    );
    if (turn !== generation) return;
    root()._orders = result.rows;
    el("wms-content").innerHTML =
      `<form id="wms-filter" class="wms-toolbar"><label class="wms-search">Szukaj zamówienia lub pojemnika<input name="q" value="${html(query)}" placeholder="Numer zamówienia / pojemnik"></label>
      <label>Etap<select name="status"><option value="all">Wszystkie etapy</option>${Object.entries(
        states,
      )
        .map(
          ([v, t]) =>
            `<option value="${v}" ${status === v ? "selected" : ""}>${t}</option>`,
        )
        .join(
          "",
        )}</select></label><button type="submit">Szukaj</button><button type="button" data-do-wms="refresh" aria-label="Odśwież zamówienia">↻</button>${office() && result.rows.some((o) => o.status === "new" && !o.hold_reason) ? '<button class="primary" type="button" data-do-wms="release">ZAREZERWUJ NOWE Z TEJ STRONY</button>' : ""}</form>
      <div class="wms-split"><div><div class="wms-list">${result.rows.map((o) => `<button class="wms-row" data-order-wms="${o.id}" aria-pressed="${selected === o.id}"><div><strong>${html(o.reference)}</strong><small>${html(o.channel)} · ${number(o.units)} szt. ${o.tote ? `· ${html(o.tote)}` : ""}</small></div><div>${badge(o)}<small class="${new Date(o.due_at) < new Date() && !["shipped", "cancelled"].includes(o.status) ? "wms-late" : ""}">Termin ${date(o.due_at)}</small></div></button>`).join("") || '<div class="wms-empty"><strong>Brak zamówień</strong>Zmień filtr lub dodaj zamówienie.</div>'}</div>${pager(result.total)}</div><article class="wms-work" id="wms-work"><div class="wms-empty"><strong>Wybierz zamówienie</strong>Lista jest ułożona według priorytetu i terminu wysyłki.</div></article></div>`;
    if (selected) await detail(selected, turn);
  }
  async function detail(orderId, turn = generation) {
    const o = await read(`/api/wms/orders/${orderId}`);
    if (turn !== generation || selected !== orderId) return;
    current = o;
    el("wms-work").closest(".wms-split").classList.add("has-order");
    const stages = [
      "new",
      "allocated",
      "picking",
      "picked",
      "packing",
      "packed",
      "shipped",
    ];
    const idx = stages.indexOf(o.status);
    el("wms-work").innerHTML =
      `<button class="wms-queue-toggle" data-do-wms="queue">${root().classList.contains("wms-queue") ? "WRÓĆ DO SKANOWANIA" : "POKAŻ KOLEJKĘ"}</button><div class="wms-eyebrow">${html(o.channel)} · termin ${date(o.due_at)}</div><div class="wms-toolbar"><h2>${html(o.reference)}</h2>${badge(o)}</div>
      <div class="wms-progress" aria-label="Etap: ${states[o.status]}">${stages.map((_, i) => `<span class="${i <= idx ? "done" : ""}"></span>`).join("")}</div>
      ${o.hold_reason ? `<div class="wms-message error">${html(o.hold_reason)}</div>` : ""}
      ${o.tote ? `<p class="wms-muted">Pojemnik <strong>${html(o.tote)}</strong></p>` : ""}
      <div id="wms-step">${step(o)}</div>
      <table class="wms-lines"><thead><tr><th>Towar</th><th>Zebrano</th><th>Sprawdzono</th></tr></thead><tbody>${o.lines.map((l) => `<tr><td><strong>${html(l.sku)}</strong><br><span class="wms-muted">${html(l.name)}</span></td><td class="num">${l.picked}/${l.quantity}</td><td class="num">${l.packed}/${l.quantity}</td></tr>`).join("")}</tbody></table>
      ${!["shipped", "cancelled"].includes(o.status) ? exceptionsForm(o) : `<p class="wms-muted">Zamknięto ${date(o.shipped_at || o.updated_at)}</p>`}`;
    root()
      .querySelectorAll("[data-order-wms]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(Number(b.dataset.orderWms) === o.id),
        ),
      );
    el("wms-step")?.querySelector("input")?.focus({ preventScroll: true });
  }
  function field(name, label, type = "text", value = "", extra = "") {
    return `<label>${label}<input name="${name}" type="${type}" value="${html(value)}" required ${extra}></label>`;
  }
  function form(action, content, button) {
    return `<form class="wms-form" data-action-wms="${action}">${content}<button class="primary" type="submit">${button}</button></form>`;
  }
  function step(o) {
    if (o.hold_reason)
      return '<p class="wms-help">Wyjaśnij przyczynę wstrzymania. Pobrany towar można odłożyć poniżej.</p>';
    if (o.status === "new")
      return office()
        ? form(
            "allocate",
            "<p>Zarezerwuj towar na lokalizacjach przed rozpoczęciem zbiórki.</p>",
            "ZAREZERWUJ TOWAR",
          )
        : "Oczekuje na rezerwację przez biuro.";
    if (o.status === "allocated")
      return form(
        "pick-start",
        field(
          "tote",
          "Zeskanuj pusty pojemnik",
          "text",
          "",
          'autocomplete="off"',
        ),
        "ROZPOCZNIJ ZBIÓRKĘ",
      );
    if (o.status === "picking") {
      if (o.picker_id !== user.userId)
        return "<p>Zbiórkę prowadzi inna osoba. Biuro może przejąć pracę poniżej.</p>";
      const a = o.allocations.find((a) => a.picked < a.quantity),
        l = o.lines.find((l) => l.id === a.line_id);
      return (
        `<div class="wms-eyebrow">Idź do lokalizacji</div><div class="wms-location">${html(a.bin)}</div><p class="wms-part">${html(l.sku)}</p><p>${html(l.name)}</p><div class="wms-quantity">Pozostało ${a.quantity - a.picked} szt.</div>` +
        form(
          "pick",
          `<input type="hidden" name="allocationId" value="${a.id}">${field("bin", "1. Zeskanuj lokalizację", "text", "", 'autocomplete="off"')}<div class="wms-fields">${field("barcode", "2. Zeskanuj towar", "text", "", 'autocomplete="off"')}${field("quantity", "Sztuki", "number", 1, `min="1" max="${a.quantity - a.picked}"`)}</div>${o.wave_id ? field("tote", "3. Zeskanuj pojemnik " + html(o.tote), "text", "", 'autocomplete="off"') : ""}`,
          "POTWIERDŹ POBRANIE",
        )
      );
    }
    if (o.status === "picked")
      return form(
        "pack-start",
        field(
          "tote",
          "Zeskanuj pojemnik przy stanowisku",
          "text",
          "",
          'autocomplete="off"',
        ),
        "ROZPOCZNIJ KONTROLĘ PACZKI",
      );
    if (o.status === "packing") {
      if (o.packer_id !== user.userId) return "Pakowanie prowadzi inna osoba.";
      const done = o.lines.reduce((n, l) => n + l.packed, 0),
        total = o.lines.reduce((n, l) => n + l.quantity, 0);
      return (
        `<div class="wms-quantity">Sprawdzono ${done} z ${total} szt.</div><progress value="${done}" max="${total}" aria-label="Postęp kontroli paczki"></progress>` +
        form(
          "pack",
          `<div class="wms-fields">${field("barcode", "Zeskanuj wkładany towar", "text", "", 'autocomplete="off"')}${field("quantity", "Sztuki", "number", 1, 'min="1"')}</div>`,
          "DODAJ DO PACZKI",
        )
      );
    }
    if (o.status === "packed")
      return o.packer_id === user.userId
        ? `<div class="wms-message">Wszystkie pozycje sprawdzone. Paczka gotowa do wysłania.</div>` +
            form(
              "ship",
              `${field("carrier", "Przewoźnik", "text", "", 'maxlength="120"')}${field("tracking", "Zeskanuj numer przesyłki", "text", "", 'autocomplete="off"')}${field("weightG", "Masa paczki (g)", "number", "", 'min="1" max="1000000"')}<details><summary>Dodatkowe paczki tego zamówienia</summary><label>Przewoźnik; numer przesyłki; masa w gramach<textarea name="extraParcels" placeholder="DPD;123456789;1200"></textarea></label><p class="wms-help">Jedna dodatkowa paczka w wierszu. Łącznie do 20 paczek.</p></details>`,
              "POTWIERDŹ PRZEKAZANIE DO WYSYŁKI",
            )
        : "Paczka czeka na wysyłkę przez osobę pakującą.";
    if (o.status === "shipped")
      return `<div class="wms-message">${o.shipments.map((s) => `Paczka ${s.package_no}: ${html(s.carrier)} · <strong>${html(s.tracking)}</strong>`).join("<br>")}</div><button data-do-wms="print">DRUKUJ LISTĘ PAKOWĄ</button>`;
    return "<p>Zamówienie anulowane. Rezerwacje zwolnione.</p>";
  }
  function exceptionsForm(o) {
    const options = [
      !o.hold_reason ? ["hold", "Wstrzymaj — brak / uszkodzenie"] : null,
      office() && o.hold_reason ? ["resume", "Wznów po wyjaśnieniu"] : null,
      office() && ["picking", "picked", "packing", "packed"].includes(o.status)
        ? ["takeover", "Przejmij pracę na moje konto"]
        : null,
      office() ? ["cancel", "Anuluj zamówienie"] : null,
    ].filter(Boolean);
    const returned =
      o.hold_reason && o.allocations.some((a) => a.picked > 0)
        ? form(
            "return",
            `<label>Odłóż pozycję<select name="allocationId">${o.allocations
              .filter((a) => a.picked > 0)
              .map(
                (a) =>
                  `<option value="${a.id}">${html(o.lines.find((l) => l.id === a.line_id).sku)} · ${html(a.bin)} · ${a.picked} szt.</option>`,
              )
              .join(
                "",
              )}</select></label>${field("bin", "Zeskanuj lokalizację")}${field("barcode", "Zeskanuj towar")}${field("quantity", "Odkładana ilość", "number", 1, 'min="1"')}${field("reason", "Powód odłożenia")}`,
            "POTWIERDŹ ODŁOŻENIE",
          )
        : "";
    return `<details><summary>Problem, przejęcie lub anulowanie</summary>${options.length ? `<form class="wms-form" id="wms-exception"><label>Czynność<select name="action">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>${field("reason", "Powód / sposób rozwiązania", "text", "", 'minlength="3" maxlength="500"')}<button type="submit">ZAPISZ DECYZJĘ</button></form>` : ""}${returned}</details>`;
  }
  async function stocks(turn) {
    const result = await read(
      `/api/wms/inventory?q=${encodeURIComponent(query)}&low=${low ? 1 : 0}&offset=${offset}`,
    );
    if (turn !== generation) return;
    el("wms-content").innerHTML =
      `<form id="wms-filter" class="wms-toolbar"><label class="wms-search">Towar lub lokalizacja<input name="q" value="${html(query)}" placeholder="SKU, EAN, nazwa, lokalizacja"></label><label>Zakres<select name="low"><option value="0">Cały magazyn</option><option value="1" ${low ? "selected" : ""}>Poniżej minimum</option></select></label><button>Szukaj</button></form>
      <div class="wms-surface"><h2>Zapasy na lokalizacjach</h2><p class="wms-muted">Dostępne do zbiórki = wolne sztuki na lokalizacjach kompletacji. Kwarantanna i zapas zaplecza wymagają zwolnienia lub przesunięcia.</p><div class="wms-scroll"><table class="wms-lines wms-stock-table"><thead><tr><th>SKU / towar</th><th>Lokalizacja</th><th>Na półce</th><th>Rezerwacja</th><th>Dostępne</th><th>Minimum</th><th>Operacja</th></tr></thead><tbody>${result.rows.map((s, i) => `<tr><td><strong>${html(s.symbol)}</strong><br>${html(s.nazwa)}${s.active ? "" : "<br><strong>Brak kartoteki ERP</strong>"}</td><td>${html(s.bin || "Brak spisu")}<br><small>${binModes[s.mode]}</small></td><td class="num">${s.on_hand}</td><td class="num">${s.reserved}</td><td class="num ${s.on_hand - s.reserved < s.minimum ? "wms-late" : ""}">${s.available}</td><td class="num">${s.minimum}</td><td><button data-stock-wms="${i}">Zmień</button>${office() ? `<button data-movements-wms="${i}">Historia</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="7">Brak pasujących towarów.</td></tr>'}</tbody></table></div>${pager(result.total)}<div id="wms-stock-form"></div></div>`;
    root()._stockRows = result.rows;
  }
  async function waves(turn) {
    const result = await read(`/api/wms/waves?offset=${offset}`);
    if (turn !== generation) return;
    el("wms-content").innerHTML =
      `<div class="wms-toolbar"><button data-do-wms="new-wave">PRZYGOTUJ WÓZEK</button><button data-do-wms="refresh">ODŚWIEŻ</button></div><div class="wms-split"><div><h2>Moje otwarte wózki</h2><div class="wms-list">${result.rows.map((w) => `<button class="wms-row" data-wave-wms="${w.id}"><strong>${html(w.name)}</strong><span>${w.orders} zam.</span></button>`).join("") || "<p>Brak rozpoczętych zbiórek.</p>"}</div><div class="wms-actions"><button data-do-wms="prev" ${offset === 0 ? "disabled" : ""}>POPRZEDNIE</button><button data-do-wms="next" ${result.rows.length < 50 ? "disabled" : ""}>NASTĘPNE</button></div></div><article class="wms-work" id="wms-work"><p>Przygotuj do 12 pojemników. Wspólna trasa prowadzi według lokalizacji, a skan pojemnika chroni każde zamówienie.</p></article></div>`;
    if (selectedWave) await waveDetail(selectedWave, turn);
  }
  async function prepareWave() {
    const turn = generation;
    const result = await read("/api/wms/orders?status=allocated&limit=50");
    if (turn !== generation) return;
    root()._waveCandidates = result.rows.filter((o) => !o.hold_reason);
    el("wms-work").innerHTML =
      `<h2>Przygotuj wózek</h2><form id="wms-wave-create" class="wms-form">${field("name", "Nazwa wózka / trasy")}<p class="wms-help">Zeskanuj pusty pojemnik przy każdym wybranym zamówieniu (do 12). Puste pola pomijamy. Lista pokazuje pierwsze 50 zamówień według priorytetu i terminu.</p>${root()
        ._waveCandidates.map(
          (o) =>
            `<label>${html(o.reference)} · ${o.units} szt.<input name="tote-${o.id}" autocomplete="off" placeholder="Zeskanuj pojemnik, aby wybrać zamówienie"></label>`,
        )
        .join("")}<button class="primary">ROZPOCZNIJ TRASĘ</button></form>`;
  }
  async function waveDetail(waveId, turn = generation) {
    const wave = await read(`/api/wms/waves/${waveId}`);
    if (turn !== generation || selectedWave !== waveId) return;
    const task = wave.tasks.find(
      (t) => !t.hold_reason && t.picker_id === user.userId,
    );
    root()._waveTask = task;
    el("wms-work").closest(".wms-split").classList.add("has-order");
    el("wms-work").innerHTML =
      `<button class="wms-queue-toggle" data-do-wms="queue">POKAŻ KOLEJKĘ</button><h2>${html(wave.name)}</h2>${task ? `<div class="wms-eyebrow">Lokalizacja → towar → pojemnik</div><div class="wms-location">${html(task.bin)}</div><strong>${html(task.sku)}</strong> · ${task.remaining} szt.<p>${html(task.name)}<br>Zamówienie ${html(task.reference)} → <strong>${html(task.tote)}</strong></p><form id="wms-wave-pick" class="wms-form"><div class="wms-fields">${field("bin", "1. Lokalizacja", "text", "", 'autocomplete="off"')}${field("quantity", "Sztuki", "number", 1, `min="1" max="${task.remaining}"`)}</div>${field("barcode", "2. Towar", "text", "", 'autocomplete="off"')}${field("tote", "3. Pojemnik", "text", "", 'autocomplete="off"')}<button class="primary">ODŁOŻONO DO POJEMNIKA</button></form>` : `<p class="wms-message">${wave.tasks.length ? "Pozostałe zamówienia są wstrzymane lub przypisane innej osobie. Wyjaśnij je w kolejce zamówień." : "Trasa zebrana. Przekaż pojemniki do pakowania."}</p>`}<details><summary>Pojemniki i zamówienia (${wave.orders.length})</summary>${wave.orders.map((o) => `<p><strong>${html(o.tote)}</strong> · ${html(o.reference)} · ${badge(o)}</p>`).join("")}</details>`;
    el("wms-wave-pick")
      ?.elements.namedItem("bin")
      ?.focus({ preventScroll: true });
  }
  function stockForm(index) {
    const s = root()._stockRows[index];
    root()._stock = s;
    el("wms-stock-form").innerHTML =
      `<h2>${html(s.symbol)} · operacja magazynowa</h2><form class="wms-form" id="wms-stock-edit"><label>Czynność<select name="action"><option value="receive">Przyjęcie na lokalizację</option><option value="transfer">Przesunięcie / uzupełnienie</option>${office() ? '<option value="count">Spis — stan policzony na półce</option><option value="minimum">Ustaw minimum lokalizacji</option>' : ""}</select></label><div class="wms-fields">${field("bin", "Lokalizacja / źródło", "text", s.bin || "")}${field("quantity", "Ilość", "number", 1, 'min="0"')}</div><label>Lokalizacja docelowa (tylko przesunięcie)<input name="target"></label>${field("reason", "Dokument / powód", "text", "", 'minlength="3" maxlength="500"')}<button class="primary">ZAPISZ RUCH</button></form><p class="wms-help">Spis i minimum dotyczą wybranej lokalizacji. Przesunięcie obejmuje wyłącznie sztuki bez rezerwacji.</p>`;
    el("wms-stock-form").scrollIntoView({ block: "nearest" });
  }
  async function bins(turn) {
    const result = await read(
      `/api/wms/bins?q=${encodeURIComponent(query)}&offset=${offset}`,
    );
    if (turn !== generation) return;
    root()._bins = result.rows;
    el("wms-content").innerHTML =
      `<form id="wms-filter" class="wms-toolbar"><label>Kod lokalizacji<input name="q" maxlength="30" value="${html(query)}"></label><button>Szukaj</button></form>
      <section class="wms-surface"><h2>Lokalizacje magazynowe</h2><p class="wms-help">Rezerwacja korzysta wyłącznie z lokalizacji kompletacji. Zapas zaplecza wymaga przesunięcia. Zwolnienie towaru z kwarantanny wymaga biura.</p>
      <div class="wms-scroll"><table class="wms-lines"><thead><tr><th>Lokalizacja</th><th>Przeznaczenie</th><th>Sztuki</th><th>Rezerwacje</th>${office() ? "<th>Operacja</th>" : ""}</tr></thead><tbody>${result.rows.map((b, i) => `<tr><td>${html(b.bin)}</td><td>${binModes[b.mode]}</td><td>${b.on_hand}</td><td>${b.reserved}</td>${office() ? `<td><button data-bin-wms="${i}">Zmień typ</button></td>` : ""}</tr>`).join("")}</tbody></table></div>${pager(result.total)}${office() ? '<button data-do-wms="new-bin">DODAJ LOKALIZACJĘ</button><div id="wms-bin-form"></div>' : ""}</section>`;
  }
  function binForm(b = null) {
    root()._bin = b;
    el("wms-bin-form").innerHTML =
      `<h2>${b ? "Zmień przeznaczenie" : "Nowa lokalizacja"}</h2><form id="wms-bin-edit" class="wms-form">${field("bin", "Kod lokalizacji", "text", b?.bin || "", b ? "readonly" : 'maxlength="30"')}<label>Przeznaczenie<select name="mode">${Object.entries(
        binModes,
      )
        .map(
          ([mode, label]) =>
            `<option value="${mode}" ${b?.mode === mode ? "selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select></label>${field("reason", "Powód zmiany", "text", "", 'minlength="3" maxlength="500"')}<button class="primary">ZAPISZ LOKALIZACJĘ</button></form>`;
    el("wms-bin-form").scrollIntoView({ block: "nearest" });
  }
  async function movements(index, before = null) {
    const turn = generation,
      s = root()._stockRows[index];
    const result = await read(
      `/api/wms/movements?twId=${s.tw_id}${before ? `&before=${before}` : ""}`,
    );
    if (turn !== generation) return;
    el("wms-stock-form").innerHTML =
      `<h2>${html(s.symbol)} · historia ruchów</h2><div class="wms-scroll"><table class="wms-lines"><thead><tr><th>Czas</th><th>Lokalizacja</th><th>Operacja</th><th>Zmiana sztuk</th><th>Rezerwacja</th><th>Powód</th></tr></thead><tbody>${result.rows.map((m) => `<tr><td>${date(m.created_at)}</td><td>${html(m.bin)}</td><td>${html({ receive: "Przyjęcie", transfer: "Przesunięcie", pick: "Pobranie", return: "Odłożenie", reserve: "Rezerwacja", release: "Zwolnienie", count: "Spis" }[m.kind] || m.kind)}</td><td>${m.delta}</td><td>${m.reserved_delta}</td><td>${html(m.reason)}</td></tr>`).join("") || '<tr><td colspan="6">Brak ruchów.</td></tr>'}</tbody></table></div>${result.rows.length === 100 ? `<button data-movements-wms="${index}" data-before="${result.rows.at(-1).id}">STARSZE RUCHY</button>` : ""}`;
    el("wms-stock-form").scrollIntoView({ block: "nearest" });
  }
  async function report(turn) {
    const a = await read(`/api/wms/analytics?days=${days}`);
    if (turn !== generation) return;
    const totals = a.backlog.reduce(
      (n, r) => ({
        open:
          n.open +
          (!["shipped", "cancelled"].includes(r.status) ? r.orders : 0),
        held: n.held + r.held,
        overdue: n.overdue + r.overdue,
      }),
      { open: 0, held: 0, overdue: 0 },
    );
    const metric = (title, value, note) =>
      `<div class="wms-stat"><span>${title}</span><strong>${value}</strong><span>${note}</span></div>`;
    const max = Math.max(1, ...a.daily.map((d) => d.shipped));
    const duration = (minutes) =>
      minutes === null
        ? "—"
        : minutes < 60
          ? `${number(minutes)} min`
          : `${number(minutes / 60)} h`;
    el("wms-content").innerHTML =
      `<div class="wms-toolbar"><label>Okres<select id="wms-days">${[1, 7, 30, 90].map((n) => `<option value="${n}" ${days === n ? "selected" : ""}>Ostatnie ${n} dni</option>`).join("")}</select></label><button data-do-wms="csv">EKSPORT CSV</button><button data-do-wms="integrity">SPRAWDŹ ZGODNOŚĆ STANÓW</button></div>
      <div class="wms-stats">${metric("Wysłane zamówienia", number(a.throughput.shipped), "w wybranym okresie")}${metric("Wysłane w terminie", a.throughput.shipped ? `${number((100 * a.throughput.on_time) / a.throughput.shipped)}%` : "—", "wg terminu zamówienia")}${metric("Do realizacji teraz", number(totals.open), `${totals.overdue} po terminie · ${totals.held} wstrzymanych`)}${metric("Średni czas realizacji", duration(a.throughput.cycle_minutes), "od utworzenia do wysyłki")}</div>
      <div class="wms-grid"><section class="wms-surface"><h2>Wysyłki dziennie</h2><p class="wms-muted">Dni kalendarzowe UTC · ${a.since.slice(0, 10)} — ${a.now.slice(0, 10)}</p><div class="wms-chart" role="img" aria-label="Wysyłki w kolejnych dniach">${a.daily.map((d) => `<div class="wms-bar" style="height:${(100 * d.shipped) / max}%" title="${d.day}: ${d.shipped} wysłanych, ${d.on_time} w terminie"></div>`).join("")}</div><details><summary>Dane wykresu</summary><table class="wms-lines"><thead><tr><th>Dzień UTC</th><th>Wysłane</th><th>W terminie</th></tr></thead><tbody>${a.daily.map((d) => `<tr><td>${d.day}</td><td>${d.shipped}</td><td>${d.on_time}</td></tr>`).join("")}</tbody></table></details></section>
      <section class="wms-surface"><h2>Praca w toku</h2><table class="wms-lines"><thead><tr><th>Etap</th><th>Zamówienia</th><th>Po terminie</th></tr></thead><tbody>${a.backlog.map((r) => `<tr><td>${states[r.status]}</td><td class="num">${r.orders}</td><td class="num">${r.overdue}</td></tr>`).join("")}</tbody></table><p class="wms-muted">Otwarte ponad 48 h: ${number(a.aging.over_48h)} · Wstrzymania i odrzucone operacje w okresie: ${number(a.exceptions.total)}</p></section>
      <section class="wms-surface"><h2>Najczęściej wysyłane części</h2><table class="wms-lines"><thead><tr><th>SKU</th><th>Zamówienia</th><th>Sztuki</th></tr></thead><tbody>${a.top.map((r) => `<tr><td><strong>${html(r.sku)}</strong><br>${html(r.name)}</td><td class="num">${r.orders}</td><td class="num">${r.units}</td></tr>`).join("") || '<tr><td colspan="3">Brak wysyłek w tym okresie.</td></tr>'}</tbody></table></section>
      <section class="wms-surface"><h2>Stan magazynu teraz</h2><table class="wms-lines"><tbody><tr><td>SKU w ewidencji WMS</td><td class="num">${number(a.stock.skus)}</td></tr><tr><td>Sztuki na półkach</td><td class="num">${number(a.stock.on_hand)}</td></tr><tr><td>Zarezerwowane</td><td class="num">${number(a.stock.reserved)}</td></tr><tr><td>Dostępne do zbiórki</td><td class="num">${number(a.stock.available)}</td></tr><tr><td>Kwarantanna</td><td class="num">${number(a.stock.quarantined)}</td></tr><tr><td>Zapas zaplecza</td><td class="num">${number(a.stock.reserve_stock)}</td></tr><tr><td>Lokalizacje poniżej minimum</td><td class="num">${number(a.stock.low_bins)}</td></tr></tbody></table><p class="wms-muted">Rezerwacja → koniec zbiórki: ${a.throughput.pick_minutes === null ? "—" : number(a.throughput.pick_minutes) + " min"}<br>Koniec zbiórki → kontrola paczki: ${a.throughput.pack_minutes === null ? "—" : number(a.throughput.pack_minutes) + " min"}</p></section></div>`;
    root()
      .querySelector(".wms-grid")
      .insertAdjacentHTML(
        "beforeend",
        `<section class="wms-surface"><h2>Kanały sprzedaży</h2><table class="wms-lines"><thead><tr><th>Kanał</th><th>Wysłane</th><th>W terminie</th></tr></thead><tbody>${a.channels.map((c) => `<tr><td>${html(c.channel)}</td><td>${c.shipped}</td><td>${number((c.on_time * 100) / c.shipped)}%</td></tr>`).join("")}</tbody></table></section>
      <section class="wms-surface"><h2>Ruchy i rozbieżności</h2><table class="wms-lines"><thead><tr><th>Operacja</th><th>Liczba</th><th>Zmiana sztuk</th></tr></thead><tbody>${a.movements.map((m) => `<tr><td>${html({ receive: "Przyjęcie", count: "Spis", pick: "Pobranie", return: "Odłożenie", reserve: "Rezerwacja", release: "Zwolnienie", transfer: "Przesunięcie" }[m.kind] || m.kind)}</td><td>${m.operations}</td><td>${m.units}</td></tr>`).join("")}</tbody></table><details><summary>Rozbieżności spisów</summary>${a.adjustments.map((r) => `<p>${html(r.sku)}: ${r.variance > 0 ? "+" : ""}${r.variance} szt. (${r.counts} spisów)</p>`).join("") || "Brak rozbieżności w okresie."}</details><button data-do-wms="reconcile">PORÓWNAJ Z SUBIEKTEM</button><div id="wms-erp"></div></section>
      <section class="wms-surface"><h2>Operacje zbiórki według osoby</h2><p class="wms-muted">Zatwierdzone pobrania w okresie. Sztuki i skany nie mierzą czasu pracy.</p><table class="wms-lines"><thead><tr><th>Osoba</th><th>Skany</th><th>Sztuki</th><th>Zamówienia</th></tr></thead><tbody>${a.productivity.map((p) => `<tr><td>${html(p.name)}</td><td>${p.scans}</td><td>${p.units}</td><td>${p.orders}</td></tr>`).join("")}</tbody></table></section>`,
      );
  }
  function importForm() {
    el("wms-content").innerHTML =
      `<section class="wms-surface wms-import"><h2>Nowe zamówienie</h2><form class="wms-form" id="wms-create"><div class="wms-fields">${field("reference", "Numer zamówienia")}${field("channel", "Kanał", "text", "sklep")}</div>${field("dueAt", "Termin wysyłki", "datetime-local")}<label>Priorytet<select name="priority"><option value="0">Standard</option><option value="1">Pilne</option><option value="2">Krytyczne</option></select></label><label>Pozycje — jeden SKU i ilość w wierszu<textarea name="lines" required placeholder="W32-0203;2&#10;50-111;1"></textarea></label><p class="wms-help">Format: SKU;ilość. Symbol musi istnieć w kartotece. Powtarzające się SKU zostaną zsumowane.</p><button class="primary">UTWÓRZ ZAMÓWIENIE</button></form>
      <details><summary>Import wielu zamówień z pliku</summary><p class="wms-help">Plik JSON z eksportu sklepu: maksymalnie 200 zamówień i 2 MB. Identyczne zamówienia zostaną rozpoznane. Błędna pozycja wycofuje cały import.</p><label>Wybierz plik<input id="wms-import-file" type="file" accept=".json,application/json"></label><form class="wms-form" id="wms-import-preview"><label>Treść eksportu<textarea name="json" id="wms-import-json" required placeholder='{"orders":[{"reference":"ZAM-100","channel":"sklep","dueAt":"2026-12-31T12:00:00Z","lines":[{"sku":"W32-0203","quantity":2}]}]}'></textarea></label><button>PODGLĄD IMPORTU</button></form><div id="wms-import-result"></div></details></section>`;
  }
  async function click(event) {
    const button = event.target.closest("button");
    if (!button || !root().contains(button) || busy) return;
    try {
      if (button.dataset.tabWms) {
        view = button.dataset.tabWms;
        query = "";
        offset = 0;
        shell();
        await refresh();
      }
      if (button.dataset.orderWms) {
        selected = Number(button.dataset.orderWms);
        await detail(selected);
      }
      if (button.dataset.waveWms) {
        selectedWave = Number(button.dataset.waveWms);
        await waveDetail(selectedWave);
      }
      if (button.dataset.stockWms) stockForm(Number(button.dataset.stockWms));
      if (button.dataset.binWms)
        binForm(root()._bins[Number(button.dataset.binWms)]);
      if (button.dataset.movementsWms)
        await movements(
          Number(button.dataset.movementsWms),
          button.dataset.before,
        );
      const action = button.dataset.doWms;
      if (action === "new-wave") {
        selectedWave = null;
        await prepareWave();
      }
      if (action === "new-bin") binForm();
      if (action === "refresh") await refresh();
      if (action === "release") {
        const orders = (root()._orders || [])
          .filter((o) => o.status === "new" && !o.hold_reason)
          .map((o) => ({ id: o.id, version: o.version }));
        if (orders.length) {
          const r = await mutate("/api/wms/release", { orders });
          if (r) {
            await refresh();
            const bad = r.results.filter((r) => !r.ok);
            message(
              `Zarezerwowano ${r.results.length - bad.length}. ${bad.map((r) => `#${r.id}: ${r.error}`).join(" · ")}`,
              bad.length > 0,
            );
          }
        }
      }
      if (action === "import-batch") {
        const r = await mutate("/api/wms/import", root()._import);
        if (r) {
          view = "orders";
          query = "";
          offset = 0;
          status = "new";
          selected = null;
          shell();
          await refresh();
          message(
            `Dodano ${r.created} zamówień. Rozpoznano ${r.existing} istniejących.`,
          );
        }
      }
      if (action === "prev" || action === "next") {
        offset = Math.max(0, offset + (action === "next" ? 50 : -50));
        await refresh();
      }
      if (action === "print") window.print();
      if (action === "queue") {
        const showing = root().classList.toggle("wms-queue");
        button.textContent = showing ? "WRÓĆ DO SKANOWANIA" : "POKAŻ KOLEJKĘ";
        root().scrollIntoView({ block: "start" });
      }
      if (action === "csv")
        await pobierz(`/api/wms/analytics/csv?days=${days}`, "wms-wysylki.csv");
      if (action === "integrity") {
        const r = await read("/api/wms/integrity");
        message(
          r.ok
            ? "Stany, rezerwacje i dziennik są zgodne."
            : `Wykryto różnice: ${r.balances.length} stanów, ${r.reservations.length} rezerwacji.`,
          !r.ok,
        );
      }
      if (action === "reconcile") {
        const r = await read("/api/wms/reconciliation");
        el("wms-erp").innerHTML =
          `<p class="wms-help">${html(r.explanation)} Maksymalnie ${r.limit} różnic.</p><table class="wms-lines"><thead><tr><th>SKU</th><th>WMS</th><th>ERP</th><th>Różnica</th></tr></thead><tbody>${r.rows.map((p) => `<tr><td>${html(p.symbol)}</td><td>${p.shelf + p.staged}</td><td>${p.erp === null ? "Brak danych" : p.erp}</td><td>${p.difference === null ? "—" : p.difference}</td></tr>`).join("") || '<tr><td colspan="4">Brak różnic.</td></tr>'}</tbody></table>`;
      }
      if (action === "retry") {
        const p = pending();
        if (p) {
          const result = await mutate(p.path, p.body, p);
          if (result) {
            await refresh();
            message("Potwierdzono poprzednią operację.");
          }
        }
      }
    } catch (e) {
      message(e.message, true);
    }
  }
  async function submit(event) {
    const f = event.target;
    if (!root().contains(f)) return;
    event.preventDefault();
    if (busy) return;
    try {
      const values = Object.fromEntries(new FormData(f));
      if (f.id === "wms-wave-create") {
        const orders = root()
          ._waveCandidates.filter((o) => String(values[`tote-${o.id}`]).trim())
          .map((o) => ({
            id: o.id,
            version: o.version,
            tote: String(values[`tote-${o.id}`]).trim(),
          }));
        if (!orders.length || orders.length > 12)
          throw new Error("Wybierz od 1 do 12 zamówień przez skan pojemnika.");
        const result = await mutate("/api/wms/waves", {
          name: values.name,
          orders,
        });
        if (result) {
          selectedWave = result.id;
          await refresh();
          message("Wózek przypisany. Rozpocznij od wskazanej lokalizacji.");
        }
        return;
      }
      if (f.id === "wms-wave-pick") {
        const task = root()._waveTask;
        const result = await mutate(`/api/wms/waves/${selectedWave}/pick`, {
          ...values,
          quantity: Number(values.quantity),
          orderId: task.order_id,
          version: task.version,
          allocationId: task.allocation_id,
        });
        if (result) {
          await refresh();
          message("Potwierdzono odłożenie do pojemnika.");
        }
        return;
      }
      if (f.id === "wms-bin-edit") {
        const result = await mutate("/api/wms/bins", {
          ...values,
          version: root()._bin?.version || 1,
        });
        if (result) {
          await refresh();
          message("Zapisano przeznaczenie lokalizacji.");
        }
        return;
      }
      if (f.id === "wms-import-preview") {
        const input = JSON.parse(String(values.json));
        if (
          !Array.isArray(input.orders) ||
          input.orders.length < 1 ||
          input.orders.length > 200
        )
          throw new Error(
            "Plik musi zawierać orders: tablicę od 1 do 200 zamówień.",
          );
        if (input.orders.some((o) => !o || !Array.isArray(o.lines)))
          throw new Error("Każde zamówienie musi zawierać listę lines.");
        root()._import = input;
        el("wms-import-result").innerHTML =
          `<h2>${input.orders.length} zamówień do sprawdzenia</h2><table class="wms-lines"><thead><tr><th>Numer</th><th>Kanał</th><th>Pozycje</th></tr></thead><tbody>${input.orders.map((o) => `<tr><td>${html(o.reference)}</td><td>${html(o.channel || "sklep")}</td><td>${o.lines.length}</td></tr>`).join("")}</tbody></table><button class="primary" data-do-wms="import-batch">IMPORTUJ ZAMÓWIENIA</button>`;
        return;
      }
      if (f.id === "wms-filter") {
        query = String(values.q);
        status = String(values.status || status);
        low = values.low === "1";
        offset = 0;
        await refresh();
        return;
      }
      if (f.id === "wms-create") {
        const lines = String(values.lines)
          .split(/\r?\n/)
          .filter((s) => s.trim())
          .map((s) => {
            const parts = s.split(";");
            if (parts.length !== 2)
              throw new Error("Każdy wiersz musi mieć format SKU;ilość");
            return { sku: parts[0].trim(), quantity: Number(parts[1]) };
          });
        const result = await mutate("/api/wms/orders", {
          reference: values.reference,
          channel: values.channel,
          dueAt: new Date(String(values.dueAt)).toISOString(),
          priority: Number(values.priority),
          lines,
        });
        if (result) {
          selected = result.id;
          view = "orders";
          status = "all";
          query = "";
          offset = 0;
          shell();
          await refresh();
          message("Zamówienie utworzone.");
        }
        return;
      }
      if (f.id === "wms-stock-edit") {
        const s = root()._stock;
        const body = {
          action: values.action,
          twId: s.tw_id,
          bin: values.bin,
          quantity: Number(values.quantity),
          reason: values.reason,
        };
        if (values.action === "transfer") body.target = values.target;
        if (["count", "minimum"].includes(values.action)) {
          if (String(values.bin).trim().toUpperCase() !== s.bin)
            throw new Error(
              "Spis i minimum: wybierz właściwy wiersz lokalizacji z tabeli.",
            );
          body.version = s.version;
        }
        const result = await mutate("/api/wms/inventory", body);
        if (result) {
          await refresh();
          message("Zapisano operację magazynową.");
        }
        return;
      }
      const action = f.dataset.actionWms || values.action;
      if (action && current) {
        const body = { ...values, action, version: current.version };
        for (const n of ["quantity", "allocationId", "weightG"])
          if (n in body) body[n] = Number(body[n]);
        if (action === "ship")
          body.extraParcels = String(values.extraParcels || "")
            .split(/\r?\n/)
            .filter((s) => s.trim())
            .map((s) => {
              const p = s.split(";");
              if (p.length !== 3)
                throw new Error(
                  "Paczka wymaga przewoźnika, numeru i masy oddzielonych średnikiem.",
                );
              return {
                carrier: p[0].trim(),
                tracking: p[1].trim(),
                weightG: Number(p[2]),
              };
            });
        const result = await mutate(
          `/api/wms/orders/${current.id}/actions`,
          body,
        );
        if (result) {
          await refresh();
          message("Zapisano. Możesz przejść do kolejnej czynności.");
        }
      }
    } catch (e) {
      message(e.message, true);
    }
  }
  document.addEventListener("click", click);
  document.addEventListener("submit", submit);
  document.addEventListener("change", async (event) => {
    if (event.target.id === "wms-days") {
      days = Number(event.target.value);
      refresh();
    }
    if (event.target.id === "wms-import-file")
      try {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024)
          throw new Error("Plik przekracza 2 MB.");
        el("wms-import-json").value = await file.text();
        el("wms-import-result").textContent = "";
        root()._import = null;
      } catch (e) {
        message(e.message, true);
      }
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "wms-import-json") {
      root()._import = null;
      el("wms-import-result").textContent = "";
    }
  });
  // Enter ze skanera przechodzi do kodu SKU; kolejny Enter zatwierdza sztukę.
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" ||
      !root()?.contains(event.target) ||
      !["bin", "barcode"].includes(event.target.name)
    )
      return;
    const next = event.target.form?.elements.namedItem(
      event.target.name === "bin" ? "barcode" : "tote",
    );
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });
  return { open };
})();
