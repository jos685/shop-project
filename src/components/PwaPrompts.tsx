import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// ── helpers ───────────────────────────────────────────────────────────────────
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;

// Bump ICON_VERSION whenever the PWA icon changes so installed users see the nudge once
const ICON_VERSION   = "2";
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

  const [reloading,  setReloading]  = useState(false);
  const [countdown,  setCountdown]  = useState(10);
  const handleReload = () => { setReloading(true); updateServiceWorker(true); };

  // Count down from 10 when update is available
  useEffect(() => {
    if (!needRefresh) return;
    setCountdown(10);
    const id = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(id);
  }, [needRefresh]);

  // Auto-reload when countdown hits 0
  useEffect(() => {
    if (!needRefresh || countdown > 0) return;
    handleReload();
  }, [countdown, needRefresh]);

  if (!needRefresh) return null;

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div style={{
        position: "fixed", bottom: 88, left: 12, right: 12,
        zIndex: 99999,
        background: "linear-gradient(135deg,#0d1117,#111827)",
        border: "1px solid rgba(6,182,212,0.45)",
        borderRadius: 16, padding: "14px 16px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        animation: "pwaSlideUp 0.35s cubic-bezier(0.16,1,0.3,1) both",
        maxWidth: 480, marginLeft: "auto", marginRight: "auto",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
          }}>
            {reloading
              ? <span style={{ display: "inline-block", animation: "pwaSpin 0.8s linear infinite" }}>🔄</span>
              : "⬆️"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#06b6d4", fontFamily: "monospace", marginBottom: 1 }}>
              Update available
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "monospace" }}>
              {reloading ? "Reloading…" : `Auto-refreshing in ${countdown}s`}
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
              transition: "background 0.2s", whiteSpace: "nowrap",
            }}
          >
            {reloading ? "Reloading…" : `Reload (${countdown}s)`}
          </button>
        </div>
        {/* Countdown progress bar */}
        {!reloading && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(6,182,212,0.12)" }}>
            <div style={{
              height: "100%", background: "#06b6d4",
              width: `${(countdown / 10) * 100}%`,
              transition: "width 1s linear",
            }} />
          </div>
        )}
      </div>
    </>
  );
}

// ── 2. Install banner — shows in browser, hides inside installed PWA ──────────
// Dismissed per session only — reappears every time the user opens the browser.
export function PwaInstallBanner() {
  type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);


  useEffect(() => {
    // Already installed as a PWA — never show
    if (isStandalone()) return;
    // User dismissed this session — don't show again until next session
    if (sessionStorage.getItem(INSTALL_SESSION_KEY)) return;

    // Show the banner immediately
    setVisible(true);

   

    // Listen for native install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      // We can set this even for desktop Chrome
     
    };
    
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(INSTALL_SESSION_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    // iOS always shows instructions
    if (isIos()) { 
      setShowIosSteps(true); 
      return; 
    }

    // Android with native prompt available
    if (prompt) {
      setInstalling(true);
      try {
        await prompt.prompt();
        setPrompt(null);
        setVisible(false);
      } catch (error) {
        console.error("Install prompt failed:", error);
      } finally {
        setInstalling(false);
      }
      return;
    }

    // Chrome/Edge on desktop where the prompt might be in the address bar
    if (!isIos() && !/android/i.test(navigator.userAgent)) {
      // Check if we're in Chrome or Edge
      if (/chrome/i.test(navigator.userAgent) || /edg/i.test(navigator.userAgent)) {
        // Show a helpful message pointing to the address bar
        setShowIosSteps(true);
        return;
      }
    }

    // Other browsers (Firefox, Safari on Mac, etc.)
    // Android but not Chrome/Edge
    if (/android/i.test(navigator.userAgent)) {
      // Show Android-specific instructions
      setShowIosSteps(true);
      return;
    }

    // Fallback: show instructions
    setShowIosSteps(true);
  };

  if (!visible) return null;

  // Determine which instructions to show
  const getInstructions = () => {
    if (isIos()) {
      return [
        { n: "1", text: "Tap the Share button ⎙ at the bottom of Safari" },
        { n: "2", text: 'Scroll down and tap "Add to Home Screen"' },
        { n: "3", text: 'Tap "Add" — done! 🎉' },
      ];
    }

    if (/android/i.test(navigator.userAgent)) {
      // Android-specific instructions
      if (/chrome/i.test(navigator.userAgent) || /edg/i.test(navigator.userAgent)) {
        // Chrome/Edge on Android - should have prompt, but if not, show fallback
        if (!prompt) {
          return [
            { n: "1", text: 'Tap the menu icon (⋮) in the top right' },
            { n: "2", text: 'Tap "Install app" or "Add to Home screen"' },
            { n: "3", text: 'Follow the prompts to install 🎉' },
          ];
        }
        return [
          { n: "1", text: 'Wait for the install prompt to appear' },
          { n: "2", text: 'Or tap the "Install" button below' },
          { n: "3", text: 'Follow the on-screen instructions 🎉' },
        ];
      }
      // Other Android browsers
      return [
        { n: "1", text: "Open this page in Chrome or Edge browser" },
        { n: "2", text: 'Look for the install icon (⊞) in the address bar or menu' },
        { n: "3", text: 'Tap "Install" to add to home screen 🎉' },
      ];
    }

    // Desktop Chrome/Edge fallback
    if (/chrome/i.test(navigator.userAgent) || /edg/i.test(navigator.userAgent)) {
      return [
        { n: "1", text: 'Look for the install icon (⊞) in the address bar' },
        { n: "2", text: 'Click the icon to install the app' },
        { n: "3", text: 'Or click the "Install" button below 🎉' },
      ];
    }

    // Default instructions for other desktop browsers
    return [
      { n: "1", text: "Open this page in Chrome or Edge browser" },
      { n: "2", text: 'Look for the install icon in the address bar' },
      { n: "3", text: 'Click the icon and follow the prompts 🎉' },
    ];
  };

  // Determine button text
  const getButtonText = () => {
    if (installing) return "Installing…";
    if (isIos()) return "📱 iOS Guide";
    if (prompt) return "📲 Install";
    if (/android/i.test(navigator.userAgent)) return "📱 Install";
    return "📲 Install";
  };

  // Determine if we should show the pulse animation
  const shouldPulse = !installing && !isIos();

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
            src="/Qash.png"
            alt="Q-SHOP"
            style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
              Add Q-SHOP to Home Screen
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginTop: 2, lineHeight: 1.4 }}>
              {isIos() 
                ? "Available via Safari's share menu" 
                : prompt 
                ? "One-tap install available" 
                : "Install for faster access and offline use"}
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
                animation: shouldPulse ? "pwaPulse 2.5s ease infinite" : "none",
                whiteSpace: "nowrap",
              }}
            >
              {getButtonText()}
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

        {/* Install steps */}
        {showIosSteps && (
          <div style={{
            marginTop: 12,
            background: "rgba(6,182,212,0.06)",
            border: "1px solid rgba(6,182,212,0.2)",
            borderRadius: 10, padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {getInstructions().map(s => (
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
