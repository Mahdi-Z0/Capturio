import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_REGION_SIZE, type RegionRect } from '../../shared/types.js';

interface Point {
  x: number;
  y: number;
}

function rectFrom(a: Point, b: Point): RegionRect {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
  };
}

/**
 * Drag a rectangle to choose what to record.
 *
 * Runs in its own transparent full-screen window, so the drag happens over the
 * real desktop rather than a screenshot of it. The dim layer is cut away inside
 * the selection: what will be recorded stays at full brightness, and everything
 * excluded is dimmed, so the picture itself says which part is which.
 *
 * Coordinates are CSS pixels in a window sized to the display's points, so they
 * are already the display points the main process expects.
 */
export default function RegionSelector(): React.JSX.Element {
  const [origin, setOrigin] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const settled = useRef(false);

  const finish = useCallback((rect: RegionRect | null) => {
    if (settled.current) return;
    settled.current = true;
    window.api.reportRegion(rect);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const rect = origin && current ? rectFrom(origin, current) : null;
  const tooSmall = rect !== null && (rect.width < MIN_REGION_SIZE || rect.height < MIN_REGION_SIZE);

  return (
    <div
      className="region"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setOrigin({ x: e.clientX, y: e.clientY });
        setCurrent({ x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => origin && setCurrent({ x: e.clientX, y: e.clientY })}
      onPointerUp={() => {
        // A click with no drag is how people dismiss things; treat it as cancel
        // rather than recording a 3-pixel region.
        if (!rect || rect.width < MIN_REGION_SIZE || rect.height < MIN_REGION_SIZE) finish(null);
        else finish(rect);
      }}
    >
      {rect && (
        <div
          className={`region__box ${tooSmall ? 'is-small' : ''}`}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="region__size">
            {rect.width} × {rect.height}
          </span>
        </div>
      )}
      {!origin && (
        <p className="region__hint">Drag to choose what to record. Press Esc to cancel.</p>
      )}
    </div>
  );
}
