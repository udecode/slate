export const TextString = ({
  text,
  isTrailing = false,
}: {
  text: string
  isTrailing?: boolean
}) => {
  return (
    <span data-slate-string>{`${text ?? ''}${isTrailing ? '\n' : ''}`}</span>
  )
}
