import { describe, expect, it } from 'vitest'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

describe('OBJLoader.parse（纯几何解析，无 WebGL）', () => {
  it('解析含四边面的 OBJ 为含 Mesh 的 Group', () => {
    const objText = [
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'vn 0 0 1',
      'f 1//1 2//1 3//1 4//1',
      ''
    ].join('\n')
    const group = new OBJLoader().parse(objText)
    let meshes = 0
    let positions = 0
    group.traverse((o) => {
      const mesh = o as unknown as { isMesh?: boolean; geometry?: { getAttribute(n: string): { count: number } } }
      if (mesh.isMesh) {
        meshes++
        positions = mesh.geometry!.getAttribute('position').count
      }
    })
    expect(meshes).toBeGreaterThan(0)
    expect(positions).toBeGreaterThan(0)
  })
})

describe('STLLoader.parse（纯几何解析，无 WebGL）', () => {
  it('解析 ASCII STL 为带法线的几何体', () => {
    const stlText = [
      'solid tri',
      'facet normal 0 0 1',
      '  outer loop',
      '    vertex 0 0 0',
      '    vertex 1 0 0',
      '    vertex 1 1 0',
      '  endloop',
      'endfacet',
      'endsolid tri',
      ''
    ].join('\n')
    const geometry = new STLLoader().parse(new TextEncoder().encode(stlText).buffer as ArrayBuffer)
    expect(geometry.getAttribute('position').count).toBe(3)
    expect(geometry.getAttribute('normal')).toBeTruthy()
  })
})
