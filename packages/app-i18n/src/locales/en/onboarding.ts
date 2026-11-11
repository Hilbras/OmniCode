export default {
  continue: 'Continue',
  back: 'Back',
  skip: 'Skip',
  welcome: {
    title: 'Welcome to Omnicode',
    subtitle: 'The AI coding workbench for professional developers',
    languageLabel: 'Language',
    themeLabel: 'Appearance',
  },
  login: {
    title: 'Configure Model',
    subtitle: 'Choose the model service that powers Omnicode. You can change it later in Settings',
    // Single-card fallback (shown when the daemon predates region support;
    // starts the flow without a region)
    omnicodeTitle: 'Sign in with Omnicode',
    omnicodeHint: 'Ready out of the box with Omnicode membership benefits',
    omnicodeCnTitle: 'Omnicode',
    omnicodeCnHint: 'Sign in with your omnicode.com account',
    omnicodeOverseasTitle: 'Omnicode',
    omnicodeOverseasHint: 'Sign in with your omnicode.ai account',
    customProviderTitle: 'Add a custom provider',
    customProviderHint: 'Bring your own API key for OpenAI-compatible and other services',
    loggedInTitle: 'Logged in with Omnicode',
    loggedInHint: 'Your model service is ready to use',
    finish: 'Finish',
    skip: 'Skip for now',
  },
} as const;
