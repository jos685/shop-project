import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface Props {
  active: boolean;
  onScanSuccess: (text: string) => void;
}

export default function QrScanner({ active, onScanSuccess }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const runningRef = useRef(false);
  const [camError, setCamError] = useState<"denied" | "unavailable" | null>(null);

  useEffect(() => {
    const elementId = "pos-qr-scanner";

    const start = async () => {
      if (runningRef.current) return;
      setCamError(null);
      try {
        scannerRef.current = new Html5Qrcode(elementId);
        await scannerRef.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text) => { onScanSuccess(text); },
          () => {}
        );
        runningRef.current = true;
      } catch (err: any) {
        const msg = (err?.message ?? "").toLowerCase();
        if (msg.includes("permission") || msg.includes("notallowed") || msg.includes("denied")) {
          setCamError("denied");
        } else {
          setCamError("unavailable");
        }
      }
    };

    const stop = async () => {
      if (!runningRef.current || !scannerRef.current) return;
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
        runningRef.current = false;
      } catch {}
    };

    if (active) start(); else stop();
    return () => { stop(); };
  }, [active]);

  if (camError) {
    return (
      <div style={{
        borderRadius: 16, background: "rgba(248,113,113,0.06)",
        border: "1px solid rgba(248,113,113,0.25)",
        minHeight: 200, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12,
        padding: "28px 24px", textAlign: "center",
      }}>
        <div style={{ fontSize: 36 }}>📵</div>
        {camError === "denied" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#f87171", fontFamily: "DM Sans, sans-serif" }}>
              Camera access blocked
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "DM Mono, monospace", lineHeight: 1.6 }}>
              To fix: open your browser <strong style={{ color: "rgba(255,255,255,0.7)" }}>Settings → Site permissions → Camera</strong> and allow access for this site, then reload the page.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#f87171", fontFamily: "DM Sans, sans-serif" }}>
              Camera unavailable
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "DM Mono, monospace", lineHeight: 1.6 }}>
              No camera found on this device. Switch to <strong style={{ color: "rgba(255,255,255,0.7)" }}>Products</strong> mode to look up items manually.
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 16, overflow: "hidden", background: "#000", minHeight: 280, position: "relative" }}>
      <div id="pos-qr-scanner" style={{ width: "100%" }} />
      <style>{`
        #pos-qr-scanner video { border-radius: 16px !important; width: 100% !important; }
        #pos-qr-scanner { border: none !important; padding: 0 !important; }
      `}</style>
    </div>
  );
}
