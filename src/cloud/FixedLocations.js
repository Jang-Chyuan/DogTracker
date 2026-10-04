const fields = 'slave_id,master_id,name,latitude,longitude,enabled,updated_at,updated_by';

export function validateFixedLocation(value) {
  const latitude = Number(String(value.latitude).trim());
  const longitude = Number(String(value.longitude).trim());
  if (!String(value.latitude ?? '').trim() || !String(value.longitude ?? '').trim()
    || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error('請輸入有效的緯度（-90～90）與經度（-180～180）');
  }
  const name = String(value.name ?? '').trim();
  if (!name || name.length > 80) throw new Error('請輸入位置名稱（最多 80 字）');
  if (!Number.isInteger(value.slave_id) || value.slave_id < 1 || value.slave_id > 255
    || !Number.isInteger(value.master_id) || value.master_id < 1 || value.master_id > 65535) {
    throw new Error('Slave 或 Master 編號無效');
  }
  if (typeof value.enabled !== 'boolean') throw new Error('啟用設定無效');
  return { slave_id: value.slave_id, master_id: value.master_id,
    name, latitude, longitude, enabled: value.enabled };
}

async function requireUser(client, owner) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!owner || data?.user?.id !== owner) throw new Error('請先登入目前的雲端帳號');
  return data.user;
}

export async function readFixedLocation(client, owner, slaveId) {
  await requireUser(client, owner);
  const { data, error } = await client.from('slave_fixed_locations')
    .select(fields).eq('slave_id', slaveId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveFixedLocation(client, owner, value) {
  const row = validateFixedLocation(value);
  const user = await requireUser(client, owner);
  const { data, error } = await client.from('slave_fixed_locations')
    .upsert({ ...row, updated_by: user.id }, { onConflict: 'slave_id' })
    .select(fields).single();
  if (error) throw error;
  return data;
}
