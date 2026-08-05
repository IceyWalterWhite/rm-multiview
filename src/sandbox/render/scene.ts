import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FIELD_CENTER_Y } from '../fieldMap';
import type { SandboxRobot } from '../fleet';

/**
 * 3D 沙盘的渲染层。
 *
 * 从 `sandbox_preview.html`（定版原型）移植而来，视觉部分逐行保持一致 ——
 * 那套配色、饼径、毛玻璃白圈、四旋翼图标都是调过的，不在这里重新发明。
 * 移植时改掉的只有三件事：three 从 CDN 换成 npm 依赖、假数据换成真遥测、
 * 加上「这一路现在可不可信」的表达（隐藏 / 变暗 / 褪色）。
 *
 * 场地系约定：米制，X∈[-14,14]（红方在 +X），Y 向上，yaw 0=+X 逆时针。
 * three 里是 Y-up，所以场地 (x,y) 落到 (x, 高度, -y)。
 */

/** 主行驶面顶（世界 y）。场地还没加载完时的兜底高度。 */
const FLOOR = -1.641;
const TEAM: Record<string, string> = { red: '#ff453a', blue: '#4a7bff' };
/** 空中机器人的显示高度（米）。真实高度读不出来，取一个看得清系绳的固定值。 */
const AIR_ALT = 2.3;

/** 位置陈旧到这个程度就完全褪掉 —— 再画下去就是在骗人。 */
const STALE_FADE_MS = 8_000;

export interface SandboxScene {
  update(robots: readonly SandboxRobot[]): void;
  resize(width: number, height: number): void;
  setView(view: 'top' | 'oblique'): void;
  /** 场地模型加载完成。失败时 reject，调用方据此显示降级文案。 */
  readonly fieldLoaded: Promise<void>;
  dispose(): void;
}

interface Spring {
  v: number;
  vel: number;
  t: number;
  response: number;
}
const mkSpring = (v: number, response: number): Spring => ({ v, vel: 0, t: v, response });
function stepSpring(s: Spring, dt: number): void {
  // 临界阻尼：不过冲、不振荡。response 是「跟上目标」的特征时间
  const w = (2 * Math.PI) / s.response;
  s.vel += (w * w * (s.t - s.v) - 2 * w * s.vel) * dt;
  s.v += s.vel * dt;
}
const wrap = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
};

interface RobotNode {
  grp: THREE.Group;
  icon: THREE.Object3D;
  air: boolean;
  numGrp: THREE.Group | null;
  materials: THREE.Material[];
  sx: Spring;
  sy: Spring;
  sz: Spring;
  sh: Spring;
  nTarget: THREE.Vector3 | null;
  /** 还没收到过位置时不画 —— 画在 (0,0) 比不画更误导 */
  seen: boolean;
}

function numTexture(num: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.font = '700 84px system-ui';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 10;
  c.strokeStyle = 'rgba(0,0,0,0.55)';
  c.strokeText(String(num), 64, 70);
  c.fillStyle = '#fff';
  c.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

export function createScene(canvas: HTMLCanvasElement, glbUrl: string): SandboxScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101318);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3a34, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(1, 2, 1.2);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-1, 0.6, -0.3);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  const ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = false;
  ctl.zoomSpeed = 1.4;

  /**
   * 相机距离按画布宽高比算，不写死。
   *
   * 场地是 29×16 的横向矩形，而容器宽高比从宽屏到窄屏能差一倍多。距离写死的话，
   * 要么宽屏上场地缩成中间一条（大量黑边），要么窄屏上两头出画。
   * 这里取「装下宽度」与「装下进深」两个距离的较大者，再留 8% 余量。
   */
  const HALF_W = 14.6; // 木质底板半宽（29.01/2）
  const HALF_D = 8.2; // 半进深（16.0/2）
  const TILT = 0.28; // 相机后仰弧度：纯俯视看不出高台落差，给一点立体感
  function fitTop(): void {
    const vHalf = (cam.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
    const d = Math.max(HALF_W / Math.tan(hHalf), HALF_D / Math.tan(vHalf)) * 1.08;
    ctl.target.set(0, 0, -FIELD_CENTER_Y);
    cam.position.set(0, d * Math.cos(TILT), -FIELD_CENTER_Y + d * Math.sin(TILT));
    ctl.update();
  }

  // ---------- 场地 ----------
  let fieldRoot: THREE.Object3D | null = null;
  const ray = new THREE.Raycaster();
  const UP = new THREE.Vector3(0, 1, 0);
  function groundAt(x: number, y: number): { h: number; n: THREE.Vector3 } {
    if (!fieldRoot) return { h: FLOOR, n: UP.clone() };
    ray.set(new THREE.Vector3(x, 8, -y), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(fieldRoot, true)[0];
    if (!hit) return { h: FLOOR, n: UP.clone() };
    let n = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : UP.clone();
    if (n.y < 0) n.negate();
    // 比 45° 坡还陡的法向 = 打到墙沿/立面的噪声，保持水平防倒扣
    if (n.y < 0.68) n = UP.clone();
    return { h: hit.point.y, n };
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const fieldLoaded = new Promise<void>((resolve, reject) => {
    loader.load(
      glbUrl,
      (g) => {
        const bg = g.scene;
        // 原始 GLB 是 Z-up，导出链路上没统一过。按包围盒判断再转，比写死更耐改
        const size = new THREE.Box3().setFromObject(bg).getSize(new THREE.Vector3());
        if (size.z < size.y) bg.rotation.x = -Math.PI / 2;
        bg.updateMatrixWorld(true);
        scene.add(bg);
        fieldRoot = bg;
        // 场地就位后立刻把已有机器人的高度校正一次，免得它们悬在兜底平面上
        for (const r of robots.values()) {
          const g2 = groundAt(r.sx.v, r.sy.v);
          r.sz.v = r.sz.t = g2.h;
          if (!r.air) r.nTarget = g2.n;
        }
        resolve();
      },
      undefined,
      (e) => reject(e instanceof Error ? e : new Error(String(e))),
    );
  });

  // ---------- 机器人标记 ----------
  const robots = new Map<string, RobotNode>();
  const _q = new THREE.Quaternion();
  /** 首个真实画布尺寸到达前不取景 —— 那时 aspect 还是 1，算出来的距离是错的 */
  let fitted = false;

  function addRobot(team: string, num: number, air: boolean): RobotNode {
    const col = TEAM[team] ?? '#888888';
    const grp = new THREE.Group();
    const materials: THREE.Material[] = [];
    let icon: THREE.Object3D;
    let numGrp: THREE.Group | null = null;

    if (air) {
      const g = new THREE.Group();
      const lcol = new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.2);
      const dm = new THREE.MeshStandardMaterial({
        color: lcol,
        emissive: lcol.clone(),
        emissiveIntensity: 0.5,
        roughness: 0.5,
        toneMapped: false,
      });
      const wm = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
      materials.push(dm, wm);
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 1.02), dm);
        arm.rotation.y = a;
        g.add(arm);
      }
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const rot = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 10, 28), dm);
        rot.rotation.x = -Math.PI / 2;
        rot.position.set(sx * 0.36, 0.03, sz * 0.36);
        g.add(rot);
      }
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.34), dm));
      const ns = new THREE.Shape();
      ns.moveTo(-0.08, 0);
      ns.lineTo(0, 0.15);
      ns.lineTo(0.08, 0);
      ns.closePath();
      const nose = new THREE.Mesh(
        new THREE.ExtrudeGeometry(ns, { depth: 0.05, bevelEnabled: false }),
        wm,
      );
      nose.rotation.x = -Math.PI / 2;
      nose.position.set(0, 0.05, -0.17);
      g.add(nose);
      g.position.y = AIR_ALT;
      grp.add(g);
      icon = g;

      // 高度系绳 + 地面投影环：不然空中目标看不出自己悬在哪一点上方
      const ringMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 32), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      grp.add(ring);
      const lm = new THREE.LineDashedMaterial({
        color: col,
        dashSize: 0.12,
        gapSize: 0.1,
        transparent: true,
        opacity: 0.65,
        toneMapped: false,
      });
      const lg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.02, 0),
        new THREE.Vector3(0, AIR_ALT, 0),
      ]);
      const line = new THREE.Line(lg, lm);
      line.computeLineDistances();
      grp.add(line);
      materials.push(ringMat, lm);
    } else {
      const coreMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
      materials.push(coreMat);
      const g = new THREE.Group(); // 朝向组：箭喙绕竖直轴随朝向转
      const bs = new THREE.Shape();
      bs.moveTo(-0.17, 0.38);
      bs.lineTo(0, 0.68);
      bs.lineTo(0.17, 0.38);
      bs.closePath();
      const beak = new THREE.Mesh(
        new THREE.ExtrudeGeometry(bs, { depth: 0.08, bevelEnabled: false }),
        coreMat,
      );
      beak.rotation.x = -Math.PI / 2;
      beak.position.y = 0.015;
      g.add(beak);
      grp.add(g);
      icon = g;

      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.11, 48), coreMat);
      disc.position.y = 0.07;
      grp.add(disc);

      const rs = new THREE.Shape();
      rs.absarc(0, 0, 0.34, 0, Math.PI * 2);
      const hole = new THREE.Path();
      hole.absarc(0, 0, 0.275, 0, Math.PI * 2, true);
      rs.holes.push(hole);
      const rimMat = new THREE.MeshPhysicalMaterial({
        color: '#b5b5b5',
        transmission: 0.45,
        roughness: 0.6,
        thickness: 0.15,
        ior: 1.45,
        clearcoat: 0.4,
        clearcoatRoughness: 0.3,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.02,
      });
      const rim = new THREE.Mesh(
        new THREE.ExtrudeGeometry(rs, { depth: 0.11, bevelEnabled: false, curveSegments: 48 }),
        rimMat,
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.015;
      grp.add(rim);
      materials.push(rimMat);

      numGrp = new THREE.Group();
      numGrp.position.y = 0.132;
      const numMat = new THREE.MeshBasicMaterial({
        map: numTexture(num),
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      });
      const np = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), numMat);
      np.rotation.x = -Math.PI / 2;
      numGrp.add(np);
      grp.add(numGrp);
      materials.push(numMat);
    }

    for (const m of materials) m.transparent = true;
    grp.visible = false; // 收到位置之前不画
    scene.add(grp);
    const node: RobotNode = {
      grp,
      icon,
      air,
      numGrp,
      materials,
      sx: mkSpring(0, 0.5),
      sy: mkSpring(0, 0.5),
      sz: mkSpring(FLOOR, 0.5),
      sh: mkSpring(0, 0.35),
      nTarget: null,
      seen: false,
    };
    robots.set(team + num, node);
    return node;
  }

  // ---------- 主循环 ----------
  let last = performance.now();
  let raf = 0;
  function tick(): void {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const r of robots.values()) {
      if (!r.seen) continue;
      stepSpring(r.sx, dt);
      stepSpring(r.sy, dt);
      stepSpring(r.sz, dt);
      stepSpring(r.sh, dt);
      r.grp.position.set(r.sx.v, r.sz.v, -r.sy.v);
      r.icon.rotation.y = r.sh.v - Math.PI / 2;
      if (!r.air && r.nTarget) {
        // 圆饼贴坡：整组对齐地面法向，斜面上不穿模
        _q.setFromUnitVectors(UP, r.nTarget);
        r.grp.quaternion.slerp(_q, 1 - Math.exp(-8 * dt));
      }
      if (r.numGrp) {
        // 编号平躺在饼面上，但读向永远朝观众
        const hx = r.grp.position.x - cam.position.x;
        const hz = r.grp.position.z - cam.position.z;
        if (Math.hypot(hx, hz) > 0.05) r.numGrp.rotation.y = Math.atan2(-hx, -hz);
      }
    }
    renderer.render(scene, cam);
  }
  raf = requestAnimationFrame(tick);

  return {
    update(list) {
      for (const rb of list) {
        const key = rb.team + rb.num;
        const node = robots.get(key) ?? addRobot(rb.team, rb.num, rb.kind === 'drone');
        if (!rb.pose) {
          node.grp.visible = false;
          continue;
        }
        if (!node.seen) {
          // 第一次拿到位置：直接落位，不要从 (0,0) 一路滑过去
          node.seen = true;
          node.sx.v = node.sx.t = rb.pose.x;
          node.sy.v = node.sy.t = rb.pose.y;
          if (rb.pose.yaw !== null) node.sh.v = node.sh.t = rb.pose.yaw;
          const g = groundAt(rb.pose.x, rb.pose.y);
          node.sz.v = node.sz.t = g.h;
          if (!node.air) node.nTarget = g.n;
        } else {
          node.sx.t = rb.pose.x;
          node.sy.t = rb.pose.y;
          const g = groundAt(rb.pose.x, rb.pose.y);
          node.sz.t = g.h;
          if (!node.air) node.nTarget = g.n;
          // 朝向走最短弧，跨越 ±π 时不绕远路
          if (rb.pose.yaw !== null) node.sh.t = node.sh.v + wrap(rb.pose.yaw - node.sh.v);
        }
        node.grp.visible = true;

        // 「这一路现在可不可信」直接画在不透明度上：
        // 阵亡压到 0.45，位置越陈旧越淡，超过 STALE_FADE_MS 完全消失。
        const stale = Math.max(0, 1 - rb.poseAgeMs / STALE_FADE_MS);
        const alpha = (rb.status === 'dead' ? 0.45 : 1) * stale;
        if (alpha <= 0.02) {
          node.grp.visible = false;
        } else {
          for (const m of node.materials) m.opacity = alpha;
        }
      }
    },
    resize(width, height) {
      const aspect = width / Math.max(1, height);
      const first = cam.aspect !== aspect && !fitted;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      // 只在拿到第一个真实尺寸时自动取景。之后再动会把用户自己转过的视角抢回去 ——
      // 窗口缩放不该重置观众的观察角度
      if (first) {
        fitted = true;
        fitTop();
      }
    },
    setView(view) {
      if (view === 'top') {
        fitTop();
      } else {
        ctl.target.set(0, 0, -FIELD_CENTER_Y);
        cam.position.set(0, 14, 14);
        ctl.update();
      }
    },
    fieldLoaded,
    dispose() {
      cancelAnimationFrame(raf);
      ctl.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      robots.clear();
    },
  };
}
