/**
 * The land in WebGL: the tarn photo's land on transparency, each pixel moved
 * by how near it is (its depth map), drawn over the name so the sky and the
 * name show through where there's no land. The sky, the name and Truman are
 * plain layers moved by CSS transforms (scene.ts); only the land needs this.
 */
import { boxOf, DIR, FRAMES, pickSize, type Geo, type Kind } from "./frame";

export interface PlateHost {
  geo: Geo;
  off(n: number): { x: number; y: number };
  loadMoving(kind: Kind, size: number): Promise<unknown>;
}

export interface Plate {
  layout(): void;
  draw(): void;
}

export function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      im.decode().then(
        () => resolve(im),
        () => resolve(im),
      );
    };
    im.onerror = reject;
    im.src = url;
  });
}

const VS =
  "attribute vec2 a;varying vec2 v;void main(){v=a*0.5+0.5;gl_Position=vec4(a,0.,1.);}";
// Two steps: the depth where the content came from, not where it lands. The
// depth map carries each edge's land into the sky beside it, so an edge moves
// with its land.
const FS = `precision highp float;
uniform sampler2D u_img;uniform sampler2D u_dep;
uniform vec2 u_res;uniform vec4 u_box;uniform vec2 u_off;
varying vec2 v;
void main(){
  vec2 p=vec2(v.x*u_res.x,(1.0-v.y)*u_res.y);
  vec2 uv=(p-u_box.xy)/u_box.zw;
  vec2 o=u_off/u_box.zw;
  float n=texture2D(u_dep,uv-o).r;
  vec2 s=uv-o*(1.0-n);
  n=texture2D(u_dep,s).r;
  s=uv-o*(1.0-n);
  gl_FragColor=texture2D(u_img,s);
}`;

/**
 * Set up the plate on `cv`. `onReady` runs once it's drawn and swapped in for
 * the photo, which happens only after `meReady` (the front layer painted), so
 * the swap never shows a frame without the land. Returns null without WebGL.
 */
export function makePlate(
  host: PlateHost,
  cv: HTMLCanvasElement,
  sceneEl: HTMLElement,
  onReady: () => void,
  meReady: () => Promise<unknown>,
): Plate | null {
  const attrs: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    powerPreference: "high-performance",
  };
  let gl: WebGLRenderingContext | null = null;
  try {
    gl =
      (cv.getContext("webgl2", attrs) as WebGLRenderingContext | null) ??
      (cv.getContext("webgl", attrs) as WebGLRenderingContext | null);
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const g = gl;

  function shader(type: number, src: string): WebGLShader {
    const o = g.createShader(type)!;
    g.shaderSource(o, src);
    g.compileShader(o);
    if (!g.getShaderParameter(o, g.COMPILE_STATUS))
      throw new Error(g.getShaderInfoLog(o) ?? "shader");
    return o;
  }
  let prog: WebGLProgram;
  try {
    prog = g.createProgram()!;
    g.attachShader(prog, shader(g.VERTEX_SHADER, VS));
    g.attachShader(prog, shader(g.FRAGMENT_SHADER, FS));
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS))
      throw new Error(g.getProgramInfoLog(prog) ?? "link");
  } catch (e) {
    console.warn("Title land shader", e);
    return null;
  }
  g.useProgram(prog);
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(
    g.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    g.STATIC_DRAW,
  );
  const loc = g.getAttribLocation(prog, "a");
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  const U = {
    img: g.getUniformLocation(prog, "u_img"),
    dep: g.getUniformLocation(prog, "u_dep"),
    res: g.getUniformLocation(prog, "u_res"),
    box: g.getUniformLocation(prog, "u_box"),
    off: g.getUniformLocation(prog, "u_off"),
  };
  g.uniform1i(U.img, 0);
  g.uniform1i(U.dep, 1);
  g.disable(g.BLEND);
  function texture(unit: number): WebGLTexture {
    const t = g.createTexture()!;
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    return t;
  }
  const tImg = texture(0);
  const tDep = texture(1);
  let kind: Kind | null = null;
  let src: HTMLImageElement | null = null;
  let depth: HTMLImageElement | null = null;
  let ready = false;
  let lost = false;
  let dpr = 1;
  const scratch = document.createElement("canvas");

  // The land is resampled to exactly the screen's pixels, so fine detail (the
  // trees, the grass) doesn't shimmer as it moves. Premultiplied all the way,
  // so its soft edges never pick up a dark rim.
  function upload(): void {
    if (!src || !depth) return;
    const geo = host.geo;
    let w = Math.max(1, Math.round(boxOf(geo).w * dpr));
    let h = Math.max(1, Math.round(geo.h * dpr));
    const cap = g.getParameter(g.MAX_TEXTURE_SIZE) as number;
    const k = Math.min(1, cap / w, cap / h, src.naturalWidth / w);
    w = Math.round(w * k);
    h = Math.round(h * k);
    scratch.width = w;
    scratch.height = h;
    const c = scratch.getContext("2d")!;
    c.clearRect(0, 0, w, h);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(src, 0, 0, w, h);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, tImg);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, scratch);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, tDep);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.LUMINANCE,
      g.LUMINANCE,
      g.UNSIGNED_BYTE,
      depth,
    );
    scratch.width = scratch.height = 1;
  }
  function start(): void {
    const k = host.geo.kind;
    if (k === kind) return;
    kind = k;
    ready = false;
    sceneEl.classList.remove("gl");
    const size = pickSize(FRAMES[k].sizes, host.geo.w * dpr);
    Promise.all([
      loadImg(`${DIR}land-${k}-${size}.webp`),
      loadImg(`${DIR}depth-${k}.png`),
      host.loadMoving(k, size),
    ]).then(
      ([land, dep]) => {
        if (kind !== k || lost) return;
        src = land;
        depth = dep;
        upload();
        ready = true;
        draw();
        // Swap only once the front layer has painted over the photo (two
        // frames after it decodes); at rest the moving layers and the photo
        // match exactly.
        void meReady().then(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (ready) {
                draw();
                sceneEl.classList.add("gl");
              }
              onReady();
            });
          });
        });
      },
      (e) => console.warn("Title land", e),
    );
  }
  function draw(): void {
    if (!ready || lost) return;
    const geo = host.geo;
    const b = boxOf(geo);
    const o = host.off(0);
    g.viewport(0, 0, cv.width, cv.height);
    g.uniform2f(U.res, cv.width, cv.height);
    g.uniform4f(U.box, b.x * dpr, geo.y * dpr, b.w * dpr, geo.h * dpr);
    g.uniform2f(U.off, o.x * dpr, o.y * dpr);
    g.drawArrays(g.TRIANGLES, 0, 3);
  }
  let upTimer = 0;
  function layout(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    if (host.geo.kind !== kind) start();
    else if (ready) {
      // Resample after the window settles; until then the old texture stretches.
      window.clearTimeout(upTimer);
      upTimer = window.setTimeout(() => {
        upload();
        draw();
      }, 140);
    }
  }
  cv.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    lost = true;
    sceneEl.classList.remove("gl");
  });
  return { layout, draw };
}
