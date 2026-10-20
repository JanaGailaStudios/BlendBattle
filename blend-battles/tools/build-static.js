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
