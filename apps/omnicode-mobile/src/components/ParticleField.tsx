import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useStore } from '@/lib/store';
import { useTheme } from '@/theme/ThemeProvider';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const COUNT = 26;
const LINK_DIST = 118;
const FRAME_MS = 1000 / 30;

function spawn(width: number, height: number): Particle[] {
  return Array.from({ length: COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.2,
    r: 0.55 + Math.random() * 1.4,
  }));
}

export function ParticleField() {
  const { colors } = useTheme();
  const { state } = useStore();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [particles, setParticles] = useState<Particle[]>([]);
  const [enabled, setEnabled] = useState(true);
  const particlesRef = useRef<Particle[]>([]);
  const activeRef = useRef(true);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => setEnabled(!reduced))
      .catch(() => undefined);
    const motionSub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (reduced) => setEnabled(!reduced),
    );
    const appSub = AppState.addEventListener('change', (next) => {
      activeRef.current = next === 'active';
    });
    return () => {
      motionSub.remove();
      appSub.remove();
    };
  }, []);

  const ambientOn = state.settings.ambient && enabled;

  useEffect(() => {
    if (!ambientOn || size.width === 0 || size.height === 0) return;
    if (particlesRef.current.length === 0) {
      particlesRef.current = spawn(size.width, size.height);
      setParticles(particlesRef.current);
    }
    let raf = 0;
    let last = 0;
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      if (!activeRef.current || time - last < FRAME_MS) return;
      last = time;
      const next = particlesRef.current.map((p) => {
        let x = p.x + p.vx;
        let y = p.y + p.vy;
        if (x < -4) x = size.width + 4;
        if (x > size.width + 4) x = -4;
        if (y < -4) y = size.height + 4;
        if (y > size.height + 4) y = -4;
        return { ...p, x, y };
      });
      particlesRef.current = next;
      setParticles(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ambientOn, size]);

  const links = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; opacity: number }[] = [];
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i]!;
        const b = particles[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST) {
          out.push({
            x1: a.x,
            y1: a.y,
            x2: b.x,
            y2: b.y,
            opacity: (1 - dist / LINK_DIST) * 0.25,
          });
        }
      }
    }
    return out;
  }, [particles]);

  if (!ambientOn) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }}
    >
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {links.map((link, index) => (
          <Line
            key={`l${index}`}
            x1={link.x1}
            y1={link.y1}
            x2={link.x2}
            y2={link.y2}
            stroke={colors.gold}
            strokeOpacity={link.opacity}
            strokeWidth={1}
          />
        ))}
        {particles.map((p, index) => (
          <Circle key={`p${index}`} cx={p.x} cy={p.y} r={p.r} fill={colors.gold} fillOpacity={0.62} />
        ))}
      </Svg>
    </View>
  );
}
