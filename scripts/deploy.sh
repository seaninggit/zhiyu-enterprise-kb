#!/bin/bash
set -e
cd /Users/sean/Documents/Codex/2026-08-04/files-mentioned-by-the-user-codex/zhiyu-enterprise-kb
echo "1/3 构建..."
npm run build
echo "2/3 配置..."
rm -f .wrangler/deploy/config.json
python3 << 'PYEOF'
import json
with open('dist/server/wrangler.json') as f: c=json.load(f)
c['name']='zhiyu-enterprise-kb-prod'
c['routes']=[{'pattern':'zhiyu-kb.xyz','custom_domain':True},{'pattern':'www.zhiyu-kb.xyz','custom_domain':True}]
c['d1_databases']=[{'binding':'DB','database_name':'zhiyu-kb-prod','database_id':'e8ecf08a-f694-49a5-b8b4-91a75ea3f491'}]
c['triggers']={'crons':['0 18 * * *']}
if 'r2_buckets' in c: del c['r2_buckets']
with open('dist/server/wrangler.json','w') as f: json.dump(c,f)
PYEOF
echo "3/3 部署..."
cd dist/server && npx wrangler deploy
