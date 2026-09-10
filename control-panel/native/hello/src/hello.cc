// hello.cc — Windows Hello for the TabbySync Control Panel lock screen.
//
// WHAT THIS IS. A thin binding over Windows.Security.Credentials.UI.
// UserConsentVerifier: "ask Windows to confirm the person sitting here is the
// account owner." It returns an attestation, nothing more. It does not produce
// a key, it does not encrypt anything, and it is not a stronger boundary than
// the PIN it sits beside — both are walk-up locks over data that Windows
// already protects at rest with DPAPI bound to the user's account (see
// src/core/pin-lock.js's header, which says the same thing at more length).
// Hello is here because typing a PIN every time is tedious, not because it
// makes the app safer. The UI says so too; a lock that implies more than it
// delivers is worse than none.
//
// WHY THE INTEROP INTERFACE. UserConsentVerifier::RequestVerificationAsync is
// a UWP API: it needs a CoreWindow, which a Win32 process like Electron does
// not have, and it fails at runtime rather than at build time. Desktop apps
// must go through IUserConsentVerifierInterop::RequestVerificationForWindowAsync
// and hand it an HWND to parent the dialog to. That HWND comes from Electron's
// BrowserWindow.getNativeWindowHandle(), passed in as a Buffer.
//   https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/
//
// WHY THE COMPLETION HANDLER RATHER THAN .get(). RequestVerificationForWindowAsync
// returns immediately with an IAsyncOperation; the dialog then lives for as
// long as the person takes to present a finger or give up. Blocking on .get()
// would freeze the thread that owns the window, which is the one drawing the
// dialog. So the handler is attached and the JS promise is resolved later from
// whichever thread WinRT completes on, marshalled back through a
// ThreadSafeFunction.
//
// Node-API (via node-addon-api) rather than the V8 API, so one build keeps
// working across Electron upgrades instead of needing a per-ABI rebuild.

#include <napi.h>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.UI.h>
#include <UserConsentVerifierInterop.h>
#include <windows.h>
#include <roapi.h>

#include <cstring>   // std::memcpy, for reading the HWND out of the Buffer
#include <string>

// Namespace ALIASES, not using-declarations, and that distinction is the whole
// reason this compiles. UserConsentVerifierInterop.h is a classic COM header:
// it pulls in the ABI projection (winrt/asyncinfo.h), which declares its own
// ABI::Windows::Foundation::AsyncStatus. Pulling the C++/WinRT AsyncStatus into
// the global namespace alongside it is ambiguous, and MSVC rejects it outright
// with "C2874: using-declaration causes a multiple declaration". Aliasing the
// namespaces instead introduces no names at global scope, so the two
// projections coexist the way they were designed to.
namespace creds = winrt::Windows::Security::Credentials::UI;
namespace wfound = winrt::Windows::Foundation;

namespace {

// The names JavaScript sees. Strings rather than an enum because they cross an
// IPC boundary and end up in a log line or an error message, where "2" tells
// nobody anything. src/core/hello.js is the only place that interprets them.
const char* AvailabilityName(creds::UserConsentVerifierAvailability value) {
  switch (value) {
    case creds::UserConsentVerifierAvailability::Available:            return "Available";
    case creds::UserConsentVerifierAvailability::DeviceNotPresent:     return "DeviceNotPresent";
    case creds::UserConsentVerifierAvailability::NotConfiguredForUser: return "NotConfiguredForUser";
    case creds::UserConsentVerifierAvailability::DisabledByPolicy:     return "DisabledByPolicy";
    case creds::UserConsentVerifierAvailability::DeviceBusy:           return "DeviceBusy";
    default:                                                    return "Unknown";
  }
}

const char* ResultName(creds::UserConsentVerificationResult value) {
  switch (value) {
    case creds::UserConsentVerificationResult::Verified:             return "Verified";
    case creds::UserConsentVerificationResult::DeviceNotPresent:     return "DeviceNotPresent";
    case creds::UserConsentVerificationResult::NotConfiguredForUser: return "NotConfiguredForUser";
    case creds::UserConsentVerificationResult::DisabledByPolicy:     return "DisabledByPolicy";
    case creds::UserConsentVerificationResult::DeviceBusy:           return "DeviceBusy";
    case creds::UserConsentVerificationResult::RetriesExhausted:     return "RetriesExhausted";
    case creds::UserConsentVerificationResult::Canceled:             return "Canceled";
    default:                                                  return "Unknown";
  }
}

// Electron's main thread has already initialised COM as an STA. Calling
// init_apartment() again with a different model returns RPC_E_CHANGED_MODE,
// which is not a failure for our purposes — COM is initialised either way,
// which is all the WinRT calls below need. Any other failure is real and is
// allowed to propagate.
void EnsureApartment() {
  static thread_local bool done = false;
  if (done) return;
  const HRESULT hr = ::RoInitialize(RO_INIT_SINGLETHREADED);
  if (hr != S_OK && hr != S_FALSE && hr != RPC_E_CHANGED_MODE) {
    winrt::throw_hresult(hr);
  }
  done = true;
}

// The HWND arrives from JS as the Buffer that Electron's
// BrowserWindow.getNativeWindowHandle() returns: the raw pointer's bytes, so
// 8 on x64 and 4 on x86. Anything else is a caller bug, not a user error.
HWND HwndFromBuffer(const Napi::Env& env, const Napi::Value& value) {
  if (!value.IsBuffer()) {
    throw Napi::TypeError::New(env, "Expected the window handle as a Buffer from getNativeWindowHandle()");
  }
  auto buffer = value.As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() != sizeof(HWND)) {
    throw Napi::TypeError::New(env, "Window handle Buffer is the wrong size for this architecture");
  }
  HWND hwnd = nullptr;
  std::memcpy(&hwnd, buffer.Data(), sizeof(HWND));
  if (hwnd == nullptr) {
    throw Napi::TypeError::New(env, "Window handle is null; the window may already be closed");
  }
  return hwnd;
}

// ---------------------------------------------------------------------------
// checkAvailability() -> string
// ---------------------------------------------------------------------------
//
// Synchronous on the JS side even though the underlying call is async: it
// completes in microseconds (it inspects local enrolment state, it does not
// show UI), and making it a promise would buy nothing but ceremony. .get() is
// safe here for the same reason — there is no dialog to keep alive.
Napi::Value CheckAvailability(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    EnsureApartment();
    const auto availability = creds::UserConsentVerifier::CheckAvailabilityAsync().get();
    return Napi::String::New(env, AvailabilityName(availability));
  } catch (const winrt::hresult_error& e) {
    // A machine with no Hello stack at all can throw rather than answer
    // DeviceNotPresent. Both mean the same thing to the caller.
    (void)e;
    return Napi::String::New(env, "DeviceNotPresent");
  }
}

// ---------------------------------------------------------------------------
// requestVerification(hwndBuffer, message) -> Promise<string>
// ---------------------------------------------------------------------------
Napi::Value RequestVerification(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsString()) {
    throw Napi::TypeError::New(env, "Expected (windowHandleBuffer, message)");
  }
  const HWND hwnd = HwndFromBuffer(env, info[0]);
  const std::string message = info[1].As<Napi::String>().Utf8Value();

  auto deferred = Napi::Promise::Deferred::New(env);

  try {
    EnsureApartment();

    // The documented interop pattern, and the reason winrt::capture is used
    // rather than calling through the raw vtable: RequestVerificationForWindowAsync
    // takes (REFIID, void**) as its last two arguments, and capture() is what
    // fills those in correctly and hands back a real projected type. Doing it
    // by hand is a place to get a refcount or a GUID wrong for no benefit.
    //   https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/
    auto factory = winrt::get_activation_factory<creds::UserConsentVerifier, IUserConsentVerifierInterop>();
    const winrt::hstring text = winrt::to_hstring(message);

    auto operation = winrt::capture<wfound::IAsyncOperation<creds::UserConsentVerificationResult>>(
        factory,
        &IUserConsentVerifierInterop::RequestVerificationForWindowAsync,
        hwnd,
        static_cast<HSTRING>(winrt::get_abi(text)));

    // The handler fires on a WinRT thread pool thread, which may not touch the
    // JS environment. The ThreadSafeFunction is the marshal back; it is
    // released inside the handler so the process is never held open by it.
    auto tsfn = Napi::ThreadSafeFunction::New(env, Napi::Function::New(env, [](const Napi::CallbackInfo&) {}),
                                              "tabbysync_hello", 0, 1);
    auto* box = new Napi::Promise::Deferred(deferred);

    operation.Completed([tsfn, box](const wfound::IAsyncOperation<creds::UserConsentVerificationResult>& op,
                                    wfound::AsyncStatus status) mutable {
      // Read the result on this thread; only plain data crosses over.
      std::string name = "Unknown";
      if (status == wfound::AsyncStatus::Completed) {
        try { name = ResultName(op.GetResults()); } catch (...) { name = "Unknown"; }
      } else if (status == wfound::AsyncStatus::Canceled) {
        name = "Canceled";
      }

      tsfn.BlockingCall([box, name](Napi::Env cbEnv, Napi::Function) {
        box->Resolve(Napi::String::New(cbEnv, name));
        delete box;
      });
      tsfn.Release();
    });
  } catch (const Napi::Error&) {
    throw;
  } catch (const winrt::hresult_error& e) {
    // Reject rather than throw: the JS side is already holding a promise, and
    // a mix of both shapes for one function is a trap for its caller.
    deferred.Reject(Napi::Error::New(env, winrt::to_string(e.message())).Value());
  } catch (...) {
    deferred.Reject(Napi::Error::New(env, "Windows Hello failed for an unknown reason").Value());
  }

  return deferred.Promise();
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("supported", Napi::Boolean::New(env, true));
  exports.Set("checkAvailability", Napi::Function::New(env, CheckAvailability));
  exports.Set("requestVerification", Napi::Function::New(env, RequestVerification));
  return exports;
}

NODE_API_MODULE(tabbysync_hello, Init)
