const searchInput = document.getElementById("search");
const refreshButton = document.getElementById("refresh");
const clearAllButton = document.getElementById("clearAll");
const storageTableBody = document.querySelector("#storageTable tbody");
const emptyState = document.getElementById("emptyState");
const summary = document.getElementById("summary");
const tabButtons = Array.from(document.querySelectorAll(".tab"));

let allItems = [];
let activeFilter = "all";

function computeSize(value) {
  return new Blob([value]).size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function renderRows(items) {
  storageTableBody.innerHTML = "";
  if (!items.length) {
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  items.forEach((item) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.type}</td>
      <td>${item.key}</td>
      <td><pre>${item.value}</pre></td>
      <td>${formatBytes(item.size)}</td>
      <td><button data-type="${item.type}" data-key="${item.key}">Remove</button></td>
    `;
    storageTableBody.appendChild(row);
  });

  storageTableBody.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => removeItem(button.dataset));
  });
}

function updateSummary(items) {
  const count = items.length;
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  summary.textContent = `${count} item${count === 1 ? "" : "s"} · ${formatBytes(totalBytes)} total`;
}

function getActiveItems() {
  const filter = activeFilter;
  const query = searchInput.value.trim().toLowerCase();

  return allItems
    .filter((item) => filter === "all" || item.type === filter)
    .filter((item) => {
      if (!query) return true;
      return item.key.toLowerCase().includes(query) || item.value.toLowerCase().includes(query);
    });
}

function refreshUI() {
  const items = getActiveItems();
  renderRows(items);
  updateSummary(items);
}

function fetchPageStorage(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const local = [];
      const session = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        local.push({ type: "localStorage", key, value: localStorage.getItem(key) });
      }

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        session.push({ type: "sessionStorage", key, value: sessionStorage.getItem(key) });
      }

      return { local, session };
    }
  }).then((results) => results[0].result);
}

function fetchCookies(url) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ url }, (cookies) => {
      const list = cookies.map((cookie) => ({
        type: "cookies",
        key: cookie.name,
        value: `${cookie.value}`,
      }));
      resolve(list);
    });
  });
}

function loadStorage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || tab.url.startsWith("chrome://")) {
      storageTableBody.innerHTML = "";
      emptyState.textContent = "Open a normal webpage to inspect storage.";
      emptyState.style.display = "block";
      summary.textContent = "";
      return;
    }

    Promise.all([fetchPageStorage(tab.id), fetchCookies(tab.url)])
      .then(([pageStorage, cookieList]) => {
        const localItems = pageStorage.local.map((item) => ({
          ...item,
          size: computeSize(item.key + item.value),
        }));

        const sessionItems = pageStorage.session.map((item) => ({
          ...item,
          size: computeSize(item.key + item.value),
        }));

        const cookieItems = cookieList.map((item) => ({
          ...item,
          size: computeSize(item.key + item.value),
        }));

        allItems = [...localItems, ...sessionItems, ...cookieItems];
        refreshUI();
      })
      .catch((err) => {
        storageTableBody.innerHTML = "";
        emptyState.textContent = `Unable to inspect storage: ${err.message || err}`;
        emptyState.style.display = "block";
        summary.textContent = "";
      });
  });
}

function removeItem({ type, key }) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    if (type === "cookies") {
      const url = tab.url;
      chrome.cookies.remove({ url, name: key }, () => loadStorage());
    } else {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (type, key) => {
          if (type === "localStorage") localStorage.removeItem(key);
          if (type === "sessionStorage") sessionStorage.removeItem(key);
        },
        args: [type, key]
      }, loadStorage);
    }
  });
}

function clearAll() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        localStorage.clear();
        sessionStorage.clear();
      }
    });

    chrome.cookies.getAll({ url: tab.url }, (cookies) => {
      cookies.forEach((cookie) => {
        chrome.cookies.remove({ url: tab.url, name: cookie.name });
      });
      setTimeout(loadStorage, 300);
    });
  });
}

searchInput.addEventListener("input", refreshUI);
refreshButton.addEventListener("click", loadStorage);
clearAllButton.addEventListener("click", clearAll);

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.type;
    refreshUI();
  });
});

loadStorage();