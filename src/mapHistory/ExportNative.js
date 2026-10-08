// The native side of the history export (HistoryExportPackage.kt): font
// widths for the PNG layout, writing the GPX/CSV text, painting the PNG
// pages (map included), Android's share sheet, and the temporary files in
// the app's cache (history_exports/<export id>/). null without the module.
import { NativeModules } from 'react-native';

export function nativeExporter(native = NativeModules.HistoryExport) {
  if (!native?.renderPng) return null;
  return {
    charWidths: chars => native.charWidths(chars),
    writeText: (directory, filename, text) => native.writeText(directory, filename, text),
    renderPng: (exportId, directory, pages) => native.renderPng(exportId, directory, JSON.stringify(pages)),
    share: (paths, mime) => native.share(paths, mime),
    cancel: exportId => native.cancel(exportId),
    listExports: () => native.listExports(),
    removeExports: directories => native.removeExports(directories),
  };
}
