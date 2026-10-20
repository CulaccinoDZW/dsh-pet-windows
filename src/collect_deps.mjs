// 收集 dsh-pet 运行所需的外部依赖包（@electron/get 及其依赖树），
// 复制到打包目录的 app/node_modules 下，使 app/lib/standalone.js 可独立运行。
// 用法: node collect_deps.mjs <dsh-pet包目录> <目标app目录>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const [pkgDir, appDir] = process.argv.slice(2);
if (!pkgDir || !appDir) {
  console.error("usage: node collect_deps.mjs <pkgDir> <appDir>");
  process.exit(2);
}

const require = createRequire(path.join(pkgDir, "package.json"));
const nmRoot = path.join(appDir, "node_modules");
const done = new Set();
const copied = [];

function pkgRootOf(entryOrDir) {
  let cur = entryOrDir;
  if (!fs.existsSync(cur)) return null;
  const st = fs.statSync(cur);
  if (!st.isDirectory()) cur = path.dirname(cur);
  for (;;) {
    const pj = path.join(cur, "package.json");
    if (fs.existsSync(pj)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.copyFileSync(s, d);
  }
}

function visit(name, fromDir) {
  if (done.has(name)) return;
  done.add(name);
  const req = fromDir ? createRequire(path.join(fromDir, "package.json")) : require;
  let entry;
  try {
    entry = req.resolve(name);
  } catch (e) {
    // 有些包只导出 package.json 之外的东西，退一步尝试包目录
    try {
      entry = req.resolve(name + "/package.json");
    } catch {
      console.warn(`  ! 无法解析依赖 ${name}（${e.code || e.message}），跳过`);
      return;
    }
  }
  const root = pkgRootOf(entry);
  if (!root) {
    console.warn(`  ! 依赖 ${name} 未找到包目录，跳过`);
    return;
  }
  const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const dest = path.join(nmRoot, name.replaceAll("/", path.sep));
  copyDir(root, dest);
  copied.push(`${name}@${pj.version}`);
  const deps = { ...(pj.dependencies || {}), ...(pj.optionalDependencies || {}) };
  for (const dep of Object.keys(deps)) visit(dep, root);
}

const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
for (const dep of Object.keys(pj.dependencies || {})) visit(dep);

console.log(`  依赖已复制 ${copied.length} 个: ${copied.join(", ")}`);
