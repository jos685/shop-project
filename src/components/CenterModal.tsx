import { useEffect } from "react";
import { createPortal } from "react-dom";

const TOP_NAV_HEIGHT = 58;   // must match TopNav's TOP_NAV_HEIGHT export
const NAV_GAP        = 12;   // breathing room between nav and modal
const SIDE_GAP       = 12;
const BOTTOM_GAP     = 12;

// Returns an object with a single `maxHeight` key whose value is the
// first supported CSS unit the browser recognises. `dvh` is preferred
// (respects mobile URL bars); `vh` is the fallback.
function pickMaxHeight(fallback: string, preferred: string) {
  // Modern browsers support dvh; we can detect it safely at module scope.
  const supportsDvh =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("height", "1dvh");
  return supportsDvh ? preferred : fallback;
}

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

  // Total space reserved above the panel.
  const topOffset = TOP_NAV_HEIGHT + NAV_GAP;

  // Pick the correct viewport unit at runtime — dvh when supported (so
  // mobile URL bars are accounted for), otherwise fall back to vh.
  const panelMaxHeight = pickMaxHeight(
    `calc(100vh - ${topOffset + BOTTOM_GAP}px)`,
    `calc(100dvh - ${topOffset + BOTTOM_GAP}px)`,
  );

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        // ⬇️ NOT inset: 0 — we start below the nav on purpose
        top:    topOffset,
        left:   0,
        right:  0,
        bottom: 0,
        zIndex: 60,

        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",

        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",

        paddingTop:    0,           // no extra top pad — the panel starts here
        paddingBottom: BOTTOM_GAP,
        paddingLeft:   SIDE_GAP,
        paddingRight:  SIDE_GAP,

        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
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
          maxWidth: `min(${maxWidth}px, calc(100vw - ${SIDE_GAP * 2}px))`,

          // ⬇️ panel is capped to the visible area BELOW the nav, so it
          //     can never grow past its own container
          maxHeight: panelMaxHeight,

          display: "flex",
          flexDirection: "column",
          overflow: "hidden",

          // ⬇️ this margin keeps it visually centred when short, and
          //     pinned to the top of the container (i.e. just below the
          //     nav) when tall — never pushing into the nav
          margin: "auto 0",

          animation: "zoomIn 0.2s ease both",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}