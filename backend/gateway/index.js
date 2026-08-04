import express from "express";
import cors from "cors";
import helmet from "helmet";
import redis from "../shared/redis/redis.js";
import dotenv from "dotenv";
import { proxyWithUser, proxyWithTrace } from "./utils/proxyWithHeaders.js";
import { protect } from "./middlewares/auth.middleware.js";
import { getCurrentUser } from "./controllers/user.controller.js";
import cookieParser from "cookie-parser";
import { createLogger } from "../shared/logger/logger.js";
import { createHttpLogger } from "../shared/logger/httpLogger.js";
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;
const logger = createLogger("gateway");
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true
  })
);
app.use("/uploads", express.static("uploads"));
app.use(helmet());
app.use(createHttpLogger(logger));
app.use(cookieParser());
app.use(express.json());
app.use("/api/auth/internal", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Not found"
  });
});
app.use("/api/auth", proxyWithTrace(process.env.AUTH_SERVICE));
app.use("/api/me", protect, getCurrentUser);
app.use("/api/chat", protect, proxyWithUser(process.env.CHAT_SERVICE));
app.use("/api/agent", protect, proxyWithUser(process.env.AGENT_SERVICE));
app.use("/api/billing", protect, proxyWithUser(process.env.BILLING_SERVICE));

app.get("/", (req, res) => {
  res.status(200).json({
    service: "gateway",
    status: "ok"
  });
});

app.listen(port, () => {
  logger.info(`Gateway running on ${port}`);
});
