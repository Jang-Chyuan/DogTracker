// The dense native selection regression changed the selected bitmap size
// but left Google's marker on its initial layer. Execute the patched Fabric
// setter against a minimal native-boundary double; this is not an SDK/device
// rendering test, which still needs the exact APK.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const root = path.join(__dirname, '..');
const version = require('react-native-maps/package.json').version;
const patch = fs.readFileSync(path.join(root, 'patches', `react-native-maps+${version}.patch`), 'utf8');
const markerPatch = patch.split(/^diff --git /m).find(part => part.startsWith('a/node_modules/react-native-maps/android/src/main/java/com/rnmaps/fabric/MarkerManager.java ')) || '';
const additions = markerPatch.split('\n').filter(line => (line.startsWith('+') && !line.startsWith('+++')) || line.startsWith(' ')).map(line => line.slice(1)).join('\n');
const actualSetter = additions.match(/public void setZIndex\(MapMarker view, float zIndex\) \{[\s\S]*?\n {4}\}/)?.[0] || '';

test('Fabric selection and deselection update the SDK layer after mount despite the inherited no-op setter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dogtracker-fabric-z-'));
  try {
    const java = `class MapMarker {
      int sdkZ = 31; boolean updated;
      void setZIndex(int value) { sdkZ = value; }
      void setUpdated(boolean value) { updated = value; }
    }
    class ViewGroupManager<T extends MapMarker> {
      public void setZIndex(T view, float value) { /* actual RN BaseViewManager is a no-op */ }
    }
    class FabricMarker extends ViewGroupManager<MapMarker> { ${actualSetter} }
    public class Probe {
      public static void main(String[] args) {
        FabricMarker manager = new FabricMarker(); MapMarker face = new MapMarker();
        manager.setZIndex(face, 40); System.out.println(face.sdkZ + ":" + face.updated);
        manager.setZIndex(face, 31); System.out.println(face.sdkZ + ":" + face.updated);
        MapMarker label = new MapMarker(); manager.setZIndex(label, 30.5f);
        System.out.println(label.sdkZ);
      }
    }`;
    fs.writeFileSync(path.join(dir, 'Probe.java'), java);
    execFileSync('javac', ['-d', dir, path.join(dir, 'Probe.java')], { timeout: 15000, stdio: 'pipe' });
    const result = execFileSync('java', ['-cp', dir, 'Probe'], { timeout: 5000, encoding: 'utf8' });
    expect(result.trim().split('\n')).toEqual(['40:true', '31:true', '31']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
