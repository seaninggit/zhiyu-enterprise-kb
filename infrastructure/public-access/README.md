# Public access gateway

This Cloudflare Pages Worker provides a stable public entry point for the
knowledge platform while the primary application remains on its managed Sites
runtime. Authentication, row-level authorization, D1, R2, and AI execution stay
inside the primary application. Anonymous requests are handled by the
application's read-only public viewer policy.

The gateway does not store credentials, business data, files, or conversations.
