import { useEffect, useRef } from "react";

/**
 * A lightweight 2D canvas brain avatar: a ring of orbiting nodes around a
 * golden core. Done with a plain canvas 2D loop so the home page adds no
 * multi-hundred-kB WebGL vendor chunk. Falls back gracefully to an empty box
 * when the canvas or animation frame is unavailable.
 */
export default function AIAvatar({ isActive = false }: { isActive?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let width = 0;
    let height = 0;
    const nodes = 24;
    const radius = 64;
    const orbitRadius = 92;
    const speeds = (isActive ? 0.6 : 0.15) + 0.15;

    const readGold = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#e2bd52";

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      const gold = readGold();
      const cx = width / 2;
      const cy = height / 2;
      const time = (isActive ? t * 0.0016 : t * 0.0006) * speeds;

      // Outer orbit of nodes.
      for (let i = 0; i < nodes; i++) {
        const a = (time + (i / nodes)) * Math.PI * 2;
        const r = radius + (i % 2 === 0 ? 0 : 18);
        const px = cx + Math.cos(a) * r * Math.cos(time * 0.3);
        const py = cy + Math.sin(a) * r * Math.sin(time * 0.3);
        const sz = i % 2 === 0 ? 3.5 : 2;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fillStyle = gold;
        ctx.globalAlpha = i % 2 === 0 ? 0.85 : 0.45;
        ctx.fill();
      }

      // Golden core.
      const pulse = 0.06 + (isActive ? 0.04 * Math.abs(Math.sin(time * 1.7)) : 0);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius + 4);
      grad.addColorStop(0, `color-mix(in srgb, ${gold} 90%, transparent)`);
      grad.addColorStop(1, `color-mix(in srgb, ${gold} 20%, transparent)`);
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.55 + pulse;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    let frameCount = 0;
    const step = () => {
      draw(frameCount++);
      raf = window.requestAnimationFrame(step);
    };

    resize();
    if (reduce) {
      draw(0);
    } else {
      raf = window.requestAnimationFrame(step);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const mo = new MutationObserver(resize);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [isActive]);

  // Decorative animation: hide from assistive tech.
  return <canvas ref={ref} aria-hidden="true" className="w-full h-full" />;
}
