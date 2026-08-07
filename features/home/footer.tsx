import { Github } from "lucide-react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t bg-card/30">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div>
          <span className="font-medium text-foreground">LiveIDE</span>
          <span className="mx-2 text-border">/</span>
          Collaborative development in the browser.
        </div>
        <div className="flex items-center gap-5">
          <Link href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</Link>
          <Link href="#architecture" className="transition-colors hover:text-foreground">Architecture</Link>
          <Link
            href="https://github.com/kunalpehere/LiveIDE"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
            aria-label="LiveIDE on GitHub"
          >
            <Github className="size-4" />
          </Link>
        </div>
      </div>
    </footer>
  );
}
