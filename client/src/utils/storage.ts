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
  try {
    let token = localStorage.getItem(STORAGE_KEYS.PLAYER_TOKEN)
    if (!token) {
      token = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEYS.PLAYER_TOKEN, token)
    }
    return token
  } catch {
    return 'fallback-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }
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
