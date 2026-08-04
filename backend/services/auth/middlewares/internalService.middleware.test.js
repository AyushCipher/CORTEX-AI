import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requireInternalSecret } from "./internalService.middleware.js";

const buildRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("requireInternalSecret", () => {
  const originalSecret = process.env.INTERNAL_SERVICE_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = "test-shared-secret";
  });

  afterEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = originalSecret;
  });

  it("calls next() when the header matches the configured secret", () => {
    const req = { headers: { "x-internal-secret": "test-shared-secret" } };
    const res = buildRes();
    const next = vi.fn();

    requireInternalSecret(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects with 403 when the header is missing", () => {
    const req = { headers: {} };
    const res = buildRes();
    const next = vi.fn();

    requireInternalSecret(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects with 403 when the header does not match", () => {
    const req = { headers: { "x-internal-secret": "wrong-secret" } };
    const res = buildRes();
    const next = vi.fn();

    requireInternalSecret(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects with 500 when INTERNAL_SERVICE_SECRET is not configured", () => {
    delete process.env.INTERNAL_SERVICE_SECRET;

    const req = { headers: { "x-internal-secret": "anything" } };
    const res = buildRes();
    const next = vi.fn();

    requireInternalSecret(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("rejects a header value of different length without throwing", () => {
    const req = { headers: { "x-internal-secret": "short" } };
    const res = buildRes();
    const next = vi.fn();

    expect(() => requireInternalSecret(req, res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
