import proxy from "express-http-proxy";

const attachTraceId = (proxyReqOpts, srcReq) => {
  if (srcReq.id) {
    proxyReqOpts.headers["x-request-id"] = srcReq.id;
  }

  return proxyReqOpts;
};

export const proxyWithUser = (serviceUrl) => {
  return proxy(serviceUrl, {
    stream: true,

    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      attachTraceId(proxyReqOpts, srcReq);

      if (srcReq.user) {
        proxyReqOpts.headers["x-user-id"] = srcReq.user.userId;

        proxyReqOpts.headers["x-user-email"] = srcReq.user.email;
        proxyReqOpts.headers["x-user-avatar"] = srcReq.user.avatar;
      }

      return proxyReqOpts;
    }
  });
};

export const proxyWithTrace = (serviceUrl) => {
  return proxy(serviceUrl, {
    stream: true,

    proxyReqOptDecorator: (proxyReqOpts, srcReq) => attachTraceId(proxyReqOpts, srcReq)
  });
};
