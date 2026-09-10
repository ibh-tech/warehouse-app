// ===================================================================
// PARCEL PROOF - camera capture + offline queue + auto-upload
// Plain-English map of this file:
//  1. Work out which warehouse this phone belongs to (once, from the link)
//  2. Open a small on-phone database to hold photos that haven't uploaded yet
//  3. When the button is tapped -> take photo -> save it to that local queue immediately
//  4. Separately, a sync loop keeps trying to push queued photos to Supabase
//     whenever there's a connection, using the ORIGINAL capture time
// ===================================================================

const statusEl = document.getElementById("status");
const warehouseEl = document.getElementById("warehouse-label");
const queueCountEl = document.getElementById("queue-count");
const captureBtn = document.getElementById("capture-btn");
const fileInput = document.getElementById("file-input");
const flashEl = document.getElementById("flash");

// ---- 1. Work out the warehouse for this phone ----
function getWarehouse() {
  const params = new URLSearchParams(window.location.search);
  const fromLink = params.get("wh");
  if (fromLink) {
    localStorage.setItem("warehouse", fromLink);
    return fromLink;
  }
  const stored = localStorage.getItem("warehouse");
  return stored || null;
}

const warehouse = getWarehouse();

if (!warehouse) {
  warehouseEl.textContent = "No warehouse set for this link";
  captureBtn.disabled = true;
  statusEl.textContent = "Open this page once using the correct link (ending in ?wh=1, ?wh=2, etc.) before adding it to the home screen.";
} else {
  warehouseEl.textContent = "Warehouse " + warehouse;
  buildTaggedManifest(warehouse);
}

// iOS reads whichever manifest is linked in the page RIGHT NOW when you tap
// "Add to Home Screen," and uses that manifest's start_url forever after -
// it ignores the address bar. So we build a manifest with the warehouse tag
// baked into start_url, and swap the page's manifest link to point at it.
function buildTaggedManifest(wh) {
  const manifest = {
    name: "Parcel Proof - Warehouse " + wh,
    short_name: "Parcel Proof " + wh,
    start_url: "./index.html?wh=" + encodeURIComponent(wh),
    scope: "./",
    display: "standalone",
    background_color: "#1A1D21",
    theme_color: "#1A1D21",
    orientation: "portrait",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  const url = URL.createObjectURL(blob);
  document.getElementById("manifest-link").setAttribute("href", url);
}

// ---- 2. Local offline queue, stored in IndexedDB (survives app close / no signal) ----
const DB_NAME = "parcel-proof-db";
const STORE_NAME = "queue";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAdd(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queueGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function refreshQueueCount() {
  const all = await queueGetAll();
  queueCountEl.textContent = all.length;
  return all.length;
}

// ---- 3. Capture handler ----
captureBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = ""; // reset so the same photo can be retaken if needed
  if (!file) return;

  const capturedAt = new Date().toISOString(); // the REAL moment of capture

  await queueAdd({
    blob: file,
    warehouse: warehouse,
    capturedAt: capturedAt
  });

  flashEl.classList.add("show");
  setTimeout(() => flashEl.classList.remove("show"), 250);

  const count = await refreshQueueCount();
  statusEl.textContent = "Photo saved. Uploading...";
  trySync();
});

// ---- 4. Sync loop: push whatever is queued, whenever we can ----
let syncing = false;

async function uploadOne(item) {
  const ext = (item.blob.type && item.blob.type.includes("png")) ? "png" : "jpg";
  const path = `${item.warehouse}/${item.capturedAt.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/parcel-photos/${path}`,
    {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": item.blob.type || "image/jpeg"
      },
      body: item.blob
    }
  );
  if (!uploadRes.ok) throw new Error("storage upload failed: " + uploadRes.status);

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/photos`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      warehouse: item.warehouse,
      photo_path: path,
      captured_at: item.capturedAt
    })
  });
  if (!insertRes.ok) throw new Error("row insert failed: " + insertRes.status);
}

async function trySync() {
  if (syncing || !warehouse) return;
  if (typeof SUPABASE_URL === "undefined" || SUPABASE_URL.includes("PASTE_")) {
    statusEl.textContent = "Config not set up yet (config.js still has placeholder values).";
    return;
  }
  syncing = true;
  try {
    const items = await queueGetAll();
    if (items.length === 0) {
      statusEl.textContent = "Ready.";
      syncing = false;
      return;
    }
    statusEl.textContent = `Uploading ${items.length} photo(s)...`;
    for (const item of items) {
      try {
        await uploadOne(item);
        await queueDelete(item.id);
      } catch (err) {
        // Leave it in the queue, we'll retry later (likely offline)
        console.warn("Upload failed, will retry:", err);
        statusEl.textContent = "Offline or upload failed - will retry automatically.";
        break;
      }
    }
  } finally {
    const remaining = await refreshQueueCount();
    if (remaining === 0) statusEl.textContent = "Ready. All photos uploaded.";
    syncing = false;
  }
}

window.addEventListener("online", trySync);
setInterval(trySync, 15000); // fallback poll, since phone "online" events aren't always reliable

// Initial state on page load
refreshQueueCount().then(trySync);

// Register the service worker so the app shell loads even with a flaky connection
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  });
}
