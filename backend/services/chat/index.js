import express from "express";
import dotenv from "dotenv";
import router from "./routes/chat.routes.js";
import connectDB from "./config/db.js";
import { createLogger } from "../../shared/logger/logger.js";
import { createHttpLogger } from "../../shared/logger/httpLogger.js";

dotenv.config();
const app = express();
const logger = createLogger("chat");
app.use(createHttpLogger(logger));
app.use(express.json());
const port = process.env.PORT;

app.use("/", router);

app.listen(port, () => {
  connectDB();
  logger.info(`chat service running on ${port}`);
});
