import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { validate } from "../../../shared/validation/validate.js";

const schema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  agent: z.enum(["chat", "coding"]).optional()
});

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/echo", validate(schema), (req, res) => {
    res.json({ success: true, body: req.body });
  });
  return app;
};

describe("shared validate() middleware", () => {
  it("passes through and normalizes a valid body", async () => {
    const app = buildApp();

    const res = await request(app).post("/echo").send({ prompt: "hello", agent: "chat" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, body: { prompt: "hello", agent: "chat" } });
  });

  it("rejects a missing required field with 400 and field-level errors", async () => {
    const app = buildApp();

    const res = await request(app).post("/echo").send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors.prompt).toBeDefined();
  });

  it("rejects a value outside the allowed enum", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/echo")
      .send({ prompt: "hello", agent: "not-a-real-agent" });

    expect(res.status).toBe(400);
    expect(res.body.errors.agent).toBeDefined();
  });
});
