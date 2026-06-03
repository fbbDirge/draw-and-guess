const STORAGE_KEYS = {
  USERNAME: 'ddg_username',
  PLAYER_TOKEN: 'ddg_player_token',
  RECENT_ROOMS: 'ddg_recent_rooms',
  SETTINGS: 'ddg_settings',
}

export function getCachedUsername(): string {
  try { return localStorage.getItem(STORAGE_KEYS.USERNAME) || '' }
  catch { return '' }
}

export function setCachedUsername(name: string) {
  try { localStorage.setItem(STORAGE_KEYS.USERNAME, name) }
  catch { /* quota exceeded */ }
}

export function getPlayerToken(): string {
  const token = getStoredPlayerToken() || createPlayerToken()
  try { localStorage.setItem(STORAGE_KEYS.PLAYER_TOKEN, token) }
  catch { sessionStorage.setItem(STORAGE_KEYS.PLAYER_TOKEN, token) }
  return token
}

function getStoredPlayerToken(): string {
  try { return localStorage.getItem(STORAGE_KEYS.PLAYER_TOKEN) || sessionStorage.getItem(STORAGE_KEYS.PLAYER_TOKEN) || '' }
  catch { return sessionStorage.getItem(STORAGE_KEYS.PLAYER_TOKEN) || '' }
}

function createPlayerToken(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (randomUUID) return randomUUID.call(globalThis.crypto)
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getRecentRooms(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECENT_ROOMS)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addRecentRoom(roomId: string) {
  try {
    const rooms = getRecentRooms().filter(r => r !== roomId)
    rooms.unshift(roomId)
    localStorage.setItem(STORAGE_KEYS.RECENT_ROOMS, JSON.stringify(rooms.slice(0, 5)))
  } catch { /* ignore */ }
}
