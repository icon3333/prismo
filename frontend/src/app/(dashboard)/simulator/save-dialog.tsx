"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "save" | "rename";
  currentName: string | null;
  onSave: (name: string) => Promise<boolean>;
}

export function SaveDialog({
  open,
  onOpenChange,
  mode,
  currentName,
  onSave,
}: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName(mode === "rename" && currentName ? currentName : "");
      setLoading(false);
    }
  }, [open, mode, currentName]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    await onSave(trimmed);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "rename" ? "Rename Simulation" : "Save Simulation"}
          </DialogTitle>
          <DialogDescription>
            {mode === "rename"
              ? "Enter a new name for this simulation."
              : "Enter a name for the new simulation."}
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Simulation name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          autoFocus
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || loading}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {mode === "rename" ? "Rename" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
