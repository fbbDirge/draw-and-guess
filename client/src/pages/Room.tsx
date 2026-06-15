import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getPlayerToken } from '../utils/storage'
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
  const [copyError, setCopyError] = useState('')
  const [triedJoin, setTriedJoin] = useState(false)

  // Try to join the room on mount or reconnect
  useEffect(() => {
    if (!connected) {
      connect()
      return
    }
    if (!room && !triedJoin) {
      setTriedJoin(true)
      const username = (localStorage.getItem('ddg_username') || '').trim()
      // 通过房间链接直连但本地没有昵称时，跳回首页填昵称后再加入，
      // 避免出现默认的「玩家」匿名身份。
      if (!username) {
        navigate(`/?join=${id}`, { replace: true })
        return
      }
      emit('join_room', { roomId: id, username, playerToken: getPlayerToken() })
    }
  }, [connected, room, triedJoin, id, emit, connect, navigate])

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

  async function copyRoomId() {
    if (!room?.id) return

    const ok = await copyText(room.id)
    if (ok) {
      setCopied(true)
      setCopyError('')
      setTimeout(() => setCopied(false), 2000)
      return
    }

    setCopyError(`复制失败，请手动复制房号 ${room.id}`)
    setTimeout(() => setCopyError(''), 3000)
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {}

    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.readOnly = true
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      textarea.setSelectionRange(0, text.length)
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      return ok
    } catch {
      return false
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

  const activePlayers = room.players.filter((p: any) => p.role !== 'spectator')
  const spectators = room.players.filter((p: any) => p.role === 'spectator')
  const notReadyCount = activePlayers.filter((p: any) => !p.isReady && !p.isHost).length
  const isSpectator = myPlayer?.role === 'spectator'

  return (
    <div className="page room-page">
      {error && <div className="error-toast" onClick={clearError}>{error}</div>}

      <div className="room-header">
        <div>
          <h2>房间 {room.id}</h2>
          <button className="btn-sm btn-outline" onClick={copyRoomId}>
            {copied ? '已复制' : '复制房号'}
          </button>
          {copyError && <p style={{ color: 'var(--danger)', fontSize: '.8rem', marginTop: 6 }}>{copyError}</p>}
        </div>
        <div className="room-meta">
          <span>玩家 {activePlayers.length}/{room.maxPlayers}</span>
          <span>观众 {spectators.length}</span>
          <span>每轮{room.roundTime}秒</span>
        </div>
      </div>

      <div className="room-layout">
        <div className="room-main">
          <div className="card">
            <h3>玩家列表</h3>
            <div className="player-list">
              {activePlayers.map((p: any) => (
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

            {spectators.length > 0 && (
              <>
                <h3 style={{ marginTop: 18 }}>观众席</h3>
                <div className="player-list">
                  {spectators.map((p: any) => (
                    <div key={p.id} className={`player-item ${p.id === myPlayerId ? 'me' : ''}`}>
                      <div className="player-info">
                        <span className="player-name">
                          {p.name}
                          <span className="badge badge-waiting">观众</span>
                        </span>
                      </div>
                      {isHost && (
                        <button className="btn-danger btn-sm" onClick={() => emit('kick_player', { playerId: p.id })}>
                          踢出
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="room-actions">
              {isHost ? (
                <button
                  className="btn-primary"
                  onClick={() => emit('start_game')}
                  disabled={activePlayers.length < 2 || notReadyCount > 0}
                >
                  {activePlayers.length < 2 ? '至少需要2名玩家' :
                   notReadyCount > 0 ? `还有${notReadyCount}人未准备` :
                   '开始游戏'}
                </button>
              ) : isSpectator ? (
                <button
                  className="btn-outline"
                  onClick={() => emit('switch_role', { role: 'player' })}
                  disabled={room.status !== 'waiting'}
                >
                  {room.status === 'waiting' ? '加入玩家席' : '游戏中观战'}
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
              {!isHost && !isSpectator && room.status === 'waiting' && (
                <button className="btn-outline" onClick={() => emit('switch_role', { role: 'spectator' })}>
                  去观众席
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
            scores={activePlayers.reduce((acc: any, p: any) => { acc[p.id] = p.score; return acc }, {})}
            players={activePlayers}
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
