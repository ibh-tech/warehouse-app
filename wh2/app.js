// ===================================================================
// PARCEL PROOF - camera capture + offline queue + auto-upload
// The warehouse number for this copy of the page is set by the line
// "const WAREHOUSE = ..." at the top of index.html - it never changes
// at runtime, so there's nothing for the phone or iOS to get wrong.
// ===================================================================

const statusEl = document.getElementById("status");
const warehouseEl = document.getElementById("warehouse-label");
const queueCountEl = document.getElementById("queue-count");
const captureBtn = document.getElementById("capture-btn");
const fileInput = document.getElementById("file-input");
const flashEl = document.getElementById("flash");

warehouseEl.textContent = "Warehouse " + WAREHOUSE;

// ---- Local offline queue, stored in IndexedDB (survives app close / no signal) ----
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

// ---- Capture handler ----
captureBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = ""; // reset so the same photo can be retaken if needed
  if (!file) return;

  const capturedAt = new Date().toISOString(); // the REAL moment of capture

  await queueAdd({
    blob: file,
    warehouse: WAREHOUSE,
    capturedAt: capturedAt
  });

  flashEl.classList.add("show");
  setTimeout(() => flashEl.classList.remove("show"), 250);

  await refreshQueueCount();
  statusEl.textContent = "Photo saved. Uploading...";
  trySync();
});

// ---- Sync loop: push whatever is queued, whenever we can ----
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
  if (syncing) return;
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
setInterval(trySync, 15000);

refreshQueueCount().then(trySync);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  });
}
