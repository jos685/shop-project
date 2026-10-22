import { useCallback, useState, useMemo } from "react";
import type { CartItem } from "../types/pos";
import type { BusinessInfo } from "../lib/useBusinessInfo";
import {
  buildReceiptData,
  receiptToPdf,
  receiptToPrintHtml,
  type ReceiptData,
} from "../lib/receipt";
import ReceiptCard from "./ReceiptCard";
import WhatsAppSendModal from "./WhatsAppSendModal";
import { toPng } from "html-to-image";

export default function ReceiptSuccessScreen({
  cart,
  grandTotal,
  payMethod,
  selectedAgentName,
  customerName,
  customerPhone,
  mpesaRef,
  initialPayment,
  savedBatchRef,
  saleTimestamp,
  wasQueued,
  isBackdated,
  backdatedISO,
  receiptStatus,
  biz,
  theme,
  isMobile,
  onReset,
}: {
  cart: CartItem[];
  grandTotal: number;
  payMethod: string | null;
  selectedAgentName: string;
  customerName: string;
  customerPhone: string;
  mpesaRef: string;
  initialPayment: number;
  savedBatchRef: string;
  saleTimestamp: string;
  wasQueued: boolean;
  isBackdated: boolean;
  backdatedISO: string | null;
  receiptStatus: "idle" | "sending" | "sent" | "failed";
  biz: BusinessInfo;
  theme: any;
  isMobile: boolean;
  onReset: () => void;
}) {
  const isCredit = payMethod === "credit";
  const ref = wasQueued
    ? "PENDING"
    : `${isCredit ? "CR" : "TXN"}-${savedBatchRef || "--------"}`;

  const receiptTimestamp = backdatedISO
    ? new Date(backdatedISO).toLocaleString("en-KE", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : saleTimestamp;

  const data: ReceiptData = useMemo(
    () =>
      buildReceiptData({
        ref,
        timestamp: receiptTimestamp,
        sellerName: selectedAgentName || "—",
        customerName,
        customerPhone,
        cart,
        total: grandTotal,
        payMethod,
        mpesaRef,
        initialPayment,
        isQueued: wasQueued,
        isBackdated,
      }),
    [
      ref, receiptTimestamp, selectedAgentName, customerName, customerPhone, cart, grandTotal, payMethod, mpesaRef, initialPayment, wasQueued, isBackdated,
    ]
  );

  const [waOpen, setWaOpen] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "print" | "share" | null>(null);
  const [actionError, setError] = useState("");

  // ── Helper to generate the perfect PNG image (for the Share button) ──
  const generateImage = useCallback(async (): Promise<string> => {
    let logoData: string | null = null;
    const url = biz.logoUrl;
    if (url && !/\.svg(\?|$)/i.test(url)) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          logoData = await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(String(r.result));
            r.readAsDataURL(blob);
          });
        }
      } catch {}
    }

    const html = receiptToPrintHtml(data, biz, logoData);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.width = "400px";
    iframe.style.height = "1200px";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) throw new Error("Could not create iframe");
    doc.open();
    doc.write(html);
    doc.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    const dataUrl = await toPng(doc.body, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      width: 400,
      height: doc.body.scrollHeight,
    });

    document.body.removeChild(iframe);
    return dataUrl;
  }, [data, biz]);

  // ── Download PDF ──────────────────────────────────────────────────
  const handlePdf = useCallback(async () => {
    setBusy("pdf");
    setError("");
    try {
      await receiptToPdf(data, biz, { save: true });
    } catch (e: any) {
      setError(e?.message || "Could not generate PDF.");
    } finally {
      setBusy(null);
    }
  }, [data, biz]);

  // ── Print (80mm iframe) ───────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    setBusy("print");
    setError("");
    try {
      let logoData: string | null = null;
      const url = biz.logoUrl;
      const isSvg = url ? /\.svg(\?|$)/i.test(url) : false;
      if (url && !isSvg) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2500);
          const res = await fetch(url, { signal: ctrl.signal });
          clearTimeout(t);
          if (res.ok) {
            const blob = await res.blob();
            logoData = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onloadend = () => resolve(String(r.result));
              r.onerror = reject;
              r.readAsDataURL(blob);
            });
          }
        } catch {
          logoData = null;
        }
      }

      const html = receiptToPrintHtml(data, biz, logoData);
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      const cleanup = () => {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 500);
      };

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) throw new Error("Print frame unavailable.");
      doc.open();
      doc.write(html);
      doc.close();

      const fire = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {}
        cleanup();
      };
      setTimeout(fire, 350);
    } catch (e: any) {
      setError(e?.message || "Print failed.");
    } finally {
      setBusy(null);
    }
  }, [data, biz]);

  // ── Share (Generates PNG on click → Native share sheet) ───────────
  const handleShare = useCallback(async () => {
    setBusy("share");
    try {
      const dataUrl = await generateImage();
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `receipt-${ref}.png`, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Receipt ${ref}` });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `receipt-${ref}.png`;
        a.click();
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  }, [generateImage, ref]);

  return (
    <div
      className="section"
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: isMobile ? 12 : 32,
        paddingTop: 2,
        width: "100%",
        maxWidth: 1000,
        margin: "0 auto",
        boxSizing: "border-box",
        paddingBottom: 40,
      }}
    >
      {/* ══════════════════ LEFT COLUMN: RECEIPT ══════════════════ */}
      <div
        style={{
          flex: isMobile ? "unset" : 1,
          width: "100%",
          maxWidth: isMobile ? "100%" : 500,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        {(wasQueued || isCredit) && (
          <div
            data-capture-skip="true"
            style={{
              width: "100%",
              maxWidth: 420,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "8px 12px",
              background: wasQueued ? "rgba(251,191,36,0.10)" : "rgba(248,113,113,0.08)",
              border: `1px solid ${wasQueued ? "rgba(251,191,36,0.35)" : "rgba(248,113,113,0.30)"}`,
              borderRadius: 10,
              color: wasQueued ? "#fbbf24" : "#f87171",
              fontFamily: theme.font.mono,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.02em",
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {wasQueued ? (
              <>⏳ Queued — will sync when online</>
            ) : (
              (() => {
                const paid = Math.min(Math.max(0, initialPayment), grandTotal);
                return paid > 0 ? (
                  <>📝 Credit · {fmt(paid)} paid · {fmt(grandTotal - paid)} due</>
                ) : (
                  <>📝 Credit sale · {fmt(grandTotal)} balance due</>
                );
              })()
            )}
          </div>
        )}

        {/* Original UI Component */}
        <ReceiptCard data={data} biz={biz} theme={theme} isMobile={isMobile} />
      </div>

      {/* ══════════════════ RIGHT COLUMN: ACTIONS ══════════════════ */}
      <div
        data-capture-skip="true"
        style={{
          width: isMobile ? "100%" : 340,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          position: isMobile ? "static" : "sticky",
          top: 24,
          marginTop: isMobile ? 0 : 80,
        }}
      >
        {actionError && (
          <div
            style={{
              width: "100%",
              fontSize: 11,
              fontFamily: theme.font.mono,
              color: "#f87171",
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: 10,
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            ⚠ {actionError}
          </div>
        )}

        <div
          style={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <ActionButton
            theme={theme}
            icon="📄"
            label="Download PDF"
            shortLabel="PDF"
            isMobile={isMobile}
            loading={busy === "pdf"}
            onClick={handlePdf}
            disabled={busy !== null}
            accent="#06b6d4"
          />
          <ActionButton
            theme={theme}
            icon="🖨️"
            label="Print"
            shortLabel="Print"
            isMobile={isMobile}
            loading={busy === "print"}
            onClick={handlePrint}
            disabled={busy !== null}
            accent="#a78bfa"
          />
          <ActionButton
            theme={theme}
            icon="📱"
            label="WhatsApp"
            shortLabel="WhatsApp"
            isMobile={isMobile}
            onClick={() => setWaOpen(true)}
            disabled={busy !== null}
            accent="#25D366"
          />
          <ActionButton
            theme={theme}
            icon={busy === "share" ? "⏳" : "🔗"}
            label={busy === "share" ? "Preparing..." : "Share"}
            shortLabel={busy === "share" ? "..." : "Share"}
            isMobile={isMobile}
            loading={busy === "share"}
            onClick={handleShare}
            disabled={busy !== null}
            accent="#fbbf24"
          />
        </div>

        <button
          onClick={onReset}
          style={{
            width: "100%",
            padding: "15px 16px",
            background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`,
            border: "none",
            borderRadius: 14,
            color: "#fff",
            fontFamily: theme.font.display,
            fontWeight: 800,
            fontSize: 15,
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          + New Sale
        </button>

        {receiptStatus !== "idle" && (
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: -4,
              fontSize: 11,
              fontFamily: theme.font.mono,
              color:
                receiptStatus === "sent"
                  ? "#34d399"
                  : receiptStatus === "failed"
                  ? "#f87171"
                  : theme.text.muted,
            }}
          >
            {receiptStatus === "sending" && (
              <span
                style={{
                  width: 10,
                  height: 10,
                  border: `1.5px solid rgba(255,255,255,0.2)`,
                  borderTopColor: theme.text.muted,
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }}
              />
            )}
            {receiptStatus === "sent" && "✓ Receipt sent"}
            {receiptStatus === "failed" && "⚠ Receipt could not be delivered"}
            {receiptStatus === "sending" && "Sending receipt…"}
          </div>
        )}
      </div>

      <WhatsAppSendModal
        open={waOpen}
        onClose={() => setWaOpen(false)}
        data={data}
        biz={biz}
        theme={theme}
        isMobile={isMobile}
      />
    </div>
  );
}

function fmt(n: number) {
  return `KSh ${Math.round(n).toLocaleString("en-KE")}`;
}

function ActionButton({
  theme,
  icon,
  label,
  shortLabel,
  isMobile,
  loading,
  onClick,
  disabled,
  accent,
}: {
  theme: any;
  icon: string;
  label: string;
  shortLabel: string;
  isMobile: boolean;
  loading?: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent: string;
}) {
  const showShort = isMobile;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 60,
        padding: "12px 8px",
        border: `1px solid ${accent}44`,
        background: `${accent}14`,
        borderRadius: 12,
        color: accent,
        fontFamily: theme.font.mono,
        fontSize: 11,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        opacity: disabled && !loading ? 0.55 : 1,
        transition: "transform 0.08s, background 0.15s",
        WebkitTapHighlightColor: "transparent",
        overflow: "hidden",
      }}
      onTouchStart={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.97)";
      }}
      onTouchEnd={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>
        {loading ? (
          <span
            style={{
              display: "inline-block",
              width: 16,
              height: 16,
              border: `2px solid ${accent}55`,
              borderTopColor: accent,
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}
          />
        ) : (
          icon
        )}
      </span>
      <span
        style={{
          fontSize: 10.5,
          textAlign: "center",
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {showShort ? shortLabel : label}
      </span>
    </button>
  );
}