import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getCachedUsername, setCachedUsername, getRecentRooms, addRecentRoom } from '../utils/storage'
import './Home.css'

export default function Home({ ctx }: any) {
  const { connect, connected, emit, room, error, clearError } = ctx
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [username, setUsername] = useState(getCachedUsername)
  // 从房间链接直连但缺昵称时会被重定向到 /?join=房号，这里预填房号引导填昵称后加入。
  const joinParam = (searchParams.get('join') || '').replace(/\D/g, '').slice(0, 6)
  const [joinRoomId, setJoinRoomId] = useState(joinParam)
  const [maxPlayers, setMaxPlayers] = useState(8)
  const [roundTime, setRoundTime] = useState(60)
  const [recentRooms, setRecentRooms] = useState<string[]>(getRecentRooms())

  useEffect(() => {
    if (!connected) connect()
  }, [connect, connected])

  // Navigate when room is set (created/joined)
  useEffect(() => {
    if (room) {
      addRecentRoom(room.id)
      navigate(`/room/${room.id}`)
    }
  }, [room, navigate])

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => clearError(), 3000)
      return () => clearTimeout(t)
    }
  }, [error, clearError])

  function handleCreate() {
    if (!username.trim()) return
    setCachedUsername(username.trim())
    emit('create_room', { username: username.trim(), maxPlayers, roundTime })
  }

  function handleJoin() {
    if (!username.trim() || !joinRoomId.trim()) return
    setCachedUsername(username.trim())
    emit('join_room', { roomId: joinRoomId.trim(), username: username.trim() })
  }

  const playerCounts = [2, 4, 6, 8, 10, 12, 16, 20, 30]
  const timeOptions = [30, 45, 60, 90, 120]

  return (
    <div className="page home-page">
      {error && <div className="error-toast" onClick={clearError}>{error}</div>}

      <h1 className="title">你画我猜</h1>
      <p className="subtitle">多人实时绘画猜词游戏</p>

      <div className="card home-card">
        {joinParam && (
          <div className="join-hint">
            请先填写昵称即可加入房间 <b>{joinParam}</b>
          </div>
        )}
        <div className="form-group">
          <label>你的昵称</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="输入昵称..."
            maxLength={12}
            autoFocus={!!joinParam}
          />
        </div>

        <div className="section">
          <h3>创建房间</h3>
          <div className="form-group">
            <label>房间人数上限</label>
            <div className="chip-group">
              {playerCounts.map((n) => (
                <button
                  key={n}
                  className={`chip ${maxPlayers === n ? 'active' : ''}`}
                  onClick={() => setMaxPlayers(n)}
                >{n}人</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>每轮时间</label>
            <div className="chip-group">
              {timeOptions.map((t) => (
                <button
                  key={t}
                  className={`chip ${roundTime === t ? 'active' : ''}`}
                  onClick={() => setRoundTime(t)}
                >{t}秒</button>
              ))}
            </div>
          </div>
          <button
            className="btn-primary"
            style={{ width: '100%', marginTop: 8 }}
            onClick={handleCreate}
            disabled={!username.trim() || !connected}
          >
            创建房间
          </button>
        </div>

        <div className="divider"><span>或</span></div>

        <div className="section">
          <h3>加入房间</h3>
          <div className="form-group">
            <label>房间号</label>
            <div className="join-row">
              <input
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="输入6位房间号"
                maxLength={6}
                type="tel"
              />
              <button
                className="btn-primary"
                onClick={handleJoin}
                disabled={!username.trim() || joinRoomId.length < 6 || !connected}
              >
                加入
              </button>
            </div>
          </div>
        </div>

        {recentRooms.length > 0 && (
          <div className="section">
            <h3>最近房间</h3>
            <div className="recent-rooms">
              {recentRooms.map((id) => (
                <button
                  key={id}
                  className="btn-outline btn-sm"
                  onClick={() => {
                    if (!username.trim()) return
                    setCachedUsername(username.trim())
                    setJoinRoomId(id)
                    emit('join_room', { roomId: id, username: username.trim() })
                  }}
                >{id}</button>
              ))}
            </div>
          </div>
        )}

        {!connected && (
          <p style={{ color: 'var(--text2)', textAlign: 'center', marginTop: 12, fontSize: '.85rem' }}>
            正在连接服务器...
          </p>
        )}
      </div>
    </div>
  )
}
