"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { invalidateApiCache, useApiQuery } from "@/lib/api-cache";
import type {
  MonthlyReview,
  MonthlyReviewSummary,
  ReviewChange,
  ReviewListResponse,
  ReviewResponse,
} from "@/types/monthly-review";

function newestDraftOrFirst(reviews: MonthlyReviewSummary[]): number | null {
  return reviews.find((review) => review.status === "draft")?.id ?? reviews[0]?.id ?? null;
}

export function useMonthlyReview(requestedReviewId: number | null) {
  const listQuery = useApiQuery<ReviewListResponse>("/monthly-reviews");
  const reviews = useMemo(() => listQuery.data?.data.reviews ?? [], [listQuery.data]);
  const requestedExists = requestedReviewId !== null && reviews.some((item) => item.id === requestedReviewId);
  const [chosenId, setChosenId] = useState<number | null>(requestedReviewId);
  const activeId =
    chosenId !== null && reviews.some((item) => item.id === chosenId)
      ? chosenId
      : requestedExists
        ? requestedReviewId
        : newestDraftOrFirst(reviews);
  const detailQuery = useApiQuery<ReviewResponse>(
    activeId === null ? null : `/monthly-reviews/${activeId}`,
  );
  const [canonicalReview, setCanonicalReview] = useState<MonthlyReview | null>(null);
  const serverReview = detailQuery.data?.data.review ?? null;
  const review = canonicalReview?.id === activeId ? canonicalReview : serverReview;
  const reviewRef = useRef<MonthlyReview | null>(review);
  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

  const [pendingCount, setPendingCount] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const refreshReviewData = useCallback(async () => {
    await invalidateApiCache("/monthly-reviews");
    await listQuery.refetch();
    await detailQuery.refetch();
  }, [detailQuery, listQuery]);

  const runSerialized = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      setPendingCount((count) => count + 1);
      setError(null);
      const next = queueRef.current.then(operation, operation);
      queueRef.current = next.catch(() => undefined);
      return next.finally(() => setPendingCount((count) => count - 1));
    },
    [],
  );

  const save = useCallback(
    (change: ReviewChange) =>
      runSerialized(async () => {
        const current = reviewRef.current;
        if (!current || current.status !== "draft") throw new Error("This review is read-only");
        try {
          const response = await apiFetch<ReviewResponse>(`/monthly-reviews/${current.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: current.version, ...change }),
          });
          const saved = response.data.review;
          reviewRef.current = saved;
          setCanonicalReview(saved);
          setSaveMessage(`Saved version ${saved.version}`);
          await invalidateApiCache("/monthly-reviews");
          await listQuery.refetch();
          return saved;
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 409) {
            setCanonicalReview(null);
            await detailQuery.refetch();
            const message = "This review changed elsewhere. The latest saved version has been loaded.";
            setError(message);
            throw new Error(message);
          }
          const message = caught instanceof Error ? caught.message : "Review save failed";
          setError(message);
          throw caught;
        }
      }),
    [detailQuery, listQuery, runSerialized],
  );

  const complete = useCallback(
    () =>
      runSerialized(async () => {
        const current = reviewRef.current;
        if (!current || current.status !== "draft") throw new Error("This review is already complete");
        try {
          const response = await apiFetch<ReviewResponse>(
            `/monthly-reviews/${current.id}/complete`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ version: current.version }),
            },
          );
          const completed = response.data.review;
          reviewRef.current = completed;
          setCanonicalReview(completed);
          setSaveMessage("Review completed and frozen");
          await refreshReviewData();
          return completed;
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 409) {
            setCanonicalReview(null);
            await detailQuery.refetch();
          }
          const message = caught instanceof Error ? caught.message : "Review completion failed";
          setError(message);
          throw caught;
        }
      }),
    [detailQuery, refreshReviewData, runSerialized],
  );

  const create = useCallback(
    (sourceJobId?: string) =>
      runSerialized(async () => {
        const response = await apiFetch<ReviewResponse>("/monthly-reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sourceJobId ? { source_job_id: sourceJobId } : {}),
        });
        const created = response.data.review;
        reviewRef.current = created;
        setCanonicalReview(created);
        setChosenId(created.id);
        setSaveMessage(sourceJobId ? "Import review recovered" : "Review draft created");
        await invalidateApiCache("/monthly-reviews");
        await listQuery.refetch();
        return created;
      }),
    [listQuery, runSerialized],
  );

  const chooseReview = useCallback((id: number) => {
    if (pendingCount > 0) return false;
    setCanonicalReview(null);
    setChosenId(id);
    setError(null);
    return true;
  }, [pendingCount]);

  return useMemo(
    () => ({
      reviews,
      review,
      activeId,
      isLoading: listQuery.isLoading || (activeId !== null && detailQuery.isLoading && !review),
      listError: listQuery.error ?? detailQuery.error,
      error,
      saveMessage,
      isSaving: pendingCount > 0,
      chooseReview,
      save,
      complete,
      create,
      refreshReviewData,
    }),
    [
      reviews,
      review,
      activeId,
      listQuery.isLoading,
      listQuery.error,
      detailQuery.isLoading,
      detailQuery.error,
      error,
      saveMessage,
      pendingCount,
      chooseReview,
      save,
      complete,
      create,
      refreshReviewData,
    ],
  );
}
