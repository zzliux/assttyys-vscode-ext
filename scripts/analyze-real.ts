import path from 'node:path';
import { ScreenshotIndex } from '../src/core/screenshotIndex';

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('用法：node analyze-real.cjs <截图目录> [...]');
    process.exit(1);
  }
  const index = new ScreenshotIndex();
  const started = Date.now();
  await index.rebuild(paths, {
    includeSubfolders: true,
    extensions: ['png', 'jpg', 'jpeg'],
    workspaceFolders: [],
    cwd: process.cwd(),
  });
  const elapsed = Date.now() - started;

  console.log(`paths=${paths.length}`);
  console.log(`entries=${index.entries.length}`);
  console.log(`elapsed=${elapsed}ms`);
  console.log(`resolutions=${index.resolutionSummary || '(none)'}`);
  console.log(`errors=${index.errors.length}`);
  for (const error of index.errors.slice(0, 20)) console.log(`  - ${error}`);

  const byResolution = new Map<string, number>();
  for (const entry of index.entries) {
    const key = `${entry.width}x${entry.height}`;
    byResolution.set(key, (byResolution.get(key) ?? 0) + 1);
  }
  console.log('--- resolution table ---');
  for (const [key, count] of Array.from(byResolution).sort((a, b) => b[1] - a[1])) {
    console.log(`${key}: ${count}`);
  }

  const sample = index.entries
    .filter((entry) => entry.width === 1280 && entry.height === 720)
    .slice(0, 10);
  console.log('--- 1280x720 samples ---');
  for (const entry of sample) {
    console.log(path.basename(entry.path));
  }
}

void main();
