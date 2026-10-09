import { logger } from "./logger";
import { validId } from "./observability.mjs";
import { requestContext } from "./request-context";

export function observeRoute<R extends Request, A extends unknown[]>(
  route: string, handler: (request: R, ...args: A) => Promise<Response>,
) {
  return async (request: R, ...args: A): Promise<Response> => {
    const incoming = request.headers.get("x-request-id");
    const requestId = validId(incoming) ? incoming! : crypto.randomUUID();
    return requestContext.run({ requestId }, async () => {
      const started = performance.now();
      let response: Response;
      try {
        response = await handler(request, ...args);
      } catch (error) {
        logger.error("request.exception", { route, method: request.method }, error);
        response = Response.json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed", requestId } }, { status: 500 });
      }
      // Construct a response so even handlers returning immutable headers work.
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      const result = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      const context = { route, method: request.method, httpStatus: response.status, durationMs: Math.round(performance.now() - started) };
      if (response.status >= 500) logger.error("request.failed", context);
      else if (response.status >= 400) logger.warn("request.rejected", context);
      else logger.info("request.completed", context);
      return result;
    });
  };
}
