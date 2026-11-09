#!/usr/bin/env bash
# Runs every Kapa test: strategy engine, Premium server, Netlify adapter, then the browser suites
# against a production build served on localhost:8770 with a fake Deriv. Usage: bash qa/run-all.sh
set -u
cd "$(dirname "$0")/.."
ROOT=$PWD
(cd server && node bundle.mjs >/dev/null)
cp server/dist/kapa-premium-worker.js qa/server/worker.mjs
cp server/dist/kapa-premium-worker.js qa/browser/worker.mjs
echo '== strategy engine'; node qa/server/strategy.test.mjs 2>/dev/null | grep -E 'FAIL|ALL'
echo '== premium server'; (cd qa/server && node worker.test.mjs | grep -E 'FAIL|ALL')
if [ -d node_modules/@netlify/blobs ]; then echo '== netlify adapter'; (cd qa/server && node netlify.test.mjs | grep -E 'FAIL|ALL'); else echo '== netlify adapter: skipped (npm i --no-save @netlify/blobs@11.1.4)'; fi
echo '== build'
CLIENT_ID=34QvhOYOwdiGB0X15zX0W APP_ENV=production PUBLIC_PATH=/kapa-trader/ KAPA_API_URL=https://kapa-premium.netlify.app npm run build >/tmp/kapa-build.log 2>&1 || { echo 'build failed: /tmp/kapa-build.log'; exit 1; }
cd qa/browser && mkdir -p x
node serve.js "$ROOT/dist" >/dev/null 2>&1 & SRV=$!
sleep 1
for t in premium3-nl limits lab classic ui relink drag design; do
  r=$(timeout 450 node $t.js 2>&1); echo "== $t: $(echo "$r" | grep -c '^PASS') pass, $(echo "$r" | grep -c '^FAIL') fail"; echo "$r" | grep '^FAIL'
done
r=$(MOCK_FACTOR=0.9226 timeout 300 node markup.js 2>&1); echo "== markup: $(echo "$r" | grep -c '^PASS') pass, $(echo "$r" | grep -c '^FAIL') fail"
kill $SRV
