import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

export const createHttpLogger = (logger) =>
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existingId = req.headers["x-request-id"];
      const requestId = existingId || randomUUID();
      res.setHeader("x-request-id", requestId);
      return requestId;
    },
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        userId: req.headers["x-user-id"]
      }),
      res: (res) => ({
        statusCode: res.statusCode
      })
    }
  });
