import { TextApi } from 'slate'

export const input = {
  text: { foo: undefined },
  props: { bar: undefined },
}

export const test = ({ text, props }) => {
  return TextApi.matches(text, props)
}

export const output = false
