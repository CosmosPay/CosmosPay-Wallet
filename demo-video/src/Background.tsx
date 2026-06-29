import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/** Dark, drifting ambient background that matches the app's monochrome glass look. */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const blob = (phase: number) => ({
    x: Math.sin(t * 0.35 + phase) * 90,
    y: Math.cos(t * 0.28 + phase) * 70,
    s: 1 + Math.sin(t * 0.3 + phase) * 0.12,
  });
  const a = blob(0);
  const b = blob(2.1);
  const c = blob(4.2);

  return (
    <AbsoluteFill style={{ backgroundColor: "#070708", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 55%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          left: 120 + a.x,
          top: 180 + a.y,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.10), rgba(255,255,255,0) 70%)",
          transform: `scale(${a.s})`,
          filter: "blur(20px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 620,
          height: 620,
          right: 60 + b.x,
          top: 760 + b.y,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(140,170,255,0.10), rgba(255,255,255,0) 70%)",
          transform: `scale(${b.s})`,
          filter: "blur(24px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 560,
          height: 560,
          left: 220 + c.x,
          bottom: 60 + c.y,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.07), rgba(255,255,255,0) 70%)",
          transform: `scale(${c.s})`,
          filter: "blur(22px)",
        }}
      />
      {/* subtle vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
          opacity: interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" }),
        }}
      />
    </AbsoluteFill>
  );
};
