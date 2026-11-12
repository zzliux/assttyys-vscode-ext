import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPatterns } from '../src/core/extract';
import { DetectPatternIndex } from '../src/core/detectIndex';

const ROOT = path.resolve('.refs/assttyys_autojs/src/common');

describe('reference project coverage', () => {
  it('解析全部功能文件并统计未解析引用', () => {
    const detectFile = path.join(ROOT, 'multiDetectColors.ts');
    const detect = extractPatterns(detectFile, 1, fs.readFileSync(detectFile, 'utf8'));
    const index = new DetectPatternIndex();
    index.update(detectFile, detect.patterns);

    const funcDir = path.join(ROOT, 'funcList');
    const files = fs.readdirSync(funcDir).filter((name) => name.endsWith('.ts'));
    let patterns = 0;
    let references = 0;
    const unresolved = new Set<string>();
    for (const name of files) {
      const filePath = path.join(funcDir, name);
      const result = extractPatterns(filePath, 1, fs.readFileSync(filePath, 'utf8'));
      patterns += result.patterns.length;
      references += result.references.length;
      for (const reference of result.references) {
        if (!index.resolve(filePath, reference.key)) unresolved.add(reference.key);
      }
    }

    console.log(
      `funcFiles=${files.length} detect=${detect.patterns.length} inline=${patterns} refs=${references} unresolved=${unresolved.size}`,
    );
    if (unresolved.size > 0) {
      console.log(`unresolved keys: ${Array.from(unresolved).slice(0, 30).join(', ')}`);
    }

    expect(files.length).toBeGreaterThan(100);
    expect(detect.patterns.length).toBeGreaterThan(60);
    expect(patterns).toBeGreaterThan(200);
    expect(references).toBeGreaterThan(200);
    expect(unresolved.size).toBeLessThan(references * 0.05);
  });
});
