import express from "express";
import cors from "cors";
import helmet from "helmet";
import connectDB from "./config/db.js";
import dotenv from "dotenv";
import router from "./routes/billing.routes.js";
import { createLogger } from "../../shared/logger/logger.js";
import { createHttpLogger } from "../../shared/logger/httpLogger.js";
dotenv.config();
const port = process.env.PORT;
const app = express();

const logger = createLogger("billing");

app.use(express.json());

app.use(helmet());

app.use(createHttpLogger(logger));
app.use("/", router);

app.get("/", (req, res) => {
  res.json({
    success: true,

    message: "Billing Service Running"
  });
});

app.listen(port, () => {
  connectDB();
  logger.info(`billing service running on ${port}`);
});
