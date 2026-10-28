let place = '/'

export const rememberPlace = (location: string) => {
  place = location
}

export const placeBefore = (pane: boolean) => (pane ? place : '/')
