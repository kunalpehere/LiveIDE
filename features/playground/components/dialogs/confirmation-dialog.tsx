import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  setIsOpen: (open: boolean) => void;
  isPending?: boolean;
}

export function ConfirmationDialog({
  isOpen, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel",
  onConfirm, onCancel, setIsOpen, isPending = false,
}: ConfirmationDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!isPending) setIsOpen(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={onCancel}>{cancelLabel}</Button>
          <Button disabled={isPending} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
