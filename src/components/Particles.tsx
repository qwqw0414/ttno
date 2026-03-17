"use client";

import { useEffect, useRef, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

interface ParticlesProps {
  particleCount?: number;
  particleSize?: number;
  particleColor?: string;
  lineColor?: string;
  lineDistance?: number;
  moveSpeed?: number;
  cursorInteraction?: boolean;
  cursorRadius?: number;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PARTICLE_COUNT = 80;
const DEFAULT_PARTICLE_SIZE = 2;
const DEFAULT_PARTICLE_COLOR = "rgba(99, 102, 241, 0.8)";
const DEFAULT_LINE_COLOR = "rgba(99, 102, 241, 0.15)";
const DEFAULT_LINE_DISTANCE = 150;
const DEFAULT_MOVE_SPEED = 0.5;
const DEFAULT_CURSOR_RADIUS = 150;

// ============================================================================
// Particles Component
// ============================================================================

export default function Particles({
  particleCount = DEFAULT_PARTICLE_COUNT,
  particleSize = DEFAULT_PARTICLE_SIZE,
  particleColor = DEFAULT_PARTICLE_COLOR,
  lineColor = DEFAULT_LINE_COLOR,
  lineDistance = DEFAULT_LINE_DISTANCE,
  moveSpeed = DEFAULT_MOVE_SPEED,
  cursorInteraction = true,
  cursorRadius = DEFAULT_CURSOR_RADIUS,
  className = "",
}: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const animationRef = useRef<number>(0);

  const initParticles = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * moveSpeed,
        vy: (Math.random() - 0.5) * moveSpeed,
        size: particleSize + Math.random() * particleSize,
      });
    }
    particlesRef.current = particles;
  }, [particleCount, moveSpeed, particleSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      initParticles(rect.width, rect.height);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      // Update and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Cursor interaction
        if (cursorInteraction) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < cursorRadius) {
            const force = (cursorRadius - dist) / cursorRadius;
            const angle = Math.atan2(dy, dx);
            p.vx -= Math.cos(angle) * force * 0.5;
            p.vy -= Math.sin(angle) * force * 0.5;
          }
        }

        // Apply velocity with damping
        p.vx *= 0.99;
        p.vy *= 0.99;

        // Ensure minimum movement
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed < moveSpeed * 0.3) {
          p.vx += (Math.random() - 0.5) * moveSpeed * 0.1;
          p.vy += (Math.random() - 0.5) * moveSpeed * 0.1;
        }

        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off edges
        if (p.x < 0 || p.x > rect.width) p.vx *= -1;
        if (p.y < 0 || p.y > rect.height) p.vy *= -1;

        // Keep in bounds
        p.x = Math.max(0, Math.min(rect.width, p.x));
        p.y = Math.max(0, Math.min(rect.height, p.y));

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = particleColor;
        ctx.fill();

        // Draw lines between nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < lineDistance) {
            const opacity = 1 - dist / lineDistance;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = lineColor.replace(/[\d.]+\)$/, `${opacity * 0.5})`);
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    window.addEventListener("resize", resize);
    document.addEventListener("mousemove", handleMouseMove);

    resize();
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationRef.current);
    };
  }, [initParticles, cursorInteraction, cursorRadius, moveSpeed, particleColor, lineColor, lineDistance]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full ${className}`}
      style={{ pointerEvents: "none" }}
    />
  );
}
