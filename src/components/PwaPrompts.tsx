import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// ── helpers ───────────────────────────────────────────────────────────────────
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;

// Bump ICON_VERSION whenever the PWA icon changes so installed users see the nudge once
const ICON_VERSION   = "1";
const REINSTALL_KEY  = `pos_pwa_reinstall_seen_v${ICON_VERSION}`;
// Session-only dismiss — banner reappears every new browser session
const INSTALL_SESSION_KEY = "pos_pwa_install_dismissed_session";

const SHARED_STYLES = `
  @keyframes pwaSlideUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pwaPulse   { 0%,100%{box-shadow:0 0 0 0 rgba(6,182,212,0.55)} 60%{box-shadow:0 0 0 9px rgba(6,182,212,0)} }
  @keyframes pwaSpin    { to{transform:rotate(360deg)} }
`;

// ── 1. Update toast ───────────────────────────────────────────────────────────
export function PwaUpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (!r) return;
      const poll = setInterval(() => r.update(), 10 * 60 * 1000);
      const onVisible = () => { if (document.visibilityState === "visible") r.update(); };
      document.addEventListener("visibilitychange", onVisible);
      return () => { clearInterval(poll); document.removeEventListener("visibilitychange", onVisible); };
    },
  });

  const [reloading, setReloading] = useState(false);
  const handleReload = () => { setReloading(true); updateServiceWorker(true); };

  if (!needRefresh) return null;

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div style={{
        position: "fixed", bottom: 88, left: "50%", transform: "translateX(-50%)",
        zIndex: 99999, display: "flex", alignItems: "center", gap: 12,
        background: "linear-gradient(135deg,#0d1117,#111827)",
        border: "1px solid rgba(6,182,212,0.45)",
        borderRadius: 16, padding: "14px 16px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        animation: "pwaSlideUp 0.35s cubic-bezier(0.16,1,0.3,1) both",
        whiteSpace: "nowrap",
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
        }}>
          {reloading
            ? <span style={{ display: "inline-block", animation: "pwaSpin 0.8s linear infinite" }}>🔄</span>
            : "⬆️"}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#06b6d4", fontFamily: "monospace", marginBottom: 1 }}>
            Update available
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "monospace" }}>
            New version ready — reload to apply
          </div>
        </div>
        <button
          onClick={handleReload}
          disabled={reloading}
          style={{
            background: reloading ? "rgba(6,182,212,0.15)" : "linear-gradient(135deg,#0891b2,#06b6d4)",
            border: "none", borderRadius: 9,
            padding: "9px 16px", color: "#fff",
            fontFamily: "monospace", fontSize: 12, fontWeight: 700,
            cursor: reloading ? "not-allowed" : "pointer", flexShrink: 0,
            animation: reloading ? "none" : "pwaPulse 2s ease infinite",
            transition: "background 0.2s",
          }}
        >
          {reloading ? "Reloading…" : "Reload"}
        </button>
      </div>
    </>
  );
}

// ── 2. Install banner — shows in browser, hides inside installed PWA ──────────
// Dismissed per session only — reappears every time the user opens the browser.
export function PwaInstallBanner() {
  type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };
  const [prompt, setPrompt]         = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible]       = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    // Already installed as a PWA — never show
    if (isStandalone()) return;
    // User dismissed this session — don't show again until next session
    if (sessionStorage.getItem(INSTALL_SESSION_KEY)) return;

    // Show the banner immediately regardless of browser/platform
    setVisible(true);

    // Also listen for the native install prompt (Chrome/Edge/Android)
    // so the Install button can trigger the real dialog when available
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(INSTALL_SESSION_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (isIos()) { setShowIosSteps(v => !v); return; }
    if (prompt) {
      // Native one-tap install (Chrome / Edge / Android)
      setInstalling(true);
      await prompt.prompt();
      setPrompt(null);
      setVisible(false);
    } else {
      // Prompt not yet available — show instructions
      setShowIosSteps(v => !v);
    }
  };

  if (!visible) return null;

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div style={{
        position: "fixed", bottom: 72, left: 12, right: 12,
        zIndex: 99998,
        background: "linear-gradient(135deg,#0d1117,#0f172a)",
        border: "1px solid rgba(6,182,212,0.35)",
        borderRadius: 16, padding: "14px 14px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
        animation: "pwaSlideUp 0.35s cubic-bezier(0.16,1,0.3,1) both",
        maxWidth: 480, marginLeft: "auto", marginRight: "auto",
      }}>

        {/* Main row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src="/shop2.png"
            alt="QASHUP POS"
            style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
              Add QASHUP to Home Screen
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginTop: 2, lineHeight: 1.4 }}>
              Install for faster access and offline use
            </div>
          </div>
          <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
            <button
              onClick={install}
              disabled={installing}
              style={{
                background: installing ? "rgba(6,182,212,0.15)" : "linear-gradient(135deg,#0891b2,#06b6d4)",
                border: "none", borderRadius: 9, padding: "9px 15px",
                color: "#fff", fontFamily: "monospace", fontSize: 12, fontWeight: 700,
                cursor: installing ? "not-allowed" : "pointer",
                animation: installing ? "none" : "pwaPulse 2.5s ease infinite",
                whiteSpace: "nowrap",
              }}
            >
              {installing ? "Installing…" : "📲 Install"}
            </button>
            <button
              onClick={dismiss}
              title="Close"
              style={{
                background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 9, padding: "9px 11px",
                color: "rgba(255,255,255,0.35)", fontFamily: "monospace",
                fontSize: 14, cursor: "pointer", lineHeight: 1,
              }}
            >✕</button>
          </div>
        </div>

        {/* Install steps (iOS or browser without native prompt) */}
        {showIosSteps && (
          <div style={{
            marginTop: 12,
            background: "rgba(6,182,212,0.06)",
            border: "1px solid rgba(6,182,212,0.2)",
            borderRadius: 10, padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {(isIos() ? [
              { n: "1", text: "Tap the Share button ⎙ at the bottom of Safari" },
              { n: "2", text: 'Scroll down and tap "Add to Home Screen"' },
              { n: "3", text: 'Tap "Add" — done! 🎉' },
            ] : [
              { n: "1", text: "Open this page in Chrome or Edge browser" },
              { n: "2", text: 'Look for the install icon (⊞) in the address bar and click it' },
              { n: "3", text: 'Click "Install" in the dialog — the app installs instantly 🎉' },
            ]).map(s => (
              <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  background: "rgba(6,182,212,0.2)", border: "1px solid rgba(6,182,212,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: "#06b6d4", fontFamily: "monospace",
                }}>{s.n}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "monospace", lineHeight: 1.5 }}>
                  {s.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── 3. Reinstall nudge — shown inside the PWA when icon version changes ───────
// Dismissed permanently (localStorage) — only fires once per icon update.
export function PwaReinstallNudge() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isStandalone()) return;
    if (localStorage.getItem(REINSTALL_KEY)) return;
    setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(REINSTALL_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  const iosDevice = isIos();

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div style={{
        position: "fixed", bottom: 80, left: 12, right: 12,
        zIndex: 99997,
        background: "linear-gradient(135deg,#0d1117,#0f172a)",
        border: "1px solid rgba(234,179,8,0.35)",
        borderRadius: 16, padding: "14px 14px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
        animation: "pwaSlideUp 0.35s cubic-bezier(0.16,1,0.3,1) both",
        maxWidth: 480, marginLeft: "auto", marginRight: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>🎨</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24", fontFamily: "monospace" }}>
              We updated the app icon!
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginTop: 2, lineHeight: 1.5 }}>
              {iosDevice
                ? "Remove the app · open in Safari · re-add to Home Screen"
                : "Uninstall · reopen in Chrome · tap Install again"}
            </div>
          </div>
          <button
            onClick={dismiss}
            title="Dismiss"
            style={{
              background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 9, padding: "9px 11px",
              color: "rgba(255,255,255,0.35)", fontFamily: "monospace",
              fontSize: 14, cursor: "pointer", lineHeight: 1, flexShrink: 0,
            }}
          >✕</button>
        </div>
      </div>
    </>
  );
}
