import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { GitHubConnectionPanel } from "@/features/github/components/connection-panel";

export default async function GitHubConnectionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/sign-in");
  return <div className="mx-auto max-w-3xl px-6 py-10"><GitHubConnectionPanel /></div>;
}
