/**
 * @author: oldj
 * @homepage: https://oldj.net
 */

import events from '@common/events'
import HostsEditor from '@renderer/components/Editor/HostsEditor'
import ResolverEditor from '@renderer/components/Editor/ResolverEditor'
import { agent } from '@renderer/core/agent'
import useOnBroadcast from '@renderer/core/useOnBroadcast'
import { leftPanelViewAtom } from '@renderer/stores/ui'
import { useAtomValue } from 'jotai'
import styles from './index.module.scss'

const MainPanel = () => {
  const view = useAtomValue(leftPanelViewAtom)
  useOnBroadcast(events.cmd_run_result, (result) => {
    // console.log(result)
    if (!result.success) {
      console.error(result.stderr || 'cmd run error')
    }
  })

  return (
    <div className={styles.root}>
      {agent.platform === 'darwin' && view === 'resolver' ? <ResolverEditor /> : <HostsEditor />}
    </div>
  )
}

export default MainPanel
