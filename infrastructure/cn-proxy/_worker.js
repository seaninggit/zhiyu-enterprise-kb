/**
 * 知域 · China Access Proxy
 *
 * 反向代理到主应用后端，绑定自定义域名后即可从国内直连访问。
 * 保持与原 public-access gateway 相同的会话隔离和头清理逻辑。
 */

const UPSTREAM = "https://zhiyu-enterprise-knowledge-hub.yangshan-ai-flow.workers.dev";
const SESSION_COOKIE = "zhiyu_cn_session";

// 国内入口会剥离外网身份信息，统一由上游重新鉴权
const DROP_REQUEST_HEADERS = [
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "cf-ew-via",
  "cdn-loop",
  "true-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "x-forwarded-host",
  "x-forwarded-proto",
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
];

function sessionId(cookieHeader) {
  const match = cookieHeader?.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]{32})`, "i"),
  );
  if (match) return match[1].toLowerCase();
  return crypto.randomUUID().replaceAll("-", "");
}

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, UPSTREAM);

    const headers = new Headers(request.headers);
    for (const name of DROP_REQUEST_HEADERS) headers.delete(name);

    // 维持国内入口的独立会话，避免与上游身份 Cookie 混淆
    const cookie = headers.get("cookie") ?? "";
    const sid = sessionId(cookie);
    headers.set(
      "cookie",
      `${cookie ? `${cookie}; ` : ""}${SESSION_COOKIE}=${sid}`,
    );
    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", "https");
    headers.set("x-zhiyu-cn-proxy", "1");

    const upstream = await fetch(new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
      redirect: "manual",
    }));

    const responseHeaders = new Headers(upstream.headers);
    // 不暴露上游 Set-Cookie，统一用国内入口会话
    responseHeaders.delete("set-cookie");
    responseHeaders.append(
      "set-cookie",
      `${SESSION_COOKIE}=${sid}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
    );

    // 重写重定向地址中的上游域名
    const location = responseHeaders.get("location");
    if (location) {
      if (location.startsWith(UPSTREAM)) {
        responseHeaders.set("location", incomingUrl.origin + location.slice(UPSTREAM.length));
      }
    }

    responseHeaders.set("x-zhiyu-proxy", "cn-v1");
    // 禁止上游缓存把国内域名泄漏出去
    responseHeaders.set("cache-control", "private, no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
