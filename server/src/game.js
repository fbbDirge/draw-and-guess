import { v4 as uuidv4 } from 'uuid'
import { getRandomWord, wordBank } from './words.js'

export class RoomManager {
  constructor() {
    this.rooms = new Map()
  }

  createRoom(hostId, hostName, hostToken, maxPlayers = 8, roundTime = 60) {
    const id = this._generateRoomId()
    const room = {
      id,
      maxPlayers: Math.min(20, Math.max(2, maxPlayers)),
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
      guessedThisRound: new Set(),
      roundStartTime: 0,
      pendingWordChoices: null,
      pendingDrawerIndex: -1,
      wordRefreshLeft: 0,
      createdAt: Date.now(),
    }

    const player = {
      id: hostId, name: hostName, token: hostToken,
      isHost: true, isReady: true, score: 0, connected: true, joinedAt: Date.now(),
    }

    room.players.set(hostId, player)
    room.playerTokens.set(hostToken, hostId)
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
        room.players.delete(existingId)
        room.playerTokens.delete(playerToken)
        existing.id = socketId
        existing.connected = true
        room.players.set(socketId, existing)
        room.playerTokens.set(playerToken, socketId)
        if (existing.isHost) room.hostId = socketId
        if (room.scores[existingId] !== undefined) {
          room.scores[socketId] = room.scores[existingId]
          delete room.scores[existingId]
        }
        if (room.guessedThisRound.has(existingId)) {
          room.guessedThisRound.delete(existingId)
          room.guessedThisRound.add(socketId)
        }
        return { room, player: existing, reconnected: true }
      }
    }

    if (room.status !== 'waiting') return { error: '游戏已开始，无法加入' }
    if (room.players.size >= room.maxPlayers) return { error: '房间已满' }

    const player = {
      id: socketId, name: playerName, token: playerToken,
      isHost: false, isReady: false, score: 0, connected: true, joinedAt: Date.now(),
    }

    room.players.set(socketId, player)
    if (playerToken) room.playerTokens.set(playerToken, socketId)
    room.scores[socketId] = 0
    return { room, player, reconnected: false }
  }

  kickPlayer(roomId, hostId, playerId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }
    if (room.hostId !== hostId) return { error: '仅房主可操作' }
    if (playerId === hostId) return { error: '不能踢出自己' }
    const player = room.players.get(playerId)
    if (!player) return { error: '玩家不在房间中' }
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
    room.players.delete(playerId)
    room.guessedThisRound.delete(playerId)
    delete room.scores[playerId]

    if (wasHost && room.players.size > 0) {
      const newHost = room.players.values().next().value
      newHost.isHost = true
      room.hostId = newHost.id
    }

    if (room.players.size === 0) {
      this.rooms.delete(roomId)
      return { wasHost, room: null, roomEmpty: true }
    }
    return { playerName: player.name, wasHost, room }
  }

  getRoom(roomId) { return this.rooms.get(roomId) || null }

  setReady(roomId, playerId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }
    const player = room.players.get(playerId)
    if (!player) return { error: '你不在房间中' }
    player.isReady = !player.isReady
    return { player, room }
  }

  canStart(roomId, hostId) {
    const room = this.rooms.get(roomId)
    if (!room) return { error: '房间不存在' }
    if (room.hostId !== hostId) return { error: '仅房主可开始游戏' }
    if (room.players.size < 2) return { error: '至少需要2名玩家' }
    const notReady = [...room.players.values()].filter(p => !p.isReady && !p.isHost)
    if (notReady.length > 0) return { error: `${notReady.map(p => p.name).join(', ')} 未准备` }
    return { ok: true }
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
  }

  startGame(roomId) {
    const room = this.roomManager.getRoom(roomId)
    if (!room) return { error: '房间不存在' }

    room.status = 'playing'
    room.currentRound = 0
    room.totalRounds = room.players.size
    room.scores = {}
    for (const pid of room.players.keys()) room.scores[pid] = 0
    room.currentDrawerIndex = -1
    return this._prepareNextRound(room)
  }

  _prepareNextRound(room) {
    if (room.currentRound >= room.totalRounds) {
      return this._endGame(room)
    }

    room.currentRound++
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.size
    room.guessedThisRound = new Set()

    const drawer = [...room.players.values()][room.currentDrawerIndex]

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
    const drawer = [...room.players.values()][room.pendingDrawerIndex]
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

    const drawer = [...room.players.values()][room.pendingDrawerIndex]
    if (!drawer || drawer.id !== playerId) return { error: '你不是当前画家' }
    if (!room.pendingWordChoices || choiceIndex < 0 || choiceIndex >= room.pendingWordChoices.length) {
      return { error: '选择无效' }
    }

    const chosen = room.pendingWordChoices[choiceIndex]
    room.currentWord = chosen.word
    room.currentCategory = chosen.category
    room.pendingWordChoices = null
    room.pendingDrawerIndex = -1
    room.roundStartTime = Date.now()

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
    }
  }

  submitGuess(roomId, playerId, guess) {
    const room = this.roomManager.getRoom(roomId)
    if (!room || room.status !== 'playing') return { error: '游戏未在进行' }

    const drawer = [...room.players.values()][room.currentDrawerIndex]
    if (playerId === drawer?.id) return { error: '你是画家，不能猜词' }
    if (room.guessedThisRound.has(playerId)) return { error: '本轮已猜对' }

    const correct = guess.trim() === room.currentWord

    if (correct) {
      room.guessedThisRound.add(playerId)

      const elapsed = (Date.now() - room.roundStartTime) / 1000
      const timeRatio = 1 - (elapsed / room.roundTime)
      const guesserPoints = Math.max(10, Math.round(50 * timeRatio))
      const drawerPoints = Math.round(30 * (room.guessedThisRound.size / (room.players.size - 1)))

      room.scores[playerId] = (room.scores[playerId] || 0) + guesserPoints
      room.scores[drawer.id] = (room.scores[drawer.id] || 0) + drawerPoints

      const totalGuessers = room.players.size - 1
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

    const drawer = [...room.players.values()][room.currentDrawerIndex]
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
      // Last round: end game after 5s
      this._setTimer(() => {
        if (room.status === 'playing' && this._onGameEnd) {
          room.status = 'finished'
          if (room.roundTimer) clearTimeout(room.roundTimer)
          this._onGameEnd(room.id, this._endGame(room))
        }
      }, 5000)
    }

    return {
      word: room.currentWord,
      category: room.currentCategory,
      drawerId: drawer?.id,
      drawerName: drawer?.name,
      correctGuessers: [...room.guessedThisRound],
      scores: { ...room.scores },
      gameEnding,
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
    room.pendingWordChoices = null
    room.pendingDrawerIndex = -1
    if (room.roundTimer) clearTimeout(room.roundTimer)
    room.roundTimer = null

    for (const player of room.players.values()) {
      player.isReady = false
      player.score = 0
      room.scores[player.id] = 0
    }

    return { ok: true }
  }
}
