"use client";

import TemplateSelectionModal from "@/components/modal/template-selector-modal";
import { Button } from "@/components/ui/button";
import { createPlayground } from "@/features/playground/actions";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const AddNewButton = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();

  const handleSubmit = async (data: {
    title: string;
    template: "REACT" | "NEXTJS" | "EXPRESS" | "VUE" | "HONO" | "ANGULAR";
    description?: string;
  }) => {
    try {
      const result = await createPlayground(data);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("Project created");
      setIsModalOpen(false);
      router.push(`/playground/${result.data.id}`);
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error("Failed to create project. Check the details and try again.");
    }
  };

  return (
    <>
      <Button variant="brand" onClick={() => setIsModalOpen(true)}>
        <Plus />
        Create project
      </Button>
      <TemplateSelectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </>
  );
};

export default AddNewButton;
