import { createBleService } from './BleService';

// The one BLE service of the app: the hardware scan pages and settings →
// 接收器 (中斷連線) act on the same connection.
export const sharedBleService = createBleService();
