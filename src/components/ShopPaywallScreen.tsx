// components/ShopPaywallScreen.tsx
// Shown when a shop is locked because the owner's subscription/trial ended.
// This is not a checkout — the shop cannot pay for the owner's plan. It tells
// the shop what happened and who to contact.
import { useState, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { useShopAuth } from "../context/ShopAuthContext";

const SUPPORT_WA_NUMBER = "254783069010";
const SUPPORT_PHONE_1   = "0768131905";
const SUPPORT_PHONE_2   = "0791408944";
const SUPPORT_EMAIL     = "epicsoftwaredesigners@gmail.com";

export interface ShopLockInfo {
  locked: boolean;
  reason: string;
  shop_name: string | null;
  shop_code: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  business_name: string | null;
  plan: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  expired_at: string | null;
}

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-KE", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch { return "—"; }
}

// Normalise a phone to international digits for wa.me / tel:
function toIntl(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0"))   return "254" + digits.slice(1);
  if (digits.startsWith("7") || digits.startsWith("1")) return "254" + digits;
  return digits;
}

// Copy per reason. Keeps the emotional tone consistent and clearly
// separates "your fault" from "owner's fault" from "we shut you down".
function getCopy(reason: string): {
  emoji: string;
  title: string;
  body: string;
  accent: string;
  audience: "owner" | "support" | "none";
} {
  switch (reason) {
    case "trial_expired":
      return {
        emoji: "⏳", accent: "#f59e0b",
        title: "Free Trial Ended",
        body: "The free trial for this business has ended. Your owner needs to activate a plan to keep this shop selling.",
        audience: "owner",
      };
    case "subscription_expired":
      return {
        emoji: "🔒", accent: "#f87171",
        title: "Subscription Ended",
        body: "The subscription for this business has ended. Your owner needs to renew to keep this shop selling.",
        audience: "owner",
      };
    case "no_subscription":
      return {
        emoji: "💳", accent: "#f59e0b",
        title: "No Active Plan",
        body: "This business doesn't have an active plan yet. Ask your owner to set one up.",
        audience: "owner",
      };
    case "plan_suspended":
    case "shop_suspended":
      return {
        emoji: "🚫", accent: "#f87171",
        title: "Shop Suspended",
        body: "This shop has been temporarily suspended. Please reach out to your owner or our support team.",
        audience: "support",
      };
    case "owner_locked":
    case "owner_inactive":
    case "owner_deleted":
      return {
        emoji: "👤", accent: "#a78bfa",
        title: "Owner Account Unavailable",
        body: "The owner's account is currently unavailable. Please contact our support team for help.",
        audience: "support",
      };
    case "shop_inactive":
    case "shop_deleted":
      return {
        emoji: "🏚", accent: "#a78bfa",
        title: "Shop Deactivated",
        body: "This shop has been deactivated. Please contact our support team for help.",
        audience: "support",
      };
    default:
      return {
        emoji: "🔒", accent: "#f87171",
        title: "Shop Temporarily Unavailable",
        body: "This shop cannot be used right now. Please contact our support team.",
        audience: "support",
      };
  }
}

export default function ShopPaywallScreen({
  info, onRetry, retrying, onSignOut,
}: {
  info: ShopLockInfo;
  onRetry: () => void;
  retrying: boolean;
  onSignOut?: () => void;
}) {
  const { theme, isDark } = useTheme();
  const { shop } = useShopAuth();
  const width    = useWindowWidth();
  const isMobile = width < 480;
  const copy     = getCopy(info.reason);

  const ownerIntl   = toIntl(info.owner_phone);
  const businessName = info.business_name || shop?.name || info.shop_name || "this shop";

  const cardStyle: React.CSSProperties = {
    background: theme.bg.card,
    border: `1px solid ${theme.border.default}`,
    borderRadius: isMobile ? 18 : 22,
    width: "100%",
    maxWidth: 460,
    maxHeight: "calc(100svh - 24px)",
    overflowY: "auto",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
    animation: "fadeUp 0.3s ease",
    color: theme.text.primary,
    fontFamily: theme.font.body,
  };

  return (
    <div style={cardStyle}>
      <style>{ANIM_CSS}</style>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg,${isDark ? "#450a0a" : "#7f1d1d"},${isDark ? "#7f1d1d" : "#991b1b"})`,
        padding: isMobile ? "26px 20px 22px" : "30px 28px 26px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.06, background: "radial-gradient(circle at 50% 0%, #fff 0%, transparent 60%)" }} />
        <div style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 64, height: 64, borderRadius: 20,
          background: `${copy.accent}22`,
          border: `1px solid ${copy.accent}55`,
          fontSize: 30, marginBottom: 12,
          animation: "successPop 0.5s cubic-bezier(.175,.885,.32,1.275)",
        }}>
          {copy.emoji}
        </div>
        <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 20 : 22, color: "#fff", marginBottom: 6 }}>
          {copy.title}
        </div>
        <div style={{ fontFamily: theme.font.mono, fontSize: 11, color: "rgba(255,255,255,0.65)" }}>
          {info.shop_name || shop?.name} · {info.shop_code || shop?.shop_code}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: isMobile ? "20px 18px 22px" : "24px 26px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontFamily: theme.font.body, fontSize: 14, color: theme.text.secondary, lineHeight: 1.7 }}>
          {copy.body}
        </div>

        {/* Expiry detail (only when we know the date) */}
        {info.expired_at && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: 10, padding: "10px 14px",
          }}>
            <span style={{ fontSize: 16 }}>📅</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: theme.font.mono, fontSize: 10, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                {info.status === "trialing" ? "Trial ended" : "Subscription ended"}
              </div>
              <div style={{ fontFamily: theme.font.body, fontWeight: 700, fontSize: 13, color: theme.text.primary, marginTop: 2 }}>
                {fmtDate(info.expired_at)}
              </div>
            </div>
          </div>
        )}

        {/* Contact section */}
        {copy.audience === "owner" && (
          <div>
            <div style={{ fontFamily: theme.font.mono, fontSize: 10, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Contact your owner
            </div>
            {info.owner_name && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "linear-gradient(135deg,rgba(6,182,212,0.25),rgba(6,182,212,0.08))",
                  border: "1px solid rgba(6,182,212,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: theme.font.display, fontWeight: 800, fontSize: 15, color: "#06b6d4", flexShrink: 0,
                }}>
                  {info.owner_name.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: theme.font.body, fontWeight: 700, fontSize: 14, color: theme.text.primary }}>{info.owner_name}</div>
                  <div style={{ fontFamily: theme.font.mono, fontSize: 11, color: theme.text.muted, marginTop: 1 }}>{businessName}</div>
                </div>
              </div>
            )}

            {ownerIntl ? (
              <div style={{ display: "flex", gap: 8 }}>
                <a
                  href={`tel:${ownerIntl}`}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    background: "rgba(6,182,212,0.1)",
                    border: "1px solid rgba(6,182,212,0.3)",
                    borderRadius: 10, padding: "11px 0",
                    color: "#06b6d4", fontFamily: theme.font.body, fontWeight: 700, fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  📞 Call Owner
                </a>
                <a
                  href={`https://wa.me/${ownerIntl}?text=${encodeURIComponent(
                    `Hi${info.owner_name ? " " + info.owner_name : ""}, the shop "${info.shop_name ?? ""}" (${info.shop_code ?? ""}) is showing as locked. Please check the subscription so we can keep selling. Thank you!`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    background: "rgba(37,211,102,0.1)",
                    border: "1px solid rgba(37,211,102,0.3)",
                    borderRadius: 10, padding: "11px 0",
                    color: "#25D366", fontFamily: theme.font.body, fontWeight: 700, fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  💬 WhatsApp
                </a>
              </div>
            ) : (
              <div style={{ fontFamily: theme.font.mono, fontSize: 11, color: theme.text.muted, lineHeight: 1.7 }}>
                Owner phone is not on file. Ask your owner to renew, then tap <b>Check Again</b> below.
              </div>
            )}
          </div>
        )}

        {/* Support block — always visible so a stranded shop has somewhere to go */}
        <div style={{
          background: theme.bg.base,
          border: `1px solid ${theme.border.default}`,
          borderRadius: 12, padding: "12px 14px",
        }}>
          <div style={{ fontFamily: theme.font.mono, fontSize: 10, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Still stuck? Reach support
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <a href={`https://wa.me/${SUPPORT_WA_NUMBER}`} target="_blank" rel="noopener noreferrer"
               style={{ display: "flex", alignItems: "center", gap: 8, color: theme.text.secondary, fontSize: 12, fontFamily: theme.font.mono, textDecoration: "none" }}>
              <span>💬</span> WhatsApp support
            </a>
            <a href={`tel:${SUPPORT_PHONE_1}`}
               style={{ display: "flex", alignItems: "center", gap: 8, color: theme.text.secondary, fontSize: 12, fontFamily: theme.font.mono, textDecoration: "none" }}>
              <span>📞</span> {SUPPORT_PHONE_1}
            </a>
            <a href={`tel:${SUPPORT_PHONE_2}`}
               style={{ display: "flex", alignItems: "center", gap: 8, color: theme.text.secondary, fontSize: 12, fontFamily: theme.font.mono, textDecoration: "none" }}>
              <span>📞</span> {SUPPORT_PHONE_2}
            </a>
            <a href={`mailto:${SUPPORT_EMAIL}`}
               style={{ display: "flex", alignItems: "center", gap: 8, color: theme.text.secondary, fontSize: 12, fontFamily: theme.font.mono, textDecoration: "none" }}>
              <span>✉</span> {SUPPORT_EMAIL}
            </a>
          </div>
        </div>

        {/* Retry */}
        <button
          onClick={onRetry}
          disabled={retrying}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: retrying ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,#06b6d4,#0891b2)",
            border: "none", borderRadius: 12, padding: "13px 0",
            color: retrying ? theme.text.muted : "#fff",
            fontFamily: theme.font.display, fontWeight: 700, fontSize: 14,
            cursor: retrying ? "not-allowed" : "pointer",
            boxShadow: retrying ? "none" : "0 4px 16px rgba(6,182,212,0.3)",
          }}
        >
          {retrying ? (
            <>
              <span style={{
                width: 14, height: 14, display: "inline-block",
                border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff",
                borderRadius: "50%", animation: "spin 0.7s linear infinite",
              }} />
              Checking…
            </>
          ) : (
            <>↺ Check Again</>
          )}
        </button>

        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            style={{
              background: "none",
              border: "none",
              color: theme.text.muted,
              fontFamily: theme.font.mono,
              fontSize: 11,
              textDecoration: "underline",
              cursor: "pointer",
              padding: "4px 0",
              textAlign: "center",
            }}
          >
            Sign out instead
          </button>
        )}

        <div style={{ fontFamily: theme.font.mono, fontSize: 10, color: theme.text.muted, textAlign: "center", lineHeight: 1.6 }}>
          Access unlocks automatically the moment your owner renews.
        </div>
      </div>
    </div>
  );
}

const ANIM_CSS = `
  @keyframes fadeUp     { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin       { to{transform:rotate(360deg)} }
  @keyframes successPop { 0%{transform:scale(0.5);opacity:0} 70%{transform:scale(1.18)} 100%{transform:scale(1);opacity:1} }
`;