/* Przyjęcie i odkładanie mają osobne potwierdzenia, bo bufory obsługuje inna osoba. */
window.WmsPutaway = (h) => {
  let selected = null,
    task = null,
    query = "",
    mine = "0",
    offset = 0;
  const { html, field } = h;
  const target = () => document.getElementById("wms-content");
  const age = (value) => new Date(value).toLocaleString("pl-PL");
  async function render() {
    const nav =
      '<div class="wms-toolbar"><button data-inbound="receiving">← Przyjęcia</button><button data-putaway="list">Kolejka odkładania</button><button data-putaway="refresh">Odśwież</button></div>';
    if (selected) {
      task = await h.read(`/api/wms/putaway-work/${selected}`);
      const own = task.user_id === h.userId();
      document
        .getElementById("widokWms")
        .classList.toggle("wms-putaway-focus", own && task.remaining > 0);
      target().innerHTML =
        nav +
        `<section class="wms-surface"><h2>${html(task.sku)} · ${task.remaining} szt. do odłożenia</h2><p>${html(task.name)} · ${html(task.reference)}</p><p>Bufor: <strong>${html(task.source)}</strong>. Przyjęto ${task.quantity} szt. · ${html(age(task.created_at))}</p>
      ${
        task.remaining
          ? own
            ? `<p class="wms-help">${task.bins.length ? `Miejsca według ostatniego odczytu: ${task.bins.map((b) => `${html(b.bin)} (${b.room == null ? "sprawdź miejsce" : `do ${b.room} szt.`})`).join(", ")}` : "Zeskanuj zarejestrowaną półkę docelową."}</p>
      <form id="wms-putaway-finish" class="wms-form"><div class="wms-putaway-fields">${field("source", "1 · Zeskanuj bufor")}${field("barcode", "2 · Zeskanuj towar / SKU")}${field("quantity", "Ilość do odłożenia", "number", task.remaining, `min="1" max="${task.remaining}" step="1"`)}${field("target", "3 · Odłóż i zeskanuj półkę")}</div><button class="primary">POTWIERDŹ ODŁOŻENIE</button><details><summary>Uszkodzenie — odłóż do kwarantanny</summary><label>Stan towaru<select name="disposition"><option value="good">Pełnowartościowy</option><option value="damaged">Uszkodzony</option></select></label><label>Co stwierdzono?<textarea name="reason" maxlength="500"></textarea></label><p>Uszkodzony towar wymaga opisu i skanu lokalizacji kwarantanny.</p></details></form>`
            : `<p>${task.user_id === null ? "Zadanie czeka na podjęcie." : "Zadanie ma już operatora. Biuro może przejąć je z uzasadnieniem."}</p>${task.user_id === null || h.office() ? `<form id="wms-putaway-claim" class="wms-form">${task.user_id !== null ? field("reason", "Powód przejęcia") : ""}<button class="primary">${task.user_id === null ? "PODEJMIJ ODKŁADANIE" : "PRZEJMIJ ZADANIE"}</button></form>` : ""}`
          : "<p>Wszystkie sztuki rozliczone. Wybierz następne zadanie.</p>"
      }
      ${task.remaining && h.office() ? `<details><summary>Brakuje policzonych sztuk — korekta</summary>${task.closed_at ? "<p>Najpierw otwórz dokument ponownie w Przyjęciach.</p>" : `<p>Korygujesz wyłącznie brakujące sztuki w buforze. Odłożone sztuki pozostają bez zmian.</p><form id="wms-putaway-correct" class="wms-form">${field("source", "Zeskanuj bufor")}${field("barcode", "Zeskanuj towar / SKU")}${field("quantity", "Brakująca ilość", "number", 1, `min="1" max="${task.remaining}" step="1"`)}${field("reason", "Przyczyna rozbieżności")}<button>ZAPISZ KOREKTĘ PRZYJĘCIA</button></form>`}</details>` : ""}
      <details><summary>Historia odkładania i korekt</summary><p>Ostatnie 100 potwierdzeń.</p>${task.steps.map((s) => `<p>${html(age(s.created_at))} · ${s.quantity} szt. · ${s.kind === "correction" ? `Korekta: ${html(s.reason)}` : `${s.kind === "quarantine" ? "Kwarantanna: " : "→ "}${html(s.target)}${s.reason ? ` · ${html(s.reason)}` : ""}`}</p>`).join("") || "<p>Brak potwierdzeń.</p>"}</details></section>`;
      const finish = document.getElementById("wms-putaway-finish");
      if (finish)
        finish.elements
          .namedItem("disposition")
          .addEventListener("change", () => {
            const damaged =
              finish.elements.namedItem("disposition").value === "damaged";
            const notes = finish.elements.namedItem("reason");
            notes.required = damaged;
            notes.minLength = damaged ? 3 : 0;
            finish.querySelector("button.primary").textContent = damaged
              ? "POTWIERDŹ KWARANTANNĘ"
              : "POTWIERDŹ ODŁOŻENIE";
          });
      h.focus(
        document.querySelector('#wms-putaway-finish [name="source"]') ||
          document.querySelector("#wms-putaway-claim button"),
      );
      return;
    }
    const data = await h.read(
      `/api/wms/putaway-work?q=${encodeURIComponent(query)}&mine=${mine}&offset=${offset}`,
    );
    target().innerHTML =
      nav +
      `<section class="wms-surface"><h2>Odkładanie z bufora</h2><p>${data.totals.tasks} zadań · <strong>${data.totals.units} szt.</strong> czeka na odłożenie${data.totals.oldest ? ` · Najstarsze: ${html(age(data.totals.oldest))}` : ""}</p><p class="wms-help">Te sztuki są policzone, ale nie są dostępne do zbiórki. Podejmij zadanie, zeskanuj bufor i część, odłóż na potwierdzoną półkę.</p>
      <form id="wms-putaway-filter" class="wms-toolbar">${field("q", "SKU, bufor lub dokument", "text", query)}<label>Operator<select name="mine"><option value="0">Wszystkie</option><option value="1" ${mine === "1" ? "selected" : ""}>Moje zadania</option></select></label><button>SZUKAJ</button></form>
      <div class="wms-scroll"><table class="wms-lines"><thead><tr><th>Część / dokument</th><th>Bufor</th><th>Pozostało</th><th>Stan</th></tr></thead><tbody>${data.rows.map((r) => `<tr><td><button data-putaway-open="${r.id}">${html(r.sku)}</button><br>${html(r.name)}<br>${html(r.reference)}</td><td>${html(r.source)}</td><td>${r.remaining}</td><td>${r.user_id === null ? "Do podjęcia" : r.user_id === h.userId() ? "Moje zadanie" : "W trakcie"}</td></tr>`).join("") || '<tr><td colspan="4">Brak zadań do odłożenia.</td></tr>'}</tbody></table></div><div class="wms-toolbar"><button data-putaway="prev" ${offset === 0 ? "disabled" : ""}>Poprzednie</button><span>${Math.min(offset + 1, data.totals.tasks)}–${offset + data.rows.length} z ${data.totals.tasks}</span><button data-putaway="next" ${offset + 50 >= data.totals.tasks ? "disabled" : ""}>Następne</button></div></section>`;
    document.querySelector('#wms-putaway-filter [name="q"]').required = false;
  }
  async function click(button) {
    if (button.dataset.putawayOpen) {
      selected = Number(button.dataset.putawayOpen);
      await h.refresh();
      return true;
    }
    const action = button.dataset.putaway;
    if (!action) return false;
    if (action === "list") selected = null;
    if (action === "next") offset += 50;
    if (action === "prev") offset = Math.max(0, offset - 50);
    await h.refresh();
    return true;
  }
  async function submit(form, v) {
    if (!form.id.startsWith("wms-putaway-")) return false;
    if (form.id === "wms-putaway-filter") {
      query = v.q;
      mine = v.mine;
      offset = 0;
      await h.refresh();
      return true;
    }
    const action = form.id.slice("wms-putaway-".length);
    const body =
      action === "claim"
        ? { version: task.version, reason: v.reason || "" }
        : {
            version: task.version,
            source: v.source,
            barcode: v.barcode,
            quantity: Number(v.quantity),
            ...(action === "finish"
              ? {
                  target: v.target,
                  disposition: v.disposition || "good",
                  reason: v.reason || "",
                }
              : { reason: v.reason }),
          };
    const result = await h.mutate(
      `/api/wms/putaway-work/${selected}/${action}`,
      body,
    );
    if (result) {
      if (!result.remaining) selected = null;
      await h.refresh();
      h.message(
        action === "claim"
          ? "Zadanie podjęte. Skanuj bufor."
          : action === "finish"
            ? "Odłożenie zapisane."
            : "Skorygowano policzoną ilość.",
      );
    }
    return true;
  }
  function keydown(e) {
    if (
      e.key !== "Enter" ||
      !["wms-putaway-finish", "wms-putaway-correct"].includes(e.target.form?.id)
    )
      return false;
    const next = {
      source: "barcode",
      barcode: "quantity",
      quantity: e.target.form.id === "wms-putaway-finish" ? "target" : "reason",
    }[e.target.name];
    if (next) {
      e.preventDefault();
      e.target.form.elements.namedItem(next).focus();
      e.target.form.elements.namedItem(next).select();
    }
    return true;
  }
  function openQueue() {
    selected = null;
    query = "";
    mine = "0";
    offset = 0;
  }
  return { render, click, submit, keydown, openQueue };
};
