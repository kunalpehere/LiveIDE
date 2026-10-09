import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { RepositoryBrowser } from "@/features/github/components/repository-browser";

export default async function GitHubRepositoriesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/sign-in");
  return <div className="mx-auto max-w-7xl px-6 py-10"><RepositoryBrowser /></div>;
}
