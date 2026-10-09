#!/usr/bin/env node
// On-device touch and TalkBack audit (060): reads `uiautomator dump` XML files
// and lists, per screen, every clickable or focusable control with
//   - no TalkBack words (no content-desc and no text),
//   - a box under 48dp in either direction (hitSlop does not show in the dump:
//     each one is checked against __tests__/TouchTargets.test.js, which
//     requires the slop that makes up the difference).
//
//   adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml shot.xml
//   node scripts/touch-audit.js [--density 2.75] shot.xml [more.xml …]
//
// Only the app's own nodes (package com.dogtracker) count; the Google map's
// own markers and tiles are left out (the map SDK draws them).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let density = 2.75; // Pixel 4a: 440 dpi
const files = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--density') density = Number(args[(i += 1)]);
  else files.push(args[i]);
}
const MIN = 48;

const attr = (node, name) => {
  const match = node.match(new RegExp(` ${name}="([^"]*)"`));
  return match ? match[1] : '';
};

let problems = 0;
for (const file of files) {
  const xml = fs.readFileSync(file, 'utf8');
  const nodes = xml.match(/<node [^>]*>/g) || [];
  const lines = [];
  for (const node of nodes) {
    if (attr(node, 'package') !== 'com.dogtracker') continue;
    const clickable = attr(node, 'clickable') === 'true';
    const focusable = attr(node, 'focusable') === 'true';
    if (!clickable && !focusable) continue;
    const cls = attr(node, 'class');
    // The map surface and scroll containers are not controls.
    if (/MapView|ScrollView|RecyclerView|GoogleMap/.test(cls)) continue;
    const [x1, y1, x2, y2] = (attr(node, 'bounds').match(/\d+/g) || []).map(Number);
    const width = Math.round((x2 - x1) / density);
    const height = Math.round((y2 - y1) / density);
    const words = attr(node, 'content-desc') || attr(node, 'text');
    const id = attr(node, 'resource-id');
    const name = words || id || cls;
    if (clickable && !words) {
      lines.push(`  no words      ${name} ${width}×${height}dp`);
      problems += 1;
    }
    if (clickable && (width < MIN || height < MIN) && width > 0 && height > 0) {
      lines.push(`  ${width}×${height}dp     ${name}  (hitSlop? see TouchTargets.test.js)`);
    }
  }
  console.log(`${path.basename(file)}${lines.length ? '' : '  ok'}`);
  lines.forEach(line => console.log(line));
}
process.exitCode = problems ? 1 : 0;
