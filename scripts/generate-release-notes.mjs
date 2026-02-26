import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

try {
  const args = parseArgs(process.argv.slice(2));
  const rootPackagePath = path.resolve('package.json');
  const mcpPackagePath = path.resolve('packages/mocy-mcp/package.json');

  const rootPackage = readJson(rootPackagePath);
  const mcpPackage = readJson(mcpPackagePath);

  if (rootPackage.version !== mcpPackage.version) {
    throw new Error(
      `Lockstep version mismatch: mocy=${rootPackage.version}, mocy-mcp=${mcpPackage.version}`
    );
  }

  const releaseVersion = args.version ?? rootPackage.version;
  const toRef = args.to ?? 'HEAD';
  const fromRef = args.from ?? detectLatestTag();
  const commits = listCommits(fromRef, toRef);
  const notes = buildReleaseNotes({
    releaseVersion,
    fromRef,
    commits
  });

  if (args.write) {
    const changelogPath = path.resolve(args.changelog ?? 'CHANGELOG.md');
    writeChangelog(changelogPath, releaseVersion, notes);
    console.log(`Updated ${path.relative(process.cwd(), changelogPath)} with v${releaseVersion}`);
  } else {
    process.stdout.write(notes);
    if (!notes.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--write':
        parsed.write = true;
        break;
      case '--version':
        parsed.version = requireValue(argv, ++i, '--version');
        break;
      case '--from':
        parsed.from = requireValue(argv, ++i, '--from');
        break;
      case '--to':
        parsed.to = requireValue(argv, ++i, '--to');
        break;
      case '--changelog':
        parsed.changelog = requireValue(argv, ++i, '--changelog');
        break;
      default:
        throw new Error(`Unknown argument "${token}"`);
    }
  }

  return parsed;
}

function requireValue(argv, index, flagName) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runGit(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function tryRunGit(command) {
  try {
    return runGit(command);
  } catch {
    return '';
  }
}

function detectLatestTag() {
  const result = tryRunGit(
    'git for-each-ref --sort=-creatordate --count=1 --format="%(refname:short)" refs/tags'
  );
  return result || null;
}

function listCommits(fromRef, toRef) {
  const range = fromRef ? `${quoteRef(fromRef)}..${quoteRef(toRef)}` : quoteRef(toRef);
  const raw = tryRunGit(`git log --pretty=format:%h%x09%s ${range}`);
  if (!raw) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, ...subjectParts] = line.split('\t');
      return {
        hash,
        subject: subjectParts.join('\t').trim()
      };
    });
}

function quoteRef(ref) {
  return `"${String(ref).replaceAll('"', '\\"')}"`;
}

function buildReleaseNotes({ releaseVersion, fromRef, commits }) {
  const date = new Date().toISOString().slice(0, 10);
  const sections = categorizeCommits(commits);
  const fromLabel = fromRef ? `since ${fromRef}` : 'since project start';

  const lines = [];
  lines.push(`## v${releaseVersion} (${date})`);
  lines.push('');
  lines.push('### Packages');
  lines.push(`- mocy@${releaseVersion}`);
  lines.push(`- mocy-mcp@${releaseVersion}`);
  lines.push('');
  lines.push(`### Changes ${fromLabel}`);

  const orderedSections = [
    'Features',
    'Fixes',
    'Performance',
    'Refactors',
    'Documentation',
    'Tests',
    'Maintenance',
    'Other'
  ];

  let hasChanges = false;
  for (const sectionName of orderedSections) {
    const sectionCommits = sections.get(sectionName);
    if (!sectionCommits || sectionCommits.length === 0) {
      continue;
    }

    hasChanges = true;
    lines.push('');
    lines.push(`#### ${sectionName}`);
    for (const commit of sectionCommits) {
      lines.push(`- ${formatCommit(commit)} (${commit.hash})`);
    }
  }

  if (!hasChanges) {
    lines.push('');
    lines.push('- No commits found in this range.');
  }

  lines.push('');
  return lines.join('\n');
}

function categorizeCommits(commits) {
  const sections = new Map();

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.subject);
    const section = mapTypeToSection(parsed?.type);
    const bucket = sections.get(section) ?? [];
    bucket.push(commit);
    sections.set(section, bucket);
  }

  return sections;
}

function parseConventionalCommit(subject) {
  const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    type: match[1].toLowerCase(),
    scope: match[2] ?? null,
    subject: match[4]
  };
}

function mapTypeToSection(type) {
  switch (type) {
    case 'feat':
      return 'Features';
    case 'fix':
      return 'Fixes';
    case 'perf':
      return 'Performance';
    case 'refactor':
      return 'Refactors';
    case 'docs':
      return 'Documentation';
    case 'test':
      return 'Tests';
    case 'chore':
    case 'build':
    case 'ci':
    case 'revert':
      return 'Maintenance';
    default:
      return 'Other';
  }
}

function formatCommit(commit) {
  const parsed = parseConventionalCommit(commit.subject);
  if (!parsed) {
    return commit.subject;
  }

  if (parsed.scope) {
    return `${parsed.scope}: ${parsed.subject}`;
  }

  return parsed.subject;
}

function writeChangelog(changelogPath, releaseVersion, notes) {
  const versionHeader = `## v${releaseVersion} `;
  let existing = '';

  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, 'utf8');
  }

  if (existing.includes(versionHeader)) {
    throw new Error(`CHANGELOG entry for v${releaseVersion} already exists`);
  }

  const header = '# Changelog';
  let body = existing.trim();

  if (body.startsWith(header)) {
    body = body.slice(header.length).trim();
  }

  const updated = body
    ? `${header}\n\n${notes.trim()}\n\n${body}\n`
    : `${header}\n\n${notes.trim()}\n`;

  writeFileSync(changelogPath, updated, 'utf8');
}
