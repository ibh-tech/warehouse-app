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
const invoiceInput = document.getElementById("invoice-input");
const successCheckEl = document.getElementById("success-check");

warehouseEl.textContent = "Warehouse " + WAREHOUSE;

// type: "ok" (green), "error" (red), "busy" (gray), or omit for neutral gray
function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.classList.remove("status-ok", "status-error", "status-busy");
  if (type) statusEl.classList.add("status-" + type);
}

function showSuccessCheck() {
  successCheckEl.classList.remove("show");
  // force reflow so the animation can restart if triggered again quickly
  void successCheckEl.offsetWidth;
  successCheckEl.classList.add("show");
}

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

// ---- Compress the photo before it ever gets queued/uploaded ----
// Resizes to a sensible max dimension and re-encodes as JPEG at ~75%
// quality. This cuts typical phone photos (3-5 MB) down to roughly
// 200-400 KB with very little visible quality loss - which matters a
// lot on a free Supabase storage plan capped at 1 GB total.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.75;

function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          resolve(blob || file); // fall back to original if compression fails
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fall back to original if it can't be read as an image
    };

    img.src = objectUrl;
  });
}

// ---- Capture handler ----
captureBtn.addEventListener("click", () => {
  if (!invoiceInput.value.trim()) {
    setStatus("Enter the invoice/order number first.", "error");
    invoiceInput.focus();
    return;
  }
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = ""; // reset so the same photo can be retaken if needed
  if (!file) return;

  setStatus("Processing photo...", "busy");
  const compressed = await compressImage(file);

  const capturedAt = new Date().toISOString(); // the REAL moment of capture
  const invoiceNumber = invoiceInput.value.trim();

  await queueAdd({
    blob: compressed,
    warehouse: WAREHOUSE,
    capturedAt: capturedAt,
    invoiceNumber: invoiceNumber
  });

  flashEl.classList.add("show");
  setTimeout(() => flashEl.classList.remove("show"), 250);

  invoiceInput.value = ""; // ready for the next parcel

  await refreshQueueCount();
  setStatus("Photo saved. Uploading...", "busy");
  trySync();
});

// ---- Sync loop: push whatever is queued, whenever we can ----
let syncing = false;

async function uploadOne(item) {
  const ext = (item.blob.type && item.blob.type.includes("png")) ? "png" : "jpg";
  const safeInvoice = (item.invoiceNumber || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
  const path = `${item.warehouse}/${safeInvoice}-${item.capturedAt.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

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
      captured_at: item.capturedAt,
      invoice_number: item.invoiceNumber || null
    })
  });
  if (!insertRes.ok) throw new Error("row insert failed: " + insertRes.status);
}

async function trySync() {
  if (syncing) return;
  if (typeof SUPABASE_URL === "undefined" || SUPABASE_URL.includes("PASTE_")) {
    setStatus("Config not set up yet (config.js still has placeholder values).", "error");
    return;
  }
  syncing = true;
  let hadItems = false;
  let allSucceeded = true;
  try {
    const items = await queueGetAll();
    if (items.length === 0) {
      setStatus("Ready.", "ok");
      syncing = false;
      return;
    }
    hadItems = true;
    setStatus(`Uploading ${items.length} photo(s)...`, "busy");
    for (const item of items) {
      try {
        await uploadOne(item);
        await queueDelete(item.id);
      } catch (err) {
        console.warn("Upload failed, will retry:", err);
        setStatus("Offline or upload failed - will retry automatically.", "error");
        allSucceeded = false;
        break;
      }
    }
  } finally {
    const remaining = await refreshQueueCount();
    if (remaining === 0) {
      setStatus("Ready. All photos uploaded.", "ok");
      if (hadItems && allSucceeded) showSuccessCheck();
    }
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
