"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type {
  AutoSaveStatus,
  DeployManualItem,
  SimulatorItem,
} from "@/types/simulator";

type SimulationAutosavePayload = {
  items: SimulatorItem[];
  totalAmount: number;
  deploy: {
    lumpSum: number;
    monthly: number;
    months: number;
    manualMode: boolean;
    manualItems: DeployManualItem[];
  };
};

type UseSimulationAutosaveOptions = {
  currentSimulationId: number | null;
  payload: SimulationAutosavePayload;
};

export function useSimulationAutosave({
  currentSimulationId,
  payload,
}: UseSimulationAutosaveOptions) {
  const [autoSaveStatus, setAutoSaveStatus] =
    useState<AutoSaveStatus>("idle");
  const currentSimulationIdRef = useRef<number | null>(currentSimulationId);
  const payloadRef = useRef(payload);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const errorCountRef = useRef(0);

  currentSimulationIdRef.current = currentSimulationId;
  payloadRef.current = payload;

  const saveNow = useCallback(async () => {
    const simId = currentSimulationIdRef.current;
    if (!simId) return;

    const nextPayload = payloadRef.current;
    setAutoSaveStatus("saving");

    try {
      const res = await apiFetch<{ success: boolean }>(
        `/simulator/simulations/${simId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: nextPayload.items,
            global_value_mode: "euro",
            total_amount: nextPayload.totalAmount,
            deploy_lump_sum: nextPayload.deploy.lumpSum,
            deploy_monthly: nextPayload.deploy.monthly,
            deploy_months: nextPayload.deploy.months,
            deploy_manual_mode: nextPayload.deploy.manualMode,
            deploy_manual_items: nextPayload.deploy.manualItems,
          }),
        }
      );

      if (!res.success) {
        throw new Error("save failed");
      }

      errorCountRef.current = 0;
      setAutoSaveStatus("saved");
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(
        () => setAutoSaveStatus("idle"),
        2000
      );
    } catch {
      errorCountRef.current += 1;
      setAutoSaveStatus("error");

      if (errorCountRef.current >= 3) {
        toast.error("Auto-save failed repeatedly. Check your connection.");
        errorCountRef.current = 0;
      }

      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(
        () => setAutoSaveStatus("idle"),
        4000
      );
    }
  }, []);

  const triggerAutoSave = useCallback(() => {
    if (!currentSimulationIdRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveNow, 800);
  }, [saveNow]);

  const cancelPendingAutoSave = useCallback(() => {
    clearTimeout(timerRef.current);
  }, []);

  const flushAutoSave = useCallback(async () => {
    clearTimeout(timerRef.current);
    await saveNow();
  }, [saveNow]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(statusTimerRef.current);
    };
  }, []);

  return {
    autoSaveStatus,
    setAutoSaveStatus,
    triggerAutoSave,
    cancelPendingAutoSave,
    flushAutoSave,
  };
}
