import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { GitHubCommitPanel } from "@/features/github/components/commit-panel";
import { db } from "@/lib/db";

export default async function GitHubChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/sign-in");
  const { id } = await params;
  const project = await db.playground.findUnique({ where: { id } });
  if (!project || project.userId !== session.user.id) redirect("/dashboard");
  return <main className="mx-auto w-full max-w-6xl space-y-6 p-6"><GitHubCommitPanel projectId={id} title={project.title} /></main>;
}
