import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import Link from "next/link";

const AddRepo = () => (
  <Button variant="outline" asChild>
    <Link href="/dashboard/github">
    <Github />
    Connect GitHub
    </Link>
  </Button>
);

export default AddRepo;
