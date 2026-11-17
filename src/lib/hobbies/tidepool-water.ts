/**
 * The water over the tide pool beaches, as one WebGL pass.
 *
 * The toy draws the beach and everything under water into an offscreen 2D
 * canvas (the bottom as it would look dry), and this pass puts water over it
 * wherever the beach's depth map says there is some: the bottom seen
 * through a moving surface (refraction), light focused into caustics on it,
 * colour soaked up with depth, the sky and a sun glint on the surface, a wet
 * bright line where it meets the rock, and rings where you touch it.
 * Everything moves in field coordinates, so panning doesn't drag the water.
 *
 * Without WebGL it falls back to a tint drawn in 2D (fallback()).
 */

const VERT = `
attribute vec2 p;
varying vec2 v;
void main() {
  v = p * 0.5 + 0.5;
  v.y = 1.0 - v.y;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform vec4 uView;   // field x, y, width, height of what the canvas shows
uniform vec2 uField;  // field size
uniform vec2 uPx;     // one canvas pixel in uv
uniform float uT;
uniform float uScale; // canvas px per field px
uniform float uDark;
uniform vec4 uRing[4]; // x, y (field px), age s, strength
varying vec2 v;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Surface height at a field point: a few slow swells and ripples.
float surf(vec2 f, float t) {
  float h = 0.0;
  h += sin(dot(f, vec2(0.011, 0.007)) + t * 0.9) * 0.5;
  h += sin(dot(f, vec2(-0.009, 0.014)) + t * 1.3) * 0.35;
  h += sin(dot(f, vec2(0.023, -0.019)) + t * 1.9) * 0.18;
  h += (noise(f * 0.02 + vec2(t * 0.18, -t * 0.11)) - 0.5) * 0.9;
  h += (noise(f * 0.06 - vec2(t * 0.35, t * 0.2)) - 0.5) * 0.25;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRing[i];
    if (r.w <= 0.0) continue;
    float d = distance(f, r.xy);
    float front = r.z * 260.0;
    float env = exp(-pow((d - front) / 26.0, 2.0)) * exp(-r.z * 2.2) * r.w;
    h += sin((d - front) * 0.16) * env * 2.2;
  }
  return h;
}
// Light focused by the surface onto the bottom.
float caustic(vec2 f, float t) {
  vec2 p = f * 0.018;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    p += vec2(sin(p.y * 1.3 + t * (0.5 + fi * 0.13) + fi), cos(p.x * 1.1 - t * (0.42 + fi * 0.1) - fi));
    c += 1.0 / (1.0 + 18.0 * abs(sin(p.x + p.y * 0.4) * cos(p.y - p.x * 0.3)));
  }
  return pow(c / 3.0, 2.2);
}

void main() {
  vec2 f = uView.xy + v * uView.zw;
  vec2 fuv = f / uField;
  float depth = texture2D(uDepth, fuv).r;
  vec3 dry = texture2D(uScene, v).rgb;
  if (depth <= 0.0) { gl_FragColor = vec4(dry, 1.0); return; }

  float e = 2.5;
  float h0 = surf(f, uT);
  vec2 g = vec2(surf(f + vec2(e, 0.0), uT) - h0, surf(f + vec2(0.0, e), uT) - h0) / e;
  vec3 n = normalize(vec3(-g * 3.0, 1.0));

  // The bottom, bent by the surface: deeper water bends it further.
  vec2 off = -n.xy * (6.0 + 22.0 * depth) * uScale * uPx;
  float d2 = texture2D(uDepth, (f + off / (uPx * uScale)) / uField).r;
  if (d2 <= 0.0) off *= 0.0; // don't pull dry rock into the water
  vec3 bottom = texture2D(uScene, v + off).rgb;

  // Light on the bottom: caustics, fading with depth.
  float c = caustic(f + n.xy * 40.0, uT);
  bottom *= 0.86 + 0.5 * c * (1.0 - 0.55 * depth);

  // Water soaks up red first, then green: clear and cold, a touch green.
  vec3 absorb = vec3(1.0, 0.45, 0.4) * (0.15 + 1.4 * depth);
  vec3 col = bottom * exp(-absorb * 0.38);
  col = mix(col, vec3(0.06, 0.12, 0.11), 0.14 * depth);

  // Sky on the surface, more at a glancing angle; a sun glint.
  vec3 sky = mix(vec3(0.62, 0.7, 0.76), vec3(0.2, 0.24, 0.3), uDark);
  float fres = 0.04 + 0.5 * pow(1.0 - n.z, 3.0);
  col = mix(col, sky, fres + 0.02);
  vec3 L = normalize(vec3(-0.5, -0.6, 0.55));
  vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, Hh), 0.0), 380.0);
  col += vec3(1.0, 0.97, 0.9) * spec * (1.2 - 0.6 * uDark);

  // The wet edge where water meets rock: a bright meniscus, then the dry.
  float edgeK = smoothstep(0.0, 0.06, depth);
  col = mix(dry * 0.9, col, edgeK);
  col += vec3(0.85, 0.92, 0.92) * (1.0 - smoothstep(0.0, 0.03, depth)) * step(0.001, depth) * 0.1;

  gl_FragColor = vec4(col, 1.0);
}`;

export interface WaterView {
  /** What the canvas shows, in field px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Ring {
  x: number;
  y: number;
  /** performance.now() when it started. */
  at: number;
  strength: number;
}

export interface Water {
  /** Upload the beach's depth map (a greyscale image, 0 where dry). */
  setDepth(img: TexImageSource): void;
  /** Upload the dry scene; call when it changed. */
  setScene(src: TexImageSource): void;
  draw(
    view: WaterView,
    fieldW: number,
    fieldH: number,
    t: number,
    dark: boolean,
    rings: Ring[],
  ): void;
  resize(w: number, h: number): void;
  readonly ok: boolean;
}

/** WebGL water on `canvas`, or null where WebGL isn't there. */
export function createWater(canvas: HTMLCanvasElement): Water | null {
  // The buffer is kept so a reveal can copy the scene outside a frame.
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const sceneTex = tex(0);
  const depthTex = tex(1);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = {
    scene: u("uScene"),
    depth: u("uDepth"),
    view: u("uView"),
    field: u("uField"),
    px: u("uPx"),
    t: u("uT"),
    scale: u("uScale"),
    dark: u("uDark"),
    ring: u("uRing"),
  };
  gl.uniform1i(U.scene, 0);
  gl.uniform1i(U.depth, 1);
  const rings = new Float32Array(16);
  return {
    ok: true,
    setDepth(img) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        img,
      );
    },
    setScene(src) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    },
    resize(w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    },
    draw(view, fw, fh, t, dark, rs) {
      const now = performance.now();
      rings.fill(0);
      rs.slice(-4).forEach((r, i) => {
        rings.set([r.x, r.y, (now - r.at) / 1000, r.strength], i * 4);
      });
      gl.uniform4f(U.view, view.x, view.y, view.w, view.h);
      gl.uniform2f(U.field, fw, fh);
      gl.uniform2f(U.px, 1 / canvas.width, 1 / canvas.height);
      gl.uniform1f(U.t, t);
      gl.uniform1f(U.scale, canvas.width / view.w);
      gl.uniform1f(U.dark, dark ? 1 : 0);
      gl.uniform4fv(U.ring, rings);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

/**
 * The same water without WebGL: the scene with a cool tint where it's deep.
 * `tint` is the depth map drawn once into a canvas the size of the field.
 */
export function waterTint(depth: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = depth.naturalWidth;
  c.height = depth.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(depth, 0, 0);
  const im = x.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = d[i] / 255;
    d[i] = 150;
    d[i + 1] = 196;
    d[i + 2] = 194;
    d[i + 3] = k > 0 ? Math.round(255 * (0.3 + 0.5 * k)) : 0;
  }
  x.putImageData(im, 0, 0);
  return c;
}
