import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

import * as Sentry from "@sentry/react";
import { createSwUpdateChecker } from "./swUpdate";

type FakeReg = {
  scope: string;
  active: { state: string } | null;
  waiting: { state: string } | null;
  installing: { state: string } | null;
  update: ReturnType<typeof vi.fn>;
};

function mockServiceWorker(getRegistration: () => Promise<FakeReg | undefined>) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(getRegistration) },
  });
}

function makeReg(overrides: Partial<FakeReg> = {}): FakeReg {
  return {
    scope: "https://example.test/",
    active: { state: "activated" },
    waiting: null,
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createSwUpdateChecker", () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  it("calls update() when the registration has a worker", async () => {
    const reg = makeReg();
    mockServiceWorker(async () => reg);
    await createSwUpdateChecker()();
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("skips update() when the registration has no worker", async () => {
    const reg = makeReg({ active: null });
    mockServiceWorker(async () => reg);
    await createSwUpdateChecker()();
    expect(reg.update).not.toHaveBeenCalled();
  });

  it("skips when there is no registration", async () => {
    mockServiceWorker(async () => undefined);
    await expect(createSwUpdateChecker()()).resolves.toBeUndefined();
  });

  it("swallows InvalidStateError from update() without reporting", async () => {
    const reg = makeReg({
      update: vi.fn().mockRejectedValue(new DOMException("The object is in an invalid state.", "InvalidStateError")),
    });
    mockServiceWorker(async () => reg);
    await expect(createSwUpdateChecker()()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports other update() errors to Sentry with context", async () => {
    const err = new TypeError("network down");
    const reg = makeReg({ update: vi.fn().mockRejectedValue(err) });
    mockServiceWorker(async () => reg);
    await expect(createSwUpdateChecker()()).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        extra: expect.objectContaining({
          workerState: expect.objectContaining({ scope: reg.scope, active: "activated" }),
        }),
      }),
    );
  });

  it("reports getRegistration() rejections", async () => {
    const err = new Error("boom");
    mockServiceWorker(() => Promise.reject(err));
    await expect(createSwUpdateChecker()()).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(err, expect.anything());
  });

  it("does not overlap concurrent checks and resets the flag afterwards", async () => {
    let resolveUpdate!: () => void;
    const reg = makeReg({
      update: vi.fn(() => new Promise<void>((r) => { resolveUpdate = r; })),
    });
    mockServiceWorker(async () => reg);
    const check = createSwUpdateChecker();
    const first = check();
    const second = check();
    await second;
    await vi.waitFor(() => expect(reg.update).toHaveBeenCalledTimes(1));
    resolveUpdate();
    await first;
    reg.update.mockResolvedValue(undefined);
    await check();
    expect(reg.update).toHaveBeenCalledTimes(2);
  });
});
