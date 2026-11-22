@file:OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)

package app.cookbook.core.api

import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFMutableDictionaryRef
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlock
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

/** Keychain generic password, service "app.cookbook.mobile.session". */
class KeychainSessionStorage : SessionStorage {
    private fun query(extra: (CFMutableDictionaryRef) -> Unit = {}): CFMutableDictionaryRef {
        val dict = CFDictionaryCreateMutable(null, 0, kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr)!!
        CFDictionaryAddValue(dict, kSecClass, kSecClassGenericPassword)
        CFDictionaryAddValue(dict, kSecAttrService, CFBridgingRetain(SERVICE))
        CFDictionaryAddValue(dict, kSecAttrAccount, CFBridgingRetain(ACCOUNT))
        extra(dict)
        return dict
    }

    override suspend fun load(): String? = memScoped {
        val q = query { CFDictionaryAddValue(it, kSecReturnData, kCFBooleanTrue); CFDictionaryAddValue(it, kSecMatchLimit, kSecMatchLimitOne) }
        val result = alloc<CFTypeRefVar>()
        val status = SecItemCopyMatching(q as CFDictionaryRef, result.ptr)
        CFRelease(q)
        if (status != errSecSuccess) return@memScoped null
        val data = CFBridgingRelease(result.value) as? NSData ?: return@memScoped null
        NSString.create(data = data, encoding = NSUTF8StringEncoding)?.toString()
    }

    override suspend fun save(value: String) {
        clear()
        @Suppress("CAST_NEVER_SUCCEEDS")
        val data = (value as NSString).dataUsingEncoding(NSUTF8StringEncoding) ?: return
        val q = query {
            CFDictionaryAddValue(it, kSecValueData, CFBridgingRetain(data))
            CFDictionaryAddValue(it, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlock)
        }
        SecItemAdd(q as CFDictionaryRef, null)
        CFRelease(q)
    }

    override suspend fun clear() {
        val q = query()
        SecItemDelete(q as CFDictionaryRef)
        CFRelease(q)
    }

    private companion object {
        const val SERVICE = "app.cookbook.mobile.session"
        const val ACCOUNT = "supabase"
    }
}
