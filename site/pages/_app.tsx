import type { AppProps } from 'next/app'
import { type ErrorInfo, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ExampleLayout, Warning } from '../components/ExampleLayout'

function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error
  resetErrorBoundary: () => void
}) {
  return (
    <Warning>
      <p>An error was thrown by one of the example's React components!</p>
      <pre>
        <code>{error.stack}</code>
      </pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </Warning>
  )
}

export default function App({ Component, pageProps }: AppProps) {
  const [error, setError] = useState<Error | undefined>(undefined)
  const [stackTrace, setStackTrace] = useState<ErrorInfo | undefined>(undefined)
  return (
    <div>
      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onError={(error, stackTrace) => {
          setError(error)
          setStackTrace(stackTrace)
        }}
      >
        <ExampleLayout
          error={error}
          exampleName={pageProps.exampleName}
          examplePath={pageProps.examplePath}
          stackTrace={stackTrace}
        >
          <Component {...pageProps} />
        </ExampleLayout>
      </ErrorBoundary>
    </div>
  )
}
