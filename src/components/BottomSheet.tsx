import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function BottomSheet({
  open, onClose, theme, children, maxHeight = "85vh", bottomOffset = 0,
}: {
  open: boolean;
  onClose: () => void;
  theme: any;
  children: React.ReactNode;
  maxHeight?: string;
  bottomOffset?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 60,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          animation: "fadeIn 0.15s ease both",
        }}
      />
      <div
        style={{
          position: "fixed", left: 0, right: 0,
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${bottomOffset}px)`,
          zIndex: 61,
          background: theme.bg.card,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          borderTop: `1px solid ${theme.border.default}`,
          boxShadow: "0 -12px 40px rgba(0,0,0,0.55)",
          maxHeight,
          display: "flex", flexDirection: "column",
          animation: "slideUp 0.22s ease both",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }} />
        </div>
        {children}
      </div>
    </>,
    document.body
  );
}