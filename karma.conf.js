module.exports = function(config) {
  config.set({
    frameworks: ['mocha', 'browserify'],
    // You may use 'ChromeCanary', 'Chromium' or any other supported browser
    browsers: ['Chrome_without_security'],
    browserDisconnectTimeout: 1000,
    // Need to bump these really high as it times out somehow.
    browserDisconnectTolerance: 2,
    browserNoActivityTimeout: 300000,
    // you can define custom flags
    customLaunchers: {
      Chrome_without_security: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox']
      }
    },
    files: [
      'test/minimum-tests.spec.js',
      {pattern: 'src/**/*.es6', type: 'js'},
      // fixtures
      {pattern: 'test/**/*.json', type: 'js'},
      {pattern: 'test/**/*-testcase.js', include: false, serve: false, watch: true}
    ],
    exclude: [
    ],
    client: {
      mocha: {
        require: [
        ],
      }
    },
    reporters: ['progress', 'mocha'],
    mochaReporter: {
      output: 'minimal',
      showDiff: true
    },
    preprocessors: {
      'src/**/*.es6': ['browserify', 'sourcemap'],
      'test/**/*.spec.js': ['browserify', 'sourcemap'],
      'test/**/*-testcase.js': ['browserify', 'sourcemap']
    },
    babelPreprocessor: {
      options: {
        sourceMap: 'inline'
      }
    },
    browserify: {
      debug: true,
      transform: [
        'babelify'
      ]
    }
  });
};
