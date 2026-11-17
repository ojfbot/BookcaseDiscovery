import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const allFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw Error('unsafe-ledger-release');
  return entry.isDirectory() ? allFiles(path) : [path];
}).sort();
export function verifyLedgerRelease(directory) {
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw Error('unsafe-ledger-release');
  const names = allFiles(directory);
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.name !== 'bookcase-ledger-job' || manifest.clean !== true || manifest.version !== '0.1.0' ||
      !/^[a-f0-9]{40}$/.test(manifest.commit) || !/^[a-f0-9]{64}$/.test(manifest.fixtureSha256) ||
      manifest.events !== 21 || manifest.node_floor !== '24.22.2' || !manifest.files || typeof manifest.files !== 'object') throw Error('invalid-ledger-release');
  const files = names.map(file => relative(directory, file)).filter(file => file !== 'manifest.json');
  if (JSON.stringify(files.sort()) !== JSON.stringify(Object.keys(manifest.files).sort()) || !files.includes('src/ledger/ledger-job.mjs')) throw Error('ledger-release-file-mismatch');
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (isAbsolute(file) || file.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(digest) || hash(readFileSync(join(directory, file))) !== digest) throw Error('ledger-release-hash-mismatch');
  }
  return manifest;
}
export function installLedgerRelease({ release, root, node }) {
  if (![release, root, node].every(isAbsolute)) throw Error('absolute-install-paths-required');
  const info = lstatSync(node);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o022)) throw Error('unsafe-node-binary');
  const requirement = 'identifier node and anchor apple generic and certificate leaf[subject.OU] = HX7739G8FX';
  const signed = binary => execFileSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, binary], { stdio: 'ignore' });
  signed(node);
  const manifest = verifyLedgerRelease(release);
  const version = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
  const match = /^v24\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 2)) throw Error('unsupported-node-version');
  const parent = join(root, 'ledger-job'); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentInfo = lstatSync(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || parentInfo.uid !== process.getuid?.() || (parentInfo.mode & 0o077)) throw Error('unsafe-install-root');
  const current = join(parent, 'current');
  if (existsSync(current) && !lstatSync(current).isSymbolicLink()) throw Error('unsafe-current-link');
  const target = join(parent, manifest.version), link = join(parent, `.current-${process.pid}`);
  mkdirSync(target, { mode: 0o700 }); // Never replace, reuse or add to an existing version.
  let complete = false;
  try {
    cpSync(release, join(target, 'app'), { recursive: true, dereference: false });
    cpSync(node, join(target, 'node'));
    signed(join(target, 'node'));
    if (hash(readFileSync(node)) !== hash(readFileSync(join(target, 'node')))) throw Error('node-copy-mismatch');
    verifyLedgerRelease(join(target, 'app'));
    const actual = JSON.parse(execFileSync(join(target, 'node'), [join(target, 'app/src/ledger/ledger-job.mjs'), 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    if (actual.clean !== true || actual.commit !== manifest.commit || actual.fixtureSha256 !== manifest.fixtureSha256) throw Error('installed-release-identity-mismatch');
    writeFileSync(join(target, 'install.json'), `${JSON.stringify({ schemaVersion: 1, version: manifest.version, commit: manifest.commit, nodeVersion: version, nodeSha256: hash(readFileSync(node)), releaseManifestSha256: hash(readFileSync(join(release, 'manifest.json'))), signatureCheckedBy: '/usr/bin/codesign' }, null, 2)}\n`, { mode: 0o400 });
    for (const file of allFiles(target)) chmodSync(file, file === join(target, 'node') ? 0o500 : 0o400);
    symlinkSync(manifest.version, link); renameSync(link, current); complete = true;
    return { installed: true, version: manifest.version, commit: manifest.commit };
  } finally {
    if (!complete) rmSync(target, { recursive: true, force: true });
    rmSync(link, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 6 || args[0] !== '--release' || args[2] !== '--root' || args[4] !== '--node') throw Error('invalid-installer-arguments');
    console.log(JSON.stringify(installLedgerRelease({ release: resolve(args[1]), root: resolve(args[3]), node: resolve(args[5]) })));
  } catch { process.stderr.write('ledger-install-refused\n'); process.exitCode = 1; }
}
