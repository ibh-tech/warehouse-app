const grid = document.getElementById("grid");
const loadingEl = document.getElementById("loading");
const emptyEl = document.getElementById("empty");
const countPill = document.getElementById("count-pill");
const warehouseFilter = document.getElementById("warehouse-filter");
const invoiceSearch = document.getElementById("invoice-search");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const statsBar = document.getElementById("stats-bar");

let allPhotos = [];

function publicUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/parcel-photos/${path}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

async function loadPhotos() {
  loadingEl.classList.add("show");
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/photos?select=*&order=captured_at.desc`,
      {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    if (!res.ok) throw new Error("Failed to load: " + res.status);
    allPhotos = await res.json();
    render();
  } catch (err) {
    loadingEl.querySelector("div:last-child").textContent =
      "Could not load photos. Check your internet connection and try refreshing.";
    loadingEl.querySelector(".spinner").style.display = "none";
    console.error(err);
  }
}

function renderStats(filtered) {
  const total = filtered.length;
  const today = filtered.filter((p) => isToday(p.captured_at)).length;
  const perWarehouse = { 1: 0, 2: 0, 3: 0 };
  for (const p of filtered) {
    if (perWarehouse[p.warehouse] !== undefined) perWarehouse[p.warehouse]++;
  }

  statsBar.innerHTML = `
    <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">Total</div></div>
    <div class="stat"><div class="stat-value">${today}</div><div class="stat-label">Today</div></div>
    <div class="stat"><div class="stat-value">${perWarehouse[1]}</div><div class="stat-label">Warehouse 1</div></div>
    <div class="stat"><div class="stat-value">${perWarehouse[2]}</div><div class="stat-label">Warehouse 2</div></div>
    <div class="stat"><div class="stat-value">${perWarehouse[3]}</div><div class="stat-label">Warehouse 3</div></div>
  `;
}

function render() {
  loadingEl.classList.remove("show");

  const wh = warehouseFilter.value;
  const q = invoiceSearch.value.trim().toLowerCase();

  const filtered = allPhotos.filter((p) => {
    if (wh && String(p.warehouse) !== wh) return false;
    if (q && !(p.invoice_number || "").toLowerCase().includes(q)) return false;
    return true;
  });

  countPill.textContent = `${filtered.length} photo${filtered.length === 1 ? "" : "s"}`;
  renderStats(filtered);

  grid.innerHTML = "";
  emptyEl.classList.toggle("show", filtered.length === 0);

  for (const p of filtered) {
    const card = document.createElement("div");
    card.className = "card";

    const img = document.createElement("img");
    img.src = publicUrl(p.photo_path);
    img.loading = "lazy";
    img.addEventListener("click", () => {
      lightboxImg.src = img.src;
      lightbox.classList.add("show");
    });

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <div class="invoice">${p.invoice_number ? escapeHtml(p.invoice_number) : "(no invoice number)"}</div>
      <div class="meta-row">
        <span class="wh-tag">WH ${escapeHtml(String(p.warehouse))}</span>
        <span>${formatTime(p.captured_at)}</span>
      </div>
    `;

    card.appendChild(img);
    card.appendChild(body);
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

lightbox.addEventListener("click", () => lightbox.classList.remove("show"));
warehouseFilter.addEventListener("change", render);
invoiceSearch.addEventListener("input", render);

loadPhotos();
