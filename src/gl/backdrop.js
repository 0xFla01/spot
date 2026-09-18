// Fullscreen backdrop. Slow drifting field with a faint acid bloom that
// tracks scroll. Deliberately quiet — it should never compete with the type.

import { Renderer, Triangle, Program, Mesh, Vec2 } from 'ogl'

const vertex = /* glsl */ `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uScroll;
  uniform vec2 uRes;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);

    float t = uTime * 0.035;
    float f = fbm(p * 2.4 + vec2(t, -t * 0.6) + uScroll * 0.35);
    f = pow(f, 2.2);

    // base ink
    vec3 col = vec3(0.027, 0.027, 0.039);

    // cold lift in the field
    col += f * vec3(0.05, 0.055, 0.08);

    // acid bloom, drifting with scroll
    vec2 bloom = vec2(0.72, 0.18 + sin(uTime * 0.12) * 0.06 - uScroll * 0.55);
    float d = distance(p, bloom * vec2(uRes.x / uRes.y, 1.0));
    col += smoothstep(0.85, 0.0, d) * vec3(0.043, 0.062, 0.012) * (0.55 + f);

    // ember counterweight low on the page
    vec2 ember = vec2(0.18, 1.25 - uScroll * 0.85);
    float d2 = distance(p, ember * vec2(uRes.x / uRes.y, 1.0));
    col += smoothstep(0.95, 0.0, d2) * vec3(0.055, 0.02, 0.008) * (0.5 + f);

    // vignette
    float vig = smoothstep(1.25, 0.25, distance(uv, vec2(0.5)));
    col *= 0.72 + 0.28 * vig;

    gl_FragColor = vec4(col, 1.0);
  }
`

export function initBackdrop() {
  const canvas = document.getElementById('gl')
  if (!canvas) return { setScroll() {} }

  let renderer
  try {
    renderer = new Renderer({
      canvas,
      alpha: false,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio, 1.5),
    })
  } catch {
    canvas.style.display = 'none'
    return { setScroll() {} }
  }

  const gl = renderer.gl
  const geometry = new Triangle(gl)
  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uRes: { value: new Vec2(1, 1) },
    },
  })
  const mesh = new Mesh(gl, { geometry, program })

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight)
    program.uniforms.uRes.value.set(gl.canvas.width, gl.canvas.height)
  }
  window.addEventListener('resize', resize)
  resize()

  let raf
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function frame(t) {
    program.uniforms.uTime.value = t * 0.001
    renderer.render({ scene: mesh })
    raf = requestAnimationFrame(frame)
  }

  if (reduce) {
    program.uniforms.uTime.value = 8
    renderer.render({ scene: mesh })
  } else {
    raf = requestAnimationFrame(frame)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf)
    else if (!reduce) raf = requestAnimationFrame(frame)
  })

  return {
    setScroll(v) {
      program.uniforms.uScroll.value = v
    },
  }
}
