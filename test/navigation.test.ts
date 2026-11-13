import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractNavigationLinks } from '../src/core/navigation';

const REFS = path.resolve('.refs/assttyys_autojs/src/common');

describe('extractNavigationLinks', () => {
  it('解析 thisOperator、desc 字符串和 findMultiColor 跳转', () => {
    const filePath = path.join(REFS, 'funcList/004_接受邀请.ts');
    const links = extractNavigationLinks(fs.readFileSync(filePath, 'utf8'), filePath);

    const sameOperator = links.filter((link) => link.kind === 'same-operator');
    expect(sameOperator.some((link) => link.operatorIndex === 4)).toBe(true);
    expect(sameOperator.some((link) => link.operatorIndex === 2)).toBe(true);

    expect(links.some((link) => link.kind === 'detect' && link.key === '探索地图界面')).toBe(false);
    expect(links.some((link) => link.kind === 'find' && link.key === '组队探索_宝箱')).toBe(true);
  });

  it('解析 funcList.bak 里的动态 desc 和字符串引用', () => {
    const filePath = path.join(REFS, 'funcList.bak/010_地图进入突破界面.ts');
    const links = extractNavigationLinks(fs.readFileSync(filePath, 'utf8'), filePath);

    const operatorLinks = links.filter(
      (link) => link.kind === 'same-operator' && link.operatorIndex === 0,
    );
    expect(operatorLinks.some((link) => link.tooltip.includes('.desc'))).toBe(true);
    expect(operatorLinks.some((link) => link.tooltip.includes('.oper'))).toBe(true);
    expect(links.some((link) => link.kind === 'detect' && link.key === '探索地图界面')).toBe(true);
  });

  it('operatorFunc 内联 operator 的 desc 字符串也能跳 multiDetectColors', () => {
    const filePath = path.join(REFS, 'funcList/311_红标.ts');
    const links = extractNavigationLinks(fs.readFileSync(filePath, 'utf8'), filePath);
    expect(links.some((link) => link.kind === 'detect' && link.key === '战斗界面')).toBe(true);
  });
});
