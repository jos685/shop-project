import type { CartItem } from "../types/pos";
import { cartItemName } from "../types/pos";
import type { BusinessInfo } from "./useBusinessInfo";

export interface ReceiptItem {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  unlisted: boolean;
}

export interface ReceiptData {
  ref: string;
  timestamp: string;
  sellerName: string;
  customerName: string;
  customerPhone: string;
  items: ReceiptItem[];
  total: number;
  paymentMethod: string;
  mpesaRef: string;
  isCredit: boolean;
  amountPaid: number;
  balanceOwed: number;
  isQueued: boolean;
  isBackdated: boolean;
}

export function buildReceiptData(input: {
  ref: string;
  timestamp: string;
  sellerName: string;
  customerName: string;
  customerPhone: string;
  cart: CartItem[];
  total: number;
  payMethod: string | null;
  mpesaRef: string;
  initialPayment: number;
  isQueued: boolean;
  isBackdated: boolean;
}): ReceiptData {
  const isCredit = input.payMethod === "credit";
  const paid = isCredit ? Math.min(Math.max(0, input.initialPayment), input.total) : 0;

  const payLabel =
    input.payMethod === "cash"   ? "Cash"     :
    input.payMethod === "mpesa"  ? "M-Pesa"   :
    input.payMethod === "split"  ? "Split"    :
    input.payMethod === "credit" ? "Pay Later": "—";

  return {
    ref: input.ref,
    timestamp: input.timestamp,
    sellerName: input.sellerName,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    items: input.cart.map(item => ({
      name: cartItemName(item),
      qty: item.quantity,
      unitPrice: item.sellPrice,
      total: item.sellPrice * item.quantity,
      unlisted: item.kind === "unlisted",
    })),
    total: input.total,
    paymentMethod: payLabel,
    mpesaRef: input.mpesaRef,
    isCredit,
    amountPaid: paid,
    balanceOwed: isCredit ? Math.max(0, input.total - paid) : 0,
    isQueued: input.isQueued,
    isBackdated: input.isBackdated,
  };
}

export function sanitizeFilename(s: string): string {
  return (s || "receipt")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "receipt";
}

export function receiptFilename(businessName: string, ref: string): string {
  const shop = sanitizeFilename(businessName);
  const r    = sanitizeFilename(ref.replace(/^[A-Z]+-/, ""));
  const prefix = ref.startsWith("CR-") ? "CR" : "TXN";
  return `${shop}-${prefix}-${r}.pdf`;
}

const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

// ── Plain-text version (WhatsApp / clipboard) ─────────────────────────
export function receiptToText(d: ReceiptData, biz: BusinessInfo): string {
  const lines: string[] = [];
  lines.push(`*${biz.businessName || "Receipt"}*`);
  if (biz.phone) lines.push(biz.phone);
  lines.push("");
  lines.push(`Receipt: ${d.ref}`);
  lines.push(d.timestamp);
  lines.push(`Served by: ${d.sellerName}`);
  lines.push("─────────────────────");
  for (const it of d.items) {
    lines.push(`${it.qty}× ${it.name}`);
    lines.push(`   ${ksh(it.total)}`);
  }
  lines.push("─────────────────────");
  lines.push(`TOTAL: ${ksh(d.total)}`);
  if (d.isCredit) {
    lines.push(`Paid upfront: ${ksh(d.amountPaid)}`);
    lines.push(`*Balance owed: ${ksh(d.balanceOwed)}*`);
  }
  lines.push("");
  lines.push(`Payment: ${d.paymentMethod}${d.mpesaRef ? ` (${d.mpesaRef})` : ""}`);
  if (d.customerPhone) lines.push(`Customer: ${d.customerPhone}`);
  if (d.isQueued) lines.push("⏳ Will sync when online");
  lines.push("");
  lines.push(`Thank you for shopping at ${biz.businessName || "us"} 🙏`);
  return lines.join("\n");
}

// ── Print HTML (Modern design for Screen/PNG/Print) ───────────────────
export function receiptToPrintHtml(d: ReceiptData, biz: BusinessInfo, logoDataUrl: string | null): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

  const rows = d.items.map(it => `
    <div class="row">
      <div class="name">${it.qty}× ${esc(it.name)}</div>
      <div class="amt">${ksh(it.total)}</div>
    </div>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(d.ref)}</title>
<style>
  body {
    margin: 0;
    padding: 40px 20px; /* 👈 Fixes top margin */
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    justify-content: center; /* 👈 Perfectly centers the PNG */
    color: #1e293b;
    -webkit-print-color-adjust: exact;
  }

  .paper {
    width: 100%;
    max-width: 320px; /* Standard receipt width */
  }

  .center { text-align: center; }
  
  .logo { 
    max-height: 54px; 
    max-width: 120px; 
    object-fit: contain; 
    display: block; 
    margin: 0 auto 12px; 
    border-radius: 8px;
  }
  
  .biz-name { 
    font-size: 18px; 
    font-weight: 800; 
    color: #0f172a;
    margin-bottom: 4px;
  }
  
  .biz-phone { 
    font-size: 13px; 
    color: #64748b; 
    font-weight: 500;
  }

  .divider { 
    border-bottom: 1.5px dashed #cbd5e1; 
    margin: 16px 0; 
  }

  .meta-row { 
    display: flex; 
    justify-content: space-between; 
    margin-bottom: 6px; 
    font-size: 13px;
  }
  
  .meta-label { color: #64748b; }
  .meta-value { font-weight: 600; color: #0f172a; }

  .row { 
    display: flex; 
    justify-content: space-between; 
    margin-bottom: 8px; 
    font-size: 14px;
  }
  
  .name { font-weight: 500; color: #334155; }
  .amt { font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; }

  .total-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
  }

  .total-label {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    text-transform: uppercase;
  }

  .total-val {
    font-size: 24px;
    font-weight: 900;
    color: #ea580c; /* 👈 Bright Orange Accent */
    font-variant-numeric: tabular-nums;
  }

  .credit-box { 
    border: 1.5px dashed #f87171; 
    background: #fef2f2;
    color: #b91c1c;
    padding: 10px; 
    border-radius: 8px;
    margin: 16px 0; 
    font-size: 13px;
  }
  .credit-box .row { margin-bottom: 4px; }

  .thanks { 
    margin-top: 24px; 
    font-size: 13px; 
    color: #64748b;
    line-height: 1.5;
  }
</style></head>
<body>
  <div class="paper">
    <div class="center">
      ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="" />` : ""}
      <div class="biz-name">${esc(biz.businessName || "")}</div>
      ${biz.phone ? `<div class="biz-phone">${esc(biz.phone)}</div>` : ""}
    </div>

    <div class="divider"></div>

    <div class="meta-row"><span class="meta-label">Receipt</span><span class="meta-value">${esc(d.ref)}</span></div>
    <div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">${esc(d.timestamp)}</span></div>
    <div class="meta-row"><span class="meta-label">Served by</span><span class="meta-value">${esc(d.sellerName)}</span></div>

    <div class="divider"></div>

    ${rows}

    <div class="divider"></div>

    <div class="total-row">
      <span class="total-label">Total</span>
      <span class="total-val">${ksh(d.total)}</span>
    </div>

    ${d.isCredit ? `
      <div class="credit-box">
        <div style="font-weight:800; text-transform:uppercase; margin-bottom:6px; font-size:11px;">Credit Sale</div>
        <div class="row"><span>Paid upfront</span><span>${ksh(d.amountPaid)}</span></div>
        <div class="row"><span>Balance owed</span><span style="font-weight:800;">${ksh(d.balanceOwed)}</span></div>
      </div>` : ""}
    
    <div class="meta-row" style="margin-top:16px;"><span class="meta-label">Payment</span><span class="meta-value">${esc(d.paymentMethod)}</span></div>
    ${d.mpesaRef ? `<div class="meta-row"><span class="meta-label">M-Pesa Ref</span><span class="meta-value">${esc(d.mpesaRef)}</span></div>` : ""}
    ${d.customerName ? `<div class="meta-row"><span class="meta-label">Customer</span><span class="meta-value">${esc(d.customerName)}</span></div>` : ""}
    ${d.customerPhone ? `<div class="meta-row"><span class="meta-label">Phone</span><span class="meta-value">${esc(d.customerPhone)}</span></div>` : ""}
    
    <div class="center thanks" style="margin-top: 24px;">
      Thank you for shopping at<br/>
      <strong style="color:#0f172a;">${esc(biz.businessName || "")}</strong>
    </div>
  </div>
</body></html>`;
}

// ── PDF via jspdf (lazy-loaded) ───────────────────────────────────────
export async function receiptToPdf(
  d: ReceiptData,
  biz: BusinessInfo,
  opts: { save?: boolean } = { save: true }
): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  
  // 👈 Increased margin from 12 to 20 so it doesn't touch the top
  const M = 20; 
  const W = PAGE_W - M * 2;
  let y = M;

  // Color Palette
    const darkSlate: [number, number, number] = [15, 23, 42];   // #0f172a
  const mutedSlate: [number, number, number] = [100, 116, 139]; // #64748b
  const accentOrange: [number, number, number] = [234, 88, 12]; // #ea580c

  // ── Logo ──
  let logoDataUrl: string | null = null;
  const logoUrl = biz.logoUrl;
  const isSvg = logoUrl ? /\.svg(\?|$)/i.test(logoUrl) : false;
  if (logoUrl && !isSvg) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(logoUrl, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const blob = await res.blob();
        logoDataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      }
    } catch { logoDataUrl = null; }
  }

  if (logoDataUrl) {
    try {
      const img = (doc as any).getImageProperties(logoDataUrl);
      const maxW = 60, maxH = 20;
      const ratio = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      doc.addImage(logoDataUrl, "PNG", (PAGE_W - w) / 2, y, w, h, undefined, "FAST");
      y += h + 5;
    } catch { /* bad image — skip */ }
  }

  // ── Business Header ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...darkSlate);
  const bizName = biz.businessName || "";
  const bizLines = doc.splitTextToSize(bizName, W) as string[];
  for (const line of bizLines) {
    doc.text(line, PAGE_W / 2, y, { align: "center" });
    y += 6;
  }

  if (biz.phone) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...mutedSlate);
    doc.text(biz.phone, PAGE_W / 2, y, { align: "center" });
    y += 6;
  }

  y += 2;
  doc.setDrawColor(203, 213, 225); // light slate line
  doc.setLineDashPattern([1, 1], 0); // dashed line
  doc.line(M, y, PAGE_W - M, y);
  doc.setLineDashPattern([], 0); // reset
  y += 8;

  // ── Meta rows ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const metaRow = (label: string, value: string) => {
    doc.setTextColor(...mutedSlate);
    doc.text(label, M, y);
    doc.setTextColor(...darkSlate);
    doc.setFont("helvetica", "bold");
    const v = doc.splitTextToSize(value, W - 40) as string[];
    doc.text(v, PAGE_W - M, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 6 * v.length;
  };
  metaRow("Receipt", d.ref);
  metaRow("Date", d.timestamp);
  metaRow("Served by", d.sellerName);

  y += 4;
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(M, y, PAGE_W - M, y);
  doc.setLineDashPattern([], 0);
  y += 8;

  // ── Items ──
  const colName = M;
  const colAmt  = PAGE_W - M;

  const ensureSpace = (need: number) => {
    if (y + need > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
  };

  for (const it of d.items) {
    const nameLines = doc.splitTextToSize(`${it.qty}× ${it.name}`, W * 0.7) as string[];
    const rowH = Math.max(6, nameLines.length * 5);
    ensureSpace(rowH + 2);

    doc.setTextColor(...darkSlate);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(nameLines, colName, y);
    
    doc.setFont("helvetica", "bold");
    doc.text(ksh(it.total), colAmt, y, { align: "right" });
    y += rowH;
  }

  y += 2;
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(M, y, PAGE_W - M, y);
  doc.setLineDashPattern([], 0);
  y += 8;

  // ── Total ──
  ensureSpace(15);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...darkSlate);
  doc.text("TOTAL", M, y);
  
  doc.setFontSize(18);
  doc.setTextColor(...accentOrange); // 👈 Orange Accent
  doc.text(ksh(d.total), PAGE_W - M, y, { align: "right" });
  y += 10;

  // ── Credit block ──
  if (d.isCredit) {
    ensureSpace(25);
    doc.setDrawColor(248, 113, 113); // red border
    doc.setFillColor(254, 242, 242); // light red bg
    doc.roundedRect(M, y, W, 18, 2, 2, "FD");
    
    doc.setTextColor(185, 28, 28); // red text
    doc.setFontSize(9);
    doc.text("CREDIT SALE", M + 4, y + 5);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...darkSlate);
    doc.text("Paid upfront", M + 4, y + 11);
    doc.text(ksh(d.amountPaid), PAGE_W - M - 4, y + 11, { align: "right" });
    
    doc.setFont("helvetica", "bold");
    doc.text("Balance owed", M + 4, y + 16);
    doc.text(ksh(d.balanceOwed), PAGE_W - M - 4, y + 16, { align: "right" });
    y += 22;
  }

  // ── Payment Meta ──
  ensureSpace(30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  const payRow = (label: string, value: string) => {
    doc.setTextColor(...mutedSlate);
    doc.text(label, M, y);
    doc.setTextColor(...darkSlate);
    doc.setFont("helvetica", "bold");
    doc.text(value, PAGE_W - M, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 6;
  };

  payRow("Payment", d.paymentMethod);
  if (d.mpesaRef) payRow("M-Pesa Ref", d.mpesaRef);
  if (d.customerName) payRow("Customer", d.customerName);
  if (d.customerPhone) payRow("Phone", d.customerPhone);
  if (d.isQueued) {
    doc.setTextColor(180, 120, 0);
    doc.text("Status", M, y);
    doc.text("Pending sync", PAGE_W - M, y, { align: "right" });
    y += 6;
  }

  // ── Footer ──
  y += 4;
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(M, y, PAGE_W - M, y);
  y += 8;
  
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.setTextColor(...mutedSlate);
  const thanks = `Thank you for shopping at ${biz.businessName || "us"}!`;
  const thanksLines = doc.splitTextToSize(thanks, W) as string[];
  for (const line of thanksLines) {
    doc.text(line, PAGE_W / 2, y, { align: "center" });
    y += 5;
  }

  if (opts.save !== false) {
    doc.save(receiptFilename(biz.businessName, d.ref));
  }
}