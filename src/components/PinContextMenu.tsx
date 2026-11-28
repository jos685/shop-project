import { useEffect } from "react";
import { createPortal } from "react-dom";

export function PinContextMenu({
  open, x, y, isPinned, productName, theme, isMobile,
  onPin, onUnpin, onClose, pinBusy, pinCapReached,
}: {
  open: boolean; x: number; y: number; isPinned: boolean;
  productName: string; theme: any; isMobile: boolean;
  onPin: () => void; onUnpin: () => void; onClose: () => void;
  pinBusy: boolean; pinCapReached: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClick = () => onClose();
    window.addEventListener("keydown", onKey);
    // Defer so the opening tap doesn't immediately close it
    const t = setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  const label = isPinned ? "📌 Unpin" : "⭐ Pin to top";
  const disabled = !isPinned && pinCapReached;

  return createPortal(
    <>
      {isMobile && (
        <div onClick={onClose} style={{
          position: "fixed", inset: 0, zIndex: 9000,
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
        }} />
      )}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "fixed",
          zIndex: 9001,
          ...(isMobile
            ? {
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "min(340px, calc(100vw - 32px))",
              }
            : {
                top: Math.min(y, window.innerHeight - 120),
                left: Math.min(x, window.innerWidth - 220),
              }),
          background: theme.bg.card,
          border: `1px solid ${theme.border.default}`,
          borderRadius: 14,
          padding: 8,
          boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          minWidth: isMobile ? undefined : 200,
        }}
      >
        {isMobile && (
          <div style={{
            fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted,
            padding: "6px 10px 8px", textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {productName}
          </div>
        )}
        <button
          onClick={disabled ? undefined : (isPinned ? onUnpin : onPin)}
          disabled={disabled || pinBusy}
          style={{
            width: "100%", padding: "12px 14px",
            background: disabled ? "rgba(255,255,255,0.03)"
                      : isPinned ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.1)",
            border: "none", borderRadius: 10,
            color: disabled ? theme.text.muted
                  : isPinned ? "#f87171" : "#fbbf24",
            fontFamily: theme.font.mono, fontSize: 13, fontWeight: 700,
            cursor: disabled ? "not-allowed" : "pointer",
            textAlign: "left", opacity: pinBusy ? 0.5 : 1,
          }}
        >
          {disabled ? "Pin limit reached (8/8)" : label}
        </button>
        {isMobile && (
          <button onClick={onClose} style={{
            width: "100%", padding: "10px 14px", marginTop: 4,
            background: "transparent", border: "none",
            color: theme.text.muted, fontFamily: theme.font.mono,
            fontSize: 12, cursor: "pointer",
          }}>
            Cancel
          </button>
        )}
      </div>
    </>,
    document.body
  );
}