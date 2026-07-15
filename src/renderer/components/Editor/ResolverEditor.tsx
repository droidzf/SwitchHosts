import { IOperationResult } from '@common/data'
import { normalizeLineEndings } from '@common/newlines'
import { Button, Code, Group, Stack, Text } from '@mantine/core'
import StatusBar from '@renderer/components/StatusBar'
import { actions } from '@renderer/core/agent'
import {
  getErrorMessage,
  showErrorNotification,
  showSuccessNotification,
} from '@renderer/core/notify'
import useI18n from '@renderer/models/useI18n'
import useResolvers from '@renderer/models/useResolvers'
import { resolverDraftsAtom } from '@renderer/stores/resolvers'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { IconDeviceFloppy, IconWorldWww } from '@tabler/icons-react'
import { useAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { buildExtensions } from './hosts_cm'
import styles from './ResolverEditor.module.scss'

const ResolverEditor = () => {
  const { lang } = useI18n()
  const { currentResolverName } = useResolvers()
  const [drafts, setDrafts] = useAtom(resolverDraftsAtom)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const nameRef = useRef(currentResolverName)
  const loadSequenceRef = useRef(0)

  useEffect(() => {
    nameRef.current = currentResolverName
  }, [currentResolverName])

  const createEditor = (doc: string) => {
    if (!mountRef.current) return
    viewRef.current?.destroy()
    mountRef.current.replaceChildren()
    const built = buildExtensions({
      initialReadOnly: false,
      mode: 'plain',
      onDocChange(next) {
        const normalized = normalizeLineEndings(next)
        const name = nameRef.current
        setContent(normalized)
        if (name) {
          setDrafts((current) => ({ ...current, [name]: normalized }))
        }
      },
    })
    viewRef.current = new EditorView({
      state: EditorState.create({ doc, extensions: built.extensions }),
      parent: mountRef.current,
    })
    viewRef.current.requestMeasure()
  }

  useEffect(() => {
    createEditor('')
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const sequence = ++loadSequenceRef.current
    if (!currentResolverName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the editor when the selected resolver disappears
      setContent('')
      createEditor('')
      return
    }

    const draft = drafts[currentResolverName]
    if (draft !== undefined) {
      setContent(draft)
      createEditor(draft)
      return
    }

    setLoading(true)
    actions
      .getResolverContent(currentResolverName)
      .then((value: string) => {
        if (sequence !== loadSequenceRef.current) return
        const next = normalizeLineEndings(value)
        setContent(next)
        createEditor(next)
      })
      .catch((error) => {
        if (sequence !== loadSequenceRef.current) return
        showErrorNotification({
          title: lang.fail,
          message: getErrorMessage(error, lang.fail),
        })
      })
      .finally(() => {
        if (sequence === loadSequenceRef.current) setLoading(false)
      })
    // `drafts` is intentionally excluded: typing updates it on every keystroke,
    // but the active editor must not be reconstructed while the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentResolverName])

  const save = async () => {
    if (!currentResolverName) return
    setSaving(true)
    try {
      const result: IOperationResult = await actions.saveResolver(currentResolverName, content)
      if (!result.success) {
        if (result.code !== 'cancelled') {
          showErrorNotification({ title: lang.fail, message: result.message || lang.fail })
        }
        return
      }
      setDrafts((current) => {
        const next = { ...current }
        delete next[currentResolverName]
        return next
      })
      showSuccessNotification({ title: lang.success, message: lang.resolver_saved })
    } catch (error) {
      showErrorNotification({
        title: lang.fail,
        message: getErrorMessage(error, lang.fail),
      })
    } finally {
      setSaving(false)
    }
  }

  if (!currentResolverName) {
    return (
      <Stack className={styles.placeholder} align="center" justify="center" gap={8}>
        <IconWorldWww size={36} stroke={1.25} />
        <Text c="dimmed">{lang.resolver_empty}</Text>
      </Stack>
    )
  }

  const dirty = drafts[currentResolverName] !== undefined

  return (
    <div className={styles.root}>
      <Group className={styles.toolbar} justify="space-between" wrap="nowrap">
        <Code className={styles.path}>/etc/resolver/{currentResolverName}</Code>
        <Button
          size="xs"
          leftSection={<IconDeviceFloppy size={15} stroke={1.5} />}
          loading={saving}
          disabled={loading || !dirty}
          onClick={() => save().catch((error) => console.error(error))}
        >
          {lang.btn_save}
        </Button>
      </Group>
      <div className={styles.editor} data-loading={loading ? '1' : '0'}>
        <div ref={mountRef} className={styles.mount} />
      </div>
      <StatusBar lineCount={content.split('\n').length} bytes={content.length} readOnly={false} />
    </div>
  )
}

export default ResolverEditor
