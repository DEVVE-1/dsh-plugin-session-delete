#!/usr/bin/env node
/**
 * 把 dsh-plugin-session-delete 装进指定的 DSH profile 并启用它。
 *
 * 做三件事，可重复执行：
 *   1. 用运行时自带的 pnpm 把本目录作为 file: 依赖装进 profile；
 *   2. 把包名追加到 profile package.json 的 dsh.profile.bundles（已存在则跳过）；
 *   3. 复查结果并打印后续动作。
 *
 * 安装要在 DSH 工作区之外写文件，所以由你（用户）自己执行：
 *   node install.mjs                 # 默认 profile: desktop
 *   node install.mjs --profile web
 *   node install.mjs --dry-run       # 只打印计划，不落盘
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function fail(message) {
	console.error(`\u2716 ${message}`);
	process.exit(1);
}
const info = (message) => console.log(`\u00b7 ${message}`);
const ok = (message) => console.log(`\u2714 ${message}`);

/** 解析命令行参数。 */
function parseArgs(argv) {
	const options = { profile: 'desktop', dryRun: false, packagePath: HERE };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--profile' || arg === '-p') options.profile = argv[++index];
		else if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
		else if (arg === '--package' || arg === '-d') options.packagePath = argv[++index];
		else if (arg === '--help' || arg === '-h') {
			console.log('用法: node install.mjs [--profile <name>] [--package <dir>] [--dry-run]');
			process.exit(0);
		} else fail(`无法识别的参数: ${arg}`);
	}
	if (typeof options.profile !== 'string' || options.profile.length === 0) fail('--profile 需要一个名字');
	return options;
}

const options = parseArgs(process.argv.slice(2));

// ── 定位 DSH home / profile ─────────────────────────────────────────────────
const dshHome =
	typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim().length > 0
		? resolve(process.env.DSH_HOME)
		: join(homedir(), '.dsh');
const profileDir = join(dshHome, 'profiles', options.profile);
if (!existsSync(profileDir)) fail(`找不到 profile 目录：${profileDir}`);

// ── 定位运行时 node / pnpm ─────────────────────────────────────────────────
const runtimeDeps = join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies');
const node = join(runtimeDeps, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
const pnpm = join(runtimeDeps, 'pnpm', 'bin', 'pnpm.cjs');
if (!existsSync(node)) fail(`找不到 node：${node}`);
if (!existsSync(pnpm)) fail(`找不到 pnpm：${pnpm}`);

// ── 检查插件包本身 ─────────────────────────────────────────────────────────
const packagePath = resolve(options.packagePath);
const manifestPath = join(packagePath, 'package.json');
for (const required of [manifestPath, join(packagePath, 'cordis.patch.yml'), join(packagePath, 'lib', 'index.js'), join(packagePath, 'lib', 'client.js')]) {
	if (!existsSync(required)) fail(`插件包缺少文件：${required}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const packageName = manifest.name;
if (!packageName) fail('插件 package.json 没有 name');
if (manifest?.dsh?.client?.platform !== 'web') fail('插件没有声明 dsh.client.platform = web');
if (!manifest?.dsh?.bundle?.patch) fail('插件没有声明 dsh.bundle.patch');
ok(`插件包自检通过：${packageName} @ ${packagePath}`);

const profileManifestPath = join(profileDir, 'package.json');
if (!existsSync(profileManifestPath)) fail(`profile 缺少 package.json：${profileManifestPath}`);
const initialManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'));
const initialBundles = Array.isArray(initialManifest?.dsh?.profile?.bundles) ? initialManifest.dsh.profile.bundles : [];
const alreadySelected = initialBundles.includes(packageName);

info(`DSH_HOME = ${dshHome}`);
info(`profile  = ${profileDir}`);
info(`node     = ${node}`);
info(`bundle   = ${packageName}（${alreadySelected ? '已启用' : '将追加到 bundles'}）`);

if (options.dryRun) {
	ok('dry-run：未做任何修改。');
	process.exit(0);
}

// ── 1. 安装依赖 ────────────────────────────────────────────────────────────
info('pnpm add …');
const spec = `file:${packagePath.replaceAll('\\', '/')}`;
const result = spawnSync(node, [pnpm, 'add', spec, '--config.auto-install-peers=false'], {
	cwd: profileDir,
	stdio: 'inherit',
});
const installedPath = join(profileDir, 'node_modules', packageName);
if (result.status !== 0) {
	// 依赖已经装好、只是 pnpm 这一步失败（比如权限被拦）时不算致命：下面第 3 步
	// 会按内容哈希把源码同步进安装目录，装的仍然是当前版本。
	if (existsSync(installedPath)) {
		info(`pnpm add 失败（退出码 ${result.status}），但依赖目录已存在，继续按内容同步。`);
	} else {
		fail(`pnpm add 失败（退出码 ${result.status}），且 ${installedPath} 不存在`);
	}
} else {
	if (!existsSync(installedPath)) fail(`pnpm 报告成功，但 ${installedPath} 不存在`);
	ok(`依赖已安装：${installedPath}`);
}

// ── 2. 追加 bundle 选择（幂等） ────────────────────────────────────────────
// 关键：pnpm 刚改过 profile 的 package.json（新增 dependencies 条目），所以
// 这里必须重新读取，不能拿 pnpm 之前的快照回写，否则会把依赖声明抹掉。
const afterInstall = JSON.parse(readFileSync(profileManifestPath, 'utf8'));
const bundles = Array.isArray(afterInstall?.dsh?.profile?.bundles) ? afterInstall.dsh.profile.bundles : [];
if (bundles.includes(packageName)) {
	ok('dsh.profile.bundles 已包含该插件，跳过。');
} else {
	afterInstall.dsh ??= {};
	afterInstall.dsh.profile ??= {};
	afterInstall.dsh.profile.bundles = [...bundles, packageName];
	const temp = `${profileManifestPath}.tmp`;
	writeFileSync(temp, `${JSON.stringify(afterInstall, null, 2)}\n`, 'utf8');
	renameSync(temp, profileManifestPath);
	ok('dsh.profile.bundles 已追加。');
}

// ── 3. 把包内容同步进安装目录 ──────────────────────────────────────────────
// `pnpm add file:` 只在它认为需要时物化文件；而且用编辑器/写文件工具改源码
// 会替换 inode，把 pnpm 建的硬链接断掉，安装目录就此停在旧字节。这里按内容
// 哈希逐个比对，不一致就覆盖，保证「改完源码 → 跑一次脚本 → 装的真的是新版」。
const packageFiles = [...(manifest.files ?? []), 'package.json'];
let synced = 0;
for (const relative of packageFiles) {
	const from = join(packagePath, relative);
	if (!existsSync(from)) continue;
	const to = join(installedPath, relative);
	const same = existsSync(to) && createHash('sha256').update(readFileSync(from)).digest('hex') === createHash('sha256').update(readFileSync(to)).digest('hex');
	if (same) continue;
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
	synced += 1;
	info(`已同步 ${relative}`);
}
ok(synced === 0 ? '安装目录与源码逐文件一致。' : `安装目录已同步 ${synced} 个文件。`);

// ── 4. 复查 ────────────────────────────────────────────────────────────────
const finalManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'));
if (!finalManifest?.dsh?.profile?.bundles?.includes(packageName)) fail('写入后复查失败：bundles 里没有该插件');
if (!existsSync(join(installedPath, 'cordis.patch.yml'))) fail(`安装目录里缺少 cordis.patch.yml`);
ok(`复查通过：${packageName} v${JSON.parse(readFileSync(join(installedPath, 'package.json'), 'utf8')).version}`);

console.log('');
console.log('下一步：');
console.log('  1. live profile 会即时 recompose；否则重启 DeepSeek Harness。');
console.log('  2. 刷新一次 GUI 页面（浏览器半边要重新进模块表）。');
console.log('  3. 左侧边栏右键任意会话 → 「删除会话」。');
