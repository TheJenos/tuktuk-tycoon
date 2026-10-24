import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { CanvasTexture, DirectionalLight, PMREMGenerator, SRGBColorSpace } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeCanvas } from './textures/canvas';
import type { Tier } from './quality';

/** A procedural studio environment for reflections (pewter, dice): generated on the GPU, nothing fetched */
export function Environment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  return null;
}

export function Lights({ tier }: { tier: Tier }) {
  const map = tier.shadowMap || 512;
  const sun = useRef<DirectionalLight>(null);
  // The shadow camera's bounds are set through props; its projection must be rebuilt from them by hand.
  useLayoutEffect(() => sun.current?.shadow.camera.updateProjectionMatrix(), [map]);
  return (
    <>
      <hemisphereLight args={['#fff4e0', '#1b1f2a', 0.4]} />
      <directionalLight
        ref={sun}
        position={[6, 15, 9]}
        intensity={2.4}
        castShadow={tier.shadowMap > 0}
        shadow-mapSize={[map, map]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
    </>
  );
}

function feltTexture(): CanvasTexture {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(256, 256, 30, 256, 256, 256);
    g.addColorStop(0, '#3a3029');
    g.addColorStop(0.55, '#231c18');
    g.addColorStop(1, '#0d0b0a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The table under the board: a dark wood top that falls off into the background */
export function Table() {
  const map = useMemo(feltTexture, []);
  useEffect(() => () => map.dispose(), [map]);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[70, 70]} />
      <meshStandardMaterial map={map} roughness={0.9} />
    </mesh>
  );
}
