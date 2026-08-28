import express from "express";
import { createOrder, verifyPayment } from "../controllers/billing.controller.js";
import { validate } from "../../../shared/validation/validate.js";
import {
  createOrderSchema,
  verifyPaymentSchema
} from "../validators/billing.validators.js";

const router = express.Router();

router.post("/create-order", validate(createOrderSchema), createOrder);
router.post("/verify-payment", validate(verifyPaymentSchema), verifyPayment);

export default router;
