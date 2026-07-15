import events from '@common/events'
import { RESOLVER_TEMPLATE } from '@common/resolver'
import { IOperationResult } from '@common/data'
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import ConfirmModal from '@renderer/components/ConfirmModal'
import SwitchButton from '@renderer/components/SwitchButton'
import { actions } from '@renderer/core/agent'
import { getErrorMessage, showErrorNotification } from '@renderer/core/notify'
import useOnBroadcast from '@renderer/core/useOnBroadcast'
import useI18n from '@renderer/models/useI18n'
import useResolvers from '@renderer/models/useResolvers'
import { resolverDraftsAtom } from '@renderer/stores/resolvers'
import { IconEdit, IconPlus, IconTrash, IconWorldWww } from '@tabler/icons-react'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import styles from './index.module.scss'

type NameDialog = { mode: 'add' } | { mode: 'rename'; originalName: string } | null

const VALID_NAME = /^(?!\.)(?!.*\.$)[A-Za-z0-9._-]+$/

const ResolverList = () => {
  const { lang } = useI18n()
  const { resolvers, setResolvers, currentResolverName, setCurrentResolverName, loadResolvers } =
    useResolvers()
  const [dialog, setDialog] = useState<NameDialog>(null)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteName, setDeleteName] = useState<string | null>(null)
  const [togglingName, setTogglingName] = useState<string | null>(null)
  const [drafts, setDrafts] = useAtom(resolverDraftsAtom)

  useEffect(() => {
    loadResolvers().catch((error) => {
      showErrorNotification({
        title: lang.fail,
        message: getErrorMessage(error, lang.fail),
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openAdd = () => {
    setName('')
    setDialog({ mode: 'add' })
  }

  useOnBroadcast(events.resolver_add, openAdd)

  const normalizedName = name.trim()
  const nameError = useMemo(() => {
    if (!normalizedName) return null
    if (normalizedName.length > 253 || !VALID_NAME.test(normalizedName)) {
      return lang.resolver_name_invalid
    }
    return null
  }, [lang.resolver_name_invalid, normalizedName])

  const showOperationError = (result: IOperationResult) => {
    if (result.code === 'cancelled') return
    showErrorNotification({
      title: lang.fail,
      message: result.message || lang.fail,
    })
  }

  const submitName = async () => {
    if (!dialog || !normalizedName || nameError) return
    setSubmitting(true)
    try {
      const result: IOperationResult =
        dialog.mode === 'add'
          ? await actions.saveResolver(normalizedName, RESOLVER_TEMPLATE)
          : await actions.renameResolver(dialog.originalName, normalizedName)
      if (!result.success) {
        showOperationError(result)
        return
      }
      if (dialog.mode === 'rename' && drafts[dialog.originalName] !== undefined) {
        setDrafts((current) => {
          const next = { ...current, [normalizedName]: current[dialog.originalName] }
          delete next[dialog.originalName]
          return next
        })
      }
      setDialog(null)
      await loadResolvers(normalizedName)
    } catch (error) {
      showErrorNotification({
        title: lang.fail,
        message: getErrorMessage(error, lang.fail),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteName) return
    const target = deleteName
    setDeleteName(null)
    try {
      const result: IOperationResult = await actions.deleteResolver(target)
      if (!result.success) {
        showOperationError(result)
        return
      }
      setDrafts((current) => {
        const next = { ...current }
        delete next[target]
        return next
      })
      await loadResolvers(currentResolverName === target ? null : currentResolverName)
    } catch (error) {
      showErrorNotification({
        title: lang.fail,
        message: getErrorMessage(error, lang.fail),
      })
    }
  }

  const toggleResolver = async (resolverName: string, enabled: boolean) => {
    setTogglingName(resolverName)
    setResolvers((current) =>
      current.map((item) => (item.name === resolverName ? { ...item, enabled } : item)),
    )
    try {
      const draft = drafts[resolverName]
      const result: IOperationResult = await actions.toggleResolver(
        resolverName,
        enabled,
        draft,
      )
      if (!result.success) {
        showOperationError(result)
        await loadResolvers(resolverName)
        return
      }
      if (draft !== undefined) {
        setDrafts((current) => {
          const next = { ...current }
          delete next[resolverName]
          return next
        })
      }
      await loadResolvers(resolverName)
    } catch (error) {
      showErrorNotification({
        title: lang.fail,
        message: getErrorMessage(error, lang.fail),
      })
      await loadResolvers(resolverName).catch((reloadError) => console.error(reloadError))
    } finally {
      setTogglingName(null)
    }
  }

  return (
    <div className={styles.root}>
      <Group className={styles.header} justify="space-between" gap={8} wrap="nowrap">
        <Text size="sm" fw={600} truncate>
          {lang.domain_resolution}
        </Text>
        <Tooltip label={lang.resolver_add}>
          <ActionIcon variant="subtle" color="gray" size={24} onClick={openAdd}>
            <IconPlus size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {resolvers.length === 0 ? (
        <Stack className={styles.empty} align="center" gap={8}>
          <IconWorldWww size={28} stroke={1.25} />
          <Text size="sm" c="dimmed" ta="center">
            {lang.resolver_empty}
          </Text>
          <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={openAdd}>
            {lang.resolver_add}
          </Button>
        </Stack>
      ) : (
        <div className={styles.list}>
          {resolvers.map((item) => (
            <div
              key={item.name}
              className={clsx(styles.item, item.name === currentResolverName && styles.selected)}
              onClick={() => setCurrentResolverName(item.name)}
            >
              <IconWorldWww className={styles.item_icon} size={16} stroke={1.5} />
              <span className={styles.name} title={item.name}>
                {item.name}
              </span>
              <div className={styles.status}>
                <div className={styles.actions}>
                  <ActionIcon
                    variant="subtle"
                    size={22}
                    aria-label={lang.edit}
                    onClick={(event) => {
                      event.stopPropagation()
                      setName(item.name)
                      setDialog({ mode: 'rename', originalName: item.name })
                    }}
                  >
                    <IconEdit size={14} stroke={1.5} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size={22}
                    aria-label={lang.delete}
                    onClick={(event) => {
                      event.stopPropagation()
                      setDeleteName(item.name)
                    }}
                  >
                    <IconTrash size={14} stroke={1.5} />
                  </ActionIcon>
                </div>
                <SwitchButton
                  ariaLabel={`${lang.domain_resolution} ${item.name}`}
                  on={item.enabled}
                  disabled={togglingName === item.name}
                  onChange={(enabled) =>
                    toggleResolver(item.name, enabled).catch((error) => console.error(error))
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        opened={dialog !== null}
        onClose={() => setDialog(null)}
        centered
        title={dialog?.mode === 'rename' ? lang.resolver_rename : lang.resolver_add}
      >
        <TextInput
          autoFocus
          label={lang.resolver_name}
          description="/etc/resolver/<name>"
          placeholder={lang.resolver_name_placeholder}
          value={name}
          error={nameError}
          maxLength={253}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitName().catch((error) => console.error(error))
          }}
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="outline" onClick={() => setDialog(null)}>
            {lang.btn_cancel}
          </Button>
          <Button
            loading={submitting}
            disabled={!normalizedName || !!nameError}
            onClick={() => submitName().catch((error) => console.error(error))}
          >
            {lang.btn_ok}
          </Button>
        </Group>
      </Modal>

      <ConfirmModal
        opened={deleteName !== null}
        onClose={() => setDeleteName(null)}
        onConfirm={() => confirmDelete().catch((error) => console.error(error))}
        title={lang.delete}
        message={lang.resolver_delete_confirm.replace('{0}', deleteName || '')}
        confirmLabel={lang.delete}
        danger
      />
    </div>
  )
}

export default ResolverList
