import * as Keychain from 'react-native-keychain';

// Supabase stores serialized sessions, never the user's login password.
// Each Supabase storage key has its own Keychain/Keystore service namespace.
export function createCloudSecureStorage(vault = Keychain) {
  const options = key => ({ service: `com.dogtracker.supabase.${key}` });
  return {
    async getItem(key) {
      const credential = await vault.getGenericPassword(options(key));
      return credential ? credential.password : null;
    },
    async setItem(key, value) {
      const saved = await vault.setGenericPassword('session', value, {
        ...options(key), accessible: vault.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      if (!saved) throw new Error('無法安全保存登入狀態');
    },
    async removeItem(key) {
      await vault.resetGenericPassword(options(key));
    },
  };
}
