{
  "targets": [
    {
      "target_name": "tabbysync_hello",
      "sources": [],
      # .include, not .include_dir. include_dir is a path RELATIVE to the
      # directory node-gyp was invoked from, and gyp's make generator rewrites
      # it to suit this .gyp file's location while the msvs generator does not
      # — so it built on Linux and failed on Windows with "Cannot open include
      # file: 'napi.h'". .include is absolute and already quoted for gyp, which
      # is why it is the form node-addon-api's own documentation uses.
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      # The addon speaks Node-API, not the raw V8 API. That is the whole reason
      # this is buildable without pain: Node-API is ABI-stable, so one compiled
      # .node keeps working across Electron upgrades instead of needing a
      # rebuild for every ABI. NAPI_VERSION 8 covers everything used here and is
      # present in every Electron this app supports.
      #
      # NODE_ADDON_API_CPP_EXCEPTIONS turns on node-addon-api's throwing API,
      # which hello.cc relies on (Napi::TypeError, winrt::hresult_error). It is
      # not enough on its own: node-gyp compiles with -fno-exceptions by
      # default, so the toolchain has to be told separately, per platform,
      # below. Setting the define without the flags fails the build with
      # "exception handling disabled" — which is at least a loud failure.
      "defines": ["NAPI_VERSION=8", "NODE_ADDON_API_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='win'", {
          "sources": ["src/hello.cc"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              # No /std here on purpose. node-gyp's addon.gypi already asks
              # for /std:c++20, and overriding it with /std:c++17 only earned a
              # D9025 "overriding '/std:c++20'" warning — C++/WinRT needs C++17
              # *or later*, so the default already satisfies it, and pinning a
              # version here would mean revisiting this file every time that
              # default moves.
              #
              # ExceptionHandling:1 is /EHsc — the exception model that the
              # NODE_ADDON_API_CPP_EXCEPTIONS define above assumes, said in the
              # way MSBuild wants to hear it.
              "AdditionalOptions": ["/permissive-"],
              "ExceptionHandling": 1
            }
          },
          # WindowsApp.lib carries the WinRT activation entry points
          # (RoInitialize, RoGetActivationFactory) that C++/WinRT calls.
          "libraries": ["WindowsApp.lib"]
        }, {
          # Every other platform builds a stub rather than failing. `npm
          # install` on macOS or Linux is a normal thing to do here — the test
          # suite runs there — and it must not stop on a Windows-only addon.
          # src/core/hello.js treats a stub exactly as it treats a missing
          # addon: "Hello is unavailable", which off Windows is the truth.
          "sources": ["src/unsupported.cc"],
          # The counterpart to the define above, for gcc and clang. The `!`
          # suffix removes node-gyp's own -fno-exceptions; without both halves
          # node-addon-api's headers will not compile.
          "cflags_cc!": ["-fno-exceptions"],
          "cflags_cc": ["-fexceptions", "-std=c++17"],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
          }
        }]
      ]
    }
  ]
}
