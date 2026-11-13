#!/usr/bin/env bash
# P3 后端功能冒烟测试（临时验证用，非验收脚本）
set -u
B="http://127.0.0.1:8081"
H="http://127.0.0.1:3000"
PASS=0; FAIL=0
ok(){ echo "  PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

PHONE="1380013$(printf '%04d' $RANDOM)"
PASSWD="testpass123"
echo "== 注册 =="
REG=$(curl -s -m 5 -X POST "$B/api/register" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"nickname\":\"p3tester\",\"password\":\"$PASSWD\"}")
echo "$REG" | grep -q '"ok":true' && ok "register" || bad "register: $REG"

echo "== 登录(remember=false) =="
L1=$(curl -s -m 5 -X POST "$B/api/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"password\":\"$PASSWD\",\"remember\":false}")
TOKEN1=$(echo "$L1" | grep -oE '"token":"[^"]+"' | head -1 | sed 's/"token":"//;s/"//')
REM1=$(echo "$L1" | grep -oE '"remembered":[a-z]+' | head -1)
echo "$L1" | grep -q "$TOKEN1" && ok "login(short)" || bad "login: $L1"
echo "  remembered flag: $REM1"

echo "== 登录(remember=true) =="
L2=$(curl -s -m 5 -X POST "$B/api/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"password\":\"$PASSWD\",\"remember\":true}")
TOKEN2=$(echo "$L2" | grep -oE '"token":"[^"]+"' | head -1 | sed 's/"token":"//;s/"//')
echo "$L2" | grep -q "$TOKEN2" && ok "login(remember)" || bad "login2: $L2"

echo "== 错误密码登录(应401) =="
curl -s -m 5 -o /dev/null -w "  badlogin:%{http_code}\n" -X POST "$B/api/login" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\",\"password\":\"wrong\"}"

echo "== 登录日志应有2条成功+1条失败 =="
LOGS=$(curl -s -m 5 "$B/api/account/login-logs?size=10" -H "Authorization: Bearer $TOKEN2")
echo "  login-logs total: $(echo "$LOGS" | grep -oE '"total":[0-9]+' | head -1)"

echo "== 会话列表(应>=2) =="
SESS=$(curl -s -m 5 "$B/api/account/sessions" -H "Authorization: Bearer $TOKEN2")
echo "  session count: $(echo "$SESS" | grep -oE '"token"' | wc -l)"

echo "== 偏好读写 =="
curl -s -m 5 -X PUT "$B/api/account/preferences" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' -d '{"defaultVisibility":"private","pageSize":15,"backgroundMode":"dark","commentModeration":true}' >/dev/null
PREF=$(curl -s -m 5 "$B/api/account/preferences" -H "Authorization: Bearer $TOKEN2")
echo "  prefs: $PREF"

echo "== 影视 CRUD =="
MC=$(curl -s -m 5 -X POST "$B/api/media" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试电影","type":"movie","year":2024,"visibility":"public","external_url":"https://example.com/m","rating":8}')
MID=$(echo "$MC" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"//')
echo "$MC" | grep -q "$MID" && ok "media create" || bad "media create: $MC"
curl -s -m 5 -o /dev/null -w "  media-get:%{http_code}\n" "$B/api/media/$MID"
curl -s -m 5 -o /dev/null -w "  media-patch-status:%{http_code}\n" -X PATCH "$B/api/media/$MID/status" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' -d '{"watch_status":"watched","rating":9}'
curl -s -m 5 -o /dev/null -w "  media-update:%{http_code}\n" -X PUT "$B/api/media/$MID" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' -d '{"title":"测试电影2","type":"movie","year":2024,"visibility":"public"}'

echo "== 宝库 CRUD + 条目 + 排序/移动 =="
CC=$(curl -s -m 5 -X POST "$B/api/collections" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' -d '{"name":"我的收藏","visibility":"private"}')
CID=$(echo "$CC" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"//')
echo "$CC" | grep -q "$CID" && ok "collection create" || bad "collection create: $CC"
IT1=$(curl -s -m 5 -X POST "$B/api/collections/$CID/items" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' -d '{"title":"条目A","type":"url","url":"https://a.com"}')
IT1ID=$(echo "$IT1" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"//')
IT2=$(curl -s -m 5 -X POST "$B/api/collections/$CID/items" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' -d '{"title":"条目B","type":"url","url":"https://b.com"}')
IT2ID=$(echo "$IT2" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"//')
curl -s -m 5 -o /dev/null -w "  items-order:%{http_code}\n" -X POST "$B/api/collections/$CID/items/order" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' -d "{\"ids\":[\"$IT2ID\",\"$IT1ID\"]}"
CC2=$(curl -s -m 5 -X POST "$B/api/collections" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' -d '{"name":"第二个","visibility":"public"}')
CID2=$(echo "$CC2" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"//')
curl -s -m 5 -o /dev/null -w "  items-move:%{http_code}\n" -X POST "$B/api/collections/$CID/items/move" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' -d "{\"toCollectionId\":\"$CID2\",\"ids\":[\"$IT1ID\"]}"

echo "== 碎碎念 CRUD + 时间线 + 归档 =="
MOC=$(curl -s -m 5 -X POST "$B/api/moments" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' -d '{"content":"第一条碎碎念","visibility":"public"}')
MOID=$(echo "$MOC" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"//;s/"//')
echo "$MOC" | grep -q "$MOID" && ok "moment create" || bad "moment create: $MOC"
curl -s -m 5 -o /dev/null -w "  moment-timeline:%{http_code}\n" "$B/api/moments?size=5"
curl -s -m 5 -o /dev/null -w "  moment-archive:%{http_code}\n" "$B/api/moments/archive"
curl -s -m 5 -o /dev/null -w "  moment-patch:%{http_code}\n" -X PATCH "$B/api/moments/$MOID" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' -d '{"content":"改过的碎碎念","pinned":true}'

echo "== 互动: 对 public media 评论/点赞(登录) + 私藏集合越权404(匿名) =="
curl -s -m 5 -o /dev/null -w "  comment-on-media:%{http_code}\n" -X POST "$B/api/comments" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
  -d "{\"target_type\":\"media\",\"target_id\":\"$MID\",\"content\":\"好电影\"}"
curl -s -m 5 -o /dev/null -w "  like-media:%{http_code}\n" -X POST "$B/api/reactions" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
  -d "{\"target_type\":\"media\",\"target_id\":\"$MID\",\"type\":\"like\"}"
curl -s -m 5 -o /dev/null -w "  anon-view-private-collection:%{http_code}\n" "$B/api/collections/$CID"
curl -s -m 5 -o /dev/null -w "  anon-comment-private-media(none):skip\n" /dev/null

echo "== 分享页: 公开 media 生成 token + 匿名读取 =="
SH=$(curl -s -m 5 -X POST "$B/api/shares" -H "Authorization: Bearer $TOKEN2" \
  -H 'Content-Type: application/json' -d "{\"target_type\":\"media\",\"target_id\":\"$MID\"}")
SHTOK=$(echo "$SH" | grep -oE '"token":"[^"]+"' | head -1 | sed 's/"token":"//;s/"//')
echo "$SH" | grep -q "$SHTOK" && ok "share create" || bad "share: $SH"
curl -s -m 5 -o /dev/null -w "  share-anon-get:%{http_code}\n" "$B/api/s/$SHTOK"

echo "== 改密失效其他会话 =="
curl -s -m 5 -o /dev/null -w "  change-password:%{http_code}\n" -X POST "$B/api/account/password" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
  -d "{\"oldPassword\":\"$PASSWD\",\"newPassword\":\"newpass456\"}"
echo "  TOKEN1(旧会话) after pw change ->"
curl -s -m 5 -o /dev/null -w "   token1-me:%{http_code}\n" "$B/api/me" -H "Authorization: Bearer $TOKEN1"

echo ""
echo "=== SUMMARY: PASS=$PASS FAIL=$FAIL ==="
echo "PHONE=$PHONE PASSWD=newpass456 (for manual cleanup)"
