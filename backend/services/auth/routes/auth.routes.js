import express from "express";

import {
  deductCredits,
  login,
  logout,
  updatePlan
} from "../controllers/auth.controllers.js";
import { requireInternalSecret } from "../middlewares/internalService.middleware.js";
import { validate } from "../../../shared/validation/validate.js";
import {
  loginSchema,
  updatePlanSchema,
  deductCreditsSchema
} from "../validators/auth.validators.js";

const router = express.Router();

router.post("/login", validate(loginSchema), login);
router.get("/logout", logout);
router.patch(
  "/internal/update-plan",
  requireInternalSecret,
  validate(updatePlanSchema),
  updatePlan
);
router.patch(
  "/internal/deduct-credits",

  requireInternalSecret,

  validate(deductCreditsSchema),

  deductCredits
);

export default router;
