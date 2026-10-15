/**
 * Large reads, a page at a time (稽核 A F3). On Android every call is one
 * read on one of the native reader connections; a result too large for one
 * cursor window is read again holding the write lock, which keeps the BLE and
 * phone-route writers waiting, and the whole page crosses the bridge as one
 * JSON string. READ_PAGE_ROWS rows of a wide row (`SELECT *` with the raw
 * payload) stay well inside one 2 MB window.
 */
export const READ_PAGE_ROWS = 1000;

const rowsOf = result => result?.results || result?.rows?._array || [];

/**
 * Up to `limit` rows in `page`'s order. `page(last, size)` returns
 * `{ query, params }` for at most `size` rows after `last` (null on the first
 * page); its ORDER BY must be a strict order that `last` continues. A page
 * shorter than asked is the last one.
 */
export async function readPages(connection, page, limit, pageRows = READ_PAGE_ROWS) {
  const all = [];
  let last = null;
  while (all.length < limit) {
    const want = Math.min(pageRows, limit - all.length);
    const { query, params } = page(last, want);
    const batch = rowsOf(await connection.executeAsync(query, params));
    for (const row of batch) all.push(row);
    if (batch.length < want) break;
    last = batch[batch.length - 1];
  }
  return all;
}
