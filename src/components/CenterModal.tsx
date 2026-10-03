import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function CenterModal({
  open, onClose, theme, children, maxWidth = 480,
}: {
  open: boolean;
  onClose: () => void;
  theme: any;
  children: React.ReactNode;
  maxWidth?: number;
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
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        animation: "fadeIn 0.15s ease both",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: theme.bg.card,
          border: `1px solid ${theme.border.default}`,
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          width: "100%",
          maxWidth: `min(${maxWidth}px, calc(100vw - 24px))`,
          maxHeight: "calc(100vh - 24px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "zoomIn 0.2s ease both",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}