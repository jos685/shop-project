import { useState, useEffect, useMemo, useRef } from "react";
import type { CustomItem } from "../types/pos";

interface Props {
  open: boolean;
  onClose: () => void;
  customItems: CustomItem[];
  theme: any;
  isMobile: boolean;
  onSaveCustomItem: (name: string, unit: string, price: number) => Promise<CustomItem | null>;
  onAdd: (item: {
    customItemId: string | null;
    name: string;
    unit: string;
    quantity: number;
    sellPrice: number;
  }) => void;
  initialItem?: {
    customItemId: string | null;
    name: string;
    unit: string;
    quantity: number;
    sellPrice: number;
  } | null;
}

const UNITS = ["pc", "kg", "g", "L", "ml", "plate", "cup", "service", "pack", "box"];

export default function UnlistedItemModal({
  open, onClose, customItems, theme, isMobile, onSaveCustomItem, onAdd,
  initialItem = null,
}: Props) {
  const [name, setName]           = useState("");
  const [unit, setUnit]           = useState("pc");
  const [qty, setQty]             = useState("");
  const [price, setPrice]         = useState("");
  const [showSug, setShowSug]     = useState(false);
  const [error, setError]         = useState("");
  const [saving, setSaving]       = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    if (initialItem) {
      setName(initialItem.name);
      setUnit(initialItem.unit || "pc");
      setQty(String(initialItem.quantity));
      setPrice(String(initialItem.sellPrice));
    } else {
      setName(""); setUnit("pc"); setQty(""); setPrice("");
    }

    setShowSug(false); setError(""); setSaving(false);
    setTimeout(() => nameRef.current?.focus(), 100);
  }, [open, initialItem]);

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    const list = q
      ? customItems.filter(c => c.name.toLowerCase().includes(q))
      : customItems;
    return list.slice(0, 6);
  }, [name, customItems]);

  const exactMatch = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return null;
    return customItems.find(c => c.name.toLowerCase() === q) ?? null;
  }, [name, customItems]);

  const pick = (c: CustomItem) => {
    setName(c.name);
    setUnit(c.unit || "pc");
    setPrice(String(c.default_price || ""));
    setShowSug(false);
  };

  const submit = async () => {
    setError("");
    const trimmed = name.trim();
    if (trimmed.length < 2) return setError("Enter a product name (at least 2 characters).");
    const quantity = parseInt(qty, 10) || 0;
    if (quantity < 1) return setError("Enter a quantity of at least 1.");
    const sellPrice = Number(price) || 0;
    if (sellPrice <= 0) return setError("Enter a sell price greater than 0.");

    // When editing an existing unlisted row, just emit the update — don't
    // try to create another shop_custom_items entry.
    if (initialItem) {
      onAdd({
        customItemId: initialItem.customItemId,
        name: trimmed,
        unit,
        quantity,
        sellPrice,
      });
      return;
    }

    let customItemId = exactMatch?.id ?? null;

    // If the name doesn't exactly match a saved item, save it for next time
    if (!customItemId) {
      setSaving(true);
      const created = await onSaveCustomItem(trimmed, unit, sellPrice);
      setSaving(false);
      customItemId = created?.id ?? null;
    }

    onAdd({ customItemId, name: trimmed, unit, quantity, sellPrice });
  };

  if (!open) return null;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: theme.bg.overlay, backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: isMobile ? "0 12px" : "0 16px",
      }}
    >
      <div className="overlay-sheet" style={{
        background: theme.bg.card, border: `1px solid ${theme.border.default}`,
        borderRadius: 20, padding: "24px 20px 24px",
        width: "100%", maxWidth: 480,
        display: "flex", flexDirection: "column", gap: 16,
        maxHeight: "92vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18 }}>
            {initialItem ? "Edit unlisted item" : "Sell item not in stock"}
            </div>
            <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
            {initialItem ? "Update the details of this row" : "Nothing is deducted from inventory"}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${theme.border.default}`, borderRadius: 9, width: 34, height: 34, cursor: "pointer", color: theme.text.muted, fontSize: 16 }}>
            ✕
          </button>
        </div>

        {/* Name with autocomplete */}
        <div style={{ position: "relative" }}>
          <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
            Product Name <span style={{ color: theme.accent.red }}>*</span>
          </label>
          <input
            ref={nameRef}
            className="ki"
            value={name}
            onChange={e => { setName(e.target.value); setShowSug(true); setError(""); }}
            onFocus={() => setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            onKeyDown={e => {
              if (e.key === "Enter" && suggestions.length > 0 && showSug) {
                e.preventDefault(); pick(suggestions[0]);
              } else if (e.key === "Enter") {
                e.preventDefault(); submit();
              }
            }}
            placeholder="e.g. Bread, Phone repair, Airtime"
            maxLength={60}
            spellCheck={false}
            autoComplete="off"
          />

          {exactMatch && (
            <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#34d399", marginTop: 4 }}>
              ✓ Known item — using saved unit &amp; price
            </div>
          )}

          {showSug && suggestions.length > 0 && !exactMatch && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 5,
              background: theme.bg.card, border: `1px solid ${theme.border.default}`,
              borderRadius: 12, overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
              maxHeight: 220, overflowY: "auto",
            }}>
              {suggestions.map((c, i) => (
                <button key={c.id} onMouseDown={e => e.preventDefault()} onClick={() => pick(c)}
                  style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", borderBottom: i < suggestions.length - 1 ? `1px solid ${theme.border.default}` : "none", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, opacity: 0.5 }}>📦</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                      {c.default_price ? `KSh ${c.default_price}` : "no default"} · {c.unit}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Qty + Unit */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
              Quantity
            </label>
            <input className="ki" type="text" inputMode="numeric" value={qty}
              onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={() => { if (!qty) setQty("1"); }}
              placeholder="0" />
          </div>
          <div>
            <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
              Unit
            </label>
            <select className="ki" value={unit} onChange={e => setUnit(e.target.value)}
              style={{ width: "100%", appearance: "none" }}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* Sell price */}
        <div>
          <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
            Sell Price (KSh) <span style={{ color: theme.accent.red }}>*</span>
          </label>
          <input className="ki" type="text" inputMode="numeric" value={price}
            onChange={e => { setPrice(e.target.value.replace(/[^0-9.]/g, "")); setError(""); }}
            placeholder="0" />
        </div>

        {/* Subtotal preview */}
        {(() => {
          const q = parseInt(qty, 10) || 0;
          const p = Number(price) || 0;
          if (p <= 0 || q <= 0) return null;
          return (
            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>Subtotal</span>
              <span style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, color: theme.accent.gold }}>
                KSh {(q * p).toLocaleString()}
              </span>
            </div>
          );
        })()}

        {error && (
          <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 12px" }}>
            ⚠ {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "14px", border: `1px solid ${theme.border.default}`, borderRadius: 13, background: "transparent", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 14, cursor: "pointer" }}>
            Cancel
          </button>
          {(() => {
            const qtyNum = parseInt(qty, 10) || 0;
            const canSubmit = name.trim().length >= 2 && qtyNum > 0 && Number(price) > 0;
            return (
              <button className="abtn" onClick={submit} disabled={saving || !canSubmit}
                style={{
                  flex: 2,
                  background: canSubmit
                    ? "linear-gradient(135deg,#a855f7,#7e22ce)"
                    : "rgba(168,85,247,0.35)",
                  color: "#fff", fontSize: 15,
                  cursor: canSubmit && !saving ? "pointer" : "not-allowed",
                  opacity: canSubmit && !saving ? 1 : 0.6,
                }}>
                {saving ? "Saving…" : initialItem ? "Update item →" : "Add to cart →"}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}