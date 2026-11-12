import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const STAGE = path.resolve(process.argv[2] ?? 'test-output/packaged-extension');
const SHOULD_PACKAGE = process.argv.includes('--package');
const PACKAGE_VERSION = JSON.parse(
  await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'),
).version;
const VSIX_PATH = path.join(ROOT, `assttyys-vscode-ext-${PACKAGE_VERSION}.vsix`);

async function copyFile(relativePath, targetRelative = relativePath) {
  const target = path.join(STAGE, targetRelative);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(path.join(ROOT, relativePath), target);
}

async function copyDirectory(relativePath, targetRelative = relativePath) {
  await fsp.cp(path.join(ROOT, relativePath), path.join(STAGE, targetRelative), {
    recursive: true,
    force: true,
  });
}

async function main() {
  await fsp.rm(STAGE, { recursive: true, force: true });
  await fsp.mkdir(path.join(STAGE, 'dist'), { recursive: true });

  await copyFile('dist/extension.js');
  await copyFile('README.md');
  await copyFile('LICENSE');
  await copyFile('CHANGELOG.md');
  await copyFile('THIRD-PARTY-NOTICES.md');
  await copyFile('package.json');

  // VSIX 里不需要开发脚本；去掉 vscode:prepublish，避免 vsce 再次构建。
  const manifestPath = path.join(STAGE, 'package.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  delete manifest.scripts;
  delete manifest.devDependencies;
  // 其余运行时代码已经由 esbuild 打进 dist/extension.js；VSIX 只需要 sharp
  // 这个带原生 .node 的包及其运行时依赖。
  manifest.dependencies = { sharp: '0.32.6' };
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // 只带 sharp 的运行时文件，不带 vendor/include 等安装期资源。
  await copyDirectory('node_modules/sharp/lib', 'node_modules/sharp/lib');
  await copyDirectory('node_modules/sharp/build/Release', 'node_modules/sharp/build/Release');
  await copyFile('node_modules/sharp/package.json', 'node_modules/sharp/package.json');
  await copyFile('node_modules/sharp/LICENSE', 'node_modules/sharp/LICENSE');

  // sharp 的 package.json 还列了只在 npm install 阶段使用的依赖。VSIX 里
  // 只需要运行时模块，去掉安装期依赖，避免 vsce 做依赖校验时找不到它们。
  const sharpManifestPath = path.join(STAGE, 'node_modules/sharp/package.json');
  const sharpManifest = JSON.parse(await fsp.readFile(sharpManifestPath, 'utf8'));
  sharpManifest.dependencies = {
    color: '^4.2.3',
    'detect-libc': '^2.0.2',
    semver: '^7.5.4',
    'tunnel-agent': '^0.6.0',
  };
  await fsp.writeFile(sharpManifestPath, JSON.stringify(sharpManifest, null, 2));

  const runtimeDependencies = [
    'color',
    'color-convert',
    'color-name',
    'color-string',
    'simple-swizzle',
    'is-arrayish',
    'detect-libc',
    'semver',
    'tunnel-agent',
    'safe-buffer',
  ];
  for (const dependency of runtimeDependencies) {
    await copyDirectory(`node_modules/${dependency}`, `node_modules/${dependency}`);
  }

  const stat = await fsp.stat(path.join(STAGE, 'node_modules/sharp/build/Release/sharp-win32-x64.node'));
  console.log(`staged at ${STAGE} (sharp native ${stat.size} bytes)`);

  if (!SHOULD_PACKAGE) return;

  const vsce = path.join(ROOT, 'node_modules', '@vscode', 'vsce', 'vsce');
  const result = spawnSync(
    process.execPath,
    [vsce, 'package', '--dependencies', '--out', VSIX_PATH],
    { cwd: STAGE, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`packaged ${VSIX_PATH}`);
}

void main();
