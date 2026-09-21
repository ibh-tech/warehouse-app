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

const WAREHOUSE_NAMES = ["76", "FF", "PL", "BS", "AB", "NG", "Office"];

function renderStats(filtered) {
  const total = filtered.length;
  const today = filtered.filter((p) => isToday(p.captured_at)).length;
  const perWarehouse = {};
  for (const name of WAREHOUSE_NAMES) perWarehouse[name] = 0;
  for (const p of filtered) {
    if (perWarehouse[p.warehouse] !== undefined) perWarehouse[p.warehouse]++;
    else perWarehouse[p.warehouse] = (perWarehouse[p.warehouse] || 0) + 1; // catches any older/unexpected values
  }

  const whStatsHtml = Object.keys(perWarehouse)
    .map((name) => `<div class="stat"><div class="stat-value">${perWarehouse[name]}</div><div class="stat-label">${escapeHtml(name)}</div></div>`)
    .join("");

  statsBar.innerHTML = `
    <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">Total</div></div>
    <div class="stat"><div class="stat-value">${today}</div><div class="stat-label">Today</div></div>
    ${whStatsHtml}
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

    const imgWrap = document.createElement("div");
    imgWrap.className = "img-wrap";

    const img = document.createElement("img");
    img.src = publicUrl(p.photo_path);
    img.loading = "lazy";
    img.addEventListener("click", () => {
      lightboxImg.src = img.src;
      lightbox.classList.add("show");
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.title = "Delete this photo";
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7h10Z" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10 11v6M14 11v6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    `;
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deletePhoto(p);
    });

    imgWrap.appendChild(img);
    imgWrap.appendChild(deleteBtn);

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <div class="invoice">${p.invoice_number ? escapeHtml(p.invoice_number) : "(no invoice number)"}</div>
      <div class="meta-row">
        <span class="wh-tag">WH ${escapeHtml(String(p.warehouse))}</span>
      </div>
      <div class="time-row"><span class="time-label">Captured</span><span>${formatTime(p.captured_at)}</span></div>
      <div class="time-row"><span class="time-label">Uploaded</span><span>${formatTime(p.uploaded_at)}</span></div>
    `;

    card.appendChild(imgWrap);
    card.appendChild(body);
    grid.appendChild(card);
  }
}

async function deletePhoto(p) {
  const label = p.invoice_number ? `invoice ${p.invoice_number}` : "this photo";
  if (!confirm(`Delete ${label}? This removes it from storage and the table, and cannot be undone.`)) {
    return;
  }
  try {
    const storageRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/parcel-photos/${p.photo_path}`,
      {
        method: "DELETE",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    // 404 just means the file was already gone - fine to continue either way
    if (!storageRes.ok && storageRes.status !== 404) {
      throw new Error("Storage delete failed: " + storageRes.status);
    }

    const rowRes = await fetch(`${SUPABASE_URL}/rest/v1/photos?id=eq.${p.id}`, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": "return=minimal"
      }
    });
    if (!rowRes.ok) throw new Error("Row delete failed: " + rowRes.status);

    allPhotos = allPhotos.filter((x) => x.id !== p.id);
    render();
  } catch (err) {
    alert("Could not delete this photo. Check your connection and try again.");
    console.error(err);
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
