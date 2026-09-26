import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Play } from "lucide-react";

/** Cinematic Canvas-2D DNA helix with projected depth. Lightweight and mobile-safe. */
function HelixCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let w = 0,
      h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: 72 }).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.5 + 0.25,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      depth: Math.random(),
    }));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      const time = reduced ? 0.7 : t * 0.00042;
      const cx = w < 760 ? w * 0.72 : w * 0.79;
      const helixHeight = Math.min(h * 0.88, 680);
      const top = (h - helixHeight) * 0.5;
      const radius = Math.min(w < 760 ? w * 0.2 : w * 0.115, 148);
      const turns = 3.25;

      // A restrained pool of light gives the molecule volume without obscuring copy.
      const atmosphere = ctx.createRadialGradient(cx, h * 0.47, 10, cx, h * 0.47, radius * 2.8);
      atmosphere.addColorStop(0, "rgba(23, 185, 143, 0.105)");
      atmosphere.addColorStop(0.48, "rgba(56, 189, 248, 0.035)");
      atmosphere.addColorStop(1, "rgba(10, 15, 13, 0)");
      ctx.fillStyle = atmosphere;
      ctx.fillRect(Math.max(0, cx - radius * 3), top - 80, radius * 6, helixHeight + 160);

      // Dust motes drift at different speeds to suggest depth.
      for (const p of particles) {
        if (!reduced) {
          p.x += p.vx * (0.35 + p.depth);
          p.y += p.vy * (0.35 + p.depth);
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(159, 227, 206, ${0.05 + p.depth * 0.22})`;
        ctx.arc(p.x, p.y, p.r * (0.45 + p.depth * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }

      type HelixPoint = { x: number; y: number; z: number; scale: number };
      const pointAt = (progress: number, opposite = false): HelixPoint => {
        const phase = progress * Math.PI * 2 * turns + time + (opposite ? Math.PI : 0);
        const z = Math.sin(phase);
        const perspective = 0.72 + (z + 1) * 0.18;
        return {
          x: cx + Math.cos(phase) * radius * perspective,
          y: top + progress * helixHeight,
          z,
          scale: perspective,
        };
      };

      // Base-pair bridges are ordered back-to-front, creating real occlusion cues.
      const rungs = Array.from({ length: 36 }, (_, i) => {
        const progress = (i + 0.5) / 36;
        const a = pointAt(progress);
        const b = pointAt(progress, true);
        return { a, b, progress, depth: Math.max(a.z, b.z) };
      }).sort((a, b) => a.depth - b.depth);

      for (const { a, b, depth } of rungs) {
        const alpha = 0.1 + ((depth + 1) / 2) * 0.28;
        const bridge = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        bridge.addColorStop(0, `rgba(23, 185, 143, ${alpha})`);
        bridge.addColorStop(0.5, `rgba(194, 244, 229, ${alpha * 0.72})`);
        bridge.addColorStop(1, `rgba(56, 189, 248, ${alpha * 0.8})`);
        ctx.strokeStyle = bridge;
        ctx.lineWidth = 0.7 + ((depth + 1) / 2) * 1.15;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Draw each backbone in short depth-aware sections so the front edge glows.
      const segments = 150;
      const strandSections: Array<{ a: HelixPoint; b: HelixPoint; strand: number }> = [];
      for (let strand = 0; strand < 2; strand++) {
        for (let i = 0; i < segments; i++) {
          strandSections.push({
            a: pointAt(i / segments, strand === 1),
            b: pointAt((i + 1) / segments, strand === 1),
            strand,
          });
        }
      }
      strandSections.sort((a, b) => (a.a.z + a.b.z) - (b.a.z + b.b.z));

      for (const section of strandSections) {
        const depth = (section.a.z + section.b.z) * 0.25 + 0.5;
        const alpha = 0.16 + depth * 0.7;
        ctx.save();
        ctx.strokeStyle = section.strand === 0
          ? `rgba(23, 185, 143, ${alpha})`
          : `rgba(105, 210, 236, ${alpha * 0.86})`;
        ctx.lineWidth = 1.2 + depth * 3.4;
        ctx.lineCap = "round";
        ctx.shadowBlur = depth > 0.62 ? 15 * depth : 0;
        ctx.shadowColor = section.strand === 0
          ? "rgba(23, 185, 143, 0.72)"
          : "rgba(56, 189, 248, 0.58)";
        ctx.beginPath();
        ctx.moveTo(section.a.x, section.a.y);
        ctx.lineTo(section.b.x, section.b.y);
        ctx.stroke();
        ctx.restore();
      }

      // Molecular nodes catch light as they rotate toward the viewer.
      for (const { a, b } of rungs) {
        for (const [node, color] of [[a, "23, 185, 143"], [b, "56, 189, 248"]] as const) {
          const depth = (node.z + 1) / 2;
          const nodeRadius = 1.5 + depth * 3.4;
          ctx.save();
          ctx.shadowBlur = 7 + depth * 15;
          ctx.shadowColor = `rgba(${color}, ${0.35 + depth * 0.5})`;
          const orb = ctx.createRadialGradient(
            node.x - nodeRadius * 0.28,
            node.y - nodeRadius * 0.28,
            0,
            node.x,
            node.y,
            nodeRadius,
          );
          orb.addColorStop(0, `rgba(245, 247, 246, ${0.7 + depth * 0.3})`);
          orb.addColorStop(0.35, `rgba(${color}, ${0.52 + depth * 0.45})`);
          orb.addColorStop(1, `rgba(${color}, ${0.08 + depth * 0.22})`);
          ctx.fillStyle = orb;
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    if (reduced) draw(0);
    else raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return (
    <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />
  );
}

const words = ["Antibiotic", "resistance", "decisions", "in", "minutes,", "not", "days."];

const stats = [
  { k: "0.952", label: "ROC-AUC on Meropenem", sub: "Internal validation" },
  { k: "<5 min", label: "From genome to result", sub: "vs. 48–72 hrs lab" },
  { k: "6", label: "Antibiotics predicted", sub: "Expanding panel" },
];

export function Hero() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <section className="relative overflow-hidden bg-ink text-white min-h-[92vh] flex items-center pt-28 pb-20">
      <div className="absolute inset-0 bg-ink-mesh" />
      <HelixCanvas />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#070B0A]/95" />

      <div className="relative mx-auto max-w-7xl px-6 grid lg:grid-cols-[1.15fr_.85fr] gap-16 items-center w-full">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--color-teal-glow-soft)] backdrop-blur">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-teal-glow)] animate-pulse-dot" />
            AI · Genomics · Precision Medicine
          </div>

          <h1 className="mt-6 font-display font-bold tracking-tight text-[clamp(2.5rem,6vw,4.75rem)] leading-[1.02]">
            {words.map((w, i) => (
              <span
                key={i}
                className="inline-block mr-[0.25em] text-hero-gradient"
                style={{
                  opacity: mounted ? undefined : 0,
                  animation: mounted
                    ? `word-reveal 0.7s cubic-bezier(.2,.9,.3,1.2) ${i * 90}ms both`
                    : undefined,
                }}
              >
                {w}
              </span>
            ))}
          </h1>

          <p className="mt-8 text-lg md:text-xl text-white/70 leading-relaxed max-w-xl">
            BactoAI uses machine learning to predict antimicrobial resistance from bacterial genomes
            — before lab results come back.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href="#demo"
              className="group inline-flex items-center gap-2 rounded-full bg-[color:var(--color-teal-glow)] px-7 py-3.5 text-sm font-semibold text-[color:var(--color-ink)] shadow-glow-teal hover:brightness-110 transition"
            >
              <Play size={16} /> See the Demo
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition"
            >
              Join Pilot Program
            </a>
          </div>

          <div className="mt-12 flex items-center gap-4 text-[11px] uppercase tracking-widest text-white/40">
            <span className="h-px w-8 bg-white/20" />
            Backed by clinicians and researchers across Africa & the UK
          </div>
        </div>

        <div className="relative h-[420px] lg:h-[520px]">
          {stats.map((s, i) => (
            <div
              key={s.k}
              className="glass-dark rounded-2xl p-5 absolute w-[240px] animate-float-slow"
              style={{
                top: `${[8, 42, 72][i]}%`,
                left: `${[6, 42, 12][i]}%`,
                animationDelay: `${i * 1.3}s`,
              }}
            >
              <div className="font-stat text-4xl font-bold text-white leading-none">{s.k}</div>
              <div className="mt-2 text-xs font-semibold text-white/90">{s.label}</div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-white/40">
                {s.sub}
              </div>
              <div className="mt-3 h-0.5 rounded-full bg-gradient-to-r from-[color:var(--color-teal-glow)] to-transparent" />
            </div>
          ))}
        </div>
      </div>

      <a
        href="#stakes"
        aria-label="Scroll to next section"
        className="absolute left-1/2 -translate-x-1/2 bottom-6 text-white/60 hover:text-white transition animate-chevron"
      >
        <ChevronDown size={26} />
      </a>
    </section>
  );
}
