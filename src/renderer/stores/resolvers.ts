import { IResolverEntry } from '@common/data'
import { atom } from 'jotai'

export const resolversAtom = atom<IResolverEntry[]>([])
export const currentResolverNameAtom = atom<string | null>(null)
export const resolverDraftsAtom = atom<Record<string, string>>({})
