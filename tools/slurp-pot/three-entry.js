// Slurp Pot three.js entry (Render role). Named re-exports only; bundled by tools/slurp-pot/build-three.mjs
// into games/slurp-pot/vendor/three.bundle.js (GDD §11.5, §13.3). Imports the npm package `three` (never a
// vendored copy) so the addons' bare 'three' specifier resolves through the bundler.
// Add a class here only when a game module needs it; rebuild with `node tools/slurp-pot/build-three.mjs`.
export {
  // core
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, Group, Object3D, Mesh, InstancedMesh,
  BufferGeometry, BufferAttribute, InstancedBufferAttribute, Float32BufferAttribute, Uint16BufferAttribute,
  Uint32BufferAttribute, InterleavedBufferAttribute,
  // materials
  MeshLambertMaterial, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial,
  // textures
  Texture, CanvasTexture, DataTexture,
  // math
  Color, Vector2, Vector3, Vector4, Matrix3, Matrix4, Quaternion, Euler, Box3, Sphere, MathUtils,
  // lights + fog
  HemisphereLight, DirectionalLight, AmbientLight, Fog,
  // geometries (props.js builders)
  CylinderGeometry, TorusGeometry, PlaneGeometry, CircleGeometry, SphereGeometry, BoxGeometry, ConeGeometry,
  LatheGeometry, ExtrudeGeometry, ShapeGeometry, RingGeometry, IcosahedronGeometry, OctahedronGeometry,
  DodecahedronGeometry, CapsuleGeometry, TubeGeometry,
  // paths / shapes
  Shape, Path, CatmullRomCurve3, QuadraticBezierCurve3, CubicBezierCurve3, LineCurve3,
  // constants
  SRGBColorSpace, LinearSRGBColorSpace, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping,
  LinearFilter, LinearMipmapLinearFilter, NearestFilter, RGBAFormat, UnsignedByteType, FloatType,
  FrontSide, BackSide, DoubleSide, NormalBlending, AdditiveBlending, NoBlending, CustomBlending,
  DynamicDrawUsage, StaticDrawUsage, StreamDrawUsage,
  AlwaysStencilFunc, EqualStencilFunc, NotEqualStencilFunc, KeepStencilOp, ReplaceStencilOp, ZeroStencilOp,
  NoToneMapping, ACESFilmicToneMapping,
} from 'three';
export { mergeGeometries, mergeVertices, toTrianglesDrawMode } from 'three/addons/utils/BufferGeometryUtils.js';
