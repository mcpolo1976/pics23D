/**
 * 生成最小合法 GLB（单位立方体）用于 MockProvider 测试。
 * 运行：node scripts/gen-test-glb.mjs
 */
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'test')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'cube.glb')

// 8 顶点立方体
const positions = new Float32Array([
  -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, // v0..v3 前面 z+
  -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1 // v4..v7 后面 z-
])
// 法线 = 顶点方向归一化
const normals = new Float32Array(24)
for (let i = 0; i < 8; i++) {
  const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
  const len = Math.hypot(x, y, z) || 1
  normals[i * 3] = x / len
  normals[i * 3 + 1] = y / len
  normals[i * 3 + 2] = z / len
}
// 12 个三角形（每面 2 个）
const indices = new Uint16Array([
  0, 1, 2, 0, 2, 3, // 前
  1, 5, 6, 1, 6, 2, // 右
  5, 4, 7, 5, 7, 6, // 后
  4, 0, 3, 4, 3, 7, // 左
  3, 2, 6, 3, 6, 7, // 顶
  4, 5, 1, 4, 1, 0 // 底
])

const posBytes = Buffer.from(positions.buffer)
const norBytes = Buffer.from(normals.buffer)
const idxBytes = Buffer.from(indices.buffer)
const bin = Buffer.concat([posBytes, norBytes, idxBytes])
const binPadding = (4 - (bin.length % 4)) % 4
const binPadded = Buffer.concat([bin, Buffer.alloc(binPadding)])

const gltf = {
  asset: { version: '2.0', generator: 'img-to-3d test generator' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'TestCube' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [
    {
      name: 'TestBlue',
      pbrMetallicRoughness: { baseColorFactor: [0.3, 0.6, 1.0, 1.0], metallicFactor: 0.1, roughnessFactor: 0.6 },
      doubleSided: true
    }
  ],
  buffers: [{ byteLength: binPadded.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
    { buffer: 0, byteOffset: posBytes.length, byteLength: norBytes.length, target: 34962 },
    { buffer: 0, byteOffset: posBytes.length + norBytes.length, byteLength: idxBytes.length, target: 34963 }
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
    { bufferView: 1, componentType: 5126, count: 8, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' }
  ]
}

let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf-8')
const jsonPadding = (4 - (jsonBuf.length % 4)) % 4
if (jsonPadding) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPadding, 0x20)])

const total = 12 + 8 + jsonBuf.length + 8 + binPadded.length
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0) // 'glTF'
header.writeUInt32LE(2, 4)
header.writeUInt32LE(total, 8)
const jsonHeader = Buffer.alloc(8)
jsonHeader.writeUInt32LE(jsonBuf.length, 0)
jsonHeader.writeUInt32LE(0x4e4f534a, 4) // 'JSON'
const binHeader = Buffer.alloc(8)
binHeader.writeUInt32LE(binPadded.length, 0)
binHeader.writeUInt32LE(0x004e4942, 4) // 'BIN\0'

writeFileSync(outPath, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binPadded]))
console.log(`written: ${outPath} (${total} bytes)`)
