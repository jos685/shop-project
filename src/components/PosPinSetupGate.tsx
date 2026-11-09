// src/components/PosPinSetupGate.tsx
import { useState, useEffect } from "react";
import { useShopAuth } from "../context/ShopAuthContext";
import { hasPosPin } from "../lib/posPinAuth";
import PosPinSetupModal from "../components/PosPinSetupModal"; 

export default function PosPinSetupGate() {
  const { shop, hasAuthSession } = useShopAuth();
  const [showPinSetup, setShowPinSetup] = useState(false);

  useEffect(() => {
    const skipped = sessionStorage.getItem("skipped_pos_pin_setup");
    
    const timer = setTimeout(() => {
      if (shop && hasAuthSession && !hasPosPin() && !skipped) {
        setShowPinSetup(true);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [shop, hasAuthSession]);

  if (!shop || !hasAuthSession) return null;

  const handleClose = () => {
    setShowPinSetup(false);
    sessionStorage.setItem("skipped_pos_pin_setup", "true");
  };

  return (
    <PosPinSetupModal
      isOpen={showPinSetup}
      onClose={handleClose}
      onSuccess={() => setShowPinSetup(false)}
    />
  );
}