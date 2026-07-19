export type UploadPollStatus = "processing" | "completed" | "failed";

export function classifyUploadPollStatus(status: string): UploadPollStatus {
  if (status === "completed") return "completed";
  if (status === "processing") return "processing";
  return "failed";
}

interface UploadReceipt {
  review_id?: number;
  review_creation?: { status?: string };
}

export function reviewHandoffUrl(receipt: UploadReceipt | undefined, jobId: string): string {
  if (receipt?.review_id) return `/review?review=${encodeURIComponent(receipt.review_id)}`;
  return `/review?job=${encodeURIComponent(jobId)}`;
}
