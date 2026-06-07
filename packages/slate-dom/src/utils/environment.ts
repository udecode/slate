export const IS_IOS =
  typeof navigator !== 'undefined' &&
  typeof window !== 'undefined' &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as Window & { MSStream?: boolean }).MSStream

export const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac OS X/.test(navigator.userAgent)

export const IS_ANDROID =
  typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

export const IS_FIREFOX =
  typeof navigator !== 'undefined' &&
  /^(?!.*Seamonkey)(?=.*Firefox).*/i.test(navigator.userAgent)

export const IS_WEBKIT =
  typeof navigator !== 'undefined' &&
  /AppleWebKit(?!.*Chrome)/i.test(navigator.userAgent)

export const IS_CHROME =
  typeof navigator !== 'undefined' && /Chrome/i.test(navigator.userAgent)

// UC mobile browser
export const IS_UC_MOBILE =
  typeof navigator !== 'undefined' && /.*UCBrowser/.test(navigator.userAgent)

// Wechat browser (not including mac wechat)
export const IS_WECHATBROWSER =
  typeof navigator !== 'undefined' &&
  /.*Wechat/.test(navigator.userAgent) &&
  !/.*MacWechat/.test(navigator.userAgent)
// Check if DOM is available as React does internally.
// https://github.com/facebook/react/blob/master/packages/shared/ExecutionEnvironment.js
export const CAN_USE_DOM = !!(
  typeof window !== 'undefined' &&
  typeof window.document !== 'undefined' &&
  typeof window.document.createElement !== 'undefined'
)

export const HAS_BEFORE_INPUT_SUPPORT =
  typeof globalThis !== 'undefined' &&
  globalThis.InputEvent &&
  typeof (
    globalThis.InputEvent.prototype as InputEvent & {
      getTargetRanges?: unknown
    }
  ).getTargetRanges === 'function'
