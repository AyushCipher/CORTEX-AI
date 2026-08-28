import pino from "pino";

export const createLogger = (serviceName) =>
  pino({
    name: serviceName,
    level: process.env.LOG_LEVEL || "info",
    formatters: {
      level(label) {
        return { level: label };
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });
