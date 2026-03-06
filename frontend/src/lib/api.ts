const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
  });

  if (!res.ok) {
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const data = await res.json();
      throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
    }
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }

  return res.json();
}
