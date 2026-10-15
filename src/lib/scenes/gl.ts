import { LABEL_HALO, type LabelArt, type Labeler, scratch2d } from "./label";
import type { Colors, Sink } from "./pen";
import type { Pt } from "./stage";

/**
 * A sink drawing with WebGL2: every dot is an instance of one small quad,
 * shaded into a disc on the GPU, so a frame of tens of thousands of dots is
 * a few draw calls rather than a path the browser has to fill dot by dot.
 * Holes erase with a blend; lines are quads with square ends; labels are
 * drawn once on a 2D canvas and kept as textures.
 */

const CIRCLE_VS = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec3 disc;
layout(location = 2) in vec4 color;
uniform vec2 view;
uniform vec3 xf;
uniform float soft;
out vec2 local;
out float rad;
out vec4 col;
void main() {
  float r = disc.z * xf.x;
  float rr = max(r, 0.5);
  float half_ = rr + max(1.0, soft);
  vec2 c = disc.xy * xf.x + xf.yz;
  vec2 p = c + corner * half_;
  local = corner * half_;
  rad = rr;
  // A dot smaller than a pixel fades by its area rather than vanishing.
  col = color * (r < 0.5 ? 4.0 * r * r : 1.0);
  gl_Position = vec4(p.x / view.x * 2.0 - 1.0, 1.0 - p.y / view.y * 2.0, 0.0, 1.0);
}`;

const CIRCLE_FS = `#version 300 es
precision highp float;
uniform float soft;
in vec2 local;
in float rad;
in vec4 col;
out vec4 frag;
void main() {
  // The edge ramps over a pixel, or over soft pixels to blur the sheet.
  float ramp = max(1.0, soft);
  float cover = clamp((rad - length(local)) / ramp + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  frag = col * cover;
}`;

const SEGMENT_VS = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 3) in vec4 seg;
layout(location = 4) in float hw;
layout(location = 5) in vec4 color;
uniform vec2 view;
uniform vec3 xf;
out vec2 local;
out vec2 size;
out vec4 col;
void main() {
  vec2 a = seg.xy * xf.x + xf.yz;
  vec2 b = seg.zw * xf.x + xf.yz;
  float h = hw * xf.x;
  vec2 d = b - a;
  float len = length(d);
  vec2 u = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  // Square ends: half the width past each end.
  size = vec2(len * 0.5 + h, h);
  vec2 reach = size + 1.0;
  vec2 p = (a + b) * 0.5 + u * corner.x * reach.x + n * corner.y * reach.y;
  local = corner * reach;
  col = color;
  gl_Position = vec4(p.x / view.x * 2.0 - 1.0, 1.0 - p.y / view.y * 2.0, 0.0, 1.0);
}`;

const SEGMENT_FS = `#version 300 es
precision highp float;
in vec2 local;
in vec2 size;
in vec4 col;
out vec4 frag;
void main() {
  vec2 q = abs(local) - size;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float cover = clamp(0.5 - d, 0.0, 1.0);
  if (cover <= 0.0) discard;
  frag = col * cover;
}`;

const IMAGE_VS = `#version 300 es
layout(location = 0) in vec2 corner;
uniform vec2 view;
uniform vec3 xf;
uniform vec4 box;
out vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  vec2 p = (box.xy + uv * box.zw) * xf.x + xf.yz;
  gl_Position = vec4(p.x / view.x * 2.0 - 1.0, 1.0 - p.y / view.y * 2.0, 0.0, 1.0);
}`;

const IMAGE_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D image;
uniform float alpha;
out vec4 frag;
void main() {
  frag = texture(image, uv) * alpha;
}`;

/** Bytes per dot: x, y, r as floats, then the colour as four bytes. */
const DOT = 16;
/** Bytes per line segment: two ends, a half width, the colour. */
const SEG = 24;

interface Run {
  /** Which buffer and where in it. */
  kind: "dots" | "holes" | "segments";
  start: number;
  count: number;
}

/** Start building a program; whether it linked is checked later. */
function build(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return program;
}

/** A CSS colour as RGB bytes, the way the browser reads it. */
function rgbOf(color: string): [number, number, number] {
  const pad = scratch2d(1, 1, { willReadFrequently: true });
  if (!pad) return [0, 0, 0];
  pad.ctx.fillStyle = color;
  pad.ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = pad.ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/**
 * A WebGL2 canvas and its shaders, made once a page and reused by every
 * scene on it, so a click never waits for shaders to compile.
 */
export interface Renderer<
  C extends HTMLCanvasElement | OffscreenCanvas = HTMLCanvasElement,
> {
  readonly canvas: C;
  /** The shaders are built and the canvas can draw. */
  readonly ready: boolean;
  readonly lost: boolean;
  /** Resolves true once it's ready, or false if that takes longer than `ms`. */
  whenReady(ms: number): Promise<boolean>;
  /** A sink for one scene, in its colours, with its labels. */
  sink(colors: Colors, labels: Labeler): Sink;
}

let shared: Renderer<HTMLCanvasElement> | null | undefined;

/**
 * The page's WebGL renderer, started the first time it's asked for: null
 * where WebGL2 isn't available, or would only run in software (`software`
 * allows that, for testing), and then scenes draw on a 2D canvas instead.
 */
export function renderer(software = false): Renderer<HTMLCanvasElement> | null {
  if (shared?.lost) shared = undefined;
  if (shared === undefined)
    shared = makeRenderer(document.createElement("canvas"), software);
  return shared;
}

/** A WebGL renderer on a canvas of its own, such as a worker's OffscreenCanvas. */
export function makeRenderer<C extends HTMLCanvasElement | OffscreenCanvas>(
  canvas: C,
  software: boolean,
): Renderer<C> | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: !software,
  });
  if (!gl) return null;
  // Where the browser can, the shaders build in the background.
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const circle = build(gl, CIRCLE_VS, CIRCLE_FS);
  const segment = build(gl, SEGMENT_VS, SEGMENT_FS);
  const image = build(gl, IMAGE_VS, IMAGE_FS);
  const programs = [circle, segment, image];
  let state: "building" | "ready" | "failed" = "building";
  let lost = false;
  canvas.addEventListener("webglcontextlost", (event: Event) => {
    event.preventDefault();
    lost = true;
  });

  const where = (program: WebGLProgram) => ({
    view: gl.getUniformLocation(program, "view"),
    xf: gl.getUniformLocation(program, "xf"),
  });
  let at: {
    circle: ReturnType<typeof where> & { soft: WebGLUniformLocation | null };
    segment: ReturnType<typeof where>;
    image: ReturnType<typeof where> & {
      box: WebGLUniformLocation | null;
      alpha: WebGLUniformLocation | null;
      image: WebGLUniformLocation | null;
    };
  };
  const check = () => {
    if (state !== "building") return;
    if (
      parallel &&
      !programs.every((p) =>
        gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR),
      )
    )
      return;
    if (!programs.every((p) => gl.getProgramParameter(p, gl.LINK_STATUS))) {
      state = "failed";
      return;
    }
    at = {
      circle: { ...where(circle), soft: gl.getUniformLocation(circle, "soft") },
      segment: where(segment),
      image: {
        ...where(image),
        box: gl.getUniformLocation(image, "box"),
        alpha: gl.getUniformLocation(image, "alpha"),
        image: gl.getUniformLocation(image, "image"),
      },
    };
    state = "ready";
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const dotBuffer = gl.createBuffer();
  const segBuffer = gl.createBuffer();
  for (const loc of [1, 2, 3, 4, 5]) gl.vertexAttribDivisor(loc, 1);
  gl.enable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  // Dots and holes go into one growing buffer as they come, segments into
  // another; runs say what to draw from where, in order.
  let dots = new ArrayBuffer(DOT * 8192);
  let dotF = new Float32Array(dots);
  let dotB = new Uint8Array(dots);
  let nDots = 0;
  let segs = new ArrayBuffer(SEG * 64);
  let segF = new Float32Array(segs);
  let segB = new Uint8Array(segs);
  let nSegs = 0;
  let runs: Run[] = [];
  const room = (more: number) => {
    if ((nDots + more) * DOT <= dots.byteLength) return;
    const next = new ArrayBuffer(
      Math.max(dots.byteLength * 2, (nDots + more) * DOT),
    );
    new Uint8Array(next).set(dotB.subarray(0, nDots * DOT));
    dots = next;
    dotF = new Float32Array(dots);
    dotB = new Uint8Array(dots);
  };
  const segRoom = (more: number) => {
    if ((nSegs + more) * SEG <= segs.byteLength) return;
    const next = new ArrayBuffer(
      Math.max(segs.byteLength * 2, (nSegs + more) * SEG),
    );
    new Uint8Array(next).set(segB.subarray(0, nSegs * SEG));
    segs = next;
    segF = new Float32Array(segs);
    segB = new Uint8Array(segs);
  };
  const addRun = (kind: Run["kind"], start: number, count: number) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind && last.start + last.count === start)
      last.count += count;
    else runs.push({ kind, start, count });
  };

  const rgb = new Map<string, [number, number, number]>();
  const rgbFor = (color: string) => {
    let known = rgb.get(color);
    if (!known) rgb.set(color, (known = rgbOf(color)));
    return known;
  };

  let view: [number, number] = [1, 1];
  let xf: [number, number, number] = [1, 0, 0];
  let dpr = 1;
  /** How soft dots' edges are this frame, CSS px (a blur). */
  let soft = 0;

  const uniforms = (u: {
    view: WebGLUniformLocation | null;
    xf: WebGLUniformLocation | null;
  }) => {
    gl.uniform2f(u.view, view[0], view[1]);
    gl.uniform3f(u.xf, xf[0], xf[1], xf[2]);
  };

  /** Draw everything queued so far, in order. */
  const drain = () => {
    if (!runs.length) return;
    if (nDots) {
      gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        dotB.subarray(0, nDots * DOT),
        gl.STREAM_DRAW,
      );
    }
    if (nSegs) {
      gl.bindBuffer(gl.ARRAY_BUFFER, segBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        segB.subarray(0, nSegs * SEG),
        gl.STREAM_DRAW,
      );
    }
    for (const run of runs) {
      if (run.kind === "segments") {
        gl.useProgram(segment);
        uniforms(at.segment);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, segBuffer);
        gl.disableVertexAttribArray(1);
        gl.disableVertexAttribArray(2);
        for (const loc of [3, 4, 5]) gl.enableVertexAttribArray(loc);
        const base = run.start * SEG;
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, SEG, base);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, SEG, base + 16);
        gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, SEG, base + 20);
      } else {
        gl.useProgram(circle);
        uniforms(at.circle);
        gl.uniform1f(at.circle.soft, soft * xf[0]);
        // A hole keeps (1 - its cover) of whatever is under it.
        if (run.kind === "holes") gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
        for (const loc of [3, 4, 5]) gl.disableVertexAttribArray(loc);
        gl.enableVertexAttribArray(1);
        gl.enableVertexAttribArray(2);
        const base = run.start * DOT;
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, DOT, base);
        gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, DOT, base + 12);
      }
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, run.count);
    }
    runs = [];
    nDots = 0;
    nSegs = 0;
  };

  const textures = new WeakMap<LabelArt, WebGLTexture>();
  const textureOf = (art: LabelArt) => {
    let texture = textures.get(art);
    if (texture) return texture;
    texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      art.image,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.set(art, texture);
    return texture;
  };

  const self: Renderer<C> = {
    canvas,
    get ready() {
      check();
      return state === "ready" && !self.lost;
    },
    get lost() {
      return lost || state === "failed" || gl.isContextLost();
    },
    whenReady(ms) {
      const until = performance.now() + ms;
      return new Promise<boolean>((resolve) => {
        const poll = () => {
          if (self.ready) resolve(true);
          else if (self.lost || performance.now() > until) resolve(false);
          else setTimeout(poll, 16);
        };
        poll();
      });
    },
    sink: (colors, labels) => ({
      get lost() {
        return self.lost;
      },
      frame(vw, vh, ratio, zoom, paper) {
        dpr = ratio;
        const W = Math.round(vw * dpr);
        const H = Math.round(vh * dpr);
        if (canvas.width !== W) canvas.width = W;
        if (canvas.height !== H) canvas.height = H;
        gl.viewport(0, 0, W, H);
        view = [W, H];
        xf = [
          dpr * zoom,
          (dpr * (1 - zoom) * vw) / 2,
          (dpr * (1 - zoom) * vh) / 2,
        ];
        const [r, g, b] = rgbFor(colors.paper);
        gl.clearColor(
          (r / 255) * paper,
          (g / 255) * paper,
          (b / 255) * paper,
          paper,
        );
        gl.clear(gl.COLOR_BUFFER_BIT);
        runs = [];
        nDots = 0;
        nSegs = 0;
        soft = 0;
      },
      soften(px) {
        // A Gaussian blur of `px` fades an edge over about three times that.
        soft = 3 * Math.max(0, px);
      },
      circles(xyr, count, grow, color, alpha) {
        room(count);
        const [r, g, b] = rgbFor(color);
        const a = Math.round(alpha * 255);
        const pr = Math.round(r * alpha);
        const pg = Math.round(g * alpha);
        const pb = Math.round(b * alpha);
        let at4 = nDots * 4;
        let atB = nDots * DOT + 12;
        for (let i = 0; i < count; i++) {
          dotF[at4] = xyr[i * 3];
          dotF[at4 + 1] = xyr[i * 3 + 1];
          dotF[at4 + 2] = xyr[i * 3 + 2] + grow;
          dotB[atB] = pr;
          dotB[atB + 1] = pg;
          dotB[atB + 2] = pb;
          dotB[atB + 3] = a;
          at4 += 4;
          atB += DOT;
        }
        addRun("dots", nDots, count);
        nDots += count;
      },
      erase(holes, count) {
        room(count);
        let kept = 0;
        for (let i = 0; i < count; i++) {
          const r = holes[i * 3 + 2];
          if (r <= 0) continue;
          const j = nDots + kept;
          dotF[j * 4] = holes[i * 3];
          dotF[j * 4 + 1] = holes[i * 3 + 1];
          dotF[j * 4 + 2] = r;
          dotB.fill(255, j * DOT + 12, j * DOT + 16);
          kept++;
        }
        if (!kept) return;
        addRun("holes", nDots, kept);
        nDots += kept;
      },
      line(pts: readonly Pt[], width, color, alpha) {
        if (pts.length < 2) return;
        segRoom(pts.length - 1);
        const [r, g, b] = rgbFor(color);
        for (let i = 1; i < pts.length; i++) {
          const j = nSegs + i - 1;
          segF[j * 6] = pts[i - 1][0];
          segF[j * 6 + 1] = pts[i - 1][1];
          segF[j * 6 + 2] = pts[i][0];
          segF[j * 6 + 3] = pts[i][1];
          segF[j * 6 + 4] = width / 2;
          segB.set(
            [
              Math.round(r * alpha),
              Math.round(g * alpha),
              Math.round(b * alpha),
              Math.round(alpha * 255),
            ],
            j * SEG + 20,
          );
        }
        addRun("segments", nSegs, pts.length - 1);
        nSegs += pts.length - 1;
      },
      text(text, x, y, color, alpha) {
        const art = labels(text, color, dpr);
        if (!art) return;
        drain();
        gl.useProgram(image);
        uniforms(at.image);
        gl.uniform4f(
          at.image.box,
          x - LABEL_HALO,
          y - LABEL_HALO,
          art.w,
          art.h,
        );
        gl.uniform1f(at.image.alpha, alpha);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureOf(art));
        gl.uniform1i(at.image.image, 0);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        for (const loc of [1, 2, 3, 4, 5]) gl.disableVertexAttribArray(loc);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      flush() {
        drain();
      },
      dispose() {
        // The canvas goes back to the renderer for the next scene.
        runs = [];
        nDots = 0;
        nSegs = 0;
      },
    }),
  };
  return self;
}
