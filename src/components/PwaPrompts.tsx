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
  @keyframes pwaDrain   { from { width: 100%; } to { width: 0%; } }

   @media (max-width: 480px) {
    /* Only the small screens get pushed full-width; the install banner
       handles its own layout in installCardStyle so we don't fight it. */
    .pwa-install-row {
      flex-wrap: nowrap;
    }
    .pwa-install-actions {
      flex-shrink: 0;
    }
  }
`;

// ── Reusable countdown progress bar ──────────────────────────────────────────
function CountdownBar({
  duration,
  color,
  trackColor,
}: {
  duration: number; // ms
  color: string;
  trackColor: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 3,
        background: trackColor,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          background: color,
          width: "100%",
          animation: `pwaDrain ${duration}ms linear forwards`,
        }}
      />
    </div>
  );
}

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

  const [offlineReady, setOfflineReady] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [countdown, setCountdown] = useState(10);

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (!r) return;
      const poll = setInterval(() => r.update(), 60 * 1000);
      const onVisible = () => { if (document.visibilityState === "visible") r.update(); };
      const onOnline = () => r.update();
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        clearInterval(poll);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", onOnline);
      };
    },
    onOfflineReady() {
      setOfflineReady(true);
      setTimeout(() => setOfflineReady(false), 4000);
    },
  });

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

  const gold    = theme.accent.gold;
  const cyan    = theme.accent.cyan;
  const textMut = theme.text.muted;

  return (
    <>
      <style>{SHARED_STYLES}</style>

      {needRefresh && (
        <div
          className="pwa-shell"
          style={{ ...cardStyle(theme, `${gold}80`, 99999), bottom: 88 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: isDark ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.1)",
              border: `1px solid ${gold}4D`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
            }}>
              {reloading
                ? <span style={{ display: "inline-block", animation: "pwaSpin 0.8s linear infinite" }}>🔄</span>
                : "⬆️"}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: gold, fontFamily: theme.font.mono, marginBottom: 1 }}>
                Update available
              </div>
              <div style={{ fontSize: 11, color: textMut, fontFamily: theme.font.mono }}>
                {reloading ? "Updating…" : `Auto-refreshing in ${countdown}s`}
              </div>
            </div>

            <button
              onClick={handleReload}
              disabled={reloading}
              style={{
                background: reloading
                  ? `${gold}26`
                  : `linear-gradient(135deg,${gold},#f59e0b)`,
                border: "none", borderRadius: 9,
                padding: "9px 16px",
                color: "#0f172a",
                fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700,
                cursor: reloading ? "not-allowed" : "pointer",
                opacity: reloading ? 0.7 : 1,
                flexShrink: 0, whiteSpace: "nowrap",
                transition: "filter 0.15s ease",
              }}
              onMouseEnter={(e) => { if (!reloading) e.currentTarget.style.filter = "brightness(1.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = "brightness(1)"; }}
            >
              {reloading ? "…" : `Update (${countdown}s)`}
            </button>
          </div>

          {!reloading && (
            <CountdownBar duration={10000} color={gold} trackColor={`${gold}1F`} />
          )}
        </div>
      )}

      {offlineReady && !needRefresh && (
        <div
          className="pwa-shell"
          style={{
            ...cardStyle(theme, `${cyan}59`, 99999),
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
            display: "flex", alignItems: "center", gap: 12,
            pointerEvents: "none",
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: isDark ? "rgba(6,182,212,0.12)" : "rgba(6,182,212,0.1)",
            border: `1px solid ${cyan}4D`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
          }}>✓</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: cyan, fontFamily: theme.font.mono, marginBottom: 1 }}>
              Ready offline
            </div>
            <div style={{ fontSize: 11, color: textMut, fontFamily: theme.font.mono }}>
              App cached for offline use
            </div>
          </div>
          <CountdownBar duration={4000} color={cyan} trackColor={`${cyan}1F`} />
        </div>
      )}
    </>
  );
}

// ── 2. Install banner — bottom-right, compact ────────────────────────────────
function installCardStyle(theme: any, accentBorder: string) {
  const isDark = theme.isDark;
  const isNarrow =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 640px)").matches;

  return {
    position: "fixed" as const,
    zIndex: 99998,
    background: isDark
      ? "linear-gradient(135deg,#0d1117,#111827)"
      : theme.bg.card,
    border: `1px solid ${accentBorder}`,
    boxShadow: isDark
      ? "0 10px 30px rgba(0,0,0,0.55)"
      : "0 8px 22px rgba(0,0,0,0.12)",
    animation: "pwaSlideUp 0.35s cubic-bezier(0.16,1,0.3,1) both",
    overflow: "hidden" as const,

    // Mobile: full-width card, floats above the safe area with breathing room.
    // Desktop: compact bottom-right corner card.
    ...(isNarrow
      ? {
          left: 12,
          right: 12,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
          borderRadius: 14,
          padding: "12px 14px",
          maxWidth: 440,
          marginLeft: "auto",
          marginRight: "auto",
        }
      : {
          right: 16,
          left: "auto" as const,
          bottom: 16,
          borderRadius: 14,
          padding: "10px 12px",
          width: 320,
          maxWidth: "calc(100vw - 32px)",
        }),
  };
}

export function PwaInstallBanner() {
  const { theme } = useTheme();
  const isDark = theme.isDark;

  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };

  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [installed, setInstalled] = useState(false);

  const INSTALL_AUTO_DISMISS_MS = 15_000;
  const [showBar, setShowBar] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };

    const installedHandler = () => {
      setInstalled(true);
      setVisible(false);
      setPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  useEffect(() => {
    if (installed || isStandalone()) return;
    if (sessionStorage.getItem(INSTALL_SESSION_KEY)) return;
    setVisible(true);
    setShowBar(true);
  }, [installed]);

  useEffect(() => {
    if (!visible || showIosSteps) return;
    const id = setTimeout(() => setVisible(false), INSTALL_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [visible, showIosSteps]);

  const dismiss = () => {
    sessionStorage.setItem(INSTALL_SESSION_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (isIos()) {
      setShowIosSteps(true);
      return;
    }

    if (prompt) {
      setInstalling(true);
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;

        if (outcome === "accepted") {
          setVisible(false);
          setPrompt(null);
        } else {
          setPrompt(null);
        }
      } catch (err) {
        console.error("Install prompt failed:", err);
        setPrompt(null);
      } finally {
        setInstalling(false);
      }
      return;
    }

    setShowIosSteps(true);
  };

  if (!visible || installed) return null;

  const getInstructions = () => {
    if (isIos()) {
      return [
        { n: "1", text: "Tap the Share button ⎙ at the bottom of Safari" },
        { n: "2", text: 'Scroll down and tap "Add to Home Screen"' },
        { n: "3", text: 'Tap "Add" — done! 🎉' },
      ];
    }

    if (/android/i.test(navigator.userAgent)) {
      return [
        { n: "1", text: 'Tap the menu icon (⋮) in the top right' },
        { n: "2", text: 'Tap "Install app" or "Add to Home screen"' },
        { n: "3", text: 'Confirm the install 🎉' },
      ];
    }

    return [
      { n: "1", text: 'Look for the install icon (⊞) in the address bar' },
      { n: "2", text: 'Click it and confirm the install' },
      { n: "3", text: 'The app will appear on your home screen 🎉' },
    ];
  };

  const getButtonText = () => {
    if (installing) return "Installing…";
    return "📲 Install";
  };

  const shouldPulse = !installing && !isIos() && !!prompt;

  const cyan    = theme.accent.cyan;
  const textPri = theme.text.primary;
  const textMut = theme.text.muted;

  return (
    <>
      <style>{SHARED_STYLES}</style>
      <div
        className="pwa-install-shell"
        style={installCardStyle(theme, `${cyan}59`)}
      >
        <div
          className="pwa-install-row"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <img
            src="/Qash.png"
            alt="Q-SHOP"
            style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
           
            <div style={{ fontSize: 10, fontWeight: 700, color: textPri, fontFamily: theme.font.mono, marginTop: 2, lineHeight: 1.3 }}>
              {isIos()
                ? "Available via Safari's share menu"
                : prompt
                ? "One-tap install available"
                : "Install for faster access and offline use"}
            </div>
          </div>
          <div
            className="pwa-install-actions"
            style={{ display: "flex", gap: 6, flexShrink: 0 }}
          >
            <button
              onClick={install}
              disabled={installing}
              style={{
                background: installing
                  ? `${cyan}26`
                  : `linear-gradient(135deg,${cyan},#0891b2)`,
                border: "none", borderRadius: 8, padding: "7px 12px",
                color: "#fff", fontFamily: theme.font.mono, fontSize: 11, fontWeight: 700,
                cursor: installing ? "not-allowed" : "pointer",
                animation: shouldPulse ? "pwaPulse 2.5s ease infinite" : "none",
                whiteSpace: "nowrap",
                transition: "filter 0.15s ease",
              }}
              onMouseEnter={(e) => { if (!installing) e.currentTarget.style.filter = "brightness(1.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = "brightness(1)"; }}
            >
              {getButtonText()}
            </button>
            <button
              onClick={dismiss}
              title="Close"
              aria-label="Dismiss"
              style={{
                background: "transparent",
                border: `1px solid ${theme.border.default}`,
                borderRadius: 8, padding: "7px 9px",
                color: textMut, fontFamily: theme.font.mono,
                fontSize: 12, cursor: "pointer", lineHeight: 1,
                flexShrink: 0,
                transition: "background 0.15s ease, color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${cyan}1a`;
                e.currentTarget.style.color = textPri;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = textMut;
              }}
            >✕</button>
          </div>
        </div>

        {showIosSteps && (
          <div style={{
            marginTop: 10,
            background: isDark ? "rgba(6,182,212,0.06)" : "rgba(6,182,212,0.05)",
            border: `1px solid ${cyan}33`,
            borderRadius: 10, padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {getInstructions().map(s => (
              <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{
                  width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                  background: isDark ? "rgba(6,182,212,0.2)" : "rgba(6,182,212,0.15)",
                  border: `1px solid ${cyan}66`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, color: cyan, fontFamily: theme.font.mono,
                }}>{s.n}</span>
                <span style={{ fontSize: 11, color: theme.text.secondary, fontFamily: theme.font.mono, lineHeight: 1.45 }}>
                  {s.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {showBar && !showIosSteps && !installing && (
          <CountdownBar
            duration={INSTALL_AUTO_DISMISS_MS}
            color={cyan}
            trackColor={`${cyan}1F`}
          />
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
  const COUNTDOWN_SECONDS = 15;
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
      <div
        className="pwa-shell"
        style={{ ...cardStyle(theme, `${gold}59`, 99997), bottom: 80, padding: "14px 14px" }}
      >
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
            aria-label="Dismiss"
            style={{
              background: "transparent",
              border: `1px solid ${theme.border.default}`,
              borderRadius: 9, padding: "9px 11px",
              color: textMut, fontFamily: theme.font.mono,
              fontSize: 14, cursor: "pointer", lineHeight: 1, flexShrink: 0,
              transition: "background 0.15s ease, color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${gold}1a`;
              e.currentTarget.style.color = theme.text.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = textMut;
            }}
          >✕</button>
        </div>

        <CountdownBar
          duration={COUNTDOWN_SECONDS * 1000}
          color={gold}
          trackColor={`${gold}1F`}
        />
      </div>
    </>
  );
}