import { CLOUD_SERVER_ROW_CAP, isFinalCloudPage } from '../src/cloud/CloudPaging';

const rows = count => Array.from({ length: count }, (_, index) => ({ index }));

test('an empty page always ends a read', () => {
  expect(isFinalCloudPage([], 500)).toBe(true);
  expect(isFinalCloudPage([], 5000)).toBe(true);
});

test('within the server cap a short page ends the read and a full page does not', () => {
  expect(CLOUD_SERVER_ROW_CAP).toBe(1000);
  expect(isFinalCloudPage(rows(499), 500)).toBe(true);
  expect(isFinalCloudPage(rows(1), 500)).toBe(true);
  expect(isFinalCloudPage(rows(500), 500)).toBe(false);
  expect(isFinalCloudPage(rows(999), 1000)).toBe(true);
  expect(isFinalCloudPage(rows(1000), 1000)).toBe(false);
});

test('above the server cap a short page may be the cap, so only an empty page ends the read', () => {
  expect(isFinalCloudPage(rows(1000), 2000)).toBe(false);
  expect(isFinalCloudPage(rows(10), 2000)).toBe(false);
  expect(isFinalCloudPage(rows(10), undefined)).toBe(false);
  expect(isFinalCloudPage(rows(10), 0)).toBe(false);
});
