var OFF = 0, WARN = 1, ERROR = 2;

module.exports = exports = {
  extends: 'airbnb-base',
  env: {
    'es6': true,
  },
  'ecmaFeatures': {
    // env=es6 doesn't include modules, which we are using
    'modules': true,
  },
  rules: {
    'consistent-return': 'off',
    'global-require': 'off',
    'no-use-before-define': 'off',
    'no-param-reassign': 'off',
    'linebreak-style': 'off',
    'max-len': ['error', { 'code': 120 }],
    'no-restricted-syntax': 'off',
    'no-continue': 'off',
    'no-prototype-builtins': 'off',
    'quote-props': 'off',
    'no-plusplus': 'off',
    'indent': 'off',
    'no-tabs': 'off',
  }
};
