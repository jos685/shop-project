import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface Props {
  active: boolean;
  onScanSuccess: (text: string) => void;
}

export default function QrScanner({ active, onScanSuccess }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    const elementId = "pos-qr-scanner";

    const start = async () => {
      if (runningRef.current) return;
      try {
        scannerRef.current = new Html5Qrcode(elementId);
        await scannerRef.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text) => { onScanSuccess(text); },
          () => {}
        );
        runningRef.current = true;
      } catch {}
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
