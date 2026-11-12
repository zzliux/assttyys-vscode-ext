import * as vscode from 'vscode';

export interface ExtensionConfig {
  screenshotPaths: string[];
  includeSubfolders: boolean;
  extensions: string[];
  colorSimilarity: number;
  findColorSimilarity: number;
  findColorOffset: boolean;
  maxMatchesPerPattern: number;
  findColorScanLimit: number;
  showStringReferences: boolean;
  autoRefresh: boolean;
}

export function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('assttyys');
  return {
    screenshotPaths: config.get<string[]>('screenshotPaths', []),
    includeSubfolders: config.get<boolean>('includeSubfolders', true),
    extensions: config.get<string[]>('previewImageExtensions', ['png', 'jpg', 'jpeg']),
    colorSimilarity: config.get<number>('colorSimilarity', 93),
    findColorSimilarity: config.get<number>('findColorSimilarity', 97),
    findColorOffset: config.get<boolean>('findColorOffset', true),
    maxMatchesPerPattern: config.get<number>('maxMatchesPerPattern', 20),
    findColorScanLimit: config.get<number>('findColorScanLimit', 200),
    showStringReferences: config.get<boolean>('showStringReferences', true),
    autoRefresh: config.get<boolean>('autoRefresh', true),
  };
}

export function configKey(config: ExtensionConfig): string {
  return JSON.stringify(config);
}
