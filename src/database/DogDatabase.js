export function createDogDatabase() {
  return {
    async initialize() {
      throw new Error('SQLite 尚未接入；請由 database Task 選擇 SQLite driver。');
    },
    async saveStatus() {
      throw new Error('SQLite 尚未接入。');
    },
    async listHistory() {
      throw new Error('SQLite 尚未接入。');
    },
  };
}
