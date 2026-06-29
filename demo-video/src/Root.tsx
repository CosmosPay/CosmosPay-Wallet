import "./index.css";
import { Composition } from "remotion";
import { Walkthrough } from "./Walkthrough";
import { FPS, TOTAL } from "./scenes";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CosmosWalkthrough"
        component={Walkthrough}
        durationInFrames={TOTAL}
        fps={FPS}
        width={1080}
        height={1920}
      />
    </>
  );
};
