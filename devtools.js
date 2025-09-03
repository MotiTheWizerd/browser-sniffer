const DB_NAME = 'netprofiler';
const DB_VERSION = 1; // bump if you change schema

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      // Create stores if missing. Keep names EXACTLY the same everywhere.
      if (!db.objectStoreNames.contains('events_v1')) {
        // Choose a key schema that matches how you write events in background.js
        db.createObjectStore('events_v1', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta_v1')) {
        db.createObjectStore('meta_v1', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn('[IDB] Open blocked — close other tabs/panels using this DB.');
    };
  });
}

async function getRecentEvents(db, limit) {
  return new Promise((resolve, reject) => {
    // Defensive: if the store still doesn't exist, don't crash the UI.
    if (!db.objectStoreNames.contains('events_v1')) {
      console.warn('[IDB] events_v1 store missing — returning empty list.');
      resolve([]);
      return;
    }

    const tx = db.transaction('events_v1', 'readonly');
    const store = tx.objectStore('events_v1');
    const req = store.openCursor(null, 'prev');
    const events = [];

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && events.length < limit) {
        events.push(cursor.value);
        cursor.continue();
      } else {
        resolve(events.reverse());
      }
    };
    req.onerror = () => reject(req.error);
  });
}
