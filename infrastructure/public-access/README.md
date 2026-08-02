# Public access gateway

This Cloudflare Pages Worker provides a stable public entry point for the
knowledge platform while the primary application remains on its managed Sites
runtime. Authentication, row-level authorization, D1, R2, and AI execution stay
inside the primary application. Anonymous requests receive an isolated external
employee session. Each session has its own account, uploads, favorites, and AI
conversation history. Normal server-side role and department policies still
control every operation.

The gateway stores only a random browser session cookie. Credentials, business
data, files, and conversations remain in the primary application.

`worker-entry.js` is a second public edge entry used when an embedded mobile
browser cannot reach the managed Sites domain. It strips client network and
internal identity headers before forwarding to the Pages gateway.
