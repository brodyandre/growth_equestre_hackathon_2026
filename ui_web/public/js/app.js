window.__GE_APP_JS_LOADED__ = true;

async function pingBackend() {
  const badge = document.getElementById("backendStatus");
  if (!badge) return;

  const healthPath = (window.__GE__?.paths?.health || "/health");
  try {
    const resp = await fetch(`/api${healthPath}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    badge.textContent = "online";
    badge.classList.remove("badge-warn", "badge-bad");
    badge.classList.add("badge-ok");
  } catch (e) {
    badge.textContent = "offline";
    badge.classList.remove("badge-ok", "badge-warn");
    badge.classList.add("badge-bad");
  }
}
pingBackend();
setInterval(pingBackend, 15000);
