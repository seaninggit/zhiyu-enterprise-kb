/** Cloudflare Worker entry point for Zhiyu Enterprise Knowledge Hub. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PUBLIC_VIEWER_MODE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const publicViewer =
      env.PUBLIC_VIEWER_MODE === "true" &&
      !request.headers.get("oai-authenticated-user-email");
    const publicWriteAllowed =
      request.method === "POST" &&
      (url.pathname === "/api/search" || url.pathname === "/api/ai/ask");
    if (
      publicViewer &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !publicWriteAllowed
    ) {
      return Response.json(
        {
          success: false,
          error: {
            code: "PUBLIC_VIEWER_READ_ONLY",
            message: "当前为公开只读访问，请使用企业账号执行维护操作",
          },
        },
        { status: 403 },
      );
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
