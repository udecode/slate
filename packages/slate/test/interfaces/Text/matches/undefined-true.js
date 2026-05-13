import { TextApi } from 'slate'

export const input = {
  text: { foo: undefined },
  props: { foo: undefined },
}

export const test = ({ text, props }) => {
  return TextApi.matches(text, props)
}

export const output = true
