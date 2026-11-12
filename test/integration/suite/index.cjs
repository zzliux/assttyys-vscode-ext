const Mocha = require('mocha');
const path = require('node:path');

exports.run = function run() {
  const mocha = new Mocha({ ui: 'tdd', timeout: 60000 });
  mocha.addFile(path.join(__dirname, 'extension.test.cjs'));
  if (process.env.REAL_TEST === '1') {
    mocha.addFile(path.join(__dirname, 'real.test.cjs'));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} 个集成测试失败`));
      else resolve();
    });
  });
};
