export type UploadPollStatus = "processing" | "completed" | "failed";

export function classifyUploadPollStatus(status: string): UploadPollStatus {
  if (status === "completed") return "completed";
  if (status === "processing") return "processing";
  return "failed";
}
