import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import { Background } from "./Background";
import { Scene } from "./Scene";
import { SCENES, SCENE_DUR, OVERLAP, STRIDE } from "./scenes";

const { fontFamily } = loadFont();

const Brand: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 52,
      left: 56,
      display: "flex",
      alignItems: "center",
      gap: 14,
      fontFamily,
    }}
  >
    <Img src={staticFile("logo-white.png")} style={{ width: 40, height: 40 }} />
    <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>
      Cosmos Pay
    </div>
  </div>
);

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const w = interpolate(frame, [0, durationInFrames], [0, 100], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", bottom: 44, left: 56, right: 56, height: 5 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.12)", borderRadius: 999 }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${w}%`,
          background: "rgba(255,255,255,0.92)",
          borderRadius: 999,
        }}
      />
    </div>
  );
};

export const Walkthrough: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#070708", fontFamily }}>
      <Background />
      {SCENES.map((data, i) => (
        <Sequence key={i} from={i * STRIDE} durationInFrames={SCENE_DUR}>
          <Scene data={data} dur={SCENE_DUR} overlap={OVERLAP} index={i} total={SCENES.length} />
        </Sequence>
      ))}
      <Brand />
      <Progress />
    </AbsoluteFill>
  );
};
