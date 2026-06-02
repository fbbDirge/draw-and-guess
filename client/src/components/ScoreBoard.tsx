interface Props {
  scores: Record<string, number>
  players: { id: string; name: string; isHost: boolean }[]
  finalScores: { id: string; name: string; score: number }[]
  drawerId?: string
}

export default function ScoreBoard({ scores, players, finalScores, drawerId }: Props) {
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

  const list = players.map((p) => ({
    ...p,
    score: scores[p.id] || 0,
    isDrawing: p.id === drawerId,
  }))
  list.sort((a, b) => b.score - a.score)

  return (
    <div className="scoreboard">
      <h3>📊 得分</h3>
      <div className="score-list">
        {list.map((s, i) => (
          <div key={s.id} className={`score-row ${s.isDrawing ? 'drawing' : ''}`}>
            <span className="rank">#{i + 1}</span>
            <span className="name">{s.name} {s.isDrawing && '✏️'} {s.isHost && '👑'}</span>
            <span className="pts">{s.score}分</span>
          </div>
        ))}
      </div>
    </div>
  )
}
