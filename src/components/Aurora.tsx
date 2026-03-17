"use client";

import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle, Vec2 } from "ogl";

// ============================================================================
// Types
// ============================================================================

interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  speed?: number;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_COLOR_STOPS = ["#6366f1", "#8b5cf6", "#6366f1"];
const DEFAULT_AMPLITUDE = 1.0;
const DEFAULT_BLEND = 0.5;
const DEFAULT_SPEED = 0.5;

const VERTEX_SHADER = `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uAmplitude;
  uniform float uBlend;

  varying vec2 vUv;

  // Simplex noise functions
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                     + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = vUv;
    vec2 pos = uv * 2.0 - 1.0;
    pos.x *= uResolution.x / uResolution.y;

    float time = uTime * 0.3;

    // Create aurora waves
    float noise1 = snoise(vec2(pos.x * 1.5 + time * 0.5, pos.y * 0.5 + time * 0.2)) * uAmplitude;
    float noise2 = snoise(vec2(pos.x * 2.0 - time * 0.3, pos.y * 0.8 + time * 0.4)) * uAmplitude;
    float noise3 = snoise(vec2(pos.x * 0.8 + time * 0.2, pos.y * 1.2 - time * 0.3)) * uAmplitude;

    // Combine noises for aurora effect
    float aurora = noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2;
    aurora = smoothstep(-0.5, 1.0, aurora);

    // Create vertical gradient for aurora positioning
    float verticalGrad = smoothstep(0.0, 0.8, uv.y);
    aurora *= verticalGrad;

    // Mix colors based on position and noise
    vec3 color = mix(uColor1, uColor2, noise1 * 0.5 + 0.5);
    color = mix(color, uColor3, noise2 * 0.3 + 0.3);

    // Apply aurora intensity
    float alpha = aurora * uBlend;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ============================================================================
// Helper Functions
// ============================================================================

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
}

// ============================================================================
// Aurora Component
// ============================================================================

export default function Aurora({
  colorStops = DEFAULT_COLOR_STOPS,
  amplitude = DEFAULT_AMPLITUDE,
  blend = DEFAULT_BLEND,
  speed = DEFAULT_SPEED,
  className = "",
}: AuroraProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const programRef = useRef<Program | null>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    rendererRef.current = renderer;

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(gl.canvas);

    const geometry = new Triangle(gl);

    const colors = [
      colorStops[0] || DEFAULT_COLOR_STOPS[0],
      colorStops[1] || DEFAULT_COLOR_STOPS[1],
      colorStops[2] || DEFAULT_COLOR_STOPS[2],
    ];

    const program = new Program(gl, {
      vertex: VERTEX_SHADER,
      fragment: FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(container.offsetWidth, container.offsetHeight) },
        uColor1: { value: hexToRgb(colors[0]) },
        uColor2: { value: hexToRgb(colors[1]) },
        uColor3: { value: hexToRgb(colors[2]) },
        uAmplitude: { value: amplitude },
        uBlend: { value: blend },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    programRef.current = program;

    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const width = container.offsetWidth;
      const height = container.offsetHeight;
      renderer.setSize(width, height);
      if (program.uniforms.uResolution) {
        program.uniforms.uResolution.value.set(width, height);
      }
    };

    window.addEventListener("resize", resize);
    resize();

    let startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      program.uniforms.uTime.value = elapsed * speed;
      renderer.render({ scene: mesh });
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationRef.current);
      if (gl.canvas.parentNode) {
        gl.canvas.parentNode.removeChild(gl.canvas);
      }
      rendererRef.current = null;
      programRef.current = null;
    };
  }, [colorStops, amplitude, blend, speed]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden ${className}`}
      style={{ pointerEvents: "none" }}
    />
  );
}
