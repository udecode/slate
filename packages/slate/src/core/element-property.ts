import type {
  EditorElementPropertyDescriptor,
  EditorElementPropertyKind,
} from '../interfaces/editor'

type ElementPropertyOptions<T> = Omit<
  EditorElementPropertyDescriptor<T>,
  'kind'
>

const define = <T>(
  descriptor: EditorElementPropertyDescriptor<T> = {}
): EditorElementPropertyDescriptor<T> => Object.freeze({ ...descriptor })

const defineKind = <T>(
  kind: EditorElementPropertyKind,
  options: ElementPropertyOptions<T> = {}
) => define<T>({ ...options, kind })

export const elementProperty = Object.freeze({
  boolean: (options: ElementPropertyOptions<boolean> = {}) =>
    defineKind('boolean', options),
  define,
  json: <T = unknown>(options: ElementPropertyOptions<T> = {}) =>
    defineKind('json', options),
  number: (options: ElementPropertyOptions<number> = {}) =>
    defineKind('number', options),
  string: (options: ElementPropertyOptions<string> = {}) =>
    defineKind('string', options),
})
