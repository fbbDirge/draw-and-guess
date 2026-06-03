import { v4 as uuidv4 } from 'uuid'
import { getRandomWord, wordBank } from './words.js'

export class RoomManager {
  constructor() {
    this.rooms = new Map()
  }

  createRoom(socketId, hostName, hostToken, maxPlayers = 8, roundTime = 60) {
    const id = this._generateRoomId()
    const hostId = hostToken || uuidv4()
    const room = {
      id,
      maxPlayers: Math.min(30, Math.max(2, maxPlayers)),
      roundTime: Math.min(120, Math.max(30, roundTime)),
      status: 'waiting',
      hostId,
      players: new Map(),
      playerTokens: new Map(),
      scores: {},
      currentRound: 0,
      totalRounds: 0,
      currentDrawerIndex: -1,
      currentWord: '',
      currentCategory: '',
      roundTimer: null,
      pickTimer: null,
      guessedThisRound: new Set(),
      roundStartTime: 0,
      canvasVersion: 0,
      canvasStrokes: [],
      pendingWordChoices: null,
      pendingDrawerIndex: -1,
      wordRefreshLeft: 0,
      createdAt: Date.now(),
    }

    const player = {
      id: hostId, socketId, name: hostName, token: hostToken,
      isHost: true, isReady: true, role: 'player', score: 0, connected: true, joinedAt: Date.now(),
      disconnectedAt: 0, disconnectTimer: null,
    }

    room.players.set(hostId, player)
    if (hostToken) room.playerTokens.set(hostToken, hostId)
    this.rooms.set(id, room)
    return { room, player, roomId: id }
  }

  joinRoom(roomId, socketId, playerName, playerToken) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }

    if (playerToken && room.playerTokens.has(playerToken)) {
      const existingId = room.playerTokens.get(playerToken)
      const existing = room.players.get(existingId)
      if (existing) {
        if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer)
        existing.disconnectTimer = null
        existing.socketId = socketId
        existing.name = playerName || existing.name
        existing.connected = true
        existing.disconnectedAt = 0
        return { room, player: existing, reconnected: true }
      }
      room.playerTokens.delete(playerToken)
    }

    const role = room.status === 'waiting' ? 'player' : 'spectator'
    if (role === 'player' && this._activePlayers(room).length >= room.maxPlayers) return { error: '房间已满' }

    const playerId = playerToken || uuidv4()
    const player = {
      id: playerId, socketId, name: playerName, token: playerToken,
      isHost: false, isReady: role === 'spectator', role, score: 0, connected: true, joinedAt: Date.now(),
      disconnectedAt: 0, disconnectTimer: null,
    }

    room.players.set(playerId, player)
    if (playerToken) room.playerTokens.set(playerToken, playerId)
    room.scores[playerId] = 0
    return { room, player, reconnected: false }
  }

  kickPlayer(roomId, hostId, playerId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }
    if (room.hostId !== hostId) return { error: '仅房主可操作' }
    if (playerId === hostId) return { error: '不能踢出自己' }
    const player = room.players.get(playerId)
    if (!player) return { error: '玩家不在房间中' }
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer)
    room.players.delete(playerId)
    if (player.token) room.playerTokens.delete(player.token)
    delete room.scores[playerId]
    room.guessedThisRound.delete(playerId)
    return { player }
  }

  removePlayer(roomId, playerId) {
    const room = this.rooms.get(roomId)
    if (!room) return null
    const player = room.players.get(playerId)
    if (!player) return null
    const wasHost = player.isHost
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer)
    room.players.delete(playerId)
    room.guessedThisRound.delete(playerId)
    delete room.scores[playerId]
    if (player.token) room.playerTokens.delete(player.token)

    if (wasHost && this._activePlayers(room).length > 0) {
      for (const p of room.players.values()) p.isHost = false
      const newHost = this._activePlayers(room)[0]
      newHost.isHost = true
      newHost.isReady = true
      room.hostId = newHost.id
    }

    if (this._activePlayers(room).length === 0) {
      this.rooms.delete(roomId)
      return { wasHost, room: null, roomEmpty: true }
    }
    return { playerName: player.name, wasHost, room }
  }

  markDisconnected(socketId) {
    for (const [roomId, room] of this.rooms) {
      for (const player of room.players.values()) {
        if (player.socketId !== socketId) continue
        player.connected = false
        player.disconnectedAt = Date.now()
        return { roomId, room, player }
      }
    }
    return null
  }

  getBySocketId(socketId) {
    for (const [roomId, room] of this.rooms) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) return { roomId, room, player }
      }
    }
    return null
  }

  getRoom(roomId) { return this.rooms.get(roomId) || null }

  setReady(roomId, playerId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }
    const player = room.players.get(playerId)
    if (!player) return { error: '你不在房间中' }
    if (player.role === 'spectator') return { error: '观众无需准备' }
    player.isReady = !player.isReady
    return { player, room }
  }

  canStart(roomId, hostId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }
    if (room.hostId !== hostId) return { error: '仅房主可开始游戏' }
    const activePlayers = this._activePlayers(room)
    if (activePlayers.length < 2) return { error: '至少需要2名玩家' }
    const notReady = activePlayers.filter(p => !p.isReady && !p.isHost)
    if (notReady.length > 0) return { error: `${notReady.map(p => p.name).join(', ')} 未准备` }
    return { ok: true }
  }

  switchRole(roomId, playerId, role) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }
    const player = room.players.get(playerId)
    if (!player) return { error: '你不在房间中' }
    if (player.isHost && role === 'spectator') return { error: '房主不能切换为观众' }
    if (!['player', 'spectator'].includes(role)) return { error: '身份无效' }
    if (player.role === role) return { room, player }
    if (role === 'player') {
      if (room.status !== 'waiting') return { error: '游戏已开始，不能加入玩家席' }
      if (this._activePlayers(room).length >= room.maxPlayers) return { error: '房间已满' }
      player.role = 'player'
      player.isReady = false
      room.scores[playerId] = room.scores[playerId] || 0
    } else {
      player.role = 'spectator'
      player.isReady = true
      room.guessedThisRound.delete(playerId)
      delete room.scores[playerId]
    }
    return { room, player }
  }

  _activePlayers(room) {
    return [...room.players.values()].filter(p => p.role !== 'spectator')
  }

  _generateRoomId() {
    for (let i = 0; i < 100; i++) {
      const id = String(Math.floor(100000 + Math.random() * 900000))
      if (!this.rooms.has(id)) return id
    }
    return uuidv4().slice(0, 6)
  }
}

// ── Game Logic ──────────────────────────────────────

export class GameLogic {
  constructor(roomManager) {
    this.roomManager = roomManager
    this._timers = []
  }

  _setTimer(fn, delay) {
    const id = setTimeout(fn, delay)
    this._timers.push(id)
    return id
  }

  _cleanup() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
    this._onNextRound = null
    this._onGameEnd = null
    this._onRoundEnd = null
    this._onWordChoices = null
    this._onTimerShorten = null
    this._onPickTimeout = null
  }

  startGame(roomId) {
    const room = this.roomManager.getRoom(roomId)
    if (!room) return { error: '房间不存在' }

    room.status = 'playing'
    room.currentRound = 0
    const activePlayers = this.roomManager._activePlayers(room)
    room.totalRounds = activePlayers.length
    room.scores = {}
    for (const player of activePlayers) room.scores[player.id] = 0
    room.currentDrawerIndex = -1
    return this._prepareNextRound(room)
  }

  _prepareNextRound(room) {
    if (room.currentRound >= room.totalRounds) {
      return this._endGame(room)
    }

    room.currentRound++
    const activePlayers = this.roomManager._activePlayers(room)
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % activePlayers.length
    room.guessedThisRound = new Set()

    const drawer = activePlayers[room.currentDrawerIndex]

    // Generate 4 unique word choices
    const choices = []
    const seen = new Set()
    for (let i = 0; i < 4; i++) {
      let w
      for (let attempt = 0; attempt < 20; attempt++) {
        w = getRandomWord()
        if (!seen.has(w.word)) break
      }
      seen.add(w.word)
      choices.push(w)
    }

    room.pendingWordChoices = choices
    room.pendingDrawerIndex = room.currentDrawerIndex
    room.wordRefreshLeft = 2

    // Auto-skip if the drawer doesn't pick a word within 25s
    if (room.pickTimer) clearTimeout(room.pickTimer)
    room.pickTimer = this._setTimer(() => {
      if (room.status !== 'playing' || !room.pendingWordChoices) return
      const skipped = activePlayers[room.pendingDrawerIndex]
      room.pendingWordChoices = null
      room.pendingDrawerIndex = -1
      if (this._onPickTimeout && skipped) this._onPickTimeout(room.id, skipped.name)
      const nextData = this._prepareNextRound(room)
      if (!nextData) return
      if (nextData.type === 'game_end') {
        if (this._onGameEnd) this._onGameEnd(room.id, nextData)
      } else if (this._onNextRound) {
        this._onNextRound(room.id, nextData)
      }
    }, 25000)

    return {
      type: 'word_pick',
      drawerId: drawer.id,
      drawerName: drawer.name,
      choices,
      refreshLeft: 2,
      round: room.currentRound,
      totalRounds: room.totalRounds,
      roundTime: room.roundTime,
    }
  }

  refreshWordChoices(roomId, playerId) {
    const room = this.roomManager.getRoom(roomId)
    if (!room || room.status !== 'playing') return { error: '状态异常' }
    const drawer = this.roomManager._activePlayers(room)[room.pendingDrawerIndex]
    if (!drawer || drawer.id !== playerId) return { error: '你不是当前画家' }
    if (room.wordRefreshLeft <= 0) return { error: '换词次数已用完' }

    room.wordRefreshLeft--
    const choices = []
    const seen = new Set()
    for (let i = 0; i < 4; i++) {
      let w
      for (let attempt = 0; attempt < 20; attempt++) {
        w = getRandomWord()
        if (!seen.has(w.word)) break
      }
      seen.add(w.word)
      choices.push(w)
    }
    room.pendingWordChoices = choices

    return {
      type: 'word_pick',
      drawerId: drawer.id,
      drawerName: drawer.name,
      choices,
      refreshLeft: room.wordRefreshLeft,
      round: room.currentRound,
      totalRounds: room.totalRounds,
      roundTime: room.roundTime,
    }
  }

  pickWord(roomId, playerId, choiceIndex) {
    const room = this.roomManager.getRoom(roomId)
    if (!room || room.status !== 'playing') return { error: '游戏状态异常' }

    const drawer = this.roomManager._activePlayers(room)[room.pendingDrawerIndex]
    if (!drawer || drawer.id !== playerId) return { error: '你不是当前画家' }
    if (!room.pendingWordChoices || choiceIndex < 0 || choiceIndex >= room.pendingWordChoices.length) {
      return { error: '选择无效' }
    }

    const chosen = room.pendingWordChoices[choiceIndex]
    if (room.pickTimer) { clearTimeout(room.pickTimer); room.pickTimer = null }
    room.currentWord = chosen.word
    room.currentCategory = chosen.category
    room.pendingWordChoices = null
    room.pendingDrawerIndex = -1
    room.roundStartTime = Date.now()
    room.canvasVersion += 1
    room.canvasStrokes = []

    // Start round timer
    if (room.roundTimer) clearTimeout(room.roundTimer)
    room.roundTimer = this._setTimer(() => {
      if (this._onRoundEnd) this._onRoundEnd(room.id, this._endRound(room))
    }, room.roundTime * 1000)

    return {
      type: 'round_start',
      round: room.currentRound,
      totalRounds: room.totalRounds,
      drawerId: drawer.id,
      drawerName: drawer.name,
      word: chosen.word,
      wordLength: chosen.word.length,
      category: chosen.category,
      roundTime: room.roundTime,
      canvasVersion: room.canvasVersion,
    }
  }

  submitGuess(roomId, playerId, guess) {
    const room = this.roomManager.getRoom(roomId)
    if (!room || room.status !== 'playing') return { error: '游戏未在进行' }

    const activePlayers = this.roomManager._activePlayers(room)
    const drawer = activePlayers[room.currentDrawerIndex]
    const isActive = activePlayers.some(p => p.id === playerId)

    // Spectators don't know the word → free chat, broadcast to everyone
    if (!isActive) return { chat: true, knowsAnswer: false }
    // Drawer or already-correct players know the word → chat only to the answer circle
    if (playerId === drawer?.id || room.guessedThisRound.has(playerId)) {
      return { chat: true, knowsAnswer: true }
    }

    const correct = guess.trim() === room.currentWord

    if (correct) {
      room.guessedThisRound.add(playerId)

      const elapsed = (Date.now() - room.roundStartTime) / 1000
      const timeRatio = 1 - (elapsed / room.roundTime)
      const guesserPoints = Math.max(10, Math.round(50 * timeRatio))
      const drawerPoints = Math.round(30 * (room.guessedThisRound.size / (activePlayers.length - 1)))

      room.scores[playerId] = (room.scores[playerId] || 0) + guesserPoints
      room.scores[drawer.id] = (room.scores[drawer.id] || 0) + drawerPoints

      const totalGuessers = activePlayers.length - 1
      const correctCount = room.guessedThisRound.size
      const remainingGuessers = totalGuessers - correctCount

      // When only 1 guesser left, shorten timer to 10s
      if (remainingGuessers <= 1 && correctCount < totalGuessers) {
        if (room.roundTimer) clearTimeout(room.roundTimer)
        room.roundTimer = this._setTimer(() => {
          if (this._onRoundEnd) this._onRoundEnd(room.id, this._endRound(room))
        }, 10000)
        if (this._onTimerShorten) this._onTimerShorten(room.id, 10)
      }

      const allGuessed = remainingGuessers === 0
      if (allGuessed) {
        if (room.roundTimer) clearTimeout(room.roundTimer)
        this._setTimer(() => {
          if (this._onRoundEnd) this._onRoundEnd(room.id, this._endRound(room))
        }, 2000)
      }

      return {
        correct: true, playerId,
        playerName: room.players.get(playerId)?.name,
        guesserPoints, drawerPoints: null,
        allGuessed, scores: { ...room.scores },
      }
    }

    return { correct: false, playerId, guess }
  }

  _endRound(room) {
    if (room.roundTimer) clearTimeout(room.roundTimer)
    if (room.status !== 'playing') return null

    const drawer = this.roomManager._activePlayers(room)[room.currentDrawerIndex]
    const correctCount = room.guessedThisRound.size
    const drawerBonus = correctCount * 10
    if (drawer) {
      room.scores[drawer.id] = (room.scores[drawer.id] || 0) + drawerBonus
    }

    const gameEnding = room.currentRound >= room.totalRounds

    // Auto-advance after 5s if not the last round
    if (!gameEnding) {
      this._setTimer(() => {
        if (room.status !== 'playing') return
        const nextData = this._prepareNextRound(room)
        if (nextData && this._onNextRound) this._onNextRound(room.id, nextData)
      }, 5000)
    } else {
      // Last round: mark finished immediately, game_end sent by proxy
      room.status = 'finished'
    }

    return {
      word: room.currentWord,
      category: room.currentCategory,
      drawerId: drawer?.id,
      drawerName: drawer?.name,
      correctGuessers: [...room.guessedThisRound],
      scores: { ...room.scores },
      gameEnding,
      // Include final scores for last round
      finalScores: gameEnding ? this._getFinalScores(room) : undefined,
    }
  }

  advanceToNext(roomId) {
    const room = this.roomManager.getRoom(roomId)
    if (!room) return { error: '房间不存在' }
    if (room.currentRound >= room.totalRounds) {
      return this._endGame(room)
    }
    return this._prepareNextRound(room)
  }

  _endGame(room) {
    room.status = 'finished'
    if (room.roundTimer) clearTimeout(room.roundTimer)

    const entries = Object.entries(room.scores).map(([id, score]) => {
      const player = room.players.get(id)
      return { id, name: player?.name || '已离开', score }
    })
    entries.sort((a, b) => b.score - a.score)

    return {
      type: 'game_end',
      word: room.currentWord,
      category: room.currentCategory,
      finalScores: entries,
    }
  }

  _getFinalScores(room) {
    const entries = Object.entries(room.scores).map(([id, score]) => {
      const player = room.players.get(id)
      return { id, name: player?.name || '已离开', score }
    })
    entries.sort((a, b) => b.score - a.score)
    return entries
  }

  resetGame(roomId) {
    const room = this.roomManager.getRoom(roomId)
    if (!room) return { error: '房间不存在' }

    room.status = 'waiting'
    room.currentRound = 0
    room.totalRounds = 0
    room.currentDrawerIndex = -1
    room.currentWord = ''
    room.currentCategory = ''
    room.guessedThisRound = new Set()
    room.scores = {}
    room.canvasVersion = 0
    room.canvasStrokes = []
    room.pendingWordChoices = null
    room.pendingDrawerIndex = -1
    if (room.roundTimer) clearTimeout(room.roundTimer)
    room.roundTimer = null
    if (room.pickTimer) clearTimeout(room.pickTimer)
    room.pickTimer = null

    for (const player of room.players.values()) {
      player.isReady = player.isHost || player.role === 'spectator'
      player.score = 0
      if (player.role !== 'spectator') room.scores[player.id] = 0
    }

    return { ok: true }
  }
}
