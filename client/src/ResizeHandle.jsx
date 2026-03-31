import { useCallback, useRef } from 'react'

export default function ResizeHandle({ direction = 'vertical', onDrag }) {
  const dragging = useRef(false)

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true

    const handleMouseMove = (e) => {
      if (!dragging.current) return
      const pos = direction === 'vertical' ? e.clientX : e.clientY
      onDrag(pos)
    }

    const handleMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [direction, onDrag])

  const isVertical = direction === 'vertical'

  return (
    <div
      data-testid="resize-handle"
      className={`shrink-0 ${
        isVertical
          ? 'w-1 cursor-col-resize hover:bg-blue/30'
          : 'h-1 cursor-row-resize hover:bg-blue/30'
      } bg-base01/20 transition-colors`}
      onMouseDown={handleMouseDown}
    />
  )
}
