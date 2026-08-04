import crypto from "crypto";

const INTERNAL_HEADER = "x-internal-secret";

const safeCompare = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
};

export const requireInternalSecret = (req, res, next) => {
  const configuredSecret = process.env.INTERNAL_SERVICE_SECRET;

  if (!configuredSecret) {
    console.error("INTERNAL_SERVICE_SECRET is not set — refusing internal request.");
    return res.status(500).json({
      success: false,
      message: "Internal service is misconfigured."
    });
  }

  const providedSecret = req.headers[INTERNAL_HEADER];

  if (!providedSecret || !safeCompare(providedSecret, configuredSecret)) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: internal endpoint."
    });
  }

  next();
};
