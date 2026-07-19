import { describe, expect, it } from "vitest";
import { classifyUploadPollStatus, reviewHandoffUrl } from "@/lib/csv-upload-state";

describe("classifyUploadPollStatus", () => {
  it("never interprets idle as completion", () => {
    expect(classifyUploadPollStatus("idle")).toBe("failed");
    expect(classifyUploadPollStatus("not_found")).toBe("failed");
  });

  it("only reports explicit completion", () => {
    expect(classifyUploadPollStatus("processing")).toBe("processing");
    expect(classifyUploadPollStatus("completed")).toBe("completed");
  });

  it("hands completed imports to the created review or recovery state", () => {
    expect(reviewHandoffUrl({ review_id: 42 }, "job-1")).toBe("/review?review=42");
    expect(reviewHandoffUrl({ review_creation: { status: "failed" } }, "job-2"))
      .toBe("/review?job=job-2");
  });
});
