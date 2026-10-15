import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface BusinessInfo {
  businessName: string;
  phone: string;
  logoUrl: string | null;
}

const EMPTY: BusinessInfo = { businessName: "", phone: "", logoUrl: null };

/**
 * Fetches the shop owner's public business info (name, phone, logo).
 * Cache-first: reads localStorage synchronously so offline receipts render,
 * then refreshes from Supabase when online.
 *
 * Cache key is scoped per shop, not per owner, so two shops under the same
 * owner don't accidentally share a cached name.
 */
export function useBusinessInfo(shop: { id: string; owner_id: string; name?: string } | null | undefined) {
  const cacheKey = shop ? `pos_business_${shop.id}` : null;

  const [info, setInfo] = useState<BusinessInfo>(() => {
    if (!cacheKey) return EMPTY;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) return { ...EMPTY, ...JSON.parse(raw) };
    } catch {}
    return EMPTY;
  });

  // Fall back to shop.name immediately if we have nothing cached yet
  useEffect(() => {
    if (shop?.name && !info.businessName) {
      setInfo(prev => ({ ...prev, businessName: shop.name! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.id]);

  useEffect(() => {
    if (!shop || !cacheKey) return;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("business_name, phone, logo_url")
          .eq("id", shop.owner_id)
          .single();

        if (cancelled || error || !data) return;

        const fresh: BusinessInfo = {
          businessName: (data.business_name as string) || shop.name || "",
          phone:        (data.phone as string) || "",
          logoUrl:      (data.logo_url as string) || null,
        };

        setInfo(fresh);
        try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {}
      } catch {
        // offline or transient — keep whatever cache we had
      }
    })();

    return () => { cancelled = true; };
  }, [shop?.id, shop?.owner_id, cacheKey]);

  return info;
}