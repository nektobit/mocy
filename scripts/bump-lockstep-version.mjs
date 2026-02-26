import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const bumpArg = process.argv[2];
if (!bumpArg) {
  console.error('Usage: node scripts/bump-lockstep-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}

const rootPath = path.resolve('package.json');
const mcpPath = path.resolve('packages/mocy-mcp/package.json');

const rootPackage = readJson(rootPath);
const mcpPackage = readJson(mcpPath);
const rootName = rootPackage.name;
const mcpName = mcpPackage.name;

if (rootPackage.version !== mcpPackage.version) {
  console.error(
    `Lockstep version mismatch before bump: ${rootName}=${rootPackage.version}, ${mcpName}=${mcpPackage.version}`
  );
  process.exit(1);
}

const previousVersion = rootPackage.version;
const nextVersion = resolveNextVersion(previousVersion, bumpArg);
rootPackage.version = nextVersion;
mcpPackage.version = nextVersion;

writeJson(rootPath, rootPackage);
writeJson(mcpPath, mcpPackage);

console.log(`Bumped lockstep version: ${rootName} + ${mcpName}: ${previousVersion} -> ${nextVersion}`);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function resolveNextVersion(currentVersion, bump) {
  if (isSemverString(bump)) {
    return bump;
  }

  const parsed = parseSemver(currentVersion);
  if (!parsed) {
    throw new Error(`Current version "${currentVersion}" is not valid semver`);
  }

  const { major, minor, patch } = parsed;
  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`Unsupported bump argument "${bump}". Use patch, minor, major, or x.y.z`);
  }
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10)
  };
}

function isSemverString(value) {
  return /^\d+\.\d+\.\d+$/.test(value);
}
