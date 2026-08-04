import api from "../utils/axios";

export const sendPrompt = async (payload) => {
  const { data } = await api.post("/api/agent/chat", payload);
  return data;
};

const parseSSEEvent = (rawEvent) => {
  let eventName = "message";
  const dataLines = [];

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return { event: eventName, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
};

export const sendPromptStream = async (
  formData,
  { onAgent, onToken, onDone, onError, signal } = {}
) => {
  const baseURL = import.meta.env.VITE_SERVER_URL || "";

  const response = await fetch(`${baseURL}/api/agent/chat/stream`, {
    method: "POST",
    body: formData,
    credentials: "include",
    signal
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const parsed = parseSSEEvent(rawEvent);

      if (!parsed) continue;

      switch (parsed.event) {
        case "agent":
          onAgent?.(parsed.data);
          break;

        case "token":
          onToken?.(parsed.data);
          break;

        case "done":
          onDone?.(parsed.data);
          break;

        case "error":
          onError?.(parsed.data);
          break;

        default:
          break;
      }
    }
  }
};
