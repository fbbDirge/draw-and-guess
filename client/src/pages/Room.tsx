import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ScoreBoard from '../components/ScoreBoard'
import './Room.css'

export default function Room({ ctx }: any) {
  const {
    connect, connected, emit, leaveRoom, room, myPlayerId, myPlayer,
    chatMessages, countdown, error, clearError,
  } = ctx
  const { id } = useParams()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [triedJoin, setTriedJoin] = useState(false)

  // Try to join the room on mount or reconnect
  useEffect(() => {
    if (!connected) {
      connect()
      return
    }
    if (!room && !triedJoin) {
      setTriedJoin(true)
      const username = localStorage.getItem('ddg_username') || '玩家'
      emit('join_room', { roomId: id, username })
    }
  }, [connected, room, triedJoin, id, emit, connect])

  // Navigate to game on countdown or if room is playing
  useEffect(() => {
    if (countdown > 0 || room?.status === 'playing') {
      navigate(`/game/${id}`)
    }
  }, [countdown, room?.status, id, navigate])

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => clearError(), 3000)
      return () => clearTimeout(t)
    }
  }, [error, clearError])

  function copyRoomId() {
    if (room?.id) {
      navigator.clipboard.writeText(room.id).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const isHost = myPlayer?.isHost

  if (!room) {
    return (
      <div className="page room-page">
        {error && <div className="error-toast" onClick={clearError}>{error}</div>}
        <div className="card" style={{ textAlign: 'center', maxWidth: 400, width: '100%' }}>
          <p>正在加入房间 {id}...</p>
          {!connected && <p style={{ color: 'var(--text2)', fontSize: '.85rem' }}>连接服务器中...</p>}
          <button className="btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => { leaveRoom(); navigate('/') }}>
            返回首页
          </button>
        </div>
      </div>
    )
  }

  const notReadyCount = room.players.filter((p: any) => !p.isReady).length

  return (
    <div className="page room-page">
      {error && <div className="error-toast" onClick={clearError}>{error}</div>}

      <div className="room-header">
        <div>
          <h2>房间 {room.id}</h2>
          <button className="btn-sm btn-outline" onClick={copyRoomId}>
            {copied ? '已复制' : '复制房号'}
          </button>
        </div>
        <div className="room-meta">
          <span>{room.players.length}/{room.maxPlayers}人</span>
          <span>每轮{room.roundTime}秒</span>
        </div>
      </div>

      <div className="room-layout">
        <div className="room-main">
          <div className="card">
            <h3>玩家列表</h3>
            <div className="player-list">
              {room.players.map((p: any) => (
                <div key={p.id} className={`player-item ${p.id === myPlayerId ? 'me' : ''}`}>
                  <div className="player-info">
                    <span className="player-name">
                      {p.name}
                      {p.isHost && <span className="badge badge-host">房主</span>}
                      {p.isReady ? <span className="badge badge-ready">已准备</span> :
                       <span className="badge badge-waiting">未准备</span>}
                    </span>
                  </div>
                  {isHost && !p.isHost && (
                    <button className="btn-danger btn-sm" onClick={() => emit('kick_player', { playerId: p.id })}>
                      踢出
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="room-actions">
              {isHost ? (
                <button
                  className="btn-primary"
                  onClick={() => emit('start_game')}
                  disabled={room.players.length < 2 || notReadyCount > 0}
                >
                  {room.players.length < 2 ? '至少需要2名玩家' :
                   notReadyCount > 0 ? `还有${notReadyCount}人未准备` :
                   '开始游戏'}
                </button>
              ) : (
                <button
                  className={myPlayer?.isReady ? 'btn-outline' : 'btn-accent'}
                  onClick={() => emit('toggle_ready')}
                  disabled={isHost}
                >
                  {isHost ? '房主自动准备' : (myPlayer?.isReady ? '取消准备' : '准备')}
                </button>
              )}
              <button className="btn-outline" onClick={() => { leaveRoom(); navigate('/') }}>
                离开房间
              </button>
            </div>
          </div>
        </div>

        <div className="room-sidebar">
          <ScoreBoard
            scores={room.players.reduce((acc: any, p: any) => { acc[p.id] = p.score; return acc }, {})}
            players={room.players}
            finalScores={[]}
          />
          <div className="card room-chat">
            <h3>消息</h3>
            <div className="chat-mini">
              {chatMessages.slice(-20).map((m: any, i: number) => (
                <div key={i} className={`chat-msg ${m.system ? 'system' : ''}`}>
                  {m.system ? (
                    <span className="chat-system">{m.message}</span>
                  ) : (
                    <span><b>{m.userName}</b>: {m.message}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
