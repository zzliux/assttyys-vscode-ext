const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { runTests } = require('@vscode/test-electron');

const ROOT = path.resolve(__dirname, '../..');
const WORKSPACE = process.env.WORKSPACE_PATH
  ? path.resolve(process.env.WORKSPACE_PATH)
  : path.join(ROOT, 'test-output', 'integration-workspace');

function writePng(filePath, pixels) {
  const width = 1280;
  const height = 720;
  const png = new PNG({ width, height });
  png.data.fill(0);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  for (const [x, y, color] of pixels) {
    const index = (y * width + x) * 4;
    png.data[index] = (color >> 16) & 0xff;
    png.data[index + 1] = (color >> 8) & 0xff;
    png.data[index + 2] = color & 0xff;
    png.data[index + 3] = 255;
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function prepareWorkspace() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORKSPACE, 'src', 'common', 'funcList'), { recursive: true });
  fs.mkdirSync(path.join(WORKSPACE, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(WORKSPACE, '.vscode'), { recursive: true });

  fs.writeFileSync(
    path.join(WORKSPACE, '.vscode', 'settings.json'),
    JSON.stringify(
      {
        'assttyys.screenshotPaths': ['screenshots'],
        'assttyys.autoRefresh': false,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(WORKSPACE, 'src', 'common', 'multiDetectColors.ts'),
    `const left = 0;
const center = 1;
const right = 2;

const multiDetectColors = {
  '测试界面': {
    desc: [1280, 720, [
      [left, 100, 100, 0x112233],
      [center, 640, 360, 0x445566],
      [right, 1180, 620, 0x778899],
    ]]
  },
  '未匹配界面': {
    desc: [1280, 720, [
      [left, 100, 100, 0xffffff],
    ]]
  },
};
export default multiDetectColors;
`,
  );

  fs.writeFileSync(
    path.join(WORKSPACE, 'src', 'common', 'multiFindColors.ts'),
    `const left = 0;
const center = 1;

const multiFindColors = {
  '测试找色': {
    region: [left, 1280, 720, 0, 0, 1279, 719],
    desc: [[1280, 720, [
      [center, 500, 400, 0xaabbcc],
      [center, 510, 400, 0xddeeff],
    ]]],
  },
};
export default multiFindColors;
`,
  );

  fs.writeFileSync(
    path.join(WORKSPACE, 'src', 'common', 'funcList', '999_测试.ts'),
    `const left = 0;
const center = 1;
const right = 2;

export class Func999 {
  id = 999;
  name = '测试';
  operator = [{
    desc: '测试界面',
    oper: [[right, 1280, 720, 100, 100, 200, 200, 100]],
  }, {
    desc: [1280, 720, [
      [left, 100, 100, 0x112233],
      [center, 640, 360, 0x445566],
      [right, 1180, 620, 0x778899],
    ]],
    oper: [[right, 1280, 720, 100, 100, 200, 200, 100]],
  }];
}
export default new Func999();
`,
  );

  const detectPixels = [
    [100, 100, 0x112233],
    [640, 360, 0x445566],
    [1180, 620, 0x778899],
    [500, 400, 0xaabbcc],
    [510, 400, 0xddeeff],
  ];
  writePng(path.join(WORKSPACE, 'screenshots', 'detect-1.png'), detectPixels);
  writePng(path.join(WORKSPACE, 'screenshots', 'detect-2.png'), detectPixels);
}

(async () => {
  // DSH/部分终端会设置该变量，VS Code 会以 Node 模式启动而不是 GUI。
  delete process.env.ELECTRON_RUN_AS_NODE;
  if (!process.env.WORKSPACE_PATH) prepareWorkspace();
  const vscodeExecutablePath =
    process.env.VSCODE_EXE || 'C:\\Program Files\\Microsoft VS Code\\Code.exe';

  const extensionDevelopmentPath = process.env.EXTENSION_DEV_PATH || ROOT;
  console.log(`extensionDevelopmentPath=${extensionDevelopmentPath}`);
  const options = {
    extensionDevelopmentPath,
    extensionTestsPath: path.join(__dirname, 'suite', 'index.cjs'),
    launchArgs: [WORKSPACE, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  };
  if (fs.existsSync(vscodeExecutablePath)) {
    options.vscodeExecutablePath = vscodeExecutablePath;
  } else {
    console.log('未找到本机 VS Code，改为下载测试用 VS Code。');
  }

  try {
    const exitCode = await runTests(options);
    process.exit(exitCode);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
