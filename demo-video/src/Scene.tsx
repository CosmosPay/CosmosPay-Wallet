import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type { SceneData } from "./scenes";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

export const Scene: React.FC<{ data: SceneData; dur: number; overlap: number; index: number; total: number }> = ({
  data,
  dur,
  overlap,
  index,
  total,
}) => {
  const frame = useCurrentFrame();

  // cross-fade in/out
  const opacity = interpolate(
    frame,
    [0, overlap, dur - overlap, dur],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Ken Burns on the phone
  const scale = interpolate(frame, [0, dur], [1.0, 1.06], { extrapolateRight: "clamp" });
  const drift = interpolate(frame, [0, dur], [10, -10], { extrapolateRight: "clamp" });
  const rise = interpolate(frame, [0, overlap], [40, 0], { easing: EASE, extrapolateRight: "clamp" });

  // caption animation
  const capY = interpolate(frame, [4, 26], [26, 0], { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const capO = interpolate(frame, [4, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subY = interpolate(frame, [12, 34], [22, 0], { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subO = interpolate(frame, [12, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Caption */}
      <div
        style={{
          position: "absolute",
          top: 132,
          left: 0,
          right: 0,
          padding: "0 90px",
          textAlign: "center",
          fontFamily: "Poppins, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 5,
            color: "rgba(255,255,255,0.55)",
            marginBottom: 14,
            opacity: capO,
            textTransform: "uppercase",
          }}
        >
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </div>
        <div
          style={{
            fontSize: 60,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: -1.5,
            lineHeight: 1.05,
            transform: `translateY(${capY}px)`,
            opacity: capO,
            textShadow: "0 6px 30px rgba(0,0,0,0.5)",
          }}
        >
          {data.title}
        </div>
        <div
          style={{
            fontSize: 27,
            fontWeight: 500,
            color: "rgba(255,255,255,0.72)",
            marginTop: 16,
            lineHeight: 1.4,
            transform: `translateY(${subY}px)`,
            opacity: subO,
          }}
        >
          {data.subtitle}
        </div>
      </div>

      {/* Phone */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end" }}>
        <div
          style={{
            marginBottom: 96,
            transform: `translateY(${drift + rise}px) scale(${scale})`,
            borderRadius: 52,
            padding: 10,
            background: "linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0.04))",
            boxShadow: "0 40px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        >
          <Img
            src={staticFile(data.img)}
            style={{
              display: "block",
              width: 612,
              height: 1283,
              objectFit: "cover",
              objectPosition: "top",
              borderRadius: 44,
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
