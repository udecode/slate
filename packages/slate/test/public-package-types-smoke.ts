type PublicPackageModules = [
  typeof import('slate'),
  typeof import('slate/internal'),
  typeof import('slate-react'),
  typeof import('slate-dom'),
  typeof import('slate-dom/internal'),
  typeof import('slate-history'),
  typeof import('slate-hyperscript'),
  typeof import('slate-layout'),
  typeof import('slate-layout/react'),
  typeof import('slate-browser/browser'),
  typeof import('slate-browser/core'),
  typeof import('slate-browser/playwright'),
  typeof import('slate-browser/transports'),
]

type PublicPackageNamedExports = [
  typeof import('slate').createEditor,
  typeof import('slate').createEditorRuntime,
  import('slate').Editor,
  import('slate').EditorCommit,
  typeof import('slate').isEditor,
  typeof import('slate/internal').isObject,
  typeof import('slate-browser/browser').takeDOMSelectionSnapshot,
  typeof import('slate-browser/core').assertSlateBrowserReleaseProof,
  typeof import('slate-browser/core').createSlateBrowserFeatureContractRegistry,
  typeof import('slate-browser/core').defineSlateBrowserFeatureContract,
  typeof import('slate-browser/core').validateSlateBrowserReleaseProof,
  typeof import('slate-browser/playwright').assertSlateBrowserSelectionContract,
  typeof import('slate-browser/transports').resolveBrowserMobileSurface,
  typeof import('slate-dom').DOMCoverage,
  typeof import('slate-dom').Hotkeys,
  typeof import('slate-dom').isDOMNode,
  typeof import('slate-dom/internal').DOMEditor,
  typeof import('slate-dom/internal').installDOM,
  typeof import('slate-history').History,
  typeof import('slate-history').history,
  typeof import('slate-hyperscript').createHyperscript,
  typeof import('slate-hyperscript').jsx,
  typeof import('slate-layout').createSlateLayout,
  typeof import('slate-layout').createSlatePageLayout,
  typeof import('slate-layout/react').PagedEditable,
  typeof import('slate-layout/react').useSlateLayout,
  typeof import('slate-react').Editable,
  typeof import('slate-react').Slate,
  typeof import('slate-react').useSlateEditor,
]

type PublicPackageNamedTypeExports = [
  import('slate').Descendant,
  import('slate').Editor,
  import('slate').EditorCommit,
  import('slate').Element,
  import('slate').Node,
  import('slate').Operation,
  import('slate').Path,
  import('slate').Point,
  import('slate').Range,
  import('slate').Text,
  import('slate').Value,
  import('slate-dom').DOMCoverageBoundary,
  import('slate-dom').DOMEditorOptions,
  import('slate-dom').DOMRange,
  import('slate-dom').DOMSelection,
  import('slate-dom').DOMStaticRange,
  import('slate-dom').HotkeySpec,
  import('slate-dom').StringDiff,
  import('slate-dom').TextDiff,
  import('slate-layout').SlateLayoutOptions,
  import('slate-layout').SlateNodeLayoutProvider,
  import('slate-layout').SlatePageLayout,
  import('slate-layout').SlatePageLayoutOptions,
  import('slate-layout').SlatePageSettings,
  import('slate-react').EditableDOMBeforeInputHandler,
  import('slate-react').EditableDOMStrategyLayout,
  import('slate-react').EditableDOMStrategyMetrics,
  import('slate-react').EditableKeyDownHandler,
  import('slate-react').EditableProps,
  import('slate-react').RenderElementProps,
  import('slate-react').SlateAnnotationStore,
  import('slate-react').SlateChange,
  import('slate-react').SlateDecorationSourceOptions,
  import('slate-react').SlateProps,
  import('slate-react').SlateWidgetStore,
  import('slate-react').UseSlateCommandCallbackOptions,
  import('slate-react').UseSlateEditorOptions,
  import('slate-react').UseSlateRootEditorOptions,
]

type IsAny<T> = 0 extends 1 & T ? true : false
type FirstArgument<T> = T extends (
  value: infer TInput,
  ...args: infer _Rest
) => unknown
  ? TInput
  : never
type IsNever<T> = [T] extends [never] ? true : false
type IsUnknownPredicateInput<T> =
  IsAny<T> extends true
    ? false
    : IsNever<T> extends true
      ? false
      : unknown extends T
        ? true
        : false
type ExpectTrue<T extends true> = T
type PublicUnknownPredicateInputs = [
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').Editor.isEditor>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').ElementApi.isAncestor>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').ElementApi.isElement>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').ElementApi.isElementList>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').ElementApi.isElementProps>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').ElementApi.isElementType>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').LocationApi.isLocation>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').NodeApi.isNode>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').NodeApi.isNodeList>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').OperationApi.isOperation>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').OperationApi.isOperationList>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').PathApi.isPath>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').PointApi.isPoint>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').RangeApi.isRange>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').SpanApi.isSpan>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').TextApi.isText>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').TextApi.isTextList>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate').TextApi.isTextProps>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate-dom').getDefaultView>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate-dom').isDOMElement>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<FirstArgument<typeof import('slate-dom').isDOMNode>>
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate-dom').isDOMSelection>
    >
  >,
  ExpectTrue<
    IsUnknownPredicateInput<FirstArgument<typeof import('slate-dom').isDOMText>>
  >,
  ExpectTrue<
    IsUnknownPredicateInput<
      FirstArgument<typeof import('slate-history').History.isHistory>
    >
  >,
]

// @ts-expect-error slate-browser is intentionally subpath-only.
type _SlateBrowserRootModule = typeof import('slate-browser')

const acceptsPublicPackageModules = <_T extends PublicPackageModules>() => true
const acceptsPublicPackageNamedExports = <
  _T extends PublicPackageNamedExports,
>() => true
const acceptsPublicPackageNamedTypeExports = <
  _T extends PublicPackageNamedTypeExports,
>() => true
const acceptsPublicUnknownPredicateInputs = <
  _T extends PublicUnknownPredicateInputs,
>() => true

acceptsPublicPackageModules<PublicPackageModules>()
acceptsPublicPackageNamedExports<PublicPackageNamedExports>()
acceptsPublicPackageNamedTypeExports<PublicPackageNamedTypeExports>()
acceptsPublicUnknownPredicateInputs<PublicUnknownPredicateInputs>()
