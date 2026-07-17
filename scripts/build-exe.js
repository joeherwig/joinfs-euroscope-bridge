'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const { inject } = require('postject/dist/api.js');
const rcedit = require('rcedit');
const { generateIcon } = require('./generate-icon');

const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const bundlePath = path.join(distDir, 'bundle.cjs');
const blobPath = path.join(distDir, 'bridge.blob');
const exePath = path.join(distDir, 'joinfs-euroscope-bridge.exe');
const seaConfigPath = path.join(root, 'sea-config.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

async function main() {
  fs.mkdirSync(distDir, { recursive: true });

  console.log('Generating icon.ico from docs/JoinFS-EuroScope-bridge-icon.svg...');
  const iconPath = await generateIcon();

  console.log('Bundling src/index.js + dependencies into a single file...');
  esbuild.buildSync({
    entryPoints: [path.join(root, 'src', 'index.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundlePath,
  });

  console.log('Generating SEA blob...');
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
    cwd: root,
    stdio: 'inherit',
  });

  console.log('Copying node executable as the base for the packaged app...');
  fs.copyFileSync(process.execPath, exePath);

  // Must run before the blob injection below: rcedit's resource editor hangs
  // (spins at 100% CPU indefinitely) when pointed at an exe that already has
  // the NODE_SEA_BLOB resource injected via postject, even though it edits a
  // plain node.exe of the same size in well under a second. Editing the icon
  // and version info on the clean binary first, then injecting the blob,
  // avoids the hang and still produces a fully working SEA executable.
  console.log('Setting exe icon and version info...');
  await rcedit(exePath, {
    icon: iconPath,
    'file-version': pkg.version,
    'product-version': pkg.version,
    'version-string': {
      ProductName: 'JoinFS-EuroScope Bridge',
      FileDescription: 'JoinFS-EuroScope Bridge',
      CompanyName: 'JoinFS-EuroScope Bridge',
      OriginalFilename: 'joinfs-euroscope-bridge.exe',
      InternalName: 'joinfs-euroscope-bridge',
      LegalCopyright: 'CC BY-NC-SA 4.0',
    },
  });

  console.log('Injecting application blob into the executable...');
  await inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), {
    sentinelFuse: SENTINEL_FUSE,
    overwrite: true,
  });

  console.log('Copying default config.json...');
  fs.copyFileSync(path.join(root, 'config.example.json'), path.join(distDir, 'config.json'));

  console.log(`\nDone. Distributable folder: ${distDir}`);
  console.log('Hand users the "dist" folder contents: the .exe and config.json.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
