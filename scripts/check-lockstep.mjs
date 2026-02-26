import { readFileSync } from 'node:fs';
import path from 'node:path';

function readPackageJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const rootPath = path.resolve('package.json');
const mcpPath = path.resolve('packages/mocy-mcp/package.json');

const rootPackage = readPackageJson(rootPath);
const mcpPackage = readPackageJson(mcpPath);

if (rootPackage.version !== mcpPackage.version) {
  console.error(
    `Lockstep version mismatch: mocy=${rootPackage.version}, mocy-mcp=${mcpPackage.version}`
  );
  process.exit(1);
}

console.log(`Lockstep OK: version ${rootPackage.version}`);
