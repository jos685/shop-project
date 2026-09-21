// components/FloatingCart.tsx
import { useCallback, useEffect, useRef, useState } from "react";

interface FloatingCartProps {
  count: number;
  visible: boolean;
  onTap: () => void;
  storageKey: string;      // e.g. `pos_cart_pos_${shop.id}`
  isMobile: boolean;
  accentColor?: string;    // theme.accent.cyan
}

const SIZE = 56;
const DRAG_THRESHOLD = 6;
const EDGE_PAD = 16;

export default function FloatingCart({
  count,
  visible,
  onTap,
  storageKey,
  isMobile,
  accentColor = "#06b6d4",
}: FloatingCartProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  });

  // ── init position ──
  useEffect(() => {
    const defaultPos = () => ({
      x: Math.max(EDGE_PAD, window.innerWidth - SIZE - 24),
      y: Math.max(EDGE_PAD, window.innerHeight - SIZE - 90),
    });
    let initial = defaultPos();
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          initial = parsed;
        }
      }
    } catch {}
    initial.x = Math.max(EDGE_PAD, Math.min(initial.x, window.innerWidth - SIZE - EDGE_PAD));
    initial.y = Math.max(EDGE_PAD, Math.min(initial.y, window.innerHeight - SIZE - EDGE_PAD));
    setPos(initial);
  }, [storageKey]);

  // ── keep in bounds on resize; re-snap mobile ──
  useEffect(() => {
    const onResize = () => {
      setPos(p => {
        if (!p) return p;
        const maxX = window.innerWidth - SIZE - EDGE_PAD;
        const maxY = window.innerHeight - SIZE - EDGE_PAD;
        let x = Math.max(EDGE_PAD, Math.min(p.x, maxX));
        const y = Math.max(EDGE_PAD, Math.min(p.y, maxY));
        if (isMobile) {
          x = x + SIZE / 2 < window.innerWidth / 2
            ? EDGE_PAD
            : window.innerWidth - SIZE - EDGE_PAD;
        }
        return { x, y };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMobile]);

  const persist = useCallback((p: { x: number; y: number }) => {
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch {}
  }, [storageKey]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    const x = Math.max(EDGE_PAD, Math.min(e.clientX - d.offsetX, window.innerWidth - SIZE - EDGE_PAD));
    const y = Math.max(EDGE_PAD, Math.min(e.clientY - d.offsetY, window.innerHeight - SIZE - EDGE_PAD));
    setPos({ x, y });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    d.active = false;
    setDragging(false);

    // Tap
    if (!d.moved) {
      onTap();
      return;
    }

    // Drag release — snap mobile to nearest side
    setPos(p => {
      if (!p) return p;
      const finalX = isMobile
        ? p.x + SIZE / 2 < window.innerWidth / 2
          ? EDGE_PAD
          : window.innerWidth - SIZE - EDGE_PAD
        : p.x;
      const final = { x: finalX, y: p.y };
      persist(final);
      return final;
    });
  };

  if (!visible || !pos) return null;

  const hasItems = count > 0;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: SIZE,
        height: SIZE,
        borderRadius: "50%",
        zIndex: 200,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: dragging ? "grabbing" : "grab",
        transition: dragging ? "none" : "left 0.25s cubic-bezier(.34,1.56,.64,1), top 0.25s cubic-bezier(.34,1.56,.64,1)",
        background: hasItems
          ? `linear-gradient(135deg, ${accentColor}, #0891b2)`
          : "rgba(20,20,20,0.55)",
        border: hasItems
          ? `1px solid ${accentColor}cc`
          : "1px solid rgba(255,255,255,0.15)",
        boxShadow: hasItems
          ? `0 8px 24px ${accentColor}66, 0 2px 8px rgba(0,0,0,0.3)`
          : "0 4px 14px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        opacity: hasItems ? 1 : 0.55,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      title="Drag to move · Tap to checkout"
    >
      🛒
      {hasItems && (
        <div
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            background: "#f87171",
            border: "2px solid #0a0a0a",
            color: "#fff",
            fontSize: 11,
            fontFamily: "'DM Mono', monospace",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 5px",
            pointerEvents: "none",
          }}
        >
          {count}
        </div>
      )}
    </div>
  );
}