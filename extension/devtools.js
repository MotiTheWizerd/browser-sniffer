const DB_NAME = 'netprofiler';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function getRecentEvents(db, limit) {
  return new Promise((resolve, reject) => {
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

function showTab(name) {
  document.getElementById('timeline').style.display = name === 'timeline' ? 'block' : 'none';
  document.getElementById('inspect').style.display = name === 'inspect' ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('#tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  const db = await openDB();
  const events = await getRecentEvents(db, 200);
  const timelineDiv = document.getElementById('timeline');
  const inspectDiv = document.getElementById('inspect');

  const groups = {};
  events.forEach((e) => {
    const host = e.http ? e.http.url.host : 'ws';
    groups[host] = groups[host] || [];
    groups[host].push(e);
  });

  for (const [host, evts] of Object.entries(groups)) {
    const hostDiv = document.createElement('div');
    const header = document.createElement('h4');
    header.textContent = host;
    hostDiv.appendChild(header);
    evts.forEach((ev) => {
      const item = document.createElement('div');
      if (ev.type === 'http') {
        item.textContent = `${ev.http.method} ${ev.http.url.path} ${ev.http.status || ''}`;
      } else {
        item.textContent = `WS ${ev.ws.direction} ${ev.ws.size || 0}B`;
      }
      item.addEventListener('click', () => {
        inspectDiv.textContent = JSON.stringify(ev, null, 2);
        showTab('inspect');
      });
      hostDiv.appendChild(item);
    });
    timelineDiv.appendChild(hostDiv);
  }
});

