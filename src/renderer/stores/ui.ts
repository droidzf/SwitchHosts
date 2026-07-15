import { atom } from 'jotai'

export type LeftPanelView = 'list' | 'trashcan' | 'resolver'

export const leftPanelViewAtom = atom<LeftPanelView>('list')
