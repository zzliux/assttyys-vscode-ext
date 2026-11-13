import * as ts from 'typescript';

export type NavigationLinkKind = 'same-operator' | 'detect' | 'find';

export interface NavigationLink {
  kind: NavigationLinkKind;
  /** 编辑器里可点击的范围。 */
  startOffset: number;
  endOffset: number;
  tooltip: string;
  /** same-operator：目标 operator 下标和字段。 */
  operatorIndex?: number;
  targetOffset?: number;
  /** detect/find：要解析的 key。 */
  key?: string;
}

function propertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function enclosingClass(node: ts.Node): ts.ClassDeclaration | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isClassDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function operatorArrayOf(cls: ts.ClassDeclaration | undefined): ts.ArrayLiteralExpression | undefined {
  if (!cls) return undefined;
  for (const member of cls.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    if (propertyName(member.name) !== 'operator') continue;
    if (member.initializer && ts.isArrayLiteralExpression(member.initializer)) {
      return member.initializer;
    }
  }
  return undefined;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const prop of object.properties) {
    if (ts.isPropertyAssignment(prop) && propertyName(prop.name) === name) return prop;
  }
  return undefined;
}

function isOperatorItem(
  object: ts.ObjectLiteralExpression,
  operatorArray: ts.ArrayLiteralExpression | undefined,
): boolean {
  if (operatorArray && operatorArray.elements.includes(object)) return true;
  // operatorFunc 里临时写的 `operator: [{ desc: '...' }]` 不在类字段的
  // operator 数组里，但父级属性同样叫 operator。
  const parent = object.parent;
  if (!ts.isArrayLiteralExpression(parent)) return false;
  const owner = parent.parent;
  if (
    (ts.isPropertyAssignment(owner) || ts.isPropertyDeclaration(owner)) &&
    propertyName(owner.name) === 'operator'
  ) {
    return true;
  }
  return false;
}

function fieldTargetOffset(element: ts.Expression, field: 'desc' | 'oper' | 'item'): number {
  if (ts.isObjectLiteralExpression(element) && field !== 'item') {
    const prop = objectProperty(element, field);
    if (prop) return prop.initializer.getStart();
  }
  return element.getStart();
}

function topExpression(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === current
    ) {
      current = parent;
      continue;
    }
    break;
  }
  return current;
}

/**
 * 从功能文件里找出：
 * - `thisOperator[N]` 引用（跳同文件 operator[N]）；
 * - operator 项里的 `desc: 'key'`（跳 multiDetectColors）；
 * - `findMultiColor('key')` 等调用（跳 multiFindColors）。
 */
export function extractNavigationLinks(text: string, filePath: string): NavigationLink[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const links: NavigationLink[] = [];
  const seen = new Set<string>();

  const add = (link: NavigationLink): void => {
    const key = `${link.kind}:${link.startOffset}:${link.endOffset}:${link.operatorIndex ?? ''}:${link.key ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isElementAccessExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'thisOperator' &&
        node.argumentExpression &&
        ts.isNumericLiteral(node.argumentExpression)
      ) {
        const index = Number(node.argumentExpression.text);
        const cls = enclosingClass(node);
        const operatorArray = operatorArrayOf(cls);
        if (
          Number.isInteger(index) &&
          operatorArray &&
          index >= 0 &&
          index < operatorArray.elements.length
        ) {
          const element = operatorArray.elements[index];
          let field: 'desc' | 'oper' | 'item' = 'item';
          let cursor: ts.Node = node;
          while (cursor.parent) {
            const parent = cursor.parent;
            if (
              ts.isPropertyAccessExpression(parent) &&
              parent.expression === cursor &&
              (parent.name.text === 'desc' || parent.name.text === 'oper')
            ) {
              field = parent.name.text as 'desc' | 'oper';
              break;
            }
            if (
              (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
              parent.expression === cursor
            ) {
              cursor = parent;
              continue;
            }
            break;
          }

          const overall = topExpression(node);
          const targetField = field === 'item' ? 'desc' : field;
          const targetOffset = fieldTargetOffset(element, targetField);
          add({
            kind: 'same-operator',
            startOffset: overall.getStart(),
            endOffset: overall.getEnd(),
            tooltip: `跳转到本文件 operator[${index}].${targetField}`,
            operatorIndex: index,
            targetOffset,
          });
        }
      }
    }

    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'desc') {
      const value = node.initializer;
      const object = node.parent;
      if (ts.isObjectLiteralExpression(object) && ts.isStringLiteralLike(value)) {
        const cls = enclosingClass(node);
        const operatorArray = operatorArrayOf(cls);
        if (isOperatorItem(object, operatorArray)) {
          add({
            kind: 'detect',
            startOffset: value.getStart(),
            endOffset: value.getEnd(),
            tooltip: `跳转到 multiDetectColors.ts 的 ${value.text} 定义`,
            key: value.text,
          });
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : '';
      if (
        (name === 'findMultiColor' || name === 'findMultiColorEx' || name === 'findMultiColorLoop') &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const arg = node.arguments[0];
        add({
          kind: 'find',
          startOffset: arg.getStart(),
          endOffset: arg.getEnd(),
          tooltip: `跳转到 multiFindColors.ts 的 ${arg.text} 定义`,
          key: arg.text,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return links;
}
