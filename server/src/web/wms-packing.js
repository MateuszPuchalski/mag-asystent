/* Numer paczki pozostaje wybrany między skanami, aby operator nie odtwarzał go z pamięci. */
window.WmsPacking = ({ html, field, form }) => {
  const selected = new Map();
  const numbers = (o) =>
    [...new Set(o.packingContents.map((c) => Number(c.parcel_no)))].sort(
      (a, b) => a - b,
    );
  const items = (rows) =>
    `<ul class="wms-parcel-items">${rows.map((c) => `<li><strong>${html(c.sku)}</strong> · ${c.quantity} szt.<br><span class="wms-muted">${html(c.name)}</span></li>`).join("")}</ul>`;
  function controls(o) {
    if (o.lines.every((l) => l.packed === 0)) selected.set(o.id, 1);
    const current = selected.get(o.id) || 1;
    const max = Math.min(20, Math.max(current, ...numbers(o), 1) + 1);
    return `<label class="wms-parcel-selector">Wkładaj do paczki<select name="parcelNo" data-packing-order="${o.id}">${Array.from({ length: max }, (_, i) => `<option value="${i + 1}" ${current === i + 1 ? "selected" : ""}>Paczka ${i + 1}</option>`).join("")}</select></label>`;
  }
  function contents(o) {
    if (!o.packingContents.length) return "";
    return `<details class="wms-parcel-contents"><summary>Zawartość paczek · ${numbers(o).length}</summary>${numbers(
      o,
    )
      .map(
        (n) =>
          `<h3>Paczka ${n}</h3>${items(o.packingContents.filter((c) => Number(c.parcel_no) === n))}`,
      )
      .join("")}</details>`;
  }
  function corrections(o) {
    return `<details class="wms-parcel-corrections"><summary>Przełóż towar lub powtórz kontrolę</summary><p>Przełóż sprawdzone sztuki fizycznie do wskazanej paczki.</p>${form("pack-move", `${field("barcode", "Zeskanuj przekładany towar")}${field("quantity", "Sztuki", "number", 1, 'min="1"')}<div class="wms-fields">${field("fromParcel", "Z paczki", "number", 1, 'min="1" max="20"')}${field("toParcel", "Do paczki", "number", 2, 'min="1" max="20"')}</div>`, "POTWIERDŹ PRZEŁOŻENIE")}<details><summary>Sprawdź całe zamówienie od początku</summary><p>Wyjmij i ponownie zeskanuj zawartość. Zebrany zapas pozostaje przy stanowisku.</p>${form("pack-reset", field("reason", "Powód ponownej kontroli"), "ROZPOCZNIJ KONTROLĘ OD NOWA")}</details></details>`;
  }
  function labels(o) {
    const ns = numbers(o);
    return (ns.length ? ns : [1])
      .map((n, i) => {
        const suffix = i ? String(i + 1) : "";
        const rows =
          ns.length <= 1
            ? o.lines.map((l) => ({ ...l, quantity: l.packed }))
            : o.packingContents.filter((c) => Number(c.parcel_no) === n);
        return `<fieldset class="wms-parcel-label"><legend>Paczka ${n}</legend>${items(rows)}${field("carrier" + suffix, "Przewoźnik", "text", "", 'maxlength="120"')}${field("tracking" + suffix, "Zeskanuj numer przesyłki", "text", "", 'autocomplete="off"')}${field("weightG" + suffix, "Masa paczki (g)", "number", "", 'min="1" max="1000000"')}</fieldset>`;
      })
      .join("");
  }
  function shippingValues(values) {
    const extraParcels = [];
    for (let n = 2; values["tracking" + n] !== undefined; n++)
      extraParcels.push({
        carrier: values["carrier" + n],
        tracking: values["tracking" + n],
        weightG: Number(values["weightG" + n]),
      });
    return {
      carrier: values.carrier,
      tracking: values.tracking,
      weightG: Number(values.weightG),
      extraParcels,
    };
  }
  function problem(o) {
    const ns = numbers(o);
    if (ns.some((n, i) => n !== i + 1))
      return "Paczki muszą mieć kolejne numery od 1. Przełóż zawartość, zanim zeskanujesz etykiety.";
    if (
      ns.length > 1 &&
      o.lines.some(
        (l) =>
          o.packingContents
            .filter((c) => c.line_id === l.id)
            .reduce((sum, c) => sum + c.quantity, 0) !== l.packed,
      )
    )
      return "Podział paczek nie obejmuje wszystkich sprawdzonych sztuk. Powtórz kontrolę całego zamówienia.";
    return "";
  }
  function change(target) {
    if (target.dataset.packingOrder)
      selected.set(Number(target.dataset.packingOrder), Number(target.value));
  }
  function saved(p) {
    return `<details class="wms-saved-parcel"><summary>Paczka ${p.package_no} · ${html(p.carrier)} · <strong>${html(p.tracking)}</strong> · ${p.dispatch_status === "handed" ? "Odebrana" : p.dispatch_status === "ready" ? "Czeka na odbiór" : "Historia"}</summary>${p.contents.length ? items(p.contents) : "<p>Historia bez zapisanego podziału zawartości.</p>"}</details>`;
  }
  return {
    controls,
    contents,
    corrections,
    labels,
    shippingValues,
    change,
    items,
    saved,
    problem,
  };
};
