import { malformedTelemetryDiagnostic } from '../logger';

// A telemetry field the parsers could not read (2026-10-21: a cloud row with
// `usbPresent: 136`, 0x88, a garbled packet). The reader keeps the row with
// that field unknown and notes it here; the batch (one download, one latest
// snapshot, one upload pass) reports it once with a count: field, type and,
// for a flag only, the value. Never an id, a time or a coordinate.
export const FLAG_FIELDS = Object.freeze(['usbPresent', 'activityValid', 'batteryValid']);
const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
// Distinct field/type/value entries kept per batch (the log shows 8).
const MAX_ENTRIES = 16;

export function createMalformedFields() {
  const counts = new Map();
  let rows = 0, current = false;
  return {
    /** Starts the next row: `rows` counts rows with at least one bad field. */
    row() { current = false; },
    note(field, value) {
      try {
        if (!current) { current = true; rows += 1; }
        const type = kind(value);
        // A flag's own value is told apart (only a byte or a boolean is ever
        // logged, logger.malformedTelemetryDiagnostic); others by type only.
        const flag = FLAG_FIELDS.includes(field) && (type === 'boolean' || type === 'number');
        const key = flag ? `${field}:${type}:${String(value)}` : `${field}:${type}`;
        let entry = counts.get(key);
        if (!entry) {
          if (counts.size >= MAX_ENTRIES) return;
          entry = { field, type, ...(flag ? { value } : {}), count: 0 };
          counts.set(key, entry);
        }
        entry.count += 1;
      } catch {
        // Noting a field never fails the row.
      }
    },
    entries: () => [...counts.values()].map(entry => ({ ...entry })),
    /** One line for the batch, then empty again. Nothing seen: nothing said. */
    report(source) {
      try { if (counts.size) malformedTelemetryDiagnostic({ source, rows, fields: [...counts.values()] }); }
      catch { /* Logging never fails a batch. */ }
      counts.clear(); rows = 0; current = false;
    },
  };
}
