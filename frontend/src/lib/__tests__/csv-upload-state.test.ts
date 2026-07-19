import { describe, expect, it } from "vitest";
import { classifyUploadPollStatus } from "@/lib/csv-upload-state";

describe("classifyUploadPollStatus", () => {
  it("never interprets idle as completion", () => {
    expect(classifyUploadPollStatus("idle")).toBe("failed");
    expect(classifyUploadPollStatus("not_found")).toBe("failed");
  });

  it("only reports explicit completion", () => {
    expect(classifyUploadPollStatus("processing")).toBe("processing");
    expect(classifyUploadPollStatus("completed")).toBe("completed");
  });
});
