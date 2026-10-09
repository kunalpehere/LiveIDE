import { type NextRequest } from "next/server";

import { requirePlaygroundAccess } from "@/features/playground/lib/authorization";
import { getStarterTemplate } from "@/features/playground/lib/starter-template-service";
import { playgroundIdSchema } from "@/features/playground/lib/validation";
import { templatePaths, type TemplateKey } from "@/lib/template";
import { errorDetails } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { observeRoute } from "@/lib/observe-route";

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsedId = playgroundIdSchema.safeParse(id);
  if (!parsedId.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid playground ID" } }, { status: 400 });
  }

  let playground;
  try {
    ({ playground } = await requirePlaygroundAccess(parsedId.data));
  } catch (error) {
    const details = errorDetails(error);
    logger.warn("template.access.denied", { playgroundId: parsedId.data, code: details.code });
    return Response.json(
      { error: { code: details.code, message: details.message } },
      { status: details.status },
    );
  }

  const template = playground.template as TemplateKey;
  if (!(template in templatePaths)) {
    return Response.json({ error: { code: "TEMPLATE_NOT_FOUND", message: "Invalid template" } }, { status: 404 });
  }

  try {
    const templateJson = await getStarterTemplate(template);
    return Response.json({ success: true, templateJson });
  } catch (error) {
    logger.error("template.load.failed", { template, playgroundId: parsedId.data }, error);
    return Response.json({ error: { code: "TEMPLATE_LOAD_FAILED", message: "Failed to generate template" } }, { status: 500 });
  }
}

export const GET = observeRoute("/api/template/[id]", handleGET);
