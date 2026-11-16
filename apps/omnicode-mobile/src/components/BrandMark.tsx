import React, { useId } from 'react';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Mask,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

export function OmniCodeMark({ size = 32 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const tile = `oc_tile_${id}`;
  const face = `oc_face_${id}`;
  const glow = `oc_glow_${id}`;
  const eyes = `oc_eyes_${id}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        <LinearGradient id={tile} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1b160e" />
          <Stop offset="1" stopColor="#0d0b08" />
        </LinearGradient>
        <LinearGradient id={face} x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor="#f2cb63" />
          <Stop offset="1" stopColor="#d9a83a" />
        </LinearGradient>
        <RadialGradient id={glow} cx="0.5" cy="0.52" r="0.5">
          <Stop offset="0" stopColor="#e5b94a" stopOpacity="0.28" />
          <Stop offset="1" stopColor="#e5b94a" stopOpacity="0" />
        </RadialGradient>
        <Mask id={eyes} maskUnits="userSpaceOnUse">
          <Rect width="1024" height="1024" fill="#fff" />
          <Rect x="406" y="414" width="76" height="196" rx="38" fill="#000" />
          <Rect x="542" y="414" width="76" height="196" rx="38" fill="#000" />
        </Mask>
      </Defs>
      <Rect x="48" y="48" width="928" height="928" rx="216" fill={`url(#${tile})`} />
      <Rect
        x="50"
        y="50"
        width="924"
        height="924"
        rx="214"
        fill="none"
        stroke="rgba(255,240,210,0.08)"
        strokeWidth="4"
      />
      <Circle cx="512" cy="530" r="400" fill={`url(#${glow})`} />
      <Rect
        x="192"
        y="292"
        width="640"
        height="440"
        rx="132"
        fill={`url(#${face})`}
        mask={`url(#${eyes})`}
      />
    </Svg>
  );
}

export function HilbrasMark({ size = 20 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gold = `hb_gold_${id}`;
  const soft = `hb_soft_${id}`;
  const glow = `hb_glow_${id}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id={gold} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#f3d789" />
          <Stop offset="0.45" stopColor="#e2bd52" />
          <Stop offset="1" stopColor="#8a6d12" />
        </LinearGradient>
        <LinearGradient id={soft} x1="16" y1="48" x2="50" y2="14" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#8a6d12" stopOpacity="0.15" />
          <Stop offset="1" stopColor="#f3d789" stopOpacity="0.9" />
        </LinearGradient>
        <RadialGradient id={glow} cx="0.5" cy="0.32" r="0.65">
          <Stop offset="0" stopColor="#e2bd52" stopOpacity="0.28" />
          <Stop offset="1" stopColor="#e2bd52" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="1.5" y="1.5" width="61" height="61" rx="17" fill="#0c0b09" />
      <Rect x="1.5" y="1.5" width="61" height="61" rx="17" fill={`url(#${glow})`} />
      <Rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16.5"
        fill="none"
        stroke={`url(#${gold})`}
        strokeWidth="1.5"
      />
      <Path
        d="M32 7 54 19.5v25L32 57 10 44.5v-25Z"
        fill="none"
        stroke={`url(#${gold})`}
        strokeWidth="0.9"
        opacity="0.35"
      />
      <Path
        d="M32 11 50.5 21v22L32 53 13.5 43V21Z"
        fill="none"
        stroke={`url(#${gold})`}
        strokeWidth="0.6"
        opacity="0.16"
      />
      <Path
        d="M23.5 45 45.5 18"
        stroke={`url(#${soft})`}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <Path d="M19.5 19h7v9.5h11V19h7v26h-7V35.5h-11V45h-7Z" fill={`url(#${gold})`} />
      <Path d="M19.5 19h7v1.4h-5.6V44h-1.4Z" fill="#f3d789" opacity="0.35" />
      <Path
        d="M47 11.5l1.9 4.6 4.6 1.9-4.6 1.9L47 24.5l-1.9-4.6-4.6-1.9 4.6-1.9Z"
        fill={`url(#${gold})`}
      />
      <Circle cx="47" cy="18" r="1.5" fill="#f3d789" />
      <Circle cx="18.5" cy="45.5" r="1.4" fill={`url(#${gold})`} />
    </Svg>
  );
}
