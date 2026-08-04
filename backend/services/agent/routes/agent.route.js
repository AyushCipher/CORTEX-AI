import express from "express";
import { chat, chatStream } from "../controllers/agent.controller.js";
import multer from "../config/multer.js";
import { validate } from "../../../shared/validation/validate.js";
import { chatSchema } from "../validators/agent.validators.js";

const router = express.Router();

router.post("/chat", multer.single("file"), validate(chatSchema), chat);

router.post("/chat/stream", multer.single("file"), validate(chatSchema), chatStream);

export default router;
