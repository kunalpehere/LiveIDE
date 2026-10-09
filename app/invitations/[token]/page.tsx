import Link from "next/link";
import { currentUser } from "@/features/auth/actions";
import { inspectPlaygroundInvitation } from "@/features/playground/actions/invitations";
import { AcceptInvitation } from "@/features/playground/components/accept-invitation";
import { invitationTokenSchema } from "@/features/playground/lib/invitations";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await currentUser();
  const valid = invitationTokenSchema.safeParse(token).success;
  const result = valid && user?.id ? await inspectPlaygroundInvitation(token) : null;
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
    <h1 className="text-2xl font-semibold">Project invitation</h1>
    {!valid ? <p>Invalid invitation link.</p> : !user?.id ? <>
      <p>Sign in to review and accept this invitation. Opening this link does not grant access.</p>
      <Link className="underline" href={`/auth/sign-in?returnTo=${encodeURIComponent(`/invitations/${token}`)}`}>Sign in to continue</Link>
    </> : result?.success ? <>
      <h2 className="text-xl">{result.data.title}</h2>
      <p>This invitation grants {result.data.role === "EDITOR" ? "Editor access to change code" : "Viewer access to read code"}.</p>
      <p className="text-sm text-muted-foreground">Expires {result.data.expiresAt.toISOString()}. Signed in as {user.email || user.name}.</p>
      {result.data.state === "PENDING" ? <AcceptInvitation token={token} /> : <p role="status">This invitation is {result.data.state.toLowerCase()}. Ask the owner for a new link.</p>}
    </> : <p role="status">{result && !result.success ? result.message : "Invitation unavailable"}</p>}
    <Link className="text-sm underline" href="/dashboard">Go to dashboard</Link>
  </main>;
}
