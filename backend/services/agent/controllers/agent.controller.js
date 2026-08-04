import redis from "../../../shared/redis/redis.js";
import { graph } from "../graph/supervisor.graph.js";
import { addMessage } from "../utils/memory.js";
import axios from "axios";

export const chat = async (req, res, next) => {
  try {
    const {
      prompt,

      conversationId,

      agent
    } = req.body;

    await addMessage(conversationId, "user", prompt);

    await axios.post(`${process.env.CHAT_SERVICE}/save-message`, {
      conversationId,
      role: "user",
      content: prompt
    });

    const result = await graph.invoke({
      prompt,

      conversationId,

      userId: req.headers["x-user-id"],
      agent,
      file: req.file
    });

    await addMessage(conversationId, "assistant", result.response);
    await axios.post(`${process.env.CHAT_SERVICE}/save-message`, {
      conversationId,
      role: "assistant",
      content: result.response,
      images: result.images,
      artifacts: result.artifacts || []
    });

    return res.json({
      success: true,

      answer: result.response,
      images: result.images,
      artifacts: result.artifacts || []
    });
  } catch (error) {
    next(error);
  }
};

const sendEvent = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const chatStream = async (req, res) => {
  const { prompt, conversationId, agent } = req.body;
  const userId = req.headers["x-user-id"];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
  });

  try {
    await addMessage(conversationId, "user", prompt);

    await axios.post(`${process.env.CHAT_SERVICE}/save-message`, {
      conversationId,
      role: "user",
      content: prompt
    });

    let finalState = null;

    const stream = await graph.stream(
      {
        prompt,
        conversationId,
        userId,
        agent,
        file: req.file
      },
      { streamMode: "values" }
    );

    for await (const chunk of stream) {
      if (chunk.agent) {
        sendEvent(res, "agent", { agent: chunk.agent });
      }

      finalState = chunk;
    }

    const answer = finalState?.response || "";

    const words = answer.split(/(\s+)/).filter((part) => part.length > 0);

    for (const word of words) {
      sendEvent(res, "token", { content: word });
    }

    await addMessage(conversationId, "assistant", answer);

    await axios.post(`${process.env.CHAT_SERVICE}/save-message`, {
      conversationId,
      role: "assistant",
      content: answer,
      images: finalState?.images,
      artifacts: finalState?.artifacts || []
    });

    sendEvent(res, "done", {
      answer,
      images: finalState?.images,
      artifacts: finalState?.artifacts || []
    });
  } catch (error) {
    console.error("chatStream failed:", error);

    sendEvent(res, "error", {
      message: error.data?.message || error.message || "Something went wrong."
    });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
};
