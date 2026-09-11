/* Zdjęcie pomaga rozpoznać podobne części; skan nadal rozstrzyga tożsamość.
   Pobieranie nie blokuje skanera, a stary obraz nigdy nie przechodzi na nowe SKU. */
window.WmsPhotos = ({ html, session }) => {
  const cache = new Map();
  let pending = null,
    mounted = null,
    dialog = null,
    returnFocus = null,
    lastScan = null;
  document.addEventListener("focusin", (event) => {
    if (
      event.target.closest?.("#widokWms") &&
      ["bin", "barcode", "tote", "quantity"].includes(event.target.name)
    )
      lastScan = event.target;
  });
  const markup = (part) =>
    `<div class="wms-photo" data-photo-id="${Number(part.tw_id)}" data-photo-sku="${html(part.sku)}" data-photo-name="${html(part.name)}"><span class="wms-photo-status" role="status">Wczytywanie zdjęcia…</span></div>`;
  function clear() {
    pending?.controller.abort();
    pending = null;
    mounted = null;
    lastScan = null;
    returnFocus = null;
    dialog?.close();
    for (const value of cache.values())
      if (value.url) URL.revokeObjectURL(value.url);
    cache.clear();
  }
  function paint(node, value) {
    if (!node.isConnected || node !== mounted) return;
    node.innerHTML = value.url
      ? `<button type="button" class="wms-photo-open" aria-label="Powiększ zdjęcie ${html(node.dataset.photoSku)}"><img src="${value.url}" alt="${html(node.dataset.photoName)} · ${html(node.dataset.photoSku)}"><span>Powiększ</span></button>`
      : `<span class="wms-photo-status" role="status">${value.missing ? "Brak zdjęcia produktu" : "Nie udało się wczytać zdjęcia"}</span><button type="button" class="wms-photo-retry">Ponów zdjęcie</button>`;
    const img = node.querySelector("img");
    if (img) {
      img.onerror = () => {
        if (node !== mounted) return;
        URL.revokeObjectURL(value.url);
        cache.delete(node.dataset.photoId);
        paint(node, {});
      };
      node.querySelector("button").onclick = () => {
        if (!dialog) {
          dialog = document.createElement("dialog");
          dialog.className = "wms-photo-dialog";
          dialog.setAttribute("aria-labelledby", "wms-photo-title");
          document.body.append(dialog);
          dialog.addEventListener("close", () => {
            dialog.replaceChildren();
            if (returnFocus?.isConnected)
              returnFocus.focus({ preventScroll: true });
          });
          dialog.addEventListener("click", (e) => {
            if (e.target === dialog) dialog.close();
          });
        }
        returnFocus = lastScan?.isConnected
          ? lastScan
          : node
              .closest("#widokWms")
              .querySelector(
                'form input[name="bin"]:not([type="hidden"]), form input[name="tote"]:not([type="hidden"])',
              ) || node.querySelector("button");
        dialog.innerHTML = `<div class="wms-photo-dialog-head"><h2 id="wms-photo-title">${html(node.dataset.photoSku)} · ${html(node.dataset.photoName)}</h2><button type="button" autofocus>Zamknij zdjęcie</button></div><img src="${value.url}" alt="${html(node.dataset.photoName)}"><p>Porównaj część. Potwierdź właściwy towar skanem kodu.</p>`;
        dialog.querySelector("button").onclick = () => dialog.close();
        dialog.showModal();
      };
    } else node.querySelector("button").onclick = () => load(node, true);
  }
  async function load(node, retry = false) {
    const id = node.dataset.photoId;
    if (!/^[1-9]\d*$/.test(id)) {
      paint(node, { missing: true });
      return;
    }
    const saved = cache.get(id);
    if (!retry && saved && saved.until > Date.now()) {
      cache.delete(id);
      cache.set(id, saved);
      paint(node, saved);
      return;
    }
    pending?.controller.abort();
    const controller = new AbortController(),
      key = session();
    const job = { controller, node };
    pending = job;
    const timer = setTimeout(() => controller.abort(), 10000);
    node.innerHTML =
      '<span class="wms-photo-status" role="status">Wczytywanie zdjęcia…</span>';
    try {
      const response = await fetch(`/api/products/${id}/zdjecie`, {
        headers: { "x-session": key },
        signal: controller.signal,
      });
      let value;
      if (response.status === 404)
        value = { missing: true, until: Date.now() + 30000 };
      else {
        if (
          !response.ok ||
          !/^image\/(jpeg|png|webp|gif|bmp|tiff)(;|$)/i.test(
            response.headers.get("content-type") || "",
          )
        )
          throw new Error("photo");
        const blob = await response.blob();
        if (controller.signal.aborted || key !== session()) return;
        value = { url: URL.createObjectURL(blob), until: Date.now() + 300000 };
      }
      if (controller.signal.aborted || key !== session()) return;
      if (saved?.url) URL.revokeObjectURL(saved.url);
      cache.delete(id);
      cache.set(id, value);
      while (cache.size > 24) {
        const first = cache.keys().next().value;
        if (cache.get(first).url) URL.revokeObjectURL(cache.get(first).url);
        cache.delete(first);
      }
      paint(job.node, value);
    } catch {
      if (pending === job && job.node === mounted && key === session())
        paint(job.node, {});
    } finally {
      clearTimeout(timer);
      if (pending === job) pending = null;
    }
  }
  function mount(root) {
    const node = root.querySelector("[data-photo-id]");
    if (node === mounted) return;
    // Kolejna skrzynka z tym samym SKU nie przerywa pobierania przez wolne Wi-Fi.
    if (node && pending?.node.dataset.photoId === node.dataset.photoId) {
      pending.node = node;
      mounted = node;
      return;
    }
    pending?.controller.abort();
    mounted = node;
    dialog?.close();
    if (node) void load(node);
  }
  return { markup, mount, clear };
};
