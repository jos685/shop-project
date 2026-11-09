import { useState, useEffect } from "react";
import { setupPosPin } from "../lib/posPinAuth";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";
import { useShopAuth } from "../context/ShopAuthContext";


export default function PosPinSetupModal({
  isOpen, onClose, onSuccess,
}: {
  isOpen: boolean; onClose: () => void; onSuccess?: () => void;
}) {
  const { theme } = useTheme();
  const dk = theme.isDark;
  const [step, setStep] = useState<1 | 2>(1);
  const [firstPin, setFirstPin] = useState("");
  const [pin, setPin] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const { shop } = useShopAuth();

  useEffect(() => {
    if (isOpen) {
      setStep(1); setFirstPin(""); setPin(""); setErrorMessage(""); setSkipped(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (pin.length === 4 && !loading && !skipped) submitPin();
  }, [pin]);

  useEffect(() => {
    if (!isOpen || skipped) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") setPin(prev => prev.length < 4 && !loading ? prev + e.key : prev);
      else if (e.key === "Backspace") setPin(prev => !loading ? prev.slice(0, -1) : prev);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, skipped]);

  if (!isOpen) return null;

  const handleCancel = () => {
    setSkipped(true);
    // Give the user 3 seconds to read the message before closing
    setTimeout(() => { onClose(); }, 3000); 
  };

  const submitPin = async () => {
    if (step === 1) {
      setFirstPin(pin); setPin(""); setStep(2);
    } else {
      if (pin !== firstPin) {
        setErrorMessage("Passcodes do not match. Try again.");
        setPin("");
        setTimeout(() => { setErrorMessage(""); setStep(1); setFirstPin(""); }, 2000);
        return;
      }
      
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session && shop) {
        // 👇 Pass the full shop object
        await setupPosPin(shop, pin, session.access_token, session.refresh_token);
      }
      
      setLoading(false);
      if (onSuccess) onSuccess();
      onClose();
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)", padding: 16 }}>
      
      <div style={{ 
        background: dk ? "#131118" : "#fffbf4", 
        padding: "32px 20px", borderRadius: 24, 
        border: `1px solid ${dk ? "#2e2b3a" : "#e7e5e4"}`, 
        width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", 
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)", position: "relative", overflow: "hidden" 
      }}>
        
        {/* Close 'X' Button */}
        {!skipped && (
          <button 
            onClick={onClose} 
            style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: dk ? "#8b8699" : "#78716c", zIndex: 10 }}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}

        {/* Decorative Curves */}
        <div style={{ position: "absolute", top: -50, left: -50, width: 200, height: 200, background: dk ? "radial-gradient(circle, rgba(249,115,22,0.1) 0%, transparent 70%)" : "radial-gradient(circle, rgba(249,115,22,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
        <img src="/Qash.png" alt="" style={{ position: "absolute", top: "55%", left: "50%", transform: "translate(-50%, -50%)", width: "100%", maxWidth: "350px", opacity: dk ? 0.08 : 0.04, pointerEvents: "none", zIndex: 0 }} />

        <div style={{ position: "relative", zIndex: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          
          {skipped ? (
            <div style={{ textAlign: "center", padding: "40px 10px" }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: dk ? "#f1f0f5" : "#1c1917", marginBottom: 12 }}>
                Setup Skipped
              </h3>
              <p style={{ fontSize: 14, color: dk ? "#8b8699" : "#78716c", lineHeight: 1.6 }}>
                You can always set up your Quick Login PIN later in the <strong>Shop Info</strong> page.
              </p>
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, fontFamily: "'Plus Jakarta Sans', sans-serif", color: dk ? "#f1f0f5" : "#1c1917", textAlign: "center" }}>
                {step === 1 ? "Set up Quick Login" : "Confirm Passcode"}
              </h2>
              
              <p style={{ fontSize: 13, color: dk ? "#8b8699" : "#78716c", marginBottom: 16, textAlign: "center", lineHeight: 1.5, maxWidth: 260 }}>
                {step === 1 ? "Create a 4-digit passcode to log in faster next time without typing your password." : "Enter the same 4-digit passcode again to confirm."}
              </p>

              <div style={{ minHeight: 24, marginBottom: 10 }}>
                {errorMessage && <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 600 }}>{errorMessage}</div>}
              </div>

              {/* 4 PIN Boxes */}
              <div className={errorMessage ? "shaking" : ""} style={{ display: "flex", gap: 10, marginBottom: 24 }}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} style={{ 
                    width: "clamp(45px, 15vw, 55px)", height: "clamp(55px, 18vw, 65px)", borderRadius: 16, 
                    border: `2px solid ${pin.length === i ? "#f97316" : (dk ? "#2e2b3a" : "#e7e5e4")}`, 
                    background: dk ? "#1e1c26" : "#ffffff",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: dk ? "#f1f0f5" : "#1c1917",
                    boxShadow: pin.length === i ? `0 0 0 4px rgba(249,115,22,0.15)` : "none",
                    transition: "all 0.2s"
                  }}>
                    {pin[i] ? "•" : ""}
                  </div>
                ))}
              </div>

              {/* Numpad */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 24px", width: "100%", maxWidth: 240, marginBottom: 24 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "<"].map((btn, i) => (
                  <button
                    key={i}
                    onClick={() => btn === "<" ? setPin(prev => prev.slice(0, -1)) : btn !== "" && setPin(prev => prev.length < 4 ? prev + btn : prev)}
                    style={{ background: "transparent", border: "none", color: dk ? "#f1f0f5" : "#1c1917", fontSize: 24, padding: 8, cursor: "pointer", opacity: btn === "" ? 0 : 1, fontWeight: 500 }}
                    disabled={btn === "" || loading}
                  >
                    {btn}
                  </button>
                ))}
              </div>

              {/* Styled Skip Button */}
              <button 
                onClick={handleCancel} 
                disabled={loading} 
                style={{ 
                  background: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", 
                  border: `1px solid ${dk ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`, 
                  padding: "10px 24px", borderRadius: 10,
                  color: dk ? "#8b8699" : "#78716c", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", width: "100%", maxWidth: 200
                }}
              >
                Skip for now
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
        .shaking { animation: shake 0.42s ease !important; }
      `}</style>
    </div>
  );
}