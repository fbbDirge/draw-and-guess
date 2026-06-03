import { useState, useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { getPlayerToken } from '../utils/storage'

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || ''

export interface Player {
  id: string; name: string; isHost: boolean; isReady: boolean; role?: 'player' | 'spectator'; score: number; connected?: boolean; token?: string
}

export interface RoomState {
  id: string; maxPlayers: number; roundTime: number
  status: 'waiting' | 'playing' | 'finished'
  hostId: string; players: Player[]; currentRound: number; totalRounds: number
}

export interface RoundInfo {
  round: number; totalRounds: number
  drawerId: string; drawerName: string
  word?: string; wordLength: number; category: string
  roundTime: number; isDrawer: boolean; canvasVersion?: number
}

export interface WordChoice {
  word: string; category: string
}

export interface WordChoicesData {
  drawerId: string; drawerName: string
  choices: WordChoice[]; refreshLeft: number
  round: number; totalRounds: number; roundTime: number
}

export interface RoundEndData {
  word: string; category: string
  drawerId: string; drawerName: string
  correctGuessers: string[]
  scores: Record<string, number>
  gameEnding: boolean
  finalScores?: { id: string; name: string; score: number }[]
}

export interface ChatMessage {
  system?: boolean; userId?: string; userName?: string
  message: string; isGuess?: boolean
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [room, setRoom] = useState<RoomState | null>(null)
  const [myPlayerId, setMyPlayerId] = useState<string>('')
  const [myPlayer, setMyPlayer] = useState<Player | null>(null)
  const [round, setRound] = useState<RoundInfo | null>(null)
  const [wordChoices, setWordChoices] = useState<WordChoicesData | null>(null)
  const [roundEnd, setRoundEnd] = useState<RoundEndData | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [scores, setScores] = useState<Record<string, number>>({})
  const [finalScores, setFinalScores] = useState<{ id: string; name: string; score: number }[]>([])
  const [gameOver, setGameOver] = useState(false)
  const [countdown, setCountdown] = useState(-1)
  const [canvasStrokes, setCanvasStrokes] = useState<any[]>([])
  const [lastClear, setLastClear] = useState(0)
  const [canvasVersion, setCanvasVersion] = useState(0)
  const [timerBump, setTimerBump] = useState(0)
  const [lastCorrectId, setLastCorrectId] = useState<string>('')
  const canvasVersionRef = useRef(0)
  const gameEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string>('')
  const playerTokenRef = useRef(getPlayerToken())
  const roomRef = useRef<RoomState | null>(null)
  const myPlayerIdRef = useRef('')

  const addChat = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => [...prev.slice(-200), msg])
  }, [])

  const syncRoom = useCallback((nextRoom: RoomState | null, nextPlayer?: Player | null) => {
    roomRef.current = nextRoom
    setRoom(nextRoom)

    if (!nextRoom) {
      myPlayerIdRef.current = ''
      setMyPlayerId('')
      setMyPlayer(null)
      return
    }

    const me = nextPlayer || nextRoom.players.find((p) => p.id === myPlayerIdRef.current)
      || nextRoom.players.find((p) => p.id === playerTokenRef.current || p.token === playerTokenRef.current)
      || null

    if (me) {
      myPlayerIdRef.current = me.id
      setMyPlayerId(me.id)
      setMyPlayer(me)
    }
  }, [])

  const connect = useCallback(() => {
    if (socketRef.current) return
    const s = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity,
    })
    socketRef.current = s

    s.on('connect', () => {
      setConnected(true)
      const currentRoom = roomRef.current
      if (currentRoom?.id) {
        const username = localStorage.getItem('ddg_username') || '玩家'
        s.emit('join_room', {
          roomId: currentRoom.id,
          username,
          playerToken: playerTokenRef.current,
        })
      }
    })
    s.on('disconnect', () => setConnected(false))

    s.on('room_created', (data: any) => {
      syncRoom(data.room, data.player)
      addChat({ system: true, message: `房间 ${data.roomId} 创建成功` })
    })

    s.on('room_joined', (data: any) => {
      syncRoom(data.room, data.player)
      if (data.roomId || data.room?.id) s.emit('get_room_state', { roomId: data.roomId || data.room.id })
    })

    s.on('kicked', (data: any) => {
      syncRoom(null); setError(data.message || '你被移出房间'); s.disconnect()
    })

    s.on('room_update', (data: any) => {
      syncRoom(data.room)
    })

    s.on('game_starting', (data: any) => setCountdown(data.countdown))

    s.on('word_choices', (data: WordChoicesData) => {
      setWordChoices(data)
      setRound(null)
      setRoundEnd(null)
    })

    s.on('round_start', (data: RoundInfo) => {
      setRound(data); setWordChoices(null); setRoundEnd(null)
      setGameOver(false); setCountdown(-1)
      canvasVersionRef.current = data.canvasVersion || 0
      setCanvasVersion(canvasVersionRef.current)
      setCanvasStrokes([])
      setLastClear(Date.now())
    })

    s.on('draw_stroke', (data: any) => {
      const strokeVersion = data?.canvasVersion || 0
      setCanvasStrokes((prev) => {
        if (strokeVersion && strokeVersion < canvasVersionRef.current) return prev
        if (strokeVersion > canvasVersionRef.current) {
          canvasVersionRef.current = strokeVersion
          setCanvasVersion(strokeVersion)
          return [data]
        }
        return [...prev, data]
      })
    })
    s.on('canvas_cleared', (data: any) => {
      const nextVersion = data?.canvasVersion || 0
      canvasVersionRef.current = nextVersion
      setCanvasVersion(nextVersion)
      setLastClear(Date.now()); setCanvasStrokes([])
      // Dispatch custom event so Canvas can forceClear via ref
      window.dispatchEvent(new CustomEvent('ddg:forceClear'))
    })
    s.on('undo_stroke', (data: any) => {
      const strokeId = data?.strokeId
      if (!strokeId) return
      setCanvasStrokes((prev) => prev.filter((seg: any) => seg?.strokeId !== strokeId))
    })

    s.on('canvas_state', (data: any) => {
      const nextVersion = data?.canvasVersion || 0
      canvasVersionRef.current = nextVersion
      setCanvasVersion(nextVersion)
      setCanvasStrokes(Array.isArray(data?.strokes) ? data.strokes : [])
      setLastClear(Date.now())
    })

    s.on('guess_result', (data: any) => {
      if (data.scores) setScores(data.scores)
      if (data.correct && data.playerId) {
        setLastCorrectId(data.playerId)
        setTimeout(() => setLastCorrectId(''), 2000)
      }
    })

    s.on('round_end', (data: RoundEndData) => {
      setRoundEnd(data); setRound(null)
      if (data.scores) setScores(data.scores)
      // Fallback: if this is the last round, ensure the game-over panel shows
      // even if the server's game_end event is lost or delayed.
      if (data.gameEnding && data.finalScores) {
        if (gameEndTimerRef.current) clearTimeout(gameEndTimerRef.current)
        gameEndTimerRef.current = setTimeout(() => {
          setGameOver(true)
          setFinalScores(data.finalScores!)
          setRoundEnd(null)
        }, 6000)
      }
    })

    s.on('timer_shorten', (data: any) => {
      setRound((prev) => prev ? { ...prev, roundTime: data.seconds } : null)
      setTimerBump((n) => n + 1)
    })

    s.on('game_end', (data: any) => {
      if (gameEndTimerRef.current) { clearTimeout(gameEndTimerRef.current); gameEndTimerRef.current = null }
      setGameOver(true); setFinalScores(data.finalScores || [])
      if (data.scores) setScores(data.scores)
      setRound(null); setWordChoices(null); setRoundEnd(null)
    })

    s.on('game_reset', (data: any) => {
      if (gameEndTimerRef.current) { clearTimeout(gameEndTimerRef.current); gameEndTimerRef.current = null }
      syncRoom(data.room); setRound(null); setRoundEnd(null); setWordChoices(null)
      setGameOver(false); setFinalScores([]); setCanvasStrokes([]); setScores({})
      setCountdown(-1)
      canvasVersionRef.current = 0
      setCanvasVersion(0)
      window.dispatchEvent(new CustomEvent('ddg:gameReset', { detail: data.room?.id }))
    })

    s.on('chat_message', (data: ChatMessage) => addChat(data))
    s.on('error', (data: any) => setError(data.message))
    s.on('room_closed', (data: any) => { syncRoom(null); setError(data.message) })
    s.on('left_room', () => { syncRoom(null); setRound(null) })
  }, [addChat, syncRoom])

  const emit = useCallback((event: string, data?: any) => {
    socketRef.current?.emit(event, { ...data, playerToken: playerTokenRef.current })
  }, [])

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('leave_room', { playerToken: playerTokenRef.current })
    if (gameEndTimerRef.current) { clearTimeout(gameEndTimerRef.current); gameEndTimerRef.current = null }
    syncRoom(null); setRound(null); setRoundEnd(null); setWordChoices(null)
    setGameOver(false); setFinalScores([]); setCanvasStrokes([]); setScores({})
    setCountdown(-1); canvasVersionRef.current = 0; setCanvasVersion(0)
  }, [syncRoom])

  const clearError = useCallback(() => setError(''), [])

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect(); socketRef.current = null
      if (gameEndTimerRef.current) clearTimeout(gameEndTimerRef.current)
    }
  }, [])

  return {
    connect, connected, emit, leaveRoom,
    room, myPlayerId, myPlayer,
    round, wordChoices, roundEnd,
    chatMessages, scores, finalScores, gameOver,
    countdown, canvasStrokes, lastClear, timerBump, lastCorrectId,
    canvasVersion,
    error, clearError,
  }
}
