import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/toggle-theme";
import { Code2 } from "lucide-react";
import Link from "next/link";
import UserButton from "../auth/components/user-button";

const navigation = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#architecture", label: "Architecture" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="LiveIDE home">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground shadow-xs">
              <Code2 className="size-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">LiveIDE</span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex" aria-label="Main navigation">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/dashboard">Sign in</Link>
          </Button>
          <Button asChild variant="brand" size="sm">
            <Link href="/dashboard">Open workspace</Link>
          </Button>
          <div className="hidden border-l pl-2 lg:block">
            <UserButton />
          </div>
        </div>
      </div>
    </header>
  );
}
