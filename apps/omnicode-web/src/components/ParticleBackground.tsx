import { useEffect, useRef } from "react";

type Particle = { x: number; y: number; vx: number; vy: number; r: number };

const LINK_DIST = 120;

/**
 * Full-pane gold constellation (ported from the Hilbras home design): particles
 * plus connection lines painted behind all content, colored from --gold so light
 * and dark repaint live. Draws a single static frame under prefers-reduced-motion.
 */
export default function ParticleBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // canvas unsupported — page works without decoration

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let width = 0;
    let height = 0;
    let gold = "#e2bd52";
    let particles: Particle[] = [];

    const readGold = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim();
      if (v) gold = v;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(70, Math.max(28, Math.round((width * height) / 26000)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.24,
        vy: (Math.random() - 0.5) * 0.24,
        r: Math.random() * 1.5 + 0.6,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 1;
      ctx.strokeStyle = gold;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]!;
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DIST) {
            ctx.globalAlpha = (1 - dist / LINK_DIST) * 0.32;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      ctx.fillStyle = gold;
      ctx.globalAlpha = 0.7;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = () => {
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      }
      draw();
      raf = window.requestAnimationFrame(step);
    };

    readGold();
    resize();
    if (reduce) {
      draw();
    } else {
      raf = window.requestAnimationFrame(step);
    }

    // The home view is a pane — toggling the sidebar resizes it without a window
    // resize event, so observe the canvas itself.
    const onResize = () => {
      resize();
      if (reduce) draw();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);

    // Theme flips may change --gold's computed value — repaint in both modes.
    const observer = new MutationObserver(() => {
      readGold();
      if (reduce) draw();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      observer.disconnect();
    };
  }, []);

  // Decorative: no tabindex, no handlers, nothing for AT to reach.
  return <canvas ref={ref} aria-hidden="true" className="particle-canvas" />;
}
