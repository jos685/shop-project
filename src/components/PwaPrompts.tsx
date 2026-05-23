import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// Shop POS — registerType: 'autoUpdate'; needRefresh fires after new SW activates
export function PwaUpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (!r) return;

      // Poll every 10 minutes
      const poll = setInterval(() => r.update(), 10 * 60 * 1000);

      // Check immediately when shopkeeper returns to the screen
      const onVisible = () => { if (document.visibilityState === "visible") r.update(); };
      document.addEventListener("visibilitychange", onVisible);

      return () => { clearInterval(poll); document.removeEventListener("visibilitychange", onVisible); };
    },
  });

  const [reloading, setReloading] = useState(false);

  const handleReload = () => {
    setReloading(true);
    updateServiceWorker(true);
  };

  if (!needRefresh) return null;

  return (
    <>
      <style>{`
        @keyframes pwaIn { from{opacity:0;transform:translateX(-50%) translateY(14px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes pwaPulse { 0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0.6)} 60%{box-shadow:0 0 0 8px rgba(249,115,22,0)} }
        @keyframes pwaSpin { to{transform:rotate(360deg)} }
      `}</style>
      <div style={{
        position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
        zIndex: 99999, display: "flex", alignItems: "center", gap: 12,
        background: "linear-gradient(135deg,#1a0a00,#1f1008)",
        border: "1px solid rgba(249,115,22,0.55)",
        borderRadius: 16, padding: "14px 16px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(249,115,22,0.1)",
        animation: "pwaIn 0.35s cubic-bezier(0.16,1,0.3,1) both",
        whiteSpace: "nowrap",
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
        }}>
          {reloading
            ? <span style={{ display: "inline-block", animation: "pwaSpin 0.8s linear infinite" }}>🔄</span>
            : "⬆️"}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f97316", fontFamily: "monospace", marginBottom: 1 }}>
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
            background: reloading ? "rgba(249,115,22,0.15)" : "linear-gradient(135deg,#c2410c,#f97316)",
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

export function PwaInstallBanner() {
  const [prompt, setPrompt] = useState<Event & { prompt: () => Promise<void> } | null>(null);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem("pwa_install_dismissed"));

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPrompt(e as Event & { prompt: () => Promise<void> }); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!prompt || dismissed) return null;

  const install = async () => { await prompt.prompt(); setPrompt(null); };
  const dismiss = () => { localStorage.setItem("pwa_install_dismissed", "1"); setDismissed(true); };

  return (
    <div style={{
      position: "fixed", bottom: 24, left: 16, right: 16,
      zIndex: 99998, display: "flex", alignItems: "center", gap: 12,
      background: "#1a0a00", border: "1px solid rgba(249,115,22,0.3)",
      borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      animation: "pwaIn 0.35s ease both", maxWidth: 520, margin: "0 auto",
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#7c2d12,#c2410c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
        🏪
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fef3e2", fontFamily: "monospace" }}>Add QASHUP POS to Home Screen</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", marginTop: 2, lineHeight: 1.4 }}>Install for faster access and offline sales</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button onClick={install}
          style={{ background: "linear-gradient(135deg,#c2410c,#f97316)", border: "none", borderRadius: 8, padding: "8px 14px", color: "#fff", fontFamily: "monospace", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Install
        </button>
        <button onClick={dismiss}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "rgba(255,255,255,0.4)", fontFamily: "monospace", fontSize: 12, cursor: "pointer" }}>
          ✕
        </button>
      </div>
    </div>
  );
}
