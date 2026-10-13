// DESIGN.md §9.5「選中的狗浮到最上層」: on Android with the new architecture,
// react-native-maps' Fabric MarkerManager only read zIndex into the initial
// MarkerOptions, and the inherited BaseViewManager.setZIndex is a no-op, so a
// later change (opening a dog's card, or a dog becoming a group-tag leader)
// left Google's marker on its first layer. The patch overrides the setter
// (DOGTRACKER_FABRIC_MARKER_ZINDEX). This runs the patched setter, as written
// in the patch, against a minimal native-boundary double; it is not an
// SDK/device rendering test, which still needs the APK.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..');
const MARK = 'DOGTRACKER_FABRIC_MARKER_ZINDEX';
const MARKER_MANAGER = 'android/src/main/java/com/rnmaps/fabric/MarkerManager.java';
const mapsPackage = require('react-native-maps/package.json');
const patch = fs.readFileSync(
  path.join(root, 'patches', `react-native-maps+${mapsPackage.version}.patch`),
  'utf8',
);
const markerPatch =
  patch
    .split(/^diff --git /m)
    .find(part => part.startsWith(`a/node_modules/react-native-maps/${MARKER_MANAGER} `)) || '';
// The patched file as the hunk leaves it: added and context lines.
const patched = markerPatch
  .split('\n')
  .filter(line => (line.startsWith('+') && !line.startsWith('+++')) || line.startsWith(' '))
  .map(line => line.slice(1))
  .join('\n');
const setter =
  patched.match(/public void setZIndex\(MapMarker view, float zIndex\) \{[\s\S]*?\n {4}\}/)?.[0] || '';

test('the patch overrides the Fabric marker zIndex setter, and the install applied it', () => {
  expect(markerPatch).toContain(MARK);
  expect(setter).toContain('view.setZIndex(Math.round(zIndex));');
  const installed = fs.readFileSync(
    path.join(path.dirname(require.resolve('react-native-maps/package.json')), MARKER_MANAGER),
    'utf8',
  );
  expect(installed).toContain(MARK);
  expect(installed).toContain(setter);
});

test('selection, deselection and the group-tag +2 move the SDK marker after it was created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dogtracker-fabric-z-'));
  try {
    // Levels from GoogleTrackingMap's DogMarker: 31 plain, 34 problem,
    // +2 while carrying a group tag, 40 selected.
    const java = `class MapMarker {
      int sdkZ = 31; boolean updated;
      void setZIndex(int value) { sdkZ = value; }
      void setUpdated(boolean value) { updated = value; }
    }
    class ViewGroupManager<T extends MapMarker> {
      public void setZIndex(T view, float value) { /* RN's BaseViewManager: no-op on Fabric */ }
    }
    class FabricMarker extends ViewGroupManager<MapMarker> { ${setter} }
    public class Probe {
      static String step(FabricMarker m, MapMarker v, float z) {
        v.updated = false; m.setZIndex(v, z); return v.sdkZ + ":" + v.updated;
      }
      public static void main(String[] args) {
        FabricMarker m = new FabricMarker(); MapMarker dog = new MapMarker();
        System.out.println(step(m, dog, 40));
        System.out.println(step(m, dog, 31));
        System.out.println(step(m, dog, 33));
        System.out.println(step(m, dog, 36));
        System.out.println(step(m, dog, 34));
        System.out.println(step(m, new MapMarker(), 30.5f));
      }
    }`;
    fs.writeFileSync(path.join(dir, 'Probe.java'), java);
    execFileSync('javac', ['-d', dir, path.join(dir, 'Probe.java')], { timeout: 30000, stdio: 'pipe' });
    const result = execFileSync('java', ['-cp', dir, 'Probe'], { timeout: 10000, encoding: 'utf8' });
    expect(result.trim().split('\n')).toEqual([
      '40:true', // card opened: on top
      '31:true', // card closed: back down
      '33:true', // became the group-tag leader: +2
      '36:true', // problem dog leading a group
      '34:true', // group dissolved
      '31:true', // fractional levels round like MarkerOptions
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
