# Tạo bare repo origin trong container Runtime (bug add = a - b)
docker exec ai-hub-dev-runtime sh -c '
set -e
mkdir -p /tmp/pc2-origin && cd /tmp/pc2-origin && rm -rf app.git seed && git init -q --bare -b main app.git
git init -q -b main seed && cd seed && git config user.email u@x && git config user.name uat
mkdir -p src test
printf "export function add(a: number, b: number): number {\n  return a - b;\n}\n" > src/calc.ts
printf "import { expect, test } from \"bun:test\";\nimport { add } from \"../src/calc\";\ntest(\"add\", () => { expect(add(2, 3)).toBe(5); });\n" > test/calc.test.ts
printf "{\"name\":\"app\",\"private\":true}\n" > package.json
git add -A && git commit -qm init && git remote add origin /tmp/pc2-origin/app.git && git push -q origin main
git -C /tmp/pc2-origin/app.git rev-parse main'
