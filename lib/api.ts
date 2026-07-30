export type ApiSuccess<T> = { success: true; data: T; requestId: string };
export type ApiFailure = { success: false; error: { code: string; message: string }; requestId: string };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function ok<T>(data: T, requestId: string, status = 200) {
  return Response.json({ success: true, data, requestId } satisfies ApiSuccess<T>, { status });
}

export function fail(error: unknown, requestId: string) {
  const known = error instanceof ApiError ? error : new ApiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "系统异常");
  console.error(JSON.stringify({ level: "error", requestId, code: known.code, message: known.message }));
  return Response.json({ success: false, error: { code: known.code, message: known.message }, requestId } satisfies ApiFailure, { status: known.status });
}

export function requestId(request: Request) { return request.headers.get("cf-ray") ?? crypto.randomUUID(); }
export function requiredText(value: FormDataEntryValue | null, name: string, max = 200) {
  const text = String(value ?? "").trim();
  if (!text) throw new ApiError(400, "VALIDATION_ERROR", `${name}不能为空`);
  if (text.length > max) throw new ApiError(400, "VALIDATION_ERROR", `${name}长度不能超过${max}`);
  return text;
}
export function safeText(value: unknown, max = 10000) { return String(value ?? "").trim().slice(0, max); }

