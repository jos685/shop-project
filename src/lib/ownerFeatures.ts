// lib/ownerFeatures.ts
// Fetches the effective feature set for an owner via the get_owner_features RPC.
// Result is cached in localStorage so offline POS sessions get the last-known value.

import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export interface OwnerFeatures {
  scan_to_sell:  boolean;
  reports:       boolean;
  export:        boolean;
  cash_tracker:  boolean;
  daily_reports: boolean;
  [key: string]: boolean;
}

const CACHE_PREFIX = "qashup_owner_features_";
const DEFAULT_FEATURES: OwnerFeatures = {
  scan_to_sell:  true,
  reports:       true,
  export:        true,
  cash_tracker:  true,
  daily_reports: true,
};

function fromCache(ownerId: string): OwnerFeatures | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + ownerId);
    return raw ? (JSON.parse(raw) as OwnerFeatures) : null;
  } catch {
    return null;
  }
}

function toCache(ownerId: string, features: OwnerFeatures) {
  try {
    localStorage.setItem(CACHE_PREFIX + ownerId, JSON.stringify(features));
  } catch { /* ignore */ }
}

export function useOwnerFeatures(ownerId: string | null | undefined) {
  const [features, setFeatures] = useState<OwnerFeatures>(() =>
    ownerId ? (fromCache(ownerId) ?? DEFAULT_FEATURES) : DEFAULT_FEATURES
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ownerId) { setLoading(false); return; }

    const cached = fromCache(ownerId);
    if (cached) setFeatures(cached);

    if (!navigator.onLine) { setLoading(false); return; }

    supabase
      .rpc("get_owner_features", { p_owner_id: ownerId })
      .then(({ data }) => {
        if (data && typeof data === "object") {
          const f: OwnerFeatures = { ...DEFAULT_FEATURES, ...(data as object) };
          setFeatures(f);
          toCache(ownerId, f);
        }
        setLoading(false);
      }, () => {
        setLoading(false);
      });
  }, [ownerId]);

  return { features, loading };
}
