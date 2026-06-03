"use client";

import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/lib/api";

type UploadStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

interface CsvUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function CsvUploadDialog({ open, onOpenChange, onComplete }: CsvUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("replace");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetState = useCallback(() => {
    setFile(null);
    setMode("replace");
    setStatus("idle");
    setProgress(0);
    setMessage("");
    setError(null);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) resetState();
      onOpenChange(v);
    },
    [onOpenChange, resetState]
  );

  const pollProgress = useCallback(() => {
    pollingRef.current = setInterval(async () => {
      try {
        const data = await apiFetch<{ status: string; percentage?: number; message?: string }>("/simple_upload_progress");

        if (data.status === "processing") {
          setProgress(data.percentage || 0);
          setMessage(data.message || "Processing...");
          setStatus("processing");
        } else if (data.status === "completed") {
          setProgress(100);
          setMessage(data.message || "Upload completed!");
          setStatus("completed");
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          onComplete();
        } else if (data.status === "failed") {
          setError(data.message || "Upload failed");
          setStatus("failed");
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
        } else if (data.status === "idle" && status === "processing") {
          // Job finished between polls
          setProgress(100);
          setMessage("Upload completed!");
          setStatus("completed");
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          onComplete();
        }
      } catch {
        // Ignore polling errors, will retry
      }
    }, 1000);
  }, [onComplete, status]);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setStatus("uploading");
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append("csv_file", file);
    formData.append("mode", mode);

    try {
      const res = await fetch("/csv-upload", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || data.message || "Upload failed");
        setStatus("failed");
        return;
      }

      // Upload started, begin polling for progress
      setStatus("processing");
      setMessage("Processing CSV...");
      pollProgress();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setStatus("failed");
    }
  }, [file, mode, pollProgress]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setStatus("idle");
    }
  }, []);

  const isActive = status === "uploading" || status === "processing";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {status === "completed" && (
            <Alert>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green align-middle mr-2" aria-hidden />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          {/* File picker */}
          <div
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border p-6 cursor-pointer hover:border-muted-foreground/50 transition-colors"
            onClick={() => !isActive && fileInputRef.current?.click()}
          >
            {file ? (
              <p className="text-sm">{file.name}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Click to select CSV file (Parqet or IBKR)
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
              disabled={isActive}
            />
          </div>

          {/* Import mode */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Import Mode</label>
            <Select
              value={mode}
              onValueChange={(v) => { if (v) setMode(v); }}
              disabled={isActive}
            >
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">Replace (update existing)</SelectItem>
                <SelectItem value="add">Add (keep existing)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Progress bar */}
          {(status === "processing" || status === "uploading") && (
            <div className="space-y-2">
              <Progress value={status === "uploading" ? null : progress} />
              <p className="text-xs text-muted-foreground text-center">
                {status === "uploading" ? "FETCHING…" : message}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {status === "completed" ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : status === "failed" ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Close</Button>
              <Button onClick={() => { setStatus("idle"); setError(null); }}>Try Again</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={isActive}>
                Cancel
              </Button>
              <Button onClick={handleUpload} disabled={!file || isActive}>
                {isActive && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber">FETCHING…</span>}
                {status === "uploading" || status === "processing" ? "FETCHING…" : "Upload"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
