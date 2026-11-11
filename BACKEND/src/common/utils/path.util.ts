import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveDataPath(filename: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'data', filename),
    path.resolve(process.cwd(), 'BACKEND', 'src', 'data', filename),
    path.resolve(__dirname, '../../data', filename),
    path.resolve(__dirname, '../../../src/data', filename),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  // Fallback to the most likely write destination
  return path.resolve(process.cwd(), 'src', 'data', filename);
}
