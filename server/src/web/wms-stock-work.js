/* Podgląd nie zakłada zadania. Dopiero przyjęcie pracy i potwierdzone skany
   prowadzą do zapisu, dzięki czemu dwóch operatorów nie uzupełnia tej samej półki. */
window.WmsStockWork = (h) => {
  const { html, field, read, mutate, office, focus } = h;
  const target = () => document.getElementById("wms-content");
  let state = null,
    query = "";
  async function render() {
    state = await read(`/api/wms/stock-work?q=${encodeURIComponent(query)}`);
    target().innerHTML = `<section class="wms-surface"><h2>Zadania zapasu</h2><p>Najpierw braki zamówień: priorytet, potem termin. Następnie minima półek. Brak dotyczy całego SKU po uwzględnieniu wolnego zapasu i podjętych zadań. Listy pokazują do 100 pozycji.</p>
      <h3>Moje uzupełnienia${office() ? " i zadania zespołu" : ""}</h3>${state.tasks.map((t) => `<article class="wms-stock-task"><strong>${html(t.sku)} · ${t.quantity} szt.</strong><p>${html(t.source)} → ${html(t.target)}</p><button data-stockwork-task="${t.id}">OTWÓRZ ZADANIE #${t.id}</button></article>`).join("") || "<p>Brak otwartych zadań.</p>"}
      <h3>Plan uzupełnień</h3><form id="wms-stockwork-filter" class="wms-toolbar">${field("q", "Szukaj w planie", "text", query)}<button>SZUKAJ</button><button type="button" data-stockwork-action="all">CAŁY PLAN</button></form><div class="wms-scroll"><table class="wms-lines"><thead><tr><th>SKU</th><th>Zaplecze → półka</th><th>Potrzeba / dostępne na zapleczu</th><th>Operacja</th></tr></thead><tbody>${state.plans.map((p, i) => `<tr><td><strong>${html(p.sku)}</strong><br>${html(p.name)}<br><strong>${p.order_shortage > 0 ? `ZAMÓWIENIA · brak ${p.order_shortage} szt. SKU` : "MINIMUM PÓŁKI"}</strong></td><td>${html(p.source)} → ${html(p.target)}</td><td>${p.quantity} / ${p.source_available}</td><td><button data-stockwork-claim="${i}">PRZYJMIJ ${Math.min(p.quantity, p.source_available, 1000000)} SZT.</button></td></tr>`).join("") || '<tr><td colspan="4">Brak propozycji z dostępnym zapasem zaplecza. Sprawdź przyjęcia i minima półek.</td></tr>'}</tbody></table></div>
      <h3>Brak miejsca na dokładanie</h3><p>Z tych półek można nadal zbierać towar. Biuro potwierdza zwolnienie miejsca przed kolejnym odłożeniem.</p>${state.capacityIssues.map((c) => `<article class="wms-stock-task"><strong>${html(c.bin)} · ${html(c.sku)}</strong><p>${html(c.reason)}</p>${office() ? `<button data-stockwork-space="${c.id}">POTWIERDŹ ZWOLNIENIE MIEJSCA</button>` : "<p>Zgłoszenie czeka na biuro.</p>"}</article>`).join("") || "<p>Brak zgłoszeń pełnej półki.</p>"}
      <h3>Półki do przeliczenia</h3><p>Zgłoszony brak lub uszkodzenie blokuje pobrania tego SKU z tej lokalizacji. Inne pobrania pozostają dostępne.</p>${state.checks.map((c) => `<article class="wms-stock-task"><strong>${html(c.bin)} · ${html(c.sku)}</strong><p>${html(c.reason)}</p>${office() ? `<button data-stockwork-check="${c.id}">${c.observation_id ? "SPRAWDŹ WYNIK LICZENIA" : "PRZELICZ PÓŁKĘ"}</button>` : `<p>${c.observation_id ? "Wynik czeka na biuro." : "Otwórz Przeliczenia WMS na kolektorze i policz półkę."}</p>`}</article>`).join("") || "<p>Brak otwartych przeliczeń.</p>"}
      ${office() && state.repairs.length ? `<h3>Zamówienia czekające na rezerwację po przeliczeniu</h3>${state.repairs.map((o) => `<form id="wms-stockwork-repair-${o.id}" data-order="${o.id}" class="wms-form"><strong>${html(o.reference)}</strong>${field("reason", "Powód wznowienia")}<button>SPRAWDŹ ZAPAS I WZNÓW</button></form>`).join("")}` : ""}<div id="wms-stockwork-detail"></div></section>`;
  }
  async function click(button) {
    if (button.dataset.stockworkAction === "all") {
      query = "";
      await h.refresh();
      return true;
    }
    if (button.dataset.stockworkClaim !== undefined) {
      const p = state.plans[Number(button.dataset.stockworkClaim)];
      const result = await mutate("/api/wms/replenishments", {
        twId: p.tw_id,
        source: p.source,
        target: p.target,
        quantity: Math.min(p.quantity, p.source_available, 1000000),
        sourceVersion: p.source_version,
        targetVersion: p.target_version,
      });
      if (result) {
        await h.refresh();
        const task = target().querySelector(
          `[data-stockwork-task="${result.id}"]`,
        );
        if (task) await click(task);
      }
      return true;
    }
    if (button.dataset.stockworkTask) {
      const t = state.tasks.find(
        (t) => t.id === Number(button.dataset.stockworkTask),
      );
      document.getElementById("wms-stockwork-detail").innerHTML =
        `<h3>Uzupełnienie #${t.id}</h3><p>${html(t.sku)} · ${t.quantity} szt. · ${html(t.source)} → ${html(t.target)}</p><form id="wms-stockwork-complete" data-task="${t.id}" class="wms-form">${field("source", "1. Skan zaplecza")}${field("barcode", "2. Skan towaru")}${field("target", "3. Skan półki docelowej")}${field("quantity", "Potwierdzona ilość", "number", t.quantity, `min="1" max="${t.quantity}" step="1"`)}<label>Powód braku, gdy przenosisz mniej sztuk<input name="reason" maxlength="500"></label><p>Mniejsza ilość kieruje źródło do przeliczenia. Stan brakujących sztuk pozostaje do sprawdzenia.</p><button class="primary">POTWIERDŹ UZUPEŁNIENIE</button></form><details><summary>Cel pełny — odłożenie i zwrot reszty</summary><p>Odłóż tylko mieszczącą się ilość i zwróć pozostałe pobrane sztuki na źródło. Cel zostanie zamknięty dla dokładania; zbiórka nadal działa.</p><form id="wms-stockwork-space-finish" data-task="${t.id}" class="wms-form">${field("source", "1. Skan źródła")}${field("barcode", "2. Kod części")}${field("pickedQuantity", "3. Faktycznie pobrane sztuki", "number", "", `min="1" max="${t.quantity}" step="1"`)}${field("quantity", "4. Sztuki pozostawione na celu", "number", "", `min="0" max="${t.quantity - 1}" step="1"`)}${field("target", "5. Skan pełnego celu")}${field("returnedSource", "6. Skan źródła po zwrocie reszty")}${field("reason", "Opis braku miejsca, także braków źródła")}<button>ROZLICZ ODŁOŻENIE I ZWROT</button></form></details><details><summary>Puste źródło — zero pobranych sztuk</summary><p>Potwierdź etykietę źródła i kod części. Zgłoszenie nie przesuwa towaru, a źródło trafi do przeliczenia.</p><form id="wms-stockwork-empty" data-task="${t.id}" class="wms-form">${field("source", "Skan zaplecza")}${field("barcode", "Kod części z etykiety")}${field("reason", "Opis braku")}<button>ZGŁOŚ PUSTE ŹRÓDŁO</button></form></details><details><summary>Anuluj zadanie</summary><p>Najpierw upewnij się, że fizyczny towar pozostaje na lokalizacji źródłowej. Anulowanie nie przesuwa zapasu.</p><form id="wms-stockwork-cancel" data-task="${t.id}" class="wms-form">${field("source", "Skan źródła po odłożeniu towaru")}${field("reason", "Powód anulowania")}<button>ANULUJ ZADANIE</button></form></details>`;
      focus(
        document
          .getElementById("wms-stockwork-complete")
          .elements.namedItem("source"),
      );
      document
        .getElementById("wms-stockwork-detail")
        .scrollIntoView({ block: "start" });
      return true;
    }
    if (button.dataset.stockworkSpace) {
      const c = state.capacityIssues.find(
        (c) => c.id === Number(button.dataset.stockworkSpace),
      );
      document.getElementById("wms-stockwork-detail").innerHTML =
        `<h3>Zwolnienie miejsca: ${html(c.bin)} · ${html(c.sku)}</h3><p>Sprawdź fizyczne miejsce. W Zapasach ustaw pojemność tej części. Zdjęcie blokady nie zmienia zapasu ani limitu.</p><form id="wms-stockwork-space-resolve" data-issue="${c.id}" class="wms-form">${field("bin", "Skan lokalizacji")}${field("reason", "Jak zwolniono miejsce")}<button>ODBLOCKUJ DOKŁADANIE</button></form>`;
      focus(
        document
          .getElementById("wms-stockwork-space-resolve")
          .elements.namedItem("bin"),
      );
      document
        .getElementById("wms-stockwork-detail")
        .scrollIntoView({ block: "start" });
      return true;
    }
    if (button.dataset.stockworkCheck) {
      const c = state.checks.find(
        (c) => c.id === Number(button.dataset.stockworkCheck),
      );
      if (c.observation_id) {
        const stale = c.observed_version !== c.stock_version;
        document.getElementById("wms-stockwork-detail").innerHTML =
          `<h3>Wynik liczenia: ${html(c.bin)} · ${html(c.sku)}</h3><p>Policzył: ${html(c.counter_name || "Operator")} · ${html(c.observed_at)}</p><p><strong>Policzono ${c.observed_quantity} szt.</strong> · stan WMS teraz: ${c.on_hand} szt.</p><p>${stale ? "Stan zmienił się od liczenia. Zleć ponowne liczenie; tego wyniku nie można zatwierdzić." : "Zatwierdzenie skoryguje stan półki i odbuduje rezerwacje. Zgłoszenia skrzynek pozostają do wyjaśnienia."}</p><form id="wms-stockwork-review" data-check="${c.id}" class="wms-form"><label>Decyzja<select name="decision">${stale ? "" : '<option value="accept">Zatwierdź policzoną ilość</option>'}<option value="recount">Zleć ponowne liczenie</option></select></label>${field("reason", "Uzasadnienie decyzji")}<button class="primary">ZAPISZ DECYZJĘ</button></form>`;
        focus(
          document
            .getElementById("wms-stockwork-review")
            .elements.namedItem("reason"),
        );
        document
          .getElementById("wms-stockwork-detail")
          .scrollIntoView({ block: "start" });
        return true;
      }
      document.getElementById("wms-stockwork-detail").innerHTML =
        `<h3>Przelicz ${html(c.bin)} · ${html(c.sku)}</h3><p>Policz sprawne sztuki fizycznie na półce, bez sztuk znajdujących się w skrzynkach. WMS zweryfikuje i odbuduje rezerwacje według priorytetu zamówień.</p><form id="wms-stockwork-count" data-check="${c.id}" class="wms-form">${field("bin", "Skan lokalizacji")}${field("barcode", "Skan towaru")}${field("quantity", "Liczba policzonych sztuk", "number", "", 'min="0" max="1000000"')}${field("reason", "Uzasadnienie przeliczenia")}<button class="primary">ZAPISZ PRZELICZENIE</button></form>`;
      focus(
        document
          .getElementById("wms-stockwork-count")
          .elements.namedItem("bin"),
      );
      document
        .getElementById("wms-stockwork-detail")
        .scrollIntoView({ block: "start" });
      return true;
    }
    return false;
  }
  async function submit(form, values) {
    if (!form.id.startsWith("wms-stockwork-")) return false;
    if (form.id === "wms-stockwork-filter") {
      query = values.q;
      await h.refresh();
      return true;
    }
    let url,
      body = { ...values };
    // Prefiks etykiety lokalizacji nie może zmienić SKU o podobnym początku.
    for (const name of ["source", "target", "returnedSource", "bin"])
      if (typeof body[name] === "string")
        body[name] = body[name].trim().replace(/^LOC:/i, "");
    if (form.id === "wms-stockwork-complete") {
      url = `/api/wms/replenishments/${form.dataset.task}/complete`;
      body.quantity = Number(values.quantity);
      if (!body.reason.trim()) delete body.reason;
    }
    if (form.id === "wms-stockwork-empty") {
      const task = state.tasks.find((t) => t.id === Number(form.dataset.task));
      url = `/api/wms/replenishments/${task.id}/complete`;
      body.quantity = 0;
      body.target = task.target;
    }
    if (form.id === "wms-stockwork-space-finish") {
      url = `/api/wms/replenishments/${form.dataset.task}/complete`;
      body.quantity = Number(values.quantity);
      body.pickedQuantity = Number(values.pickedQuantity);
      body.targetFull = true;
    }
    if (form.id === "wms-stockwork-space-resolve")
      url = `/api/wms/capacity-issues/${form.dataset.issue}/resolve`;
    if (form.id === "wms-stockwork-cancel")
      url = `/api/wms/replenishments/${form.dataset.task}/cancel`;
    if (form.id === "wms-stockwork-count") {
      const c = state.checks.find((c) => c.id === Number(form.dataset.check));
      url = `/api/wms/stock-checks/${c.id}/count`;
      body.quantity = Number(values.quantity);
      body.version = c.stock_version;
    }
    if (form.id === "wms-stockwork-review") {
      const c = state.checks.find((c) => c.id === Number(form.dataset.check));
      url = `/api/wms/stock-checks/${c.id}/review`;
      body.observationId = c.observation_id;
    }
    if (form.dataset.order) {
      const o = state.repairs.find((o) => o.id === Number(form.dataset.order));
      url = "/api/wms/reservation-repair";
      body.orderId = o.id;
      body.version = o.version;
    }
    const result = await mutate(url, body);
    if (result) {
      await h.refresh();
      if (result.completed)
        h.message(
          `Przesunięto ${result.quantity} szt.${result.targetFull ? ` Zwrócono ${result.returned} szt. Cel czeka na zwolnienie miejsca.` : ""}${result.shortage ? ` Brak ${result.shortage} szt. Źródło czeka na przeliczenie.` : ""}`,
        );
      if (result.recount)
        h.message(
          "Zlecono ponowne liczenie. Poprzedni wynik pozostał w historii. Półka nadal jest zablokowana.",
        );
      if (result.results)
        h.message(
          `Przeliczono półkę. ${result.results.filter((r) => !r.reserved).length} zamówień nadal wymaga zapasu. Zgłoszenia skrzynek rozwiąż na trasie wózka.`,
        );
    }
    return true;
  }
  return { render, click, submit };
};
