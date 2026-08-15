import { execFileSync } from "node:child_process";

export function repositoryFiles(root, pathspecs = []) {
  const args = ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
  if (pathspecs.length) args.push("--", ...pathspecs);
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.startsWith(".local-backups/") && !path.startsWith("demo-files/"));
}
