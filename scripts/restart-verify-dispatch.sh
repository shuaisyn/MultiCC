#!/bin/bash
# One-shot: restart multicc under pm2, wait for health, then smoke-test the new
# POST /api/sessions/:id/dispatch endpoint with validation-only requests
# (placeholder target / cross-dir target / missing params) — none of them spawn
# a real worker turn.
set -u
BASE="http://127.0.0.1:3000"
SID="multicc-claude-chat-01"

sleep 20
pm2 restart multicc || { echo "PM2_RESTART_FAILED"; exit 1; }
sleep 5

for i in $(seq 1 15); do
  curl -sf -o /dev/null "$BASE/api/sessions" && break
  sleep 3
done
curl -sf -o /dev/null "$BASE/api/sessions" || { echo "SERVER_NOT_HEALTHY"; exit 1; }

NEWPID=$(pm2 jlist | python3 -c "import json,sys; print([p['pid'] for p in json.load(sys.stdin) if p['name']=='multicc'][0])")
PPID_OF_NEW=$(ps -p "$NEWPID" -o ppid= | tr -d ' ')
echo "restarted ok: new pid=$NEWPID ppid=$PPID_OF_NEW"

echo "--- check1 占位符 target 应被拒(400) ---"
curl -s -X POST "$BASE/api/sessions/$SID/dispatch" -H 'Content-Type: application/json' \
  -d '{"target":"SESSION_ID","message":"x"}'
echo

echo "--- check2 跨目录 target 应被拒(400) ---"
curl -s -X POST "$BASE/api/sessions/$SID/dispatch" -H 'Content-Type: application/json' \
  -d '{"target":"mafit-claude-chat-24-ultra-01","message":"x"}'
echo

echo "--- check3 缺参数应被拒(400) ---"
curl -s -X POST "$BASE/api/sessions/$SID/dispatch" -H 'Content-Type: application/json' -d '{}'
echo

echo "ALL_CHECKS_DONE"
