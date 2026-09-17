import { useEffect } from 'react'
import TopBar from './components/TopBar'
import TaskList from './components/TaskList'
import ModelViewer from './components/ModelViewer'
import OptionsPanel from './components/OptionsPanel'
import StatusBar from './components/StatusBar'
import SettingsDialog from './components/SettingsDialog'
import { useAppStore } from './store/app'

function App(): React.JSX.Element {
  const init = useAppStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <TaskList />
        <ModelViewer />
        <OptionsPanel />
      </div>
      <StatusBar />
      <SettingsDialog />
    </div>
  )
}

export default App
