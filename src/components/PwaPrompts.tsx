import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTheme } from "../context/ThemeContext";

// ── helpers ───────────────────────────────────────────────────────────────────
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;

const ICON_VERSION   = "2";
const REINSTALL_KEY  = `pos_pwa_reinstall_seen_v${ICON_VERSION}`;
const INSTALL_SESSION_KEY = "pos_pwa_install_dismissed_session";

const SHARED_STYLES = `
  @keyframes pwaSlideUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pwaPulse   { 0%,100%{box-shadow:0 0 0 0 rgba(6,182,212,0.55)} 60%{box-shadow:0 0 0 9px rgba(6,182,212,0)} }
  @keyframes pwaSpin    { to{transform:rotate(360deg)} }
`;

// ── Shared card style factory — theme-aware ───────────────────────────────────
function cardStyle(theme: any, accentBorder: string, zIndex: number) {
  const isDark = theme.isDark;
  return {
    position: "fixed" as const,
    bottom: 88,
    left: 12,
    right: 12,
    zIndex,
    background: isDark
      ? "linear-gradient(135deg,#0d1117,#111827)"
      : theme.bg.card,
    border: `1px solid ${accentBorder}`,
    borderRadius: 16,
    padding: "14px 16px",
    boxShadow: isDark
      ? "0 12px 40px rgba(0,0,0,0.6)"
      : "0 8px 24px rgba(0,0,0,0.12)",
    animation: "pwaSlideUp 0.35s cubic-bezier(0.16,1,0.3,1) both",
    maxWidth: 480,
    marginLeft: "auto",
    marginRight: "auto",
    overflow: "hidden" as const,
  };
}

// ── 1. Update toast ───────────────────────────────────────────────────────────
export function PwaUpdatePrompt() {
  const { theme } = useTheme();
  const isDark = theme.isDark;

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

  useEffect(() => {
    if (!needRefresh) return;
    setCountdown(10);
    const id = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(id);
  }, [needRefresh]);

  useEffect(() => {
    if (!needRefresh || countdown > 0) return;
    handleReload();
  }, [countdown, needRefresh]);

  if (!needRefresh) return null;

  const cyan   = theme.accent.cyan;
  const textMut = theme.text.muted;

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div style={cardStyle(theme, `${cyan}73`, 99999)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: isDark ? "rgba(6,182,212,0.12)" : "rgba(6,182,212,0.1)",
            border: `1px solid ${cyan}4D`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
          }}>
            {reloading
              ? <span style={{ display: "inline-block", animation: "pwaSpin 0.8s linear infinite" }}>🔄</span>
              : "⬆️"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: cyan, fontFamily: theme.font.mono, marginBottom: 1 }}>
              Update available
            </div>
            <div style={{ fontSize: 11, color: textMut, fontFamily: theme.font.mono }}>
              {reloading ? "Reloading…" : `Auto-refreshing in ${countdown}s`}
            </div>
          </div>
          <button
            onClick={handleReload}
            disabled={reloading}
            style={{
              background: reloading
                ? `${cyan}26`
                : `linear-gradient(135deg,${cyan},#0891b2)`,
              border: "none", borderRadius: 9,
              padding: "9px 16px", color: "#fff",
              fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700,
              cursor: reloading ? "not-allowed" : "pointer", flexShrink: 0,
              transition: "background 0.2s", whiteSpace: "nowrap",
            }}
          >
            {reloading ? "Reloading…" : `Reload (${countdown}s)`}
          </button>
        </div>
        {!reloading && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
            background: `${cyan}1F`,
          }}>
            <div style={{
              height: "100%", background: cyan,
              width: `${(countdown / 10) * 100}%`,
              transition: "width 1s linear",
            }} />
          </div>
        )}
      </div>
    </>
  );
}
// ── 2. Install banner ─────────────────────────────────────────────────────────
export function PwaInstallBanner() {
  const { theme } = useTheme();
  const isDark = theme.isDark;

  type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (sessionStorage.getItem(INSTALL_SESSION_KEY)) return;

    setVisible(true);

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
    if (isIos()) { setShowIosSteps(true); return; }

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

    if (!isIos() && !/android/i.test(navigator.userAgent)) {
      if (/chrome/i.test(navigator.userAgent) || /edg/i.test(navigator.userAgent)) {
        setShowIosSteps(true);
        return;
      }
    }

    if (/android/i.test(navigator.userAgent)) {
      setShowIosSteps(true);
      return;
    }

    setShowIosSteps(true);
  };

  if (!visible) return null;

  const getInstructions = () => {
    if (isIos()) {
      return [
        { n: "1", text: "Tap the Share button ⎙ at the bottom of Safari" },
        { n: "2", text: 'Scroll down and tap "Add to Home Screen"' },
        { n: "3", text: 'Tap "Add" — done! 🎉' },
      ];
    }

    if (/android/i.test(navigator.userAgent)) {
      if (/chrome/i.test(navigator.userAgent) || /edg/i.test(navigator.userAgent)) {
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
      return [
        { n: "1", text: "Open this page in Chrome or Edge browser" },
        { n: "2", text: 'Look for the install icon (⊞) in the address bar or menu' },
        { n: "3", text: 'Tap "Install" to add to home screen 🎉' },
      ];
    }

    if (/chrome/i.test(navigator.userAgent) || /edg/i.test(navigator.userAgent)) {
      return [
        { n: "1", text: 'Look for the install icon (⊞) in the address bar' },
        { n: "2", text: 'Click the icon to install the app' },
        { n: "3", text: 'Or click the "Install" button below 🎉' },
      ];
    }

    return [
      { n: "1", text: "Open this page in Chrome or Edge browser" },
      { n: "2", text: 'Look for the install icon in the address bar' },
      { n: "3", text: 'Click the icon and follow the prompts 🎉' },
    ];
  };

  const getButtonText = () => {
    if (installing) return "Installing…";
    if (isIos()) return "📱 iOS Guide";
    if (prompt) return "📲 Install";
    if (/android/i.test(navigator.userAgent)) return "📱 Install";
    return "📲 Install";
  };

  const shouldPulse = !installing && !isIos();

  const cyan    = theme.accent.cyan;
  const textPri = theme.text.primary;
  const textMut = theme.text.muted;

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div style={{ ...cardStyle(theme, `${cyan}59`, 99998), bottom: 72, padding: "14px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src="/Qash.png"
            alt="Q-SHOP"
            style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPri, fontFamily: theme.font.mono }}>
              Add Q-SHOP to Home Screen
            </div>
            <div style={{ fontSize: 11, color: textMut, fontFamily: theme.font.mono, marginTop: 2, lineHeight: 1.4 }}>
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
                background: installing
                  ? `${cyan}26`
                  : `linear-gradient(135deg,${cyan},#0891b2)`,
                border: "none", borderRadius: 9, padding: "9px 15px",
                color: "#fff", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700,
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
                background: "transparent",
                border: `1px solid ${theme.border.default}`,
                borderRadius: 9, padding: "9px 11px",
                color: textMut, fontFamily: theme.font.mono,
                fontSize: 14, cursor: "pointer", lineHeight: 1,
              }}
            >✕</button>
          </div>
          
        </div>

        {showIosSteps && (
          <div style={{
            marginTop: 12,
            background: isDark ? "rgba(6,182,212,0.06)" : "rgba(6,182,212,0.05)",
            border: `1px solid ${cyan}33`,
            borderRadius: 10, padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {getInstructions().map(s => (
              <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  background: isDark ? "rgba(6,182,212,0.2)" : "rgba(6,182,212,0.15)",
                  border: `1px solid ${cyan}66`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: cyan, fontFamily: theme.font.mono,
                }}>{s.n}</span>
                <span style={{ fontSize: 12, color: theme.text.secondary, fontFamily: theme.font.mono, lineHeight: 1.5 }}>
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

// ── 3. Reinstall nudge ────────────────────────────────────────────────────────
export function PwaReinstallNudge() {
  const { theme } = useTheme();
  const isDark = theme.isDark;

  const [visible, setVisible] = useState(false);
  const COUNTDOWN_SECONDS = 15; // how long the banner stays
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (!isStandalone()) return;
    if (localStorage.getItem(REINSTALL_KEY)) return;
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (countdown <= 0) { dismiss(); return; }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [visible, countdown]);
  

  const dismiss = () => {
    localStorage.setItem(REINSTALL_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  const iosDevice = isIos();
  const gold    = theme.accent.gold;
  const textMut = theme.text.muted;

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div style={{ ...cardStyle(theme, `${gold}59`, 99997), bottom: 80, padding: "14px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: isDark ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.1)",
            border: `1px solid ${gold}4D`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          }}>🎨</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: gold, fontFamily: theme.font.mono }}>
              We updated the app icon!
            </div>
            <div style={{ fontSize: 11, color: textMut, fontFamily: theme.font.mono, marginTop: 2, lineHeight: 1.5 }}>
              {iosDevice
                ? "Remove the app · open in Safari · re-add to Home Screen"
                : "Uninstall · reopen in Chrome · tap Install again"}
            </div>
          </div>
          <button
            onClick={dismiss}
            title="Dismiss"
            style={{
              background: "transparent",
              border: `1px solid ${theme.border.default}`,
              borderRadius: 9, padding: "9px 11px",
              color: textMut, fontFamily: theme.font.mono,
              fontSize: 14, cursor: "pointer", lineHeight: 1, flexShrink: 0,
            }}
          >✕</button>
        </div>

        <div style={{
          position: "absolute",
          bottom: 0, left: 0, right: 0, height: 3,
          background: `${gold}1F`,
        }}>
          <div style={{
            height: "100%",
            background: gold,
            width: `${(countdown / COUNTDOWN_SECONDS) * 100}%`,
            transition: "width 1s linear",
          }} />
        </div>
      </div>
    </>
  );
}