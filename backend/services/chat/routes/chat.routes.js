import express from "express";
import {
  createConversation,
  getConversations,
  getMessages,
  saveMessage,
  updateConversation
} from "../controllers/chat.controller.js";
import { validate } from "../../../shared/validation/validate.js";
import {
  updateConversationSchema,
  saveMessageSchema,
  getMessagesParamsSchema
} from "../validators/chat.validators.js";

const router = express.Router();

router.post("/create-conversation", createConversation);
router.get("/get-conversations", getConversations);
router.post(
  "/update-conversation",
  validate(updateConversationSchema),
  updateConversation
);
router.post("/save-message", validate(saveMessageSchema), saveMessage);
router.get("/get-messages/:id", validate(getMessagesParamsSchema, "params"), getMessages);

export default router;
