import { auth } from "@/auth";
import { connectionStatus, disconnectConnection } from "@/lib/github/connection";
import { json, sameOrigin } from "@/lib/github/http";

export const runtime = "nodejs";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Sign in to manage GitHub." }, 401);
  try { return json(await connectionStatus(session.user.id)); }
  catch { return json({ error: "Could not read GitHub connection. Please retry." }, 503); }
}
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Sign in to manage GitHub." }, 401);
  // Disconnect must still work if provider configuration is removed.
  const configuredOrigin = process.env.GITHUB_CONNECTION_ORIGIN;
  if (!(sameOrigin(request) || (configuredOrigin && request.headers.get("origin") === configuredOrigin && new URL(request.url).origin === configuredOrigin))) return json({ error: "Invalid request origin." }, 403);
  try { return json({ state: "disconnected", ...await disconnectConnection(session.user.id) }); }
  catch { return json({ error: "Could not disconnect GitHub. Please retry." }, 503); }
}
