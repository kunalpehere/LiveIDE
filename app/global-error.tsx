"use client";

import { ErrorView } from "@/components/error-view";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en"><body>
      <ErrorView title="LiveIDE encountered an error" message="Reload the application to continue." reset={reset} />
    </body></html>
  );
}
