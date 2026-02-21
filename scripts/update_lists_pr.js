const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getChangedDomainFiles(baseRef) {
  const diffCmd = `git diff --name-status origin/${baseRef}...HEAD`;
  const out = execSync(diffCmd).toString().trim();
  if (!out) return [];
  const lines = out.split('\n');
  const files = [];
  for (const line of lines) {
    const [status, filePath] = line.split('\t');
    if (!filePath) continue;
    if (!filePath.startsWith('domains/') || !filePath.endsWith('.json')) continue;
    files.push({ status, filePath });
  }
  return files;
}

function extractName(filePath) {
  const base = path.basename(filePath);
  // Expect something like "name.is-app.top.json"
  const parts = base.split('.');
  if (parts.length < 4) return null;
  return parts[0];
}

function readListFile(listPath) {
  if (!fs.existsSync(listPath)) return {};
  const lines = fs.readFileSync(listPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const map = {};
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*"([^"]+)"$/);
    if (m) {
      map[m[1]] = m[2];
    }
  }
  return map;
}

function writeListFile(listPath, map) {
  const entries = Object.keys(map).sort().map(name => `${name}: "${map[name]}"`);
  fs.writeFileSync(listPath, entries.join('\n') + (entries.length ? '\n' : ''), 'utf8');
}

try {
  const baseRef = process.env.GITHUB_BASE_REF || 'main';
  try {
    execSync(`git fetch origin ${baseRef}`);
  } catch {}

  const changed = getChangedDomainFiles(baseRef);
  if (changed.length === 0) {
    console.log('No domain JSON changes detected. Skipping lists.txt update.');
    process.exit(0);
  }

  const listPath = path.join(process.cwd(), 'lists.txt');
  const map = readListFile(listPath);

  let modified = false;
  for (const { status, filePath } of changed) {
    let name = null;

    if (status === 'A' || status === 'M') {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.trim()) {
          console.warn(`File ${filePath} is empty.`);
        } else {
          const json = JSON.parse(content);
          if (json.subdomain) {
            name = json.subdomain.toLowerCase();
          }
        }
      } catch (e) {
        console.warn(`Failed to parse ${filePath}: ${e.message}`);
      }
    }

    if (!name) {
      name = extractName(filePath);
    }

    if (!name) {
      console.warn(`Could not determine subdomain name for ${filePath}. Skipping.`);
      continue;
    }

    if (status === 'A' || status === 'M') {
      // Set to pending if not active already
      if (map[name] !== 'active' && map[name] !== 'pending') {
        map[name] = 'pending';
        modified = true;
      } else if (map[name] === 'pending') {
        // keep pending
      }
    } else if (status === 'D') {
      // Remove from list if present (deleted or rejected)
      if (map.hasOwnProperty(name)) {
        delete map[name];
        modified = true;
      }
    }
  }

  if (modified) {
    writeListFile(listPath, map);
    console.log('lists.txt updated.');
  } else {
    console.log('lists.txt not changed.');
  }
} catch (e) {
  console.error('Failed updating lists.txt:', e.message);
  process.exit(1);
}
