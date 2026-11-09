// src/lib/posPinAuth.ts

async function hashPin(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

const STORAGE_KEY = "qashup_pos_device_pin";

// 👇 Changed to accept the full shop object
export async function setupPosPin(shop: any, pin: string, accessToken: string, refreshToken: string) {
  const salt = crypto.randomUUID();
  const hash = await hashPin(pin, salt);
  
  // Save the shop object directly inside the PIN data
  const pinData = { shopId: shop.id, shopName: shop.name, hash, salt, accessToken, refreshToken, shop };
  
  console.log("🔐 POS PIN SAVED:", pinData);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pinData));
}

export async function verifyPosPin(pin: string): Promise<{ shopId: string, shopName: string, accessToken: string, refreshToken: string, shop: any } | null> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  try {
    const { shopId, shopName, hash, salt, accessToken, refreshToken, shop } = JSON.parse(stored);
    const inputHash = await hashPin(pin, salt);

    if (inputHash === hash) {
      return { shopId, shopName, accessToken, refreshToken, shop };
    }
  } catch {}
  return null;
}

export function hasPosPin(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

export function clearPosPin() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getPosPinData() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}