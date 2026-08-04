import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";
const PUBLIC_SESSION_COOKIE = "zhiyu_public_session";
export const DEMO_ROLE_COOKIE = "zhiyu_demo_role";
const DEMO_ROLE_HEADER = "x-zhiyu-demo-role";
const PUBLIC_ACCESS_DOMAIN = "public.zhiyu.invalid";
const DEMO_ROLES = ["SUPER_ADMIN", "DEPT_ADMIN", "EMPLOYEE"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

const DEMO_ROLE_PROFILE: Record<
  DemoRole,
  { email: string; displayName: string }
> = {
  SUPER_ADMIN: {
    email: "demo.super@public.zhiyu.invalid",
    displayName: "演示超级管理员",
  },
  DEPT_ADMIN: {
    email: "demo.dept@public.zhiyu.invalid",
    displayName: "演示部门管理员",
  },
  EMPLOYEE: {
    email: "demo.employee@public.zhiyu.invalid",
    displayName: "演示普通员工",
  },
};

function publicViewerEnabled() {
  return (env as unknown as { PUBLIC_VIEWER_MODE?: string }).PUBLIC_VIEWER_MODE !== "false";
}

export function demoModeEnabled() {
  return (env as unknown as { PUBLIC_DEMO_MODE?: string }).PUBLIC_DEMO_MODE !== "false";
}

export function isPublicViewerEmail(email: string) {
  return email.toLowerCase().endsWith(`@${PUBLIC_ACCESS_DOMAIN}`);
}

export function demoRoleFromEmail(email: string): DemoRole | null {
  const lower = email.toLowerCase();
  for (const role of DEMO_ROLES) {
    if (lower === DEMO_ROLE_PROFILE[role].email) return role;
  }
  return null;
}

export function demoEmailForRole(role: DemoRole): string {
  return DEMO_ROLE_PROFILE[role].email;
}

function demoIdentityFromRole(rawRole: string | null): ChatGPTUser | null {
  if (!demoModeEnabled() || !rawRole) return null;
  const raw = rawRole.toUpperCase();
  const role = raw && (DEMO_ROLES as readonly string[]).includes(raw) ? (raw as DemoRole) : null;
  if (!role) return null;
  const profile = DEMO_ROLE_PROFILE[role];
  return {
    displayName: profile.displayName,
    email: profile.email,
    fullName: null,
  };
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!email) {
    if (!publicViewerEnabled()) return null;
    const cookie = requestHeaders.get("cookie") ?? "";
    const roleFromCookie = cookie.match(
      new RegExp(`(?:^|;\\s*)${DEMO_ROLE_COOKIE}=([A-Z_]+)`, "i"),
    )?.[1] ?? null;
    const demo = demoIdentityFromRole(
      requestHeaders.get(DEMO_ROLE_HEADER) ?? roleFromCookie,
    );
    if (demo) return demo;
    const session = cookie.match(new RegExp(`(?:^|;\\s*)${PUBLIC_SESSION_COOKIE}=([a-f0-9]{32})`, "i"))?.[1]?.toLowerCase();
    const suffix = session ?? "shared";
    return {
      displayName: session ? `外部用户 ${session.slice(0, 4).toUpperCase()}` : "外部用户",
      email: `visitor-${suffix}@${PUBLIC_ACCESS_DOMAIN}`,
      fullName: null,
    };
  }

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
