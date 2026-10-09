"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptPlaygroundInvitation } from "../actions/invitations";

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    setBusy(true); setError("");
    try {
      const result = await acceptPlaygroundInvitation(token);
      if (!result.success) { setError(result.message); return; }
      router.push(`/playground/${result.data.playgroundId}`);
      router.refresh();
    } catch { setError("Could not accept the invitation. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">If you are already a member, your current role will be kept.</p>
    <Button disabled={busy} onClick={() => void accept()}>{busy ? "Accepting…" : "Accept invitation"}</Button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
