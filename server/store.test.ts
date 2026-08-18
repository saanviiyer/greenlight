import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStore } from './store.js';

describe('FileStore durability', () => {
  it('keeps a previous snapshot and refuses to overwrite corrupt data', () => {
    const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp', 'store-'));
    try {
      const store = new FileStore(directory);
      store.saveAvailability({ ...store.getAvailability(), bufferMinutes: 20 });
      expect(fs.existsSync(path.join(directory, 'store.json.bak'))).toBe(true);
      fs.writeFileSync(path.join(directory, 'store.json'), '{broken');
      expect(() => new FileStore(directory)).toThrow(/corrupt; refusing to overwrite/);
      expect(fs.readFileSync(path.join(directory, 'store.json'), 'utf8')).toBe('{broken');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
