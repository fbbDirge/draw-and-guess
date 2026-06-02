import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '../hooks/useSocket'

interface Props {
  messages: ChatMessage[]
  onGuess: (guess: string) => void
  disabled: boolean
}

export default function Chat({ messages, onGuess, disabled }: Props) {
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
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.system ? 'system' : ''} ${m.isGuess ? 'guess' : ''}`}>
            {m.system ? (
              <span className="chat-system">📢 {m.message}</span>
            ) : m.isGuess ? (
              <span><b>{m.userName}</b>: {m.message}</span>
            ) : (
              <span><b>{m.userName}</b>: {m.message}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? '等待下一轮...' : '输入你的猜测...'}
          disabled={disabled}
          autoComplete="off"
        />
        <button type="submit" className="btn-primary btn-sm" disabled={disabled || !input.trim()}>
          猜
        </button>
      </form>
    </div>
  )
}
