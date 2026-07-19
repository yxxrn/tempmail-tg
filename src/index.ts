import type { Env } from "./env";
import { handleApi } from "./api";
import { handleInboundEmail } from "./email_handler";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const apiRes = await handleApi(request, env);
      if (apiRes) return apiRes;
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error(e);
      return new Response("error", { status: 500 });
    }
  },

  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    try {
      await handleInboundEmail(env, message);
    } catch (e) {
      console.error("email handler error", e);
    }
  },
};
