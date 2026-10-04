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

const SUGGESTIONS_PER_PAGE = 5;

export default function UnlistedItemModal({
  open, onClose, customItems, theme, isMobile, onSaveCustomItem, onAdd,
  initialItem = null,
}: Props) {
  const [name, setName]           = useState("");
  const [unit, setUnit]           = useState("pc");
  const [qty, setQty]             = useState("");
  const [price, setPrice]         = useState("");
  const [showSug, setShowSug]     = useState(false);
  const [sugPage, setSugPage]     = useState(1);
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

    setShowSug(false); setError(""); setSaving(false); setSugPage(1);
    setTimeout(() => nameRef.current?.focus(), 100);
  }, [open, initialItem]);

  // Reset pagination whenever the search term changes so we never land
  // on an out-of-range page after a filter narrows the list.
  useEffect(() => { setSugPage(1); }, [name]);

  // All matching items, before pagination
  const allSuggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    return q
      ? customItems.filter(c => c.name.toLowerCase().includes(q))
      : customItems;
  }, [name, customItems]);

  // Paginate
  const totalSugPages = Math.max(1, Math.ceil(allSuggestions.length / SUGGESTIONS_PER_PAGE));
  const safeSugPage   = Math.min(sugPage, totalSugPages);
  const suggestions   = allSuggestions.slice(
    (safeSugPage - 1) * SUGGESTIONS_PER_PAGE,
    safeSugPage * SUGGESTIONS_PER_PAGE,
  );

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

    if (!customItemId) {
      setSaving(true);
      const created = await onSaveCustomItem(trimmed, unit, sellPrice);
      setSaving(false);
      customItemId = created?.id ?? null;
    }

    onAdd({ customItemId, name: trimmed, unit, quantity, sellPrice });
  };

  if (!open) return null;

  const dropdownOpen = showSug && !exactMatch && customItems.length > 0;

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

          {/* Input wrapper — anchors the chevron toggle */}
          <div style={{ position: "relative" }}>
            <input
              ref={nameRef}
              className="ki"
              value={name}
              onChange={e => {
                const v = e.target.value;
                setName(v);
                // Only auto-open while the user is actively typing.
                // Empty field + focus does NOT open the dropdown.
                setShowSug(v.trim().length > 0 && customItems.length > 0);
                setError("");
              }}
              onFocus={() => {
                // Reopen only if the field already has text
                if (name.trim().length > 0 && customItems.length > 0) setShowSug(true);
              }}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setShowSug(false);
                  return;
                }
                if (e.key === "Enter" && dropdownOpen && name.trim().length > 0 && suggestions.length > 0) {
                  e.preventDefault(); pick(suggestions[0]);
                } else if (e.key === "Enter") {
                  e.preventDefault(); submit();
                }
              }}
              placeholder="e.g. Bread, Phone repair, Airtime"
              maxLength={60}
              spellCheck={false}
              autoComplete="off"
              style={{ paddingRight: 38 }}
            />

            {/* Chevron toggle — opens the list manually */}
            <button
              type="button"
              // preventDefault on mousedown so the input never loses focus
              // when the user taps the chevron.
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                if (customItems.length === 0) return;
                setShowSug(v => !v);
              }}
              aria-label="Toggle saved items"
              style={{
                position: "absolute",
                right: 6, top: "50%", transform: "translateY(-50%)",
                width: 28, height: 28, borderRadius: 8,
                border: "none", background: "transparent",
                color: theme.text.muted,
                cursor: customItems.length === 0 ? "not-allowed" : "pointer",
                opacity: customItems.length === 0 ? 0.35 : 1,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg
                width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                style={{
                  transform: showSug ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>

          {exactMatch && (
            <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#34d399", marginTop: 4 }}>
              ✓ Known item — using saved unit &amp; price
            </div>
          )}

          {dropdownOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 5,
              background: theme.bg.card, border: `1px solid ${theme.border.default}`,
              borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
              display: "flex", flexDirection: "column",
              maxHeight: 280, overflow: "hidden",
            }}>
                            {allSuggestions.length === 0 ? null : (
                <>
                  {/* Scrollable list */}
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {suggestions.map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => pick(c)}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          background: "transparent",
                          border: "none",
                          borderBottom: i < suggestions.length - 1 ? `1px solid ${theme.border.default}` : "none",
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 14, opacity: 0.5 }}>📦</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.name}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                            {c.default_price ? `KSh ${c.default_price}` : "no default"} · {c.unit}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Pagination footer */}
                  {totalSugPages > 1 && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      borderTop: `1px solid ${theme.border.default}`,
                      background: "rgba(0,0,0,0.15)",
                      flexShrink: 0,
                    }}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setSugPage(p => Math.max(1, p - 1))}
                        disabled={safeSugPage === 1}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: `1px solid ${theme.border.default}`,
                          background: "transparent",
                          color: safeSugPage === 1 ? theme.text.muted : theme.text.primary,
                          fontFamily: theme.font.mono,
                          fontSize: 11,
                          cursor: safeSugPage === 1 ? "not-allowed" : "pointer",
                          opacity: safeSugPage === 1 ? 0.4 : 1,
                        }}
                      >
                        ←
                      </button>

                      <span style={{
                        fontSize: 10,
                        fontFamily: theme.font.mono,
                        color: theme.text.muted,
                        whiteSpace: "nowrap",
                      }}>
                        {allSuggestions.length} items · Page {safeSugPage} / {totalSugPages}
                      </span>

                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setSugPage(p => Math.min(totalSugPages, p + 1))}
                        disabled={safeSugPage === totalSugPages}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: `1px solid ${theme.border.default}`,
                          background: "transparent",
                          color: safeSugPage === totalSugPages ? theme.text.muted : theme.text.primary,
                          fontFamily: theme.font.mono,
                          fontSize: 11,
                          cursor: safeSugPage === totalSugPages ? "not-allowed" : "pointer",
                          opacity: safeSugPage === totalSugPages ? 0.4 : 1,
                        }}
                      >
                        →
                      </button>
                    </div>
                  )}
                </>
              )}
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