import { lightTheme } from '../src/theme/ThemeProvider';
import lightMapStyle from '../src/theme/light-map-style.json';
import { mapOp } from '../src/mapHistory/ExportDraw';

test('light map hides exactly the selected POI labels and icons, preserving Google defaults elsewhere', () => {
  expect(lightTheme.mapStyle.google).toBe(lightMapStyle);
  expect(lightMapStyle).toEqual(
    [
      'poi.business',
      'poi.attraction',
      'poi.medical',
      'poi.place_of_worship',
      'poi.school',
      'poi.sports_complex',
      'poi.government',
    ].map(featureType => ({
      featureType,
      elementType: 'labels',
      stylers: [{ visibility: 'off' }],
    })),
  );
  // No parent POI rule or colour override may hide parks, transit or names.
  for (const feature of ['poi', 'poi.park', 'transit', 'transit.station', 'transit.station.airport', 'road', 'administrative']) {
    expect(lightMapStyle.some(rule => rule.featureType === feature)).toBe(false);
  }
});

test('PNG map operation carries the same fixed light style to the native lite map', () => {
  expect(mapOp({ subjects: [] }).mapStyle).toBe(lightMapStyle);
  const fs = require('fs');
  const path = require('path');
  const native = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker/HistoryExportPackage.kt'), 'utf8');
  expect(native).toContain('op.optJSONArray("mapStyle")');
  expect(native).toContain('google.setMapStyle(MapStyleOptions(it.toString()))');
});
