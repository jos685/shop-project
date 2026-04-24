// @ts-nocheck — Deno runtime, not Node. VS Code can't resolve deno.land URLs.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      phone,
      business_name,
      agent_name,
      items,
      total_amount,
      payment_method,
      mpesa_ref,
      initial_payment,  // credit sales: amount paid upfront (may be 0)
      balance_due,      // credit sales: remaining balance
      customer_name,    // credit sales: customer name
    } = await req.json();

    const normalized = normalizePhone(phone ?? "");
    if (!normalized) {
      return new Response(
        JSON.stringify({ sent: false, reason: "invalid_phone" }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Build item lines
    const itemLines = (items as { name: string; quantity: number; unit_price: number; total: number }[])
      .map(i => `${i.name} x${i.quantity} @ KSh ${i.unit_price.toLocaleString()} = KSh ${i.total.toLocaleString()}`)
      .join("\n");

    const now  = new Date();
    const date = now.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
    const time = now.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

    let paymentSection: string;

    if (payment_method === "credit") {
      const paid    = Number(initial_payment ?? 0);
      const balance = Number(balance_due ?? total_amount);
      const lines   = ["CREDIT SALE"];
      if (customer_name) lines.push(`Customer: ${customer_name}`);
      if (paid > 0) {
        lines.push(`Paid upfront: KSh ${paid.toLocaleString()}`);
        lines.push(`Balance owed: KSh ${balance.toLocaleString()}`);
      } else {
        lines.push(`Amount owed: KSh ${balance.toLocaleString()}`);
      }
      paymentSection = lines.join("\n");
    } else {
      const paymentLine =
        payment_method === "mpesa" ? `M-Pesa${mpesa_ref ? ` (${mpesa_ref})` : ""}` :
        payment_method === "split" ? `Cash + M-Pesa${mpesa_ref ? ` (${mpesa_ref})` : ""}` :
        "Cash";
      paymentSection = `Payment: ${paymentLine}`;
    }

    const message = [
      business_name,
      "────────────",
      itemLines,
      "────────────",
      `Total: KSh ${Number(total_amount).toLocaleString()}`,
      paymentSection,
      `Agent: ${agent_name}`,
      `${date}, ${time}`,
      "────────────",
      "Thank you!",
      "Epic Softwares-0768131905",
    ].join("\n");

    const AT_USERNAME  = Deno.env.get("AT_USERNAME")!;
    const AT_API_KEY   = Deno.env.get("AT_API_KEY")!;
    const AT_SENDER_ID = Deno.env.get("AT_SENDER_ID") ?? "";

    const body = new URLSearchParams({
      username: AT_USERNAME,
      to:       normalized,
      message,
    });
    if (AT_SENDER_ID) body.set("from", AT_SENDER_ID);

    const atRes = await fetch("https://api.africastalking.com/version1/messaging", {
      method:  "POST",
      headers: {
        apiKey:         AT_API_KEY,
        Accept:         "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const atData = await atRes.json();
    const recipients = atData?.SMSMessageData?.Recipients ?? [];
    const success    = recipients.length > 0 && recipients[0]?.status === "Success";

    return new Response(
      JSON.stringify({ sent: success, recipients, raw: atData }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ sent: false, reason: String(err) }),
      { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
