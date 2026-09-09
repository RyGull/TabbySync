{
  "targets": [
    {
      "target_name": "tabbysync_hello",
      "sources": [],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include_dir\")"],
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
              # C++/WinRT needs C++17. /EHsc is the exception model the define
              # above assumes; ExceptionHandling:1 is the same thing said in
              # the way MSBuild wants to hear it.
              "AdditionalOptions": ["/std:c++17", "/permissive-"],
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
