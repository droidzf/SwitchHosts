import { IResolverEntry } from '@common/data'
import { actions } from '@renderer/core/agent'
import { currentResolverNameAtom, resolversAtom } from '@renderer/stores/resolvers'
import { useAtom } from 'jotai'

export default function useResolvers() {
  const [resolvers, setResolvers] = useAtom(resolversAtom)
  const [currentResolverName, setCurrentResolverName] = useAtom(currentResolverNameAtom)

  const loadResolvers = async (preferredName?: string | null) => {
    const items: IResolverEntry[] = await actions.getResolvers()
    setResolvers(items)

    const nextName = preferredName ?? currentResolverName
    if (nextName && items.some((item) => item.name === nextName)) {
      setCurrentResolverName(nextName)
    } else {
      setCurrentResolverName(items[0]?.name ?? null)
    }
    return items
  }

  return {
    resolvers,
    setResolvers,
    currentResolverName,
    setCurrentResolverName,
    loadResolvers,
  }
}
