const ORIGIN = "https://zhiyu-enterprise-kb.yangshanpm.chatgpt.site";
const SESSION_COOKIE = "zhiyu_public_session";

function sessionId(cookieHeader) {
  const current = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]{32})`, "i"),
  )?.[1];
  return current?.toLowerCase() ?? crypto.randomUUID().replaceAll("-", "");
}

const gateway = {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, ORIGIN);
    const headers = new Headers(request.headers);
    const cookie = headers.get("cookie") ?? "";
    const session = sessionId(cookie);
    headers.set(
      "cookie",
      `${cookie ? `${cookie}; ` : ""}${SESSION_COOKIE}=${session}`,
    );
    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", "https");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");

    const upstream = await fetch(new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    }));

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.append(
      "set-cookie",
      `${SESSION_COOKIE}=${session}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
    );
    const location = responseHeaders.get("location");
    if (location?.startsWith(ORIGIN)) {
      responseHeaders.set("location", `${incomingUrl.origin}${location.slice(ORIGIN.length)}`);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};

export default gateway;
