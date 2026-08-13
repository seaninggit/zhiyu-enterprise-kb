const UPSTREAM = "https://zhiyu-kb.pages.dev";
const SAFE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const DROP_HEADERS = [
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
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
];

const worker = {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, UPSTREAM);
    const headers = new Headers(request.headers);

    for (const name of DROP_HEADERS) headers.delete(name);
    headers.set("user-agent", SAFE_USER_AGENT);
    headers.set("accept-language", "zh-CN,zh;q=0.9,en;q=0.7");
    if (headers.has("origin")) headers.set("origin", UPSTREAM);
    if (headers.has("referer")) headers.set("referer", `${UPSTREAM}/`);

    const upstream = await fetch(new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    }));

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control", "private, no-store");
    responseHeaders.set("x-zhiyu-public-gateway", "worker-v1");
    const location = responseHeaders.get("location");
    if (location?.startsWith(UPSTREAM)) {
      responseHeaders.set("location", `${incomingUrl.origin}${location.slice(UPSTREAM.length)}`);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};

export default worker;
