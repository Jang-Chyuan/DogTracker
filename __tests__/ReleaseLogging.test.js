import fs from 'fs';
import path from 'path';
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
test('src has no console.log/info bypasses for sensitive fields outside logger', () => {
  for (const file of files(path.join(__dirname, '../src')).filter(name => /\.[jt]sx?$/.test(name) && !name.endsWith('/logger.js'))) {
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/console\s*\.\s*(log|info|warn|error)\s*\(/);
  }
});
test('release logger drops all payloads including error objects', () => {
  const previous = global.__DEV__; global.__DEV__ = false;
  const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
  require('../src/logger').logger.info({ deviceId: 'private' }, new Error('coordinates'));
  expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); global.__DEV__ = previous;
});
