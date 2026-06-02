import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'

interface Stroke {
  points: { x: number; y: number }[]
  color: string
  size: number
}

interface Props {
  strokes: Stroke[]
  onStroke: (stroke: Stroke) => void
  color: string
  size: number
  readonly: boolean
  lastClear: number
  lastUndo: number
}

export interface CanvasHandle {
  forceClear: () => void
}

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { strokes, onStroke, color, size, readonly, lastClear, lastUndo }, ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const localStrokesRef = useRef<Stroke[]>([])
  const lastSentPosRef = useRef<{ x: number; y: number } | null>(null)
  const lastSentTimeRef = useRef(0)
  const colorRef = useRef(color)
  const sizeRef = useRef(size)
  const readonlyRef = useRef(readonly)
  colorRef.current = color
  sizeRef.current = size
  readonlyRef.current = readonly

  // Expose forceClear
  useImperativeHandle(ref, () => ({
    forceClear() {
      localStrokesRef.current = []
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }), [])

  const getPos = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }, [])

  const flushSegment = useCallback((toPos: { x: number; y: number }) => {
    const from = lastSentPosRef.current
    if (!from) return
    if (from.x === toPos.x && from.y === toPos.y) return
    onStroke({ points: [{ ...from }, { ...toPos }], color: colorRef.current, size: sizeRef.current })
    lastSentPosRef.current = toPos
    lastSentTimeRef.current = Date.now()
  }, [onStroke])

  // Attach non-passive touch handlers
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      if (readonlyRef.current) return
      e.preventDefault()
      const t = e.touches[0]
      const pos = getPos(t.clientX, t.clientY)
      currentStrokeRef.current = { points: [pos], color: colorRef.current, size: sizeRef.current }
      lastSentPosRef.current = pos
      lastSentTimeRef.current = Date.now()
      drawingRef.current = true
    }

    function onTouchMove(e: TouchEvent) {
      if (!drawingRef.current || readonlyRef.current) return
      e.preventDefault()
      const pos = getPos(e.touches[0].clientX, e.touches[0].clientY)
      const stroke = currentStrokeRef.current
      if (!stroke) return
      stroke.points.push(pos)
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const pts = stroke.points
          if (pts.length >= 2) {
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'
            ctx.strokeStyle = colorRef.current; ctx.lineWidth = sizeRef.current
            ctx.beginPath()
            ctx.moveTo(pts[pts.length - 2].x * canvas.width, pts[pts.length - 2].y * canvas.height)
            ctx.lineTo(pts[pts.length - 1].x * canvas.width, pts[pts.length - 1].y * canvas.height)
            ctx.stroke()
          }
        }
      }
      if (Date.now() - lastSentTimeRef.current >= 35) flushSegment(pos)
    }

    function onTouchEnd() {
      if (!drawingRef.current) return
      drawingRef.current = false
      const stroke = currentStrokeRef.current
      if (stroke && stroke.points.length > 0) {
        const lastPt = stroke.points[stroke.points.length - 1]
        if (lastSentPosRef.current && (lastSentPosRef.current.x !== lastPt.x || lastSentPosRef.current.y !== lastPt.y)) {
          onStroke({ points: [{ ...lastSentPosRef.current }, { ...lastPt }], color: colorRef.current, size: sizeRef.current })
        }
        localStrokesRef.current.push(stroke)
      }
      currentStrokeRef.current = null
      lastSentPosRef.current = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [getPos, flushSegment, onStroke])

  // Redraw on strokes change
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = container.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height || Math.min(rect.width * 0.75, window.innerHeight * 0.55)
    redraw(canvas, [...strokes, ...localStrokesRef.current])
  }, [strokes])

  // Resize
  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height || Math.min(rect.width * 0.75, window.innerHeight * 0.55)
      redraw(canvas, [...strokes, ...localStrokesRef.current])
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  useEffect(() => {
    localStrokesRef.current = []
    const canvas = canvasRef.current
    if (canvas) redraw(canvas, strokes)
  }, [lastClear])

  useEffect(() => {
    if (lastUndo <= 0) return
    if (localStrokesRef.current.length > 0) localStrokesRef.current.pop()
    const canvas = canvasRef.current
    if (canvas) redraw(canvas, [...strokes, ...localStrokesRef.current])
  }, [lastUndo])

  function redraw(canvas: HTMLCanvasElement, allStrokes: Stroke[]) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const stroke of allStrokes) {
      if (stroke.points.length < 2) continue
      ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.size
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height)
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * canvas.width, stroke.points[i].y * canvas.height)
      }
      ctx.stroke()
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (readonly) return
    const pos = getPos(e.clientX, e.clientY)
    currentStrokeRef.current = { points: [pos], color, size }
    lastSentPosRef.current = pos
    lastSentTimeRef.current = Date.now()
    drawingRef.current = true
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drawingRef.current || readonly) return
    const pos = getPos(e.clientX, e.clientY)
    const stroke = currentStrokeRef.current
    if (!stroke) return
    stroke.points.push(pos)
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const pts = stroke.points
        if (pts.length >= 2) {
          ctx.lineCap = 'round'; ctx.lineJoin = 'round'
          ctx.strokeStyle = color; ctx.lineWidth = size
          ctx.beginPath()
          ctx.moveTo(pts[pts.length - 2].x * canvas.width, pts[pts.length - 2].y * canvas.height)
          ctx.lineTo(pts[pts.length - 1].x * canvas.width, pts[pts.length - 1].y * canvas.height)
          ctx.stroke()
        }
      }
    }
    if (Date.now() - lastSentTimeRef.current >= 35) flushSegment(pos)
  }

  function handleMouseUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    const stroke = currentStrokeRef.current
    if (stroke && stroke.points.length > 0) {
      const lastPt = stroke.points[stroke.points.length - 1]
      if (lastSentPosRef.current && (lastSentPosRef.current.x !== lastPt.x || lastSentPosRef.current.y !== lastPt.y)) {
        onStroke({ points: [{ ...lastSentPosRef.current }, { ...lastPt }], color, size })
      }
      localStrokesRef.current.push(stroke)
    }
    currentStrokeRef.current = null
    lastSentPosRef.current = null
  }

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ width: '100%', touchAction: 'none', position: 'relative', background: '#fff', borderRadius: '8px', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', cursor: readonly ? 'default' : 'crosshair' }} />
      {readonly && <div style={{ position: 'absolute', bottom: 8, left: 12, color: '#999', fontSize: 12 }}>画家正在作画...</div>}
    </div>
  )
})

export default Canvas
