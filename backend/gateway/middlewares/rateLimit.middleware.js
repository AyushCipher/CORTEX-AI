import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redis from "../../shared/redis/redis.js";

/**
 * Creates a rate limiter middleware backed by Redis.
 */
export const createRateLimiter = ({
  windowMs = 60 * 1000,
  max = 100,
  message = "Too many requests. Please try again later.",
  prefix = "rl:gw:default:"
} = {}) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix
    }),
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message
      });
    }
  });
};

/**
 * Global rate limiter across all gateway routes.
 * 120 requests per minute per IP.
 */
export const gatewayGlobalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  prefix: "rl:gw:global:",
  message: "Too many requests from this IP. Please slow down."
});

/**
 * Agent proxy route limiter.
 * 30 requests per minute per IP/client for heavy AI operations.
 */
export const agentRouteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  prefix: "rl:gw:agent:",
  message: "Too many agent generation requests. Please slow down."
});

/**
 * Auth login rate limiter to guard against brute-force attacks.
 * 20 attempts per 15 minutes per IP.
 */
export const authLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  prefix: "rl:gw:auth:",
  message: "Too many login attempts. Please try again in 15 minutes."
});
