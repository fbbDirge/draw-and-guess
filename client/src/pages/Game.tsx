import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Canvas from '../components/Canvas'
import Chat from '../components/Chat'
import ScoreBoard from '../components/ScoreBoard'
import './Game.css'

const COLORS = ['#000000', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c', '#34495e', '#fff']
const SIZES = [2, 4, 6, 10]

function PlayerStrip({ players, scores, myPlayerId, drawerId, lastCorrectId }: {
  players: any[]; scores: Record<string, number>; myPlayerId: string; drawerId?: string; lastCorrectId: string
}) {
  const list = players.map((p: any) => ({ ...p, score: scores[p.id] || 0 }))
  list.sort((a: any, b: any) => b.score - a.score)
  return (
    <div className="player-strip">
      {list.map((p: any, i: number) => (
        <div key={p.id} className={`player-chip ${p.id === myPlayerId ? 'me' : ''} ${p.id === lastCorrectId ? 'correct-flash' : ''}`}>
          <span className="chip-rank">#{i + 1}</span>
          {p.id === drawerId && <span className="chip-icon">✏️</span>}
          {p.isHost && <span className="chip-icon">👑</span>}
          <span className="chip-name">{p.name}</span>
          <span className="chip-score">{p.score}</span>
        </div>
      ))}
    </div>
  )
}

function MobileChat({ messages, onGuess, disabled }: {
  messages: any[]; onGuess: (g: string) => void; disabled: boolean
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || disabled) return
    onGuess(input.trim())
    setInput('')
  }

  return (
    <div className="mobile-chat">
      <div className="chat-messages">
        {messages.slice(-30).map((m: any, i: number) => (
          <div key={i} className={`chat-msg ${m.system ? 'system' : ''} ${m.isGuess ? 'guess' : ''}`}>
            {m.system ? <span>{m.message}</span> :
             m.isGuess ? <span><b>{m.userName}</b>: {m.message}</span> :
             <span><b>{m.userName}</b>: {m.message}</span>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? '等待中...' : '输入猜测...'}
          disabled={disabled} autoComplete="off"
        />
        <button type="submit" className="btn-primary btn-sm" disabled={disabled || !input.trim()}>猜</button>
      </form>
    </div>
  )
}

export default function Game({ ctx }: any) {
  const {
    connect, connected, emit, room, myPlayerId, round, wordChoices, roundEnd,
    chatMessages, scores, finalScores, gameOver,
    countdown, canvasStrokes, lastClear, lastUndo, timerBump, lastCorrectId,
    error, clearError,
  } = ctx
  const { id } = useParams()
  const navigate = useNavigate()

  const [color, setColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(4)
  const [eraser, setEraser] = useState(false)
  const [timer, setTimer] = useState(0)
  const [snapshot, setSnapshot] = useState<string>('')
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const [triedJoin, setTriedJoin] = useState(false)

  useEffect(() => {
    if (!connected) { connect(); return }
    if (!room && !gameOver && !triedJoin) {
      setTriedJoin(true)
      const username = localStorage.getItem('ddg_username') || '玩家'
      emit('join_room', { roomId: id, username })
    }
  }, [connected, room, gameOver, triedJoin, id, emit, connect])

  useEffect(() => {
    if (countdown > 0 || room?.status === 'playing') {
      const roomId = room?.id || id
      if (window.location.pathname !== `/game/${roomId}`) navigate(`/game/${roomId}`)
    }
  }, [countdown, room?.status, room?.id, id, navigate])

  useEffect(() => {
    if (round && !wordChoices) {
      setTimer(round.roundTime)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setTimer((t: number) => {
          if (t <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0 }
          return t - 1
        })
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [round?.round, round?.drawerId, wordChoices, timerBump])

  useEffect(() => {
    if (roundEnd) {
      if (timerRef.current) clearInterval(timerRef.current)
      const canvas = document.querySelector('canvas')
      if (canvas) { try { setSnapshot(canvas.toDataURL('image/png')) } catch { setSnapshot('') } }
    } else { setSnapshot('') }
  }, [roundEnd])

  useEffect(() => {
    if (error) { const t = setTimeout(() => clearError(), 3000); return () => clearTimeout(t) }
  }, [error, clearError])

  const handleStroke = useCallback((stroke: any) => emit('draw_stroke', stroke), [emit])
  const handleClear = useCallback(() => emit('clear_canvas'), [emit])
  const handleUndo = useCallback(() => emit('undo_stroke'), [emit])
  const handleGuess = useCallback((guess: string) => emit('submit_guess', { guess }), [emit])
  const handlePickWord = useCallback((idx: number) => emit('pick_word', { choiceIndex: idx }), [emit])
  const handleRefreshWords = useCallback(() => emit('refresh_words'), [emit])
  const handleNextRound = useCallback(() => emit('next_round'), [emit])

  const isDrawer = round?.isDrawer ?? false
  const isHost = myPlayerId === room?.hostId

  if (!room) {
    return (
      <div className="page game-page">
        <div className="card" style={{ textAlign: 'center' }}>
          <p>正在连接游戏...</p>
          <button className="btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/')}>返回首页</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page game-page">
      {error && <div className="error-toast" onClick={clearError}>{error}</div>}

      {gameOver && (
        <div className="game-over-overlay">
          <div className="game-over-card">
            <h2>游戏结束</h2>
            <ScoreBoard scores={scores} players={room.players} finalScores={finalScores} />
            <div className="game-over-actions">
              {isHost && <button className="btn-primary" onClick={() => emit('play_again')}>再来一局</button>}
              <button className="btn-outline" onClick={() => { emit('leave_room'); navigate('/') }}>返回首页</button>
            </div>
          </div>
        </div>
      )}

      {wordChoices && !round && !roundEnd && (
        <div className="word-picker-overlay">
          <div className="word-picker-card">
            <h3>选择要画的词</h3>
            <p className="word-picker-sub">画家: {wordChoices.drawerName} · 第 {wordChoices.round}/{wordChoices.totalRounds} 轮</p>
            <div className="word-choices">
              {wordChoices.choices.map((c, i) => (
                <button key={i} className="btn-primary word-choice-btn" onClick={() => handlePickWord(i)}>
                  {c.word}<span className="word-category">{c.category}</span>
                </button>
              ))}
            </div>
            {wordChoices.refreshLeft > 0 && (
              <button className="btn-outline btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={handleRefreshWords}>
                换一批 ({wordChoices.refreshLeft}次)
              </button>
            )}
          </div>
        </div>
      )}

      {roundEnd && (
        <div className="round-end-overlay">
          <div className="round-end-card">
            <h3>本轮结束</h3>
            <div className="round-end-answer">
              <span className="answer-label">答案是</span>
              <span className="answer-word">{roundEnd.word}</span>
              <span className="answer-cat">({roundEnd.category})</span>
            </div>
            <p className="round-end-drawer">画家: {roundEnd.drawerName}</p>
            {roundEnd.correctGuessers.length > 0 && (
              <p className="round-end-guessers">
                猜对: {roundEnd.correctGuessers.map((pid: string) => room.players.find(p => p.id === pid)?.name).join(', ')}
              </p>
            )}
            {snapshot && <div className="round-end-snapshot"><img src={snapshot} alt="画作" /></div>}
            {!roundEnd.gameEnding ? (
              <p className="round-end-next">5秒后自动开始下一轮...</p>
            ) : (
              <p className="round-end-next">游戏即将结束...</p>
            )}
          </div>
        </div>
      )}

      {round && (
        <div className="game-topbar">
          <div className="round-info">
            <span className="round-num">第{round.round}/{round.totalRounds}轮</span>
            {isDrawer ? (
              <span className="word-display drawer">
                你画: <b style={{ color: 'var(--primary)' }}>{round.word}</b>
                <span style={{ color: 'var(--text2)', fontSize: '.75rem', marginLeft: 4 }}>({round.category})</span>
              </span>
            ) : (
              <span className="word-display">
                猜: <b>{'□'.repeat(round.wordLength)}</b>
                <span style={{ color: 'var(--text2)', fontSize: '.75rem', marginLeft: 4 }}>({round.category})</span>
              </span>
            )}
            <span className={`timer ${timer <= 10 ? 'urgent' : ''}`}>{timer}s</span>
          </div>
          <div className="drawer-info">
            {!isDrawer && <span>{round.drawerName} 作画中</span>}
            {isDrawer && <span className="badge badge-drawer">你是画家</span>}
          </div>
        </div>
      )}

      <div className="game-layout">
        <div className="game-canvas-area">
          <Canvas
            strokes={canvasStrokes} onStroke={handleStroke}
            color={eraser ? '#ffffff' : color} size={eraser ? brushSize * 6 : brushSize} readonly={!isDrawer}
            lastClear={lastClear} lastUndo={lastUndo}
          />
          {isDrawer && round && (
            <div className="draw-tools">
              <div className="tool-group colors">
                {COLORS.map((c) => (
                  <button key={c} className={`color-btn ${!eraser && color === c ? 'active' : ''}`}
                    style={{ background: c }} onClick={() => { setColor(c); setEraser(false) }} />
                ))}
              </div>
              <div className="tool-group sizes">
                {SIZES.map((s) => (
                  <button key={s} className={`size-btn ${brushSize === s ? 'active' : ''}`} onClick={() => setBrushSize(s)}>
                    <span style={{ width: s * 2, height: s * 2, borderRadius: '50%', background: color, display: 'inline-block' }} />
                  </button>
                ))}
              </div>
              <div className="tool-group actions">
                <button className={eraser ? 'btn-accent btn-sm' : 'btn-outline btn-sm'} onClick={() => setEraser(!eraser)}>
                  {eraser ? '橡皮擦 ✓' : '橡皮擦'}
                </button>
                <button className="btn-outline btn-sm" onClick={handleUndo}>撤销</button>
                <button className="btn-danger btn-sm" onClick={handleClear}>清空</button>
              </div>
            </div>
          )}
          <PlayerStrip players={room.players} scores={scores} myPlayerId={myPlayerId} drawerId={round?.drawerId} lastCorrectId={lastCorrectId} />
        </div>

        <div className="game-sidebar">
          <ScoreBoard scores={scores} players={room.players} finalScores={finalScores} drawerId={round?.drawerId} />
          <Chat messages={chatMessages} onGuess={handleGuess} disabled={isDrawer || gameOver || !round} />
        </div>
      </div>

      <MobileChat messages={chatMessages} onGuess={handleGuess} disabled={isDrawer || gameOver || !!roundEnd || !!wordChoices} />
    </div>
  )
}
