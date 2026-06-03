interface Props {
  scores: Record<string, number>
  players: { id: string; name: string; isHost: boolean }[]
  finalScores: { id: string; name: string; score: number }[]
  drawerId?: string
  correctIds?: string[]
}

export default function ScoreBoard({ scores, players, finalScores, drawerId, correctIds = [] }: Props) {
  if (finalScores.length > 0) {
    return (
      <div className="scoreboard">
        <h3>🏆 最终排名</h3>
        <div className="score-list">
          {finalScores.map((s, i) => (
            <div key={s.id} className={`score-row rank-${i + 1}`}>
              <span className="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
              <span className="name">{s.name}</span>
              <span className="pts">{s.score}分</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const list = players.map((p, i) => ({
    ...p,
    seat: i + 1,
    score: scores[p.id] || 0,
    isDrawing: p.id === drawerId,
    guessed: correctIds.includes(p.id),
  }))

  return (
    <div className="scoreboard">
      <h3>📊 得分</h3>
      <div className="score-list">
        {list.map((s) => (
          <div key={s.id} className={`score-row ${s.isDrawing ? 'drawing' : ''}`}>
            <span className="rank">#{s.seat}</span>
            <span className="name">{s.name} {s.isDrawing && '✏️'} {s.isHost && '👑'} {s.guessed && <span className="guessed-mark">✓</span>}</span>
            <span className="pts">{s.score}分</span>
          </div>
        ))}
      </div>
    </div>
  )
}
