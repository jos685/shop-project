import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getQueue, getMiscQueue, syncAll } from "../lib/offlineQueue";

const totalPending = () => getQueue().length + getMiscQueue().length;

interface NetworkContextValue {
  isOnline: boolean;
  pendingCount: number;
  refreshPendingCount: () => void;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: navigator.onLine,
  pendingCount: 0,
  refreshPendingCount: () => {},
});

export function useNetwork() {
  return useContext(NetworkContext);
}

type ToastType = "offline" | "online" | "synced" | "sync_error";

interface Toast { id: number; message: string; type: ToastType }

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline]       = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(totalPending);
  const [toasts, setToasts]           = useState<Toast[]>([]);
  const toastId  = useRef(0);
  const syncing  = useRef(false);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(totalPending());
  }, []);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const runSync = useCallback(async () => {
    if (syncing.current || totalPending() === 0) return;
    syncing.current = true;
    const { synced, failed } = await syncAll();
    syncing.current = false;
    refreshPendingCount();
    if (synced > 0 && failed === 0) {
      addToast(`${synced} queued item${synced > 1 ? "s" : ""} synced successfully.`, "synced");
    } else if (synced > 0) {
      addToast(`${synced} synced · ${failed} failed, will retry.`, "sync_error");
    } else if (failed > 0) {
      addToast(`${failed} item${failed > 1 ? "s" : ""} failed to sync — will retry on reconnect.`, "sync_error");
    }
  }, [addToast, refreshPendingCount]);

  // Sync on mount if already online with pending items (handles page reload / tab switch)
  useEffect(() => {
    if (navigator.onLine && totalPending() > 0) {
      runSync();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      addToast("Connection restored.", "online");
      runSync();
    };
    const onOffline = () => {
      setIsOnline(false);
      addToast("You're offline — sales will be queued.", "offline");
    };
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [addToast, runSync]);

  return (
    <NetworkContext.Provider value={{ isOnline, pendingCount, refreshPendingCount }}>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 99999, display: "flex", flexDirection: "column", gap: 8,
          alignItems: "center", pointerEvents: "none",
        }}>
          {toasts.map(t => <NetworkToast key={t.id} toast={t} />)}
        </div>
      )}
    </NetworkContext.Provider>
  );
}

function NetworkToast({ toast }: { toast: Toast }) {
  const bg: Record<ToastType, string> = {
    offline:    "#dc2626",
    online:     "#16a34a",
    synced:     "#0891b2",
    sync_error: "#d97706",
  };
  const icon: Record<ToastType, string> = {
    offline:    "⚡",
    online:     "✓",
    synced:     "↑",
    sync_error: "⚠",
  };
  return (
    <div style={{
      background:  bg[toast.type],
      color:       "#fff",
      padding:     "10px 18px",
      borderRadius: 12,
      fontSize:    13,
      fontWeight:  600,
      fontFamily:  "monospace",
      boxShadow:   "0 4px 20px rgba(0,0,0,0.3)",
      display:     "flex",
      alignItems:  "center",
      gap:         8,
      whiteSpace:  "nowrap",
      animation:   "netToastIn 0.25s ease both",
    }}>
      <span>{icon[toast.type]}</span>
      {toast.message}
      <style>{`@keyframes netToastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
