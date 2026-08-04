import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";

process.env.RAZORPAY_KEY_SECRET = "test_secret";
process.env.RAZORPAY_KEY_ID = "test_key_id";
process.env.AUTH_SERVICE = "http://auth-service.test";
process.env.INTERNAL_SERVICE_SECRET = "shared-secret";

vi.mock("../models/payment.model.js", () => ({
  default: {
    findOne: vi.fn(),
    create: vi.fn()
  }
}));

vi.mock("axios", () => ({
  default: {
    patch: vi.fn().mockResolvedValue({ data: { success: true } })
  }
}));

vi.mock("../config/razorpay.js", () => ({
  default: {
    orders: { create: vi.fn() }
  }
}));

const Payment = (await import("../models/payment.model.js")).default;
const axios = (await import("axios")).default;
const razorpay = (await import("../config/razorpay.js")).default;
const { createOrder, verifyPayment } = await import("./billing.controller.js");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/create-order", createOrder);
  app.post("/verify-payment", verifyPayment);
  return app;
};

describe("POST /create-order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unknown plan with 400 before calling Razorpay", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/create-order")
      .send({ plan: "not-a-real-plan" });

    expect(res.status).toBe(400);
    expect(razorpay.orders.create).not.toHaveBeenCalled();
  });

  it("creates an order and persists a payment record for a valid plan", async () => {
    razorpay.orders.create.mockResolvedValue({
      id: "order_abc",
      currency: "INR"
    });
    Payment.create.mockResolvedValue({});

    const app = buildApp();

    const res = await request(app)
      .post("/create-order")
      .set("x-user-id", "user-1")
      .send({ plan: "starter" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", orderId: "order_abc", plan: "starter" })
    );
  });

  it("falls back to a readable message when Razorpay throws a plain error object with no .message", async () => {
    // The real razorpay SDK throws objects shaped like { statusCode, error: { description } },
    // not Error instances — error.message on those is undefined.
    razorpay.orders.create.mockRejectedValue({
      statusCode: 401,
      error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" }
    });

    const app = buildApp();

    const res = await request(app).post("/create-order").send({ plan: "starter" });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Authentication failed");
  });
});

describe("POST /verify-payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a forged signature with 400 and never touches the DB or auth service", async () => {
    const app = buildApp();

    const res = await request(app).post("/verify-payment").send({
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      razorpay_signature: "not-the-real-signature"
    });

    expect(res.status).toBe(400);
    expect(Payment.findOne).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
  });

  it("accepts a valid signature, marks the payment paid, and forwards the internal secret header", async () => {
    const orderId = "order_2";
    const paymentId = "pay_2";
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const paymentDoc = {
      userId: "user-1",
      plan: "pro",
      credits: 500,
      status: "created",
      save: vi.fn().mockResolvedValue(undefined)
    };
    Payment.findOne.mockResolvedValue(paymentDoc);

    const app = buildApp();

    const res = await request(app).post("/verify-payment").send({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    });

    expect(res.status).toBe(200);
    expect(paymentDoc.status).toBe("paid");
    expect(paymentDoc.save).toHaveBeenCalledOnce();
    expect(axios.patch).toHaveBeenCalledWith(
      "http://auth-service.test/internal/update-plan",
      { userId: "user-1", plan: "pro", credits: 500 },
      { headers: { "x-internal-secret": "shared-secret" } }
    );
  });

  it("returns 404 when the payment record cannot be found", async () => {
    const orderId = "order_3";
    const paymentId = "pay_3";
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    Payment.findOne.mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app).post("/verify-payment").send({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    });

    expect(res.status).toBe(404);
  });
});
