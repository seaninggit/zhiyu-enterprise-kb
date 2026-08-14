#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ "${ZHIYU_DEPLOY_CONFIRM:-}" != "DEPLOY_ACCEPTED_BUILD" ]]; then
  echo "拒绝部署：请在全部验收通过后显式设置 ZHIYU_DEPLOY_CONFIRM=DEPLOY_ACCEPTED_BUILD。" >&2
  exit 1
fi

echo "1/3 发布门禁..."
npm run harness:release
echo "2/3 核对生产配置..."
npx wrangler deploy --config wrangler.production.jsonc --dry-run --outdir outputs/deploy-dry-run
echo "3/3 部署已验收构建..."
npx wrangler deploy --config wrangler.production.jsonc
