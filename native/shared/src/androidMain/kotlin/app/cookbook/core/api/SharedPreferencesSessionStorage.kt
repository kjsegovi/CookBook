package app.cookbook.core.api

import android.content.Context

/** Plain SharedPreferences for now; EncryptedSharedPreferences/DataStore is a follow-up. */
class SharedPreferencesSessionStorage(context: Context) : SessionStorage {
    private val prefs = context.applicationContext.getSharedPreferences("app.cookbook.mobile.session", Context.MODE_PRIVATE)
    override suspend fun load(): String? = prefs.getString(KEY, null)
    override suspend fun save(value: String) { prefs.edit().putString(KEY, value).apply() }
    override suspend fun clear() { prefs.edit().remove(KEY).apply() }
    private companion object { const val KEY = "session" }
}
