import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";

const AddRepo = () => (
  <Button variant="outline" disabled title="GitHub import is planned but not implemented yet">
    <Github />
    Import repository
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Soon</span>
  </Button>
);

export default AddRepo;
