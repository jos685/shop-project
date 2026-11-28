import { useCallback, useState } from "react";
import { supabase } from "./supabase";

const MAX_PINS = 8;

export function usePinnedProducts<T extends { id: string; pin_rank: number | null }>(
  shopId: string | undefined,
  isOnline: boolean,
  allProducts: T[],
  setAllProducts: (updater: (prev: T[]) => T[]) => void,
  cacheKey: string | null,
  showToast: (msg: string) => void,
) {
  const [pinBusy, setPinBusy] = useState(false);
  const pinnedCount = allProducts.filter(p => p.pin_rank != null).length;

  const persistCache = useCallback((nextProducts: T[]) => {
    if (!cacheKey) return;
    try {
      const raw = localStorage.getItem(cacheKey);
      const cache = raw ? JSON.parse(raw) : {};
      cache.products = nextProducts;
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch {}
  }, [cacheKey]);

  const pinProduct = useCallback(async (allocId: string) => {
    if (!shopId) return;
    if (pinnedCount >= MAX_PINS) {
      showToast(`You can pin up to ${MAX_PINS} items. Unpin one first.`);
      return;
    }
    setPinBusy(true);

    const maxRank = allProducts.reduce(
      (m, p) => (p.pin_rank != null ? Math.max(m, p.pin_rank) : m), 0
    );
    const newRank = maxRank + 1;

    const snapshot = allProducts;
    const optimistic = allProducts.map(p =>
      p.id === allocId ? { ...p, pin_rank: newRank } : p
    );
    setAllProducts(() => optimistic);

    if (isOnline) {
      const { data, error } = await supabase
        .from("shop_allocations")
        .update({ pin_rank: newRank })
        .eq("id", allocId)
        .select("id, pin_rank");

      // 204-with-empty-body = RLS filtered the row; write did not persist.
      if (error || !Array.isArray(data) || data.length === 0) {
        setAllProducts(() => snapshot);
        showToast(
          error
            ? `Couldn't pin: ${error.message}`
            : "Couldn't pin — try again."
        );
        setPinBusy(false);
        return;
      }
    } else {
      setAllProducts(() => snapshot);
      showToast("Pinning needs a connection — try again when online.");
      setPinBusy(false);
      return;
    }

    persistCache(optimistic);
    setPinBusy(false);
    showToast("Pinned to top ⭐");
  }, [shopId, isOnline, allProducts, setAllProducts, pinnedCount, showToast, persistCache]);

  const unpinProduct = useCallback(async (allocId: string) => {
    if (!shopId) return;
    setPinBusy(true);

    const snapshot = allProducts;
    const optimistic = allProducts.map(p =>
      p.id === allocId ? { ...p, pin_rank: null } : p
    );
    setAllProducts(() => optimistic);

    if (isOnline) {
      const { data, error } = await supabase
        .from("shop_allocations")
        .update({ pin_rank: null })
        .eq("id", allocId)
        .select("id, pin_rank");

      if (error || !Array.isArray(data) || data.length === 0) {
        setAllProducts(() => snapshot);
        showToast(
          error
            ? `Couldn't unpin: ${error.message}`
            : "Couldn't unpin — try again."
        );
        setPinBusy(false);
        return;
      }
    } else {
      setAllProducts(() => snapshot);
      showToast("Unpinning needs a connection.");
      setPinBusy(false);
      return;
    }

    persistCache(optimistic);
    setPinBusy(false);
    showToast("Unpinned");
  }, [shopId, isOnline, allProducts, setAllProducts, showToast, persistCache]);

  return { pinProduct, unpinProduct, pinBusy, pinnedCount, MAX_PINS };
}