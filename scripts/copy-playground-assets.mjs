import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve('packages/mocy-playground/public');
const targetDir = path.resolve('dist/playground/public');

if (!existsSync(sourceDir)) {
  throw new Error(`Playground assets not found: ${sourceDir}`);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, {
  recursive: true,
  force: true
});

console.log(`Copied playground assets to ${path.relative(process.cwd(), targetDir)}`);
