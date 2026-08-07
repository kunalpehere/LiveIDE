import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Code2,
  GitBranch,
  History,
  Play,
  ShieldCheck,
  TerminalSquare,
  Users,
} from "lucide-react";
import Link from "next/link";

const capabilities = [
  {
    icon: Users,
    title: "Edit together",
    description: "CRDT-based collaboration keeps every keystroke synchronized without merge conflicts.",
  },
  {
    icon: TerminalSquare,
    title: "Run in the browser",
    description: "WebContainers provide an isolated Node.js runtime, terminal, and live preview.",
  },
  {
    icon: History,
    title: "Restore with confidence",
    description: "Named snapshots and project history make important states easy to revisit.",
  },
];

const workspaceFiles = ["src", "  App.tsx", "  index.css", "package.json"];

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,oklch(0.65_0.2_27/0.09),transparent_28%),radial-gradient(circle_at_85%_70%,oklch(0.55_0.08_260/0.08),transparent_30%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 pb-20 pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8 lg:pb-28 lg:pt-28">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 font-mono text-xs text-muted-foreground shadow-xs">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Collaborative browser workspace
            </div>
            <h1 className="text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">
              Ship code together, directly from your browser.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-8 text-muted-foreground">
              LiveIDE brings editing, runtime previews, AI assistance, access controls,
              and version history into one focused development workspace.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="brand" size="lg" className="h-11 px-5">
                <Link href="/dashboard">
                  Open workspace
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-11 px-5">
                <Link href="#capabilities">Explore capabilities</Link>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {["No local setup", "Persistent projects", "Role-based sharing"].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-2xl">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-primary/5 blur-2xl" />
            <div className="overflow-hidden rounded-xl border bg-[#0d0f13] shadow-2xl shadow-black/20">
              <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="size-2.5 rounded-full bg-[#febc2e]" />
                  <span className="size-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="font-mono text-[11px] text-zinc-500">liveide / team-dashboard</span>
                <div className="flex -space-x-1.5">
                  <span className="grid size-6 place-items-center rounded-full border-2 border-[#0d0f13] bg-indigo-500 text-[9px] font-medium text-white">AM</span>
                  <span className="grid size-6 place-items-center rounded-full border-2 border-[#0d0f13] bg-emerald-600 text-[9px] font-medium text-white">JL</span>
                </div>
              </div>
              <div className="grid min-h-[390px] grid-cols-[130px_1fr] sm:grid-cols-[170px_1fr]">
                <aside className="border-r border-white/10 bg-[#111318] p-3 font-mono text-xs text-zinc-500">
                  <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                    Explorer <Code2 className="size-3" />
                  </div>
                  {workspaceFiles.map((file, index) => (
                    <div key={file} className={`rounded px-2 py-1.5 ${index === 1 ? "bg-white/8 text-zinc-200" : ""}`}>
                      {file}
                    </div>
                  ))}
                </aside>
                <div className="relative min-w-0">
                  <div className="flex h-9 items-center border-b border-white/10 bg-[#111318] px-3 font-mono text-[11px] text-zinc-300">
                    App.tsx <span className="ml-2 size-1.5 rounded-full bg-primary" />
                  </div>
                  <div className="overflow-hidden p-4 font-mono text-[11px] leading-6 text-zinc-400 sm:p-5 sm:text-xs">
                    <p><span className="text-fuchsia-400">export default function</span> <span className="text-sky-300">Dashboard</span>() {'{'}</p>
                    <p className="pl-4"><span className="text-fuchsia-400">const</span> team = <span className="text-amber-300">usePresence</span>();</p>
                    <p className="pl-4"><span className="text-fuchsia-400">return</span> (</p>
                    <p className="pl-8 text-zinc-300">&lt;<span className="text-rose-400">Workspace</span></p>
                    <p className="pl-12"><span className="text-sky-300">project</span>=<span className="text-emerald-300">&quot;team-dashboard&quot;</span></p>
                    <p className="pl-12"><span className="text-sky-300">collaborators</span>=&#123;team&#125;</p>
                    <p className="pl-12"><span className="text-sky-300">preview</span>=&#123;<span className="text-amber-300">true</span>&#125;</p>
                    <p className="pl-8 text-zinc-300">/&gt;</p>
                    <p className="pl-4">);</p>
                    <p>{'}'}</p>
                  </div>
                  <div className="absolute bottom-0 hidden w-full border-t border-white/10 bg-[#111318] px-4 py-2 font-mono text-[10px] text-zinc-500 sm:flex sm:items-center sm:gap-4">
                    <span className="inline-flex items-center gap-1 text-emerald-400"><GitBranch className="size-3" /> main</span>
                    <span>TypeScript</span>
                    <span className="ml-auto inline-flex items-center gap-1"><Users className="size-3" /> 2 online</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="scroll-mt-20 border-b bg-card/40 py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">Built for real workflows</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Everything around the editor matters.</h2>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">A practical workspace needs execution, coordination, and recovery—not just a text area.</p>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <article key={title} className="bg-background p-7 lg:p-8">
                <div className="mb-5 grid size-10 place-items-center rounded-lg border bg-muted/50">
                  <Icon className="size-5 text-primary" />
                </div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="architecture" className="py-20 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:px-8">
          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">Engineering foundation</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Designed beyond the demo.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">Authentication, authorization, persistence, input validation, and recovery are part of the product—not interview talking points.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [ShieldCheck, "Role-based access", "Owner, editor, and viewer permissions"],
              [Bot, "Controlled AI gateway", "Validation, quotas, timeouts, and provider configuration"],
              [Clock3, "Persistent history", "Snapshots, audit events, and revisioned rooms"],
              [Play, "Isolated execution", "WebContainer lifecycle and live application previews"],
            ].map(([Icon, title, description]) => {
              const FeatureIcon = Icon as typeof ShieldCheck;
              return (
                <div key={title as string} className="flex gap-4 rounded-lg border bg-card p-5">
                  <FeatureIcon className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div><h3 className="text-sm font-medium">{title as string}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{description as string}</p></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
