import { Routes, Route, Navigate } from 'react-router-dom'
import { useSocket } from './hooks/useSocket'
import Home from './pages/Home'
import Room from './pages/Room'
import Game from './pages/Game'

export default function App() {
  const ctx = useSocket()

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home ctx={ctx} />} />
        <Route path="/room/:id" element={<Room ctx={ctx} />} />
        <Route path="/game/:id" element={<Game ctx={ctx} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
