/**
 * Types for the part of three.js (0.187) the app uses. The npm package ships no types and @types/three is not a
 * dependency (no packages beyond the approved ones), so this file declares what src/features/maps (the map renderer)
 * and the recordings' player scene need. Add to it when using more of three; keep the names and signatures three's own.
 */
declare module "three" {
	export const REVISION: string;

	// Constants ----------------------------------------------------------------------------------------------------------
	export type Side = 0 | 1 | 2;
	export const FrontSide: 0;
	export const BackSide: 1;
	export const DoubleSide: 2;
	export const NeverDepth: 0;
	export const AlwaysDepth: 1;
	export const LessDepth: 2;
	export const LessEqualDepth: 3;
	export const EqualDepth: 4;
	export const GreaterEqualDepth: 5;
	export const GreaterDepth: 6;
	export const NotEqualDepth: 7;
	export const NeverStencilFunc: 512;
	export const LessStencilFunc: 513;
	export const EqualStencilFunc: 514;
	export const LessEqualStencilFunc: 515;
	export const GreaterStencilFunc: 516;
	export const NotEqualStencilFunc: 517;
	export const GreaterEqualStencilFunc: 518;
	export const AlwaysStencilFunc: 519;
	export const ZeroStencilOp: 0;
	export const KeepStencilOp: 7680;
	export const ReplaceStencilOp: 7681;
	export const SRGBColorSpace: "srgb";
	export const LinearSRGBColorSpace: "srgb-linear";
	export const NoColorSpace: "";
	export const RepeatWrapping: 1000;
	export const ClampToEdgeWrapping: 1001;
	export const NearestFilter: 1003;
	export const LinearFilter: 1006;
	export const LinearMipmapLinearFilter: 1008;
	export const UnsignedByteType: 1009;
	export const FloatType: 1015;
	export const RGBAFormat: 1023;
	export const RGBFormat: 1022;
	export const NormalBlending: 1;
	export const AdditiveBlending: 2;

	// Math ---------------------------------------------------------------------------------------------------------------
	export class Vector2 {
		constructor(x?: number, y?: number);
		x: number;
		y: number;
		set(x: number, y: number): this;
		copy(v: Vector2): this;
		clone(): Vector2;
		length(): number;
	}

	export class Vector3 {
		constructor(x?: number, y?: number, z?: number);
		x: number;
		y: number;
		z: number;
		readonly isVector3: true;
		set(x: number, y: number, z: number): this;
		setScalar(s: number): this;
		copy(v: Vector3): this;
		clone(): Vector3;
		add(v: Vector3): this;
		addScaledVector(v: Vector3, s: number): this;
		sub(v: Vector3): this;
		subVectors(a: Vector3, b: Vector3): this;
		addVectors(a: Vector3, b: Vector3): this;
		multiplyScalar(s: number): this;
		divideScalar(s: number): this;
		normalize(): this;
		length(): number;
		lengthSq(): number;
		distanceTo(v: Vector3): number;
		dot(v: Vector3): number;
		cross(v: Vector3): this;
		crossVectors(a: Vector3, b: Vector3): this;
		applyMatrix4(m: Matrix4): this;
		applyQuaternion(q: Quaternion): this;
		project(camera: Camera): this;
		unproject(camera: Camera): this;
		lerp(v: Vector3, alpha: number): this;
		lerpVectors(a: Vector3, b: Vector3, alpha: number): this;
		setFromMatrixPosition(m: Matrix4): this;
		setFromSpherical(s: Spherical): this;
		toArray(): [number, number, number];
		fromArray(array: ArrayLike<number>, offset?: number): this;
	}

	export class Vector4 {
		constructor(x?: number, y?: number, z?: number, w?: number);
		x: number;
		y: number;
		z: number;
		w: number;
		set(x: number, y: number, z: number, w: number): this;
	}

	export class Spherical {
		constructor(radius?: number, phi?: number, theta?: number);
		radius: number;
		phi: number;
		theta: number;
		set(radius: number, phi: number, theta: number): this;
		setFromVector3(v: Vector3): this;
		makeSafe(): this;
	}

	export class Quaternion {
		constructor(x?: number, y?: number, z?: number, w?: number);
		x: number;
		y: number;
		z: number;
		w: number;
		set(x: number, y: number, z: number, w: number): this;
		identity(): this;
		copy(q: Quaternion): this;
		clone(): Quaternion;
		normalize(): this;
		lengthSq(): number;
		multiply(q: Quaternion): this;
		premultiply(q: Quaternion): this;
		multiplyQuaternions(a: Quaternion, b: Quaternion): this;
		slerp(q: Quaternion, t: number): this;
		slerpQuaternions(a: Quaternion, b: Quaternion, t: number): this;
		setFromAxisAngle(axis: Vector3, angle: number): this;
		setFromEuler(euler: Euler): this;
		setFromRotationMatrix(m: Matrix4): this;
		invert(): this;
	}

	export class Euler {
		constructor(x?: number, y?: number, z?: number, order?: string);
		x: number;
		y: number;
		z: number;
		order: string;
		set(x: number, y: number, z: number, order?: string): this;
	}

	export class Matrix3 {
		elements: number[];
	}

	export class Matrix4 {
		constructor();
		elements: number[];
		set(...values: number[]): this;
		identity(): this;
		copy(m: Matrix4): this;
		clone(): Matrix4;
		compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
		decompose(position: Vector3, quaternion: Quaternion, scale: Vector3): this;
		makeScale(x: number, y: number, z: number): this;
		makeTranslation(x: number, y: number, z: number): this;
		makeRotationFromQuaternion(q: Quaternion): this;
		setPosition(x: number, y: number, z: number): this;
		multiply(m: Matrix4): this;
		premultiply(m: Matrix4): this;
		multiplyMatrices(a: Matrix4, b: Matrix4): this;
		invert(): this;
		fromArray(array: ArrayLike<number>, offset?: number): this;
		lookAt(eye: Vector3, target: Vector3, up: Vector3): this;
	}

	export class Color {
		constructor(color?: string | number | Color);
		constructor(r: number, g: number, b: number);
		r: number;
		g: number;
		b: number;
		set(color: string | number | Color): this;
		setRGB(r: number, g: number, b: number, colorSpace?: string): this;
		setHex(hex: number, colorSpace?: string): this;
		setStyle(style: string, colorSpace?: string): this;
		getHex(): number;
		copy(c: Color): this;
		clone(): Color;
		multiplyScalar(s: number): this;
		lerp(c: Color, alpha: number): this;
	}

	export class Plane {
		constructor(normal?: Vector3, constant?: number);
		normal: Vector3;
		constant: number;
		set(normal: Vector3, constant: number): this;
	}

	export class Box3 {
		constructor(min?: Vector3, max?: Vector3);
		min: Vector3;
		max: Vector3;
	}

	export class Sphere {
		constructor(center?: Vector3, radius?: number);
		center: Vector3;
		radius: number;
	}

	export class Ray {
		origin: Vector3;
		direction: Vector3;
		intersectPlane(plane: Plane, target: Vector3): Vector3 | null;
	}

	export const MathUtils: {
		clamp(value: number, min: number, max: number): number;
		degToRad(degrees: number): number;
		radToDeg(radians: number): number;
		lerp(x: number, y: number, t: number): number;
	};

	// Core ---------------------------------------------------------------------------------------------------------------
	export class EventDispatcher {
		addEventListener(type: string, listener: (event: { type: string }) => void): void;
		removeEventListener(type: string, listener: (event: { type: string }) => void): void;
		dispatchEvent(event: { type: string }): void;
	}

	export class Layers {
		set(channel: number): void;
		enable(channel: number): void;
	}

	export class Object3D extends EventDispatcher {
		constructor();
		id: number;
		name: string;
		type: string;
		parent: Object3D | null;
		children: Object3D[];
		up: Vector3;
		position: Vector3;
		rotation: Euler;
		quaternion: Quaternion;
		scale: Vector3;
		matrix: Matrix4;
		matrixWorld: Matrix4;
		matrixAutoUpdate: boolean;
		visible: boolean;
		renderOrder: number;
		frustumCulled: boolean;
		userData: Record<string, unknown>;
		layers: Layers;
		add(...objects: Object3D[]): this;
		remove(...objects: Object3D[]): this;
		clear(): this;
		lookAt(x: number | Vector3, y?: number, z?: number): void;
		updateMatrix(): void;
		updateMatrixWorld(force?: boolean): void;
		traverse(callback: (object: Object3D) => void): void;
		getWorldPosition(target: Vector3): Vector3;
		getWorldDirection(target: Vector3): Vector3;
		getObjectByName(name: string): Object3D | undefined;
	}

	export class BufferAttribute {
		constructor(array: ArrayLike<number> & { length: number }, itemSize: number, normalized?: boolean);
		array: Float32Array;
		itemSize: number;
		count: number;
		needsUpdate: boolean;
		setUsage(usage: number): this;
		setXYZ(index: number, x: number, y: number, z: number): this;
		getX(index: number): number;
		getY(index: number): number;
		getZ(index: number): number;
	}
	export class Float32BufferAttribute extends BufferAttribute {
		constructor(array: ArrayLike<number> | number, itemSize: number, normalized?: boolean);
	}
	export class Uint16BufferAttribute extends BufferAttribute {
		constructor(array: ArrayLike<number> | number, itemSize: number, normalized?: boolean);
	}
	export class Uint32BufferAttribute extends BufferAttribute {
		constructor(array: ArrayLike<number> | number, itemSize: number, normalized?: boolean);
	}
	export class InstancedBufferAttribute extends BufferAttribute {
		constructor(array: ArrayLike<number> & { length: number }, itemSize: number, normalized?: boolean, meshPerAttribute?: number);
	}

	export class BufferGeometry extends EventDispatcher {
		constructor();
		attributes: Record<string, BufferAttribute>;
		index: BufferAttribute | null;
		boundingSphere: Sphere | null;
		boundingBox: Box3 | null;
		setAttribute(name: string, attribute: BufferAttribute): this;
		getAttribute(name: string): BufferAttribute;
		deleteAttribute(name: string): this;
		setIndex(index: BufferAttribute | number[] | null): this;
		setFromPoints(points: Vector3[] | Vector2[]): this;
		computeVertexNormals(): void;
		computeBoundingSphere(): void;
		computeBoundingBox(): void;
		clone(): this;
		dispose(): void;
		rotateX(angle: number): this;
		rotateY(angle: number): this;
		rotateZ(angle: number): this;
		translate(x: number, y: number, z: number): this;
		scale(x: number, y: number, z: number): this;
		applyMatrix4(m: Matrix4): this;
		setDrawRange(start: number, count: number): void;
	}

	export class BoxGeometry extends BufferGeometry {
		constructor(width?: number, height?: number, depth?: number, widthSegments?: number, heightSegments?: number, depthSegments?: number);
	}
	export class SphereGeometry extends BufferGeometry {
		constructor(radius?: number, widthSegments?: number, heightSegments?: number);
	}
	export class CylinderGeometry extends BufferGeometry {
		constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean);
	}
	export class PlaneGeometry extends BufferGeometry {
		constructor(width?: number, height?: number, widthSegments?: number, heightSegments?: number);
	}
	export class CircleGeometry extends BufferGeometry {
		constructor(radius?: number, segments?: number);
	}
	export class RingGeometry extends BufferGeometry {
		constructor(innerRadius?: number, outerRadius?: number, thetaSegments?: number);
	}
	export class ConeGeometry extends BufferGeometry {
		constructor(radius?: number, height?: number, radialSegments?: number);
	}
	export class EdgesGeometry extends BufferGeometry {
		constructor(geometry: BufferGeometry, thresholdAngle?: number);
	}

	// Materials ----------------------------------------------------------------------------------------------------------
	export interface Shader {
		uniforms: Record<string, { value: unknown }>;
		vertexShader: string;
		fragmentShader: string;
	}

	export interface MaterialParameters {
		[key: string]: unknown;
		color?: string | number | Color;
		opacity?: number;
		transparent?: boolean;
		side?: Side;
		depthTest?: boolean;
		depthWrite?: boolean;
		depthFunc?: number;
		colorWrite?: boolean;
		clippingPlanes?: Plane[] | null;
		polygonOffset?: boolean;
		polygonOffsetFactor?: number;
		polygonOffsetUnits?: number;
		forceSinglePass?: boolean;
		stencilWrite?: boolean;
		stencilRef?: number;
		stencilFuncMask?: number;
		stencilWriteMask?: number;
		stencilFunc?: number;
		stencilZPass?: number;
		map?: Texture | null;
		vertexColors?: boolean;
		size?: number;
		sizeAttenuation?: boolean;
		linewidth?: number;
		wireframe?: boolean;
		toneMapped?: boolean;
		fog?: boolean;
	}

	export class Material extends EventDispatcher {
		constructor();
		name: string;
		opacity: number;
		transparent: boolean;
		side: Side;
		depthTest: boolean;
		depthWrite: boolean;
		depthFunc: number;
		colorWrite: boolean;
		clippingPlanes: Plane[] | null;
		polygonOffset: boolean;
		polygonOffsetFactor: number;
		polygonOffsetUnits: number;
		visible: boolean;
		needsUpdate: boolean;
		userData: Record<string, unknown>;
		onBeforeCompile: (shader: Shader, renderer: WebGLRenderer) => void;
		customProgramCacheKey: () => string;
		setValues(values: MaterialParameters): void;
		clone(): this;
		dispose(): void;
	}

	export class MeshBasicMaterial extends Material {
		constructor(parameters?: MaterialParameters);
		color: Color;
		map: Texture | null;
	}
	export class MeshLambertMaterial extends Material {
		constructor(parameters?: MaterialParameters);
		color: Color;
		map: Texture | null;
		emissive: Color;
	}
	export class MeshStandardMaterial extends Material {
		constructor(parameters?: MaterialParameters);
		color: Color;
		map: Texture | null;
		roughness: number;
		metalness: number;
	}
	export class LineBasicMaterial extends Material {
		constructor(parameters?: MaterialParameters);
		color: Color;
	}
	export class PointsMaterial extends Material {
		constructor(parameters?: MaterialParameters);
		color: Color;
		size: number;
		sizeAttenuation: boolean;
	}
	export class ShaderMaterial extends Material {
		constructor(parameters?: MaterialParameters & { uniforms?: Record<string, { value: unknown }>; vertexShader?: string; fragmentShader?: string });
		uniforms: Record<string, { value: unknown }>;
	}

	// Textures -----------------------------------------------------------------------------------------------------------
	export class Texture extends EventDispatcher {
		constructor(image?: unknown);
		image: unknown;
		colorSpace: string;
		wrapS: number;
		wrapT: number;
		magFilter: number;
		minFilter: number;
		anisotropy: number;
		flipY: boolean;
		generateMipmaps: boolean;
		premultiplyAlpha: boolean;
		format: number;
		type: number;
		repeat: Vector2;
		offset: Vector2;
		needsUpdate: boolean;
		userData: Record<string, unknown>;
		dispose(): void;
	}
	export class DataTexture extends Texture {
		constructor(data?: unknown, width?: number, height?: number, format?: number, type?: number);
	}

	// Objects ------------------------------------------------------------------------------------------------------------
	export class Mesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material | Material[]> extends Object3D {
		constructor(geometry?: G, material?: M);
		geometry: G;
		material: M;
	}
	export class InstancedMesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material | Material[]> extends Mesh<G, M> {
		constructor(geometry: G, material: M, count: number);
		count: number;
		instanceMatrix: InstancedBufferAttribute;
		instanceColor: InstancedBufferAttribute | null;
		boundingSphere: Sphere | null;
		setMatrixAt(index: number, matrix: Matrix4): void;
		getMatrixAt(index: number, matrix: Matrix4): void;
		setColorAt(index: number, color: Color): void;
		computeBoundingSphere(): void;
		dispose(): this;
	}
	export class Line<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Object3D {
		constructor(geometry?: G, material?: M);
		geometry: G;
		material: M;
	}
	export class LineSegments<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Line<G, M> {}
	export class LineLoop<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Line<G, M> {}
	export class Points<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Object3D {
		constructor(geometry?: G, material?: M);
		geometry: G;
		material: M;
	}
	export class Group extends Object3D {}
	export class Scene extends Object3D {
		background: Color | Texture | null;
	}
	export class Bone extends Object3D {}

	export class GridHelper extends LineSegments {
		constructor(size?: number, divisions?: number, color1?: number | string, color2?: number | string);
		dispose(): void;
	}
	export class AxesHelper extends LineSegments {
		constructor(size?: number);
		dispose(): void;
	}

	// Lights -------------------------------------------------------------------------------------------------------------
	export class Light extends Object3D {
		color: Color;
		intensity: number;
	}
	export class AmbientLight extends Light {
		constructor(color?: number | string, intensity?: number);
	}
	export class HemisphereLight extends Light {
		constructor(skyColor?: number | string, groundColor?: number | string, intensity?: number);
	}
	export class DirectionalLight extends Light {
		constructor(color?: number | string, intensity?: number);
		target: Object3D;
	}

	// Cameras ------------------------------------------------------------------------------------------------------------
	export class Camera extends Object3D {
		projectionMatrix: Matrix4;
		projectionMatrixInverse: Matrix4;
		matrixWorldInverse: Matrix4;
	}
	export class PerspectiveCamera extends Camera {
		constructor(fov?: number, aspect?: number, near?: number, far?: number);
		fov: number;
		aspect: number;
		near: number;
		far: number;
		zoom: number;
		updateProjectionMatrix(): void;
	}
	export class OrthographicCamera extends Camera {
		constructor(left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number);
		left: number;
		right: number;
		top: number;
		bottom: number;
		near: number;
		far: number;
		zoom: number;
		updateProjectionMatrix(): void;
	}

	// Picking ------------------------------------------------------------------------------------------------------------
	export interface Intersection {
		distance: number;
		point: Vector3;
		object: Object3D;
		instanceId?: number;
		faceIndex?: number;
	}
	export class Raycaster {
		constructor(origin?: Vector3, direction?: Vector3, near?: number, far?: number);
		ray: Ray;
		params: { Points: { threshold: number }; Line: { threshold: number } };
		setFromCamera(coords: Vector2, camera: Camera): void;
		intersectObject(object: Object3D, recursive?: boolean): Intersection[];
		intersectObjects(objects: Object3D[], recursive?: boolean): Intersection[];
	}

	// Renderer -----------------------------------------------------------------------------------------------------------
	export interface WebGLRendererParameters {
		canvas?: unknown;
		context?: unknown;
		antialias?: boolean;
		alpha?: boolean;
		stencil?: boolean;
		depth?: boolean;
		premultipliedAlpha?: boolean;
		preserveDrawingBuffer?: boolean;
		powerPreference?: string;
	}
	export class WebGLRenderer {
		constructor(parameters?: WebGLRendererParameters);
		domElement: unknown;
		localClippingEnabled: boolean;
		autoClear: boolean;
		capabilities: { getMaxAnisotropy(): number; maxTextureSize: number };
		info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number } };
		setPixelRatio(ratio: number): void;
		setSize(width: number, height: number, updateStyle?: boolean): void;
		setViewport(x: number, y: number, width: number, height: number): void;
		setClearColor(color: string | number | Color, alpha?: number): void;
		clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
		render(scene: Object3D, camera: Camera): void;
		getContext(): WebGL2RenderingContext;
		resetState(): void;
		dispose(): void;
	}
}
