import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { extOfUrl, pickPreviewUrl } from '../lib/preview'
import { useAppStore } from '../store/app'

/** OBJ/STL 无材质时使用的统一标准材质（适配 RoomEnvironment 环境光） */
function defaultMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xbfc4cc, metalness: 0.1, roughness: 0.65 })
}

/**
 * Three.js 模型预览：OrbitControls、网格、光照、自动取景、线框切换。
 * M4 增加 OBJ/STL loader 与 FBX/USDZ 提示。
 */
function ModelViewer(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelRef = useRef<THREE.Group | null>(null)
  const rafRef = useRef(0)

  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [loadState, setLoadState] = useState<'empty' | 'loading' | 'loaded' | 'error' | 'unsupported'>('empty')
  const [loadMessage, setLoadMessage] = useState('')

  const tasks = useAppStore((s) => s.tasks)
  const selectedTaskId = useAppStore((s) => s.selectedTaskId)
  // 仅当"选中任务的产物列表"变化时才重新加载模型（线框切换/其他任务事件不应触发重载）
  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId)
  const outputKey = selectedTask?.status === 'done' ? selectedTask.outputUrls.join('|') : ''

  // 场景初始化（一次）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1b1e24)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      1000
    )
    camera.position.set(2.2, 1.6, 2.6)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.5, 0)

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 0.7)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(4, 6, 4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x8899ff, 0.5)
    fill.position.set(-5, 3, -4)
    scene.add(fill)

    const grid = new THREE.GridHelper(10, 20, 0x3a3f4a, 0x262a32)
    grid.name = 'grid'
    scene.add(grid)

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    controlsRef.current = controls

    const onResize = (): void => {
      if (!container) return
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(container)

    const animate = (): void => {
      rafRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafRef.current)
      observer.disconnect()
      controls.dispose()
      pmrem.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])

  // 线框/网格切换
  useEffect(() => {
    const model = modelRef.current
    if (model) {
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh && mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of materials) {
            const mat = m as THREE.MeshStandardMaterial
            mat.wireframe = wireframe
          }
        }
      })
    }
    const grid = sceneRef.current?.getObjectByName('grid')
    if (grid) grid.visible = showGrid
  }, [wireframe, showGrid, loadState])

  // 选中任务/产物变化时加载模型（按 GLB→OBJ→STL 优先级）
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const task = useAppStore.getState().tasks.find((t) => t.taskId === selectedTaskId)
    // 清理旧模型
    if (modelRef.current) {
      scene.remove(modelRef.current)
      disposeGroup(modelRef.current)
      modelRef.current = null
    }
    if (!task || task.status !== 'done') {
      setLoadState('empty')
      setLoadMessage('')
      return
    }
    const picked = pickPreviewUrl(task.outputUrls)
    if (!picked.url) {
      setLoadState(picked.unsupportedExt ? 'unsupported' : 'empty')
      setLoadMessage(
        picked.unsupportedExt
          ? `该格式暂不支持预览（${picked.unsupportedExt}），可从任务列表导出文件`
          : ''
      )
      return
    }
    let disposed = false
    setLoadState('loading')
    setLoadMessage('模型加载中…')
    const ext = extOfUrl(picked.url)
    const onLoaded = (model: THREE.Group): void => {
      if (disposed) {
        disposeGroup(model)
        return
      }
      scene.add(model)
      modelRef.current = model
      // 线框值由下方 effect 在 loadState 变为 loaded 时统一应用
      frameModel(model, cameraRef.current, controlsRef.current)
      setLoadState('loaded')
      setLoadMessage('')
    }
    const onError = (err: unknown): void => {
      if (disposed) return
      console.error(`${ext.toUpperCase()} 加载失败`, err)
      setLoadState('error')
      setLoadMessage('模型加载失败，请重试或查看日志')
    }
    if (ext === 'obj') {
      new OBJLoader().load(
        picked.url,
        (obj) => {
          // OBJLoader 默认 MeshPhongMaterial，统一换成标准材质以适配环境光
          obj.traverse((o) => {
            const mesh = o as THREE.Mesh
            if (mesh.isMesh) mesh.material = defaultMaterial()
          })
          onLoaded(obj)
        },
        undefined,
        onError
      )
    } else if (ext === 'stl') {
      new STLLoader().load(
        picked.url,
        (geometry) => {
          const group = new THREE.Group()
          group.add(new THREE.Mesh(geometry, defaultMaterial()))
          onLoaded(group)
        },
        undefined,
        onError
      )
    } else {
      new GLTFLoader().load(picked.url, (gltf) => onLoaded(gltf.scene), undefined, onError)
    }
    return () => {
      disposed = true
    }
  }, [selectedTaskId, outputKey])

  return (
    <section className="viewer">
      <div ref={containerRef} className="viewer-canvas" />
      <div className="viewer-toolbar">
        <label className="check-inline">
          <input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} />
          线框
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          网格
        </label>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const task = tasks.find((t) => t.taskId === selectedTaskId)
            const model = modelRef.current
            if (task && model) {
              frameModel(model, cameraRef.current, controlsRef.current)
            }
          }}
        >
          重置视角
        </button>
      </div>
      {loadState !== 'loaded' && (
        <div className={`viewer-overlay ${loadState === 'error' ? 'overlay-err' : ''}`}>
          {loadState === 'empty' && (
            <>
              <div className="upload-icon">📦</div>
              <div>生成完成后，点击左侧任务进行预览</div>
            </>
          )}
          {loadState !== 'empty' && <div>{loadMessage}</div>}
        </div>
      )}
    </section>
  )
}

/** Box3 自动取景：模型居中，相机对准并保持合适距离 */
function frameModel(
  model: THREE.Group,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitControls | null
): void {
  if (!camera || !controls) return
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const distance = (maxDim / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.5

  // 把模型移到地面附近居中
  model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z))
  controls.target.set(0, size.y / 2, 0)
  const dir = new THREE.Vector3(1, 0.6, 1).normalize()
  camera.position.copy(controls.target).add(dir.multiplyScalar(distance))
  camera.near = maxDim / 1000
  camera.far = distance * 20
  camera.updateProjectionMatrix()
  controls.update()
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of materials) {
        const mat = m as THREE.MeshStandardMaterial
        mat.map?.dispose()
        mat.normalMap?.dispose()
        mat.roughnessMap?.dispose()
        mat.metalnessMap?.dispose()
        mat.dispose()
      }
    }
  })
}

export default ModelViewer
