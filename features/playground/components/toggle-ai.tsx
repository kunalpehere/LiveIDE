"use client";

import { useState } from "react";
import { Bot, FileText, Loader2, Power, PowerOff } from "lucide-react";
import { AIChatSidePanel } from "@/features/ai-chat/components/ai-chat-sidepanel";
import type { AIAvailability } from "@/features/playground/hooks/useAISuggestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ToggleAIProps {
  playgroundId: string;
  isEnabled: boolean;
  onToggle: () => void;
  suggestionLoading: boolean;
  availability: AIAvailability;
  error: string | null;
  provider: string | null;
  model: string | null;
}

const statusLabel: Record<AIAvailability, string> = {
  checking: "Checking",
  ready: "Ready",
  "not-configured": "Not configured",
  unavailable: "Unavailable",
};

const ToggleAI = ({ playgroundId, isEnabled, onToggle, suggestionLoading, availability, error, provider, model }: ToggleAIProps) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const providerReady = availability === "ready";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant={isEnabled ? "default" : "outline"} className="h-8 gap-2 px-3 text-sm">
            {suggestionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            <span>AI</span>
            <span className={cn("h-2 w-2 rounded-full", isEnabled ? "bg-emerald-500" : providerReady ? "bg-zinc-400" : "bg-amber-500")} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="flex items-center justify-between py-2">
            <span className="flex items-center gap-2"><Bot className="h-4 w-4" />AI tools</span>
            <Badge variant="outline">{isEnabled ? "Enabled" : statusLabel[availability]}</Badge>
          </DropdownMenuLabel>
          <div className="space-y-1 px-2 pb-2 text-xs text-muted-foreground">
            <p>Inline completions run only when you press Ctrl+Space.</p>
            {provider && model && <p>{provider} · {model}</p>}
            {error && <p className="text-amber-600 dark:text-amber-400">{error}</p>}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onToggle} disabled={!providerReady} className="cursor-pointer py-2.5">
            <div className="flex items-center gap-3">
              {isEnabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
              <div><div className="text-sm font-medium">{isEnabled ? "Disable" : "Enable"} inline completions</div>
                <div className="text-xs text-muted-foreground">Manual, editor-aware suggestions</div></div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsChatOpen(true)} disabled={!providerReady} className="cursor-pointer py-2.5">
            <div className="flex items-center gap-3"><FileText className="h-4 w-4" />
              <div><div className="text-sm font-medium">Open AI chat</div>
                <div className="text-xs text-muted-foreground">Separate from inline completions</div></div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AIChatSidePanel playgroundId={playgroundId} isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} theme="dark" />
    </>
  );
};

export default ToggleAI;
