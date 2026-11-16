/**
 * The 2D / 3D map renderer (port of the web explorer's components/maps/map-renderer.ts, plans/33) on expo-gl: three.js
 * draws into the GLView's context, no DOM. One instanced mesh per (shape, look) so thousands of parts draw in a handful
 * of calls; rendering happens on demand (a camera move, a change), never in a loop; each frame ends with endFrameEXP.
 *
 *   - 3D: a perspective camera orbiting a target: one finger turns, two fingers pan, a pinch zooms (the web's
 *     OrbitControls touch scheme). `focus` moves the target (following a player).
 *   - 2D: the same scene from straight above through an orthographic camera (north, -Z, up); one or two fingers pan, a
 *     pinch zooms toward the fingers.
 *   - The Y band: two clipping planes hide geometry above and below it (walls are cut like a floor plan); layer marks
 *     outside the band are left out.
 *   - See-through looks (glassy, invisible walls, markers) are drawn as solid shapes: a depth-only pre-pass, then one blend
 *     of the nearest surface per pixel (a stencil bit per look), so a part's back and inner faces never show through its
 *     front. Where the band cuts a part open, its inner faces show as a flat cap (a floor-plan section: solids darker,
 *     walls and glass less see-through). They are pulled toward the camera (polygon offset): a wall's bottom on the floor's
 *     top doesn't z-fight it.
 *   - Parts, by the draw rule (maps.ts partKind / isDrawn): everything that collides, visible or not, and visible
 *     non-colliding parts that aren't meshes or unions; non-colliding meshes / unions only with `decorative`, invisible
 *     non-colliding parts only with `markers`. Real part colors, never a tint: solid (transparency < 0.5), glassy (< 0.95,
 *     see-through), invisible walls (collide, >= 0.95: their color, half see-through), markers (faint). MeshParts and
 *     unions are their boxes, marked by a thin dark outline (not a fill color, which would read like the game's).
 *   - Layers (world coordinates): points (fixed-size dots), paths (lines), polygons (filled, a camera cone), heat cells
 *     (flat squares at the cell's height, colored by count on a log scale).
 *   - Textures (plans/36 phase 5, the `textures` option, default on): Decals and Textures as quads on their part's face,
 *     one instanced mesh per image (map-textures.ts groupSurfaces); MaterialVariant parts with the variant's ColorMap
 *     tiled every StudsPerTile studs; solid parts with a light procedural pattern per built-in Material
 *     (MATERIAL_LOOK_GLSL). Images come from GET /v1/images/<id> as cached files (images.ts), uploaded as
 *     `{ localUri }` textures (expo-gl reads the file); until one arrives its parts keep their plain colour.
 *   - Actors (the recordings' Player view): caller-owned objects in their own group; `setView` renders from a fixed
 *     camera instead of the orbit / map controls, and `pickActor` finds the actor under a point.
 * Shapes follow Roblox's: a cylinder's axis is the part's X; a wedge's slope faces -Z (its tall face is +Z); the corner
 * wedge's peak is over its (+X, -Z) corner (not checked against Studio).
 *
 * Points in the API (`pickAt`, `worldAt`, the gestures) are in the view's layout units (dp), from its top left.
 */
import * as THREE from "three";
import type { ExpoWebGLRenderingContext } from "expo-gl";

import { groupSurfaces, ImageLoader, MATERIAL_LOOK_GLSL, partVariant, type ImageFetch, type LocalImage, type SurfaceGroup } from "./map-textures";
import { FLAGS, heatColor, isDrawn, partKind, type Bounds, type MapGeometry, type MapLayer, type MapPoint, type Vec3 } from "./maps";

export type MapMode = "2d" | "3d";

/** A fixed camera (the replay's Player view): position, unit look direction, vertical FOV in degrees (Roblox's FieldOfView). */
export interface ViewCamera {
	position: Vec3;
	look: Vec3;
	fov: number;
}

export interface SceneOptions {
	mode: MapMode;
	offset: Vec3;
	band: [number, number] | null;
	/** Non-colliding meshes and unions. */
	decorative: boolean;
	/** Invisible non-colliding parts. */
	markers: boolean;
	/** Decals, Textures, MaterialVariants and the built-in materials' look (default on). */
	textures?: boolean;
}

/** A unit box's 12 edges (24 endpoints), for the mesh / union outlines. */
const BOX_EDGES = (() => {
	const c = [-0.5, 0.5];
	const out: number[] = [];
	for (const a of c) for (const b of c) out.push(-0.5, a, b, 0.5, a, b, a, -0.5, b, a, 0.5, b, a, b, -0.5, a, b, 0.5);
	return out;
})();

// Triangles wound counter-clockwise seen from outside (front faces out), like three's own shapes: back faces are the
// inside, which shows only where the band cuts a part open (drawn as the cap).
function wedgeGeometry(): THREE.BufferGeometry {
	const A = [-0.5, -0.5, -0.5], B = [0.5, -0.5, -0.5], C = [0.5, -0.5, 0.5], D = [-0.5, -0.5, 0.5], E = [-0.5, 0.5, 0.5], F = [0.5, 0.5, 0.5];
	return triangles([A, B, C, A, C, D, D, C, F, D, F, E, A, F, B, A, E, F, A, D, E, B, F, C]);
}

function cornerWedgeGeometry(): THREE.BufferGeometry {
	const A = [-0.5, -0.5, -0.5], B = [0.5, -0.5, -0.5], C = [0.5, -0.5, 0.5], D = [-0.5, -0.5, 0.5], P = [0.5, 0.5, -0.5];
	return triangles([A, B, C, A, C, D, B, P, C, A, P, B, A, D, P, D, C, P]);
}

function triangles(vertices: number[][]): THREE.BufferGeometry {
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flat(), 3));
	g.computeVertexNormals();
	return g;
}

/** The unit shapes by Roblox shape index: ball, block, cylinder (axis X), wedge, corner wedge. */
export function shapeGeometries(): THREE.BufferGeometry[] {
	const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
	cylinder.rotateZ(-Math.PI / 2);
	return [new THREE.SphereGeometry(0.5, 18, 12), new THREE.BoxGeometry(1, 1, 1), cylinder, wedgeGeometry(), cornerWedgeGeometry()];
}

export type Look = "solid" | "glassy" | "wall" | "marker";

/**
 * The see-through looks in draw order: opacity, how much more opaque their cut (cap) is, and their stencil bit (one blend
 * per pixel per look). Markers' caps stay faint: they're often big zones the camera is inside, where every back face is
 * "cap".
 */
export const SEE_THROUGH = [
	{ look: "glassy", opacity: 0.35, cap: 0.5, bit: 1 },
	{ look: "wall", opacity: 0.55, cap: 0.5, bit: 2 },
	{ look: "marker", opacity: 0.18, cap: 0, bit: 4 },
] as const satisfies readonly { look: Exclude<Look, "solid">; opacity: number; cap: number; bit: number }[];

/** Above the 3D layer marks (10+, drawn first so walls tint what's behind them), under the 2D ones (2000+, on top). */
const PARTS_ORDER = 1000;

/**
 * Where the band cuts a part open, its inside (back faces) shows. Drawn flat (unlit), it reads as a filled section, the
 * cut: solids darker (their own color, shade 0.45), see-through parts their full color and less see-through (SEE_THROUGH
 * cap: half way to opaque), so walls cut by the band stand out in the top-down view.
 */
function withCap(material: THREE.MeshLambertMaterial, shade: number, opaque: number, extra: Omit<ShaderPatch, "cap"> = {}): THREE.MeshLambertMaterial {
	return patchMaterial(material, { ...extra, cap: { shade, opaque } });
}

/** What patchMaterial adds to a Lambert material's shader. */
export interface ShaderPatch {
	/** Back faces drawn flat (the band's cut). */
	cap?: { shade: number; opaque: number };
	/** The built-in materials' look (needs the `ttMaterial` instance attribute); the uniform turns it on (1) or off (0). */
	look?: { value: number };
	/** The map tiled every `value` studs over the part (a MaterialVariant's ColorMap). */
	tile?: { value: number };
	/** A Decal / Texture quad: `ttUv` (repeat u, v, offset u, v) and `ttTint` (rgb, alpha) per instance. */
	surface?: boolean;
}

const PLANE_GLSL = "vec2 ttPlane(vec3 p, vec3 n) { vec3 a = abs(n); return a.x > 0.5 ? p.zy : (a.y > 0.5 ? p.xz : p.xy); }";

/** Patches a Lambert material's shader (cap, look, tile, surface); one program per distinct patch. */
export function patchMaterial<M extends THREE.MeshLambertMaterial>(material: M, patch: ShaderPatch): M {
	const cap = patch.cap ? `if (!gl_FrontFacing) { outgoingLight = diffuseColor.rgb * ${patch.cap.shade.toFixed(3)}; diffuseColor.a = mix(diffuseColor.a, 1.0, ${patch.cap.opaque.toFixed(3)}); }` : "";
	const local = Boolean(patch.look || patch.tile);
	material.onBeforeCompile = (shader) => {
		let v = shader.vertexShader;
		let f = shader.fragmentShader;
		if (local) {
			const head = ["varying vec3 vTTLocal;", "varying vec3 vTTNormal;", ...(patch.look ? ["attribute float ttMaterial;", "varying float vTTMaterial;"] : []), ...(patch.tile ? ["uniform float ttStudsPerTile;", PLANE_GLSL] : [])];
			v = v.replace("#include <common>", `#include <common>\n${head.join("\n")}`);
			v = v.replace(
				"#include <begin_vertex>",
				[
					"#include <begin_vertex>",
					"#ifdef USE_INSTANCING",
					"vec3 ttScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));",
					"#else",
					"vec3 ttScale = vec3(1.0);",
					"#endif",
					"vTTLocal = position * ttScale;",
					"vTTNormal = normal;",
					...(patch.look ? ["vTTMaterial = ttMaterial;"] : []),
					...(patch.tile ? ["#ifdef USE_MAP", "vMapUv = ttPlane(vTTLocal, normal) / max(ttStudsPerTile, 0.01);", "#endif"] : []),
				].join("\n"),
			);
			if (patch.look) {
				f = f.replace("#include <common>", `#include <common>\nvarying vec3 vTTLocal;\nvarying vec3 vTTNormal;\nvarying float vTTMaterial;\nuniform float ttLookOn;\n${MATERIAL_LOOK_GLSL}`);
				f = f.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, ttLook(vTTMaterial, vTTLocal, vTTNormal), ttLookOn);");
				shader.uniforms.ttLookOn = patch.look;
			}
			if (patch.tile) shader.uniforms.ttStudsPerTile = patch.tile;
		}
		if (patch.surface) {
			v = v.replace("#include <common>", "#include <common>\nattribute vec4 ttUv;\nattribute vec4 ttTint;\nvarying vec4 vTTTint;");
			v = v.replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vec2(uv.x * ttUv.x + ttUv.z, 1.0 - ((1.0 - uv.y) * ttUv.y + ttUv.w));\n#endif\nvTTTint = ttTint;");
			f = f.replace("#include <common>", "#include <common>\nvarying vec4 vTTTint;");
			f = f.replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor *= vTTTint;");
		}
		if (cap) f = f.replace("#include <opaque_fragment>", `${cap}\n#include <opaque_fragment>`);
		shader.vertexShader = v;
		shader.fragmentShader = f;
	};
	const key = [cap, patch.look ? "look" : "", patch.tile ? "tile" : "", patch.surface ? "surface" : ""].join("|");
	material.customProgramCacheKey = () => key;
	return material;
}

export interface PartMaterials {
	/** The color pass of each look. */
	color: Record<Look, THREE.MeshLambertMaterial>;
	/** The depth-only pre-pass of each see-through look. */
	depth: Record<Exclude<Look, "solid">, THREE.MeshBasicMaterial>;
}

/**
 * The parts' materials. Solid: opaque, both sides (the inside is the cap). See-through: the pre-pass writes the nearest
 * depth of the look's parts, then the color pass blends only that surface (depth equal, the look's stencil bit not yet
 * set), once per pixel. Both pulled toward the camera by the same polygon offset, so they match each other and win over
 * a coplanar floor.
 */
export function partMaterials(clippingPlanes: THREE.Plane[], look?: { value: number }): PartMaterials {
	const base = { clippingPlanes, side: THREE.DoubleSide } as const;
	// One pass for both sides (three otherwise draws a transparent double-sided material back, then front); the depth and
	// the stencil already keep only the nearest surface.
	const offset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, forceSinglePass: true } as const;
	const color = { solid: withCap(new THREE.MeshLambertMaterial({ ...base }), 0.45, 0, look ? { look } : {}) } as PartMaterials["color"];
	const depth = {} as PartMaterials["depth"];
	for (const { look, opacity, cap, bit } of SEE_THROUGH) {
		depth[look] = new THREE.MeshBasicMaterial({ ...base, ...offset, colorWrite: false, depthWrite: true, transparent: true });
		color[look] = withCap(
			new THREE.MeshLambertMaterial({
				...base,
				...offset,
				transparent: true,
				opacity,
				depthWrite: false,
				depthFunc: THREE.LessEqualDepth,
				stencilWrite: true,
				stencilRef: bit,
				stencilFuncMask: bit,
				stencilWriteMask: bit,
				stencilFunc: THREE.NotEqualStencilFunc,
				stencilZPass: THREE.ReplaceStencilOp,
			}),
			1,
			cap,
		);
	}
	return { color, depth };
}

/** WebGL-only pixel-store parameters expo-gl doesn't take (three sets them for every upload). */
const WEBGL_ONLY_UNPACK = new Set([0x9241 /* UNPACK_PREMULTIPLY_ALPHA_WEBGL */, 0x9243 /* UNPACK_COLORSPACE_CONVERSION_WEBGL */]);

/** Makes expo-gl's context look enough like a browser's for three.js: a canvas stand-in, context attributes, pixel store. */
function adaptContext(gl: ExpoWebGLRenderingContext): { width: number; height: number; style: Record<string, string>; addEventListener(): void; removeEventListener(): void; setAttribute(): void } {
	const canvas = {
		width: gl.drawingBufferWidth,
		height: gl.drawingBufferHeight,
		clientWidth: gl.drawingBufferWidth,
		clientHeight: gl.drawingBufferHeight,
		style: {} as Record<string, string>,
		addEventListener() {},
		removeEventListener() {},
		setAttribute() {},
		getContext: () => gl,
	};
	const g = gl as unknown as Record<string, unknown>;
	try {
		if (!g.canvas) Object.defineProperty(gl, "canvas", { value: canvas, configurable: true });
	} catch {
		// read-only: three only reads its size, which the viewport calls set anyway
	}
	const attributes = typeof gl.getContextAttributes === "function" ? gl.getContextAttributes() : null;
	if (!attributes) g.getContextAttributes = () => ({ alpha: true, antialias: false, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
	const pixelStorei = gl.pixelStorei.bind(gl);
	g.pixelStorei = (pname: number, param: number | boolean) => {
		if (WEBGL_ONLY_UNPACK.has(pname)) return;
		pixelStorei(pname, param as number);
	};
	return canvas;
}

/** A touch point in view units. */
export interface TouchPoint {
	x: number;
	y: number;
}

export class MapRenderer {
	readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly world = new THREE.Group();
	private readonly parts = new THREE.Group();
	private readonly surfaces = new THREE.Group();
	private readonly marks = new THREE.Group();
	/** The built-in materials' look: 1 on, 0 off (the Textures toggle). */
	private readonly lookOn = { value: 1 };
	/** Loaded images by asset id (kept across rebuilds and maps). */
	private readonly images = new Map<string, THREE.Texture>();
	private readonly loader: ImageLoader;
	private surfaceGroups: SurfaceGroup[] = [];
	/** MaterialVariant materials of the current parts, by variant index (their tiling and image id). */
	private variantMaterials = new Map<number, { material: THREE.MeshLambertMaterial; image: string }>();
	/** Geometries the current parts own (per-bucket copies carrying instance attributes). */
	private ownedGeometries: THREE.BufferGeometry[] = [];
	/** Caller-owned objects (avatars, entity boxes): added and removed by the caller, never disposed here. */
	readonly actors = new THREE.Group();
	private readonly viewCamera = new THREE.PerspectiveCamera(70, 1, 0.1, 20_000);
	private view: ViewCamera | null = null;
	private readonly perspective = new THREE.PerspectiveCamera(50, 1, 0.5, 20_000);
	private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50_000);
	/** What the orbit turns around and the 2D view is centred on. */
	private readonly target = new THREE.Vector3();
	private readonly shapes = shapeGeometries();
	private readonly clip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6)];
	private readonly materials: PartMaterials;
	private readonly outlineMaterial: THREE.LineBasicMaterial;
	private grid: THREE.GridHelper | null = null;
	private geometry: MapGeometry | null = null;
	private bounds: Bounds | null = null;
	private layers: MapLayer[] = [];
	/** What a 3D tap can land on (built with the marks): the layers' dots and the heat cells' meshes. */
	private pickPoints: THREE.Vector3[] = [];
	private pickCells: THREE.InstancedMesh[] = [];
	private readonly raycaster = new THREE.Raycaster();
	private options: SceneOptions = { mode: "3d", offset: [0, 0, 0], band: null, decorative: false, markers: false, textures: true };
	private disposed = false;
	private frame = 0;
	private readonly canvas: ReturnType<typeof adaptContext>;
	/** The view's size in layout units (touch points), and the drawing buffer's in pixels. */
	private viewSize = { width: 1, height: 1 };
	/** Called after each drawn frame (the scene's overlay: the cursor read-out). */
	onFrame: (() => void) | null = null;

	constructor(
		private readonly gl: ExpoWebGLRenderingContext,
		fetchImage: (id: string, signal: AbortSignal) => Promise<ImageFetch>,
	) {
		this.canvas = adaptContext(gl);
		this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl, antialias: false, alpha: true, stencil: true });
		this.renderer.setPixelRatio(1);
		this.renderer.localClippingEnabled = true;
		this.renderer.setClearColor(0x000000, 0);
		this.materials = partMaterials(this.clip, this.lookOn);
		this.loader = new ImageLoader((id, image) => this.onImage(id, image), fetchImage);
		this.outlineMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, clippingPlanes: this.clip });
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
		const sun = new THREE.DirectionalLight(0xffffff, 1.4);
		sun.position.set(0.4, 1, 0.25);
		this.scene.add(sun);
		this.world.add(this.parts, this.surfaces);
		this.scene.add(this.world, this.marks, this.actors);
		this.ortho.up.set(0, 0, -1);
		this.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
	}

	private get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
		if (this.view) return this.viewCamera;
		return this.options.mode === "2d" ? this.ortho : this.perspective;
	}

	/** The current mode (the gestures turn in 3D, pan in 2D). */
	get mode(): MapMode {
		return this.options.mode;
	}

	/** Renders from a fixed camera (null: back to the orbit / map controls). */
	setView(view: ViewCamera | null): void {
		this.view = view;
		if (view) {
			const [x, y, z] = view.position;
			this.viewCamera.position.set(x, y, z);
			this.viewCamera.lookAt(x + view.look[0], y + view.look[1], z + view.look[2]);
			if (this.viewCamera.fov !== view.fov) {
				this.viewCamera.fov = Math.max(1, Math.min(120, view.fov));
				this.viewCamera.updateProjectionMatrix();
			}
		}
		this.render();
	}

	/** The actor under a point of the view (the object in `actors` whose subtree was hit), or null. */
	pickActor(x: number, y: number): THREE.Object3D | null {
		const { width, height } = this.viewSize;
		if (!this.actors.children.length) return null;
		this.raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), this.camera);
		for (const hit of this.raycaster.intersectObjects(this.actors.children, true)) {
			let o: THREE.Object3D | null = hit.object;
			while (o && o.parent !== this.actors) o = o.parent;
			if (o?.visible) return o;
		}
		return null;
	}

	/** The map's parts (null: none), its bounds (the camera fits them), the layers and the view options. */
	update(geometry: MapGeometry | null, bounds: Bounds | null, layers: MapLayer[], options: SceneOptions): void {
		const geometryChanged = geometry !== this.geometry;
		const modeChanged = options.mode !== this.options.mode;
		const offsetChanged = options.offset.some((v, i) => v !== this.options.offset[i]);
		const textures = options.textures !== false;
		const looksChanged = options.decorative !== this.options.decorative || options.markers !== this.options.markers || textures !== (this.options.textures !== false);
		this.geometry = geometry;
		this.bounds = bounds;
		this.layers = layers;
		this.options = { ...options, textures };
		this.lookOn.value = textures ? 1 : 0;
		this.world.position.set(...options.offset);
		if (geometryChanged || looksChanged) {
			this.buildParts();
			this.buildSurfaces();
		}
		this.applyBand();
		this.buildMarks();
		if (geometryChanged || modeChanged || offsetChanged) this.fit();
		this.buildGrid();
		this.render();
	}

	private buildParts(): void {
		for (const child of [...this.parts.children]) {
			this.parts.remove(child);
			if (child instanceof THREE.InstancedMesh) child.dispose();
			else if (child instanceof THREE.LineSegments) child.geometry.dispose();
		}
		for (const geometry of this.ownedGeometries) geometry.dispose();
		this.ownedGeometries = [];
		for (const { material } of this.variantMaterials.values()) material.dispose();
		this.variantMaterials.clear();
		const g = this.geometry;
		if (!g) return;
		const toggles = { decorative: this.options.decorative, markers: this.options.markers };
		const textures = this.options.textures !== false ? g.textures : null;
		const buckets = new Map<string, number[]>();
		const outlined: number[] = [];
		for (let i = 0; i < g.count; i++) {
			const flags = g.flags[i] as number;
			if (!isDrawn(flags, toggles)) continue;
			const t = (g.transparency[i] as number) / 255;
			const kind = partKind(flags);
			const look: Look = kind === "marker" ? "marker" : flags & FLAGS.invisible ? "wall" : t >= 0.5 ? "glassy" : "solid";
			if (flags & (FLAGS.mesh | FLAGS.union)) outlined.push(i);
			// A solid part with a MaterialVariant that has a ColorMap: its own bucket (the variant's tiled image).
			const variant = look === "solid" ? partVariant(textures, i) : -1;
			const key = `${Math.min(g.shape[i] as number, 4)}:${look}:${variant}`;
			let list = buckets.get(key);
			if (!list) buckets.set(key, (list = []));
			list.push(i);
		}
		const m = new THREE.Matrix4();
		const p = new THREE.Vector3();
		const q = new THREE.Quaternion();
		const s = new THREE.Vector3();
		const color = new THREE.Color();
		const matrixOf = (i: number, shape: number) => {
			p.set(g.position[i * 3] as number, g.position[i * 3 + 1] as number, g.position[i * 3 + 2] as number);
			q.set(g.rotation[i * 4] as number, g.rotation[i * 4 + 1] as number, g.rotation[i * 4 + 2] as number, g.rotation[i * 4 + 3] as number);
			if (q.lengthSq() < 1e-6) q.identity();
			else q.normalize();
			s.set(Math.max(0.05, Math.abs(g.size[i * 3] as number)), Math.max(0.05, Math.abs(g.size[i * 3 + 1] as number)), Math.max(0.05, Math.abs(g.size[i * 3 + 2] as number)));
			if (shape === 0) s.setScalar(Math.min(s.x, s.y, s.z));
			return m.compose(p, q, s);
		};
		for (const [key, list] of buckets) {
			const [shape, look, variantKey] = key.split(":") as [string, Look, string];
			const variant = Number(variantKey);
			let geometry = this.shapes[Number(shape)] as THREE.BufferGeometry;
			if (look === "solid") {
				// The material look reads each part's Material from an instance attribute: a copy of the shape per bucket.
				geometry = geometry.clone();
				geometry.setAttribute("ttMaterial", new THREE.InstancedBufferAttribute(Float32Array.from(list, (i) => g.material[i] as number), 1));
				this.ownedGeometries.push(geometry);
			}
			const material = variant >= 0 && textures ? this.variantMaterial(variant, textures.variants[variant] as { image: string | null; studsPerTile: number }) : this.materials.color[look];
			const mesh = new THREE.InstancedMesh(geometry, material, list.length);
			list.forEach((i, k) => {
				mesh.setMatrixAt(k, matrixOf(i, Number(shape)));
				color.setRGB((g.color[i * 3] as number) / 255, (g.color[i * 3 + 1] as number) / 255, (g.color[i * 3 + 2] as number) / 255, THREE.SRGBColorSpace);
				mesh.setColorAt(k, color);
			});
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
			mesh.computeBoundingSphere();
			this.parts.add(mesh);
			if (look === "solid") continue;
			// The look's depth pre-pass, sharing the instances; drawn right before the look's color pass.
			const rank = SEE_THROUGH.findIndex((s) => s.look === look);
			const depth = new THREE.InstancedMesh(mesh.geometry, this.materials.depth[look], list.length);
			depth.instanceMatrix = mesh.instanceMatrix;
			depth.boundingSphere = mesh.boundingSphere;
			depth.renderOrder = PARTS_ORDER + rank * 2;
			mesh.renderOrder = PARTS_ORDER + rank * 2 + 1;
			this.parts.add(depth);
		}
		// Meshes and unions drawn as boxes: a thin outline says "a bounding box, not the real shape".
		if (outlined.length) {
			const positions = new Float32Array(outlined.length * BOX_EDGES.length);
			const v = new THREE.Vector3();
			outlined.forEach((i, k) => {
				const matrix = matrixOf(i, 1);
				for (let e = 0; e < BOX_EDGES.length; e += 3) {
					v.set(BOX_EDGES[e] as number, BOX_EDGES[e + 1] as number, BOX_EDGES[e + 2] as number).applyMatrix4(matrix);
					positions.set([v.x, v.y, v.z], k * BOX_EDGES.length + e);
				}
			});
			const lines = new THREE.BufferGeometry();
			lines.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			const outline = new THREE.LineSegments(lines, this.outlineMaterial);
			outline.renderOrder = 5;
			this.parts.add(outline);
		}
	}

	/** A MaterialVariant's material: the solid look with its ColorMap tiled (plain until the image arrives). */
	private variantMaterial(index: number, variant: { image: string | null; studsPerTile: number }): THREE.MeshLambertMaterial {
		const existing = this.variantMaterials.get(index);
		if (existing) return existing.material;
		const image = variant.image as string;
		const material = withCap(new THREE.MeshLambertMaterial({ clippingPlanes: this.clip, side: THREE.DoubleSide }), 0.45, 0, { tile: { value: variant.studsPerTile > 0.01 ? variant.studsPerTile : 4 } });
		const texture = this.images.get(image);
		if (texture) material.map = texture;
		this.variantMaterials.set(index, { material, image });
		this.loader.want([image]);
		return material;
	}

	/** Decals and Textures: one instanced quad mesh per loaded image; the rest wait for their image. */
	private buildSurfaces(): void {
		for (const child of [...this.surfaces.children]) {
			this.surfaces.remove(child);
			if (child instanceof THREE.InstancedMesh) {
				child.dispose();
				child.geometry.dispose();
				(child.material as THREE.Material).dispose();
			}
		}
		this.surfaceGroups = [];
		const g = this.geometry;
		if (!g?.textures || this.options.textures === false) return;
		this.surfaceGroups = groupSurfaces(g, g.textures, { decorative: this.options.decorative, markers: this.options.markers });
		for (const group of this.surfaceGroups) if (this.images.has(group.image)) this.addSurfaceMesh(group);
		this.loader.want(this.surfaceGroups.map((group) => group.image));
	}

	private addSurfaceMesh(group: SurfaceGroup): void {
		const texture = this.images.get(group.image);
		if (!texture) return;
		const plane = new THREE.PlaneGeometry(1, 1);
		plane.setAttribute("ttUv", new THREE.InstancedBufferAttribute(group.uv, 4));
		plane.setAttribute("ttTint", new THREE.InstancedBufferAttribute(group.tint, 4));
		const material = patchMaterial(new THREE.MeshLambertMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.FrontSide, clippingPlanes: this.clip, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }), { surface: true });
		const mesh = new THREE.InstancedMesh(plane, material, group.count);
		mesh.instanceMatrix.array.set(group.matrices);
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		// After the solids, before the see-through looks (glass in front of a sign tints it).
		mesh.renderOrder = PARTS_ORDER - 100;
		mesh.userData.image = group.image;
		this.surfaces.add(mesh);
	}

	/** An image arrived (a local file): its surfaces get their mesh, its variants their map. */
	private onImage(id: string, image: LocalImage): void {
		if (this.disposed || this.images.has(id)) return;
		// expo-gl uploads straight from the file: texImage2D / texSubImage2D take `{ localUri }` as the pixels.
		const texture = new THREE.DataTexture({ localUri: image.uri }, image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.magFilter = THREE.LinearFilter;
		texture.minFilter = THREE.LinearMipmapLinearFilter;
		texture.generateMipmaps = true;
		texture.flipY = true;
		texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
		texture.needsUpdate = true;
		this.images.set(id, texture);
		for (const v of this.variantMaterials.values()) {
			if (v.image !== id) continue;
			v.material.map = texture;
			v.material.needsUpdate = true;
		}
		for (const group of this.surfaceGroups) if (group.image === id && !this.surfaces.children.some((c) => c.userData.image === id)) this.addSurfaceMesh(group);
		this.render();
	}

	private applyBand(): void {
		const band = this.options.band;
		const [top, bottom] = this.clip as [THREE.Plane, THREE.Plane];
		top.constant = band ? band[1] : 1e6;
		bottom.constant = band ? -band[0] : 1e6;
	}

	private inBand(y: number | null | undefined): boolean {
		const band = this.options.band;
		return !band || y === null || y === undefined || (y >= band[0] - 3 && y <= band[1] + 3);
	}

	private buildMarks(): void {
		for (const child of [...this.marks.children]) {
			this.marks.remove(child);
			const o = child as THREE.Mesh;
			o.geometry?.dispose();
			(o.material as THREE.Material)?.dispose();
		}
		this.pickPoints = [];
		this.pickCells = [];
		const flat = this.options.mode === "2d";
		const floorY = this.options.band ? this.options.band[0] : this.bounds ? this.bounds.min[1] + this.options.offset[1] : 0;
		// 3D: before the see-through parts (a wall tints what's behind it, and hides nothing). 2D: after them, on top.
		let order = flat ? PARTS_ORDER * 2 : 10;
		for (const layer of this.layers) {
			const color = new THREE.Color(layer.color);
			const cells = (layer.cells ?? []).filter((c) => this.inBand(c.y));
			if (cells.length) {
				const size = layer.cellSize ?? 1;
				const plane = new THREE.PlaneGeometry(1, 1);
				plane.rotateX(-Math.PI / 2);
				const mesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthTest: !flat, depthWrite: false, side: THREE.DoubleSide }), cells.length);
				const max = Math.max(...cells.map((c) => c.n));
				const m = new THREE.Matrix4();
				const heat = new THREE.Color();
				cells.forEach((c, k) => {
					const y = (c.y ?? floorY + 3) - 2.8;
					m.makeScale(size, 1, size).setPosition(c.x + size / 2, y, c.z + size / 2);
					mesh.setMatrixAt(k, m);
					const [r, g, b] = heatColor(Math.log1p(c.n) / Math.log1p(max));
					mesh.setColorAt(k, heat.setRGB(r, g, b));
				});
				mesh.renderOrder = order++;
				mesh.instanceMatrix.needsUpdate = true;
				mesh.computeBoundingSphere();
				this.marks.add(mesh);
				this.pickCells.push(mesh);
			}
			for (const polygon of layer.polygons ?? []) {
				if (polygon.length < 3 || !polygon.every((p) => this.inBand(p.y))) continue;
				const vertices: number[] = [];
				for (let k = 1; k < polygon.length - 1; k++) for (const p of [polygon[0], polygon[k], polygon[k + 1]] as MapPoint[]) vertices.push(p.x, p.y, p.z);
				const g = new THREE.BufferGeometry();
				g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
				const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthTest: !flat, depthWrite: false, side: THREE.DoubleSide }));
				fill.renderOrder = order++;
				this.marks.add(fill);
			}
			const points = (layer.points ?? []).filter((p) => this.inBand(p.y));
			if (points.length && !cells.length) {
				const g = new THREE.BufferGeometry();
				g.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
				const dots = new THREE.Points(g, new THREE.PointsMaterial({ color, size: layer.pointSize ?? 7, sizeAttenuation: false, depthTest: !flat, transparent: flat }));
				dots.renderOrder = order++;
				this.marks.add(dots);
				for (const p of points) this.pickPoints.push(new THREE.Vector3(p.x, p.y, p.z));
			}
			for (const path of layer.paths ?? []) {
				const kept = path.filter((p) => this.inBand(p.y));
				if (kept.length < 2) continue;
				const g = new THREE.BufferGeometry().setFromPoints(kept.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
				const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: !flat, transparent: flat }));
				line.renderOrder = order++;
				this.marks.add(line);
			}
		}
	}

	private buildGrid(): void {
		if (this.grid) {
			this.scene.remove(this.grid);
			this.grid.dispose();
			this.grid = null;
		}
		const b = this.bounds;
		if (!b) return;
		const o = this.options.offset;
		const span = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], 16);
		const step = span > 1500 ? 64 : span > 400 ? 16 : 8;
		const size = Math.ceil((span * 1.2) / step) * step;
		this.grid = new THREE.GridHelper(size, size / step, 0x888888, 0x888888);
		const material = this.grid.material as THREE.Material;
		material.transparent = true;
		material.opacity = 0.18;
		material.depthWrite = false;
		const y = this.options.band ? this.options.band[0] : b.min[1] + o[1];
		this.grid.position.set((b.min[0] + b.max[0]) / 2 + o[0], y - 0.05, (b.min[2] + b.max[2]) / 2 + o[2]);
		this.scene.add(this.grid);
	}

	/** Points the camera at the whole map. */
	fit(): void {
		const b = this.bounds;
		const o = this.options.offset;
		const center = b ? new THREE.Vector3((b.min[0] + b.max[0]) / 2 + o[0], (b.min[1] + b.max[1]) / 2 + o[1], (b.min[2] + b.max[2]) / 2 + o[2]) : new THREE.Vector3();
		const spanX = b ? b.max[0] - b.min[0] : 100;
		const spanZ = b ? b.max[2] - b.min[2] : 100;
		const radius = Math.max(spanX, spanZ, 20) / 2;
		const topY = (b ? b.max[1] + o[1] : 100) + 1000;
		if (this.options.mode === "2d") {
			this.ortho.position.set(center.x, topY, center.z);
			this.ortho.lookAt(center.x, center.y, center.z);
			const { width, height } = this.viewSize;
			const aspect = width / height;
			const halfH = Math.max(spanZ / 2, spanX / 2 / aspect) * 1.08;
			this.ortho.left = -halfH * aspect;
			this.ortho.right = halfH * aspect;
			this.ortho.top = halfH;
			this.ortho.bottom = -halfH;
			this.ortho.zoom = 1;
			this.ortho.far = topY - (b ? b.min[1] + o[1] : -100) + 2000;
			this.ortho.updateProjectionMatrix();
		} else {
			this.perspective.position.set(center.x + radius * 0.9, center.y + radius * 1.1, center.z + radius * 1.3);
			this.perspective.far = Math.max(20_000, radius * 20);
			this.perspective.updateProjectionMatrix();
		}
		this.target.copy(center);
		this.perspective.lookAt(this.target);
		this.render();
	}

	/** The view was laid out (layout units) or its drawing buffer changed size (pixels). */
	setViewSize(width: number, height: number): void {
		this.viewSize = { width: Math.max(1, width), height: Math.max(1, height) };
		this.resize(this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
	}

	private resize(pixelWidth: number, pixelHeight: number): void {
		const width = Math.max(1, pixelWidth);
		const height = Math.max(1, pixelHeight);
		this.canvas.width = width;
		this.canvas.height = height;
		this.renderer.setSize(width, height, false);
		const aspect = this.viewSize.width / this.viewSize.height;
		this.perspective.aspect = aspect;
		this.perspective.updateProjectionMatrix();
		this.viewCamera.aspect = aspect;
		this.viewCamera.updateProjectionMatrix();
		const halfH = (this.ortho.top - this.ortho.bottom) / 2;
		this.ortho.left = -halfH * aspect;
		this.ortho.right = halfH * aspect;
		this.ortho.updateProjectionMatrix();
		this.render();
	}

	render(): void {
		if (this.disposed || this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			if (this.disposed) return;
			// The surface follows the view's size a moment after its layout: keep the viewport on the real buffer.
			if (this.gl.drawingBufferWidth !== this.canvas.width || this.gl.drawingBufferHeight !== this.canvas.height) {
				this.canvas.width = Math.max(1, this.gl.drawingBufferWidth);
				this.canvas.height = Math.max(1, this.gl.drawingBufferHeight);
				this.renderer.setSize(this.canvas.width, this.canvas.height, false);
			}
			this.renderer.render(this.scene, this.camera);
			this.gl.endFrameEXP();
			this.onFrame?.();
		});
	}

	// Gestures ------------------------------------------------------------------------------------------------------------

	/** One finger moved by (dx, dy) view units: 3D turns around the target, 2D pans. */
	drag(dx: number, dy: number): void {
		if (this.view) return;
		if (this.options.mode === "2d") return this.pan(dx, dy);
		const offset = new THREE.Vector3().subVectors(this.perspective.position, this.target);
		const radius = offset.length();
		let theta = Math.atan2(offset.x, offset.z);
		let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / Math.max(radius, 1e-6))));
		const { height } = this.viewSize;
		theta -= ((2 * Math.PI * dx) / height) * 0.8;
		phi -= ((2 * Math.PI * dy) / height) * 0.8;
		phi = Math.max(0.02, Math.min(Math.PI - 0.02, phi));
		offset.set(radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta));
		this.perspective.position.copy(this.target).add(offset);
		this.perspective.lookAt(this.target);
		this.render();
	}

	/** Two fingers moved by (dx, dy) view units: the view slides with them (both modes). */
	pan(dx: number, dy: number): void {
		if (this.view) return;
		const { width, height } = this.viewSize;
		const move = new THREE.Vector3();
		if (this.options.mode === "2d") {
			const perX = (this.ortho.right - this.ortho.left) / this.ortho.zoom / width;
			const perY = (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / height;
			// north (-Z) is up: a drag to the right moves the world right, i.e. the camera left
			move.set(-dx * perX, 0, -dy * perY);
			this.ortho.position.add(move);
			this.target.add(move);
		} else {
			const distance = this.perspective.position.distanceTo(this.target);
			const perPx = (2 * distance * Math.tan((this.perspective.fov * Math.PI) / 360)) / height;
			this.perspective.updateMatrixWorld();
			const e = this.perspective.matrixWorld.elements;
			const right = new THREE.Vector3(e[0] as number, e[1] as number, e[2] as number);
			const up = new THREE.Vector3(e[4] as number, e[5] as number, e[6] as number);
			move.addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx);
			this.perspective.position.add(move);
			this.target.add(move);
		}
		this.render();
	}

	/** A pinch by `factor` (> 1: fingers apart, closer in) around a point of the view (2D keeps that point under the fingers). */
	zoom(factor: number, at: TouchPoint): void {
		if (this.view || !Number.isFinite(factor) || factor <= 0) return;
		if (this.options.mode === "2d") {
			const before = this.worldAt(at.x, at.y);
			this.ortho.zoom = Math.max(0.02, Math.min(400, this.ortho.zoom * factor));
			this.ortho.updateProjectionMatrix();
			const after = this.worldAt(at.x, at.y);
			if (before && after) {
				this.ortho.position.x += before.x - after.x;
				this.ortho.position.z += before.z - after.z;
				this.target.x += before.x - after.x;
				this.target.z += before.z - after.z;
			}
		} else {
			const offset = new THREE.Vector3().subVectors(this.perspective.position, this.target);
			const distance = Math.max(2, Math.min(this.perspective.far * 0.5, offset.length() / factor));
			offset.normalize().multiplyScalar(distance);
			this.perspective.position.copy(this.target).add(offset);
		}
		this.render();
	}

	/** Moves the view to centre a world point (following a player); the 3D camera keeps its angle and distance. */
	focus(x: number, y: number, z: number): void {
		if (this.view || !Number.isFinite(x) || !Number.isFinite(z)) return;
		const move = new THREE.Vector3(x - this.target.x, (Number.isFinite(y) ? y : this.target.y) - this.target.y, z - this.target.z);
		if (move.lengthSq() < 1e-6) return;
		this.target.add(move);
		this.perspective.position.add(move);
		this.ortho.position.x += move.x;
		this.ortho.position.z += move.z;
		this.render();
	}

	/**
	 * What a click or hover at a point of the canvas lands on, as world x / z. 2D: the point itself (worldAt). 3D (the map's floor
	 * is not a plane to unproject onto): the layers' dot nearest on screen within `radius` px, else the heat cell under the pointer
	 * (a ray), else null.
	 */
	pickAt(px: number, py: number, radius = 24): { x: number; z: number } | null {
		if (this.options.mode === "2d") return this.worldAt(px, py);
		const rect = this.viewSize;
		let best: THREE.Vector3 | null = null;
		let bestD = radius * radius;
		const v = new THREE.Vector3();
		for (const p of this.pickPoints) {
			v.copy(p).project(this.perspective);
			if (v.z < -1 || v.z > 1) continue; // behind the camera or past its far plane
			const dx = ((v.x + 1) / 2) * rect.width - px;
			const dy = ((1 - v.y) / 2) * rect.height - py;
			const d = dx * dx + dy * dy;
			if (d <= bestD) {
				bestD = d;
				best = p;
			}
		}
		if (best) return { x: best.x, z: best.z };
		if (!this.pickCells.length) return null;
		this.raycaster.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.perspective);
		const hit = this.raycaster.intersectObjects(this.pickCells, false)[0];
		return hit ? { x: hit.point.x, z: hit.point.z } : null;
	}

	/** World x / z under a point of the view (2D only; null in 3D). */
	worldAt(x: number, y: number): { x: number; z: number } | null {
		if (this.options.mode !== "2d") return null;
		const { width, height } = this.viewSize;
		this.ortho.updateMatrixWorld();
		const v = new THREE.Vector3((x / width) * 2 - 1, -(y / height) * 2 + 1, 0).unproject(this.ortho);
		return { x: v.x, z: v.z };
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.geometry = null;
		this.layers = [];
		this.loader.dispose();
		this.actors.clear();
		this.buildParts();
		this.buildSurfaces();
		this.buildMarks();
		for (const texture of this.images.values()) texture.dispose();
		this.images.clear();
		for (const s of this.shapes) s.dispose();
		for (const m of [...Object.values(this.materials.color), ...Object.values(this.materials.depth)]) m.dispose();
		this.outlineMaterial.dispose();
		this.grid?.dispose();
		this.renderer.dispose();
	}
}
