import express from "express";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import router from "./routes/agent.route.js";
import { createLogger } from "../../shared/logger/logger.js";
import { createHttpLogger } from "../../shared/logger/httpLogger.js";
dotenv.config();
const app = express();
const logger = createLogger("agent");
app.use(createHttpLogger(logger));
app.use(express.json());
const port = process.env.PORT;

app.use("/", router);

app.use((err, req, res, next) => {
  logger.error({ err }, "Unhandled request error");

  if (err.status) {
    return res.status(err.status).json(err.data);
  }

  return res.status(500).json({
    success: false,

    message: err.message || "Internal Server Error"
  });
});

app.listen(port, () => {
  connectDB();
  logger.info(`agent service running on ${port}`);
});
