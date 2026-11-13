/** 分辨率。 */
export interface Resolution {
  width: number;
  height: number;
}

/**
 * 一个比色点。
 *
 * 对应 multiDetectColors / multiFindColors / 功能文件里的
 * `[mode, x, y, 0xRRGGBB]`，第 5/6 个参数分别可能是容差颜色和结果标志位。
 */
export interface ColorPoint {
  /** 0=left, 1=center, 2=right, -1=normal；3/4/5 为纵向对齐。 */
  mode: number;
  x: number;
  y: number;
  /** 0xRRGGBB */
  color: number;
  toleranceR: number;
  toleranceG: number;
  toleranceB: number;
  /** 0=正常（匹配成功才算成功）；1=取反（匹配失败才算成功）。 */
  resultFlag: 0 | 1;
}

/** 找色区域：[mode, devWidth, devHeight, x1, y1, x2, y2]。 */
export interface FindRegion {
  mode: number;
  devWidth: number;
  devHeight: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type PatternKind = 'detect' | 'find' | 'inline';

/**
 * 从源码中解析出的一个比色/找色定义。
 *
 * `anchorOffset` 用于在编辑器里定位小图标，位于数组右括号或字符串右引号之后。
 */
export interface PatternDefinition {
  id: string;
  kind: PatternKind;
  uri: string;
  version: number;
  /** 展示名，例如 multiDetectColors 的 key、multiFindColors 的 key#2、Func001.operator[3]。 */
  label: string;
  /** 比色/找色定义 key；内联定义为 undefined。 */
  key?: string;
  resolution: Resolution;
  points: ColorPoint[];
  region?: FindRegion;
  /** 找色定义里的 similar，优先于全局设置。 */
  similarity?: number;
  /** 数组右括号后的字符偏移。 */
  anchorOffset: number;
  /** 数组左括号的字符偏移。 */
  startOffset?: number;
  /** 比色/找色定义 key 属性的字符偏移（用于跳转到 key 而不是 desc 数组）。 */
  keyOffset?: number;
  /** 功能文件内联定义对应的 operator 数组下标。 */
  operatorIndex?: number;
}

/** 功能文件里 `desc: 'key'` 的字符串引用。 */
export interface StringReference {
  id: string;
  uri: string;
  version: number;
  key: string;
  label: string;
  /** 字符串右引号后的字符偏移。 */
  anchorOffset: number;
  /** 字符串左引号前的字符偏移，用于跳转。 */
  startOffset: number;
  /** 所属 operator 数组下标。 */
  operatorIndex?: number;
}

/** 功能文件里 `desc: thisOperator[N].desc` 这种动态引用。 */
export interface DynamicDescReference {
  id: string;
  uri: string;
  version: number;
  /** 被引用的 operator 数组下标。 */
  targetOperatorIndex: number;
  /** 表达式结束位置，用于放匹配图标。 */
  anchorOffset: number;
  label: string;
}

export interface ExtractionResult {
  patterns: PatternDefinition[];
  references: StringReference[];
  dynamicReferences: DynamicDescReference[];
}

/** 一张截图上的匹配结果。 */
export interface ScreenshotMatch {
  path: string;
  width: number;
  height: number;
  /** 命中位置（找色为锚点坐标，比色为第一个点坐标）。 */
  anchor: { x: number; y: number };
  /** 命中的各个比色点的实际坐标，用于预览时叠加标记。 */
  points: Array<{ x: number; y: number }>;
}

/** 一个 desc 对应的所有匹配截图。 */
export interface MatchSet {
  /** 用于在 inlay hint 里定位的 key。 */
  stateKey: string;
  label: string;
  resolution: Resolution;
  points: ColorPoint[];
  matches: ScreenshotMatch[];
}

export interface MatcherOptions {
  colorSimilarity: number;
  findColorSimilarity: number;
  findColorOffset: boolean;
  maxMatchesPerPattern: number;
  /** 找色只扫描最近的 N 张同分辨率截图；不传表示不限制。比色始终扫描全部。 */
  findColorScanLimit?: number;
}
