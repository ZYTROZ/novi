<script>

const API_URL = "";

const SESSION_KEY = "noviSession";
const KEY_STORAGE = "noviKey";
const DEVICE_STORAGE = "noviDeviceId";

let sessionToken =
  localStorage.getItem(SESSION_KEY) || "";

let currentKey =
  localStorage.getItem(KEY_STORAGE) || "";

let deviceId =
  localStorage.getItem(DEVICE_STORAGE) || "";

let expirationTime = null;

let savedItems = [];

let socket = null;

let socketReconnectTimer = null;

let socketReconnectDelay = 1000;

let fallbackRefreshTimer = null;

let isLoggingOut = false;


/* ======================================================
   DEVICE ID
====================================================== */

if (!deviceId) {

  if (
    window.crypto &&
    typeof crypto.randomUUID === "function"
  ) {

    deviceId =
      "device_" +
      crypto.randomUUID();

  } else {

    deviceId =
      "device_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2);
  }

  localStorage.setItem(
    DEVICE_STORAGE,
    deviceId
  );
}


/* ======================================================
   HELPERS
====================================================== */

function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function getStockValue(item) {

  if (typeof item === "string") {
    return item;
  }

  if (!item || typeof item !== "object") {
    return "";
  }

  return (
    item.stock_id ??
    item.stockId ??
    item.value ??
    item.code ??
    item.item ??
    item.id ??
    ""
  );
}


function showToast(message) {

  const toast =
    document.getElementById("toast");

  if (!toast) {
    return;
  }

  toast.textContent = String(message);

  toast.classList.add("show");

  clearTimeout(showToast.timeout);

  showToast.timeout =
    setTimeout(() => {

      toast.classList.remove("show");

    }, 2500);
}


function showLoginError(message) {

  const error =
    document.getElementById("loginError");

  error.textContent =
    String(message);

  error.classList.remove("hidden");
}


function clearLoginError() {

  document
    .getElementById("loginError")
    .classList.add("hidden");
}


/* ======================================================
   AUTH FETCH
====================================================== */

async function authenticatedFetch(
  url,
  options = {}
) {

  const headers = {
    ...(options.headers || {}),
    "x-novi-session": sessionToken
  };

  return fetch(
    API_URL + url,
    {
      ...options,
      headers
    }
  );
}


/* ======================================================
   LOGIN
====================================================== */

async function unlock() {

  clearLoginError();

  const key =
    document
      .getElementById("keyInput")
      .value
      .trim();

  if (!key) {

    showLoginError(
      "Enter your Novi key."
    );

    return;
  }

  const button =
    document.getElementById(
      "unlockBtn"
    );

  button.disabled = true;

  button.textContent =
    "Checking...";

  try {

    const response =
      await fetch(
        API_URL + "/api/verify",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              key,
              deviceId
            })
        }
      );

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.message ||
        data.error ||
        "Invalid key."
      );
    }

    /*
     * Your server returns:
     *
     * sessionToken
     * key
     * expiresAt
     */

    sessionToken =
      data.sessionToken ||
      data.session ||
      data.token ||
      "";

    currentKey =
      data.key?.key ||
      data.key ||
      key;

    expirationTime =
      data.key?.expiresAt ||
      data.expiresAt ||
      null;

    if (!sessionToken) {

      throw new Error(
        "Server did not return a session token."
      );
    }

    localStorage.setItem(
      SESSION_KEY,
      sessionToken
    );

    localStorage.setItem(
      KEY_STORAGE,
      currentKey
    );

    showDashboard();

  } catch (error) {

    console.error(
      "[NOVI] Login error:",
      error
    );

    showLoginError(
      error.message ||
      "Unable to unlock Novi."
    );

  } finally {

    button.disabled = false;

    button.textContent =
      "Unlock Novi";
  }
}


/* ======================================================
   DASHBOARD
====================================================== */

function showDashboard() {

  document
    .getElementById("loginPage")
    .classList.add("hidden");

  document
    .getElementById("dashboard")
    .classList.remove("hidden");

  updateKeyInfo();

  loadStock();

  /*
   * Saved Items is optional.
   *
   * Your current server.js does not
   * contain saved-item endpoints, so
   * don't let that failure log you out.
   */

  loadSavedItems();

  startLiveUpdates();
}


/* ======================================================
   KEY INFO
====================================================== */

function updateKeyInfo() {

  document.getElementById(
    "currentKey"
  ).textContent =
    currentKey || "—";

  document.getElementById(
    "deviceId"
  ).textContent =
    deviceId || "—";

  if (!expirationTime) {

    document.getElementById(
      "expiration"
    ).textContent =
      "Lifetime";

    document.getElementById(
      "duration"
    ).textContent =
      "Lifetime";

    return;
  }

  let timestamp =
    Number(expirationTime);

  if (!Number.isFinite(timestamp)) {

    timestamp =
      new Date(
        expirationTime
      ).getTime();
  }

  if (!Number.isFinite(timestamp)) {

    document.getElementById(
      "expiration"
    ).textContent =
      "Unknown";

    document.getElementById(
      "duration"
    ).textContent =
      "Unknown";

    return;
  }

  const date =
    new Date(timestamp);

  document.getElementById(
    "expiration"
  ).textContent =
    date.toLocaleDateString();

  const remaining =
    timestamp - Date.now();

  if (remaining <= 0) {

    document.getElementById(
      "keyStatus"
    ).textContent =
      "Expired";

    document.getElementById(
      "keyStatus"
    ).classList.remove(
      "online"
    );

    document.getElementById(
      "duration"
    ).textContent =
      "Expired";

    return;
  }

  const days =
    Math.ceil(
      remaining /
      (1000 * 60 * 60 * 24)
    );

  document.getElementById(
    "duration"
  ).textContent =
    `${days} day${days === 1 ? "" : "s"} remaining`;
}


/* ======================================================
   LOAD STOCK COUNT
====================================================== */

async function loadStock() {

  const countElement =
    document.getElementById(
      "stockCount"
    );

  const statusText =
    document.getElementById(
      "stockStatusText"
    );

  try {

    const response =
      await authenticatedFetch(
        "/api/stock"
      );

    /*
     * ONLY a real 401 means the
     * server rejected the session.
     */

    if (
      response.status === 401
    ) {

      console.warn(
        "[NOVI] Session expired."
      );

      forceLogout();

      return;
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.message ||
        data.error ||
        "Failed to load stock."
      );
    }

    const count =
      Number(data.count);

    const safeCount =
      Number.isFinite(count) &&
      count >= 0
        ? count
        : 0;

    countElement.textContent =
      safeCount;

    if (safeCount === 0) {

      statusText.textContent =
        "No stock available right now.";

    } else {

      statusText.textContent =
        "Click Generate to receive one item.";
    }

  } catch (error) {

    /*
     * IMPORTANT:
     *
     * Do NOT call forceLogout()
     * here unless response.status
     * was specifically 401.
     */

    console.error(
      "[NOVI] Stock load error:",
      error
    );

    countElement.textContent =
      "—";

    statusText.textContent =
      error.message ||
      "Unable to load stock.";
  }
}


/* ======================================================
   GENERATE ONE ITEM
====================================================== */

async function generateStock() {

  const button =
    document.getElementById(
      "generateButton"
    );

  if (!button || button.disabled) {
    return;
  }

  button.disabled = true;

  button.textContent =
    "Generating...";

  try {

    const response =
      await authenticatedFetch(
        "/api/stock/generate",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({})
        }
      );

    /*
     * Only 401 logs the user out.
     */

    if (
      response.status === 401
    ) {

      forceLogout();

      return;
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.message ||
        data.error ||
        "Unable to generate item."
      );
    }

    /*
     * YOUR SERVER RETURNS:
     *
     * {
     *   success: true,
     *   item: "...",
     *   remaining: 5
     * }
     *
     * NOT:
     *
     * items
     * stockRemaining
     */

    if (
      data.item === null ||
      data.item === undefined ||
      String(data.item).trim() === ""
    ) {

      document.getElementById(
        "stockCount"
      ).textContent =
        "0";

      document.getElementById(
        "stockStatusText"
      ).textContent =
        "No stock available right now.";

      showToast(
        "No stock available."
      );

      return;
    }

    /*
     * Display the exact item returned
     * by the backend.
     */

    showGenerated([
      data.item
    ]);

    /*
     * Update stock counter.
     */

    const remaining =
      Number(data.remaining);

    if (
      Number.isFinite(remaining) &&
      remaining >= 0
    ) {

      document.getElementById(
        "stockCount"
      ).textContent =
        remaining;

    } else {

      await loadStock();
    }

    const statusText =
      document.getElementById(
        "stockStatusText"
      );

    if (
      Number.isFinite(remaining) &&
      remaining === 0
    ) {

      statusText.textContent =
        "No stock available right now.";

    } else {

      statusText.textContent =
        "Click Generate to receive another item.";
    }

    showToast(
      "Generated 1 item."
    );

  } catch (error) {

    console.error(
      "[NOVI] Generate error:",
      error
    );

    showToast(
      error.message ||
      "Unable to generate stock."
    );

    /*
     * Refresh the count, but DON'T
     * log the user out because of a
     * normal generation error.
     */

    await loadStock();

  } finally {

    button.disabled = false;

    button.textContent =
      "Generate";
  }
}


/* ======================================================
   SHOW GENERATED ITEM
====================================================== */

function showGenerated(items) {

  const section =
    document.getElementById(
      "generatedSection"
    );

  const list =
    document.getElementById(
      "generatedList"
    );

  if (
    !Array.isArray(items) ||
    !items.length
  ) {

    section.classList.add(
      "hidden"
    );

    return;
  }

  const value =
    getStockValue(items[0]);

  if (!value) {

    section.classList.add(
      "hidden"
    );

    return;
  }

  list.innerHTML = `
    <div class="generated-item">

      <div class="generated-value">
        ${escapeHtml(value)}
      </div>

      <button
        class="generated-copy"
        onclick="copyValue(this.dataset.value)"
        data-value="${escapeHtml(value)}"
      >
        Copy
      </button>

    </div>
  `;

  section.classList.remove(
    "hidden"
  );
}


/* ======================================================
   SAVED ITEM HELPERS
====================================================== */

function getSavedValue(item) {

  if (typeof item === "string") {
    return item;
  }

  if (!item || typeof item !== "object") {
    return "";
  }

  return (
    item.value ??
    item.stock_id ??
    item.stockId ??
    item.code ??
    item.item ??
    ""
  );
}


/* ======================================================
   LOAD SAVED ITEMS
====================================================== */

async function loadSavedItems() {

  const list =
    document.getElementById(
      "savedList"
    );

  /*
   * The server.js you sent does not
   * currently have /api/saved-items.
   *
   * Treat 404 as "feature unavailable"
   * instead of an authentication failure.
   */

  try {

    const response =
      await authenticatedFetch(
        "/api/saved-items"
      );

    if (
      response.status === 401
    ) {

      forceLogout();

      return;
    }

    if (
      response.status === 404
    ) {

      savedItems = [];

      renderSavedItems();

      return;
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.message ||
        data.error ||
        "Failed to load saved items."
      );
    }

    savedItems =
      Array.isArray(data.items)
        ? data.items
        : (
            Array.isArray(data.saved)
              ? data.saved
              : []
          );

    renderSavedItems();

  } catch (error) {

    console.warn(
      "[NOVI] Saved items unavailable:",
      error.message
    );

    savedItems = [];

    renderSavedItems();
  }
}


/* ======================================================
   RENDER SAVED ITEMS
====================================================== */

function renderSavedItems() {

  const list =
    document.getElementById(
      "savedList"
    );

  const count =
    document.getElementById(
      "savedCount"
    );

  count.textContent =
    savedItems.length;

  if (!savedItems.length) {

    list.innerHTML = `
      <div class="empty">
        No saved items yet.
      </div>
    `;

    return;
  }

  list.innerHTML =
    savedItems
      .map(item => {

        const value =
          getSavedValue(item);

        const id =
          item.id ||
          item._id ||
          "";

        const created =
          item.created_at ||
          item.createdAt ||
          null;

        let dateText = "";

        if (created) {

          const date =
            new Date(created);

          if (
            !Number.isNaN(
              date.getTime()
            )
          ) {

            dateText =
              `Saved ${date.toLocaleString()}`;
          }
        }

        return `
          <div class="saved-item">

            <div class="saved-main">

              <div class="saved-value">
                ${escapeHtml(value)}
              </div>

              ${
                dateText
                  ? `
                    <div class="saved-time">
                      ${escapeHtml(dateText)}
                    </div>
                  `
                  : ""
              }

            </div>

            <div class="saved-actions">

              <button
                class="copy-btn"
                onclick="copyValue(this.dataset.value)"
                data-value="${escapeHtml(value)}"
              >
                Copy
              </button>

              <button
                class="remove-btn"
                onclick="removeSavedItem(this.dataset.id)"
                data-id="${escapeHtml(id)}"
              >
                Remove
              </button>

            </div>

          </div>
        `;
      })
      .join("");
}


/* ======================================================
   SAVE ITEM
====================================================== */

async function toggleSavedItem(value) {

  if (!value) {

    showToast(
      "Nothing to save."
    );

    return;
  }

  const existing =
    savedItems.find(item => {

      return (
        getSavedValue(item)
          .trim()
          .toLowerCase() ===
        String(value)
          .trim()
          .toLowerCase()
      );
    });

  if (existing) {

    await removeSavedItem(
      existing.id ||
      existing._id
    );

    return;
  }

  try {

    const response =
      await authenticatedFetch(
        "/api/saved-items",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              value
            })
        }
      );

    if (
      response.status === 401
    ) {

      forceLogout();

      return;
    }

    if (
      response.status === 404
    ) {

      showToast(
        "Saved Items is not enabled on the server."
      );

      return;
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.message ||
        data.error ||
        "Failed to save item."
      );
    }

    showToast(
      "Item saved."
    );

    await loadSavedItems();

  } catch (error) {

    showToast(
      error.message ||
      "Unable to save item."
    );
  }
}


/* ======================================================
   REMOVE SAVED ITEM
====================================================== */

async function removeSavedItem(id) {

  if (!id) {

    showToast(
      "Unable to remove saved item."
    );

    return;
  }

  try {

    const response =
      await authenticatedFetch(
        "/api/saved-items/" +
        encodeURIComponent(id),
        {
          method: "DELETE"
        }
      );

    if (
      response.status === 401
    ) {

      forceLogout();

      return;
    }

    if (
      response.status === 404
    ) {

      showToast(
        "Saved Items is not enabled on the server."
      );

      return;
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.message ||
        data.error ||
        "Failed to remove saved item."
      );
    }

    showToast(
      "Saved item removed."
    );

    await loadSavedItems();

  } catch (error) {

    showToast(
      error.message ||
      "Unable to remove saved item."
    );
  }
}


/* ======================================================
   COPY
====================================================== */

async function copyValue(value) {

  try {

    await navigator.clipboard.writeText(
      String(value)
    );

    showToast(
      "Copied to clipboard."
    );

  } catch (error) {

    console.error(
      "[NOVI] Copy error:",
      error
    );

    showToast(
      "Copy failed."
    );
  }
}


/* ======================================================
   LIVE STATUS
====================================================== */

function setLiveStatus(
  connected,
  message
) {

  const status =
    document.getElementById(
      "liveStatus"
    );

  const text =
    document.getElementById(
      "liveStatusText"
    );

  if (!status || !text) {
    return;
  }

  text.textContent =
    message;

  if (connected) {

    status.classList.add(
      "connected"
    );

  } else {

    status.classList.remove(
      "connected"
    );
  }
}


/* ======================================================
   LIVE UPDATES
====================================================== */

function startLiveUpdates() {

  isLoggingOut = false;

  connectWebSocket();

  startFallbackRefresh();
}


function connectWebSocket() {

  if (
    isLoggingOut ||
    !sessionToken
  ) {
    return;
  }

  if (
    socket &&
    (
      socket.readyState ===
      WebSocket.OPEN ||

      socket.readyState ===
      WebSocket.CONNECTING
    )
  ) {

    return;
  }

  setLiveStatus(
    false,
    "Connecting"
  );

  const protocol =
    location.protocol ===
    "https:"
      ? "wss:"
      : "ws:";

  const host =
    location.host;

  try {

    socket =
      new WebSocket(
        `${protocol}//${host}/ws`
      );

    socket.onopen = () => {

      socketReconnectDelay =
        1000;

      setLiveStatus(
        true,
        "Live"
      );

      document.getElementById(
        "sessionStatus"
      ).textContent =
        "Connected";

      loadStock();
    };


    socket.onmessage =
      event => {

        try {

          const data =
            JSON.parse(
              event.data
            );

          if (
            data.type ===
            "stock:update"
          ) {

            if (
              typeof data.count ===
              "number"
            ) {

              document.getElementById(
                "stockCount"
              ).textContent =
                data.count;

              document.getElementById(
                "stockStatusText"
              ).textContent =
                data.count > 0
                  ? "Click Generate to receive one item."
                  : "No stock available right now.";
            }

            return;
          }

          if (
            data.type ===
            "stock:count"
          ) {

            if (
              typeof data.count ===
              "number"
            ) {

              document.getElementById(
                "stockCount"
              ).textContent =
                data.count;

              document.getElementById(
                "stockStatusText"
              ).textContent =
                data.count > 0
                  ? "Click Generate to receive one item."
                  : "No stock available right now.";
            }

            return;
          }

        } catch (error) {

          console.warn(
            "[NOVI] Invalid WebSocket message."
          );
        }
      };


    socket.onerror =
      error => {

        console.warn(
          "[NOVI] WebSocket error."
        );

        setLiveStatus(
          false,
          "Reconnecting"
        );
      };


    socket.onclose =
      () => {

        if (isLoggingOut) {
          return;
        }

        setLiveStatus(
          false,
          "Reconnecting"
        );

        scheduleWebSocketReconnect();
      };

  } catch (error) {

    console.warn(
      "[NOVI] WebSocket connection failed:",
      error
    );

    scheduleWebSocketReconnect();
  }
}


/* ======================================================
   WEBSOCKET RECONNECT
====================================================== */

function scheduleWebSocketReconnect() {

  if (isLoggingOut) {
    return;
  }

  clearTimeout(
    socketReconnectTimer
  );

  socketReconnectTimer =
    setTimeout(() => {

      connectWebSocket();

      socketReconnectDelay =
        Math.min(
          socketReconnectDelay * 2,
          15000
        );

    }, socketReconnectDelay);
}


/* ======================================================
   FALLBACK REFRESH
====================================================== */

function startFallbackRefresh() {

  clearInterval(
    fallbackRefreshTimer
  );

  fallbackRefreshTimer =
    setInterval(() => {

      if (
        isLoggingOut ||
        !sessionToken
      ) {
        return;
      }

      if (
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
      ) {

        loadStock();
      }

    }, 5000);
}


/* ======================================================
   STOP LIVE UPDATES
====================================================== */

function stopLiveUpdates() {

  isLoggingOut = true;

  clearTimeout(
    socketReconnectTimer
  );

  clearInterval(
    fallbackRefreshTimer
  );

  if (socket) {

    try {
      socket.close();
    } catch {}
  }

  socket = null;

  setLiveStatus(
    false,
    "Disconnected"
  );
}


/* ======================================================
   LOGOUT
====================================================== */

async function logout() {

  try {

    if (sessionToken) {

      await authenticatedFetch(
        "/api/logout",
        {
          method: "POST"
        }
      );
    }

  } catch (error) {

    console.warn(
      "[NOVI] Logout request failed."
    );
  }

  forceLogout();
}


/* ======================================================
   FORCE LOGOUT
====================================================== */

function forceLogout() {

  stopLiveUpdates();

  sessionToken = "";

  currentKey = "";

  expirationTime = null;

  savedItems = [];

  localStorage.removeItem(
    SESSION_KEY
  );

  localStorage.removeItem(
    KEY_STORAGE
  );

  document
    .getElementById("dashboard")
    .classList.add("hidden");

  document
    .getElementById("loginPage")
    .classList.remove("hidden");

  document
    .getElementById("keyInput")
    .value = "";

  document.getElementById(
    "sessionStatus"
  ).textContent =
    "Disconnected";

  document.getElementById(
    "savedCount"
  ).textContent =
    "0";

  document.getElementById(
    "savedList"
  ).innerHTML = `
    <div class="empty">
      No saved items yet.
    </div>
  `;
}


/* ======================================================
   EXISTING SESSION
====================================================== */

async function checkExistingSession() {

  if (!sessionToken) {
    return;
  }

  try {

    const response =
      await authenticatedFetch(
        "/api/stock"
      );

    /*
     * Only a 401 means the session
     * is invalid.
     */

    if (
      response.status === 401
    ) {

      forceLogout();

      return;
    }

    if (!response.ok) {

      /*
       * Don't destroy the stored session
       * because of a temporary server error.
       */

      console.warn(
        "[NOVI] Existing session check returned:",
        response.status
      );

      showDashboard();

      return;
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (
      !data.success
    ) {

      console.warn(
        "[NOVI] Existing session response was invalid."
      );

      showDashboard();

      return;
    }

    showDashboard();

  } catch (error) {

    /*
     * Network/server failure is NOT
     * automatically treated as logout.
     */

    console.warn(
      "[NOVI] Session check failed:",
      error
    );

    showDashboard();
  }
}


/* ======================================================
   ENTER KEY LOGIN
====================================================== */

document
  .getElementById("keyInput")
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        unlock();
      }
    }
  );


/* ======================================================
   START
====================================================== */

checkExistingSession();

</script>
