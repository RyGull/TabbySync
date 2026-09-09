// unsupported.cc — what the Hello addon compiles to everywhere that is not
// Windows.
//
// This target exists so `npm install` succeeds on macOS and Linux. The test
// suite runs there, and a Windows-only addon that fails the whole install on
// another platform would make the desktop app's core logic untestable
// everywhere except the one machine that can build it.
//
// It exports the same shape as the real addon so src/core/hello.js has one
// contract to speak to rather than two: `supported: false` is the answer, and
// the JS side turns that into "Windows Hello is unavailable; use your PIN" —
// which off Windows is not a degradation, it is the truth.

#include <napi.h>

namespace {

Napi::Value CheckAvailability(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "DeviceNotPresent");
}

Napi::Value RequestVerification(const Napi::CallbackInfo& info) {
  auto deferred = Napi::Promise::Deferred::New(info.Env());
  deferred.Resolve(Napi::String::New(info.Env(), "DeviceNotPresent"));
  return deferred.Promise();
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("supported", Napi::Boolean::New(env, false));
  exports.Set("checkAvailability", Napi::Function::New(env, CheckAvailability));
  exports.Set("requestVerification", Napi::Function::New(env, RequestVerification));
  return exports;
}

NODE_API_MODULE(tabbysync_hello, Init)
