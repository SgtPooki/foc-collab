/**
 * The playground: one three.js scene holding the mascot and every adopted
 * corgi, built from primitives so there is no art pipeline and every corgi
 * is derived from its owner's address (traits.js). Behaviours are borrowed
 * from pet sims: wander, sniff, sit, chase the ball, greet a neighbour,
 * nap when lazy. Life and mood change posture and expression: a sick corgi
 * lies down, a critical one barely moves, a dead mascot is a ghost over a
 * gravestone, a happy one bounces.
 *
 * Public surface: createPark(canvas, opts) -> { setState, resize, destroy }
 * setState({ payer, life, mood, park:[{owner}], ghost?: address, theme })
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { traitsOf } from './traits.js'

const GROUND_RADIUS = 7
const WANDER_RADIUS = 5.6
const WHITE = '#f6f1e8'
const PINK = '#f0a8b0'

// ---------------------------------------------------------------- helpers

function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra })
}

function mesh(geometry, material, { x = 0, y = 0, z = 0, castShadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  m.castShadow = castShadow
  m.receiveShadow = false
  return m
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// ---------------------------------------------------------------- corgi

/** Builds the corgi hierarchy. Returns the root group with named parts in userData. */
export function buildCorgi(traits) {
  const t = traits
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const coat = mat(t.coat.body)
  const dark = mat(t.coat.dark)
  const white = mat(WHITE)
  const parts = { body, legs: [], ears: [] }

  // torso: a long low capsule lying along z (corgis are long and low)
  const torsoR = 0.28 * t.fluff
  const L = t.length // 0.6 .. 0.9
  const BODY_Y = 0.36
  const torso = mesh(new THREE.CapsuleGeometry(torsoR, L, 6, 12), coat, { y: BODY_Y })
  torso.rotation.x = Math.PI / 2
  body.add(torso)
  // pattern layers
  if (t.pattern === 'saddle' || t.pattern === 'tricolor') {
    const saddle = mesh(new THREE.SphereGeometry(torsoR * 1.02, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), dark, { y: BODY_Y, z: -0.05 })
    saddle.scale.set(1, 1, 1.4 + L * 0.9)
    body.add(saddle)
  }
  if (t.pattern === 'merle') {
    // large uneven overlapping patches rather than freckles
    const spots = rng(t.seed)
    for (let i = 0; i < 6; i++) {
      const a = spots() * Math.PI * 1.4 - 0.2 // mostly on the back and flanks
      const patch = mesh(new THREE.SphereGeometry(0.11 + spots() * 0.1, 10, 8), dark, {
        x: Math.cos(a) * torsoR * 0.9, y: BODY_Y + Math.sin(a) * torsoR * 0.9, z: (spots() - 0.5) * L,
      })
      patch.scale.set(0.7 + spots() * 0.5, 0.6 + spots() * 0.5, 1.3 + spots())
      body.add(patch)
    }
  }
  if (t.bib) {
    const bib = mesh(new THREE.SphereGeometry(torsoR * 0.85, 12, 8), white, { y: BODY_Y - 0.08, z: L * 0.45 })
    bib.scale.set(0.9, 0.8, 1.1)
    body.add(bib)
  }
  // belly
  const belly = mesh(new THREE.CapsuleGeometry(torsoR * 0.8, L * 0.9, 4, 10), white, { y: BODY_Y - 0.12 })
  belly.rotation.x = Math.PI / 2
  belly.castShadow = false
  body.add(belly)

  // legs: pivot at hip so they can swing; short by breed
  const legLen = 0.16
  const legPositions = [[0.16, L * 0.42], [-0.16, L * 0.42], [0.16, -L * 0.4], [-0.16, -L * 0.4]]
  legPositions.forEach(([x, z], i) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, 0.2, z)
    const sock = i < t.socks
    const leg = mesh(new THREE.CylinderGeometry(0.07, 0.065, legLen, 10), sock ? white : coat, { y: -legLen / 2 })
    pivot.add(leg)
    const paw = mesh(new THREE.SphereGeometry(0.075, 10, 8), sock ? white : coat, { y: -legLen, z: 0.02 })
    paw.scale.set(1, 0.6, 1.2)
    pivot.add(paw)
    body.add(pivot)
    parts.legs.push(pivot)
  })

  // head group pivots at the neck
  const head = new THREE.Group()
  head.position.set(0, BODY_Y + 0.2, L * 0.58)
  body.add(head)
  parts.head = head
  const skull = mesh(new THREE.SphereGeometry(0.25, 18, 14), coat, { y: 0.05, z: 0.02 })
  head.add(skull)
  if (t.pattern === 'mask' || t.pattern === 'tricolor') {
    const maskM = mesh(new THREE.SphereGeometry(0.255, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), dark, { y: 0.05, z: 0.02 })
    head.add(maskM)
  }
  if (t.pattern === 'blaze') {
    const blaze = mesh(new THREE.SphereGeometry(0.1, 10, 8), white, { y: 0.14, z: 0.2 })
    blaze.scale.set(0.4, 1.3, 0.6)
    head.add(blaze)
  }
  if (t.pattern === 'eyepatch') {
    const patch = mesh(new THREE.SphereGeometry(0.12, 10, 8), dark, { x: 0.16, y: 0.07, z: 0.15 })
    patch.scale.set(1, 1.1, 0.5)
    head.add(patch)
  }
  // cheeks and snout
  for (const side of [-1, 1]) {
    const cheek = mesh(new THREE.SphereGeometry(0.12, 10, 8), white, { x: side * 0.15, y: -0.06, z: 0.13 })
    head.add(cheek)
  }
  // foxy wedge snout: a cone pointing forward
  const snout = mesh(new THREE.ConeGeometry(0.13, 0.3, 12), white, { y: -0.03, z: 0.27 })
  snout.rotation.x = Math.PI / 2
  snout.scale.set(1.15, 0.8, 1)
  head.add(snout)
  const nose = mesh(new THREE.SphereGeometry(0.045, 10, 8), mat('#1c1a19', { roughness: 0.4 }), { y: 0.02, z: 0.42 })
  head.add(nose)
  // eyes with highlights
  // big wide-set eyes, low on the face (baby schema)
  const glint = mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 })
  parts.eyes = []
  for (const side of [-1, 1]) {
    const colour = side === 1 && t.oddEye ? t.oddEye : t.eyes
    const eye = mesh(new THREE.SphereGeometry(0.055, 12, 10), mat(colour, { roughness: 0.3 }), { x: side * 0.16, y: 0.05, z: 0.17 })
    const shine = mesh(new THREE.SphereGeometry(0.018, 6, 6), glint, { x: side * 0.15 + 0.015, y: 0.07, z: 0.215 })
    head.add(eye, shine)
    parts.eyes.push(eye)
  }
  // brows for expression
  parts.brows = []
  for (const side of [-1, 1]) {
    const brow = mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), mat(t.coat.dark), { x: side * 0.16, y: 0.13, z: 0.2 })
    brow.visible = false
    head.add(brow)
    parts.brows.push(brow)
  }
  // tongue for happy
  const tongue = mesh(new THREE.SphereGeometry(0.04, 8, 6), mat('#e07a8a'), { y: -0.1, z: 0.36 })
  tongue.scale.set(1, 0.6, 1.4)
  tongue.visible = false
  head.add(tongue)
  parts.tongue = tongue
  // ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Group()
    ear.position.set(side * 0.18, 0.2, -0.04)
    const s = t.ears.size
    const outer = mesh(new THREE.ConeGeometry(0.15 * s, 0.34 * s, 10), coat, { y: 0.15 * s })
    outer.scale.x = 1.5
    const inner = mesh(new THREE.ConeGeometry(0.09 * s, 0.24 * s, 10), mat(PINK), { y: 0.14 * s, z: 0.04 })
    inner.scale.x = 1.4
    inner.castShadow = false
    ear.add(outer, inner)
    ear.rotation.z = -side * (0.25 + (t.ears.tilt * Math.PI) / 180)
    if (t.ears.floppy && side === 1) ear.rotation.z = -1.4
    head.add(ear)
    parts.ears.push(ear)
  }
  // tail
  const tail = new THREE.Group()
  tail.position.set(0, BODY_Y + 0.14, -L * 0.62)
  body.add(tail)
  parts.tail = tail
  if (t.tail === 'nub') tail.add(mesh(new THREE.SphereGeometry(0.075, 10, 8), coat))
  if (t.tail === 'fluffy') {
    const f = mesh(new THREE.SphereGeometry(0.13, 12, 10), coat, { y: 0.06, z: -0.06 })
    f.scale.set(0.9, 1, 1.3)
    tail.add(f)
    tail.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), white, { y: 0.1, z: -0.16 }))
  }
  if (t.tail === 'curled') {
    const c = mesh(new THREE.TorusGeometry(0.11, 0.05, 8, 14, Math.PI * 1.5), coat, { y: 0.1 })
    c.rotation.y = Math.PI / 2
    tail.add(c)
  }
  // accessories
  const accent = mat(t.accent, { roughness: 0.6 })
  if (t.accessory === 'collar') {
    const c = mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 20), accent, { y: BODY_Y + 0.1, z: L * 0.5 })
    c.rotation.x = Math.PI / 2 - 0.3
    body.add(c)
    body.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), mat('#f2c94c', { metalness: 0.6, roughness: 0.3 }), { y: BODY_Y - 0.06, z: L * 0.5 + 0.14 }))
  }
  if (t.accessory === 'bandana') {
    const b = mesh(new THREE.ConeGeometry(0.22, 0.26, 3), accent, { y: BODY_Y - 0.08, z: L * 0.55 })
    b.rotation.x = Math.PI
    b.rotation.y = Math.PI
    body.add(b)
  }
  if (t.accessory === 'scarf') {
    const s = mesh(new THREE.TorusGeometry(0.23, 0.06, 8, 20), accent, { y: BODY_Y + 0.08, z: L * 0.5 })
    s.rotation.x = Math.PI / 2 - 0.2
    body.add(s)
    const tailEnd = mesh(new THREE.BoxGeometry(0.1, 0.3, 0.05), accent, { x: 0.18, y: BODY_Y - 0.1, z: L * 0.52 })
    tailEnd.rotation.z = 0.3
    body.add(tailEnd)
  }
  if (t.accessory === 'bow') {
    const bowG = new THREE.Group()
    bowG.position.set(-0.12, 0.34, 0.02)
    bowG.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), accent, { x: -0.06 }), mesh(new THREE.SphereGeometry(0.06, 8, 6), accent, { x: 0.06 }), mesh(new THREE.SphereGeometry(0.03, 8, 6), white))
    head.add(bowG)
  }
  if (t.accessory === 'glasses') {
    const frame = mat('#1c1a19', { roughness: 0.3 })
    for (const side of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 16), frame, { x: side * 0.16, y: 0.05, z: 0.2 })
      head.add(ring)
    }
    head.add(mesh(new THREE.BoxGeometry(0.15, 0.012, 0.012), frame, { y: 0.05, z: 0.2 }))
  }
  if (t.accessory === 'hat') {
    const brim = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 16), accent, { y: 0.28 })
    const top = mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.16, 16), accent, { y: 0.36 })
    head.add(brim, top)
  }
  if (t.accessory === 'flower') {
    const stem = new THREE.Group()
    stem.position.set(0.16, 0.3, 0.02)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      stem.add(mesh(new THREE.SphereGeometry(0.035, 6, 6), accent, { x: Math.cos(a) * 0.05, y: Math.sin(a) * 0.05 }))
    }
    stem.add(mesh(new THREE.SphereGeometry(0.03, 6, 6), mat('#f2c94c')))
    head.add(stem)
  }
  if (t.accessory === 'backpack') {
    const pack = mesh(new THREE.BoxGeometry(0.26, 0.18, 0.2), accent, { y: BODY_Y + 0.24, z: -0.08 })
    body.add(pack)
    body.add(mesh(new THREE.BoxGeometry(0.28, 0.06, 0.22), mat(t.accent, { roughness: 0.9 }), { y: BODY_Y + 0.35, z: -0.08 }))
  }
  if (t.accessory === 'crown') {
    const gold = mat('#f2c94c', { metalness: 0.7, roughness: 0.25, emissive: '#b8860b', emissiveIntensity: 0.25 })
    const band = mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.1, 12), gold, { y: 0.3 })
    head.add(band)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      head.add(mesh(new THREE.ConeGeometry(0.035, 0.09, 6), gold, { x: Math.cos(a) * 0.14, y: 0.39, z: Math.sin(a) * 0.14 }))
    }
  }

  root.scale.setScalar(t.size)
  root.userData.baseScale = t.size
  root.userData.parts = parts
  root.userData.traits = t
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = true })
  return root
}

// ---------------------------------------------------------------- brains

const MODES = { idle: 'idle', walk: 'walk', sniff: 'sniff', sit: 'sit', lie: 'lie', greet: 'greet', ball: 'ball' }

function makeBrain(traits, random) {
  return {
    random,
    mode: MODES.idle,
    timer: 1 + random() * 2,
    target: new THREE.Vector3(),
    speed: 0.9 * traits.tempo,
    phase: random() * Math.PI * 2,
    heading: random() * Math.PI * 2,
    jump: 0,
  }
}

function pickTarget(brain, from) {
  const a = brain.random() * Math.PI * 2
  const r = Math.sqrt(brain.random()) * WANDER_RADIUS
  brain.target.set(Math.cos(a) * r, 0, Math.sin(a) * r)
  if (brain.target.distanceTo(from) < 1.2) brain.target.set(-from.x * 0.5, 0, -from.z * 0.5)
}

// ---------------------------------------------------------------- park

export function createPark(canvas, { reducedMotion = false, onPick = null, onHover = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80)
  camera.position.set(0, 4.2, 8.6)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 0.4, 0)
  controls.enablePan = false
  controls.minDistance = 4.5
  controls.maxDistance = 17
  controls.maxPolarAngle = 1.32
  controls.minPolarAngle = 0.5
  controls.enableDamping = true
  controls.autoRotate = !reducedMotion
  controls.autoRotateSpeed = 0.35
  controls.addEventListener('start', () => { controls.autoRotate = false })

  // lights
  const hemi = new THREE.HemisphereLight('#ffffff', '#4d6b3a', 0.9)
  const sun = new THREE.DirectionalLight('#fff4de', 2.2)
  sun.position.set(6, 10, 4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1536, 1536)
  sun.shadow.camera.left = -9; sun.shadow.camera.right = 9
  sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 30
  sun.shadow.bias = -0.0008
  const lamp = new THREE.PointLight('#ffb35c', 0, 16, 1.1)
  lamp.position.set(2.8, 2.6, 2.2)
  scene.add(hemi, sun, lamp)

  // ground and props
  const grass = mat('#6fae5a')
  const ground = mesh(new THREE.CircleGeometry(GROUND_RADIUS, 48), grass, { castShadow: false })
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const patchRng = rng(1234)
  for (let i = 0; i < 14; i++) {
    const a = patchRng() * Math.PI * 2
    const r = patchRng() * (GROUND_RADIUS - 1)
    const patch = mesh(new THREE.CircleGeometry(0.4 + patchRng() * 0.8, 12), mat(patchRng() > 0.5 ? '#63a050' : '#7cb866'), { x: Math.cos(a) * r, y: 0.005, z: Math.sin(a) * r, castShadow: false })
    patch.rotation.x = -Math.PI / 2
    patch.receiveShadow = true
    scene.add(patch)
  }
  const dirt = mesh(new THREE.CircleGeometry(1.6, 24), mat('#b9955f'), { y: 0.006, castShadow: false })
  dirt.rotation.x = -Math.PI / 2
  dirt.receiveShadow = true
  scene.add(dirt)
  const outer = mesh(new THREE.RingGeometry(GROUND_RADIUS, GROUND_RADIUS + 6, 48), mat('#8fbf7a'), { y: -0.01, castShadow: false })
  outer.rotation.x = -Math.PI / 2
  outer.receiveShadow = true
  scene.add(outer)
  // fence
  const post = mat('#a67c52')
  const fenceR = GROUND_RADIUS - 0.3
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2
    if (a > 4.9 && a < 5.5) continue // gate gap facing the camera
    const p = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 8), post, { x: Math.cos(a) * fenceR, y: 0.37, z: Math.sin(a) * fenceR })
    scene.add(p)
  }
  for (const h of [0.3, 0.58]) {
    const rail = mesh(new THREE.TorusGeometry(fenceR, 0.025, 6, 96, Math.PI * 2 - 0.6), post, { y: h })
    rail.rotation.x = Math.PI / 2
    rail.rotation.z = 5.5
    scene.add(rail)
  }
  // tree
  const tree = new THREE.Group()
  tree.position.set(-4.2, 0, -3.2)
  tree.add(mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 10), mat('#7a5230'), { y: 0.8 }))
  for (const [x, y, z, r] of [[0, 2.1, 0, 1.1], [0.7, 1.7, 0.3, 0.8], [-0.7, 1.8, -0.2, 0.85], [0.1, 2.8, -0.1, 0.7]]) {
    tree.add(mesh(new THREE.SphereGeometry(r, 14, 12), mat('#4f9a45'), { x, y, z }))
  }
  scene.add(tree)
  // doghouse
  const house = new THREE.Group()
  house.position.set(4.1, 0, -3.4)
  house.rotation.y = -0.5
  house.add(mesh(new THREE.BoxGeometry(1.5, 1.1, 1.4), mat('#c9473a'), { y: 0.55 }))
  const roof = mesh(new THREE.ConeGeometry(1.25, 0.75, 4), mat('#6b3a2e'), { y: 1.45 })
  roof.rotation.y = Math.PI / 4
  house.add(roof)
  house.add(mesh(new THREE.CircleGeometry(0.32, 20), mat('#2a1a14'), { y: 0.42, z: 0.71, castShadow: false }))
  scene.add(house)
  // lamp post (lit at night)
  const lampPost = new THREE.Group()
  lampPost.position.set(2.8, 0, 2.2)
  lampPost.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.5, 8), mat('#3a3a3a'), { y: 1.25 }))
  const bulb = mesh(new THREE.SphereGeometry(0.16, 10, 8), mat('#ffe7b3', { emissive: '#ffcc66', emissiveIntensity: 0 }), { y: 2.55 })
  lampPost.add(bulb)
  scene.add(lampPost)
  // ball and bone
  const ball = mesh(new THREE.SphereGeometry(0.22, 16, 12), mat('#d64545', { roughness: 0.5 }), { x: 1.5, y: 0.22, z: 1.2 })
  const stripe = mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 20), mat('#f6f1e8'), { x: 1.5, y: 0.22, z: 1.2 })
  ball.add(stripe)
  stripe.position.set(0, 0, 0)
  scene.add(ball)
  const ballState = { v: new THREE.Vector3() }
  const bone = new THREE.Group()
  bone.position.set(-2, 0.08, 2.6)
  bone.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), mat('#f2ead8')))
  bone.children[0].rotation.z = Math.PI / 2
  for (const x of [-0.2, 0.2]) for (const z of [-0.06, 0.06]) bone.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), mat('#f2ead8'), { x, z }))
  scene.add(bone)
  // water bowl, agility tunnel, dog bed, hydrant: the playground furniture
  const bowl = new THREE.Group()
  bowl.position.set(-1.4, 0, -1.9)
  bowl.add(mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.16, 18), mat('#c9ced6', { metalness: 0.5, roughness: 0.35 }), { y: 0.08 }))
  bowl.add(mesh(new THREE.CircleGeometry(0.28, 18), mat('#5aa9e6', { roughness: 0.2, metalness: 0.1 }), { y: 0.165, castShadow: false }))
  bowl.children[1].rotation.x = -Math.PI / 2
  scene.add(bowl)
  const tunnel = mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.9, 18, 1, true), mat('#3b82f6', { side: THREE.DoubleSide, roughness: 0.7 }), { x: 3.4, y: 0.45, z: 0.4 })
  tunnel.rotation.z = Math.PI / 2
  tunnel.rotation.y = 0.5
  scene.add(tunnel)
  const bed = new THREE.Group()
  bed.position.set(-3.4, 0, 0.8)
  bed.add(mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.16, 20), mat('#8b5e3c', { roughness: 0.9 }), { y: 0.08 }))
  bed.add(mesh(new THREE.TorusGeometry(0.48, 0.14, 10, 24), mat('#b98a5a', { roughness: 0.95 }), { y: 0.22 }))
  bed.children[1].rotation.x = Math.PI / 2
  scene.add(bed)
  const hydrant = new THREE.Group()
  hydrant.position.set(1.9, 0, -2.9)
  const red = mat('#d0342c', { roughness: 0.55 })
  hydrant.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 12), red, { y: 0.35 }))
  hydrant.add(mesh(new THREE.SphereGeometry(0.17, 12, 10), red, { y: 0.74 }))
  hydrant.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), red, { y: 0.45 }))
  hydrant.children[2].rotation.z = Math.PI / 2
  scene.add(hydrant)
  // dirt path from the gate to the centre
  for (let i = 0; i < 9; i++) {
    const z = 6 - i * 0.62
    const step = mesh(new THREE.CylinderGeometry(0.26 + (i % 2) * 0.06, 0.26, 0.02, 12), mat(i % 2 ? '#b9955f' : '#c4a06a'), { x: Math.sin(i * 0.9) * 0.25, y: 0.004, z, castShadow: false })
    step.receiveShadow = true
    scene.add(step)
  }
  // fireflies for the night version
  const fireflies = new THREE.Group()
  const flyRng = rng(77)
  for (let i = 0; i < 16; i++) {
    const f = mesh(new THREE.SphereGeometry(0.035, 6, 6), mat('#fff3a0', { emissive: '#ffe066', emissiveIntensity: 2 }), {
      x: (flyRng() - 0.5) * 10, y: 0.6 + flyRng() * 1.6, z: (flyRng() - 0.5) * 10, castShadow: false,
    })
    f.userData.phase = flyRng() * Math.PI * 2
    f.userData.base = f.position.clone()
    fireflies.add(f)
  }
  fireflies.visible = false
  scene.add(fireflies)

  // gravestone (only when the mascot is dead)
  const grave = new THREE.Group()
  grave.visible = false
  const stone = mesh(new THREE.BoxGeometry(0.7, 0.9, 0.18), mat('#8d8d8d'), { y: 0.45 })
  const stoneTop = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.18, 16, 1, false, 0, Math.PI), mat('#8d8d8d'), { y: 0.9 })
  stoneTop.rotation.x = Math.PI / 2
  stoneTop.rotation.z = Math.PI / 2
  grave.add(stone, stoneTop)
  grave.position.set(0, 0, -0.6)
  scene.add(grave)

  // corgis
  const corgis = new Map() // key -> { root, brain, traits, role }
  let mascotKey = null
  let mascotLife = 'fine'
  let mascotMood = 'content'
  let theme = 'light'

  function addCorgi(key, address, role) {
    const traits = traitsOf(address)
    const root = buildCorgi(traits)
    const random = rng(traits.seed ^ 0x9e3779b9)
    const brain = makeBrain(traits, random)
    if (role === 'mascot') {
      root.position.set(0, 0, 1.2)
      root.scale.multiplyScalar(1.25)
      root.userData.baseScale *= 1.25
      brain.speed *= 0.8
      brain.heading = 0
      brain.timer = 6
      brain.mode = MODES.sit
      brain.home = true
    } else {
      pickTarget(brain, new THREE.Vector3(0, 0, 0))
      root.position.copy(brain.target)
      pickTarget(brain, root.position)
    }
    if (role === 'ghost') {
      root.position.set(-1.6, 0, 3.4)
      root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45; o.castShadow = false } })
    }
    root.rotation.y = brain.heading
    root.userData.key = key
    root.userData.address = address
    root.userData.role = role
    scene.add(root)
    corgis.set(key, { root, brain, traits, role })
  }

  function removeCorgi(key) {
    const c = corgis.get(key)
    if (!c) return
    scene.remove(c.root)
    c.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose() } })
    corgis.delete(key)
  }

  function applyTheme(next) {
    theme = next
    const night = theme === 'dark'
    scene.background = new THREE.Color(night ? '#141a26' : '#cfe6f6')
    scene.fog = new THREE.Fog(scene.background, 14, 34)
    hemi.intensity = night ? 0.35 : 0.9
    hemi.color.set(night ? '#7c8fb3' : '#ffffff')
    sun.intensity = night ? 0.45 : 2.2
    sun.color.set(night ? '#9fb4ff' : '#fff4de')
    lamp.intensity = night ? 28 : 0
    bulb.material.emissiveIntensity = night ? 1.2 : 0
    fireflies.visible = night
  }
  applyTheme('light')

  // expression on the mascot from life and mood
  function applyExpression(c) {
    const p = c.root.userData.parts
    const life = c.role === 'mascot' ? mascotLife : 'fine'
    const mood = c.role === 'mascot' ? mascotMood : 'happy'
    const sad = life === 'sick' || life === 'critical' || mood === 'lonely'
    for (const brow of p.brows) brow.visible = sad
    p.brows[0].rotation.z = sad ? -0.5 : 0
    p.brows[1].rotation.z = sad ? 0.5 : 0
    p.tongue.visible = life !== 'dead' && (mood === 'happy' || mood === 'ecstatic')
    const ghost = c.role === 'mascot' && life === 'dead'
    c.root.traverse((o) => {
      if (!o.isMesh || c.role === 'ghost') return
      if (ghost && !o.material.userData.ghosted) {
        o.material = o.material.clone()
        o.material.transparent = true
        o.material.opacity = 0.5
        o.material.blending = THREE.AdditiveBlending
        o.material.emissive = new THREE.Color('#9fd3ff')
        o.material.emissiveIntensity = 0.35
        o.material.depthWrite = false
        o.material.userData.ghosted = true
        o.castShadow = false
      }
      if (!ghost && o.material.userData.ghosted) {
        o.material.transparent = false
        o.material.opacity = 1
        o.material.blending = THREE.NormalBlending
        o.material.emissiveIntensity = 0
        o.material.depthWrite = true
        o.material.userData.ghosted = false
        o.castShadow = true
      }
      // sick corgis go a little pale
      const pale = c.role === 'mascot' && (life === 'sick' || life === 'critical')
      if (o.material.userData.baseColor == null) o.material.userData.baseColor = o.material.color.clone()
      o.material.color.copy(o.material.userData.baseColor)
      if (pale) o.material.color.lerp(new THREE.Color('#cfe3c8'), 0.25)
    })
    grave.visible = ghost
  }

  // ---------------------------------------------------------------- update
  const clock = new THREE.Clock()
  const tmp = new THREE.Vector3()

  function animateCorgi(c, dt, now) {
    const { root, brain, traits } = c
    const p = root.userData.parts
    const life = c.role === 'mascot' ? mascotLife : 'fine'
    const mood = c.role === 'mascot' ? mascotMood : 'happy'
    const dead = c.role === 'mascot' && life === 'dead'
    const lying = life === 'sick' || life === 'critical'
    brain.timer -= dt

    if (dead) {
      // ghost: hover over the grave, drift gently
      root.position.x += (0 - root.position.x) * dt
      root.position.z += (0.6 - root.position.z) * dt
      root.position.y = 0.55 + Math.sin(now * 1.3 + brain.phase) * 0.12
      root.rotation.y = lerpAngle(root.rotation.y, 0, dt * 2)
      for (const leg of p.legs) leg.rotation.x = 0.4
      p.head.rotation.x = 0.1
      return
    }

    if (lying) {
      // sick: lies down, snout to the floor; critical: flat out, breathing at half speed
      const critical = life === 'critical'
      root.position.y = 0
      p.body.position.y = critical ? -0.2 : -0.16
      for (const [i, leg] of p.legs.entries()) leg.rotation.x = i < 2 ? 1.3 : -1.3
      p.head.rotation.x = critical ? 0.75 + Math.sin(now * 0.5) * 0.03 : 0.5 + Math.sin(now * 0.8) * 0.06
      p.body.scale.y = (critical ? 0.7 : 0.88) + Math.sin(now * (critical ? 0.9 : 1.8)) * 0.02
      p.tail.rotation.y = Math.sin(now * (critical ? 0.6 : 1.5)) * 0.1
      return
    }
    p.body.position.y = 0
    p.body.scale.y = 1

    if (brain.timer <= 0) {
      const r = brain.random()
      const nearBall = ball.position.distanceTo(root.position) < 4
      if (brain.home && brain.mode !== MODES.walk && r < 0.7) {
        // THE corgi mostly holds court front and centre, facing the visitor
        brain.mode = brain.mode === MODES.sit ? MODES.idle : MODES.sit
        brain.timer = 4 + brain.random() * 4
        brain.target.set(0, 0, 1.2)
        if (root.position.distanceTo(brain.target) > 0.3) { brain.mode = MODES.walk }
        else root.rotation.y = lerpAngle(root.rotation.y, 0, 0.5)
      } else if (brain.mode === MODES.walk || brain.mode === MODES.ball) brain.mode = MODES.idle
      else if (traits.personality === 'lazy' && r < 0.35) brain.mode = MODES.lie
      else if (r < 0.18) brain.mode = MODES.sit
      else if (r < 0.36) brain.mode = MODES.sniff
      else if (nearBall && r < 0.5 && traits.personality !== 'lazy') brain.mode = MODES.ball
      else if (corgis.size > 1 && r < 0.62) brain.mode = MODES.greet
      else brain.mode = MODES.walk
      if (brain.mode === MODES.walk && !brain.home) pickTarget(brain, root.position)
      if (brain.mode === MODES.walk && brain.home && brain.random() < 0.5) { const a = brain.random() * Math.PI * 2; brain.target.set(Math.cos(a) * 1.6, 0, 1.2 + Math.sin(a) * 1.2) }
      if (brain.mode === MODES.ball) brain.target.copy(ball.position).setY(0)
      if (brain.mode === MODES.greet) {
        const others = [...corgis.values()].filter((o) => o !== c && o.role !== 'ghost')
        const o = others[Math.floor(brain.random() * others.length)]
        if (o) brain.target.copy(o.root.position).setY(0)
        else brain.mode = MODES.walk
      }
      const durations = { idle: 1.5, sit: 4, sniff: 2.5, lie: 6, walk: 8, ball: 6, greet: 6 }
      brain.timer = durations[brain.mode] * (0.7 + brain.random() * 0.6) / traits.tempo
      if (c.role === 'mascot' && (mood === 'ecstatic' || mood === 'happy') && brain.random() < 0.5) brain.jump = 1
    }

    const moving = brain.mode === MODES.walk || brain.mode === MODES.ball || brain.mode === MODES.greet
    if (moving) {
      tmp.subVectors(brain.target, root.position).setY(0)
      const dist = tmp.length()
      const stopAt = brain.mode === MODES.greet ? 0.9 : 0.15
      if (dist < stopAt) {
        if (brain.mode === MODES.ball && dist < 0.5) {
          ballState.v.copy(tmp).normalize().multiplyScalar(2.5 + brain.random() * 2)
          ballState.v.y = 2.2
        }
        brain.mode = MODES.idle
        brain.timer = 1 + brain.random()
      } else {
        const desired = Math.atan2(tmp.x, tmp.z)
        root.rotation.y = lerpAngle(root.rotation.y, desired, Math.min(1, dt * 4))
        const step = Math.min(dist, brain.speed * dt)
        root.position.x += Math.sin(root.rotation.y) * step
        root.position.z += Math.cos(root.rotation.y) * step
        brain.phase += dt * 9 * traits.tempo
        const swing = Math.sin(brain.phase) * 0.7
        p.legs[0].rotation.x = swing; p.legs[3].rotation.x = swing
        p.legs[1].rotation.x = -swing; p.legs[2].rotation.x = -swing
        p.body.position.y = Math.abs(Math.sin(brain.phase)) * 0.035
        p.head.rotation.x = Math.sin(brain.phase * 2) * 0.05
        p.tail.rotation.y = Math.sin(now * 12) * 0.5
      }
    } else {
      for (const leg of p.legs) leg.rotation.x *= 0.85
      if (brain.mode === MODES.sit) {
        p.legs[2].rotation.x = -1.3; p.legs[3].rotation.x = -1.3
        p.body.rotation.x = -0.25
        p.body.position.y = -0.06
        p.head.rotation.x = -0.1
      } else if (brain.mode === MODES.lie) {
        for (const [i, leg] of p.legs.entries()) leg.rotation.x = i < 2 ? 1.1 : -1.1
        p.body.position.y = -0.15
        p.head.rotation.x = 0.25 + Math.sin(now * 1.2) * 0.04
      } else if (brain.mode === MODES.sniff) {
        p.body.rotation.x = 0.15
        p.head.rotation.x = 0.7 + Math.sin(now * 9) * 0.08
        p.tail.rotation.y = Math.sin(now * 10) * 0.6
      } else {
        p.body.rotation.x *= 0.85
        p.head.rotation.x = Math.sin(now * 0.7 + brain.phase) * 0.06
        p.head.rotation.y = Math.sin(now * 0.45 + brain.phase) * 0.35
        p.tail.rotation.y = Math.sin(now * (mood === 'ecstatic' ? 14 : 4)) * (mood === 'lonely' ? 0.05 : 0.35)
      }
      if (brain.mode !== MODES.sit && brain.mode !== MODES.lie) { p.body.rotation.x *= 0.9 }
    }
    // snappy ear flicks and head tilts every few seconds
    brain.flickAt ??= now + 2 + brain.random() * 3
    if (now > brain.flickAt) {
      brain.flick = 0.35
      brain.flickEar = Math.floor(brain.random() * 2)
      brain.tilt = brain.random() < 0.5 ? 0.5 : -0.5
      brain.flickAt = now + 2.5 + brain.random() * 5
    }
    if (brain.flick > 0) {
      brain.flick -= dt
      const k = Math.sin((brain.flick / 0.35) * Math.PI * 2)
      p.ears[brain.flickEar].rotation.x = k * 0.5
      p.head.rotation.z = brain.tilt * (brain.flick / 0.35) * 0.6
    } else {
      p.head.rotation.z *= 0.85
      for (const ear of p.ears) ear.rotation.x *= 0.7
    }
    for (const [i, ear] of p.ears.entries()) {
      const base = ear.userData.base ?? (ear.userData.base = ear.rotation.z)
      ear.rotation.z = base + Math.sin(now * 3 + i * 1.7 + brain.phase) * 0.05
    }
    // hovered corgi looks at the pointer
    if (brain.lookAt) {
      tmp.copy(brain.lookAt).sub(root.position)
      const yaw = Math.atan2(tmp.x, tmp.z) - root.rotation.y
      p.head.rotation.y = lerpAngle(p.head.rotation.y, Math.max(-1, Math.min(1, ((yaw + Math.PI) % (Math.PI * 2)) - Math.PI)), 0.3)
    }
    // squash and spring after a click
    if (brain.squash > 0) {
      brain.squash = Math.max(0, brain.squash - dt * 3)
      const k = Math.sin((1 - brain.squash) * Math.PI)
      root.scale.y = root.userData.baseScale * (1 - 0.3 * k)
      if (brain.squash < 0.5) brain.jump = Math.max(brain.jump, brain.squash * 2)
    } else {
      root.scale.y = root.userData.baseScale
    }
    // revival: pop in from nothing with a spin
    if (brain.pop > 0) {
      brain.pop = Math.max(0, brain.pop - dt * 1.2)
      const k = 1 - brain.pop
      const s = k < 0.7 ? (k / 0.7) * 1.2 : 1.2 - ((k - 0.7) / 0.3) * 0.2
      root.scale.setScalar(root.userData.baseScale * s)
      root.rotation.y += dt * 10 * brain.pop
    }
    // happy jump
    if (brain.jump > 0) {
      brain.jump = Math.max(0, brain.jump - dt * 1.6)
      root.position.y = Math.sin((1 - brain.jump) * Math.PI) * 0.5
      root.rotation.y += dt * 4
    } else {
      root.position.y = 0
    }
    // keep inside the fence
    const r = Math.hypot(root.position.x, root.position.z)
    if (r > WANDER_RADIUS + 0.4) { root.position.multiplyScalar((WANDER_RADIUS + 0.4) / r); pickTarget(brain, root.position) }
  }

  function updateBall(dt) {
    if (ballState.v.lengthSq() < 0.0001 && ball.position.y <= 0.221) return
    ballState.v.y -= 9 * dt
    ball.position.addScaledVector(ballState.v, dt)
    if (ball.position.y < 0.22) { ball.position.y = 0.22; ballState.v.y *= -0.45; ballState.v.x *= 0.7; ballState.v.z *= 0.7 }
    const r = Math.hypot(ball.position.x, ball.position.z)
    if (r > WANDER_RADIUS) { ball.position.multiplyScalar(WANDER_RADIUS / r); ballState.v.x *= -0.5; ballState.v.z *= -0.5 }
    ball.rotation.x += ballState.v.z * dt * 3
    ball.rotation.z -= ballState.v.x * dt * 3
    if (ballState.v.lengthSq() < 0.01 && ball.position.y <= 0.221) ballState.v.set(0, 0, 0)
  }

  let raf = 0
  let running = false
  function frame() {
    raf = 0
    const dt = Math.min(0.05, clock.getDelta())
    const now = clock.elapsedTime
    if (!reducedMotion) {
      for (const c of corgis.values()) animateCorgi(c, dt, now)
      updateBall(dt)
      if (fireflies.visible) {
        for (const f of fireflies.children) {
          f.position.y = f.userData.base.y + Math.sin(now * 1.1 + f.userData.phase) * 0.25
          f.position.x = f.userData.base.x + Math.sin(now * 0.5 + f.userData.phase) * 0.4
          f.material.emissiveIntensity = 1.2 + Math.sin(now * 4 + f.userData.phase * 3) * 1
        }
      }
    }
    controls.update()
    renderer.render(scene, camera)
    if (running && !document.hidden) raf = requestAnimationFrame(frame)
  }
  function start() {
    if (raf) return
    running = true
    raf = requestAnimationFrame(frame)
  }
  function renderOnce() { if (!raf) raf = requestAnimationFrame(frame) }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start() })
  if (reducedMotion) controls.addEventListener('change', renderOnce)

  // picking
  const ray = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pickAt(ev) {
    const rect = canvas.getBoundingClientRect()
    pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
    ray.setFromCamera(pointer, camera)
    const hits = ray.intersectObjects([...corgis.values()].map((c) => c.root), true)
    if (hits.length === 0) return null
    let o = hits[0].object
    while (o && o.userData.key == null) o = o.parent
    return o ? { key: o.userData.key, address: o.userData.address, role: o.userData.role, traits: o.userData.traits, x: ev.clientX - rect.left, y: ev.clientY - rect.top } : null
  }
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4)
  const pointerWorld = new THREE.Vector3()
  canvas.addEventListener('pointermove', (ev) => {
    const hit = pickAt(ev)
    ray.ray.intersectPlane(groundPlane, pointerWorld)
    for (const c of corgis.values()) {
      const near = c.root.position.distanceTo(pointerWorld) < 2.2
      c.brain.lookAt = near ? pointerWorld.clone() : null
    }
    canvas.style.cursor = hit ? 'pointer' : ''
    if (onHover) onHover(hit)
  })
  canvas.addEventListener('pointerleave', () => { for (const c of corgis.values()) c.brain.lookAt = null; if (onHover) onHover(null) })
  canvas.addEventListener('click', (ev) => {
    const hit = pickAt(ev)
    if (hit) { const c = corgis.get(hit.key); if (c) { c.brain.squash = 1; c.brain.jump = 0 } }
    if (onPick) onPick(hit)
  })

  function resize() {
    const w = canvas.clientWidth || 800
    const h = canvas.clientHeight || 420
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    if (reducedMotion) renderOnce()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  function setState(state) {
    if (state.theme && state.theme !== theme) applyTheme(state.theme)
    const wasDead = mascotLife === 'dead'
    mascotLife = state.life ?? mascotLife
    if (wasDead && mascotLife !== 'dead' && corgis.has('mascot')) corgis.get('mascot').brain.pop = 1
    mascotMood = state.mood ?? mascotMood
    const wanted = new Map()
    if (state.payer) wanted.set('mascot', { address: state.payer, role: 'mascot' })
    for (const p of state.park ?? []) wanted.set(`park:${p.owner.toLowerCase()}`, { address: p.owner, role: 'park' })
    if (state.ghost && !wanted.has(`park:${state.ghost.toLowerCase()}`)) wanted.set('ghost', { address: state.ghost, role: 'ghost' })
    for (const key of [...corgis.keys()]) if (!wanted.has(key)) removeCorgi(key)
    for (const [key, w] of wanted) if (!corgis.has(key)) addCorgi(key, w.address, w.role)
    mascotKey = wanted.has('mascot') ? 'mascot' : null
    for (const c of corgis.values()) {
      applyExpression(c)
      if (reducedMotion) animateCorgi(c, 0, 0) // static pose only
    }
    if (reducedMotion) renderOnce()
    else start()
  }

  function destroy() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    ro.disconnect()
    controls.dispose()
    renderer.dispose()
  }

  return { setState, resize, destroy, scene, camera, controls, renderer, corgis, renderOnce, get mascotKey() { return mascotKey } }
}
