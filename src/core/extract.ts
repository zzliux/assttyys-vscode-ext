import * as ts from 'typescript';
import path from 'node:path';
import type {
  ColorPoint,
  DynamicDescReference,
  ExtractionResult,
  FindCallReference,
  FindRegion,
  PatternDefinition,
  Resolution,
  StringReference,
} from './model';

type EvalValue =
  | number
  | string
  | boolean
  | null
  | EvalValue[]
  | { [key: string]: EvalValue };

function propertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function isStringLiteralLike(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

class Evaluator {
  private env = new Map<string, EvalValue>();

  constructor(sourceFile: ts.SourceFile) {
    this.collectConstants(sourceFile);
  }

  private collectConstants(sourceFile: ts.SourceFile): void {
    const declarations: Array<{ name: string; initializer: ts.Expression }> = [];
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.push({ name: declaration.name.text, initializer: declaration.initializer });
        }
      }
    }

    // 多轮解析，处理 const a = b 这样的引用。
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (const { name, initializer } of declarations) {
        if (this.env.has(name)) continue;
        const value = this.eval(initializer);
        if (value !== undefined) {
          this.env.set(name, value);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  eval(node: ts.Node | undefined): EvalValue | undefined {
    if (!node) return undefined;

    if (ts.isNumericLiteral(node)) {
      return Number(node.text.replace(/_/g, ''));
    }
    if (isStringLiteralLike(node)) {
      return node.text;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node)) return this.env.get(node.text);

    if (ts.isParenthesizedExpression(node)) return this.eval(node.expression);
    if (ts.isAsExpression(node)) return this.eval(node.expression);
    if (ts.isTypeAssertionExpression(node)) return this.eval(node.expression);
    if (ts.isNonNullExpression(node)) return this.eval(node.expression);
    if (ts.isSatisfiesExpression(node)) return this.eval(node.expression);

    if (ts.isPrefixUnaryExpression(node)) {
      const value = this.eval(node.operand);
      if (typeof value !== 'number') return undefined;
      switch (node.operator) {
        case ts.SyntaxKind.MinusToken:
          return -value;
        case ts.SyntaxKind.PlusToken:
          return value;
        case ts.SyntaxKind.TildeToken:
          return ~value;
        case ts.SyntaxKind.ExclamationToken:
          return !value;
        default:
          return undefined;
      }
    }

    if (ts.isBinaryExpression(node)) {
      const left = this.eval(node.left);
      const right = this.eval(node.right);
      if (left === undefined || right === undefined) return undefined;
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken) {
        if (typeof left === 'number' && typeof right === 'number') return left + right;
        if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right);
        return undefined;
      }
      if (typeof left !== 'number' || typeof right !== 'number') return undefined;
      switch (op) {
        case ts.SyntaxKind.MinusToken:
          return left - right;
        case ts.SyntaxKind.AsteriskToken:
          return left * right;
        case ts.SyntaxKind.SlashToken:
          return left / right;
        case ts.SyntaxKind.PercentToken:
          return left % right;
        case ts.SyntaxKind.AsteriskAsteriskToken:
          return left ** right;
        case ts.SyntaxKind.LessThanLessThanToken:
          return left << right;
        case ts.SyntaxKind.GreaterThanGreaterThanToken:
          return left >> right;
        case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
          return left >>> right;
        case ts.SyntaxKind.AmpersandToken:
          return left & right;
        case ts.SyntaxKind.BarToken:
          return left | right;
        case ts.SyntaxKind.CaretToken:
          return left ^ right;
        default:
          return undefined;
      }
    }

    if (ts.isArrayLiteralExpression(node)) {
      const result: EvalValue[] = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) return undefined;
        const value = this.eval(element);
        if (value === undefined) return undefined;
        result.push(value);
      }
      return result;
    }

    if (ts.isObjectLiteralExpression(node)) {
      const result: { [key: string]: EvalValue } = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = propertyName(prop.name);
          if (key === undefined) return undefined;
          const value = this.eval(prop.initializer);
          if (value === undefined) return undefined;
          result[key] = value;
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          const value = this.env.get(prop.name.text);
          if (value === undefined) return undefined;
          result[prop.name.text] = value;
        } else {
          return undefined;
        }
      }
      return result;
    }

    return undefined;
  }
}

function numberValue(value: EvalValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePatternValue(value: EvalValue | undefined): {
  resolution: Resolution;
  points: ColorPoint[];
} | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const width = numberValue(value[0]);
  const height = numberValue(value[1]);
  const rawPoints = value[2];
  if (!width || !height || width <= 0 || height <= 0) return null;
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) return null;

  const points: ColorPoint[] = [];
  for (const rawPoint of rawPoints) {
    if (!Array.isArray(rawPoint) || rawPoint.length < 4) return null;
    const mode = numberValue(rawPoint[0]);
    const x = numberValue(rawPoint[1]);
    const y = numberValue(rawPoint[2]);
    const color = numberValue(rawPoint[3]);
    if (mode === undefined || x === undefined || y === undefined || color === undefined) return null;

    let toleranceR = 0;
    let toleranceG = 0;
    let toleranceB = 0;
    let resultFlag: 0 | 1 = 0;

    const fifth = numberValue(rawPoint[4]);
    if (fifth !== undefined) {
      if (fifth === 1) {
        resultFlag = 1;
      } else if (fifth > 1) {
        toleranceR = (fifth >> 16) & 0xff;
        toleranceG = (fifth >> 8) & 0xff;
        toleranceB = fifth & 0xff;
      }
    }
    const sixth = numberValue(rawPoint[5]);
    if (sixth !== undefined) {
      resultFlag = sixth === 1 ? 1 : 0;
    }

    points.push({
      mode,
      x,
      y,
      color,
      toleranceR,
      toleranceG,
      toleranceB,
      resultFlag,
    });
  }

  return { resolution: { width, height }, points };
}

function parseRegionValue(value: EvalValue | undefined): FindRegion | undefined {
  if (!Array.isArray(value) || value.length < 7) return undefined;
  const numbers = value.slice(0, 7).map((item) => numberValue(item));
  if (numbers.some((item) => item === undefined)) return undefined;
  const [mode, devWidth, devHeight, x1, y1, x2, y2] = numbers as number[];
  return { mode, devWidth, devHeight, x1, y1, x2, y2 };
}

function findAncestor<T extends ts.Node>(
  node: ts.Node | undefined,
  predicate: (node: ts.Node) => node is T,
): T | undefined {
  let current = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function enclosingClassName(node: ts.Node): string | undefined {
  const cls = findAncestor(node, ts.isClassDeclaration);
  return cls?.name?.text;
}

function isOperatorProperty(
  node: ts.Node,
): node is ts.PropertyAssignment | ts.PropertyDeclaration {
  if (!ts.isPropertyAssignment(node) && !ts.isPropertyDeclaration(node)) return false;
  if (propertyName(node.name) !== 'operator') return false;
  return !!node.initializer && ts.isArrayLiteralExpression(node.initializer);
}

function nearestOperatorIndex(entryObject: ts.ObjectLiteralExpression): number | undefined {
  const operatorProp = findAncestor(entryObject.parent, isOperatorProperty);
  if (!operatorProp) return undefined;
  const initializer = operatorProp.initializer;
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) return undefined;
  const index = initializer.elements.indexOf(entryObject);
  return index >= 0 ? index : undefined;
}

function isFunctionOperatorItem(entryObject: ts.ObjectLiteralExpression): boolean {
  const operatorProp = findAncestor(entryObject.parent, isOperatorProperty);
  if (operatorProp) return true;
  const keys = new Set<string>();
  for (const prop of entryObject.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = propertyName(prop.name);
      if (key) keys.add(key);
    }
  }
  return keys.has('oper') || keys.has('operStepRandom') || keys.has('retest');
}

/** 解析 `thisOperator[N].desc`，返回 N。 */
function thisOperatorDescIndex(node: ts.Node): number | undefined {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'desc') return undefined;
  const elementAccess = node.expression;
  if (!ts.isElementAccessExpression(elementAccess)) return undefined;
  if (!ts.isIdentifier(elementAccess.expression) || elementAccess.expression.text !== 'thisOperator') {
    return undefined;
  }
  const argument = elementAccess.argumentExpression;
  if (!argument || !ts.isNumericLiteral(argument)) return undefined;
  const index = Number(argument.text);
  return Number.isInteger(index) ? index : undefined;
}

function findObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const prop of object.properties) {
    if (ts.isPropertyAssignment(prop) && propertyName(prop.name) === name) return prop;
  }
  return undefined;
}

/**
 * 解析一个 TypeScript 文件中的所有比色/找色定义。
 *
 * 只识别 `desc` 属性上的字面量数组（或字面量字符串引用），不会执行源码。
 *
 * @param filePath 文件的绝对路径，仅用于展示和生成稳定 id。
 */
export function extractPatterns(
  filePath: string,
  version: number,
  text: string,
): ExtractionResult {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const evaluator = new Evaluator(sourceFile);
  const baseName = path.basename(filePath);
  const kind: 'detect' | 'find' | 'inline' =
    baseName === 'multiDetectColors.ts'
      ? 'detect'
      : baseName === 'multiFindColors.ts'
        ? 'find'
        : 'inline';

  const patterns: PatternDefinition[] = [];
  const references: StringReference[] = [];
  const dynamicReferences: DynamicDescReference[] = [];
  const findReferences: FindCallReference[] = [];
  let patternCounter = 0;

  const addPattern = (
    parsed: { resolution: Resolution; points: ColorPoint[] },
    label: string,
    key: string | undefined,
    region: FindRegion | undefined,
    similarity: number | undefined,
    anchorNode: ts.Node,
    operatorIndex?: number,
    keyOffset?: number,
  ): void => {
    patternCounter++;
    patterns.push({
      id: `${filePath}#${anchorNode.getEnd()}#${patternCounter}`,
      kind,
      uri: filePath,
      version,
      label,
      key,
      resolution: parsed.resolution,
      points: parsed.points,
      region,
      similarity,
      anchorOffset: anchorNode.getEnd(),
      startOffset: anchorNode.getStart(),
      keyOffset,
      operatorIndex,
    });
  };

  const handleDescProperty = (prop: ts.PropertyAssignment): void => {
    const valueNode = prop.initializer;
    const entryObject = prop.parent;
    if (!ts.isObjectLiteralExpression(entryObject)) return;

    if (isStringLiteralLike(valueNode)) {
      if (kind === 'inline' && isFunctionOperatorItem(entryObject)) {
        const key = valueNode.text;
        if (!key) return;
        references.push({
          id: `${filePath}#ref#${valueNode.getEnd()}`,
          uri: filePath,
          version,
          key,
          label: `→ ${key}`,
          anchorOffset: valueNode.getEnd(),
          startOffset: valueNode.getStart(),
          operatorIndex: nearestOperatorIndex(entryObject),
        });
      }
      return;
    }

    if (kind === 'inline') {
      const targetOperatorIndex = thisOperatorDescIndex(valueNode);
      if (targetOperatorIndex !== undefined) {
        dynamicReferences.push({
          id: `${filePath}#dyn#${valueNode.getEnd()}`,
          uri: filePath,
          version,
          targetOperatorIndex,
          anchorOffset: valueNode.getEnd(),
          label: `thisOperator[${targetOperatorIndex}].desc`,
        });
        return;
      }
    }

    if (!ts.isArrayLiteralExpression(valueNode)) return;

    let entryKey: string | undefined;
    let keyOffset: number | undefined;
    let region: FindRegion | undefined;
    let similarity: number | undefined;

    if (kind === 'detect' || kind === 'find') {
      if (ts.isPropertyAssignment(entryObject.parent)) {
        entryKey = propertyName(entryObject.parent.name);
        keyOffset = entryObject.parent.name.getStart();
      }
      if (kind === 'find') {
        const regionProp = findObjectProperty(entryObject, 'region');
        if (regionProp) region = parseRegionValue(evaluator.eval(regionProp.initializer));
        const similarProp = findObjectProperty(entryObject, 'similar');
        if (similarProp) similarity = numberValue(evaluator.eval(similarProp.initializer));
      }
    }

    const directValue = evaluator.eval(valueNode);
    const directParsed = parsePatternValue(directValue);
    if (directParsed) {
      let label: string;
      let operatorIndex: number | undefined;
      if (kind === 'detect') {
        label = entryKey ?? `${baseName} 定义`;
      } else if (kind === 'find') {
        label = entryKey ? `${entryKey}#1` : `${baseName} 定义#1`;
      } else {
        const className = enclosingClassName(entryObject) ?? path.basename(filePath, '.ts');
        operatorIndex = nearestOperatorIndex(entryObject);
        label = operatorIndex === undefined
          ? `${className} @L${sourceFile.getLineAndCharacterOfPosition(valueNode.getStart()).line + 1}`
          : `${className}.operator[${operatorIndex}]`;
      }
      addPattern(
        directParsed,
        label,
        entryKey,
        region,
        similarity,
        valueNode,
        operatorIndex,
        keyOffset,
      );
      return;
    }

    // multiFindColors 的 desc 是数组的数组：每个子数组是一套找色点。
    if (
      kind === 'find' &&
      valueNode.elements.length > 0 &&
      valueNode.elements.every((element) => ts.isArrayLiteralExpression(element))
    ) {
      const total = valueNode.elements.length;
      valueNode.elements.forEach((element, index) => {
        if (!ts.isArrayLiteralExpression(element)) return;
        const parsed = parsePatternValue(evaluator.eval(element));
        if (!parsed) return;
        const suffix = total > 1 ? `#${index + 1}` : '';
        const label = entryKey ? `${entryKey}${suffix}` : `${baseName} 定义${suffix}`;
        addPattern(parsed, label, entryKey, region, similarity, element, undefined, keyOffset);
      });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'desc') {
      handleDescProperty(node);
    }
    if (kind === 'inline' && ts.isCallExpression(node)) {
      const callee = node.expression;
      const callName = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : '';
      if (
        (callName === 'findMultiColor' ||
          callName === 'findMultiColorEx' ||
          callName === 'findMultiColorLoop') &&
        node.arguments.length > 0 &&
        isStringLiteralLike(node.arguments[0])
      ) {
        const arg = node.arguments[0];
        if (arg.text) {
          findReferences.push({
            id: `${filePath}#find#${arg.getEnd()}`,
            uri: filePath,
            version,
            key: arg.text,
            label: `find:${arg.text}`,
            // 图标放在调用右括号后，靠近字符串但和跳转文本隔开。
            anchorOffset: node.getEnd(),
            startOffset: arg.getStart(),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { patterns, references, dynamicReferences, findReferences };
}

/** 判断文件是否是本插件关心的定义文件。 */
export function isRelevantFile(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, '/');
  const baseName = path.basename(normalized);
  if (baseName === 'multiDetectColors.ts' || baseName === 'multiFindColors.ts') return true;
  return /\/src\/common\/funcList(?:\.bak)?\/[^/]+\.ts$/.test(normalized);
}

/** 判断文件是否是比色定义文件。 */
export function isDetectFile(fileName: string): boolean {
  return path.basename(fileName.replace(/\\/g, '/')) === 'multiDetectColors.ts';
}

/** 判断文件是否是找色定义文件。 */
export function isFindFile(fileName: string): boolean {
  return path.basename(fileName.replace(/\\/g, '/')) === 'multiFindColors.ts';
}
