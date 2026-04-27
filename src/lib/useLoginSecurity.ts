import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY   = "pos_login_security";
const MAX_ATTEMPTS  = 5;           // lock after this many consecutive failures
const LOCKOUT_MS    = 30_000;      // 30 seconds
const ATTEMPT_RESET = 15 * 60_000; // reset failure count after 15 min of no attempts

interface StoredState {
  failures: number;
  lockedUntil: number | null;
  lastAttemptAt: number | null;
}

function readStore(): StoredState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { failures: 0, lockedUntil: null, lastAttemptAt: null };
    return JSON.parse(raw) as StoredState;
  } catch {
    return { failures: 0, lockedUntil: null, lastAttemptAt: null };
  }
}

function writeStore(s: StoredState) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

export interface LoginSecurity {
  /** Seconds remaining in current lockout, or 0 if not locked. */
  countdown: number;
  /** True while locked out. */
  isLocked: boolean;
  /** Number of consecutive failures in this session. */
  failures: number;
  /** Call before each login attempt — returns false if currently locked. */
  canAttempt: () => boolean;
  /** Call on a successful login to reset the failure counter. */
  onSuccess: () => void;
  /** Call on a failed login attempt. */
  onFailure: () => void;
}

export function useLoginSecurity(): LoginSecurity {
  const [countdown, setCountdown] = useState(0);
  const [failures,  setFailures]  = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const startCountdown = useCallback((until: number) => {
    clearTimer();
    const tick = () => {
      const remaining = Math.ceil((until - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdown(0);
        clearTimer();
      } else {
        setCountdown(remaining);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 500);
  }, []);

  // Initialise from sessionStorage on mount
  useEffect(() => {
    const s = readStore();
    const now = Date.now();

    // Stale session: reset after 15 minutes of no attempts
    if (s.lastAttemptAt && now - s.lastAttemptAt > ATTEMPT_RESET) {
      writeStore({ failures: 0, lockedUntil: null, lastAttemptAt: null });
      return;
    }

    setFailures(s.failures);

    if (s.lockedUntil && s.lockedUntil > now) {
      startCountdown(s.lockedUntil);
    }

    return () => clearTimer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLocked = countdown > 0;

  const canAttempt = useCallback((): boolean => {
    const s = readStore();
    if (s.lockedUntil && s.lockedUntil > Date.now()) return false;
    return true;
  }, []);

  const onSuccess = useCallback(() => {
    clearTimer();
    setCountdown(0);
    setFailures(0);
    writeStore({ failures: 0, lockedUntil: null, lastAttemptAt: Date.now() });
  }, []);

  const onFailure = useCallback(() => {
    const s = readStore();
    const newFailures = s.failures + 1;
    const now = Date.now();

    if (newFailures >= MAX_ATTEMPTS) {
      const until = now + LOCKOUT_MS;
      const next: StoredState = { failures: newFailures, lockedUntil: until, lastAttemptAt: now };
      writeStore(next);
      setFailures(newFailures);
      startCountdown(until);
    } else {
      const next: StoredState = { failures: newFailures, lockedUntil: null, lastAttemptAt: now };
      writeStore(next);
      setFailures(newFailures);
    }
  }, [startCountdown]);

  return { countdown, isLocked, failures, canAttempt, onSuccess, onFailure };
}
