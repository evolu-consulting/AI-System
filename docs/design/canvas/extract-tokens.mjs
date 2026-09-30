// Trích token thiết kế từ các artboard .dc.html → tokens.md (chạy: node docs/design/canvas/extract-tokens.mjs)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.dc.html'));
const count = (map, key, file) => { const e = map.get(key) ?? { n: 0, files: new Set() }; e.n++; e.files.add(file.replace('.dc.html', '')); map.set(key, e); };
const colors = new Map(), sizes = new Map(), radii = new Map(), fonts = new Map(), weights = new Map(), heights = new Map();
for (const f of files) {
  const s = readFileSync(join(dir, f), 'utf8');
  for (const m of s.matchAll(/#[0-9A-Fa-f]{6}\b/g)) count(colors, m[0].toUpperCase(), f);
  for (const m of s.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) count(sizes, m[1] + 'px', f);
  for (const m of s.matchAll(/font:\s*(\d{3})?\s*(\d+)px/g)) { count(sizes, m[2] + 'px', f); if (m[1]) count(weights, m[1], f); }
  for (const m of s.matchAll(/border-radius:\s*(\d+)px/g)) count(radii, m[1] + 'px', f);
  for (const m of s.matchAll(/font-weight:\s*(\d{3})/g)) count(weights, m[1], f);
  for (const m of s.matchAll(/family=([A-Za-z+]+):/g)) count(fonts, m[1].replace(/\+/g, ' '), f);
  for (const m of s.matchAll(/(?:^|[;"\s])height:\s*(\d+)px/g)) count(heights, m[1] + 'px', f);
}
const table = (title, map, sortNum) => {
  const rows = [...map.entries()].sort((a, b) => (sortNum ? parseFloat(a[0]) - parseFloat(b[0]) : b[1].n - a[1].n));
  return `## ${title}\n\n| Giá trị | Số lần | Số artboard |\n|---|---|---|\n` + rows.map(([k, v]) => `| \`${k}\` | ${v.n} | ${v.files.size} |`).join('\n') + '\n';
};
const out = `# Tokens (sinh tự động — không sửa tay)\n\nNguồn: ${files.length} artboard trong \`docs/design/canvas/\`. Sinh bởi \`extract-tokens.mjs\`. Bảng đặt tên token (dùng cho Tailwind/shadcn) nằm ở \`tokens-map.md\`.\n\n` +
  table('Màu (hex)', colors) + '\n' + table('Font', fonts) + '\n' + table('Cỡ chữ', sizes, true) + '\n' + table('Độ đậm', weights, true) + '\n' + table('Bo góc', radii, true) + '\n' + table('Chiều cao phần tử (nút, ô nhập, hàng)', heights, true);
writeFileSync(join(dir, 'tokens.md'), out);
console.log(`tokens.md: ${colors.size} màu, ${sizes.size} cỡ chữ, ${radii.size} bo góc từ ${files.length} artboard`);
