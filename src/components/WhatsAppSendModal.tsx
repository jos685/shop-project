import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReceiptData } from "../lib/receipt";
import { receiptToText } from "../lib/receipt";
import type { BusinessInfo } from "../lib/useBusinessInfo";
import ReceiptCard from "./ReceiptCard";

export default function WhatsAppSendModal({
  open,
  onClose,
  data,
  biz,
  theme,
  isMobile,
}: {
  open: boolean;
  onClose: () => void;
  data: ReceiptData;
  biz: BusinessInfo;
  theme: any;
  isMobile: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [vw, setVw] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 400
  );

  useEffect(() => {
    if (!open) return;
    setPhone("");
    setError("");
    const onResize = () => setVw(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const isTiny = vw < 380;

  const cleanPhone = (raw: string): string | null => {
    let d = raw.replace(/\D/g, "");
    if (!d) return null;
    if (d.startsWith("0"))        d = "254" + d.slice(1);
    else if (d.startsWith("254")) { /* ok */ }
    else if (d.length === 9)      d = "254" + d;
    else if (!d.startsWith("254")) return null;
    if (d.length < 11 || d.length > 15) return null;
    return d;
  };

  const handleSend = () => {
    const clean = cleanPhone(phone);
    if (!clean) {
      setError("Enter a valid Kenyan phone number (e.g. 0712345678).");
      return;
    }
    const text = receiptToText(data, biz);
    const url = `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
    onClose();
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        // Vertically centered at every breakpoint — the modal appears in the
        // middle of the viewport, not stuck to the bottom on phones.
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "waFadeIn 0.15s ease both",
        overflow: "hidden",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: theme.bg.card,
          border: `1px solid ${theme.border.default}`,
          borderRadius: 18,
          width: "min(460px, 100%)",
          maxWidth: "100%",
          maxHeight: "min(88dvh, 88vh)",
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "waZoomIn 0.2s ease both",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            background: theme.bg.card,
            borderBottom: `1px solid ${theme.border.default}`,
            padding: isTiny ? "14px 14px 10px" : "16px 18px 12px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            zIndex: 2,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: theme.font.display,
                fontWeight: 800,
                fontSize: isTiny ? 15 : 16,
                color: theme.text.primary,
                lineHeight: 1.25,
              }}
            >
              📱 Send via WhatsApp
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: theme.font.mono,
                color: theme.text.muted,
                marginTop: 2,
              }}
            >
              Enter the customer's number
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              border: `1px solid ${theme.border.default}`,
              background: "transparent",
              color: theme.text.muted,
              cursor: "pointer",
              fontSize: 15,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 16,
            paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 16px)`,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Phone input */}
          <div>
            <label
              style={{
                fontSize: 10,
                fontFamily: theme.font.mono,
                color: theme.text.muted,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                display: "block",
                marginBottom: 6,
              }}
            >
              Phone Number
            </label>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={e => {
                setPhone(e.target.value.replace(/[^0-9+\s-]/g, "").slice(0, 16));
                setError("");
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSend();
                }
              }}
              autoFocus
              placeholder="0712 345 678"
              style={{
                background: theme.bg.input,
                border: `1.5px solid ${error ? "rgba(248,113,113,0.55)" : "rgba(6,182,212,0.45)"}`,
                borderRadius: 12,
                padding: "12px 14px",
                color: theme.text.primary,
                fontFamily: theme.font.mono,
                fontSize: 15,
                fontWeight: 600,
                width: "100%",
                boxSizing: "border-box",
                outline: "none",
                letterSpacing: "0.02em",
              }}
            />
            {error && (
              <div
                style={{
                  fontSize: 11,
                  fontFamily: theme.font.mono,
                  color: "#f87171",
                  marginTop: 6,
                }}
              >
                ⚠ {error}
              </div>
            )}
          </div>

          {/* Receipt preview */}
          <div
            style={{
              fontSize: 10,
              fontFamily: theme.font.mono,
              color: theme.text.muted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Message preview
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: `1px solid ${theme.border.default}`,
              borderRadius: 14,
              padding: 10,
              maxHeight: isMobile ? "38vh" : 320,
              overflowY: "auto",
              overflowX: "hidden",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <ReceiptCard data={data} biz={biz} theme={theme} isMobile={isMobile} compact />
          </div>

          {/* Actions */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexDirection: isTiny ? "column-reverse" : "row",
            }}
          >
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: "13px 14px",
                border: `1px solid ${theme.border.default}`,
                background: "transparent",
                borderRadius: 12,
                color: theme.text.secondary,
                fontFamily: theme.font.mono,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              style={{
                flex: 2,
                padding: "13px 14px",
                background: "linear-gradient(135deg,#25D366,#128C7E)",
                border: "none",
                borderRadius: 12,
                color: "#fff",
                fontFamily: theme.font.display,
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              📱 Open WhatsApp
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes waFadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes waZoomIn  { from { opacity: 0; transform: scale(0.94) } to { opacity: 1; transform: scale(1) } }
      `}</style>
    </div>,
    document.body
  );
}