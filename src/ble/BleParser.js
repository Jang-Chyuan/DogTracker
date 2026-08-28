import { decode as decodeBase64 } from 'base-64';

export function decodeBleValue(value) {
  return decodeBase64(value).replace(/\0/g, '').trim();
}

export function parseBlePayload(value) {
  const payload = decodeBleValue(value);
  const start = payload.indexOf('{');
  const end = payload.indexOf('}', start);
  if (start < 0 || end < start) {
    return { payload: '', remainder: payload, data: null };
  }

  return {
    payload: payload.slice(start, end + 1),
    remainder: payload.slice(end + 1),
    data: JSON.parse(payload.slice(start, end + 1)),
  };
}
