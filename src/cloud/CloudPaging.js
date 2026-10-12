// When a paged Supabase read may stop without asking for one more page.
//
// PostgREST trims every response to the project's `max-rows` (Supabase's
// default, which this project does not change: supabase/config.toml has no
// [api] max_rows). Only that cap can make a page short while rows remain, so
// a page shorter than a request at or below the cap is the last one. A request
// above the cap can come back short mid-stream; it must still read to empty.
//
// CloudDownload deliberately does not use this: it asks for exactly 1,000 rows,
// leaving no margin if the hosted setting were ever lowered, and its end of
// window becomes a checkpoint and the archive's completeness proof (see
// src/cloud/README.md). It keeps reading to an empty page.
export const CLOUD_SERVER_ROW_CAP = 1000;

/** Whether `rows` is the final page of a read that asked for `requested`. */
export function isFinalCloudPage(rows, requested) {
  if (!rows.length) return true;
  return Number.isInteger(requested) && requested > 0 && requested <= CLOUD_SERVER_ROW_CAP
    && rows.length < requested;
}
