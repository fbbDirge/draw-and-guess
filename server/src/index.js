import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { RoomManager, GameLogic } from './game.js'

const app = express()
app.use(cors())

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000, pingTimeout: 5000, connectTimeout: 10000, maxHttpBufferSize: 1e6,
})

const rooms = new RoomManager()
const gameProxies = new Map()

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }))

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`)

  socket.on('create_room', ({ username, playerToken, maxPlayers = 8, roundTime = 60 }) => {
    if (!username?.trim()) return socket.emit('error', { message: '请输入用户名' })
    const { room, player, roomId } = rooms.createRoom(socket.id, username.trim(), playerToken || '', maxPlayers, roundTime)
    socket.join(roomId)
    socket.emit('room_created', { roomId, player: p(player), room: r(room) })
    io.to(roomId).emit('room_update', { room: r(room) })
    io.to(roomId).emit('chat_message', { system: true, message: `${player.name} 创建了房间` })
  })

  socket.on('join_room', ({ roomId, username, playerToken }) => {
    if (!username?.trim()) return socket.emit('error', { message: '请输入用户名' })
    const result = rooms.joinRoom(roomId, socket.id, username.trim(), playerToken || '')
    if (result.error) return socket.emit('error', { message: result.error })
    socket.join(roomId)
    if (result.reconnected) {
      socket.emit('room_joined', { roomId, player: p(result.player), room: r(result.room) })
      io.to(roomId).emit('room_update', { room: r(result.room) })
      io.to(roomId).emit('chat_message', { system: true, message: `${result.player.name} 重新连接` })
    } else {
      socket.emit('room_joined', { roomId, player: p(result.player), room: r(result.room) })
      io.to(roomId).emit('room_update', { room: r(result.room) })
      io.to(roomId).emit('chat_message', { system: true, message: `${result.player.name} 加入了房间` })
    }
  })

  socket.on('kick_player', ({ playerId }) => {
    const room = rooms.getRoom(getRoomId(socket.id))
    if (!room || room.hostId !== socket.id) return
    const result = rooms.kickPlayer(room.id, socket.id, playerId)
    if (result.error) return
    io.to(playerId).emit('kicked', { message: '你被移出房间' })
    io.to(room.id).emit('room_update', { room: r(room) })
    io.to(room.id).emit('chat_message', { system: true, message: `${result.player.name} 被移出房间` })
  })

  socket.on('toggle_ready', () => {
    const room = rooms.getRoom(getRoomId(socket.id))
    if (!room) return
    rooms.setReady(room.id, socket.id)
    io.to(room.id).emit('room_update', { room: r(room) })
  })

  // ── Game ──────────────────────────────────────────

  socket.on('start_game', () => {
    const roomId = getRoomId(socket.id)
    const room = rooms.getRoom(roomId)
    if (!room) return socket.emit('error', { message: '房间不存在' })
    const can = rooms.canStart(roomId, socket.id)
    if (can.error) return socket.emit('error', { message: can.error })

    io.to(roomId).emit('game_starting', { countdown: 3 })

    setTimeout(() => {
      const proxy = new GameLogicProxy(rooms, io, roomId)
      gameProxies.set(roomId, proxy)
      const result = proxy.start(room)
      if (result?.type === 'word_pick') {
        io.to(result.drawerId).emit('word_choices', result)
      }
    }, 3000)
  })

  socket.on('refresh_words', () => {
    const roomId = getRoomId(socket.id)
    const proxy = gameProxies.get(roomId)
    if (!proxy) return

    const result = proxy.refreshWords(roomId, socket.id)
    if (result.error) return socket.emit('error', { message: result.error })
    io.to(result.drawerId).emit('word_choices', result)
  })

  socket.on('pick_word', ({ choiceIndex }) => {
    const roomId = getRoomId(socket.id)
    const proxy = gameProxies.get(roomId)
    if (!proxy) return

    const result = proxy.pickWord(roomId, socket.id, choiceIndex)
    if (result.error) return socket.emit('error', { message: result.error })

    if (result.type === 'round_start') {
      const room = rooms.getRoom(roomId)
      // Drawer
      io.to(result.drawerId).emit('round_start', {
        ...result, isDrawer: true,
      })
      // Guessers
      for (const [pid] of room.players) {
        if (pid !== result.drawerId) {
          io.to(pid).emit('round_start', {
            ...result, word: undefined, isDrawer: false,
          })
        }
      }
      io.to(roomId).emit('chat_message', {
        system: true,
        message: `第 ${result.round}/${result.totalRounds} 轮 — ${result.drawerName} 正在作画！【${result.category}】`,
      })
    }
  })

  socket.on('next_round', () => {
    const roomId = getRoomId(socket.id)
    const room = rooms.getRoom(roomId)
    if (!room || room.hostId !== socket.id) return

    const proxy = gameProxies.get(roomId)
    if (!proxy) return

    const result = proxy.advanceToNext(roomId)
    if (result.error) return

    if (result.type === 'game_end') {
      io.to(roomId).emit('game_end', result)
      io.to(roomId).emit('chat_message', { system: true, message: '游戏结束！' })
    } else if (result.type === 'word_pick') {
      io.to(result.drawerId).emit('word_choices', result)
    }
  })

  socket.on('draw_stroke', (data) => {
    const room = rooms.getRoom(getRoomId(socket.id))
    if (!room || room.status !== 'playing') return
    const drawer = [...room.players.values()][room.currentDrawerIndex]
    if (drawer?.id !== socket.id) return
    socket.to(room.id).emit('draw_stroke', data)
  })

  socket.on('clear_canvas', () => {
    const room = rooms.getRoom(getRoomId(socket.id))
    if (!room || room.status !== 'playing') return
    const drawer = [...room.players.values()][room.currentDrawerIndex]
    if (drawer?.id !== socket.id) return
    socket.to(room.id).emit('canvas_cleared')
  })

  socket.on('undo_stroke', () => {
    const room = rooms.getRoom(getRoomId(socket.id))
    if (!room || room.status !== 'playing') return
    const drawer = [...room.players.values()][room.currentDrawerIndex]
    if (drawer?.id !== socket.id) return
    socket.to(room.id).emit('undo_stroke')
  })

  socket.on('submit_guess', ({ guess }) => {
    const roomId = getRoomId(socket.id)
    const room = rooms.getRoom(roomId)
    if (!room || room.status !== 'playing') return
    const proxy = gameProxies.get(roomId)
    if (!proxy) return

    const result = proxy.submitGuess(roomId, socket.id, guess?.trim() || '')
    if (result.error) return socket.emit('error', { message: result.error })

    if (result.correct) {
      io.to(roomId).emit('guess_result', {
        correct: true, playerId: socket.id, playerName: result.playerName,
        scores: result.scores, allGuessed: result.allGuessed,
      })
      io.to(roomId).emit('chat_message', { system: true, message: `${result.playerName} 猜对了！` })
    } else {
      socket.emit('guess_result', { correct: false, guess: result.guess })
      io.to(roomId).emit('chat_message', {
        userId: socket.id, userName: room.players.get(socket.id)?.name,
        message: guess, isGuess: true,
      })
    }
  })

  socket.on('play_again', () => {
    const roomId = getRoomId(socket.id)
    const room = rooms.getRoom(roomId)
    if (!room || room.hostId !== socket.id) return
    const proxy = gameProxies.get(roomId)
    if (proxy) { proxy.cleanup(); gameProxies.delete(roomId) }
    new GameLogic(rooms).resetGame(roomId)
    io.to(roomId).emit('game_reset', { room: r(room) })
    io.to(roomId).emit('room_update', { room: r(room) })
  })

  // ── Disconnect ────────────────────────────────────

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`)
    handlePlayerLeave(socket.id)
  })

  socket.on('leave_room', () => {
    handlePlayerLeave(socket.id)
    socket.emit('left_room')
  })

  function handlePlayerLeave(socketId) {
    for (const [roomId, room] of rooms.rooms) {
      if (!room.players.has(socketId)) continue
      const result = rooms.removePlayer(roomId, socketId)
      if (!result) break
      if (result.roomEmpty) {
        const proxy = gameProxies.get(roomId)
        if (proxy) { proxy.cleanup(); gameProxies.delete(roomId) }
        break
      }
      if (result.room) {
        io.to(roomId).emit('room_update', { room: r(result.room) })
        io.to(roomId).emit('chat_message', { system: true, message: `${result.playerName} 离开了房间` })
      }
      socket.leave(roomId)
      break
    }
  }
})

// ── Helpers ────────────────────────────────────────

function getRoomId(socketId) {
  for (const [roomId, room] of rooms.rooms) {
    if (room.players.has(socketId)) return roomId
  }
  return null
}

function p(pl) {
  return { id: pl.id, name: pl.name, isHost: pl.isHost, isReady: pl.isReady, score: pl.score, token: pl.token }
}

function r(room) {
  return {
    id: room.id, maxPlayers: room.maxPlayers, roundTime: room.roundTime,
    status: room.status, hostId: room.hostId,
    players: [...room.players.values()].map(p),
    currentRound: room.currentRound, totalRounds: room.totalRounds,
  }
}

// ── GameLogicProxy ──────────────────────────────────

class GameLogicProxy {
  constructor(roomManager, io, roomId) {
    this.logic = new GameLogic(roomManager)
    this.io = io
    this.roomId = roomId

    this.logic._onRoundEnd = (rid, data) => {
      if (!data) return
      this.io.to(rid).emit('round_end', data)
      this.io.to(rid).emit('chat_message', {
        system: true,
        message: `本轮结束！答案是: ${data.word} (${data.category})`,
      })
    }

    this.logic._onNextRound = (rid, data) => {
      if (!data) return
      if (data.type === 'word_pick') {
        this.io.to(data.drawerId).emit('word_choices', data)
        this.io.to(rid).emit('chat_message', {
          system: true,
          message: `第 ${data.round}/${data.totalRounds} 轮准备 — ${data.drawerName} 正在选词...`,
        })
      }
    }

    this.logic._onGameEnd = (rid, data) => {
      this.io.to(rid).emit('game_end', data)
      this.io.to(rid).emit('chat_message', { system: true, message: '游戏结束！' })
    }

    this.logic._onTimerShorten = (rid, newTime) => {
      this.io.to(rid).emit('timer_shorten', { seconds: newTime })
    }
  }

  start(room) {
    return this.logic.startGame(room.id)
  }

  pickWord(roomId, playerId, choiceIndex) {
    return this.logic.pickWord(roomId, playerId, choiceIndex)
  }

  refreshWords(roomId, playerId) {
    return this.logic.refreshWordChoices(roomId, playerId)
  }

  advanceToNext(roomId) {
    return this.logic.advanceToNext(roomId)
  }

  submitGuess(roomId, playerId, guess) {
    return this.logic.submitGuess(roomId, playerId, guess)
  }

  cleanup() {
    if (this.logic._cleanup) this.logic._cleanup()
  }
}

// ── Cleanup ────────────────────────────────────────

setInterval(() => {
  const now = Date.now()
  for (const [roomId, room] of rooms.rooms) {
    if (room.players.size === 0) {
      const proxy = gameProxies.get(roomId)
      if (proxy) { proxy.cleanup(); gameProxies.delete(roomId) }
      rooms.rooms.delete(roomId)
    }
    if (now - room.createdAt > 2 * 60 * 60 * 1000) {
      io.to(roomId).emit('room_closed', { message: '房间已超时关闭' })
      const proxy = gameProxies.get(roomId)
      if (proxy) { proxy.cleanup(); gameProxies.delete(roomId) }
      rooms.rooms.delete(roomId)
    }
  }
}, 60000)

// ── Boot ───────────────────────────────────────────

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`[server] 你画我猜 运行于 http://localhost:${PORT}`)
})
