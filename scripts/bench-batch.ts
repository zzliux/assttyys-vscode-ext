import fs from 'node:fs/promises';
import path from 'node:path';
import { ScreenshotIndex } from '../src/core/screenshotIndex';
import { MatcherService } from '../src/core/matcherService';
import { extractPatterns } from '../src/core/extract';

async function main(): Promise<void> {
  const projectRoot = path.resolve(process.argv[2] ?? '.refs/assttyys_autojs');
  const screenshotPaths = process.argv.slice(3);
  const detectFile = path.join(projectRoot, 'src/common/multiDetectColors.ts');
  const patterns = extractPatterns(detectFile, 1, await fs.readFile(detectFile, 'utf8')).patterns;

  const index = new ScreenshotIndex();
  await index.rebuild(screenshotPaths, {
    includeSubfolders: true,
    extensions: ['png', 'jpg', 'jpeg'],
    workspaceFolders: [],
    cwd: process.cwd(),
  });

  const service = new MatcherService(index);
  service.setErrorHandler((message) => console.error(message));
  const started = Date.now();
  let lastReport = 0;
  const result = await service.matchPatternsBatch(
    patterns,
    {
      colorSimilarity: 93,
      findColorSimilarity: 97,
      findColorOffset: true,
      maxMatchesPerPattern: 20,
    },
    undefined,
    (done, total) => {
      if (done - lastReport >= 100 || done === total) {
        lastReport = done;
        console.log(`progress ${done}/${total} elapsed=${Date.now() - started}ms`);
      }
    },
  );
  const elapsed = Date.now() - started;
  const hitPatterns = Array.from(result.entries()).filter(([, matches]) => matches.length > 0);
  console.log(
    `screenshots=${index.entries.length} patterns=${patterns.length} hitPatterns=${hitPatterns.length} elapsed=${elapsed}ms`,
  );
  for (const [id, matches] of hitPatterns.sort((a, b) => b[1].length - a[1].length)) {
    const pattern = patterns.find((item) => item.id === id);
    console.log(`${matches.length}\t${pattern?.key ?? id}\t${path.basename(matches[0].path)}`);
  }
}

void main();
