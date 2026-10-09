import { auth } from "@/auth";
import { beginConnection } from "@/lib/github/connection";
import { githubConfiguration, githubConfigured } from "@/lib/github/config";
import { json, sameOrigin, stateCookie } from "@/lib/github/http";
import { z } from "zod";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Sign in to connect GitHub." }, 401);
  if (!githubConfigured()) return json({ error: "GitHub connection is not configured." }, 503);
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const input = z.object({ access: z.enum(["public", "private"]), writeEnabled: z.boolean().default(false) }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Choose public or private repository access." }, 400);
  try {
    const result = await beginConnection(session.user.id, input.data.access, input.data.writeEnabled);
    const response = json({ url: result.url });
    response.cookies.set(stateCookie, result.state, { httpOnly: true, secure: githubConfiguration().origin.startsWith("https:"), sameSite: "lax", path: "/api/github", maxAge: 600 });
    return response;
  } catch { return json({ error: "Could not start GitHub authorization. Please retry." }, 503); }
}
