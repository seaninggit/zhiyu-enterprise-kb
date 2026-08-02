const ORIGIN = "https://zhiyu-enterprise-kb.yangshanpm.chatgpt.site";

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, ORIGIN);
    const headers = new Headers(request.headers);
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
