import React, { useEffect, useRef, useState } from 'react';
import { tokens } from '../tokens';

/**
 * One loudness reading. Structurally identical to `AudioLevel` in
 * shared/types, but declared here so the design system stays a leaf: a visual
 * primitive should not import the app's domain types to describe its own
 * input.
 */
export interface WaveLevel {
  rms: number;
  low: number;
  mid: number;
  high: number;
  /** `performance.now()` when the reading arrived. */
  at: number;
}

interface VoiceWaveProps {
  /** A session is capturing. False drains the history and parks the line. */
  isLive: boolean;
  /**
   * Pulled once per animation frame — never subscribed to, never stored in
   * state. Return null when there is no signal source at all.
   */
  sample?: () => WaveLevel | null;
  /** Idle sits quieter and shallower; used before capture starts. */
  variant?: 'live' | 'idle';
  height?: number;
  className?: string;
}

/** A reading older than this means capture stopped; the history drains. */
const STALE_MS = 400;

/**
 * Columns of history. At `PUSH_HZ` this is the width of the window in time —
 * 256 / 30 is about 8.5 seconds, roughly two spoken sentences. Long enough
 * that a pause is legible as a gap, short enough that it still feels live.
 */
const HISTORY = 256;
const PUSH_HZ = 30;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * A scrolling waveform, not a standing one.
 *
 * The history arrives as a 1D texture where x is time — 0 is the oldest
 * column, 1 is now — so the shape on screen is the audio that actually
 * happened rather than a sine that happens to be animating. LINEAR filtering
 * interpolates between columns, which is what keeps it a continuous curve
 * instead of a bar chart.
 *
 * Depth comes from a second read a few columns further back, slightly taller
 * and much fainter: the same hue at a different weight rather than a second
 * colour. The oldest end dissolves; the newest carries a little more
 * presence, so the eye knows which way time runs without being told.
 */
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uHist;
uniform float uUnit;
uniform float uPx;
uniform float uActive;
uniform vec3  uInk;

void main(){
  vec2 uv = vUv;
  float u = uv.x * 0.5 + 0.5;

  float e  = texture2D(uHist, vec2(u, 0.5)).r;
  float e2 = texture2D(uHist, vec2(clamp(u - 0.020, 0.0, 1.0), 0.5)).r;

  float aa = uPx * 0.9;

  // The oldest audio dissolves off the left edge; the newest gets a touch
  // more presence. Together they say which way time runs.
  float age = smoothstep(0.0, 0.20, u);
  float now = 1.0 + 0.30 * smoothstep(0.88, 1.0, u);

  // At rest this is the whole design: one calm hairline, holding its place.
  float hair = 0.55 * uUnit;
  float th  = hair + e  * 18.0 * uUnit * uActive;
  float th2 = hair + e2 * 23.0 * uUnit * uActive;

  float ay = abs(uv.y);

  float body = 1.0 - smoothstep(th  - aa, th  + aa, ay);
  float echo = 1.0 - smoothstep(th2 - aa, th2 + aa, ay);
  // The silhouette's own outline: one pixel of extra density at the boundary,
  // which is what stops a filled shape reading as a smudge.
  float edge = body * smoothstep(th - 2.2 * uPx, th - 0.2 * uPx, ay);

  float a = echo * 0.09 + body * 0.40 + edge * 0.42;
  a *= age * now;

  if (a <= 0.003) discard;

  // Very slightly denser at the centre line — the only tonal move in here.
  vec3 c = mix(uInk, uInk * 0.82, smoothstep(0.0, max(th, hair), ay));
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}
`;

/** `#RRGGBB` (as CSS custom properties hold it) to normalised RGB. */
function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/**
 * One accent, read from the same custom property every other component uses,
 * so re-theming styles.css re-themes the wave. Reading it at runtime is the
 * only option here: `var()` cannot be handed to a shader.
 */
function readInk(): [number, number, number] | null {
  if (typeof window === 'undefined') return null;
  const style = getComputedStyle(document.documentElement);
  return parseHex(style.getPropertyValue('--t-signal'));
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * The live audio waveform — Roxi's "I can hear the room" motif.
 *
 * Driven by real amplitude off the capture mixer rather than by transcript
 * activity, which is what lets it distinguish a whisper from a shout and
 * react in ~35 ms instead of waiting on the STT provider's first partial.
 */
export const VoiceWave: React.FC<VoiceWaveProps> = ({
  isLive,
  sample,
  variant = 'live',
  height = 56,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [supported, setSupported] = useState(true);

  // Read through refs inside the loop so a prop change never restarts WebGL.
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const isLiveRef = useRef(isLive);
  isLiveRef.current = isLive;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ink = readInk();
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      depth: false,
    });
    if (!gl || !ink) {
      // Silence here is what once made a broken renderer look like a design
      // problem for two rounds of review.
      console.warn(
        `[VoiceWave] falling back to the resting line: ${!gl ? 'no WebGL context' : 'could not read --t-signal'}`
      );
      setSupported(false);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = vs && fs ? gl.createProgram() : null;
    if (!vs || !fs || !program) {
      console.warn('[VoiceWave] falling back to the resting line: shader compile failed');
      setSupported(false);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[VoiceWave] falling back to the resting line: program link failed');
      setSupported(false);
      return;
    }
    gl.useProgram(program);

    // One oversized triangle covers the clip square; vUv arrives as -1..1.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Without preventDefault a genuinely lost context (GPU reset, sleep/wake)
    // can never be restored by the browser.
    const onContextLost = (event: Event) => event.preventDefault();
    canvas.addEventListener('webglcontextlost', onContextLost);

    // The history itself. RGBA rather than LUMINANCE because RGBA is the
    // format every WebGL implementation must accept for an UNSIGNED_BYTE
    // upload; only the red channel is read.
    const pixels = new Uint8Array(HISTORY * 4);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, HISTORY, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const u = {
      unit: gl.getUniformLocation(program, 'uUnit'),
      px: gl.getUniformLocation(program, 'uPx'),
      active: gl.getUniformLocation(program, 'uActive'),
      ink: gl.getUniformLocation(program, 'uInk'),
      hist: gl.getUniformLocation(program, 'uHist'),
    };
    gl.uniform3fv(u.ink, ink);
    gl.uniform1i(u.hist, 0);
    gl.activeTexture(gl.TEXTURE0);

    const resize = () => {
      // Cap the ratio at 2: past that this is spending fill rate a strip this
      // short cannot show.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const hCss = Math.max(1, canvas.clientHeight);
      const w = Math.max(1, Math.round(Math.max(1, canvas.clientWidth) * dpr));
      const h = Math.max(1, Math.round(hCss * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      // Unconditional: these have to be right on the first frame too, and the
      // default 300x150 backing store can coincidentally match.
      gl.uniform1f(u.px, 2 / h);
      // Vertical clip-space units per CSS pixel, so thickness is authored in
      // pixels and survives any strip height.
      gl.uniform1f(u.unit, 2 / hCss);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let level = 0;
    let active = 0;
    let lastPush = 0;

    /** Push one column of history onto the right edge and scroll the rest. */
    const push = (value: number) => {
      pixels.copyWithin(0, 4);
      const v = Math.round(Math.max(0, Math.min(1, value)) * 255);
      const i = (HISTORY - 1) * 4;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HISTORY, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };

    const draw = (now: number) => {
      const reading = sampleRef.current?.() ?? null;
      const fresh = reading !== null && reading.at > 0 && now - reading.at < STALE_MS;
      const idle = variantRef.current === 'idle';

      const target = !isLiveRef.current || reduced || !fresh ? 0 : reading!.rms;
      // Fast attack, slow release — a syllable should arrive instantly and
      // fall away smoothly, the same envelope the Rust meter is tuned for.
      level += (target - level) * (target > level ? 0.4 : 0.12);

      const activeTarget = isLiveRef.current ? (idle ? 0.5 : 1) : 0;
      active += (activeTarget - active) * 0.08;

      // Quantised in time, not in frames: the history has to scroll at a
      // constant rate in seconds, or the same speech means a different shape
      // on a 120 Hz display than on a 60 Hz one.
      const step = 1000 / PUSH_HZ;
      if (now - lastPush >= step) {
        const catchUp = Math.min(4, Math.floor((now - lastPush) / step));
        for (let i = 0; i < catchUp; i++) push(level);
        lastPush = now;
      }

      gl.uniform1f(u.active, active);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    let frame = 0;
    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    // An always-on-top window is always visible, so an animation that never
    // stops is a real energy cost. It runs only while there is something to
    // animate.
    const shouldRun = () => isLiveRef.current && !reduced && !document.hidden;

    const sync = () => {
      if (shouldRun()) {
        if (!frame) frame = requestAnimationFrame(loop);
      } else {
        stop();
        draw(performance.now());
      }
    };

    document.addEventListener('visibilitychange', sync);
    const poll = window.setInterval(sync, 250);
    sync();

    return () => {
      stop();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', sync);
      observer.disconnect();
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
      // Deliberately NOT calling WEBGL_lose_context.loseContext() here.
      // StrictMode runs mount -> cleanup -> mount against the same canvas, and
      // getContext then hands back the very context we just killed: every
      // createShader on it returns null, so the component fell back forever
      // and the wave was never once rendered.
      canvas.removeEventListener('webglcontextlost', onContextLost);
    };
  }, []);

  if (!supported) {
    // No WebGL: the resting hairline, which is the design's own at-rest state
    // rather than an apology for its absence.
    return (
      <div
        className={className}
        aria-hidden="true"
        style={{ height, width: '100%', display: 'flex', alignItems: 'center' }}
      >
        <div style={{ height: 1, width: '100%', background: tokens.signalLine }} />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ width: '100%', height, display: 'block' }}
    />
  );
};
