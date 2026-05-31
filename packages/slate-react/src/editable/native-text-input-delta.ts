export type NativeTextInsertDelta = {
  offset: number
  text: string
}

export const getNativeTextInsertDelta = ({
  inputText,
  selectionOffset,
  slateText,
  textHostText,
}: {
  inputText: string
  selectionOffset: number
  slateText: string
  textHostText: string
}): NativeTextInsertDelta => {
  const insertedLength = textHostText.length - slateText.length

  if (insertedLength > 0 && selectionOffset >= insertedLength) {
    const offset = Math.max(
      0,
      Math.min(slateText.length, selectionOffset - insertedLength)
    )
    const insertedText = textHostText.slice(offset, offset + insertedLength)

    if (
      insertedText.length > 0 &&
      textHostText.slice(0, offset) === slateText.slice(0, offset) &&
      textHostText.slice(offset + insertedLength) === slateText.slice(offset)
    ) {
      return {
        offset,
        text: insertedText,
      }
    }
  }

  return {
    offset: Math.max(
      0,
      Math.min(slateText.length, selectionOffset - inputText.length)
    ),
    text: inputText,
  }
}
