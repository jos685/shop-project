import * as Sentry from "@sentry/react";

/**
 * Builds a service-worker update check that is safe to call from timers and
 * event handlers:
 *  - skips registrations that have no worker (update() would throw InvalidStateError)
 *  - never leaves a rejected promise unhandled
 *  - only silences the expected transient InvalidStateError; other errors are reported
 *  - prevents overlapping checks via an in-flight flag
 */
export function createSwUpdateChecker(): () => Promise<void> {
  let inFlight = false;

  return async function checkForSwUpdate(): Promise<void> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (inFlight) return;
    inFlight = true;

    let reg: ServiceWorkerRegistration | undefined;
    try {
      reg = await navigator.serviceWorker.getRegistration();
      const hasWorker = !!(reg && (reg.active || reg.waiting || reg.installing));
      if (!reg || !hasWorker) return;
      await reg.update();
    } catch (err) {
      if (err instanceof DOMException && err.name === "InvalidStateError") {
        console.warn("[PWA] update skipped: registration has no worker");
        return;
      }
      const workerState = {
        scope: reg?.scope,
        active: reg?.active?.state ?? null,
        waiting: reg?.waiting?.state ?? null,
        installing: reg?.installing?.state ?? null,
      };
      Sentry.captureException(err, {
        extra: { workerState, url: typeof window !== "undefined" ? window.location.href : undefined },
      });
    } finally {
      inFlight = false;
    }
  };
}
