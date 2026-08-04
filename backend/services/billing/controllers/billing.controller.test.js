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
const { verifyPayment } = await import("./billing.controller.js");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/verify-payment", verifyPayment);
  return app;
};

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
