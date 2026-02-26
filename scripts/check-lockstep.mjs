import { readFileSync } from 'node:fs';
import path from 'node:path';

function readPackageJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const rootPath = path.resolve('package.json');
const mcpPath = path.resolve('packages/mocy-mcp/package.json');

const rootPackage = readPackageJson(rootPath);
const mcpPackage = readPackageJson(mcpPath);
const rootName = rootPackage.name;
const mcpName = mcpPackage.name;

if (rootPackage.version !== mcpPackage.version) {
  console.error(`Lockstep version mismatch: ${rootName}=${rootPackage.version}, ${mcpName}=${mcpPackage.version}`);
  process.exit(1);
}

console.log(`Lockstep OK: ${rootName}@${rootPackage.version} + ${mcpName}@${mcpPackage.version}`);
