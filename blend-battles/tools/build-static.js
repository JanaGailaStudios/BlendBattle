'use strict';
/**
 * Build the static (GitHub Pages) edition of Blend Battles into /docs.
 *
 * GitHub Pages only serves files, so the static edition swaps the Node server for
 * public/js/static-backend.js (a browser-local implementation of the same API) and
 * rewrites absolute asset URLs to relative ones so the site works from a project
 * subpath such as https://user.github.io/BlendBattle/.
 *
 *   npm run build:static
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, '..', 'docs');

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(fromPath, toPath);
    else fs.copyFileSync(fromPath, toPath);
  }
}

/** Absolute /asset paths become page-relative so a project Pages URL works. */
function relativise(text) {
  return text
    .replace(/(["'(])\/img\//g, '$1img/')
    .replace(/(["'(])\/css\//g, '$1css/')
    .replace(/(["'(])\/vendor\//g, '$1vendor/')
    .replace(/(["'(])\/js\//g, '$1js/');
}

function transformIndex(html) {
  let out = html;
  out = relativise(out);
  // import map values must also be relative to the document
  out = out.replace('"three/addons/": "/vendor/"', '"three/addons/": "vendor/"');
  out = out.replace('"three": "/vendor/three.module.min.js"', '"three": "vendor/three.module.min.js"');
  // load the browser-local backend before the app boots
  out = out.replace(
    '<script type="module" src="js/app.js"></script>',
    '<script src="js/static-backend.js"></script>\n<script type="module" src="js/app.js"></script>'
  );
  return out;
}

function walk(dir, ext, fn) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, fn);
    else if (entry.name.endsWith(ext)) fn(full);
  }
}

function build() {
  rmrf(OUT);
  copyDir(SRC, OUT);

  const indexPath = path.join(OUT, 'index.html');
  fs.writeFileSync(indexPath, transformIndex(fs.readFileSync(indexPath, 'utf8')));

  walk(OUT, '.js', (file) => {
    const before = fs.readFileSync(file, 'utf8');
    const after = relativise(before);
    if (after !== before) fs.writeFileSync(file, after);
  });
  walk(OUT, '.css', (file) => {
    const before = fs.readFileSync(file, 'utf8');
    const after = relativise(before).replace(/url\(\/img\//g, 'url(img/');
    if (after !== before) fs.writeFileSync(file, after);
  });

  // stop GitHub Pages from running the files through Jekyll
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  // GitHub Pages for this repository publishes `main` at `/`, so the repository root needs
  // a tiny redirect into the built site (keeps the hash route when deep-linking).
  fs.writeFileSync(path.join(ROOT, '..', 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Blend Battles — Create. Render. Compete.</title>
<meta http-equiv="refresh" content="0; url=docs/" />
<script>location.replace('docs/' + location.hash);</script>
<style>
  html, body { margin: 0; height: 100%; background: #0a0a0f; color: #e7e7f0;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; display: grid; place-items: center; }
  a { color: #a78bfa; }
  .box { text-align: center; }
  .bar { width: 160px; height: 3px; border-radius: 2px; margin: 14px auto 0;
    background: linear-gradient(90deg, transparent, #a78bfa, transparent); animation: pulse 1.2s infinite; }
  @keyframes pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
</style>
</head>
<body>
  <div class="box">
    <h1 style="letter-spacing:.2em;font-size:18px;margin:0">BLEND BATTLES</h1>
    <p style="font-size:13px;color:#9aa2b8">Opening the arena…</p>
    <div class="bar"></div>
    <p style="font-size:12px;color:#6b7280">If nothing happens, <a href="docs/">continue to the demo</a>.</p>
  </div>
</body>
</html>
`);

  const html = fs.readFileSync(indexPath, 'utf8');
  const checks = [
    ['relative stylesheet', html.includes('href="css/main.css"')],
    ['relative logo', html.includes('src="img/logo.png"')],
    ['relative import map', html.includes('"three": "vendor/three.module.min.js"')],
    ['static backend injected', html.includes('src="js/static-backend.js"')],
    ['no absolute asset refs left', !/(src|href)="\/(img|css|js|vendor)\//.test(html)],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? '  ✓' : '  ✗'} ${name}`);
    if (!pass) ok = false;
  }
  const size = fs.readdirSync(OUT).length;
  console.log(`\nStatic build written to ${path.relative(process.cwd(), OUT)} (${size} top-level entries).`);
  if (!ok) process.exitCode = 1;
}

build();
